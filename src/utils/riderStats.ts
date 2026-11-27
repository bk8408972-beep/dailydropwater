import type { Order } from '../types';
import { isActiveOrderStatus, normalizeOrderStatus } from './domain';
import { isAwaitingRiderAcceptance } from './orderTimer';
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

export const MAX_RIDER_ACTIVE_ORDERS = 5;

export interface RiderAcceptCapacity {
  allowed: boolean;
  activeAcceptedCount: number;
  remainingSlots: number;
  maxActive: number;
}

export function isAcceptedActiveDeliveryStatus(status?: string | null): boolean {
  const canonical = normalizeOrderStatus(status);
  return (
    canonical === 'accepted' ||
    canonical === 'reached_pickup' ||
    canonical === 'out_for_delivery'
  );
}

/**
 * Counts how many accepted active deliveries (accepted / reached_pickup / out_for_delivery)
 * a rider currently has in progress simultaneously.
 */
export function countRiderAcceptedActiveOrders(
  orders: Order[],
  riderId: string | null
): number {
  if (!riderId) return 0;
  let count = 0;
  for (const order of orders) {
    if (order.assignedRiderId !== riderId) continue;
    if (isAcceptedActiveDeliveryStatus(order.status)) {
      count += 1;
    }
  }
  return count;
}

/**
 * Checks whether a rider can accept another order right now (up to 5 simultaneous active orders).
 */
export function canRiderAcceptAnotherOrder(
  orders: Order[],
  riderId: string | null,
  maxActive: number = MAX_RIDER_ACTIVE_ORDERS
): RiderAcceptCapacity {
  const safeMax = Math.max(1, Math.round(maxActive));
  const activeAcceptedCount = countRiderAcceptedActiveOrders(orders, riderId);
  const remainingSlots = Math.max(0, safeMax - activeAcceptedCount);
  return {
    allowed: activeAcceptedCount < safeMax,
    activeAcceptedCount,
    remainingSlots,
    maxActive: safeMax,
  };
}

/**
 * Partitions a rider's unfinished orders into:
 * - incomingOrders: newly assigned orders awaiting acceptance (newest first)
 * - acceptedActiveOrders: accepted active deliveries (out_for_delivery -> reached_pickup -> accepted)
 */
export function partitionRiderActiveOrders(
  orders: Order[],
  riderId: string | null
): {
  incomingOrders: Order[];
  acceptedActiveOrders: Order[];
} {
  if (!riderId) {
    return { incomingOrders: [], acceptedActiveOrders: [] };
  }

  const incomingOrders: Order[] = [];
  const acceptedActiveOrders: Order[] = [];

  for (const order of orders) {
    if (order.assignedRiderId !== riderId) continue;
    if (!isActiveOrderStatus(order.status)) continue;

    if (isAwaitingRiderAcceptance(order)) {
      incomingOrders.push(order);
    } else if (isAcceptedActiveDeliveryStatus(order.status)) {
      acceptedActiveOrders.push(order);
    }
  }

  incomingOrders.sort(
    (a, b) => (b.assignedAt ?? b.createdAt ?? 0) - (a.assignedAt ?? a.createdAt ?? 0)
  );

  const stageRank = (status?: string | null): number => {
    switch (normalizeOrderStatus(status)) {
      case 'out_for_delivery':
        return 0;
      case 'reached_pickup':
        return 1;
      case 'accepted':
        return 2;
      default:
        return 3;
    }
  };

  acceptedActiveOrders.sort((a, b) => {
    const rankDiff = stageRank(a.status) - stageRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return (b.riderAcceptedAt ?? b.updatedAt ?? b.createdAt ?? 0) -
      (a.riderAcceptedAt ?? a.updatedAt ?? a.createdAt ?? 0);
  });

  return { incomingOrders, acceptedActiveOrders };
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
