import type {
  BulkBookingRequest,
  Order,
  Product,
} from '../types';
import { resolveProductPricing } from './discounts';

function sanitizeLocalPhone10(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, 10);
}

function sanitizeLocalText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function sanitizeLocalAddress(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

export const DEFAULT_MIN_ORDER_AMOUNT = 100;
export const MIN_ORDER_PRESETS = [0, 50, 100, 150, 200] as const;

export const DEFAULT_SUPPORT_MOBILE = '9885138592';
export const DEFAULT_SUPPORT_EMAIL = '';

export const DEFAULT_CONGRATS_POPUP_SECONDS = 4;
export const MIN_CONGRATS_POPUP_SECONDS = 1;
export const MAX_CONGRATS_POPUP_SECONDS = 10;

export const DEFAULT_PROMO_BANNER_ENABLED = false;
export const DEFAULT_PROMO_BANNER_TEXT = '';
export const DEFAULT_PROMO_BANNER_BUTTON_TEXT = 'Order Now';
export const DEFAULT_PROMO_BANNER_ACTION_URL = '';
export const DEFAULT_PROMO_BANNER_INTERVAL_MINUTES = 1;
export const MIN_PROMO_BANNER_INTERVAL_MINUTES = 1;
export const MAX_PROMO_BANNER_INTERVAL_MINUTES = 60;
export const PROMO_INTERVAL_PRESETS = [1, 2, 5, 10] as const;
export const DEFAULT_PROMO_BANNER_PHONE = '';

export const BULK_CAN_PRESETS = [10, 20, 50] as const;

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function sanitizeMinOrderAmount(value: unknown, fallback: number = DEFAULT_MIN_ORDER_AMOUNT): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return fallback;
  }
  return Math.min(50000, Math.round(num));
}

export interface MinimumOrderCheckResult {
  met: boolean;
  minOrderAmount: number;
  cartSubtotal: number;
  remaining: number;
  message: string | null;
}

/**
 * Checks whether the combined cart subtotal across all items meets the Owner's Minimum Order Amount.
 * Returns the exact required Hindi-English prompt message when below minimum.
 */
export function checkMinimumOrderAmount(
  cartSubtotal: number,
  minOrderAmount: number
): MinimumOrderCheckResult {
  const cleanMin = sanitizeMinOrderAmount(minOrderAmount, DEFAULT_MIN_ORDER_AMOUNT);
  const cleanSubtotal = Math.max(0, Math.round(Number(cartSubtotal) || 0));

  if (cleanMin <= 0 || cleanSubtotal >= cleanMin) {
    return {
      met: true,
      minOrderAmount: cleanMin,
      cartSubtotal: cleanSubtotal,
      remaining: 0,
      message: null,
    };
  }

  const remaining = cleanMin - cleanSubtotal;
  return {
    met: false,
    minOrderAmount: cleanMin,
    cartSubtotal: cleanSubtotal,
    remaining,
    message: `Minimum order ₹${cleanMin} ka hona zaroori hai — ₹${remaining} ka item aur add karein`,
  };
}

export function sanitizeSupportMobile(raw: unknown, fallback: string = DEFAULT_SUPPORT_MOBILE): string {
  if (typeof raw !== 'string') return fallback;
  const digits = sanitizeLocalPhone10(raw);
  return /^\d{10}$/.test(digits) ? digits : fallback;
}

export function sanitizeSupportEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 120);
  if (!trimmed) return '';
  return SIMPLE_EMAIL_RE.test(trimmed) ? trimmed : '';
}

export function validateSupportContactDraft(input: {
  supportMobile: string;
  supportEmail: string;
}):
  | { ok: true; supportMobile: string; supportEmail: string }
  | { ok: false; error: string } {
  const cleanMobile = sanitizeLocalPhone10(input.supportMobile);
  if (!/^[6-9]\d{9}$/.test(cleanMobile) && !/^\d{10}$/.test(cleanMobile)) {
    return {
      ok: false,
      error: 'Enter a valid 10-digit Support Mobile Number.',
    };
  }

  const trimmedEmail = (input.supportEmail ?? '').trim().slice(0, 120);
  if (trimmedEmail && !SIMPLE_EMAIL_RE.test(trimmedEmail)) {
    return {
      ok: false,
      error: 'Enter a valid Support Email ID (for example: support@dailydrop.in) or leave it blank.',
    };
  }

  return {
    ok: true,
    supportMobile: cleanMobile,
    supportEmail: trimmedEmail,
  };
}

/**
 * Finds the most recent previous order matching a customer's 10-digit mobile number.
 */
export function findLatestCustomerOrder(
  orders: Order[],
  customerMobile: string | null | undefined
): Order | null {
  const digits = sanitizeLocalPhone10(customerMobile ?? '');
  if (!/^\d{10}$/.test(digits)) return null;

  let latest: Order | null = null;
  for (const order of orders) {
    if (!order || !Array.isArray(order.items) || order.items.length === 0) continue;
    const orderDigits = sanitizeLocalPhone10(order.customerMobile ?? '');
    if (orderDigits !== digits) continue;
    if (!latest || (order.createdAt ?? 0) > (latest.createdAt ?? 0)) {
      latest = order;
    }
  }
  return latest;
}

export interface RepeatOrderCartResult {
  cart: Record<string, number>;
  addedItemCount: number;
  subtotal: number;
  unavailableNames: string[];
  adjustedStockNames: string[];
  priceChangedCount: number;
}

/**
 * Rebuilds a cart from a previous order while verifying current live catalog availability,
 * stock caps, and up-to-date prices (including active discounts).
 */
export function buildRepeatOrderCart(
  lastOrder: Order,
  catalog: Product[]
): RepeatOrderCartResult {
  const productById = new Map(catalog.map((p) => [p.id, p]));
  const cart: Record<string, number> = {};
  const unavailableNames: string[] = [];
  const adjustedStockNames: string[] = [];
  let addedItemCount = 0;
  let subtotal = 0;
  let priceChangedCount = 0;

  for (const item of lastOrder.items) {
    if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    const liveProduct = productById.get(item.productId);
    if (!liveProduct || !liveProduct.inStock || liveProduct.stock <= 0) {
      unavailableNames.push(item.name);
      continue;
    }

    const cappedQty = Math.min(item.quantity, liveProduct.stock);
    if (cappedQty < item.quantity) {
      adjustedStockNames.push(`${liveProduct.name} (max ${liveProduct.stock})`);
    }

    const pricing = resolveProductPricing(liveProduct);
    if (pricing.effectivePrice !== Math.round(item.price)) {
      priceChangedCount += 1;
    }

    cart[liveProduct.id] = (cart[liveProduct.id] ?? 0) + cappedQty;
    addedItemCount += cappedQty;
    subtotal += pricing.effectivePrice * cappedQty;
  }

  return {
    cart,
    addedItemCount,
    subtotal,
    unavailableNames,
    adjustedStockNames,
    priceChangedCount,
  };
}

export function createBulkBookingId(nowMs: number = Date.now()): string {
  const suffix = String(nowMs).slice(-6);
  const rand = Math.floor(10 + Math.random() * 89);
  return `BULK-${suffix}${rand}`;
}

export function validateBulkBookingInput(input: {
  customerName: string;
  customerMobile: string;
  address: string;
  quantity: number | string;
  eventDate: string;
  timeSlot: string;
  notes?: string;
  nowMs?: number;
}):
  | { ok: true; booking: BulkBookingRequest }
  | { ok: false; error: string } {
  const cleanName = sanitizeLocalText(input.customerName, 80);
  if (cleanName.length < 2) {
    return { ok: false, error: 'Please enter your name (at least 2 characters).' };
  }

  const cleanMobile = sanitizeLocalPhone10(input.customerMobile);
  if (!/^\d{10}$/.test(cleanMobile)) {
    return { ok: false, error: 'Please enter a valid 10-digit mobile number.' };
  }

  const cleanAddress = sanitizeLocalAddress(input.address, 260);
  if (cleanAddress.length < 5) {
    return { ok: false, error: 'Please enter the function venue / delivery address.' };
  }

  const qtyNum =
    typeof input.quantity === 'string'
      ? Number(input.quantity.trim())
      : Number(input.quantity);
  if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 10000) {
    return {
      ok: false,
      error: 'Please enter a valid water can quantity (between 1 and 10,000).',
    };
  }

  const cleanDate = sanitizeLocalText(input.eventDate, 30);
  if (!cleanDate) {
    return { ok: false, error: 'Please select an Event Date.' };
  }

  const cleanSlot = sanitizeLocalText(input.timeSlot, 60);
  if (!cleanSlot) {
    return { ok: false, error: 'Please select a Time Slot.' };
  }

  const cleanNotes = sanitizeLocalAddress(input.notes ?? '', 240);
  const now = input.nowMs ?? Date.now();

  return {
    ok: true,
    booking: {
      id: createBulkBookingId(now),
      customerName: cleanName,
      customerMobile: cleanMobile,
      address: cleanAddress,
      quantity: qtyNum,
      eventDate: cleanDate,
      timeSlot: cleanSlot,
      notes: cleanNotes,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Sanitizes and clamps Owner's Congratulations Popup duration to [1..10] seconds (default 4).
 */
export function sanitizeCongratsPopupSeconds(
  value: unknown,
  fallback: number = DEFAULT_CONGRATS_POPUP_SECONDS
): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.min(
    MAX_CONGRATS_POPUP_SECONDS,
    Math.max(MIN_CONGRATS_POPUP_SECONDS, Math.round(num))
  );
}

export function sanitizePromoBannerText(raw: unknown): string {
  return sanitizeLocalText(raw, 160);
}

export function sanitizePromoBannerButtonText(
  raw: unknown,
  fallback: string = DEFAULT_PROMO_BANNER_BUTTON_TEXT
): string {
  const cleaned = sanitizeLocalText(raw, 28);
  return cleaned || fallback;
}

export function sanitizePromoBannerIntervalMinutes(
  value: unknown,
  fallback: number = DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
): number {
  const num = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.min(
    MAX_PROMO_BANNER_INTERVAL_MINUTES,
    Math.max(MIN_PROMO_BANNER_INTERVAL_MINUTES, Math.round(num))
  );
}

export function sanitizePromoBannerPhone(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const digits = sanitizeLocalPhone10(raw);
  return /^\d{10}$/.test(digits) ? digits : '';
}

/**
 * Sanitizes an optional Running Rider Ad Banner Action URL.
 * Allows https://, http://, tel:, mailto:, bare wa.me/www. links, or a 10-digit phone number.
 * Strictly rejects javascript:, data:, vbscript:, intent:, or malformed strings.
 */
export function sanitizePromoBannerActionUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().slice(0, 300);
  if (!trimmed) return '';

  // Direct 10-digit Indian phone number (or +91XXXXXXXXXX)
  if (/^[+\d\s\-()]{10,16}$/.test(trimmed)) {
    const digits = sanitizeLocalPhone10(trimmed);
    if (/^\d{10}$/.test(digits)) {
      return `tel:+91${digits}`;
    }
    return '';
  }

  // Explicit tel: scheme
  if (/^tel:/i.test(trimmed)) {
    const rest = trimmed.slice(4).trim();
    const digits = sanitizeLocalPhone10(rest);
    if (/^\d{10}$/.test(digits)) {
      return `tel:+91${digits}`;
    }
    const cleanTel = rest.replace(/[^+\d]/g, '');
    return /^\+?\d{7,15}$/.test(cleanTel) ? `tel:${cleanTel}` : '';
  }

  // Explicit mailto: scheme
  if (/^mailto:/i.test(trimmed)) {
    const email = trimmed.slice(7).trim();
    return SIMPLE_EMAIL_RE.test(email) ? `mailto:${email}` : '';
  }

  // Allow bare wa.me/... or www.... by upgrading to https://
  const candidate =
    /^(wa\.me\/|www\.)/i.test(trimmed) ? `https://${trimmed}` : trimmed;

  try {
    const parsed = new URL(candidate);
    const proto = parsed.protocol.toLowerCase();
    if (proto !== 'https:' && proto !== 'http:') {
      return '';
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

export interface PromoActionTarget {
  kind: 'external' | 'tel' | 'mailto' | 'scroll_catalog';
  href: string;
  phone10?: string;
}

export function resolvePromoActionTarget(
  actionUrl?: string | null,
  fallbackPhone?: string | null
): PromoActionTarget {
  const cleanUrl = sanitizePromoBannerActionUrl(actionUrl ?? '');
  if (cleanUrl) {
    if (cleanUrl.startsWith('tel:')) {
      const phone10 = sanitizeLocalPhone10(cleanUrl.slice(4));
      return {
        kind: 'tel',
        href: cleanUrl,
        phone10: /^\d{10}$/.test(phone10) ? phone10 : undefined,
      };
    }
    if (cleanUrl.startsWith('mailto:')) {
      return { kind: 'mailto', href: cleanUrl };
    }
    return { kind: 'external', href: cleanUrl };
  }

  const cleanPhone = sanitizePromoBannerPhone(fallbackPhone ?? '');
  if (cleanPhone) {
    return {
      kind: 'tel',
      href: `tel:+91${cleanPhone}`,
      phone10: cleanPhone,
    };
  }

  return { kind: 'scroll_catalog', href: '#customer-catalog' };
}

export function validatePromoBannerDraft(input: {
  promoBannerEnabled: boolean;
  promoBannerText: string;
  promoBannerButtonText?: string;
  promoBannerActionUrl?: string;
  promoBannerIntervalMinutes?: number | string;
  promoBannerPhone?: string;
}):
  | {
      ok: true;
      promoBannerEnabled: boolean;
      promoBannerText: string;
      promoBannerButtonText: string;
      promoBannerActionUrl: string;
      promoBannerIntervalMinutes: number;
      promoBannerPhone: string;
    }
  | { ok: false; error: string } {
  const cleanText = sanitizePromoBannerText(input.promoBannerText);
  const cleanButtonText = sanitizePromoBannerButtonText(
    input.promoBannerButtonText,
    DEFAULT_PROMO_BANNER_BUTTON_TEXT
  );
  const rawActionUrl = (input.promoBannerActionUrl ?? '').trim();
  const cleanActionUrl = sanitizePromoBannerActionUrl(rawActionUrl);
  const rawPhone = (input.promoBannerPhone ?? '').trim();
  const cleanPhone = sanitizePromoBannerPhone(rawPhone);
  const cleanInterval = sanitizePromoBannerIntervalMinutes(
    input.promoBannerIntervalMinutes,
    DEFAULT_PROMO_BANNER_INTERVAL_MINUTES
  );

  if (input.promoBannerEnabled && cleanText.length === 0) {
    return {
      ok: false,
      error: 'Please enter Offer Text before turning the Running Rider Ad Banner ON.',
    };
  }

  if (rawActionUrl.length > 0 && !cleanActionUrl) {
    return {
      ok: false,
      error:
        'Enter a valid Action URL (https://..., wa.me/..., or 10-digit phone number) or leave it blank.',
    };
  }

  if (rawPhone.length > 0 && !cleanPhone) {
    return {
      ok: false,
      error: 'Enter a valid 10-digit Phone Number or leave it blank.',
    };
  }

  return {
    ok: true,
    promoBannerEnabled: Boolean(input.promoBannerEnabled),
    promoBannerText: cleanText,
    promoBannerButtonText: cleanButtonText,
    promoBannerActionUrl: cleanActionUrl,
    promoBannerIntervalMinutes: cleanInterval,
    promoBannerPhone: cleanPhone,
  };
}

export function shouldShowPromoBanner(settings: {
  promoBannerEnabled?: boolean;
  promoBannerText?: string;
}): boolean {
  return Boolean(
    settings.promoBannerEnabled &&
      typeof settings.promoBannerText === 'string' &&
      settings.promoBannerText.trim().length > 0
  );
}
