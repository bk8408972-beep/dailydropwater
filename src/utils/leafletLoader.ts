// Minimal TypeScript typings for CDN-loaded Leaflet (window.L)
export interface LeafletLatLngExpressionTuple extends Array<number> {
  0: number;
  1: number;
}

export interface LeafletMarker {
  setLatLng(latlng: [number, number]): this;
  setIcon(icon: unknown): this;
  bindPopup(html: string): this;
  setPopupContent(html: string): this;
  openPopup(): this;
  addTo(map: LeafletMap): this;
  remove(): void;
}

export interface LeafletPolyline {
  setLatLngs(latlngs: Array<[number, number]>): this;
  addTo(map: LeafletMap): this;
  remove(): void;
}

export interface LeafletMap {
  setView(center: [number, number], zoom: number): this;
  flyTo(center: [number, number], zoom: number, options?: { duration?: number }): this;
  fitBounds(
    bounds: Array<[number, number]>,
    options?: { padding?: [number, number]; maxZoom?: number }
  ): this;
  invalidateSize(): this;
  remove(): void;
}

export interface LeafletStatic {
  map(
    container: HTMLElement,
    options?: {
      center?: [number, number];
      zoom?: number;
      zoomControl?: boolean;
      attributionControl?: boolean;
    }
  ): LeafletMap;
  tileLayer(
    urlTemplate: string,
    options?: { attribution?: string; maxZoom?: number }
  ): { addTo(map: LeafletMap): void };
  divIcon(options: {
    html: string;
    className?: string;
    iconSize?: [number, number];
    iconAnchor?: [number, number];
    popupAnchor?: [number, number];
  }): unknown;
  marker(latlng: [number, number], options?: { icon?: unknown }): LeafletMarker;
  polyline(
    latlngs: Array<[number, number]>,
    options?: {
      color?: string;
      weight?: number;
      opacity?: number;
      dashArray?: string;
    }
  ): LeafletPolyline;
}

declare global {
  interface Window {
    L?: LeafletStatic;
  }
}

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

export const OSM_TILE_URL =
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; OpenStreetMap';

let loadPromise: Promise<LeafletStatic> | null = null;

export function loadLeaflet(): Promise<LeafletStatic> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Leaflet requires a browser environment.'));
  }
  if (window.L) {
    return Promise.resolve(window.L);
  }
  if (loadPromise) {
    return loadPromise;
  }

  loadPromise = new Promise<LeafletStatic>((resolve, reject) => {
    // Poll briefly in case the deferred script in index.html is finishing
    const start = Date.now();
    const checkExisting = window.setInterval(() => {
      if (window.L) {
        window.clearInterval(checkExisting);
        resolve(window.L);
      } else if (Date.now() - start > 3500) {
        window.clearInterval(checkExisting);
        injectFallbackTags();
      }
    }, 80);

    function injectFallbackTags() {
      if (window.L) {
        resolve(window.L);
        return;
      }

      if (!document.querySelector('link[href*="leaflet.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = LEAFLET_CSS_URL;
        document.head.appendChild(link);
      }

      const script = document.createElement('script');
      script.src = LEAFLET_JS_URL;
      script.async = true;
      script.onload = () => {
        if (window.L) {
          resolve(window.L);
        } else {
          loadPromise = null;
          reject(new Error('Map library failed to initialize.'));
        }
      };
      script.onerror = () => {
        loadPromise = null;
        reject(new Error('Could not load OpenStreetMap viewer. Check internet connection.'));
      };
      document.head.appendChild(script);
    }
  });

  return loadPromise;
}

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createScooterPinIcon(
  L: LeafletStatic,
  label: string,
  highlighted: boolean = false
): unknown {
  const safeLabel = escapeHtml(label);
  const bg = highlighted ? '#0891B2' : '#1D4ED8';
  const ring = highlighted ? '#67E8F9' : '#93C5FD';
  return L.divIcon({
    className: 'dailydrop-scooter-pin',
    iconSize: [44, 54],
    iconAnchor: [22, 46],
    popupAnchor: [0, -44],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="background:${bg};color:#ffffff;font-family:'Outfit',sans-serif;font-size:11px;font-weight:700;padding:2px 7px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,0.35);margin-bottom:3px;border:1.5px solid ${ring};">
          ${safeLabel}
        </div>
        <div style="width:36px;height:36px;border-radius:9999px;background:${bg};border:3px solid #ffffff;box-shadow:0 4px 10px rgba(29,78,216,0.45);display:flex;align-items:center;justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="5.5" cy="17.5" r="2.5"></circle>
            <circle cx="18.5" cy="17.5" r="2.5"></circle>
            <path d="M15 6h2l2 6"></path>
            <path d="M7 17.5h6.5l2-5.5H10l-2 2.5"></path>
            <path d="M5.5 14h4"></path>
          </svg>
        </div>
      </div>
    `,
  });
}

export function createHomePinIcon(L: LeafletStatic, label: string = 'Your Location'): unknown {
  const safeLabel = escapeHtml(label);
  return L.divIcon({
    className: 'dailydrop-home-pin',
    iconSize: [40, 52],
    iconAnchor: [20, 44],
    popupAnchor: [0, -42],
    html: `
      <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;">
        <div style="background:#0F172A;color:#ffffff;font-family:'Outfit',sans-serif;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,0.3);margin-bottom:3px;">
          ${safeLabel}
        </div>
        <div style="width:34px;height:34px;border-radius:9999px;background:#059669;border:3px solid #ffffff;box-shadow:0 4px 10px rgba(5,150,105,0.4);display:flex;align-items:center;justify-content:center;">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 10.5 12 3l9 7.5"></path>
            <path d="M5 9.5V20h14V9.5"></path>
            <path d="M9.5 20v-6h5v6"></path>
          </svg>
        </div>
      </div>
    `,
  });
}
