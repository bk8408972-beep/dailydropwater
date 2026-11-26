import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Crosshair, MapPin, Navigation, Phone } from 'lucide-react';
import type { GeoPoint, RiderLiveLocation } from '../types';
import {
  calculateHaversineKm,
  estimateEtaMinutes,
  formatRelativeTime,
  formatShortDistanceKm,
  isValidGeoPoint,
  TOLICHOWKI_CENTER,
} from '../utils/geo';
import {
  buildPhoneCallUrl,
  buildTrackRiderMapUrl,
  copyPhoneNumber,
  formatDisplayPhone10,
  formatIndianPhoneE164,
} from '../utils/androidIntents';
import {
  createHomePinIcon,
  createScooterPinIcon,
  escapeHtml,
  loadLeaflet,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  type LeafletMap,
  type LeafletMarker,
  type LeafletPolyline,
  type LeafletStatic,
} from '../utils/leafletLoader';

interface LiveOrderMapProps {
  orderId: string;
  customerLocation?: GeoPoint | null;
  customerAddress: string;
  riderLocation?: RiderLiveLocation | null;
  riderName: string;
  riderId?: string | null;
  riderMobile?: string | null;
  showExternalTrackButton?: boolean;
  onCallFeedback?: (msg: string) => void;
}

export function LiveOrderMap({
  orderId,
  customerLocation,
  customerAddress,
  riderLocation,
  riderName,
  riderId,
  riderMobile,
  showExternalTrackButton = false,
  onCallFeedback,
}: LiveOrderMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletStatic | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const riderMarkerRef = useRef<LeafletMarker | null>(null);
  const homeMarkerRef = useRef<LeafletMarker | null>(null);
  const routeLineRef = useRef<LeafletPolyline | null>(null);
  const hasFittedRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const hasExactCustomerGps = isValidGeoPoint(customerLocation);
  const homePoint: GeoPoint = hasExactCustomerGps
    ? { lat: customerLocation!.lat, lng: customerLocation!.lng }
    : { lat: TOLICHOWKI_CENTER.lat, lng: TOLICHOWKI_CENTER.lng };

  const hasRiderGps = isValidGeoPoint(riderLocation);

  const distanceInfo = useMemo(() => {
    if (!hasRiderGps || !riderLocation) return null;
    const km = calculateHaversineKm(
      riderLocation.lat,
      riderLocation.lng,
      homePoint.lat,
      homePoint.lng
    );
    return {
      km,
      distanceLabel: formatShortDistanceKm(km),
      etaMinutes: estimateEtaMinutes(km),
    };
  }, [hasRiderGps, riderLocation, homePoint.lat, homePoint.lng]);

  // Keep relative timestamp fresh every 5s
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Initialize Leaflet map once
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        leafletRef.current = L;
        const map = L.map(containerRef.current, {
          center: [homePoint.lat, homePoint.lng],
          zoom: 15,
          zoomControl: true,
          attributionControl: true,
        });
        L.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION,
          maxZoom: 19,
        }).addTo(map);
        mapRef.current = map;
        setMapReady(true);
        // Ensure container dimensions settle properly inside cards/tabs
        window.setTimeout(() => {
          map.invalidateSize();
        }, 120);
      })
      .catch((err) => {
        if (!cancelled) {
          setMapError(
            err instanceof Error ? err.message : 'Unable to load live map.'
          );
        }
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      riderMarkerRef.current = null;
      homeMarkerRef.current = null;
      routeLineRef.current = null;
      hasFittedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update Home pin, Scooter pin, and Route line smoothly whenever coordinates change
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    // Customer Home Pin
    const homeLatLng: [number, number] = [homePoint.lat, homePoint.lng];
    const homePopup = `<strong>${escapeHtml(
      hasExactCustomerGps ? 'Your Delivery Location' : 'Tolichowki Delivery Zone'
    )}</strong><br/><span>${escapeHtml(customerAddress)}</span>`;

    if (!homeMarkerRef.current) {
      homeMarkerRef.current = L.marker(homeLatLng, {
        icon: createHomePinIcon(L, 'Home'),
      })
        .bindPopup(homePopup)
        .addTo(map);
    } else {
      homeMarkerRef.current.setLatLng(homeLatLng);
      homeMarkerRef.current.setPopupContent(homePopup);
    }

    // Moving Blue Scooter Pin + Live Route Line
    if (hasRiderGps && riderLocation) {
      const riderLatLng: [number, number] = [riderLocation.lat, riderLocation.lng];
      const riderLabel = riderName.split(' ')[0] || 'Rider';
      const riderPopup = `<strong>${escapeHtml(riderName)}</strong>${
        riderId ? ` (${escapeHtml(riderId)})` : ''
      }<br/><span>Live Rider GPS</span>`;

      if (!riderMarkerRef.current) {
        riderMarkerRef.current = L.marker(riderLatLng, {
          icon: createScooterPinIcon(L, riderLabel, false),
        })
          .bindPopup(riderPopup)
          .addTo(map);
      } else {
        riderMarkerRef.current.setLatLng(riderLatLng);
        riderMarkerRef.current.setPopupContent(riderPopup);
      }

      if (!routeLineRef.current) {
        routeLineRef.current = L.polyline([riderLatLng, homeLatLng], {
          color: '#1D4ED8',
          weight: 4,
          opacity: 0.85,
          dashArray: '8, 8',
        }).addTo(map);
      } else {
        routeLineRef.current.setLatLngs([riderLatLng, homeLatLng]);
      }

      if (!hasFittedRef.current) {
        hasFittedRef.current = true;
        map.fitBounds([riderLatLng, homeLatLng], {
          padding: [42, 42],
          maxZoom: 16,
        });
      }
    } else {
      if (riderMarkerRef.current) {
        riderMarkerRef.current.remove();
        riderMarkerRef.current = null;
      }
      if (routeLineRef.current) {
        routeLineRef.current.remove();
        routeLineRef.current = null;
      }
      if (!hasFittedRef.current) {
        hasFittedRef.current = true;
        map.setView(homeLatLng, 15);
      }
    }
  }, [
    mapReady,
    homePoint.lat,
    homePoint.lng,
    hasExactCustomerGps,
    customerAddress,
    hasRiderGps,
    riderLocation?.lat,
    riderLocation?.lng,
    riderName,
    riderId,
  ]);

  const handleRecenter = () => {
    const map = mapRef.current;
    if (!map) return;
    if (hasRiderGps && riderLocation) {
      map.fitBounds(
        [
          [riderLocation.lat, riderLocation.lng],
          [homePoint.lat, homePoint.lng],
        ],
        { padding: [42, 42], maxZoom: 16 }
      );
    } else {
      map.setView([homePoint.lat, homePoint.lng], 15);
    }
  };

  const riderE164 = riderMobile ? formatIndianPhoneE164(riderMobile) : '';
  const trackRiderUrl =
    hasRiderGps && riderLocation
      ? buildTrackRiderMapUrl(riderLocation.lat, riderLocation.lng)
      : '';

  return (
    <div
      data-testid={`live-order-map-${orderId}`}
      className="my-3 rounded-2xl border border-blue-200 bg-blue-50/40 overflow-hidden"
    >
      {/* Live ETA + Distance + Call Rider Header */}
      <div className="px-4 py-3 bg-white border-b border-blue-100 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {distanceInfo ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-display text-base font-extrabold text-blue-800 tabular-nums">
                Arriving in ~{distanceInfo.etaMinutes} mins
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-sm font-bold text-cyan-700 tabular-nums">
                {distanceInfo.distanceLabel}
              </span>
            </div>
          ) : (
            <div className="font-display text-sm font-bold text-blue-900">
              Rider Assigned · Waiting for live GPS signal
            </div>
          )}

          <p className="text-xs text-slate-600 mt-0.5">
            Rider: <strong className="text-slate-900">{riderName}</strong>
            {riderId ? ` (${riderId})` : ''}
            {hasRiderGps && riderLocation?.updatedAt
              ? ` · GPS ${formatRelativeTime(riderLocation.updatedAt, nowTick)}`
              : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleRecenter}
            aria-label="Center live map"
            className="min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Crosshair className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
            <span>Center</span>
          </button>

          {showExternalTrackButton && trackRiderUrl && (
            <a
              href={trackRiderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[42px] px-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-blue-950 font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors"
            >
              <Navigation className="w-4 h-4" aria-hidden="true" />
              <span>Track Rider on Map</span>
            </a>
          )}

          {riderE164 && riderMobile && (
            <>
              <a
                href={buildPhoneCallUrl(riderMobile)}
                className="min-h-[42px] px-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-bold text-xs sm:text-sm flex items-center gap-1.5 transition-colors"
              >
                <Phone className="w-4 h-4" aria-hidden="true" />
                <span>Call Rider ({formatDisplayPhone10(riderMobile)})</span>
              </a>
              <button
                type="button"
                onClick={() => void copyPhoneNumber(riderMobile, onCallFeedback)}
                className="min-h-[42px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                <span>Copy Number</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Embedded Interactive Leaflet Map */}
      <div className="relative h-[240px] sm:h-[270px] w-full bg-slate-100">
        {mapError ? (
          <div className="h-full flex flex-col items-center justify-center p-4 text-center text-sm text-slate-600">
            <Navigation className="w-6 h-6 text-blue-700 mb-2" aria-hidden="true" />
            <p className="font-semibold text-slate-900">{mapError}</p>
            {distanceInfo && (
              <p className="text-xs text-slate-500 mt-1 tabular-nums">
                {distanceInfo.distanceLabel} · Arriving in ~
                {distanceInfo.etaMinutes} mins
              </p>
            )}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="h-full w-full z-0"
            aria-label="Live rider delivery map"
          />
        )}
      </div>

      {/* Subtle Map Legend Footer */}
      <div className="px-3.5 py-2 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
          {hasExactCustomerGps
            ? 'Live Blue Scooter pin tracks your rider to your Home GPS pin'
            : 'Showing Tolichowki center pin (enable GPS at checkout for exact Home pin)'}
        </span>
      </div>
    </div>
  );
}
