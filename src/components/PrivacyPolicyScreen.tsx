import { ArrowLeft, Lock, MapPin, Phone, ShieldCheck, Trash2 } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

interface PrivacyPolicyScreenProps {
  onBackToApp: () => void;
}

export function PrivacyPolicyScreen({ onBackToApp }: PrivacyPolicyScreenProps) {
  return (
    <div className="app-scroll-page min-h-screen bg-slate-50 flex flex-col pb-safe">
      <header className="sticky top-0 z-30 bg-blue-800 text-white shadow-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size="sm" />
            <div className="min-w-0">
              <span className="font-display text-base sm:text-lg font-extrabold tracking-tight block leading-tight truncate">
                DailyDrop Water
              </span>
              <span className="text-[11px] text-cyan-200 block leading-tight truncate">
                Water &amp; Cold Drinks Delivery • Tolichowki, Hyderabad
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
              <span>Google Play &amp; Customer Data Transparency</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-slate-900">
              Privacy Policy — DailyDrop Water
            </h1>
            <p className="text-sm text-slate-500 mt-1.5">
              Effective Date: November 2026 · Service Area: Tolichowki, Hyderabad (3 km Radius)
            </p>
          </div>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>1. Information We Collect</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              <strong>DailyDrop Water (Tolichowki, Hyderabad)</strong> collects only the
              minimum customer details strictly required to fulfill drinking water and
              cold drink orders within our 3 km Tolichowki delivery zone:
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
                <strong>Delivery Location (Address &amp; GPS Coordinates):</strong> Used
                strictly to verify the 3 km Tolichowki delivery radius and guide your
                assigned rider to your doorstep.
              </li>
            </ul>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>2. Weekly (Every 7 Days) Permanent Data Deletion</span>
            </h2>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-950 leading-relaxed">
              <strong>DailyDrop Water permanently deletes all completed customer order
              records and personal details weekly (every 7 days).</strong> Once orders are
              completed (Delivered or Rejected), all associated customer names, mobile
              numbers, delivery addresses, GPS pins, and delivery proof photos are permanently
              purged from our order database during our weekly cleanup.
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              No customer personal data is kept long-term, archived for profiling, or
              retained beyond active order fulfillment and our 7-day weekly cleanup cycle.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>3. Zero Third-Party Sharing</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              Your name, 10-digit mobile number, and delivery location are used strictly
              for fulfilling your water and cold drink orders in Tolichowki, Hyderabad. We
              <strong> never sell, rent, or share</strong> customer personal information
              with third-party advertisers, marketing agencies, or external data brokers.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0" aria-hidden="true" />
              <span>4. Security &amp; Immediate Deletion Requests</span>
            </h2>
            <p className="text-sm text-slate-700 leading-relaxed">
              All order traffic is encrypted over HTTPS, and customer GPS location is
              never tracked in the background. In addition to our weekly (every 7 days)
              permanent cleanup, you can request immediate deletion of your order details
              at any time by contacting the DailyDrop Water store team in Tolichowki.
            </p>
            <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 text-sm text-blue-950 flex items-start gap-2.5">
              <Phone className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">DailyDrop Water — Tolichowki, Hyderabad</p>
                <p className="text-xs text-blue-800 mt-0.5">
                  Water &amp; Cold Drinks Delivery • Weekly (Every 7 Days) Customer Data Deletion
                </p>
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
