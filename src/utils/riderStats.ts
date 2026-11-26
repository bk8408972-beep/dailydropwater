import type { Order } from '../types';
import { isActiveOrderStatus, normalizeOrderStatus } from './domain';
import { isCodOrder } from './payment';

export interface RiderDashboardStats {
  assignedCount: number;
  activeCount: number;
  todayDeliveredCount: number;
  totalDeliveredCount: number;
  totalCodCashCollected: number;
  todayCodCashCollected: number;
}

function isSameLocalCalendarDay(tsA: number, tsB: number): boolean {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Computes Rider performance & cash collection metrics.
 * IMPORTANT: Cash Collected counts DELIVERED COD orders ONLY (excludes UPI orders).
 */
export function computeRiderStats(
  orders: Order[],
  riderId: string,
  nowMs: number = Date.now()
): RiderDashboardStats {
  let assignedCount = 0;
  let activeCount = 0;
  let todayDeliveredCount = 0;
  let totalDeliveredCount = 0;
  let totalCodCashCollected = 0;
  let todayCodCashCollected = 0;

  for (const order of orders) {
    if (order.assignedRiderId !== riderId) continue;
    assignedCount += 1;

    const status = normalizeOrderStatus(order.status);
    if (isActiveOrderStatus(status)) {
      activeCount += 1;
      continue;
    }

    if (status === 'delivered') {
      totalDeliveredCount += 1;
      const deliveredTs = order.deliveredAt ?? order.updatedAt ?? order.createdAt;
      const isToday = isSameLocalCalendarDay(deliveredTs, nowMs);
      if (isToday) {
        todayDeliveredCount += 1;
      }

      if (isCodOrder(order)) {
        const amt = Number(order.totalAmount) || 0;
        totalCodCashCollected += amt;
        if (isToday) {
          todayCodCashCollected += amt;
        }
      }
    }
  }

  return {
    assignedCount,
    activeCount,
    todayDeliveredCount,
    totalDeliveredCount,
    totalCodCashCollected,
    todayCodCashCollected,
  };
}

/**
 * Returns completed (delivered or rejected) orders belonging to a specific rider,
 * sorted newest first. Used for Rider read-only My History and Owner Clear Rider History.
 */
export function getRiderCompletedOrders(orders: Order[], riderId: string): Order[] {
  return orders
    .filter((o) => {
      if (o.assignedRiderId !== riderId) return false;
      const status = normalizeOrderStatus(o.status);
      return status === 'delivered' || status === 'rejected';
    })
    .sort((a, b) => (b.deliveredAt ?? b.updatedAt ?? b.createdAt) - (a.deliveredAt ?? a.updatedAt ?? a.createdAt));
}
