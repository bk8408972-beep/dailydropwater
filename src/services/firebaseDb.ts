import type {
  BulkBookingRequest,
  BulkBookingStatus,
  CustomerRecord,
  DailyOrderCounterState,
  Order,
  OwnerAuthConfig,
  Product,
  RiderRecord,
  StoreSettings,
} from '../types';
import {
  DEFAULT_PRODUCTS,
  getCompletedOrdersForCleanup,
  getInactiveCustomerMobilesForCleanup,
} from '../utils/domain';
import {
  DEFAULT_STORE_SETTINGS,
  normalizeStoreSettings,
} from '../utils/storeSettings';
import {
  buildWeeklyArchiveRecord,
  selectOrdersEligibleForAutoArchive,
} from '../utils/weeklyArchive';
import { getRiderCompletedOrders } from '../utils/riderStats';
import {
  assertOwnerAuthenticated,
  computeStockDeductions,
  sanitizeAddressInput,
  sanitizePhone10,
  sanitizeTextInput,
  validateOrderWritePayload,
} from '../utils/security';
import {
  buildDailyOrderKey,
  computeNextDailyOrderCounter,
} from '../utils/orderSequence';

export const FIREBASE_DB_URL =
  'https://dailydrop-water-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * Sanitizes a single Firebase RTDB path segment by stripping illegal characters
 * (., #, $, [, ], /) so keys can never break out of their target node.
 */
export function sanitizeFirebaseKey(raw: string): string {
  return raw.trim().replace(/[.#$[\]/\\]/g, '');
}

function buildUrl(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, '');
  return `${FIREBASE_DB_URL}/${normalized}.json`;
}

export async function dbGet<T>(path: string): Promise<T | null> {
  const res = await fetch(buildUrl(path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Database read failed (${res.status}) for /${path}`);
  }
  return (await res.json()) as T | null;
}

export async function dbSet<T>(path: string, data: T): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Database write failed (${res.status}) for /${path}`);
  }
  const result = (await res.json()) as T;
  triggerSubscribersForPath(path);
  return result;
}

export async function dbPatch<T extends Record<string, unknown>>(
  path: string,
  partial: T
): Promise<T> {
  const res = await fetch(buildUrl(path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!res.ok) {
    throw new Error(`Database update failed (${res.status}) for /${path}`);
  }
  const result = (await res.json()) as T;
  triggerSubscribersForPath(path);
  return result;
}

export async function dbDelete(path: string): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Database delete failed (${res.status}) for /${path}`);
  }
  triggerSubscribersForPath(path);
}

/**
 * Applies a Firebase RTDB SSE put/patch payload onto an in-memory JSON tree.
 */
function applyRtdbEvent(
  current: unknown,
  eventPath: string,
  data: unknown,
  mode: 'put' | 'patch'
): unknown {
  const segments = eventPath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    if (mode === 'patch' && data && typeof data === 'object' && !Array.isArray(data)) {
      const base =
        current && typeof current === 'object' && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (v === null) {
          delete base[k];
        } else {
          base[k] = v;
        }
      }
      return base;
    }
    return data;
  }

  const root =
    current && typeof current === 'object' && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};

  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const existing = cursor[seg];
    const nextObj =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[seg] = nextObj;
    cursor = nextObj;
  }

  const leaf = segments[segments.length - 1];
  if (mode === 'patch' && data && typeof data === 'object' && !Array.isArray(data)) {
    const existingLeaf = cursor[leaf];
    const merged =
      existingLeaf && typeof existingLeaf === 'object' && !Array.isArray(existingLeaf)
        ? { ...(existingLeaf as Record<string, unknown>) }
        : {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v === null) {
        delete merged[k];
      } else {
        merged[k] = v;
      }
    }
    cursor[leaf] = merged;
  } else if (data === null) {
    delete cursor[leaf];
  } else {
    cursor[leaf] = data;
  }

  return root;
}

// Keep at most 4 live SSE connections per browser tab so HTTP/1.1's 6-connection
// per-origin limit always reserves free sockets for fast REST writes & reads.
const MAX_CONCURRENT_SSE = 4;
let activeEventSourceCount = 0;
const registeredRefreshers = new Set<{ path: string; refresh: () => void }>();

function triggerSubscribersForPath(mutatedPath: string): void {
  const cleanMutated = mutatedPath.replace(/^\/+|\/+$/g, '');
  for (const sub of registeredRefreshers) {
    if (
      cleanMutated === sub.path ||
      cleanMutated.startsWith(`${sub.path}/`) ||
      sub.path.startsWith(`${cleanMutated}/`)
    ) {
      sub.refresh();
    }
  }
}

/**
 * Subscribes live to a Firebase Realtime Database path using native SSE streaming
 * (EventSource) up to MAX_CONCURRENT_SSE sockets, with resilient polling fallback
 * so browser REST writes never starve on the per-origin connection limit.
 */
export function subscribePath<T>(
  path: string,
  onData: (value: T | null) => void,
  onError?: (err: Error) => void
): () => void {
  let closed = false;
  let state: unknown = null;
  let eventSource: EventSource | null = null;
  let holdsSseSlot = false;
  let pollTimer: number | null = null;
  const cleanPath = path.replace(/^\/+|\/+$/g, '');

  const fetchSnapshot = async () => {
    try {
      const fresh = await dbGet<T>(path);
      if (closed) return;
      state = fresh;
      onData(fresh);
    } catch (err) {
      if (!closed && onError) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  const refresherEntry = {
    path: cleanPath,
    refresh: () => {
      if (!closed) void fetchSnapshot();
    },
  };
  registeredRefreshers.add(refresherEntry);

  const startFallbackPolling = () => {
    if (pollTimer !== null || closed) return;
    pollTimer = window.setInterval(() => {
      void fetchSnapshot();
    }, 3500);
  };

  const stopFallbackPolling = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  // Immediate initial read so first paint is instant even before SSE handshake completes
  void fetchSnapshot();

  if (
    typeof window !== 'undefined' &&
    'EventSource' in window &&
    activeEventSourceCount < MAX_CONCURRENT_SSE
  ) {
    try {
      activeEventSourceCount += 1;
      holdsSseSlot = true;
      eventSource = new EventSource(buildUrl(path));

      const handleEvent = (mode: 'put' | 'patch') => (evt: MessageEvent) => {
        if (closed) return;
        try {
          const parsed = JSON.parse(evt.data) as { path: string; data: unknown };
          state = applyRtdbEvent(state, parsed.path, parsed.data, mode);
          stopFallbackPolling();
          onData((state as T | null) ?? null);
        } catch {
          void fetchSnapshot();
        }
      };

      eventSource.addEventListener('put', handleEvent('put') as EventListener);
      eventSource.addEventListener('patch', handleEvent('patch') as EventListener);
      eventSource.onerror = () => {
        if (!closed) {
          startFallbackPolling();
        }
      };
    } catch {
      if (holdsSseSlot) {
        activeEventSourceCount = Math.max(0, activeEventSourceCount - 1);
        holdsSseSlot = false;
      }
      startFallbackPolling();
    }
  } else {
    startFallbackPolling();
  }

  return () => {
    closed = true;
    registeredRefreshers.delete(refresherEntry);
    stopFallbackPolling();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (holdsSseSlot) {
      activeEventSourceCount = Math.max(0, activeEventSourceCount - 1);
      holdsSseSlot = false;
    }
  };
}

let seedingPromise: Promise<Record<string, Product>> | null = null;

/**
 * Ensures /products has the 7 default water & cold drinks products
 * if the Firebase database is empty on first load.
 */
export async function ensureProductsSeeded(): Promise<Record<string, Product>> {
  if (seedingPromise) return seedingPromise;

  seedingPromise = (async () => {
    const existing = await dbGet<Record<string, Product>>('products');
    if (existing && Object.keys(existing).length > 0) {
      return existing;
    }
    await dbSet('products', DEFAULT_PRODUCTS);
    return DEFAULT_PRODUCTS;
  })();

  try {
    return await seedingPromise;
  } finally {
    seedingPromise = null;
  }
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const raw = await dbGet<Partial<StoreSettings>>('storeSettings');
  return normalizeStoreSettings(raw);
}

export async function ensureStoreSettingsSeeded(): Promise<StoreSettings> {
  const existing = await dbGet<Partial<StoreSettings>>('storeSettings');
  if (existing && typeof existing === 'object') {
    const normalized = normalizeStoreSettings(existing);
    const missingKeys: Partial<StoreSettings> = {};
    if (typeof existing.isOpen !== 'boolean') missingKeys.isOpen = normalized.isOpen;
    if (typeof existing.autoAssign !== 'boolean') missingKeys.autoAssign = normalized.autoAssign;
    if (typeof existing.platformFee !== 'number') missingKeys.platformFee = normalized.platformFee;
    if (typeof existing.deliveryFee !== 'number') missingKeys.deliveryFee = normalized.deliveryFee;
    if (typeof existing.floor2Charge !== 'number') missingKeys.floor2Charge = normalized.floor2Charge;
    if (typeof existing.floor3PlusCharge !== 'number') missingKeys.floor3PlusCharge = normalized.floor3PlusCharge;
    if (typeof existing.radiusEnabled !== 'boolean') missingKeys.radiusEnabled = normalized.radiusEnabled;
    if (typeof existing.deliveryRadiusKm !== 'number') missingKeys.deliveryRadiusKm = normalized.deliveryRadiusKm;
    if (typeof existing.storeLat !== 'number') missingKeys.storeLat = normalized.storeLat;
    if (typeof existing.storeLng !== 'number') missingKeys.storeLng = normalized.storeLng;
    if (typeof existing.upiEnabled !== 'boolean') missingKeys.upiEnabled = normalized.upiEnabled;
    if (typeof existing.codEnabled !== 'boolean') missingKeys.codEnabled = normalized.codEnabled;
    if (typeof existing.upiId !== 'string') missingKeys.upiId = normalized.upiId;
    if (typeof existing.upiName !== 'string') missingKeys.upiName = normalized.upiName;
    if (typeof existing.minOrderAmount !== 'number') missingKeys.minOrderAmount = normalized.minOrderAmount;
    if (typeof existing.bulkOrdersEnabled !== 'boolean') missingKeys.bulkOrdersEnabled = normalized.bulkOrdersEnabled;
    if (typeof existing.supportMobile !== 'string' || !existing.supportMobile.trim()) missingKeys.supportMobile = normalized.supportMobile;
    if (typeof existing.supportEmail !== 'string') missingKeys.supportEmail = normalized.supportEmail;
    if (typeof existing.congratsPopupSeconds !== 'number') missingKeys.congratsPopupSeconds = normalized.congratsPopupSeconds;
    if (typeof existing.promoBannerEnabled !== 'boolean') missingKeys.promoBannerEnabled = normalized.promoBannerEnabled;
    if (typeof existing.promoBannerText !== 'string') missingKeys.promoBannerText = normalized.promoBannerText;
    if (typeof existing.promoBannerButtonText !== 'string') missingKeys.promoBannerButtonText = normalized.promoBannerButtonText;
    if (typeof existing.promoBannerActionUrl !== 'string') missingKeys.promoBannerActionUrl = normalized.promoBannerActionUrl;
    if (typeof existing.promoBannerIntervalMinutes !== 'number') missingKeys.promoBannerIntervalMinutes = normalized.promoBannerIntervalMinutes;
    if (typeof existing.promoBannerPhone !== 'string') missingKeys.promoBannerPhone = normalized.promoBannerPhone;
    if (Object.keys(missingKeys).length > 0) {
      await dbPatch('storeSettings', { ...missingKeys, updatedAt: Date.now() });
    }
    return normalized;
  }
  const seeded: StoreSettings = {
    ...DEFAULT_STORE_SETTINGS,
    updatedAt: Date.now(),
  };
  await dbSet('storeSettings', seeded);
  return seeded;
}

export async function updateStoreSettings(
  partial: Partial<StoreSettings>
): Promise<void> {
  assertOwnerAuthenticated('updating store settings');
  await dbPatch('storeSettings', {
    ...partial,
    updatedAt: Date.now(),
  });
}

export async function ownerPatchOrder(
  orderId: string,
  partial: Record<string, unknown>
): Promise<void> {
  assertOwnerAuthenticated('updating orders');
  const safeId = sanitizeFirebaseKey(orderId);
  if (!safeId) throw new Error('Invalid order ID.');
  await dbPatch(`orders/${safeId}`, {
    ...partial,
    updatedAt: Date.now(),
  });
}

export async function ownerDeleteOrder(orderId: string): Promise<void> {
  assertOwnerAuthenticated('deleting an order');
  const safeId = sanitizeFirebaseKey(orderId);
  if (!safeId) throw new Error('Invalid order ID.');
  await dbDelete(`orders/${safeId}`);
}

export async function ownerSaveProduct(product: Product): Promise<void> {
  assertOwnerAuthenticated('saving a product');
  const safeId = sanitizeFirebaseKey(product.id);
  if (!safeId) throw new Error('Invalid product ID.');
  await dbSet(`products/${safeId}`, product);
}

export async function ownerPatchProduct(
  productId: string,
  partial: Partial<Product>
): Promise<void> {
  assertOwnerAuthenticated('updating a product');
  const safeId = sanitizeFirebaseKey(productId);
  if (!safeId) throw new Error('Invalid product ID.');
  await dbPatch(`products/${safeId}`, partial as Record<string, unknown>);
}

export async function ownerDeleteProduct(productId: string): Promise<void> {
  assertOwnerAuthenticated('deleting a product');
  const safeId = sanitizeFirebaseKey(productId);
  if (!safeId) throw new Error('Invalid product ID.');
  await dbDelete(`products/${safeId}`);
}

export async function ownerSaveRider(rider: RiderRecord): Promise<void> {
  assertOwnerAuthenticated('adding a rider');
  const safeId = sanitizeFirebaseKey(rider.id).toUpperCase();
  if (!safeId) throw new Error('Invalid rider ID.');
  await dbSet(`riders/${safeId}`, { ...rider, id: safeId });
}

export async function ownerPatchRider(
  riderId: string,
  partial: Partial<RiderRecord>
): Promise<void> {
  assertOwnerAuthenticated('updating a rider');
  const safeId = sanitizeFirebaseKey(riderId).toUpperCase();
  if (!safeId) throw new Error('Invalid rider ID.');
  await dbPatch(`riders/${safeId}`, partial as Record<string, unknown>);
}

export async function ownerDeleteRider(riderId: string): Promise<void> {
  assertOwnerAuthenticated('deleting a rider');
  const safeId = sanitizeFirebaseKey(riderId).toUpperCase();
  if (!safeId) throw new Error('Invalid rider ID.');
  await dbDelete(`riders/${safeId}`);
}

export async function ownerDeleteCustomer(mobile: string): Promise<void> {
  assertOwnerAuthenticated('deleting a customer record');
  const safeMobile = sanitizeFirebaseKey(sanitizePhone10(mobile));
  if (!safeMobile) throw new Error('Invalid customer mobile.');
  await dbDelete(`customers/${safeMobile}`);
}

export interface AllocatedDailyOrderId {
  orderNumber: number;
  orderDateIst: string;
  orderKey: string;
}

/**
 * Atomically allocates the next sequential daily Order ID (1, 2, 3... up to 500+)
 * in Firebase RTDB using native ETag compare-and-swap (X-Firebase-ETag + If-Match).
 * Automatically resets back to 1 whenever the IST calendar date (YYYY-MM-DD) changes
 * at 12:00 AM midnight IST.
 */
export async function allocateNextDailyOrderNumber(
  nowMs: number = Date.now()
): Promise<AllocatedDailyOrderId> {
  const counterUrl = buildUrl('settings/dailyOrderCounter');
  const maxAttempts = 12;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const getRes = await fetch(counterUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Firebase-ETag': 'true',
      },
      cache: 'no-store',
    });

    if (!getRes.ok) {
      throw new Error(
        `Unable to read daily order counter (${getRes.status}). Please retry.`
      );
    }

    const etag = getRes.headers.get('etag') || getRes.headers.get('ETag') || 'null_etag';
    const current = (await getRes.json()) as Partial<DailyOrderCounterState> | null;
    const nextState = computeNextDailyOrderCounter(current, nowMs);

    const putRes = await fetch(counterUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
      },
      body: JSON.stringify(nextState),
    });

    if (putRes.ok) {
      triggerSubscribersForPath('settings/dailyOrderCounter');
      return {
        orderNumber: nextState.count,
        orderDateIst: nextState.date,
        orderKey: buildDailyOrderKey(nextState.date, nextState.count),
      };
    }

    if (putRes.status === 412) {
      // Concurrent order incremented the counter first — brief backoff and retry CAS
      await new Promise((resolve) =>
        setTimeout(resolve, 25 + Math.floor(Math.random() * 45))
      );
      continue;
    }

    throw new Error(
      `Unable to allocate daily Order ID (${putRes.status}). Please retry.`
    );
  }

  throw new Error('Order queue is busy right now. Please tap Place Order again.');
}

export async function placeCustomerOrder(
  order: Order,
  existingCustomer?: CustomerRecord | null,
  catalogSnapshot?: Product[] | null
): Promise<void> {
  const sanitizedOrder: Order = {
    ...order,
    customerName: sanitizeTextInput(order.customerName, 80),
    customerMobile: sanitizePhone10(order.customerMobile),
    address: sanitizeAddressInput(order.address, 260),
    upiVerified: false,
    upiVerifiedAt: null,
  };

  const validationError = validateOrderWritePayload(sanitizedOrder);
  if (validationError) {
    throw new Error(validationError);
  }

  const safeOrderId = sanitizeFirebaseKey(sanitizedOrder.id);
  const safeMobile = sanitizeFirebaseKey(sanitizedOrder.customerMobile);

  const customerRecord: CustomerRecord = {
    mobile: safeMobile,
    name: sanitizedOrder.customerName,
    lastAddress: sanitizedOrder.address,
    totalOrders: Math.max(0, existingCustomer?.totalOrders ?? 0) + 1,
    lastOrderAt: sanitizedOrder.createdAt,
  };

  let catalogForStock = catalogSnapshot ?? null;
  if (!catalogForStock || catalogForStock.length === 0) {
    const rawProducts = await dbGet<Record<string, Product>>('products').catch(() => null);
    if (rawProducts) {
      catalogForStock = Object.entries(rawProducts).map(([id, prod]) => ({
        ...prod,
        id: prod.id || id,
      }));
    }
  }

  const stockDeductions = catalogForStock
    ? computeStockDeductions(sanitizedOrder.items, catalogForStock)
    : [];

  const writes: Promise<unknown>[] = [
    dbSet(`orders/${safeOrderId}`, sanitizedOrder),
    dbSet(`customers/${safeMobile}`, customerRecord),
  ];

  for (const deduction of stockDeductions) {
    const safeProductId = sanitizeFirebaseKey(deduction.productId);
    if (!safeProductId) continue;
    writes.push(
      dbPatch(`products/${safeProductId}`, {
        stock: deduction.nextStock,
        inStock: deduction.nextInStock,
      })
    );
  }

  await Promise.all(writes);
}

export async function submitBulkBookingRequest(
  booking: BulkBookingRequest
): Promise<void> {
  const safeId = sanitizeFirebaseKey(booking.id);
  if (!safeId) throw new Error('Invalid bulk booking ID.');
  const payload: BulkBookingRequest = {
    ...booking,
    id: safeId,
    customerName: sanitizeTextInput(booking.customerName, 80),
    customerMobile: sanitizePhone10(booking.customerMobile),
    address: sanitizeAddressInput(booking.address, 260),
    notes: sanitizeAddressInput(booking.notes ?? '', 240),
    status: 'pending',
  };
  await dbSet(`settings/bulkBookings/${safeId}`, payload);
}

export async function ownerUpdateBulkBookingStatus(
  bookingId: string,
  status: BulkBookingStatus
): Promise<void> {
  assertOwnerAuthenticated('updating bulk booking request status');
  const safeId = sanitizeFirebaseKey(bookingId);
  if (!safeId) throw new Error('Invalid bulk booking ID.');
  await dbPatch(`settings/bulkBookings/${safeId}`, {
    status,
    updatedAt: Date.now(),
  });
}

export async function ownerDeleteBulkBooking(bookingId: string): Promise<void> {
  assertOwnerAuthenticated('deleting bulk booking request');
  const safeId = sanitizeFirebaseKey(bookingId);
  if (!safeId) throw new Error('Invalid bulk booking ID.');
  await dbDelete(`settings/bulkBookings/${safeId}`);
}

/**
 * Customer self-service data deletion (Google Play Account & Data Deletion Policy):
 * Permanently deletes /customers/{mobile} and anonymizes personal PII on the customer's
 * completed (delivered/rejected) orders while preserving any active in-flight deliveries.
 */
export async function deleteCustomerProfileData(
  rawMobile: string
): Promise<{ deletedProfile: boolean; anonymizedOrders: number }> {
  const safeMobile = sanitizeFirebaseKey(sanitizePhone10(rawMobile));
  if (!/^\d{10}$/.test(safeMobile)) {
    return { deletedProfile: false, anonymizedOrders: 0 };
  }

  await dbDelete(`customers/${safeMobile}`);

  let anonymizedOrders = 0;
  try {
    const allOrders = await dbGet<Record<string, Order>>('orders');
    if (allOrders && typeof allOrders === 'object') {
      const patches: Promise<unknown>[] = [];
      for (const [id, ord] of Object.entries(allOrders)) {
        if (!ord) continue;
        const orderMobile = sanitizePhone10(ord.customerMobile || '');
        if (orderMobile !== safeMobile) continue;
        const status = (ord.status || '').toLowerCase();
        if (status === 'delivered' || status === 'rejected') {
          const safeId = sanitizeFirebaseKey(ord.id || id);
          if (safeId) {
            anonymizedOrders += 1;
            patches.push(
              dbPatch(`orders/${safeId}`, {
                customerName: 'Deleted User',
                address: 'Removed by user request',
                customerLat: null,
                customerLng: null,
                customerLocation: null,
                deliveryPhoto: null,
                updatedAt: Date.now(),
              })
            );
          }
        }
      }
      if (patches.length > 0) {
        await Promise.all(patches);
      }
    }
  } catch {
    // Profile node itself was already deleted
  }

  return { deletedProfile: true, anonymizedOrders };
}

export async function verifyOwnerPassword(inputPassword: string): Promise<boolean> {
  const cleanedInput = inputPassword.trim();
  if (!cleanedInput) return false;
  const stored = await dbGet<OwnerAuthConfig>('settings/ownerAuth');
  const activePassword = stored?.password?.trim();
  if (!activePassword) {
    throw new Error(
      'Owner authentication is not configured in Firebase /settings/ownerAuth/password.'
    );
  }
  return cleanedInput === activePassword;
}

export async function updateOwnerPassword(newPassword: string): Promise<void> {
  assertOwnerAuthenticated('changing the owner password');
  const clean = newPassword.trim();
  if (clean.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  await dbSet<OwnerAuthConfig>('settings/ownerAuth', {
    password: clean,
    updatedAt: Date.now(),
  });
}

export async function authenticateRider(
  riderIdInput: string,
  passwordInput: string
): Promise<
  | { ok: true; rider: RiderRecord }
  | { ok: false; error: string }
> {
  const normalizedId = sanitizeFirebaseKey(riderIdInput).toUpperCase();
  if (!normalizedId) {
    return { ok: false, error: 'Enter your Unique Rider ID (e.g. DD001).' };
  }
  if (!passwordInput) {
    return { ok: false, error: 'Enter your Rider Password.' };
  }

  const rider = await dbGet<RiderRecord>(`riders/${normalizedId}`);
  if (!rider) {
    return {
      ok: false,
      error: `Rider ID "${normalizedId}" was not found. Check with the DailyDrop owner.`,
    };
  }
  if (rider.isActive === false) {
    return {
      ok: false,
      error: 'This Rider account is currently blocked or deactivated. Contact the owner.',
    };
  }
  if (rider.password !== passwordInput) {
    return {
      ok: false,
      error: 'Incorrect password. Please try again.',
    };
  }

  return { ok: true, rider: { ...rider, id: normalizedId } };
}

/**
 * Permanently deletes all DELIVERED and REJECTED orders (including customer
 * details, delivery locations, and payment screenshots) from /orders and wipes
 * inactive customer personal records from /customers, while keeping /products,
 * /riders, /settings, and active orders untouched.
 */
export async function clearCompletedOrdersAndCustomerData(
  orders: Order[],
  customers: CustomerRecord[]
): Promise<{
  deletedOrders: number;
  deletedCustomers: number;
  archiveId: string | null;
}> {
  assertOwnerAuthenticated('clearing completed orders and customer data');
  const completedOrders = getCompletedOrdersForCleanup(orders);
  const inactiveMobiles = getInactiveCustomerMobilesForCleanup(
    orders,
    customers.map((c) => c.mobile)
  );

  let archiveId: string | null = null;
  if (completedOrders.length > 0) {
    const archive = buildWeeklyArchiveRecord(
      completedOrders,
      'owner_manual_weekly'
    );
    archiveId = archive.id;
    await dbSet(`archives/weeklySummaries/${sanitizeFirebaseKey(archive.id)}`, archive);
  }

  const tasks: Promise<void>[] = [];

  for (const order of completedOrders) {
    const safeId = sanitizeFirebaseKey(order.id);
    if (safeId) {
      tasks.push(dbDelete(`orders/${safeId}`));
    }
  }

  for (const mobile of inactiveMobiles) {
    const safeMobile = sanitizeFirebaseKey(mobile);
    if (safeMobile) {
      tasks.push(dbDelete(`customers/${safeMobile}`));
    }
  }

  await Promise.all(tasks);

  return {
    deletedOrders: completedOrders.length,
    deletedCustomers: inactiveMobiles.length,
    archiveId,
  };
}

/**
 * Owner-only operation: archives and deletes completed (delivered/rejected) orders
 * for a single Rider while preserving financial backups and never touching active orders.
 */
export async function clearRiderCompletedHistory(
  orders: Order[],
  riderId: string
): Promise<{ deletedOrders: number; archiveId: string | null }> {
  assertOwnerAuthenticated('clearing rider order history');
  const completed = getRiderCompletedOrders(orders, riderId);
  if (completed.length === 0) {
    return { deletedOrders: 0, archiveId: null };
  }

  const archive = buildWeeklyArchiveRecord(
    completed,
    'owner_manual_rider',
    Date.now(),
    riderId
  );
  await dbSet(`archives/weeklySummaries/${sanitizeFirebaseKey(archive.id)}`, archive);

  await Promise.all(
    completed.map((order) => {
      const safeId = sanitizeFirebaseKey(order.id);
      return safeId ? dbDelete(`orders/${safeId}`) : Promise.resolve();
    })
  );

  return {
    deletedOrders: completed.length,
    archiveId: archive.id,
  };
}

/**
 * Automatic 7-day weekly history maintenance (Owner-triggered on session load):
 * Archives completed orders older than 7 days to /archives/weeklySummaries and
 * removes their personal customer data from /orders without ever touching active orders.
 */
export async function runAutoWeeklyArchiveIfNeeded(
  orders: Order[],
  customers: CustomerRecord[]
): Promise<{ archivedOrders: number; cleanedCustomers: number; archiveId: string | null }> {
  assertOwnerAuthenticated('running weekly archive cleanup');
  const eligible = selectOrdersEligibleForAutoArchive(orders);
  if (eligible.length === 0) {
    return { archivedOrders: 0, cleanedCustomers: 0, archiveId: null };
  }

  const archive = buildWeeklyArchiveRecord(eligible, 'auto_7_day');
  await dbSet(`archives/weeklySummaries/${sanitizeFirebaseKey(archive.id)}`, archive);

  const eligibleIds = new Set(eligible.map((o) => o.id));
  const remainingOrders = orders.filter((o) => !eligibleIds.has(o.id));
  const remainingMobiles = new Set(
    remainingOrders.map((o) => o.customerMobile.replace(/\D/g, ''))
  );
  const removableCustomers = customers
    .map((c) => c.mobile)
    .filter((m) => {
      const digits = m.replace(/\D/g, '');
      return Boolean(digits) && !remainingMobiles.has(digits);
    });

  const tasks: Promise<void>[] = [];
  for (const order of eligible) {
    const safeId = sanitizeFirebaseKey(order.id);
    if (safeId) tasks.push(dbDelete(`orders/${safeId}`));
  }
  for (const mobile of removableCustomers) {
    const safeMobile = sanitizeFirebaseKey(mobile);
    if (safeMobile) tasks.push(dbDelete(`customers/${safeMobile}`));
  }
  await Promise.all(tasks);

  return {
    archivedOrders: eligible.length,
    cleanedCustomers: removableCustomers.length,
    archiveId: archive.id,
  };
}

