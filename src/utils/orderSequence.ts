import type { DailyOrderCounterState, Order } from '../types';

// IST is permanently UTC+05:30 (no daylight saving time)
export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/**
 * Returns the exact calendar date string (YYYY-MM-DD) in Indian Standard Time (IST).
 * Midnight reset occurs cleanly at 00:00:00 IST (18:30:00 UTC the previous day).
 */
export function getIstDateString(nowMs: number = Date.now()): string {
  const safeMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const ist = new Date(safeMs + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Computes the next atomic daily order counter state in IST.
 * - On the very first order or on any new IST calendar day (after 12:00 AM midnight IST),
 *   resets count cleanly to 1.
 * - On the same IST calendar day, increments sequentially (1, 2, 3, ..., 500, 501, ...).
 */
export function computeNextDailyOrderCounter(
  current: Partial<DailyOrderCounterState> | null | undefined,
  nowMs: number = Date.now()
): DailyOrderCounterState {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const todayIst = getIstDateString(safeNow);

  const currentDate =
    typeof current?.date === 'string' ? current.date.trim() : '';
  const currentCount =
    typeof current?.count === 'number' &&
    Number.isInteger(current.count) &&
    current.count >= 0
      ? current.count
      : 0;

  if (currentDate !== todayIst) {
    return {
      date: todayIst,
      count: 1,
      updatedAt: safeNow,
    };
  }

  return {
    date: todayIst,
    count: currentCount + 1,
    updatedAt: safeNow,
  };
}

/**
 * Builds a collision-free Firebase RTDB node key for a daily sequential order
 * (e.g. DD-20261128-1) so midnight counter resets to 1 NEVER overwrite previous days'
 * order history in /orders while keeping the display number strictly plain (1, 2, 3...).
 */
export function buildDailyOrderKey(
  orderDateIst: string,
  orderNumber: number
): string {
  const compactDate = orderDateIst.replace(/[^0-9]/g, '').slice(0, 8) || '00000000';
  const cleanNum = Math.max(1, Math.floor(orderNumber));
  return `DD-${compactDate}-${cleanNum}`;
}

/**
 * Resolves the plain sequential display number for an order (e.g. "1", "2", "500")
 * with zero "T" or "#" prefix. Falls back gracefully for legacy orders.
 */
export function getOrderDisplayNumber(
  order: Pick<Order, 'id' | 'orderNumber'>
): string {
  if (
    typeof order.orderNumber === 'number' &&
    Number.isInteger(order.orderNumber) &&
    order.orderNumber > 0
  ) {
    return String(order.orderNumber);
  }

  const rawId = typeof order.id === 'string' ? order.id.trim() : '';
  const dailyMatch = rawId.match(/^DD-\d{8}-(\d+)$/i);
  if (dailyMatch) {
    return String(Number.parseInt(dailyMatch[1], 10));
  }
  if (/^\d+$/.test(rawId)) {
    return String(Number.parseInt(rawId, 10));
  }
  return rawId || '1';
}

/**
 * Formats the exact customer/rider/owner display string: "Order ID: 1", "Order ID: 2", etc.
 */
export function formatOrderIdLabel(
  order: Pick<Order, 'id' | 'orderNumber'>
): string {
  return `Order ID: ${getOrderDisplayNumber(order)}`;
}

/**
 * Parses a plain numeric order search query (supports "1", "#1", "Order ID: 1", "order 42").
 */
export function extractNumericOrderLookup(rawQuery: string): string | null {
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(?:order\s*(?:id)?\s*:?\s*)?#?\s*(\d{1,7})$/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return String(parsed);
}

/**
 * Validates whether a customer's "My Orders" lookup input is a 10-digit mobile number,
 * a plain daily Order ID (e.g. "1", "25", "Order ID: 3"), or a legacy Order key ("DD-...").
 */
export function isValidOrderLookupQuery(rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 10 && !/[a-zA-Z]/.test(trimmed)) {
    return true;
  }
  if (extractNumericOrderLookup(trimmed) !== null) {
    return true;
  }
  return trimmed.length >= 4;
}

/**
 * Matches an order against a customer's lookup input (10-digit mobile, daily Order ID number, or legacy key).
 */
export function matchesOrderLookupQuery(
  order: Pick<Order, 'id' | 'orderNumber' | 'customerMobile'>,
  rawQuery: string
): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return false;

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length === 10 && !/[a-zA-Z]/.test(trimmed)) {
    return order.customerMobile.replace(/\D/g, '') === digitsOnly;
  }

  const numericLookup = extractNumericOrderLookup(trimmed);
  if (numericLookup !== null) {
    return getOrderDisplayNumber(order) === numericLookup;
  }

  if (trimmed.length >= 4) {
    const upper = trimmed.toUpperCase();
    return (
      order.id.toUpperCase().includes(upper) ||
      formatOrderIdLabel(order).toUpperCase().includes(upper)
    );
  }

  return false;
}
