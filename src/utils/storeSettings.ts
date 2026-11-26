import type {
  FloorLevel,
  Order,
  RiderRecord,
  StoreSettings,
} from '../types';
import { isActiveOrderStatus } from './domain';

export const STORE_CLOSED_BANNER_MESSAGE =
  'Store is currently closed. We are not accepting orders right now.';

export const DEFAULT_STORE_COORDS = {
  lat: 17.3984,
  lng: 78.4136,
} as const;

export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  isOpen: true,
  autoAssign: true,
  platformFee: 0,
  deliveryFee: 0,
  floor2Charge: 10,
  floor3PlusCharge: 20,
  radiusEnabled: true,
  deliveryRadiusKm: 3,
  storeLat: DEFAULT_STORE_COORDS.lat,
  storeLng: DEFAULT_STORE_COORDS.lng,
  upiEnabled: false,
  codEnabled: true,
  upiId: '',
  upiName: 'DailyDrop Water',
};

export const PLATFORM_FEE_PRESETS = [0, 5, 7, 10] as const;
export const DELIVERY_FEE_PRESETS = [0, 10, 15, 20] as const;
export const DELIVERY_RADIUS_PRESETS = [2, 3, 5, 7] as const;

export const FLOOR_OPTIONS: ReadonlyArray<{
  value: FloorLevel;
  label: string;
}> = [
  { value: 'ground_1st', label: 'Ground / 1st Floor' },
  { value: 'floor_2', label: '2nd Floor' },
  { value: 'floor_3_plus', label: '3rd Floor & Above' },
];

/**
 * Parses and clamps a fee amount to a clean non-negative integer (₹0 – ₹5000).
 */
export function sanitizeFeeAmount(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return Math.min(5000, Math.round(num));
}

/**
 * Parses and clamps Max Delivery Radius (0.5 km – 50 km, max 1 decimal place).
 */
export function sanitizeDeliveryRadiusKm(value: unknown, fallback: number): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  const clamped = Math.min(50, Math.max(0.5, num));
  return Math.round(clamped * 10) / 10;
}

/**
 * Parses and validates a GPS latitude (-90..90) or longitude (-180..180) coordinate.
 */
export function sanitizeCoordinate(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    return fallback;
  }
  return Number(num.toFixed(6));
}

/**
 * Normalizes raw Firebase /storeSettings data with safe defaults.
 */
export function normalizeStoreSettings(
  raw?: Partial<StoreSettings> | null
): StoreSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_STORE_SETTINGS };
  }
  return {
    isOpen: typeof raw.isOpen === 'boolean' ? raw.isOpen : DEFAULT_STORE_SETTINGS.isOpen,
    autoAssign:
      typeof raw.autoAssign === 'boolean'
        ? raw.autoAssign
        : DEFAULT_STORE_SETTINGS.autoAssign,
    platformFee: sanitizeFeeAmount(raw.platformFee, DEFAULT_STORE_SETTINGS.platformFee),
    deliveryFee: sanitizeFeeAmount(raw.deliveryFee, DEFAULT_STORE_SETTINGS.deliveryFee),
    floor2Charge: sanitizeFeeAmount(raw.floor2Charge, DEFAULT_STORE_SETTINGS.floor2Charge),
    floor3PlusCharge: sanitizeFeeAmount(
      raw.floor3PlusCharge,
      DEFAULT_STORE_SETTINGS.floor3PlusCharge
    ),
    radiusEnabled:
      typeof raw.radiusEnabled === 'boolean'
        ? raw.radiusEnabled
        : DEFAULT_STORE_SETTINGS.radiusEnabled,
    deliveryRadiusKm: sanitizeDeliveryRadiusKm(
      raw.deliveryRadiusKm,
      DEFAULT_STORE_SETTINGS.deliveryRadiusKm
    ),
    storeLat: sanitizeCoordinate(
      raw.storeLat,
      -90,
      90,
      DEFAULT_STORE_SETTINGS.storeLat
    ),
    storeLng: sanitizeCoordinate(
      raw.storeLng,
      -180,
      180,
      DEFAULT_STORE_SETTINGS.storeLng
    ),
    upiEnabled:
      typeof raw.upiEnabled === 'boolean'
        ? raw.upiEnabled
        : DEFAULT_STORE_SETTINGS.upiEnabled,
    codEnabled:
      typeof raw.codEnabled === 'boolean'
        ? raw.codEnabled
        : DEFAULT_STORE_SETTINGS.codEnabled,
    upiId: typeof raw.upiId === 'string' ? raw.upiId.trim() : DEFAULT_STORE_SETTINGS.upiId,
    upiName:
      typeof raw.upiName === 'string' && raw.upiName.trim()
        ? raw.upiName.trim()
        : DEFAULT_STORE_SETTINGS.upiName,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : undefined,
  };
}

/**
 * Calculates extra floor charge based on Floor & Lift policy:
 * - Ground / 1st Floor: ₹0
 * - Any floor with Lift (hasLift === true): ₹0
 * - 2nd Floor without Lift: settings.floor2Charge (default ₹10)
 * - 3rd Floor & Above without Lift: settings.floor3PlusCharge (default ₹20)
 */
export function calculateFloorCharge(
  floorLevel: FloorLevel | null | undefined,
  hasLift: boolean | null | undefined,
  settings: Pick<StoreSettings, 'floor2Charge' | 'floor3PlusCharge'>
): number {
  if (!floorLevel || floorLevel === 'ground_1st') return 0;
  if (hasLift === true) return 0;
  if (hasLift !== false) return 0;
  if (floorLevel === 'floor_2') {
    return sanitizeFeeAmount(settings.floor2Charge, DEFAULT_STORE_SETTINGS.floor2Charge);
  }
  if (floorLevel === 'floor_3_plus') {
    return sanitizeFeeAmount(
      settings.floor3PlusCharge,
      DEFAULT_STORE_SETTINGS.floor3PlusCharge
    );
  }
  return 0;
}

export interface OrderBillBreakdown {
  itemsSubtotal: number;
  platformFee: number;
  deliveryFee: number;
  floorCharge: number;
  totalAmount: number;
}

/**
 * Computes the complete itemized bill breakdown for Customer checkout.
 */
export function calculateOrderBillBreakdown(
  itemsSubtotal: number,
  floorLevel: FloorLevel | null | undefined,
  hasLift: boolean | null | undefined,
  settings: Pick<
    StoreSettings,
    'platformFee' | 'deliveryFee' | 'floor2Charge' | 'floor3PlusCharge'
  >
): OrderBillBreakdown {
  const safeSubtotal = Math.max(0, Math.round(Number(itemsSubtotal) || 0));
  const platformFee = sanitizeFeeAmount(
    settings.platformFee,
    DEFAULT_STORE_SETTINGS.platformFee
  );
  const deliveryFee = sanitizeFeeAmount(
    settings.deliveryFee,
    DEFAULT_STORE_SETTINGS.deliveryFee
  );
  const floorCharge = calculateFloorCharge(floorLevel, hasLift, settings);
  return {
    itemsSubtotal: safeSubtotal,
    platformFee,
    deliveryFee,
    floorCharge,
    totalAmount: safeSubtotal + platformFee + deliveryFee + floorCharge,
  };
}

export function getFloorLevelLabel(floorLevel?: FloorLevel | null): string {
  switch (floorLevel) {
    case 'ground_1st':
      return 'Ground / 1st Floor';
    case 'floor_2':
      return '2nd Floor';
    case 'floor_3_plus':
      return '3rd Floor & Above';
    default:
      return '';
  }
}

export function formatFloorLiftSummary(
  order: Pick<Order, 'floorLevel' | 'hasLift' | 'floorCharge'>
): string | null {
  const floorLabel = getFloorLevelLabel(order.floorLevel);
  if (!floorLabel) return null;
  const liftLabel =
    order.hasLift === true
      ? 'Lift: Yes'
      : order.hasLift === false
        ? 'No Lift'
        : 'Lift: —';
  const charge = Number(order.floorCharge) || 0;
  if (charge > 0) {
    return `${floorLabel} · ${liftLabel} (+₹${Math.round(charge)})`;
  }
  return `${floorLabel} · ${liftLabel}`;
}

/**
 * Picks the best Duty-ON online rider for Auto-Assign:
 * - Only considers active riders (`isActive !== false`) with Duty ON (`isOnline === true`).
 * - Chooses the rider with the fewest currently active orders.
 * - Tie-breaks deterministically by Rider ID ascending (e.g. DD001 before DD002).
 * - Returns null when no online rider is available.
 */
export function pickBestOnlineRiderForAutoAssign(
  riders: RiderRecord[],
  orders: Order[]
): RiderRecord | null {
  const eligible = riders.filter((r) => r.isActive !== false && r.isOnline === true);
  if (eligible.length === 0) return null;

  const activeCountByRider = new Map<string, number>();
  for (const r of eligible) {
    activeCountByRider.set(r.id, 0);
  }

  for (const order of orders) {
    if (!order.assignedRiderId) continue;
    if (!isActiveOrderStatus(order.status)) continue;
    if (activeCountByRider.has(order.assignedRiderId)) {
      activeCountByRider.set(
        order.assignedRiderId,
        (activeCountByRider.get(order.assignedRiderId) ?? 0) + 1
      );
    }
  }

  const sorted = [...eligible].sort((a, b) => {
    const countDiff =
      (activeCountByRider.get(a.id) ?? 0) - (activeCountByRider.get(b.id) ?? 0);
    if (countDiff !== 0) return countDiff;
    return a.id.localeCompare(b.id);
  });

  return sorted[0] ?? null;
}
