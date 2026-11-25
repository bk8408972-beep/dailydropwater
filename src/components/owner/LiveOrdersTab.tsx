import { useState } from 'react';
import {
  BadgeCheck,
  Check,
  Clock,
  MapPin,
  Phone,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import type { Order, RiderRecord } from '../../types';
import {
  dbDelete,
  dbPatch,
  sanitizeFirebaseKey,
} from '../../services/firebaseDb';
import {
  formatRupees,
  formatTimestamp,
  getStatusLabel,
  sanitizePhoneForTel,
} from '../../utils/domain';

interface LiveOrdersTabProps {
  orders: Order[];
  riders: RiderRecord[];
  completedCleanupCount: number;
  onOpenWeeklyCleanup: () => void;
  onNotify: (msg: string) => void;
}

export function LiveOrdersTab({
  orders,
  riders,
  completedCleanupCount,
  onOpenWeeklyCleanup,
  onNotify,
}: LiveOrdersTabProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');

  const onlineRiders = riders.filter((r) => r.isActive && r.isOnline);

  const displayedOrders =
    statusFilter === 'active'
      ? orders.filter(
          (o) =>
            o.status === 'PENDING' ||
            o.status === 'ACCEPTED' ||
            o.status === 'OUT_FOR_DELIVERY'
        )
      : orders;

  const updateOrder = async (
    orderId: string,
    patch: Record<string, unknown>,
    message: string
  ) => {
    setBusyId(orderId);
    try {
      await dbPatch(`orders/${sanitizeFirebaseKey(orderId)}`, {
        ...patch,
        updatedAt: Date.now(),
      });
      onNotify(message);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update order.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleAssignRider = async (order: Order, riderId: string) => {
    if (!riderId) {
      await updateOrder(
        order.id,
        {
          assignedRiderId: null,
          assignedRiderName: null,
          assignedRiderMobile: null,
        },
        `Unassigned rider from ${order.id}.`
      );
      return;
    }

    const chosen = riders.find((r) => r.id === riderId);
    if (!chosen) return;

    const nextStatus = order.status === 'PENDING' ? 'ACCEPTED' : order.status;
    await updateOrder(
      order.id,
      {
        status: nextStatus,
        assignedRiderId: chosen.id,
        assignedRiderName: chosen.name,
        assignedRiderMobile: chosen.mobile,
      },
      `Assigned ${chosen.name} (${chosen.id}) to ${order.id}.`
    );
  };

  const handleDeleteOrder = async (orderId: string) => {
    setBusyId(orderId);
    try {
      await dbDelete(`orders/${sanitizeFirebaseKey(orderId)}`);
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
              Active ({orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'REJECTED').length})
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
            const customerTel = sanitizePhoneForTel(order.customerMobile);
            const isPending = order.status === 'PENDING';

            return (
              <article
                key={order.id}
                className={`bg-white rounded-2xl border p-5 flex flex-col justify-between gap-4 ${
                  isPending ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-xs font-semibold text-slate-500 tabular-nums">
                        {order.id} · {formatTimestamp(order.createdAt)} ·{' '}
                        {order.serviceMode === 'events'
                          ? 'Events Supply'
                          : 'Fast 15–20m'}
                      </div>
                      <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                        {order.customerName}
                      </h3>
                      <p
                        className={`text-xs font-bold mt-0.5 ${
                          order.status === 'PENDING'
                            ? 'text-blue-700'
                            : order.status === 'DELIVERED'
                              ? 'text-emerald-700'
                              : order.status === 'REJECTED'
                                ? 'text-red-600'
                                : 'text-cyan-700'
                        }`}
                      >
                        {getStatusLabel(order.status)} · {order.paymentMethod}
                        {order.paymentStatus === 'SUCCESSFUL' && (
                          <span className="text-emerald-700"> · UPI Verified</span>
                        )}
                      </p>
                    </div>

                    <div className="font-display text-xl font-extrabold text-slate-900 tabular-nums">
                      {formatRupees(order.totalAmount)}
                    </div>
                  </div>

                  <div className="py-3 space-y-2 text-sm text-slate-700">
                    <div className="flex items-start gap-2">
                      <MapPin
                        className="w-4 h-4 text-blue-700 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{order.address}</span>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-600">
                      <Phone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                      <a
                        href={`tel:${customerTel}`}
                        className="font-semibold text-blue-700 hover:underline tabular-nums"
                      >
                        {order.customerMobile}
                      </a>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-3 text-sm font-medium text-slate-900">
                      {order.items
                        .map((i) => `${i.quantity} × ${i.name}`)
                        .join(' · ')}
                    </div>

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
                  </div>
                </div>

                {/* Controls */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  {order.status === 'PENDING' && (
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateOrder(
                            order.id,
                            { status: 'ACCEPTED' },
                            `Accepted order ${order.id}.`
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
                            { status: 'REJECTED' },
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

                  {order.status !== 'DELIVERED' && order.status !== 'REJECTED' && (
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
                          void handleAssignRider(order, e.target.value)
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
                  )}

                  {order.paymentMethod === 'UPI on Delivery' &&
                    order.status !== 'REJECTED' && (
                      <div>
                        {order.paymentStatus === 'SUCCESSFUL' ? (
                          <div className="min-h-[40px] px-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
                            <BadgeCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                            <span>UPI Payment Verified (SUCCESSFUL)</span>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              updateOrder(
                                order.id,
                                { paymentStatus: 'SUCCESSFUL' },
                                `UPI payment verified as SUCCESSFUL for ${order.id}.`
                              )
                            }
                            className="w-full min-h-[42px] px-3.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-900 font-bold text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 transition-colors"
                          >
                            <BadgeCheck className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
                            <span>Verify UPI Paid (Notify Customer)</span>
                          </button>
                        )}
                      </div>
                    )}

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
    </section>
  );
}
