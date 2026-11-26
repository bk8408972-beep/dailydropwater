import { TOLICHOWKI_CENTER } from './geo';

export const WATER_PLANT_LOCATION = {
  lat: TOLICHOWKI_CENTER.lat,
  lng: TOLICHOWKI_CENTER.lng,
  label: 'DailyDrop Water Plant, Tolichowki',
} as const;

export function isAndroidUserAgent(ua?: string): boolean {
  const agent =
    typeof ua === 'string'
      ? ua
      : typeof navigator !== 'undefined'
        ? navigator.userAgent
        : '';
  return /android/i.test(agent);
}

/**
 * Normalizes Indian mobile numbers to E.164 (+91XXXXXXXXXX) for reliable
 * Android Telecom Intents and dialer links.
 */
export function formatIndianPhoneE164(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return `+91${digits.slice(1)}`;
  }
  return trimmed.startsWith('+') ? `+${digits}` : `+${digits}`;
}

/**
 * Builds an Android WebView-safe phone call URL (using Android Telecom Intent
 * on Android to prevent ERR_UNKNOWN_URL_SCHEME, and tel: on other platforms).
 */
export function buildPhoneCallUrl(phone: string, ua?: string): string {
  const e164 = formatIndianPhoneE164(phone);
  if (!e164) return '';
  if (isAndroidUserAgent(ua)) {
    return `intent://${e164}#Intent;scheme=tel;package=com.android.server.telecom;end`;
  }
  return `tel:${e164}`;
}

/**
 * Builds a Google Maps turn-by-turn navigation URL to exact GPS coordinates
 * using an Android Intent URL on Android WebView (no ERR_UNKNOWN_URL_SCHEME).
 */
export function buildMapsDirectionsUrl(
  lat: number,
  lng: number,
  ua?: string
): string {
  const fixedLat = Number(lat).toFixed(6);
  const fixedLng = Number(lng).toFixed(6);
  if (isAndroidUserAgent(ua)) {
    return `intent://maps.google.com/maps?daddr=${fixedLat},${fixedLng}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${fixedLat},${fixedLng}`;
}

/**
 * Builds a Google Maps pin URL to view the Rider's live GPS location
 * using an Android Intent URL on Android WebView.
 */
export function buildTrackRiderMapUrl(
  lat: number,
  lng: number,
  ua?: string
): string {
  const fixedLat = Number(lat).toFixed(6);
  const fixedLng = Number(lng).toFixed(6);
  if (isAndroidUserAgent(ua)) {
    return `intent://maps.google.com/maps?q=${fixedLat},${fixedLng}#Intent;scheme=https;package=com.google.android.apps.maps;end`;
  }
  return `https://maps.google.com/?q=${fixedLat},${fixedLng}`;
}

/**
 * Copies a phone number to clipboard safely (best-effort) and returns whether
 * clipboard write succeeded.
 */
async function copyPhoneFallback(e164: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(e164);
      return true;
    }
  } catch {
    // ignore clipboard errors in restricted WebViews
  }
  return false;
}

/**
 * Triggers a phone call safely across Android WebView and desktop browsers,
 * while copying the normalized number to clipboard as a reliable fallback.
 */
export function triggerPhoneCall(
  phone: string,
  onFeedback?: (message: string) => void
): void {
  const e164 = formatIndianPhoneE164(phone);
  if (!e164) return;

  const url = buildPhoneCallUrl(phone);
  void copyPhoneFallback(e164).then((copied) => {
    if (onFeedback) {
      onFeedback(
        copied
          ? `Dialing ${e164} · Number copied to clipboard`
          : `Dialing ${e164}`
      );
    }
  });

  if (typeof window !== 'undefined' && url) {
    try {
      window.location.href = url;
    } catch {
      if (onFeedback) {
        onFeedback(`Number copied: ${e164}`);
      }
    }
  }
}

/**
 * Opens Google Maps navigation or rider tracking safely in Android WebView
 * (via intent://) or standard browser link without triggering popup blockers.
 */
export function openExternalMapUrl(url: string): void {
  if (!url || typeof window === 'undefined') return;
  if (url.startsWith('intent://')) {
    window.location.href = url;
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
