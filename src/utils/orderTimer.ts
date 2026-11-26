import type { Order } from '../types';

export const RIDER_ACCEPTANCE_WINDOW_MS = 3 * 60 * 1000; // 3 minutes (180 seconds)
export const RIDER_ACCEPTANCE_WINDOW_SECONDS = 180;

export interface RiderAcceptanceCountdown {
  totalSeconds: number;
  remainingMs: number;
  remainingSeconds: number;
  progressPercent: number;
  formatted: string;
  isExpired: boolean;
  isUrgent: boolean;
}

/**
 * Formats seconds into MM:SS (e.g. 180 -> "03:00", 165 -> "02:45", 0 -> "00:00").
 */
export function formatCountdownMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Returns true if an order is currently assigned to a rider and awaiting
 * that rider's Step 1 "Accept Order" confirmation (status placed/pending/assigned).
 */
export function isAwaitingRiderAcceptance(order: Pick<Order, 'status' | 'assignedRiderId'>): boolean {
  if (!order.assignedRiderId || !order.assignedRiderId.trim()) {
    return false;
  }
  const raw = (order.status ?? '').trim().toLowerCase();
  return raw === 'placed' || raw === 'pending' || raw === 'assigned';
}

/**
 * Returns true if an order has timed out and been marked unassigned.
 */
export function isOrderTimedOutUnassigned(order: Pick<Order, 'status'>): boolean {
  return (order.status ?? '').trim().toLowerCase() === 'unassigned';
}

/**
 * Returns true if an order needs Owner attention/alerting (newly placed/pending unreviewed
 * OR timed-out unassigned waiting for Owner re-assignment).
 */
export function isOwnerAlertOrder(
  order: Pick<Order, 'status' | 'ownerApproved' | 'assignedRiderId'>
): boolean {
  const raw = (order.status ?? '').trim().toLowerCase();
  if (raw === 'unassigned') return true;
  if ((raw === 'placed' || raw === 'pending') && !order.ownerApproved && !order.assignedRiderId) {
    return true;
  }
  return false;
}

/**
 * Resolves the timestamp when the 3-minute rider acceptance window started.
 */
export function getAssignmentStartTime(
  order: Pick<Order, 'assignedAt' | 'updatedAt' | 'createdAt'>
): number {
  if (typeof order.assignedAt === 'number' && Number.isFinite(order.assignedAt) && order.assignedAt > 0) {
    return order.assignedAt;
  }
  if (typeof order.updatedAt === 'number' && Number.isFinite(order.updatedAt) && order.updatedAt > 0) {
    return order.updatedAt;
  }
  return typeof order.createdAt === 'number' && Number.isFinite(order.createdAt)
    ? order.createdAt
    : Date.now();
}

/**
 * Computes live 3-minute countdown metrics for an assigned order awaiting rider acceptance.
 */
export function getRiderAcceptanceCountdown(
  order: Pick<Order, 'assignedAt' | 'updatedAt' | 'createdAt'>,
  nowMs: number = Date.now(),
  windowMs: number = RIDER_ACCEPTANCE_WINDOW_MS
): RiderAcceptanceCountdown {
  const startMs = getAssignmentStartTime(order);
  const elapsedMs = Math.max(0, nowMs - startMs);
  const remainingMs = Math.max(0, windowMs - elapsedMs);
  const totalSeconds = Math.max(1, Math.round(windowMs / 1000));
  const remainingSeconds = Math.min(totalSeconds, Math.ceil(remainingMs / 1000));
  const progressPercent = Math.max(
    0,
    Math.min(100, Number(((remainingMs / windowMs) * 100).toFixed(2)))
  );

  return {
    totalSeconds,
    remainingMs,
    remainingSeconds,
    progressPercent,
    formatted: formatCountdownMMSS(remainingSeconds),
    isExpired: remainingMs <= 0,
    isUrgent: remainingSeconds <= 45,
  };
}

/**
 * Returns true when an awaiting-rider-acceptance order has crossed the 3-minute limit
 * and should be automatically marked status: "unassigned".
 */
export function shouldAutoUnassignOrder(
  order: Pick<Order, 'status' | 'assignedRiderId' | 'assignedAt' | 'updatedAt' | 'createdAt'>,
  nowMs: number = Date.now(),
  windowMs: number = RIDER_ACCEPTANCE_WINDOW_MS
): boolean {
  if (!isAwaitingRiderAcceptance(order)) return false;
  return getRiderAcceptanceCountdown(order, nowMs, windowMs).isExpired;
}

export type BackNavDecision =
  | 'close_overlay'
  | 'return_home'
  | 'warn_press_again'
  | 'allow_exit';

export interface BackNavInput {
  hasOpenOverlay: boolean;
  isOnSubView: boolean;
  lastBackPressAt: number | null;
  nowMs: number;
  exitWindowMs?: number;
}

export function resolveBackNavigationAction(input: BackNavInput): BackNavDecision {
  if (input.hasOpenOverlay) {
    return 'close_overlay';
  }
  if (input.isOnSubView) {
    return 'return_home';
  }
  const windowMs = input.exitWindowMs ?? 2500;
  if (
    typeof input.lastBackPressAt === 'number' &&
    input.nowMs - input.lastBackPressAt <= windowMs
  ) {
    return 'allow_exit';
  }
  return 'warn_press_again';
}
