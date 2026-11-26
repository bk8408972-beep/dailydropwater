import React from 'react';
import {
  Banknote,
  Bell,
  BellOff,
  Building2,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Lock,
  MapPin,
  Navigation,
  Package,
  Phone,
  Truck,
  X,
} from 'lucide-react';
import type { Order } from '../../types';
import {
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  isSafeImageDataUrl,
  normalizeOrderStatus,
  resolveOrderCustomerCoords,
} from '../../utils/domain';
import {
  getRiderAcceptanceCountdown,
  isAwaitingRiderAcceptance,
} from '../../utils/orderTimer';
import {
  buildGoogleMapsDrivingDirectionsUrl,
  buildPhoneCallUrl,
  copyLocationText,
  copyPhoneNumber,
  formatDisplayPhone10,
  WATER_PLANT_LOCATION,
} from '../../utils/androidIntents';
import { formatFloorLiftSummary } from '../../utils/storeSettings';
import { getOrderPaymentBadge, isCodOrder } from '../../utils/payment';
import { BrandLogo } from '../BrandLogo';
import type { MapModalTarget } from '../InAppMapModal';
import { NetworkStatusBanner } from '../NetworkStatusBanner';

const LOCKED_STEPS = [
  { key: 'accept', label: '1. Accept Order' },
  { key: 'out', label: '2. Out for Delivery' },
  { key: 'done', label: '3. Completed' },
] as const;

export interface RiderActiveOrderScreenProps {
  order: Order;
  queuedCount: number;
  nowMs: number;
  busy: boolean;
  uploadingPhoto: boolean;
  photoError?: string;
  isRinging: boolean;
  ringtoneName: string;
  actionMessage: string | null;
  onDismissActionMessage: () => void;
  onMuteAlert: (orderId: string) => void;
  onAcceptOrder: (order: Order) => void;
  onRejectOrder: (order: Order) => void;
  onMarkOutForDelivery: (order: Order) => void;
  onMarkOrderCompleted: (order: Order) => void;
  onCaptureDeliveryPhoto: (
    order: Order,
    e: React.ChangeEvent<HTMLInputElement>
  ) => void;
  onOpenMapModal: (target: MapModalTarget) => void;
  onShowCopyToast: (msg: string) => void;
}

export function RiderActiveOrderScreen({
  order,
  queuedCount,
  nowMs,
  busy,
  uploadingPhoto,
  photoError,
  isRinging,
  ringtoneName,
  actionMessage,
  onDismissActionMessage,
  onMuteAlert,
  onAcceptOrder,
  onRejectOrder,
  onMarkOutForDelivery,
  onMarkOrderCompleted,
  onCaptureDeliveryPhoto,
  onOpenMapModal,
  onShowCopyToast,
}: RiderActiveOrderScreenProps) {
  const canonicalStatus = normalizeOrderStatus(order.status);
  const awaitingAcceptance = isAwaitingRiderAcceptance(order);
  const acceptanceTimer = awaitingAcceptance
    ? getRiderAcceptanceCountdown(order, nowMs)
    : null;
  const customerCoords = resolveOrderCustomerCoords(order);
  const customerMapsUrl = buildGoogleMapsDrivingDirectionsUrl({
    lat: customerCoords?.lat ?? null,
    lng: customerCoords?.lng ?? null,
    address: order.address,
  });
  const displayCustomerPhone = formatDisplayPhone10(order.customerMobile);
  const paymentBadge = getOrderPaymentBadge(order);
  const orderIsCod = isCodOrder(order);
  const hasDeliveryPhoto = isSafeImageDataUrl(order.deliveryPhoto);
  const floorLiftText = formatFloorLiftSummary(order);

  const currentStepIndex = awaitingAcceptance
    ? 0
    : canonicalStatus === 'accepted' || canonicalStatus === 'reached_pickup'
      ? 1
      : 2;

  const totalItemUnits = order.items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.quantity) || 0),
    0
  );

  return (
    <div
      data-testid="rider-locked-active-order-screen"
      className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-32"
    >
      <NetworkStatusBanner />

      {/* Dedicated Locked Active Order Header (No Home / Duty / Back exit controls) */}
      <header className="sticky top-0 z-30 bg-blue-900 text-white shadow-sm">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="font-display text-base sm:text-lg font-extrabold leading-tight truncate">
                  Active Order
                </h1>
                {queuedCount > 1 && (
                  <span className="text-[11px] font-bold bg-cyan-400 text-blue-950 px-1.5 py-0.5 rounded-md tabular-nums shrink-0">
                    1 of {queuedCount}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-cyan-200 font-mono leading-tight truncate">
                {order.id} · {getStatusLabel(order.status)}
              </p>
            </div>
          </div>

          <div
            data-testid="rider-locked-indicator"
            className="flex items-center gap-1.5 text-[11px] font-bold bg-blue-950/90 border border-blue-700 text-cyan-100 px-2.5 py-1.5 rounded-lg shrink-0"
          >
            <Lock className="w-3.5 h-3.5 text-cyan-300 shrink-0" aria-hidden="true" />
            <span>Locked</span>
          </div>
        </div>
      </header>

      {/* Loud New Delivery Assignment Alert Banner */}
      {isRinging && (
        <div
          role="alert"
          data-testid="rider-ringing-banner"
          className="bg-amber-500 text-slate-950 border-b border-amber-600 shadow-sm"
        >
          <div className="max-w-xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-sm font-extrabold">
              <Bell className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>New Order Incoming! Ringing ({ringtoneName})</span>
            </div>
            <button
              type="button"
              onClick={() => onMuteAlert(order.id)}
              className="min-h-[38px] px-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-bold text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <BellOff className="w-4 h-4" aria-hidden="true" />
              <span>Mute Alert</span>
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-xl w-full mx-auto px-4 pt-4 space-y-4">
        {actionMessage && (
          <div
            role="status"
            data-testid="rider-locked-status-banner"
            className="bg-blue-50 border border-blue-200 text-blue-950 rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-between gap-3"
          >
            <span>{actionMessage}</span>
            <button
              type="button"
              onClick={onDismissActionMessage}
              aria-label="Dismiss message"
              className="p-1 text-blue-700 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 3-Step Delivery Progress */}
        <section
          aria-label="Order progress"
          className="bg-white rounded-2xl border border-slate-200 p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            {LOCKED_STEPS.map((st, idx) => {
              const done = idx < currentStepIndex;
              const active = idx === currentStepIndex;
              return (
                <div key={st.key} className="text-center">
                  <div
                    className={`h-2 rounded-full mb-1.5 ${
                      done
                        ? 'bg-emerald-600'
                        : active
                          ? 'bg-blue-700'
                          : 'bg-slate-200'
                    }`}
                  />
                  <span
                    className={`text-[11px] font-bold block leading-tight ${
                      active
                        ? 'text-blue-800'
                        : done
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                    }`}
                  >
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>

          {awaitingAcceptance && acceptanceTimer && (
            <div
              data-testid={`rider-timer-${order.id}`}
              className={`mt-3 rounded-xl border p-3 ${
                acceptanceTimer.isUrgent
                  ? 'bg-red-50 border-red-300 text-red-900'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs font-extrabold">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Accept within 3 minutes</span>
                </span>
                <span className="font-mono text-sm tabular-nums">
                  {acceptanceTimer.formatted}
                </span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-white/80 overflow-hidden border border-black/5">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    acceptanceTimer.isUrgent ? 'bg-red-600' : 'bg-amber-500'
                  }`}
                  style={{ width: `${acceptanceTimer.progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </section>

        {/* Total Cash to Collect (COD) / UPI Payment Card */}
        <section
          aria-label="Payment collection"
          data-testid={`rider-payment-badge-${order.id}`}
          className={`rounded-2xl border p-4 flex items-center justify-between gap-3 ${
            paymentBadge.kind === 'upi_pending'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-emerald-50 border-emerald-300 text-emerald-950'
          }`}
        >
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide flex items-center gap-1.5">
              <Banknote className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {orderIsCod
                  ? 'Total Cash to Collect (COD)'
                  : paymentBadge.label}
              </span>
            </p>
            <p className="text-xs font-semibold opacity-85 mt-0.5">
              {orderIsCod
                ? 'Collect exact cash at doorstep upon delivery'
                : 'Prepaid via UPI — No cash to collect'}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="font-display text-3xl font-extrabold tabular-nums">
              {formatRupees(order.totalAmount)}
            </div>
          </div>
        </section>

        {/* Customer Info, Tap-to-Call, Full Address & Google Maps Navigation */}
        <section
          aria-label="Customer details and delivery address"
          data-testid={`rider-order-${order.id}`}
          className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4"
        >
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Customer Details
              </p>
              <h2 className="font-display text-xl font-extrabold text-slate-900 mt-0.5">
                {order.customerName}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                Ordered {formatTimestamp(order.createdAt)}
              </p>
            </div>
            <span className="text-xs font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-lg shrink-0">
              {getStatusLabel(order.status)}
            </span>
          </div>

          {/* Phone Number + Tap-to-Call + Copy Number */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <a
              href={buildPhoneCallUrl(order.customerMobile)}
              data-testid="locked-order-call-btn"
              className="min-h-[48px] px-3.5 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors tabular-nums"
            >
              <Phone className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Call {displayCustomerPhone}</span>
            </a>
            <button
              type="button"
              onClick={() =>
                void copyPhoneNumber(order.customerMobile, onShowCopyToast)
              }
              className="min-h-[48px] px-3.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <Copy className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>Copy</span>
            </button>
          </div>

          {/* Full Delivery Address */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Full Delivery Address
            </p>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 flex items-start gap-2.5 text-sm font-semibold text-slate-900">
              <MapPin
                className="w-5 h-5 text-blue-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span className="leading-snug">{order.address}</span>
            </div>

            {floorLiftText && (
              <div
                data-testid={`rider-floor-lift-${order.id}`}
                className={`rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 border ${
                  (order.floorCharge ?? 0) > 0
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : 'bg-blue-50/70 border-blue-200 text-blue-950'
                }`}
              >
                <Building2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Floor &amp; Lift: {floorLiftText}</span>
              </div>
            )}

            {order.eventDetails && (
              <div className="rounded-xl bg-cyan-50 border border-cyan-200 px-3.5 py-2.5 text-xs text-cyan-950 font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0 text-cyan-700" aria-hidden="true" />
                <span>
                  Event: {order.eventDetails.eventDate} · {order.eventDetails.timeSlot}
                  {order.eventDetails.notes ? ` · ${order.eventDetails.notes}` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Primary Green Open in Google Maps Link + Secondary Copy Location & Map Preview */}
          <div className="space-y-2">
            <a
              href={customerMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="locked-order-open-google-maps-link"
              className="w-full min-h-[52px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <span>🧭 Open in Google Maps</span>
            </a>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="locked-order-copy-location-btn"
                onClick={() =>
                  void copyLocationText(
                    {
                      lat: customerCoords?.lat ?? null,
                      lng: customerCoords?.lng ?? null,
                      address: order.address,
                    },
                    onShowCopyToast
                  )
                }
                className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4 text-slate-700 shrink-0" aria-hidden="true" />
                <span>Copy Location</span>
              </button>

              <button
                type="button"
                data-testid="locked-order-navigate-btn"
                onClick={() =>
                  onOpenMapModal({
                    title: 'Customer Delivery Location',
                    subtitle: `${order.id} · ${order.customerName}`,
                    address: order.address,
                    lat: customerCoords?.lat ?? null,
                    lng: customerCoords?.lng ?? null,
                  })
                }
                className="min-h-[44px] px-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Navigation className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>Map Preview</span>
              </button>
            </div>

            {(canonicalStatus === 'accepted' || canonicalStatus === 'reached_pickup') && (
              <button
                type="button"
                onClick={() =>
                  onOpenMapModal({
                    title: 'Water Plant / Pickup Location',
                    subtitle: `${order.id} · Plant Pickup`,
                    address: WATER_PLANT_LOCATION.label,
                    lat: WATER_PLANT_LOCATION.lat,
                    lng: WATER_PLANT_LOCATION.lng,
                  })
                }
                className="w-full min-h-[44px] px-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-300 text-cyan-950 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <MapPin className="w-4 h-4 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>Navigate to Water Plant Pickup</span>
              </button>
            )}
          </div>
        </section>

        {/* Items & Quantity Card */}
        <section
          aria-label="Order items and quantity"
          className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 flex items-center gap-1.5">
              <Package className="w-4 h-4 text-blue-700" aria-hidden="true" />
              <span>Items &amp; Quantity</span>
            </h2>
            <span className="text-xs font-bold text-slate-700 tabular-nums">
              {totalItemUnits} {totalItemUnits === 1 ? 'unit' : 'units'}
            </span>
          </div>

          <ul className="divide-y divide-slate-100">
            {order.items.map((item, idx) => (
              <li
                key={`${item.productId}-${idx}`}
                className="py-2.5 flex items-center justify-between gap-3 text-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="min-w-[34px] h-8 px-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 font-extrabold text-sm flex items-center justify-center tabular-nums shrink-0">
                    {item.quantity}×
                  </span>
                  <span className="font-bold text-slate-900 truncate">
                    {item.name}
                  </span>
                </div>
                <span className="font-bold text-slate-800 tabular-nums shrink-0">
                  {formatRupees((Number(item.price) || 0) * (Number(item.quantity) || 0))}
                </span>
              </li>
            ))}
          </ul>

          <div className="pt-2 border-t border-slate-100 text-xs font-semibold text-slate-600 flex flex-wrap items-center justify-between gap-2 tabular-nums">
            <span>
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
            </span>
            <span className="text-slate-900 font-extrabold">
              Total {formatRupees(order.totalAmount)}
            </span>
          </div>
        </section>

        {/* Optional Doorstep Delivery Photo Proof during Out for Delivery */}
        {canonicalStatus === 'out_for_delivery' && (
          <section
            aria-label="Doorstep delivery photo"
            className={`rounded-2xl border p-4 space-y-2.5 ${
              hasDeliveryPhoto
                ? 'bg-emerald-50 border-emerald-300'
                : 'bg-white border-slate-200'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-xs font-bold flex items-center gap-1.5 ${
                  hasDeliveryPhoto ? 'text-emerald-900' : 'text-slate-700'
                }`}
              >
                <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>
                  {hasDeliveryPhoto
                    ? 'Doorstep Delivery Photo Saved'
                    : 'Doorstep Delivery Photo (Optional)'}
                </span>
              </span>
            </div>

            {hasDeliveryPhoto && (
              <div className="overflow-hidden rounded-xl border border-emerald-300 bg-white">
                <img
                  src={order.deliveryPhoto!}
                  alt={`Doorstep delivery proof for ${order.id}`}
                  className="w-full h-40 object-cover"
                />
              </div>
            )}

            <label
              className={`w-full min-h-[44px] px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors ${
                hasDeliveryPhoto
                  ? 'bg-white border border-emerald-400 text-emerald-900 hover:bg-emerald-100'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>
                {uploadingPhoto
                  ? 'Saving Photo…'
                  : hasDeliveryPhoto
                    ? 'Retake Delivery Photo'
                    : 'Take Delivery Photo'}
              </span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={uploadingPhoto}
                onChange={(e) => onCaptureDeliveryPhoto(order, e)}
                className="sr-only"
              />
            </label>

            {photoError && (
              <p role="alert" className="text-xs font-semibold text-red-700">
                {photoError}
              </p>
            )}
          </section>
        )}
      </main>

      {/* Sticky Bottom Action Bar: Accept Order / Reject Order -> Out for Delivery -> Mark Order Completed */}
      <div className="fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-4 py-3 pb-safe shadow-lg">
        <div className="max-w-xl mx-auto">
          {awaitingAcceptance && (
            <div className="grid grid-cols-[1fr_auto] gap-2.5">
              <button
                type="button"
                disabled={busy}
                data-testid={`rider-accept-order-${order.id}`}
                onClick={() => onAcceptOrder(order)}
                className="w-full min-h-[54px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-extrabold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>{busy ? 'Accepting…' : 'Accept Order'}</span>
              </button>

              <button
                type="button"
                disabled={busy}
                data-testid={`rider-reject-order-${order.id}`}
                onClick={() => onRejectOrder(order)}
                className="min-h-[54px] px-4 rounded-xl bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 font-extrabold text-sm flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Reject Order</span>
              </button>
            </div>
          )}

          {(canonicalStatus === 'accepted' || canonicalStatus === 'reached_pickup') && (
            <button
              type="button"
              disabled={busy}
              data-testid={`rider-out-for-delivery-${order.id}`}
              onClick={() => onMarkOutForDelivery(order)}
              className="w-full min-h-[54px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 active:scale-[0.99] text-white font-extrabold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
            >
              <Truck className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>{busy ? 'Updating…' : 'Out for Delivery'}</span>
            </button>
          )}

          {canonicalStatus === 'out_for_delivery' && (
            <button
              type="button"
              disabled={busy}
              data-testid={`rider-complete-order-${order.id}`}
              onClick={() => onMarkOrderCompleted(order)}
              className="w-full min-h-[54px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-base flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span>
                {busy
                  ? 'Completing Order…'
                  : orderIsCod
                    ? `Mark Order Completed (Collect ${formatRupees(order.totalAmount)})`
                    : 'Mark Order Completed'}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
