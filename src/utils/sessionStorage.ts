import type { CustomerProfile, RiderRecord } from '../types';
import {
  sanitizeAddressInput,
  sanitizePhone10,
  sanitizeTextInput,
} from './security';

export const OWNER_SESSION_STORAGE_KEY = 'dailydrop_owner_session_v1';
export const RIDER_SESSION_STORAGE_KEY = 'dailydrop_rider_session_v1';
export const CUSTOMER_PROFILE_STORAGE_KEY = 'dailydrop_customer_profile_v1';
export const GPS_DISCLOSURE_STORAGE_KEY = 'dailydrop_gps_disclosure_accepted_v1';

export interface PersistentOwnerSession {
  authenticated: true;
  loggedInAt: number;
}

export interface PersistentRiderSession {
  riderId: string;
  name: string;
  mobile: string;
  isOnline: boolean;
  loggedInAt: number;
  dutyOnTime?: number | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted WebView environments
  }
  return null;
}

export function loadOwnerSession(
  storage: StorageLike | null = getDefaultStorage()
): PersistentOwnerSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(OWNER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistentOwnerSession> | null;
    if (!parsed || parsed.authenticated !== true) return null;
    return {
      authenticated: true,
      loggedInAt:
        typeof parsed.loggedInAt === 'number' && Number.isFinite(parsed.loggedInAt)
          ? parsed.loggedInAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveOwnerSession(
  storage: StorageLike | null = getDefaultStorage(),
  nowMs: number = Date.now()
): PersistentOwnerSession {
  const session: PersistentOwnerSession = {
    authenticated: true,
    loggedInAt: nowMs,
  };
  try {
    storage?.setItem(OWNER_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota or WebView restrictions
  }
  return session;
}

export function clearOwnerSession(
  storage: StorageLike | null = getDefaultStorage()
): void {
  try {
    storage?.removeItem(OWNER_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

export function loadRiderSession(
  storage: StorageLike | null = getDefaultStorage()
): PersistentRiderSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RIDER_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistentRiderSession> | null;
    if (!parsed || typeof parsed.riderId !== 'string' || !parsed.riderId.trim()) {
      return null;
    }
    return {
      riderId: parsed.riderId.trim().toUpperCase(),
      name: typeof parsed.name === 'string' ? parsed.name : parsed.riderId.trim().toUpperCase(),
      mobile: typeof parsed.mobile === 'string' ? parsed.mobile : '',
      isOnline: Boolean(parsed.isOnline),
      loggedInAt:
        typeof parsed.loggedInAt === 'number' && Number.isFinite(parsed.loggedInAt)
          ? parsed.loggedInAt
          : Date.now(),
      dutyOnTime:
        typeof parsed.dutyOnTime === 'number' && Number.isFinite(parsed.dutyOnTime)
          ? parsed.dutyOnTime
          : null,
    };
  } catch {
    return null;
  }
}

export function saveRiderSession(
  rider: Pick<RiderRecord, 'id' | 'name' | 'mobile' | 'isOnline' | 'dutyOnTime'>,
  storage: StorageLike | null = getDefaultStorage(),
  existingLoggedInAt?: number
): PersistentRiderSession {
  const session: PersistentRiderSession = {
    riderId: rider.id.trim().toUpperCase(),
    name: rider.name || rider.id,
    mobile: rider.mobile || '',
    isOnline: Boolean(rider.isOnline),
    loggedInAt: existingLoggedInAt ?? Date.now(),
    dutyOnTime: rider.dutyOnTime ?? null,
  };
  try {
    storage?.setItem(RIDER_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota or WebView restrictions
  }
  return session;
}

export function clearRiderSession(
  storage: StorageLike | null = getDefaultStorage()
): void {
  try {
    storage?.removeItem(RIDER_SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Hydrates an initial RiderRecord from a saved localStorage session so reopening
 * the Rider App immediately displays the Rider dashboard and saved Duty ON/OFF state
 * while live Firebase verification runs in the background.
 */
export function buildHydratedRiderFromSession(
  session: PersistentRiderSession
): RiderRecord {
  return {
    id: session.riderId,
    name: session.name,
    mobile: session.mobile,
    password: '',
    isActive: true,
    isOnline: session.isOnline,
    dutyOnTime: session.dutyOnTime ?? null,
    createdAt: session.loggedInAt,
  };
}

export function loadCustomerProfile(
  storage: StorageLike | null = getDefaultStorage()
): CustomerProfile | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CUSTOMER_PROFILE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CustomerProfile> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    const rawDigits =
      typeof parsed.mobile === 'string' ? parsed.mobile.replace(/\D/g, '') : '';
    const mobile = rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits;
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const address = typeof parsed.address === 'string' ? parsed.address.trim() : '';
    if (!mobile && !name && !address) return null;
    return {
      name,
      mobile,
      address,
      updatedAt:
        typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
          ? parsed.updatedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveCustomerProfile(
  profile: Omit<CustomerProfile, 'updatedAt'>,
  storage: StorageLike | null = getDefaultStorage(),
  nowMs: number = Date.now()
): CustomerProfile {
  const clean: CustomerProfile = {
    name: sanitizeTextInput(profile.name, 80),
    mobile: sanitizePhone10(profile.mobile),
    address: sanitizeAddressInput(profile.address, 260),
    updatedAt: nowMs,
  };
  try {
    storage?.setItem(CUSTOMER_PROFILE_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage restrictions
  }
  return clean;
}

export function clearCustomerProfile(
  storage: StorageLike | null = getDefaultStorage()
): void {
  try {
    storage?.removeItem(CUSTOMER_PROFILE_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}

export function hasAcceptedGpsDisclosure(
  storage: StorageLike | null = getDefaultStorage()
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GPS_DISCLOSURE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveGpsDisclosureAccepted(
  storage: StorageLike | null = getDefaultStorage()
): void {
  try {
    storage?.setItem(GPS_DISCLOSURE_STORAGE_KEY, 'true');
  } catch {
    // Ignore storage restrictions
  }
}

export function clearGpsDisclosureAccepted(
  storage: StorageLike | null = getDefaultStorage()
): void {
  try {
    storage?.removeItem(GPS_DISCLOSURE_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}
