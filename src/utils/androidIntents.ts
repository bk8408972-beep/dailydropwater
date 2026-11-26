import { TOLICHOWKI_CENTER } from './geo';

export const WATER_PLANT_LOCATION = {
  lat: TOLICHOWKI_CENTER.lat,
  lng: TOLICHOWKI_CENTER.lng,
  label: 'DailyDrop Water Plant',
} as const;

/**
 * Extracts a clean 10-digit Indian mobile number for clear display when available.
 */
export function formatDisplayPhone10(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits || phone.trim();
}

/**
 * Normalizes Indian mobile numbers to E.164 (+91XXXXXXXXXX) for simple tel: links.
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
 * Builds a standard tel:+91XXXXXXXXXX URL (zero intent:// schemes so MIT App Inventor
 * Android WebView never hits net::ERR_UNKNOWN_URL_SCHEME).
 */
export function buildPhoneCallUrl(phone: string): string {
  const e164 = formatIndianPhoneE164(phone);
  if (!e164) return '';
  return `tel:${e164}`;
}

/**
 * Triggers a phone call cleanly inside browsers and Android WebView/TWA
 * using window.location.href fallback for tel: links (zero intent:// schemes).
 */
export function triggerPhoneCall(phone: string, useRawDigits: boolean = false): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  const telUrl = useRawDigits ? `tel:${digits}` : buildPhoneCallUrl(trimmed);
  if (!telUrl) return '';
  if (typeof window !== 'undefined') {
    try {
      window.location.href = telUrl;
    } catch {
      // Anchor href still handles navigation
    }
  }
  return telUrl;
}

/**
 * Builds a standard HTTPS Google Maps turn-by-turn navigation URL to exact GPS coordinates.
 */
export function buildMapsDirectionsUrl(lat: number, lng: number): string {
  const fixedLat = Number(lat).toFixed(6);
  const fixedLng = Number(lng).toFixed(6);
  return `https://www.google.com/maps/dir/?api=1&destination=${fixedLat},${fixedLng}`;
}

/**
 * Builds a standard HTTPS Google Maps directions URL using a destination street address
 * when GPS coordinates are unavailable (address_only orders).
 */
export function buildMapsDirectionsByAddressUrl(address: string): string {
  const cleaned = address.trim();
  const query = cleaned.toLowerCase().includes('hyderabad')
    ? cleaned
    : `${cleaned}, Hyderabad`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
}

/**
 * Builds the strict HTTPS Google Maps turn-by-turn driving directions URL for native
 * <a target="_blank" rel="noopener noreferrer"> navigation links (no intent://, geo:, or window.open).
 */
export function buildGoogleMapsDrivingDirectionsUrl(params: {
  lat?: number | null;
  lng?: number | null;
  address: string;
}): string {
  const { lat, lng, address } = params;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
  }
  const fullAddress = address.trim();
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}&travelmode=driving`;
}

/**
 * Builds a standard HTTPS Google Maps pin URL to view the Rider's live GPS location.
 */
export function buildTrackRiderMapUrl(lat: number, lng: number): string {
  const fixedLat = Number(lat).toFixed(6);
  const fixedLng = Number(lng).toFixed(6);
  return `https://www.google.com/maps/search/?api=1&query=${fixedLat},${fixedLng}`;
}

/**
 * Builds a free embedded Google Maps iframe URL (no API key, no external app popup)
 * using exact GPS coordinates when available or falling back to the street address.
 */
export function buildGoogleMapEmbedUrl(params: {
  lat?: number | null;
  lng?: number | null;
  address: string;
}): string {
  const { lat, lng, address } = params;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return `https://maps.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}&z=16&output=embed`;
  }
  const cleaned = address.trim();
  const query = cleaned.toLowerCase().includes('hyderabad')
    ? cleaned
    : `${cleaned}, Hyderabad`;
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`;
}

/**
 * Formats the text copied by the "Copy Location" button so riders can paste it
 * directly into Google Maps (GPS coordinates when available, else full address).
 */
export function formatCopyLocationText(params: {
  lat?: number | null;
  lng?: number | null;
  address: string;
}): string {
  const { lat, lng, address } = params;
  if (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) {
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  const cleaned = address.trim();
  if (!cleaned) return '';
  return cleaned.toLowerCase().includes('hyderabad')
    ? cleaned
    : `${cleaned}, Hyderabad`;
}

/**
 * Copies arbitrary text reliably across desktop browsers and MIT App Inventor WebViews
 * using navigator.clipboard with an automatic textarea execCommand('copy') fallback.
 */
export async function copyTextToClipboard(
  textToCopy: string,
  feedbackMessage: string,
  onFeedback?: (message: string) => void
): Promise<boolean> {
  if (!textToCopy.trim()) return false;

  let copied = false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textToCopy);
      copied = true;
    }
  } catch {
    copied = false;
  }

  if (!copied && typeof document !== 'undefined') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = textToCopy;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      copied = false;
    }
  }

  if (onFeedback) {
    onFeedback(feedbackMessage);
  }
  return copied;
}

/**
 * Copies a phone number reliably across desktop browsers and MIT App Inventor WebViews
 * and triggers the "Number copied!" toast callback.
 */
export async function copyPhoneNumber(
  phone: string,
  onFeedback?: (message: string) => void
): Promise<boolean> {
  const textToCopy = formatDisplayPhone10(phone) || phone.trim();
  return copyTextToClipboard(textToCopy, 'Number copied!', onFeedback);
}

/**
 * Copies GPS coordinates (when available) or full address and triggers the
 * "Location copied!" toast callback.
 */
export async function copyLocationText(
  params: { lat?: number | null; lng?: number | null; address: string },
  onFeedback?: (message: string) => void
): Promise<boolean> {
  const textToCopy = formatCopyLocationText(params);
  return copyTextToClipboard(textToCopy, 'Location copied!', onFeedback);
}

