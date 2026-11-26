import type { GeoPoint } from '../types';

export const TOLICHOWKI_CENTER = {
  lat: 17.3984,
  lng: 78.4146,
  label: 'Store Base Location',
} as const;

export const DELIVERY_RADIUS_KM = 3.0;

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Validates that a lat/lng object contains finite geographic coordinates.
 */
export function isValidGeoPoint(
  point?: Partial<GeoPoint> | null
): point is GeoPoint {
  if (!point || typeof point !== 'object') return false;
  const { lat, lng } = point;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/**
 * Computes great-circle distance in kilometers between two latitude/longitude points
 * using the Haversine formula.
 */
export function calculateHaversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);

  const a =
    sinHalfLat * sinHalfLat +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      sinHalfLng *
      sinHalfLng;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

export interface ZoneCheckResult {
  distanceKm: number;
  withinZone: boolean;
  formattedDistance: string;
}

export function checkTolichowkiZone(lat: number, lng: number): ZoneCheckResult {
  const rawDistance = calculateHaversineKm(
    TOLICHOWKI_CENTER.lat,
    TOLICHOWKI_CENTER.lng,
    lat,
    lng
  );
  const rounded = Math.round(rawDistance * 100) / 100;
  return {
    distanceKm: rounded,
    withinZone: rawDistance <= DELIVERY_RADIUS_KM,
    formattedDistance: `${rounded.toFixed(2)} km`,
  };
}

export interface DeliveryRadiusConfig {
  radiusEnabled: boolean;
  deliveryRadiusKm: number;
  storeLat: number;
  storeLng: number;
}

export interface DeliveryRadiusCheck {
  radiusEnabled: boolean;
  maxRadiusKm: number;
  distanceKm: number;
  withinRadius: boolean;
  blocked: boolean;
  formattedDistance: string;
  modalMessage: string;
}

/**
 * Evaluates a customer's GPS coordinates against the Owner-controlled store base GPS
 * and delivery radius using the Haversine formula.
 */
export function checkDeliveryRadius(
  customerLat: number,
  customerLng: number,
  config: DeliveryRadiusConfig
): DeliveryRadiusCheck {
  const rawDistance = calculateHaversineKm(
    config.storeLat,
    config.storeLng,
    customerLat,
    customerLng
  );
  const distanceKm = Math.round(rawDistance * 100) / 100;
  const maxRadiusKm =
    Number.isFinite(config.deliveryRadiusKm) && config.deliveryRadiusKm > 0
      ? config.deliveryRadiusKm
      : DELIVERY_RADIUS_KM;
  const withinRadius = rawDistance <= maxRadiusKm;
  const blocked = Boolean(config.radiusEnabled) && !withinRadius;
  const formattedDistance = `${distanceKm.toFixed(2)} km`;
  const modalMessage = `🚫 Outside ${maxRadiusKm} km delivery radius — We currently deliver only within a ${maxRadiusKm} km radius. Your location is ${distanceKm.toFixed(2)} km away, so this order cannot be placed.`;

  return {
    radiusEnabled: Boolean(config.radiusEnabled),
    maxRadiusKm,
    distanceKm,
    withinRadius,
    blocked,
    formattedDistance,
    modalMessage,
  };
}

/**
 * Estimates scooter delivery ETA in minutes for local delivery lanes (~15 km/h avg + 1 min handover buffer).
 */
export function estimateEtaMinutes(distanceKm: number): number {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return 2;
  const rawMinutes = (distanceKm / 15) * 60 + 1;
  return Math.max(2, Math.round(rawMinutes));
}

export function formatShortDistanceKm(distanceKm: number): string {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return '0.0 km away';
  if (distanceKm < 0.1) return '< 0.1 km away';
  return `${distanceKm.toFixed(1)} km away`;
}

export function formatRelativeTime(
  timestampMs?: number | null,
  nowMs: number = Date.now()
): string {
  if (!timestampMs || !Number.isFinite(timestampMs)) return 'No GPS yet';
  const diffSec = Math.max(0, Math.round((nowMs - timestampMs) / 1000));
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr}h ago`;
}
