import { sanitizeTextInput } from './security';

interface NominatimAddress {
  neighbourhood?: string;
  suburb?: string;
  residential?: string;
  quarter?: string;
  city_district?: string;
  village?: string;
  town?: string;
  city?: string;
  state_district?: string;
  state?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
  display_name?: string;
}

const areaCache = new Map<string, string>();

/**
 * Extracts a concise, human-friendly locality name (e.g. "Banjara Hills, Hyderabad")
 * from an OpenStreetMap Nominatim reverse-geocoding payload.
 * Never returns a hardcoded fallback neighborhood.
 */
export function extractReadableAreaName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as NominatimResponse;
  const addr = data.address;

  if (addr && typeof addr === 'object') {
    const primary =
      addr.neighbourhood ||
      addr.suburb ||
      addr.quarter ||
      addr.residential ||
      addr.village ||
      addr.town ||
      addr.city_district ||
      addr.city ||
      addr.state_district;

    const secondary =
      addr.city || addr.town || addr.state_district || addr.state;

    const cleanPrimary = primary ? sanitizeTextInput(primary, 36) : '';
    const cleanSecondary = secondary ? sanitizeTextInput(secondary, 28) : '';

    if (cleanPrimary && cleanSecondary) {
      if (cleanPrimary.toLowerCase() === cleanSecondary.toLowerCase()) {
        return cleanPrimary;
      }
      return sanitizeTextInput(`${cleanPrimary}, ${cleanSecondary}`, 60);
    }
    if (cleanPrimary) return cleanPrimary;
    if (cleanSecondary) return cleanSecondary;
  }

  if (typeof data.display_name === 'string' && data.display_name.trim()) {
    const parts = data.display_name
      .split(',')
      .map((p) => sanitizeTextInput(p, 36))
      .filter(Boolean);
    if (parts.length >= 2) {
      return sanitizeTextInput(`${parts[0]}, ${parts[1]}`, 60);
    }
    if (parts.length === 1) {
      return parts[0];
    }
  }

  return null;
}

/**
 * Fetches a live readable area name from GPS coordinates using OpenStreetMap Nominatim
 * with a 5-second timeout and coordinate cache. Fails silently to null when offline.
 */
export async function fetchLiveAreaName(
  lat: number,
  lng: number
): Promise<string | null> {
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }

  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cached = areaCache.get(cacheKey);
  if (cached) return cached;

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId =
    controller && typeof window !== 'undefined'
      ? window.setTimeout(() => controller.abort(), 5000)
      : null;

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(
      5
    )}&lon=${lng.toFixed(5)}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    const areaName = extractReadableAreaName(json);
    if (areaName) {
      areaCache.set(cacheKey, areaName);
    }
    return areaName;
  } catch {
    return null;
  } finally {
    if (timeoutId !== null && typeof window !== 'undefined') {
      window.clearTimeout(timeoutId);
    }
  }
}
