import { Copy, LocateFixed, MapPin, Navigation, X } from 'lucide-react';
import {
  buildGoogleMapEmbedUrl,
  buildGoogleMapsDrivingDirectionsUrl,
  copyLocationText,
} from '../utils/androidIntents';

export interface MapModalTarget {
  title: string;
  subtitle?: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
}

interface InAppMapModalProps {
  target: MapModalTarget | null;
  onClose: () => void;
  onCopied: (message: string) => void;
}

export function InAppMapModal({
  target,
  onClose,
  onCopied,
}: InAppMapModalProps) {
  if (!target) return null;

  const hasCoords =
    typeof target.lat === 'number' &&
    typeof target.lng === 'number' &&
    Number.isFinite(target.lat) &&
    Number.isFinite(target.lng);

  const embedUrl = buildGoogleMapEmbedUrl({
    lat: target.lat,
    lng: target.lng,
    address: target.address,
  });

  const mapsUrl = buildGoogleMapsDrivingDirectionsUrl({
    lat: target.lat,
    lng: target.lng,
    address: target.address,
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/65 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="in-app-map-modal-title"
      data-testid="in-app-map-modal"
    >
      <div className="w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto scroll-touch shadow-xl pb-safe">
        <div className="sticky top-0 z-10 bg-white px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              id="in-app-map-modal-title"
              className="font-display text-lg font-bold text-slate-900 flex items-center gap-2 truncate"
            >
              <Navigation className="w-4 h-4 text-emerald-700 shrink-0" aria-hidden="true" />
              <span className="truncate">{target.title}</span>
            </h2>
            {target.subtitle && (
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {target.subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close map modal"
            className="min-w-[44px] min-h-[44px] rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-5 h-5 text-slate-700" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Clickable Map Preview Box wrapped in real <a> link so tapping opens Google Maps directly */}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="map-modal-preview-link"
            aria-label="Open customer location in Google Maps for turn-by-turn directions"
            className="block relative group w-full h-[260px] sm:h-[300px] rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 cursor-pointer"
          >
            <iframe
              src={embedUrl}
              title={target.title}
              tabIndex={-1}
              className="w-full h-full border-0 pointer-events-none"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              data-testid="in-app-map-iframe"
            />
            <span className="pointer-events-none absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-slate-950/85 text-white text-xs font-bold shadow-md">
              Tap map to navigate →
            </span>
          </a>

          {/* Full Address & Optional GPS Coordinates */}
          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <MapPin className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Full Delivery Address
                </p>
                <p className="text-sm font-semibold text-slate-900 mt-0.5 leading-snug break-words">
                  {target.address}
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                <LocateFixed className="w-3.5 h-3.5 text-cyan-700 shrink-0" aria-hidden="true" />
                <span>GPS Coordinates</span>
              </span>
              {hasCoords ? (
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {target.lat!.toFixed(6)}, {target.lng!.toFixed(6)}
                </span>
              ) : (
                <span className="text-slate-500 font-medium">
                  Not shared (Address-only)
                </span>
              )}
            </div>
          </div>

          {/* Primary Green Open in Google Maps link directly above Secondary Copy Location button */}
          <div className="space-y-2.5">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="map-modal-open-google-maps-link"
              className="w-full min-h-[52px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <span>🧭 Open in Google Maps</span>
            </a>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                data-testid="map-modal-copy-location-btn"
                onClick={() =>
                  void copyLocationText(
                    {
                      lat: target.lat,
                      lng: target.lng,
                      address: target.address,
                    },
                    onCopied
                  )
                }
                className="sm:col-span-2 min-h-[46px] px-4 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Copy className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Copy Location</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="min-h-[46px] px-4 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-sm cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
