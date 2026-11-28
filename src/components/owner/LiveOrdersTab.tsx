import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Building2,
  Camera,
  Check,
  Clock,
  Copy,
  MapPin,
  Navigation,
  Phone,
  RefreshCw,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type { BulkBookingRequest, Order, RiderRecord } from '../../types';
import {
  ownerDeleteOrder,
  ownerPatchOrder,
} from '../../services/firebaseDb';
import {
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isActiveOrderStatus,
  isSafeImageDataUrl,
  normalizeOrderStatus,
  resolveOrderCustomerCoords,
} from '../../utils/domain';
import {
  getRiderAcceptanceCountdown,
  isAwaitingRiderAcceptance,
  isOrderTimedOutUnassigned,
  shouldAutoUnassignOrder,
} from '../../utils/orderTimer';
import { formatOrderIdLabel } from '../../utils/orderSequence';
import {
  buildPhoneCallUrl,
  copyPhoneNumber,
  formatDisplayPhone10,
} from '../../utils/androidIntents';
import { formatFloorLiftSummary } from '../../utils/storeSettings';
import { getOrderPaymentBadge, isUpiOrder } from '../../utils/payment';
import type { MapModalTarget } from '../InAppMapModal';
import { BulkBookingsSection } from './BulkBookingsSection';

const OWNER_STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'reached_pickup', label: 'Plant' },
  { key: 'out_for_delivery', label: 'Out' },
  { key: 'delivered', label: 'Delivered' },
] as const;

interface LiveOrdersTabProps {
  orders: Order[];
  bulkBookings?: BulkBookingRequest[];
  riders: RiderRecord[];
  completedCleanupCount: number;
  onOpenWeeklyCleanup: () => void;
  onOpenMapModal: (target: MapModalTarget) => void;
  onNotify: (msg: string) => void;
}

export function LiveOrdersTab({
  orders,
  bulkBookings = [],
  riders,
  completedCleanupCount,
  onOpenWeeklyCleanup,
  onOpenMapModal,
  onNotify,
}: LiveOrdersTabProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');
  const [zoomPhoto, setZoomPhoto] = useState<{
    orderId: string;
    customerName: string;
    src: string;
    deliveredAt?: number | null;
  } | null>(null);
  const [reassignDraftByOrder, setReassignDraftByOrder] = useState<
    Record<string, string>
  >({});
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const ownerTimeoutHandledRef = useRef<Set<string>>(new Set());

  const onlineRiders = riders.filter((r) => r.isActive && r.isOnline);
  const hasAwaitingOrders = orders.some((o) => isAwaitingRiderAcceptance(o));

  // Tick every second for live "Waiting for Rider: MM:SS" countdown
  useEffect(() => {
    if (!hasAwaitingOrders) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasAwaitingOrders]);

  // Safety fallback: if a rider's phone is offline when 3-minute countdown expires, auto-mark unassigned
  useEffect(() => {
    if (!hasAwaitingOrders) return;
    for (const order of orders) {
      if (!shouldAutoUnassignOrder(order, nowMs)) continue;
      const key = `${order.id}:${order.assignedAt ?? order.updatedAt ?? order.createdAt}`;
      if (ownerTimeoutHandledRef.current.has(key)) continue;
      ownerTimeoutHandledRef.current.add(key);

      const now = Date.now();
      void ownerPatchOrder(order.id, {
        status: 'unassigned',
        assignedRiderId: null,
        assignedRiderName: null,
        assignedRiderPhone: null,
        assignedRiderMobile: null,
        assignedAt: null,
        timedOutAt: now,
        lastTimedOutRiderId: order.assignedRiderId ?? null,
        lastTimedOutRiderName: order.assignedRiderName ?? null,
      })
        .then(() => {
          onNotify(
            `Rider ${order.assignedRiderName || order.assignedRiderId || ''} did not accept ${formatOrderIdLabel(order)} within 3 minutes. Please Re-Assign to Another Rider.`
          );
        })
        .catch(() => {
          ownerTimeoutHandledRef.current.delete(key);
        });
    }
  }, [orders, nowMs, hasAwaitingOrders, onNotify]);

  const displayedOrders =
    statusFilter === 'active'
      ? orders.filter((o) => isActiveOrderStatus(o.status))
      : orders;

  const updateOrder = async (
    orderId: string,
    patch: Record<string, unknown>,
    message: string
  ) => {
    setBusyId(orderId);
    try {
      await ownerPatchOrder(orderId, patch);
      onNotify(message);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update order.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignRider = async (
    order: Order,
    riderId: string,
    isReassign: boolean = false
  ) => {
    const orderLabel = formatOrderIdLabel(order);
    if (!riderId) {
      await updateOrder(
        order.id,
        {
          status: 'unassigned',
          assignedRiderId: null,
          assignedRiderName: null,
          assignedRiderPhone: null,
          assignedRiderMobile: null,
          assignedAt: null,
        },
        `Unassigned rider from ${orderLabel}.`
      );
      return;
    }

    const chosen = riders.find((r) => r.id === riderId);
    if (!chosen) return;

    const now = Date.now();
    const currentStatus = normalizeOrderStatus(order.status);
    // Reset to 'assigned' with fresh assignedAt whenever assigning/re-assigning a pending/assigned/unassigned order
    const nextStatus =
      currentStatus === 'pending' ||
      currentStatus === 'assigned' ||
      currentStatus === 'unassigned' ||
      isReassign
        ? 'assigned'
        : currentStatus;

    await updateOrder(
      order.id,
      {
        status: nextStatus,
        ownerApproved: true,
        assignedRiderId: chosen.id,
        assignedRiderName: chosen.name,
        assignedRiderPhone: chosen.mobile,
        assignedRiderMobile: chosen.mobile,
        assignedAt: now,
        timedOutAt: null,
      },
      isReassign
        ? `Re-assigned ${orderLabel} to ${chosen.name} (${chosen.id}). 3-minute acceptance timer reset and new rider alerted.`
        : `Assigned ${chosen.name} (${chosen.id}) to ${orderLabel}. 3-minute acceptance timer started.`
    );

    setReassignDraftByOrder((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });
  };

  const handleDeleteOrder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      await ownerDeleteOrder(orderId);
      setConfirmDeleteId(null);
      onNotify(`Deleted order ${orderId}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to delete order.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-label="Live Orders" className="space-y-4">
      <BulkBookingsSection bookings={bulkBookings} onNotify={onNotify} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-slate-900">
            Live Orders Feed
          </h2>
          <p className="text-xs text-slate-500">
            {onlineRiders.length} Duty-ON{' '}
            {onlineRiders.length === 1 ? 'rider' : 'riders'} ready for dispatch
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenWeeklyCleanup}
            className="min-h-[40px] px-3.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-800 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              Clear Completed Orders &amp; Customer Data (Weekly Cleanup)
              {completedCleanupCount > 0 ? ` · ${completedCleanupCount}` : ''}
            </span>
          </button>

          <div className="flex items-center gap-1 bg-slate-200/70 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                statusFilter === 'active'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              Active ({orders.filter((o) => isActiveOrderStatus(o.status)).length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                statusFilter === 'all'
                  ? 'bg-white text-blue-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              All ({orders.length})
            </button>
          </div>
        </div>
      </div>

      {displayedOrders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <p className="font-semibold text-slate-900">
            No {statusFilter === 'active' ? 'active' : ''} orders right now.
          </p>
          <p className="text-sm text-slate-500 mt-1">
            New customer orders will ring automatically and appear at the top.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {displayedOrders.map((order) => {
            const busy = busyId === order.id;
            const canonicalStatus = normalizeOrderStatus(order.status);
            const trackerKey =
              canonicalStatus === 'assigned' || canonicalStatus === 'unassigned'
                ? 'pending'
                : canonicalStatus;
            const stepIdx = OWNER_STEPS.findIndex((s) => s.key === trackerKey);
            const awaitingRider = isAwaitingRiderAcceptance(order);
            const timedOutUnassigned = isOrderTimedOutUnassigned(order);
            const riderTimer = awaitingRider
              ? getRiderAcceptanceCountdown(order, nowMs)
              : null;
            const isOverdueHighlight =
              timedOutUnassigned || Boolean(riderTimer?.isExpired);
            const needsOwnerReview =
              canonicalStatus === 'pending' &&
              !order.ownerApproved &&
              !order.assignedRiderId;
            const hasDeliveryPhoto = isSafeImageDataUrl(order.deliveryPhoto);
            const reassignChoice =
              reassignDraftByOrder[order.id] ??
              onlineRiders.find((r) => r.id !== order.assignedRiderId && r.id !== order.lastTimedOutRiderId)?.id ??
              onlineRiders[0]?.id ??
              '';

            return (
              <article
                key={order.id}
                data-testid={`owner-order-${order.id}`}
                className={`bg-white rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
                  isOverdueHighlight
                    ? 'border-red-500 ring-2 ring-red-100'
                    : needsOwnerReview
                      ? 'border-blue-500 ring-2 ring-blue-100'
                      : 'border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500 tabular-nums">
                        <span
                          data-testid={`owner-order-id-${order.id}`}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-900 font-display font-extrabold text-xs sm:text-sm"
                        >
                          {formatOrderIdLabel(order)}
                        </span>
                        <span>
                          · {formatTimestamp(order.createdAt)} ·{' '}
                          {order.serviceMode === 'events'
                            ? 'Events Supply'
                            : 'Fast 15–20m'}
                        </span>
                      </div>
                      <h3 className="font-display text-lg font-bold text-slate-900 mt-1">
                        {order.customerName}
                      </h3>
                      <p
                        className={`text-xs font-bold mt-0.5 ${
                          isOverdueHighlight
                            ? 'text-red-700'
                            : canonicalStatus === 'pending' || canonicalStatus === 'assigned'
                              ? 'text-blue-700'
                              : canonicalStatus === 'delivered'
                                ? 'text-emerald-700'
                                : canonicalStatus === 'rejected'
                                  ? 'text-red-600'
                                  : 'text-cyan-700'
                        }`}
                      >
                        {getStatusLabel(order.status)}
                        {awaitingRider && order.assignedRiderName
                          ? ` · ${order.assignedRiderName}`
                          : canonicalStatus === 'pending' && order.ownerApproved
                            ? ' · Owner Confirmed (Assign Rider)'
                            : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                        {formatRupees(order.totalAmount)}
                      </div>
                      {(() => {
                        const badge = getOrderPaymentBadge(order);
                        return (
                          <div
                            className={`text-[11px] font-bold ${
                              badge.kind === 'upi_pending'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                            }`}
                          >
                            {badge.shortLabel}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Compact 5-Step Live Status Bar */}
                  {canonicalStatus !== 'rejected' && (
                    <div className="py-2.5 border-b border-slate-100">
                      <div className="grid grid-cols-5 gap-1">
                        {OWNER_STEPS.map((step, idx) => {
                          const done = stepIdx >= idx;
                          return (
                            <div key={step.key} className="text-center">
                              <div
                                className={`h-1.5 rounded-full mb-1 ${
                                  done ? 'bg-blue-700' : 'bg-slate-200'
                                }`}
                              />
                              <span
                                className={`text-[10px] font-semibold block ${
                                  done ? 'text-blue-900' : 'text-slate-400'
                                }`}
                              >
                                {step.label}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="py-3 space-y-2 text-sm text-slate-700">
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="w-4 h-4 text-blue-700 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{order.address}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <a
                        href={buildPhoneCallUrl(order.customerMobile)}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 font-bold text-blue-800 tabular-nums transition-colors"
                      >
                        <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Call {formatDisplayPhone10(order.customerMobile)}</span>
                      </a>

                      <button
                        type="button"
                        onClick={() =>
                          void copyPhoneNumber(order.customerMobile, onNotify)
                        }
                        aria-label={`Copy phone number ${formatDisplayPhone10(order.customerMobile)}`}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold text-slate-800 cursor-pointer transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                        <span>Copy Number</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const coords = resolveOrderCustomerCoords(order);
                          onOpenMapModal({
                            title: 'Customer Delivery Location',
                            subtitle: `${order.id} · ${order.customerName}`,
                            address: order.address,
                            lat: coords?.lat ?? null,
                            lng: coords?.lng ?? null,
                          });
                        }}
                        aria-label={`View map for order ${order.id}`}
                        className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 py-1.5 rounded-lg bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 font-bold text-cyan-950 cursor-pointer transition-colors"
                      >
                        <Navigation className="w-3.5 h-3.5 text-cyan-700" aria-hidden="true" />
                        <span>Map</span>
                      </button>

                      {(() => {
                        const badge = getOrderPaymentBadge(order);
                        return (
                          <span
                            data-testid={`owner-payment-badge-${order.id}`}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-extrabold text-xs border ${
                              badge.kind === 'upi_pending'
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                            }`}
                          >
                            <Banknote className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>{badge.label}</span>
                          </span>
                        );
                      })()}

                      {order.gpsStatus === 'address_only' && (
                        <span className="text-[11px] font-semibold text-slate-500">
                          · Address-only
                        </span>
                      )}
                    </div>

                    {/* Owner-only UPI Payment Verification box */}
                    {isUpiOrder(order) && !order.upiVerified && (
                      <div
                        data-testid={`owner-upi-verify-box-${order.id}`}
                        className="rounded-xl bg-amber-50 border border-amber-300 p-3 flex flex-wrap items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-extrabold text-amber-950">
                            UPI PAYMENT PENDING
                          </p>
                          <p className="text-xs font-semibold text-amber-900 tabular-nums mt-0.5">
                            Customer UTR: {order.upiUtr || 'Not provided'}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={busy}
                          data-testid={`verify-upi-btn-${order.id}`}
                          onClick={() =>
                            updateOrder(
                              order.id,
                              { upiVerified: true, upiVerifiedAt: Date.now() },
                              `UPI payment verified for ${order.id} (UTR ${order.upiUtr || ''}).`
                            )
                          }
                          className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
                        >
                          <Check className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>Verify UPI Payment</span>
                        </button>
                      </div>
                    )}

                    <div className="bg-slate-50 rounded-xl p-3 text-sm font-medium text-slate-900 space-y-1.5">
                      <div>
                        {order.items
                          .map((i) => `${i.quantity} × ${i.name}`)
                          .join(' · ')}
                      </div>
                      {(typeof order.platformFee === 'number' ||
                        typeof order.deliveryFee === 'number' ||
                        typeof order.floorCharge === 'number') && (
                        <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
                          Items {formatRupees(order.itemsSubtotal ?? order.totalAmount)}
                          {(order.platformFee ?? 0) > 0
                            ? ` · Platform ${formatRupees(order.platformFee!)}`
                            : ''}
                          {(order.deliveryFee ?? 0) > 0
                            ? ` · Delivery ${formatRupees(order.deliveryFee!)}`
                            : ''}
                          {(order.floorCharge ?? 0) > 0
                            ? ` · Floor ${formatRupees(order.floorCharge!)}`
                            : ''}
                        </div>
                      )}
                    </div>

                    {formatFloorLiftSummary(order) && (
                      <div
                        data-testid={`owner-floor-lift-${order.id}`}
                        className={`rounded-xl px-3 py-2 text-xs font-bold flex items-center gap-2 border ${
                          (order.floorCharge ?? 0) > 0
                            ? 'bg-amber-50 border-amber-200 text-amber-950'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}
                      >
                        <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Floor &amp; Lift: {formatFloorLiftSummary(order)}</span>
                      </div>
                    )}

                    {order.eventDetails && (
                      <div className="text-xs font-semibold text-cyan-800 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>
                          Event: {order.eventDetails.eventDate} ·{' '}
                          {order.eventDetails.timeSlot}
                          {order.eventDetails.notes
                            ? ` · ${order.eventDetails.notes}`
                            : ''}
                        </span>
                      </div>
                    )}

                    {/* Delivery Photo Proof Thumbnail */}
                    {hasDeliveryPhoto && (
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={() =>
                              setZoomPhoto({
                                orderId: order.id,
                                customerName: order.customerName,
                                src: order.deliveryPhoto!,
                                deliveredAt: order.deliveredAt,
                              })
                            }
                            aria-label={`View delivery proof photo for ${order.id}`}
                            className="w-14 h-14 rounded-xl overflow-hidden border border-emerald-300 shrink-0 cursor-pointer hover:opacity-90"
                          >
                            <img
                              src={order.deliveryPhoto!}
                              alt={`Delivery proof for ${order.id}`}
                              className="w-full h-full object-cover"
                            />
                          </button>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                              <Camera className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>Delivery Photo Proof</span>
                            </p>
                            <p className="text-[11px] text-emerald-800 truncate">
                              {order.deliveredAt
                                ? `Delivered ${formatTimestamp(order.deliveredAt)}`
                                : 'Captured at customer doorstep'}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setZoomPhoto({
                              orderId: order.id,
                              customerName: order.customerName,
                              src: order.deliveryPhoto!,
                              deliveredAt: order.deliveredAt,
                            })
                          }
                          className="min-h-[36px] px-3 rounded-lg bg-white border border-emerald-300 text-emerald-900 text-xs font-bold shrink-0 cursor-pointer"
                        >
                          View
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  {needsOwnerReview && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateOrder(
                            order.id,
                            { ownerApproved: true },
                            `Confirmed order ${order.id}. Assign a Duty-ON rider below.`
                          )
                        }
                        className="min-h-[44px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                        <span>Accept</span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateOrder(
                            order.id,
                            { status: 'rejected' },
                            `Rejected order ${order.id}.`
                          )
                        }
                        className="min-h-[44px] rounded-xl bg-red-50 hover:bg-red-100 text-red-700 font-bold text-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        <X className="w-4 h-4" aria-hidden="true" />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}

                  {/* Live 3-Minute Rider Acceptance Countdown / Timeout Alert */}
                  {awaitingRider && riderTimer && (
                    <div
                      data-testid={`owner-timer-${order.id}`}
                      className={`rounded-xl border p-3 ${
                        riderTimer.isExpired || riderTimer.isUrgent
                          ? 'bg-red-50 border-red-300 text-red-900'
                          : 'bg-amber-50 border-amber-300 text-amber-950'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs font-extrabold">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span>
                            Waiting for Rider: {riderTimer.formatted}
                          </span>
                        </span>
                        <span className="font-semibold truncate">
                          {order.assignedRiderName || order.assignedRiderId}
                        </span>
                      </div>
                      <div className="mt-2 h-2 w-full rounded-full bg-white/80 overflow-hidden border border-black/5">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            riderTimer.isExpired || riderTimer.isUrgent
                              ? 'bg-red-600'
                              : 'bg-amber-500'
                          }`}
                          style={{ width: `${riderTimer.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {timedOutUnassigned && (
                    <div
                      role="alert"
                      data-testid={`owner-timeout-${order.id}`}
                      className="rounded-xl bg-red-50 border border-red-300 p-3 text-red-900 space-y-1"
                    >
                      <p className="text-xs font-extrabold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
                        <span>
                          Waiting for Rider: 00:00 — Timed Out (Unassigned)
                        </span>
                      </p>
                      <p className="text-[11px] text-red-800">
                        {order.lastTimedOutRiderName
                          ? `${order.lastTimedOutRiderName} (${order.lastTimedOutRiderId}) did not accept within 3 minutes.`
                          : 'Previous rider did not accept within 3 minutes.'}{' '}
                        Select another Duty-ON rider below to re-assign immediately.
                      </p>
                    </div>
                  )}

                  {isActiveOrderStatus(order.status) &&
                    (awaitingRider || timedOutUnassigned ? (
                      <div
                        className={`rounded-xl border p-3 space-y-2.5 ${
                          isOverdueHighlight
                            ? 'bg-red-50/80 border-red-300'
                            : 'bg-slate-50 border-slate-200'
                        }`}
                      >
                        <label
                          htmlFor={`reassign-rider-${order.id}`}
                          className={`block text-xs font-bold flex items-center gap-1.5 ${
                            isOverdueHighlight ? 'text-red-900' : 'text-slate-700'
                          }`}
                        >
                          <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Re-Assign to Another Rider</span>
                        </label>

                        <div className="flex flex-col sm:flex-row gap-2">
                          <select
                            id={`reassign-rider-${order.id}`}
                            disabled={busy}
                            value={reassignChoice}
                            onChange={(e) =>
                              setReassignDraftByOrder((prev) => ({
                                ...prev,
                                [order.id]: e.target.value,
                              }))
                            }
                            className={`flex-1 min-h-[44px] pl-3 pr-8 rounded-xl border text-sm text-slate-900 bg-white focus:outline-none ${
                              isOverdueHighlight
                                ? 'border-red-400 focus:border-red-600'
                                : 'border-slate-300 focus:border-blue-700'
                            }`}
                          >
                            <option value="">
                              {onlineRiders.length === 0
                                ? 'No Duty-ON riders online yet'
                                : 'Choose another Duty-ON rider…'}
                            </option>
                            {onlineRiders.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.id})
                                {r.id === order.lastTimedOutRiderId
                                  ? ' · Timed Out'
                                  : r.id === order.assignedRiderId
                                    ? ' · Current'
                                    : ' · Duty ON'}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={busy || !reassignChoice}
                            onClick={() =>
                              void handleAssignRider(order, reassignChoice, true)
                            }
                            data-testid={`owner-reassign-btn-${order.id}`}
                            className={`min-h-[44px] px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50 transition-colors ${
                              isOverdueHighlight
                                ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
                                : 'bg-blue-700 hover:bg-blue-800 text-white'
                            }`}
                          >
                            <RefreshCw className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>Re-Assign to Another Rider</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label
                          htmlFor={`assign-rider-${order.id}`}
                          className="block text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5"
                        >
                          <UserCheck className="w-3.5 h-3.5 text-cyan-700" aria-hidden="true" />
                          <span>Assign Duty-ON Rider</span>
                        </label>
                        <select
                          id={`assign-rider-${order.id}`}
                          disabled={busy}
                          value={order.assignedRiderId || ''}
                          onChange={(e) =>
                            void handleAssignRider(order, e.target.value, false)
                          }
                          className="w-full min-h-[44px] pl-3.5 pr-8 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-blue-700"
                        >
                          <option value="">
                            {onlineRiders.length === 0
                              ? 'No Duty-ON riders online yet'
                              : 'Select Duty-ON rider…'}
                          </option>
                          {order.assignedRiderId &&
                            !onlineRiders.some(
                              (r) => r.id === order.assignedRiderId
                            ) && (
                              <option value={order.assignedRiderId}>
                                {order.assignedRiderName} ({order.assignedRiderId} · Currently Offline)
                              </option>
                            )}
                          {onlineRiders.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.id}) · Duty ON
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}

                  {/* Delete order with inline confirmation */}
                  <div className="flex items-center justify-end">
                    {confirmDeleteId === order.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-700 font-semibold">
                          Delete order?
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleDeleteOrder(order.id)}
                          className="min-h-[36px] px-3 rounded-lg bg-red-600 text-white text-xs font-bold cursor-pointer"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[36px] px-3 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(order.id)}
                        aria-label={`Delete order ${order.id}`}
                        className="min-h-[40px] px-3 rounded-xl text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                        <span>Delete Order</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Delivery Photo Proof Lightbox */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Delivery Photo Proof Preview"
        >
          <div className="w-full max-w-md bg-white rounded-2xl overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="font-display font-bold text-slate-900">
                  {zoomPhoto.customerName} · {zoomPhoto.orderId}
                </p>
                <p className="text-xs text-slate-500">
                  Delivery Photo Proof
                  {zoomPhoto.deliveredAt
                    ? ` · ${formatTimestamp(zoomPhoto.deliveredAt)}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomPhoto(null)}
                aria-label="Close delivery photo preview"
                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={zoomPhoto.src}
              alt={`Delivery proof for order ${zoomPhoto.orderId}`}
              className="w-full max-h-[70dvh] object-contain bg-slate-100"
            />
          </div>
        </div>
      )}
    </section>
  );
}
