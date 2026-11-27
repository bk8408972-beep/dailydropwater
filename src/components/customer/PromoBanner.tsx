import { useEffect, useState } from 'react';
import { ArrowRight, ExternalLink, Mail, Phone } from 'lucide-react';
import type { StoreSettings } from '../../types';
import {
  DEFAULT_PROMO_BANNER_BUTTON_TEXT,
  DEFAULT_PROMO_BANNER_INTERVAL_MINUTES,
  resolvePromoActionTarget,
  sanitizePromoBannerButtonText,
  sanitizePromoBannerIntervalMinutes,
  shouldShowPromoBanner,
} from '../../utils/customerFeatures';
import { triggerPhoneCall } from '../../utils/androidIntents';

interface PromoBannerProps {
  settings: Pick<
    StoreSettings,
    | 'promoBannerEnabled'
    | 'promoBannerText'
    | 'promoBannerButtonText'
    | 'promoBannerActionUrl'
    | 'promoBannerIntervalMinutes'
    | 'promoBannerPhone'
  >;
}

/**
 * Slim (~70px high, search-bar-sized) Running Rider Ad Banner for the Customer App.
 * An animated scooter rider pulls the offer placard + working CTA button across the strip
 * and repeats the ride-in animation at the Owner's configured interval (default 1 min).
 */
export function PromoBanner({ settings }: PromoBannerProps) {
  const isVisible = shouldShowPromoBanner(settings);
  const intervalMinutes = sanitizePromoBannerIntervalMinutes(
    settings.promoBannerIntervalMinutes,
    DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
  );
  const [runCount, setRunCount] = useState(1);

  useEffect(() => {
    if (!isVisible) return;
    const intervalMs = intervalMinutes * 60_000;
    const timer = window.setInterval(() => {
      setRunCount((prev) => prev + 1);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isVisible, intervalMinutes]);

  if (!isVisible) {
    return null;
  }

  const offerText = settings.promoBannerText.trim();
  const buttonText = sanitizePromoBannerButtonText(
    settings.promoBannerButtonText,
    DEFAULT_PROMO_BANNER_BUTTON_TEXT
  );
  const actionTarget = resolvePromoActionTarget(
    settings.promoBannerActionUrl,
    settings.promoBannerPhone
  );

  const ctaBaseClasses =
    'inline-flex items-center gap-1 px-2.5 sm:px-3.5 h-8 rounded-lg bg-blue-700 hover:bg-blue-800 active:scale-[0.98] text-white text-[11px] sm:text-xs font-extrabold whitespace-nowrap shrink-0 shadow-xs transition-colors cursor-pointer';

  const renderActionButton = () => {
    if (actionTarget.kind === 'external') {
      return (
        <a
          href={actionTarget.href}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="customer-promo-banner-cta"
          className={ctaBaseClasses}
        >
          <span>{buttonText}</span>
          <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
        </a>
      );
    }

    if (actionTarget.kind === 'tel') {
      return (
        <a
          href={actionTarget.href}
          data-testid="customer-promo-banner-cta"
          onClick={(e) => {
            if (actionTarget.phone10) {
              e.preventDefault();
              triggerPhoneCall(actionTarget.phone10);
            }
          }}
          className={ctaBaseClasses}
        >
          <Phone className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{buttonText}</span>
        </a>
      );
    }

    if (actionTarget.kind === 'mailto') {
      return (
        <a
          href={actionTarget.href}
          data-testid="customer-promo-banner-cta"
          className={ctaBaseClasses}
        >
          <Mail className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{buttonText}</span>
        </a>
      );
    }

    return (
      <button
        type="button"
        data-testid="customer-promo-banner-cta"
        onClick={() => {
          const catalogEl = document.getElementById('customer-catalog');
          if (catalogEl) {
            catalogEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }}
        className={ctaBaseClasses}
      >
        <span>{buttonText}</span>
        <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
      </button>
    );
  };

  return (
    <section aria-label="Running Rider Offer Banner" className="mb-4">
      <div
        data-testid="customer-promo-banner"
        data-interval-minutes={intervalMinutes}
        data-run-count={runCount}
        className="relative h-[70px] w-full rounded-2xl border border-blue-200 bg-gradient-to-r from-sky-50 via-blue-50/90 to-amber-50/80 shadow-xs overflow-hidden flex items-center px-2 sm:px-3 pb-1.5"
      >
        {/* Subtle Road Track along bottom edge */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[7px] bg-slate-800/90 flex items-center"
        >
          <div className="w-full h-[2px] dd-road-dashes opacity-90" />
        </div>

        {/* Animated Rider + Pulled Offer Banner Train (replays every saved interval) */}
        <div
          key={runCount}
          className="dd-rider-train relative z-10 w-full flex items-center gap-0 min-w-0"
        >
          {/* Pulled Ad Placard */}
          <div className="flex-1 min-w-0 h-[50px] rounded-xl border border-amber-300/90 bg-white/95 px-2.5 sm:px-3.5 shadow-xs flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                data-testid="customer-promo-banner-text"
                className="text-[11px] sm:text-sm font-extrabold text-slate-900 leading-tight line-clamp-2"
              >
                {offerText}
              </p>
            </div>
            {renderActionButton()}
          </div>

          {/* Tow Hitch Bar Connecting Banner to Scooter */}
          <div
            aria-hidden="true"
            className="flex items-center shrink-0 -mx-0.5"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 border border-slate-700" />
            <span className="w-2.5 sm:w-4 h-[3px] bg-slate-700" />
          </div>

          {/* Animated Delivery Scooter Rider SVG */}
          <div className="dd-scooter-bob shrink-0 flex items-end">
            <svg
              data-testid="running-rider-scooter-svg"
              viewBox="0 0 88 56"
              className="w-[66px] sm:w-[78px] h-[48px] sm:h-[52px] shrink-0 overflow-visible"
              role="img"
              aria-label="DailyDrop delivery rider pulling offer banner"
            >
              {/* Motion Wind Streaks */}
              <line
                x1="1"
                y1="22"
                x2="10"
                y2="22"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinecap="round"
                opacity="0.85"
              />
              <line
                x1="3"
                y1="30"
                x2="11"
                y2="30"
                stroke="#0284c7"
                strokeWidth="1.8"
                strokeLinecap="round"
                opacity="0.7"
              />

              {/* Rear 20L Water Can Crate */}
              <rect
                x="11"
                y="17"
                width="14"
                height="17"
                rx="3"
                fill="#0ea5e9"
                stroke="#0369a1"
                strokeWidth="1.5"
              />
              <rect x="14.5" y="13.5" width="7" height="3.5" rx="1" fill="#0284c7" />
              <line x1="12.5" y1="23" x2="23.5" y2="23" stroke="#bae6fd" strokeWidth="1.5" />

              {/* Rider Torso & Arms */}
              <path
                d="M34 18 L43 18 L47 29 L33 29 Z"
                fill="#0284c7"
                stroke="#0c4a6e"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
              {/* Rider Arm Reaching Handlebar */}
              <path
                d="M42 21 L56 22"
                stroke="#0c4a6e"
                strokeWidth="3"
                strokeLinecap="round"
              />
              {/* Rider Head + DailyDrop Blue Helmet */}
              <circle cx="40" cy="11.5" r="6" fill="#fed7aa" />
              <path
                d="M33.5 11.5 C33.5 6.8 37 4.5 41.5 4.8 C45 5.1 46.8 8 46.8 10.8 L34 10.8 Z"
                fill="#1d4ed8"
                stroke="#1e3a8a"
                strokeWidth="1"
              />
              {/* Helmet Visor */}
              <path d="M41.5 9.2 L46.8 9.8 L45.6 12.2 L41.5 11.5 Z" fill="#38bdf8" />

              {/* Scooter Body & Footboard */}
              <path
                d="M14 35 L33 35 L42 38 L58 38 L61 23 L66 23 L69 39 L74 41 L74 44 L16 44 L14 39 Z"
                fill="#2563eb"
                stroke="#1e3a8a"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              {/* Scooter Seat */}
              <rect x="27" y="31" width="16" height="4.5" rx="2" fill="#0f172a" />
              {/* Handlebar & Headlight */}
              <path
                d="M55 21 L63 21"
                stroke="#0f172a"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="67.5" cy="24.5" r="2.8" fill="#fef08a" stroke="#f59e0b" strokeWidth="1" />
              {/* Headlight Beam */}
              <polygon points="70,22.5 85,18 85,31 70,26.5" fill="#fde047" opacity="0.28" />

              {/* Rear Spinning Wheel */}
              <g className="dd-wheel-rotor">
                <circle cx="25" cy="45" r="7.5" fill="#0f172a" />
                <circle cx="25" cy="45" r="4" fill="#e2e8f0" />
                <line x1="25" y1="41" x2="25" y2="49" stroke="#475569" strokeWidth="1.4" />
                <line x1="21" y1="45" x2="29" y2="45" stroke="#475569" strokeWidth="1.4" />
              </g>

              {/* Front Spinning Wheel */}
              <g className="dd-wheel-rotor">
                <circle cx="67" cy="45" r="7.5" fill="#0f172a" />
                <circle cx="67" cy="45" r="4" fill="#e2e8f0" />
                <line x1="67" y1="41" x2="67" y2="49" stroke="#475569" strokeWidth="1.4" />
                <line x1="63" y1="45" x2="71" y2="45" stroke="#475569" strokeWidth="1.4" />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
