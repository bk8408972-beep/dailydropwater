import { ArrowLeft, Copy, Lock, Mail, MapPin, Phone, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { copyPhoneNumber, triggerPhoneCall } from '../utils/androidIntents';
import {
  CUSTOMER_SUPPORT_HOURS,
  CUSTOMER_SUPPORT_PHONE,
} from './customer/CustomerMenuPages';
import { subscribePath } from '../services/firebaseDb';
import { normalizeStoreSettings } from '../utils/storeSettings';
import type { StoreSettings } from '../types';

interface PrivacyPolicyScreenProps {
  onBackToApp: () => void;
}

export function PrivacyPolicyScreen({ onBackToApp }: PrivacyPolicyScreenProps) {
  const [copiedMsg, setCopiedMsg] = useState<string | null>(null);
  const [supportMobile, setSupportMobile] = useState(CUSTOMER_SUPPORT_PHONE);
  const [supportEmail, setSupportEmail] = useState('');

  useEffect(() => {
    let active = true;
    const unsub = subscribePath<Partial<StoreSettings>>('storeSettings', (raw) => {
      if (!active) return;
      const normalized = normalizeStoreSettings(raw);
      setSupportMobile(normalized.supportMobile || CUSTOMER_SUPPORT_PHONE);
      setSupportEmail(normalized.supportEmail || '');
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return (
    <div
      data-testid="public-privacy-policy-page"
      className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-safe"
    >
      <header className="sticky top-0 z-30 bg-blue-800 text-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <span className="font-display text-base sm:text-lg font-extrabold tracking-tight block leading-tight truncate">
                DailyDrop Water
              </span>
              <span className="text-[11px] text-cyan-200 block leading-tight truncate">
                Water &amp; Cold Drinks Delivery · Privacy &amp; Data Safety
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onBackToApp}
            className="min-h-[40px] px-3.5 rounded-xl bg-white text-blue-900 hover:bg-cyan-50 font-bold text-xs sm:text-sm flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Back to App</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <article className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <div className="inline-flex items-center gap-2 text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">
              <ShieldCheck className="w-4 h-4 text-cyan-600" aria-hidden="true" />
              <span>Google Play Store &amp; Customer Data Transparency</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900">
              Privacy Policy — DailyDrop Water
            </h1>
            <p className="text-sm text-slate-500 mt-1.5">
              Effective Date: November 2026 · Public Policy URL: ?app=privacy
            </p>
          </div>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>1. Information We Collect</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              <strong>DailyDrop Water</strong> collects only the minimum customer details
              strictly required to fulfill drinking water and cold drink deliveries within
              our active local delivery radius:
            </p>
            <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1.5 leading-relaxed">
              <li>
                <strong>Customer Name:</strong> Used to identify your order and deliver
                accurately to your home or event venue.
              </li>
              <li>
                <strong>10-Digit Mobile Number:</strong> Used strictly to confirm orders,
                enable rider delivery coordination, and allow live status lookup in{' '}
                <strong>My Orders</strong>.
              </li>
              <li>
                <strong>Delivery Location (Address &amp; Foreground GPS Coordinates):</strong>{' '}
                Requested only after displaying an in-app prominent disclosure popup, and
                used strictly while the app is open to verify delivery radius eligibility,
                display your local area name, and guide your assigned rider to your doorstep.
                We never track customer GPS in the background.
              </li>
              <li>
                <strong>Payment Information:</strong> We support Cash on Delivery (COD) and
                optional direct UPI transfers. For UPI orders, we only store the 12-digit
                UTR transaction reference you submit for store verification — we never
                collect or store UPI PINs, bank passwords, or card numbers.
              </li>
            </ul>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>2. Automatic 7-Day Data Cleanup</span>
            </h2>
            <div
              data-testid="privacy-7day-cleanup-box"
              className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-950 leading-relaxed"
            >
              <strong>
                DailyDrop Water automatically clears completed customer order details and
                personal information every 7 days.
              </strong>{' '}
              Once orders are completed (Delivered or Rejected), associated customer names,
              mobile numbers, delivery addresses, GPS coordinates, and delivery proof photos
              are permanently purged during our 7-day cleanup cycle, retaining only
              anonymized financial totals for store accounting.
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              No customer personal data is kept indefinitely, profiled for advertising, or
              shared with external data brokers.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <UserX className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>3. Instant Self-Service Account &amp; Data Deletion</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              You do not have to wait 7 days to erase your profile. At any time, open the{' '}
              <strong>Customer App (⋮ Menu → Profile &amp; Login / Logout)</strong> and tap{' '}
              <strong>&ldquo;Delete My Profile &amp; Data&rdquo;</strong> to immediately delete
              your saved customer profile from our database, clear all local device data, and
              anonymize personal details on your completed orders.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>4. Zero Third-Party Selling &amp; Security</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              All communication is encrypted over HTTPS. We{' '}
              <strong>never sell, rent, or trade</strong> your mobile number, address, or
              location with third-party advertisers or marketing networks. No passwords are
              ever saved in browser or device local storage.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Phone className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>5. Contact &amp; Data Privacy Support</span>
            </h2>
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-950 space-y-3">
              <div>
                <p className="font-bold">DailyDrop Water — Customer Support Desk</p>
                <p className="text-xs text-blue-800 mt-0.5">
                  Support Hours: {CUSTOMER_SUPPORT_HOURS} · Phone: {supportMobile}
                  {supportEmail ? ` · Email: ${supportEmail}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`tel:${supportMobile}`}
                  data-testid="privacy-support-call-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    triggerPhoneCall(supportMobile, true);
                  }}
                  className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs inline-flex items-center gap-1.5 transition-colors"
                >
                  <Phone className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Call {supportMobile}</span>
                </a>
                {supportEmail && (
                  <a
                    href={`mailto:${supportEmail}`}
                    className="min-h-[42px] px-3.5 rounded-xl bg-white hover:bg-blue-100 border border-blue-300 text-blue-900 font-bold text-xs inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>{supportEmail}</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void copyPhoneNumber(supportMobile, (msg) => {
                      setCopiedMsg(msg);
                      window.setTimeout(() => setCopiedMsg(null), 2200);
                    });
                  }}
                  className="min-h-[42px] px-3.5 rounded-xl bg-white hover:bg-blue-100 border border-blue-300 text-blue-900 font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{copiedMsg || 'Copy Number'}</span>
                </button>
              </div>
            </div>
          </section>

          <div className="pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onBackToApp}
              className="min-h-[48px] px-6 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm inline-flex items-center gap-2 cursor-pointer transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              <span>Return to DailyDrop Water</span>
            </button>
          </div>
        </article>
      </main>
    </div>
  );
}
