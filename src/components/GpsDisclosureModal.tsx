import { LocateFixed, MapPin, ShieldCheck, X } from 'lucide-react';

interface GpsDisclosureModalProps {
  open: boolean;
  deliveryRadiusKm: number;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Google Play Store Prominent Location Disclosure Popup.
 * Shown before requesting device GPS coordinates so users clearly understand
 * why DailyDrop collects foreground location and how their data is protected.
 */
export function GpsDisclosureModal({
  open,
  deliveryRadiusKm,
  onAccept,
  onDecline,
}: GpsDisclosureModalProps) {
  if (!open) return null;

  return (
    <div
      data-testid="gps-disclosure-modal"
      className="fixed inset-0 z-[70] bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gps-disclosure-title"
    >
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden pb-safe">
        <div className="bg-blue-800 text-white px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-400 text-blue-950 flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="gps-disclosure-title"
                className="font-display text-lg font-extrabold leading-tight"
              >
                Location Access Notice
              </h2>
              <p className="text-[11px] text-cyan-200 font-medium">
                DailyDrop Water · Foreground GPS Only
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDecline}
            aria-label="Close location notice"
            className="min-w-[40px] min-h-[40px] rounded-xl hover:bg-blue-900 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-800 leading-relaxed">
            <strong>DailyDrop Water</strong> collects your precise location{' '}
            <strong>only while the app is open</strong> to:
          </p>

          <ul className="space-y-2.5 text-sm text-slate-700">
            <li className="flex items-start gap-2.5">
              <LocateFixed
                className="w-4 h-4 text-blue-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>
                Check if your doorstep is within our active{' '}
                <strong>{deliveryRadiusKm} km delivery radius</strong> and show
                your current area name.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <MapPin
                className="w-4 h-4 text-cyan-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>
                Share your delivery pin with your assigned DailyDrop rider for
                accurate 15–25 minute doorstep delivery.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck
                className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <span>
                Your location is <strong>never tracked in the background</strong>,
                never sold to advertisers, and automatically deleted after 7 days
                once your order is completed.
              </span>
            </li>
          </ul>

          <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              data-testid="gps-disclosure-accept-btn"
              onClick={onAccept}
              className="flex-1 min-h-[48px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Allow &amp; Continue</span>
            </button>
            <button
              type="button"
              data-testid="gps-disclosure-decline-btn"
              onClick={onDecline}
              className="min-h-[48px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm cursor-pointer transition-colors"
            >
              Not Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
