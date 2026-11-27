import React, { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Mail,
  Phone,
  Sparkles,
  X,
} from 'lucide-react';
import type { BulkBookingRequest, CustomerProfile } from '../../types';
import { EVENT_TIME_SLOTS } from '../../utils/domain';
import {
  BULK_CAN_PRESETS,
  validateBulkBookingInput,
} from '../../utils/customerFeatures';
import { submitBulkBookingRequest } from '../../services/firebaseDb';
import { triggerPhoneCall } from '../../utils/androidIntents';

interface BulkBookingModalProps {
  open: boolean;
  supportMobile: string;
  supportEmail: string;
  customerProfile: CustomerProfile | null;
  onClose: () => void;
  onSubmitted?: (booking: BulkBookingRequest) => void;
}

export function BulkBookingModal({
  open,
  supportMobile,
  supportEmail,
  customerProfile,
  onClose,
  onSubmitted,
}: BulkBookingModalProps) {
  const [quantity, setQuantity] = useState<string>('20');
  const [eventDate, setEventDate] = useState<string>('');
  const [timeSlot, setTimeSlot] = useState<string>(EVENT_TIME_SLOTS[0]);
  const [customerName, setCustomerName] = useState<string>(
    customerProfile?.name ?? ''
  );
  const [customerMobile, setCustomerMobile] = useState<string>(
    customerProfile?.mobile ?? ''
  );
  const [address, setAddress] = useState<string>(
    customerProfile?.address ?? ''
  );
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] =
    useState<BulkBookingRequest | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirmedBooking(null);
    if (customerProfile) {
      setCustomerName((prev) => prev || customerProfile.name);
      setCustomerMobile((prev) => prev || customerProfile.mobile);
      setAddress((prev) => prev || customerProfile.address);
    }
  }, [open, customerProfile]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const validated = validateBulkBookingInput({
      customerName,
      customerMobile,
      address,
      quantity,
      eventDate,
      timeSlot,
      notes,
    });

    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    setSubmitting(true);
    try {
      await submitBulkBookingRequest(validated.booking);
      setConfirmedBooking(validated.booking);
      onSubmitted?.(validated.booking);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not submit bulk booking request. Please try again or call the owner.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="bulk-booking-modal"
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-booking-title"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl max-h-[92vh] overflow-y-auto scroll-touch shadow-xl pb-safe">
        <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-cyan-100 text-cyan-800 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="bulk-booking-title"
                className="font-display text-lg font-bold text-slate-900 leading-tight"
              >
                Events / Function Bulk Order
              </h2>
              <p className="text-xs text-slate-500">
                Weddings, parties, offices &amp; gatherings
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk booking modal"
            className="min-w-[42px] min-h-[42px] rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5 text-slate-600" />
          </button>
        </div>

        <div className="p-5">
          {confirmedBooking ? (
            <div
              data-testid="bulk-booking-confirmed"
              className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-center space-y-3"
            >
              <CheckCircle2
                className="w-12 h-12 text-emerald-600 mx-auto"
                aria-hidden="true"
              />
              <h3 className="font-display text-xl font-extrabold text-emerald-950">
                Bulk Booking Request Sent!
              </h3>
              <p className="text-sm text-emerald-900 leading-relaxed">
                Your request <strong>{confirmedBooking.id}</strong> for{' '}
                <strong>{confirmedBooking.quantity} Water Cans</strong> on{' '}
                <strong>{confirmedBooking.eventDate}</strong> ({confirmedBooking.timeSlot})
                has been sent directly to the DailyDrop Owner.
              </p>
              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <a
                  href={`tel:${supportMobile}`}
                  data-testid="bulk-confirmed-call-owner-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    triggerPhoneCall(supportMobile, true);
                  }}
                  className="flex-1 min-h-[46px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2"
                >
                  <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Call Owner ({supportMobile})</span>
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[46px] px-5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-900 font-bold text-sm cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Water Can Quantity Selector */}
              <div>
                <span className="block text-sm font-bold text-slate-800 mb-2">
                  Select 20L Water Can Quantity
                </span>
                <div
                  role="group"
                  aria-label="Bulk water can quantity presets"
                  className="grid grid-cols-3 gap-2 mb-2.5"
                >
                  {BULK_CAN_PRESETS.map((preset) => {
                    const active = Number(quantity) === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        data-testid={`bulk-qty-preset-${preset}`}
                        onClick={() => setQuantity(String(preset))}
                        className={`min-h-[44px] rounded-xl border font-extrabold text-sm tabular-nums cursor-pointer transition-colors ${
                          active
                            ? 'bg-cyan-700 border-cyan-700 text-white shadow-xs'
                            : 'bg-slate-50 border-slate-300 text-slate-800 hover:border-cyan-500'
                        }`}
                      >
                        {preset} Cans
                      </button>
                    );
                  })}
                </div>
                <label
                  htmlFor="bulk-qty-input"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Or Enter Custom Quantity (Cans)
                </label>
                <input
                  id="bulk-qty-input"
                  data-testid="bulk-qty-input"
                  type="number"
                  min={1}
                  max={10000}
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 35"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm font-bold tabular-nums text-slate-900 focus:outline-none focus:border-cyan-700"
                />
              </div>

              {/* Event Date & Time Slot */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bulk-event-date-input"
                    className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1"
                  >
                    <Calendar className="w-3.5 h-3.5 text-cyan-700" aria-hidden="true" />
                    <span>Event Date</span>
                  </label>
                  <input
                    id="bulk-event-date-input"
                    data-testid="bulk-event-date-input"
                    type="date"
                    required
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-cyan-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bulk-time-slot-select"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Time Slot
                  </label>
                  <select
                    id="bulk-time-slot-select"
                    data-testid="bulk-time-slot-select"
                    value={timeSlot}
                    onChange={(e) => setTimeSlot(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:border-cyan-700"
                  >
                    {EVENT_TIME_SLOTS.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Customer Contact & Venue */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="bulk-customer-name"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    Your Name
                  </label>
                  <input
                    id="bulk-customer-name"
                    data-testid="bulk-customer-name-input"
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Full name"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-cyan-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="bulk-customer-mobile"
                    className="block text-xs font-bold text-slate-700 mb-1"
                  >
                    10-Digit Mobile Number
                  </label>
                  <input
                    id="bulk-customer-mobile"
                    data-testid="bulk-customer-mobile-input"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    required
                    value={customerMobile}
                    onChange={(e) =>
                      setCustomerMobile(e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                    placeholder="98XXXXXXXX"
                    className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm tabular-nums text-slate-900 focus:outline-none focus:border-cyan-700"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="bulk-address-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Event Venue / Delivery Address
                </label>
                <textarea
                  id="bulk-address-input"
                  data-testid="bulk-address-input"
                  rows={2}
                  required
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Function hall name, road, landmark"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-cyan-700"
                />
              </div>

              <div>
                <label
                  htmlFor="bulk-notes-input"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Additional Notes (Optional)
                </label>
                <input
                  id="bulk-notes-input"
                  data-testid="bulk-notes-input"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Dispensers or cold drink crates also needed"
                  className="w-full min-h-[44px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-cyan-700"
                />
              </div>

              {error && (
                <p role="alert" className="text-xs font-semibold text-red-600">
                  {error}
                </p>
              )}

              {/* Direct Owner Contact Info Strip */}
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-2.5 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  Owner Helpline:{' '}
                  <strong className="text-blue-800 tabular-nums">{supportMobile}</strong>
                </span>
                {supportEmail && (
                  <a
                    href={`mailto:${supportEmail}`}
                    data-testid="bulk-support-email-link"
                    className="inline-flex items-center gap-1 text-blue-700 font-semibold hover:underline"
                  >
                    <Mail className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{supportEmail}</span>
                  </a>
                )}
              </div>

              {/* Action Buttons: Call Owner & Book Bulk Order */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <a
                  href={`tel:${supportMobile}`}
                  data-testid="bulk-call-owner-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    triggerPhoneCall(supportMobile, true);
                  }}
                  className="min-h-[48px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Phone className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Call Owner</span>
                </a>

                <button
                  type="submit"
                  disabled={submitting}
                  data-testid="bulk-submit-btn"
                  className="min-h-[48px] px-4 rounded-xl bg-cyan-700 hover:bg-cyan-800 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-60"
                >
                  <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{submitting ? 'Sending Request…' : 'Book Bulk Order'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
