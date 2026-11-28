import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  Headphones,
  History,
  LogOut,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  User,
} from 'lucide-react';
import type { CustomerProfile, Order } from '../../types';
import {
  formatRupees,
  formatTimestamp,
  getStatusLabel,
} from '../../utils/domain';
import { formatFloorLiftSummary } from '../../utils/storeSettings';
import { formatOrderIdLabel } from '../../utils/orderSequence';
import { getOrderPaymentBadge } from '../../utils/payment';
import { copyPhoneNumber, triggerPhoneCall } from '../../utils/androidIntents';
import {
  sanitizeAddressInput,
  sanitizePhone10,
  sanitizeTextInput,
} from '../../utils/security';

export type CustomerMenuPage = 'profile' | 'history' | 'privacy' | 'support';

export const CUSTOMER_SUPPORT_PHONE = '9885138592';
export const CUSTOMER_SUPPORT_HOURS = '10:00 AM – 7:00 PM';
export const CUSTOMER_PRIVACY_POLICY_TEXT =
  '🔒 100% Trustable & Safe App — Every 7 days we clear your completed order data to keep your personal information 100% safe and private.';

interface CustomerMenuPagesProps {
  page: CustomerMenuPage;
  profile: CustomerProfile | null;
  orders: Order[];
  trackMobile: string;
  supportMobile?: string;
  supportEmail?: string;
  onBack: () => void;
  onSaveProfile: (profile: Omit<CustomerProfile, 'updatedAt'>) => void;
  onLogout: () => void;
  onDeleteProfileData: (mobile: string) => Promise<void>;
  onCopyFeedback: (msg: string) => void;
  onOpenFullPrivacy?: () => void;
}

export function CustomerMenuPages({
  page,
  profile,
  orders,
  trackMobile,
  supportMobile = CUSTOMER_SUPPORT_PHONE,
  supportEmail = '',
  onBack,
  onSaveProfile,
  onLogout,
  onDeleteProfileData,
  onCopyFeedback,
  onOpenFullPrivacy,
}: CustomerMenuPagesProps) {
  const activeSupportPhone = supportMobile.trim() || CUSTOMER_SUPPORT_PHONE;
  const activeSupportEmail = supportEmail.trim();
  const [nameInput, setNameInput] = useState(profile?.name ?? '');
  const [mobileInput, setMobileInput] = useState(profile?.mobile ?? trackMobile);
  const [addressInput, setAddressInput] = useState(profile?.address ?? '');
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingData, setDeletingData] = useState(false);

  useEffect(() => {
    setNameInput(profile?.name ?? '');
    setMobileInput(profile?.mobile ?? trackMobile);
    setAddressInput(profile?.address ?? '');
  }, [profile, trackMobile]);

  useEffect(() => {
    setProfileError(null);
    setSavedMsg(null);
    setConfirmDeleteOpen(false);
  }, [page]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError(null);
    setSavedMsg(null);

    const cleanName = sanitizeTextInput(nameInput, 80);
    const cleanMobile = sanitizePhone10(mobileInput);
    const cleanAddress = sanitizeAddressInput(addressInput, 260);

    if (cleanName.length < 2) {
      setProfileError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (!/^\d{10}$/.test(cleanMobile)) {
      setProfileError('Please enter a valid 10-digit mobile number.');
      return;
    }

    onSaveProfile({
      name: cleanName,
      mobile: cleanMobile,
      address: cleanAddress,
    });
    setSavedMsg('Profile saved! Your checkout and order history are now synced.');
  };

  const handleConfirmDeleteProfileData = async () => {
    setDeletingData(true);
    setProfileError(null);
    try {
      const targetMobile = sanitizePhone10(
        profile?.mobile || mobileInput || trackMobile
      );
      await onDeleteProfileData(targetMobile);
      setNameInput('');
      setMobileInput('');
      setAddressInput('');
      setConfirmDeleteOpen(false);
      setSavedMsg('Your profile and personal data have been permanently deleted.');
    } catch (err) {
      setProfileError(
        err instanceof Error
          ? err.message
          : 'Could not delete your profile right now. Please try again.'
      );
    } finally {
      setDeletingData(false);
    }
  };

  const titleByPage: Record<CustomerMenuPage, string> = {
    profile: 'Profile & Login / Logout',
    history: 'Order History',
    privacy: 'Privacy & Data Policy',
    support: 'Customer Support',
  };

  const isLoggedIn = Boolean(profile?.mobile && /^\d{10}$/.test(profile.mobile));

  return (
    <div
      data-testid={`customer-menu-page-${page}`}
      className="fixed inset-0 z-50 bg-slate-50 flex flex-col overflow-hidden"
    >
      <header className="bg-blue-800 text-white px-4 sm:px-6 py-3.5 shadow-sm shrink-0">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            data-testid="customer-menu-back-btn"
            onClick={onBack}
            className="min-h-[42px] px-3 rounded-xl bg-blue-900/70 hover:bg-blue-900 text-white font-bold text-sm flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Back</span>
          </button>
          <h1 className="font-display text-lg sm:text-xl font-extrabold truncate">
            {titleByPage[page]}
          </h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 pb-safe">
        <div className="max-w-3xl mx-auto space-y-4">
          {page === 'profile' && (
            <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
                    <User className="w-6 h-6" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      {isLoggedIn
                        ? profile?.name || 'DailyDrop Customer'
                        : 'Sign In / Save Customer Profile'}
                    </h2>
                    <p className="text-xs text-slate-500">
                      {isLoggedIn
                        ? `Signed in with +91 ${profile?.mobile}`
                        : 'Save your details once for faster checkout and instant order history.'}
                    </p>
                  </div>
                </div>
                {isLoggedIn && (
                  <button
                    type="button"
                    data-testid="customer-profile-logout-btn"
                    onClick={() => {
                      onLogout();
                      setNameInput('');
                      setMobileInput('');
                      setAddressInput('');
                      setSavedMsg('Signed out cleanly from this device.');
                    }}
                    className="min-h-[40px] px-3.5 rounded-xl bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <LogOut className="w-4 h-4" aria-hidden="true" />
                    <span>Logout</span>
                  </button>
                )}
              </div>

              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label
                    htmlFor="profile-name-input"
                    className="block text-sm font-semibold text-slate-800 mb-1"
                  >
                    Full Name
                  </label>
                  <input
                    id="profile-name-input"
                    type="text"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-mobile-input"
                    className="block text-sm font-semibold text-slate-800 mb-1"
                  >
                    Phone Number (10 Digits)
                  </label>
                  <input
                    id="profile-mobile-input"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    required
                    value={mobileInput}
                    onChange={(e) =>
                      setMobileInput(e.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                    placeholder="e.g. 9848012345"
                    className="w-full min-h-[46px] px-3.5 rounded-xl border border-slate-300 text-sm text-slate-900 tabular-nums focus:outline-none focus:border-blue-700"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-address-input"
                    className="block text-sm font-semibold text-slate-800 mb-1"
                  >
                    Saved Delivery Address
                  </label>
                  <textarea
                    id="profile-address-input"
                    rows={3}
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    placeholder="House/Flat No., Building Name, Nearby Landmark"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:border-blue-700"
                  />
                </div>

                {profileError && (
                  <p role="alert" className="text-xs font-semibold text-red-600">
                    {profileError}
                  </p>
                )}

                {savedMsg && (
                  <div
                    role="status"
                    data-testid="customer-profile-status-msg"
                    className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-xs font-semibold text-emerald-900 flex items-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                    <span>{savedMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="save-customer-profile-btn"
                  className="w-full min-h-[48px] rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" aria-hidden="true" />
                  <span>{isLoggedIn ? 'Update Profile' : 'Save & Sign In'}</span>
                </button>
              </form>

              {/* Google Play Store Self-Service Account & Personal Data Deletion */}
              <div className="pt-4 border-t border-slate-200 space-y-2.5">
                <div>
                  <h3 className="text-sm font-bold text-red-800 flex items-center gap-1.5">
                    <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Delete My Profile &amp; Data</span>
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Permanently erase your saved customer profile from our database, clear
                    this device&apos;s stored profile, and remove personal delivery details
                    from your completed orders.
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="delete-customer-data-btn"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="w-full min-h-[46px] px-4 rounded-xl bg-red-50 hover:bg-red-100 border border-red-300 text-red-800 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Delete My Profile &amp; Data</span>
                </button>
              </div>
            </section>
          )}

          {page === 'history' && (
            <section className="space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
                    <History className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold text-slate-900">
                      Your Order History
                    </h2>
                    <p className="text-xs text-slate-500">
                      Read-only summary of orders placed with your phone number.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold text-slate-500 uppercase">
                    Total Orders
                  </p>
                  <p
                    data-testid="customer-history-total-count"
                    className="font-display text-2xl font-extrabold text-blue-800 tabular-nums"
                  >
                    {orders.length}
                  </p>
                </div>
              </div>

              {orders.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
                  <p className="font-semibold text-slate-900">
                    No order history found yet
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Save your 10-digit phone number in Profile or place an order to see
                    your history here.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => {
                    const badge = getOrderPaymentBadge(order);
                    const floorSummary = formatFloorLiftSummary(order);
                    return (
                      <article
                        key={order.id}
                        className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                          <div>
                            <p className="text-xs font-semibold text-slate-500 tabular-nums flex flex-wrap items-center gap-1.5">
                              <strong className="text-blue-900 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md font-extrabold">
                                {formatOrderIdLabel(order)}
                              </strong>
                              <span>· {formatTimestamp(order.createdAt)}</span>
                            </p>
                            <p className="font-display text-base font-bold text-slate-900 mt-1">
                              {getStatusLabel(order.status)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-display text-lg font-extrabold text-blue-800 tabular-nums">
                              {formatRupees(order.totalAmount)}
                            </p>
                            <span
                              className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-md ${
                                badge.kind === 'upi_pending'
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>

                        <div className="text-sm text-slate-800 font-medium space-y-1">
                          {order.items.map((item, idx) => (
                            <div
                              key={`${order.id}-${item.productId}-${idx}`}
                              className="flex items-center justify-between gap-2 text-xs sm:text-sm"
                            >
                              <span>
                                {item.quantity} × {item.name}
                              </span>
                              <span className="tabular-nums font-semibold">
                                {formatRupees(item.price * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>

                        {floorSummary && (
                          <div className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-blue-700 shrink-0" />
                            <span>Floor &amp; Lift: {floorSummary}</span>
                          </div>
                        )}

                        <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2 tabular-nums">
                          <span>
                            Items {formatRupees(order.itemsSubtotal ?? order.totalAmount)}
                          </span>
                          {(order.platformFee ?? 0) > 0 && (
                            <span>· Platform {formatRupees(order.platformFee!)}</span>
                          )}
                          {(order.deliveryFee ?? 0) > 0 && (
                            <span>· Delivery {formatRupees(order.deliveryFee!)}</span>
                          )}
                          {(order.floorCharge ?? 0) > 0 && (
                            <span>· Floor {formatRupees(order.floorCharge!)}</span>
                          )}
                          <span className="inline-flex items-center gap-1 text-slate-700 font-semibold">
                            <Banknote className="w-3.5 h-3.5 text-emerald-700" />
                            {badge.shortLabel}
                          </span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {page === 'privacy' && (
            <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-6 h-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    Privacy &amp; Data Protection
                  </h2>
                  <p className="text-xs text-slate-500">
                    DailyDrop Water · Customer Data Safety Guarantee
                  </p>
                </div>
              </div>

              <div
                data-testid="customer-privacy-statement"
                className="rounded-2xl bg-emerald-50 border border-emerald-300 p-4 text-sm font-bold text-emerald-950 leading-relaxed"
              >
                {CUSTOMER_PRIVACY_POLICY_TEXT}
              </div>

              <div className="space-y-2 text-sm text-slate-700 leading-relaxed">
                <p>
                  • Your name, phone number, address, and GPS location are used strictly
                  to verify delivery coverage and deliver your water cans accurately.
                </p>
                <p>
                  • Completed orders older than 7 days are automatically cleaned of
                  personal delivery details while retaining only anonymized financial
                  accounting totals.
                </p>
                <p>
                  • We never sell, rent, or share your phone number with third-party
                  advertisers.
                </p>
              </div>

              {onOpenFullPrivacy && (
                <button
                  type="button"
                  onClick={onOpenFullPrivacy}
                  className="min-h-[44px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs cursor-pointer"
                >
                  Read Full Play Store Privacy Policy
                </button>
              )}
            </section>
          )}

          {page === 'support' && (
            <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-800 flex items-center justify-center shrink-0">
                  <Headphones className="w-6 h-6" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    DailyDrop Customer Support
                  </h2>
                  <p className="text-xs text-slate-500">
                    DailyDrop Water &amp; Cold Drinks Help Desk
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-blue-700" aria-hidden="true" />
                    <span>Support Timing</span>
                  </p>
                  <p
                    data-testid="support-timing"
                    className="font-display text-base font-extrabold text-slate-900 mt-1"
                  >
                    {CUSTOMER_SUPPORT_HOURS}
                  </p>
                </div>

                <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-blue-700" aria-hidden="true" />
                    <span>Call Support</span>
                  </p>
                  <p
                    data-testid="support-phone"
                    className="font-display text-base font-extrabold text-blue-800 tabular-nums mt-1"
                  >
                    {activeSupportPhone}
                  </p>
                </div>

                {activeSupportEmail && (
                  <div className="sm:col-span-2 rounded-2xl bg-slate-50 border border-slate-200 p-4">
                    <p className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                      <Mail className="w-4 h-4 text-blue-700" aria-hidden="true" />
                      <span>Support Email</span>
                    </p>
                    <a
                      href={`mailto:${activeSupportEmail}`}
                      data-testid="support-email"
                      className="font-display text-base font-extrabold text-blue-800 hover:underline mt-1 inline-block break-all"
                    >
                      {activeSupportEmail}
                    </a>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2.5">
                <a
                  href={`tel:${activeSupportPhone}`}
                  data-testid="support-call-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    triggerPhoneCall(activeSupportPhone, true);
                  }}
                  className="flex-1 min-h-[50px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  <Phone className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Call Support ({activeSupportPhone})</span>
                </a>
                <button
                  type="button"
                  data-testid="support-copy-btn"
                  onClick={() =>
                    void copyPhoneNumber(activeSupportPhone, onCopyFeedback)
                  }
                  className="min-h-[50px] px-5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
                >
                  <Copy className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
                  <span>Copy Number</span>
                </button>
              </div>
            </section>
          )}
        </div>
      </main>

      {confirmDeleteOpen && (
        <div
          data-testid="confirm-delete-customer-data-modal"
          className="fixed inset-0 z-[70] bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-data-title"
        >
          <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 space-y-4 pb-safe">
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" aria-hidden="true" />
              </div>
              <div>
                <h2
                  id="confirm-delete-data-title"
                  className="font-display text-lg font-extrabold text-slate-900"
                >
                  Permanently Delete Profile &amp; Data?
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                  This removes your saved name, phone number, and address from DailyDrop
                  Water and anonymizes personal details on your completed orders. Any
                  active order currently out for delivery will not be disrupted.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <button
                type="button"
                disabled={deletingData}
                data-testid="confirm-delete-customer-data-btn"
                onClick={() => void handleConfirmDeleteProfileData()}
                className="flex-1 min-h-[48px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{deletingData ? 'Deleting…' : 'Yes, Delete My Data'}</span>
              </button>
              <button
                type="button"
                disabled={deletingData}
                data-testid="cancel-delete-customer-data-btn"
                onClick={() => setConfirmDeleteOpen(false)}
                className="min-h-[48px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
