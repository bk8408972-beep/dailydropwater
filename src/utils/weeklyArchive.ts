import type {
  ArchivedTransactionSummary,
  Order,
  WeeklyArchiveRecord,
} from '../types';
import { normalizeOrderStatus } from './domain';
import { isUpiOrder } from './payment';

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Selects ONLY completed orders (delivered or rejected) that are at least 7 days old.
 * Active, pending, assigned, accepted, reached_pickup, and out_for_delivery orders
 * are NEVER eligible for cleanup.
 */
export function selectOrdersEligibleForAutoArchive(
  orders: Order[],
  nowMs: number = Date.now(),
  maxAgeMs: number = SEVEN_DAYS_MS
): Order[] {
  const cutoff = nowMs - maxAgeMs;
  return orders.filter((order) => {
    const status = normalizeOrderStatus(order.status);
    if (status !== 'delivered' && status !== 'rejected') return false;
    const completedAt = order.deliveredAt ?? order.updatedAt ?? order.createdAt;
    if (!Number.isFinite(completedAt)) return false;
    return completedAt <= cutoff;
  });
}

/**
 * Builds a privacy-safe financial & transaction backup record before removing
 * completed orders from /orders. Preserves order IDs, amounts, payment modes,
 * UTR references, rider IDs, and totals while excluding customer PII (phone/address).
 */
export function buildWeeklyArchiveRecord(
  completedOrders: Order[],
  trigger: WeeklyArchiveRecord['trigger'],
  nowMs: number = Date.now(),
  riderIdScope: string | null = null
): WeeklyArchiveRecord {
  let deliveredCount = 0;
  let rejectedCount = 0;
  let totalRevenue = 0;
  let codRevenue = 0;
  let upiRevenue = 0;

  const transactions: ArchivedTransactionSummary[] = completedOrders.map((order) => {
    const status = normalizeOrderStatus(order.status);
    const amount = Number(order.totalAmount) || 0;
    if (status === 'delivered') {
      deliveredCount += 1;
      totalRevenue += amount;
      if (isUpiOrder(order)) {
        upiRevenue += amount;
      } else {
        codRevenue += amount;
      }
    } else if (status === 'rejected') {
      rejectedCount += 1;
    }

    return {
      orderId: order.id,
      createdAt: order.createdAt,
      deliveredAt: order.deliveredAt ?? null,
      status,
      paymentMethod: String(order.paymentMethod || 'Cash on Delivery'),
      upiUtr: order.upiUtr ?? null,
      upiVerified: Boolean(order.upiVerified),
      totalAmount: amount,
      floorCharge: Number(order.floorCharge) || 0,
      assignedRiderId: order.assignedRiderId ?? null,
      assignedRiderName: order.assignedRiderName ?? null,
    };
  });

  const id = `ARC-${nowMs}-${Math.floor(100 + Math.random() * 900)}`;

  return {
    id,
    archivedAt: nowMs,
    trigger,
    riderIdScope,
    orderCount: completedOrders.length,
    deliveredCount,
    rejectedCount,
    totalRevenue,
    codRevenue,
    upiRevenue,
    transactions,
  };
}
