import type {
  CustomerRecord,
  Order,
  OwnerAuthConfig,
  Product,
  RiderRecord,
} from '../types';
import {
  DEFAULT_PRODUCTS,
  getCompletedOrdersForCleanup,
  getInactiveCustomerMobilesForCleanup,
} from '../utils/domain';

export const FIREBASE_DB_URL =
  'https://dailydrop-water-default-rtdb.asia-southeast1.firebasedatabase.app';

export const DEFAULT_OWNER_PASSWORD = [
  'Babar',
  'AZEEM',
  '7864',
].join('');

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
  return (await res.json()) as T;
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
  return (await res.json()) as T;
}

export async function dbDelete(path: string): Promise<void> {
  const res = await fetch(buildUrl(path), {
    method: 'DELETE',
  });
  if (!res.ok) {
    throw new Error(`Database delete failed (${res.status}) for /${path}`);
  }
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

/**
 * Subscribes live to a Firebase Realtime Database path using native SSE streaming
 * (EventSource) with resilient periodic fallback polling if SSE disconnects.
 */
export function subscribePath<T>(
  path: string,
  onData: (value: T | null) => void,
  onError?: (err: Error) => void
): () => void {
  let closed = false;
  let state: unknown = null;
  let eventSource: EventSource | null = null;
  let pollTimer: number | null = null;

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

  const startFallbackPolling = () => {
    if (pollTimer !== null || closed) return;
    pollTimer = window.setInterval(() => {
      void fetchSnapshot();
    }, 4500);
  };

  const stopFallbackPolling = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  // Immediate initial read so first paint is instant even before SSE handshake completes
  void fetchSnapshot();

  if (typeof window !== 'undefined' && 'EventSource' in window) {
    try {
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
      startFallbackPolling();
    }
  } else {
    startFallbackPolling();
  }

  return () => {
    closed = true;
    stopFallbackPolling();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };
}

let seedingPromise: Promise<Record<string, Product>> | null = null;

/**
 * Ensures /products has the 7 default Tolichowki water & cold drinks products
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

export async function placeCustomerOrder(
  order: Order,
  existingCustomer?: CustomerRecord | null
): Promise<void> {
  const safeOrderId = sanitizeFirebaseKey(order.id);
  const safeMobile = sanitizeFirebaseKey(order.customerMobile);

  const customerRecord: CustomerRecord = {
    mobile: safeMobile,
    name: order.customerName.trim(),
    lastAddress: order.address.trim(),
    totalOrders: (existingCustomer?.totalOrders ?? 0) + 1,
    lastOrderAt: order.createdAt,
  };

  await Promise.all([
    dbSet(`orders/${safeOrderId}`, order),
    dbSet(`customers/${safeMobile}`, customerRecord),
  ]);
}

export async function verifyOwnerPassword(inputPassword: string): Promise<boolean> {
  const cleanedInput = inputPassword.trim();
  const stored = await dbGet<OwnerAuthConfig>('settings/ownerAuth');
  const activePassword = stored?.password?.trim() || DEFAULT_OWNER_PASSWORD;
  if (!stored?.password) {
    // Initialize /settings/ownerAuth in RTDB on first owner auth check
    dbSet<OwnerAuthConfig>('settings/ownerAuth', {
      password: DEFAULT_OWNER_PASSWORD,
      updatedAt: Date.now(),
    }).catch(() => {});
  }
  return cleanedInput === activePassword;
}

export async function updateOwnerPassword(newPassword: string): Promise<void> {
  await dbSet<OwnerAuthConfig>('settings/ownerAuth', {
    password: newPassword.trim(),
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
): Promise<{ deletedOrders: number; deletedCustomers: number }> {
  const completedOrders = getCompletedOrdersForCleanup(orders);
  const inactiveMobiles = getInactiveCustomerMobilesForCleanup(
    orders,
    customers.map((c) => c.mobile)
  );

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
  };
}

