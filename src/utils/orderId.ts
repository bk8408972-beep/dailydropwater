import type { Order } from '../types';

/**
 * Firebase Realtime Database path for the strictly sequential atomic order counter.
 * Stored under /settings/lastOrderNumber (permitted by live RTDB rules, isolated from
 * /storeSettings so order increments do not trigger storeSettings listener churn).
 */
export const ORDER_COUNTER_FIREBASE_PATH = 'settings/lastOrderNumber';

const SEQUENTIAL_ORDER_ID_RE = /^#([1-9]\d*)$/;
const LEGACY_ORDER_ID_RE = /^DD-[A-Za-z0-9_-]{4,24}$/;
const STORAGE_ORDER_KEY_RE = /^order_([1-9]\d*)$/;

/**
 * Safely parses a raw Firebase counter value into a non-negative integer.
 * Returns 0 when the counter is unset/null/invalid so the very first order gets #1.
 */
export function parseLastOrderNumber(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim());
    if (Number.isSafeInteger(parsed) && parsed >= 1) {
      return parsed;
    }
  }
  return 0;
}

/**
 * Computes the next strictly sequential order number (1, 2, 3, ..., 1000, 10000, ...).
 * Has no artificial upper limit (supports up to Number.MAX_SAFE_INTEGER).
 */
export function computeNextOrderNumber(current: unknown): number {
  return parseLastOrderNumber(current) + 1;
}

/**
 * Formats a positive integer sequence number into its user-facing sequential Order ID:
 * 1 -> "#1", 2 -> "#2", 1000 -> "#1000", 10000 -> "#10000".
 */
export function formatSequentialOrderId(orderNumber: number): string {
  const clean = parseLastOrderNumber(orderNumber);
  if (clean < 1) {
    throw new Error('Order number must be a positive integer (>= 1).');
  }
  return `#${clean}`;
}

/**
 * Extracts the positive integer sequence number from "#1", "1", or "order_1".
 * Returns null for non-sequential/legacy IDs.
 */
export function parseSequentialOrderNumber(orderId: string | null | undefined): number | null {
  if (typeof orderId !== 'string') return null;
  const trimmed = orderId.trim();
  const hashMatch = SEQUENTIAL_ORDER_ID_RE.exec(trimmed);
  if (hashMatch) {
    const num = Number(hashMatch[1]);
    return Number.isSafeInteger(num) && num >= 1 ? num : null;
  }
  if (/^[1-9]\d*$/.test(trimmed)) {
    const num = Number(trimmed);
    return Number.isSafeInteger(num) && num >= 1 ? num : null;
  }
  const keyMatch = STORAGE_ORDER_KEY_RE.exec(trimmed);
  if (keyMatch) {
    const num = Number(keyMatch[1]);
    return Number.isSafeInteger(num) && num >= 1 ? num : null;
  }
  return null;
}

/**
 * Validates both new sequential Order IDs (#1, #2, ..., #10000+) and
 * pre-existing legacy Order IDs (DD-...).
 */
export function isValidOrderId(orderId: string | null | undefined): boolean {
  if (typeof orderId !== 'string') return false;
  const trimmed = orderId.trim();
  return SEQUENTIAL_ORDER_ID_RE.test(trimmed) || LEGACY_ORDER_ID_RE.test(trimmed);
}

/**
 * Maps an Order ID to a safe Firebase RTDB child key under /orders/{key}.
 * - Sequential IDs ("#1", "1", "order_1") -> "order_1"
 *   (avoids illegal "#" in RTDB paths AND prevents RTDB integer-key array coercion!)
 * - Legacy IDs ("DD-500739386") -> "DD-500739386"
 */
export function getOrderFirebaseKey(orderId: string): string {
  const seq = parseSequentialOrderNumber(orderId);
  if (seq !== null) {
    return `order_${seq}`;
  }
  return orderId.trim().replace(/[.#$[\]/\\]/g, '');
}

/**
 * Returns the canonical user-facing Order ID string ("#1", "#2", ..., or legacy "DD-...").
 */
export function formatDisplayOrderId(
  orderOrId: Pick<Order, 'id' | 'orderNumber'> | string | null | undefined
): string {
  if (!orderOrId) return '';
  if (typeof orderOrId === 'string') {
    const seq = parseSequentialOrderNumber(orderOrId);
    return seq !== null ? `#${seq}` : orderOrId.trim();
  }
  if (typeof orderOrId.orderNumber === 'number' && orderOrId.orderNumber >= 1) {
    return `#${Math.floor(orderOrId.orderNumber)}`;
  }
  const seq = parseSequentialOrderNumber(orderOrId.id);
  return seq !== null ? `#${seq}` : (orderOrId.id || '').trim();
}

/**
 * Normalizes a Firebase /orders snapshot (object or array) into a clean Order[]
 * sorted newest-first, safely skipping null entries and preserving sequential #N IDs.
 */
export function normalizeOrdersCollection(raw: unknown): Order[] {
  if (!raw || typeof raw !== 'object') return [];
  const list: Order[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, Order | null>)) {
    if (!value || typeof value !== 'object') continue;
    const displayId = formatDisplayOrderId(value.id || key);
    const parsedNum =
      typeof value.orderNumber === 'number' && value.orderNumber >= 1
        ? Math.floor(value.orderNumber)
        : parseSequentialOrderNumber(displayId);
    list.push({
      ...value,
      id: displayId || key,
      ...(parsedNum !== null ? { orderNumber: parsedNum } : {}),
    });
  }
  return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/**
 * Matches customer tracking queries against either 10-digit mobile numbers or Order IDs
 * including sequential IDs ("#1", "1", "order #1", "#1000") and legacy "DD-..." IDs.
 */
export function matchesCustomerOrderSearch(order: Order, rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return false;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 10 && !/[a-zA-Z#]/.test(trimmed)) {
    return (order.customerMobile || '').replace(/\D/g, '') === digitsOnly;
  }

  // Exact sequential number match ("#1", "1", "Order #1", "#1000")
  const seqQueryMatch = /^(?:order\s*)?#?([1-9]\d*)$/i.exec(trimmed);
  if (seqQueryMatch) {
    const queryNum = Number(seqQueryMatch[1]);
    const orderNum =
      typeof order.orderNumber === 'number' && order.orderNumber >= 1
        ? Math.floor(order.orderNumber)
        : parseSequentialOrderNumber(order.id);
    if (orderNum !== null && orderNum === queryNum) {
      return true;
    }
  }

  // Fallback substring match for legacy DD-... IDs or multi-character queries
  if (trimmed.length >= 2) {
    const upper = trimmed.toUpperCase();
    return formatDisplayOrderId(order).toUpperCase().includes(upper);
  }

  return false;
}

/**
 * Returns whether the customer's My Orders tracking input is ready to search.
 * Accepts 10-digit phone numbers, any sequential order ID ("#1", "1", "#1000"), or legacy IDs.
 */
export function isValidCustomerTrackQuery(rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 10 && !/[a-zA-Z#]/.test(trimmed)) return true;
  if (/^(?:order\s*)?#?[1-9]\d*$/i.test(trimmed)) return true;
  return trimmed.length >= 4;
}

export interface AtomicCounterReadResult {
  value: unknown;
  etag: string | null;
}

export interface AtomicCounterWriteResult {
  ok: boolean;
  conflict: boolean;
  latestValue?: unknown;
  latestEtag?: string | null;
  status?: number;
}

export interface AtomicCounterAdapter {
  readWithEtag: () => Promise<AtomicCounterReadResult>;
  writeIfMatch: (nextValue: number, etag: string | null) => Promise<AtomicCounterWriteResult>;
}

/**
 * Executes a compare-and-swap (CAS) atomic increment loop using Firebase RTDB ETags.
 * On HTTP 412 Precondition Failed (concurrent order placed at the same millisecond),
 * automatically retries with the latest server value + ETag until commit succeeds.
 */
export async function runAtomicCounterIncrement(
  adapter: AtomicCounterAdapter,
  maxAttempts: number = 12
): Promise<number> {
  let { value, etag } = await adapter.readWithEtag();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nextNumber = computeNextOrderNumber(value);
    const writeRes = await adapter.writeIfMatch(nextNumber, etag);

    if (writeRes.ok) {
      return nextNumber;
    }

    if (writeRes.conflict) {
      if (writeRes.latestEtag !== undefined) {
        value = writeRes.latestValue;
        etag = writeRes.latestEtag;
      } else {
        const refreshed = await adapter.readWithEtag();
        value = refreshed.value;
        etag = refreshed.etag;
      }
      continue;
    }

    throw new Error(
      `Atomic order counter increment failed${writeRes.status ? ` (HTTP ${writeRes.status})` : ''}.`
    );
  }

  throw new Error('Could not allocate sequential order number due to high concurrency. Please try again.');
}
