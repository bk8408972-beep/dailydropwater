import { useState } from 'react';
import {
  Calendar,
  Check,
  Clock,
  MapPin,
  Phone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { BulkBookingRequest } from '../../types';
import {
  ownerDeleteBulkBooking,
  ownerUpdateBulkBookingStatus,
} from '../../services/firebaseDb';
import {
  buildPhoneCallUrl,
  formatDisplayPhone10,
} from '../../utils/androidIntents';
import { formatTimestamp } from '../../utils/domain';

interface BulkBookingsSectionProps {
  bookings: BulkBookingRequest[];
  onNotify: (msg: string) => void;
}

export function BulkBookingsSection({
  bookings,
  onNotify,
}: BulkBookingsSectionProps) {
  const [busyId, setBusyId] = useState<string | null>(null);

  if (bookings.length === 0) {
    return null;
  }

  const pendingCount = bookings.filter((b) => b.status === 'pending').length;

  const handleStatus = async (
    booking: BulkBookingRequest,
    nextStatus: 'accepted' | 'rejected'
  ) => {
    setBusyId(booking.id);
    try {
      await ownerUpdateBulkBookingStatus(booking.id, nextStatus);
      onNotify(
        nextStatus === 'accepted'
          ? `Accepted Bulk Booking ${booking.id} (${booking.quantity} cans for ${booking.customerName}).`
          : `Rejected Bulk Booking ${booking.id}.`
      );
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to update bulk booking.'
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (booking: BulkBookingRequest) => {
    setBusyId(booking.id);
    try {
      await ownerDeleteBulkBooking(booking.id);
      onNotify(`Deleted bulk booking ${booking.id}.`);
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to delete bulk booking.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      aria-label="Events and Function Bulk Booking Requests"
      data-testid="owner-bulk-bookings-section"
      className="bg-cyan-50/70 rounded-2xl border border-cyan-300 p-4 sm:p-5 space-y-3.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-cyan-800 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-lg font-extrabold text-slate-900">
            Events / Function Bulk Booking Requests ({bookings.length})
          </h2>
        </div>
        {pendingCount > 0 && (
          <span className="px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-300 text-amber-900 text-xs font-extrabold tabular-nums">
            {pendingCount} Pending Review
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {bookings.map((booking) => {
          const busy = busyId === booking.id;
          const badgeClass =
            booking.status === 'accepted'
              ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
              : booking.status === 'rejected'
                ? 'bg-red-100 text-red-800 border-red-200'
                : 'bg-amber-100 text-amber-900 border-amber-300';

          return (
            <article
              key={booking.id}
              data-testid={`owner-bulk-card-${booking.id}`}
              className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display font-extrabold text-sm text-slate-900">
                      {booking.customerName}
                    </span>
                    <span
                      data-testid={`owner-bulk-status-${booking.id}`}
                      className={`px-2 py-0.5 rounded-md border text-[11px] font-extrabold uppercase ${badgeClass}`}
                    >
                      {booking.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                    {booking.id} · {formatTimestamp(booking.createdAt)}
                  </p>
                </div>

                <span className="px-2.5 py-1 rounded-xl bg-cyan-100 text-cyan-950 font-display font-extrabold text-sm tabular-nums shrink-0">
                  {booking.quantity} Cans
                </span>
              </div>

              <div className="space-y-1.5 text-xs text-slate-700">
                <div className="flex flex-wrap items-center gap-3 font-semibold">
                  <span className="inline-flex items-center gap-1 text-cyan-900">
                    <Calendar className="w-3.5 h-3.5 text-cyan-700" aria-hidden="true" />
                    <span>{booking.eventDate}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-slate-700">
                    <Clock className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    <span>{booking.timeSlot}</span>
                  </span>
                </div>
                <div className="flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{booking.address}</span>
                </div>
                {booking.notes && (
                  <p className="text-slate-500 italic">Note: {booking.notes}</p>
                )}
              </div>

              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                <a
                  href={buildPhoneCallUrl(booking.customerMobile)}
                  className="min-h-[38px] px-3 rounded-xl bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 font-bold text-xs inline-flex items-center gap-1.5"
                >
                  <Phone className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="tabular-nums">
                    {formatDisplayPhone10(booking.customerMobile)}
                  </span>
                </a>

                <div className="flex items-center gap-1.5">
                  {booking.status !== 'accepted' && (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid={`owner-accept-bulk-${booking.id}`}
                      onClick={() => void handleStatus(booking, 'accepted')}
                      className="min-h-[38px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Accept</span>
                    </button>
                  )}

                  {booking.status !== 'rejected' && (
                    <button
                      type="button"
                      disabled={busy}
                      data-testid={`owner-reject-bulk-${booking.id}`}
                      onClick={() => void handleStatus(booking, 'rejected')}
                      className="min-h-[38px] px-3 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold text-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-60"
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Delete bulk booking ${booking.id}`}
                    onClick={() => void handleDelete(booking)}
                    className="min-h-[38px] px-2.5 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 inline-flex items-center cursor-pointer disabled:opacity-60"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
