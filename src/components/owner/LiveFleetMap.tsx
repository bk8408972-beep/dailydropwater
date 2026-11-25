import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPin, Navigation } from 'lucide-react';
import type { RiderRecord } from '../../types';
import {
  formatRelativeTime,
  isValidGeoPoint,
  TOLICHOWKI_CENTER,
} from '../../utils/geo';
import {
  createScooterPinIcon,
  escapeHtml,
  loadLeaflet,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  type LeafletMap,
  type LeafletMarker,
  type LeafletStatic,
} from '../../utils/leafletLoader';

interface LiveFleetMapProps {
  riders: RiderRecord[];
  focusedRiderId: string | null;
  onFocusRider: (riderId: string | null) => void;
}

export function LiveFleetMap({
  riders,
  focusedRiderId,
  onFocusRider,
}: LiveFleetMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const leafletRef = useRef<LeafletStatic | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletMarker>>(new Map());
  const hasAutoFittedRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const onlineRiders = useMemo(
    () => riders.filter((r) => r.isActive && r.isOnline),
    [riders]
  );

  const onlineWithGps = useMemo(
    () => onlineRiders.filter((r) => isValidGeoPoint(r.liveLocation)),
    [onlineRiders]
  );

  // Refresh relative "Xs ago" labels every 5 seconds
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
          center: [TOLICHOWKI_CENTER.lat, TOLICHOWKI_CENTER.lng],
          zoom: 14,
          zoomControl: true,
          attributionControl: true,
        });
        L.tileLayer(OSM_TILE_URL, {
          attribution: OSM_ATTRIBUTION,
          maxZoom: 19,
        }).addTo(map);
        mapRef.current = map;
        setMapReady(true);
        window.setTimeout(() => {
          map.invalidateSize();
        }, 120);
      })
      .catch((err) => {
        if (!cancelled) {
          setMapError(
            err instanceof Error ? err.message : 'Unable to load Live Fleet Map.'
          );
        }
      });

    return () => {
      cancelled = true;
      markersRef.current.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      hasAutoFittedRef.current = false;
    };
  }, []);

  // Sync markers for all Duty-ON riders smoothly without flicker
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!mapReady || !L || !map) return;

    const activeIds = new Set(onlineWithGps.map((r) => r.id));

    // Remove markers for riders who went Duty OFF or lost GPS
    for (const [id, marker] of markersRef.current.entries()) {
      if (!activeIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // Add or update markers for each live Duty-ON rider
    const bounds: Array<[number, number]> = [];
    for (const rider of onlineWithGps) {
      const loc = rider.liveLocation!;
      const latlng: [number, number] = [loc.lat, loc.lng];
      bounds.push(latlng);

      const isFocused = focusedRiderId === rider.id;
      const pinLabel = `${rider.id} · ${rider.name.split(' ')[0]}`;
      const popupHtml = `
        <div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:150px;">
          <div style="font-weight:800;font-size:13px;color:#0F172A;">${escapeHtml(rider.name)}</div>
          <div style="font-size:11px;font-weight:700;color:#1D4ED8;margin-top:2px;">${escapeHtml(rider.id)} · Duty ON</div>
          <div style="font-size:11px;color:#475569;margin-top:4px;">Mobile: ${escapeHtml(rider.mobile)}</div>
          <div style="font-size:11px;color:#0891B2;font-weight:600;margin-top:2px;">Updated: ${escapeHtml(
            formatRelativeTime(loc.updatedAt, nowTick)
          )}</div>
        </div>
      `;

      const existing = markersRef.current.get(rider.id);
      if (existing) {
        existing.setLatLng(latlng);
        existing.setIcon(createScooterPinIcon(L, pinLabel, isFocused));
        existing.setPopupContent(popupHtml);
      } else {
        const created = L.marker(latlng, {
          icon: createScooterPinIcon(L, pinLabel, isFocused),
        })
          .bindPopup(popupHtml)
          .addTo(map);
        markersRef.current.set(rider.id, created);
      }
    }

    if (!hasAutoFittedRef.current && bounds.length > 0) {
      hasAutoFittedRef.current = true;
      if (bounds.length === 1) {
        map.setView(bounds[0], 15);
      } else {
        map.fitBounds(bounds, { padding: [46, 46], maxZoom: 16 });
      }
    }
  }, [mapReady, onlineWithGps, focusedRiderId, nowTick]);

  // Smoothly fly to a specific rider when selected via quick toggle
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!focusedRiderId) {
      if (onlineWithGps.length === 1) {
        const loc = onlineWithGps[0].liveLocation!;
        map.flyTo([loc.lat, loc.lng], 15, { duration: 0.5 });
      } else if (onlineWithGps.length > 1) {
        map.fitBounds(
          onlineWithGps.map((r) => [r.liveLocation!.lat, r.liveLocation!.lng]),
          { padding: [46, 46], maxZoom: 16 }
        );
      } else {
        map.flyTo([TOLICHOWKI_CENTER.lat, TOLICHOWKI_CENTER.lng], 14, {
          duration: 0.5,
        });
      }
      return;
    }

    const target = onlineWithGps.find((r) => r.id === focusedRiderId);
    if (target && target.liveLocation) {
      map.flyTo([target.liveLocation.lat, target.liveLocation.lng], 16, {
        duration: 0.6,
      });
      const marker = markersRef.current.get(target.id);
      if (marker) {
        marker.openPopup();
      }
    }
  }, [focusedRiderId, mapReady, onlineWithGps]);

  return (
    <div
      data-testid="owner-live-fleet-map"
      className="bg-white rounded-2xl border border-slate-200 overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
            <Navigation className="w-5 h-5 text-blue-700" aria-hidden="true" />
            <span>Live Fleet Map (Tolichowki 3 km)</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {onlineRiders.length} Duty-ON{' '}
            {onlineRiders.length === 1 ? 'rider' : 'riders'} ·{' '}
            {onlineWithGps.length} broadcasting live GPS every 5s
          </p>
        </div>

        {/* Quick Rider Focus Selector */}
        <div
          role="group"
          aria-label="Focus rider on live map"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            type="button"
            onClick={() => onFocusRider(null)}
            className={`min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors ${
              focusedRiderId === null
                ? 'bg-blue-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
            <span>All Online ({onlineRiders.length})</span>
          </button>

          {onlineRiders.map((rider) => {
            const hasGps = isValidGeoPoint(rider.liveLocation);
            const selected = focusedRiderId === rider.id;
            return (
              <button
                key={rider.id}
                type="button"
                disabled={!hasGps}
                onClick={() => onFocusRider(rider.id)}
                className={`min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  selected
                    ? 'bg-cyan-600 text-white'
                    : 'bg-cyan-50 hover:bg-cyan-100 text-cyan-950 border border-cyan-200'
                }`}
              >
                <span className="font-mono">{rider.id}</span>
                <span>{rider.name.split(' ')[0]}</span>
                <span
                  className={`font-normal tabular-nums ${
                    selected ? 'text-cyan-100' : 'text-cyan-700'
                  }`}
                >
                  · {formatRelativeTime(rider.liveLocation?.updatedAt, nowTick)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Interactive Map Viewport */}
      <div className="relative h-[300px] sm:h-[360px] w-full bg-slate-100">
        {mapError ? (
          <div className="h-full flex flex-col items-center justify-center p-6 text-center text-sm text-slate-600">
            <MapPin className="w-7 h-7 text-blue-700 mb-2" aria-hidden="true" />
            <p className="font-semibold text-slate-900">{mapError}</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="h-full w-full z-0"
            aria-label="Owner live fleet GPS map"
          />
        )}
      </div>

      {onlineRiders.length === 0 && (
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600">
          Map centered on Tolichowki, Hyderabad. Duty-ON riders appear live as
          moving Blue Scooter pins as soon as they start Duty ON.
        </div>
      )}
    </div>
  );
}
