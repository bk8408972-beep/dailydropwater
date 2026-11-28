import type {
  FloorLevel,
  GeoPoint,
  Order,
  OrderItem,
  PaymentMethod,
  Product,
  ServiceMode,
  StoreSettings,
} from '../types';
import { createOrderId } from './domain';
import {
  calculateOrderBillBreakdown,
  pickBestOnlineRiderForAutoAssign,
  STORE_CLOSED_BANNER_MESSAGE,
} from './storeSettings';
import { getAvailablePaymentOptions, isValidUtr, sanitizeUtrInput } from './payment';
import { checkDeliveryRadius, isValidGeoPoint } from './geo';
import { loadOwnerSession } from './sessionStorage';
import { resolveProductPricing } from './discounts';
import { checkMinimumOrderAmount } from './customerFeatures';
import type { RiderRecord } from '../types';

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
const ANGLE_BRACKETS_RE = /[<>]/g;
const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'tel:', 'upi:']);

/**
 * Sanitizes single-line user input by stripping control bytes, HTML angle brackets,
 * and collapsing redundant whitespace while enforcing a maximum character length.
 */
export function sanitizeTextInput(raw: string, maxLength: number = 120): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(ANGLE_BRACKETS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

/**
 * Sanitizes multi-line address / notes input by removing control chars and angle brackets
 * while preserving readable spacing up to maxLength.
 */
export function sanitizeAddressInput(raw: string, maxLength: number = 280): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(ANGLE_BRACKETS_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, maxLength));
}

/**
 * Normalizes a phone string down to at most 10 digits (handling +91 / 0 prefixes cleanly).
 */
export function sanitizePhone10(raw: string): string {
  if (typeof raw !== 'string') return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits.slice(0, 10);
}

/**
 * Sanitizes a UPI VPA string (e.g., merchant@upi) by removing spaces and unsafe characters.
 */
export function sanitizeUpiId(raw: string): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9._@-]/g, '')
    .slice(0, 80);
}

export function isValidUpiIdFormat(upiId: string): boolean {
  const clean = sanitizeUpiId(upiId);
  return /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/.test(clean);
}

/**
 * Validates that an external link uses an explicitly allowed safe scheme
 * (blocks javascript:, vbscript:, data:, file:, intent:).
 */
export function isSafeExternalUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Enforces an active authenticated Owner session before running Owner-only mutations or deletions.
 */
export function assertOwnerAuthenticated(
  actionName: string = 'this owner action'
): void {
  const session = loadOwnerSession();
  if (!session || session.authenticated !== true) {
    throw new Error(
      `Owner authentication required to perform ${actionName}. Please sign in as Owner.`
    );
  }
}

export interface CanonicalOrderBuildParams {
  cart: Record<string, number>;
  catalog: Product[];
  storeSettings: StoreSettings;
  customerName: string;
  customerMobile: string;
  address: string;
  customerLocation: GeoPoint | null;
  floorLevel: FloorLevel | null;
  hasLift: boolean | null;
  serviceMode: ServiceMode;
  eventDate?: string;
  timeSlot?: string;
  eventNotes?: string;
  paymentMethod: PaymentMethod;
  upiUtr?: string;
  expectedClientTotal?: number;
  riders?: RiderRecord[];
  existingOrders?: Order[];
  nowMs?: number;
  dailySequence?: {
    orderNumber: number;
    orderDateIst: string;
    orderKey: string;
  };
}

export type CanonicalOrderResult =
  | { ok: true; order: Order; autoAssignedRider: RiderRecord | null }
  | { ok: false; error: string; field?: string };

/**
 * Authoritatively validates all customer inputs, catalog prices, stock bounds,
 * delivery radius, floor/platform/delivery fees, and 12-digit UTRs before creating
 * a canonical Order payload to write to Firebase RTDB.
 */
export function validateAndBuildCanonicalOrder(
  params: CanonicalOrderBuildParams
): CanonicalOrderResult {
  const { storeSettings, catalog, cart } = params;

  if (!storeSettings.isOpen) {
    return { ok: false, error: STORE_CLOSED_BANNER_MESSAGE, field: 'submit' };
  }

  const payAvail = getAvailablePaymentOptions(storeSettings);
  if (payAvail.checkoutDisabled) {
    return {
      ok: false,
      error:
        'Checkout is currently disabled because both UPI and COD are turned OFF.',
      field: 'submit',
    };
  }

  if (params.paymentMethod === 'UPI' && !payAvail.upiEnabled) {
    return {
      ok: false,
      error:
        'UPI payment is currently turned OFF by the store. Please choose Cash on Delivery.',
      field: 'submit',
    };
  }
  if (params.paymentMethod === 'Cash on Delivery' && !payAvail.codEnabled) {
    return {
      ok: false,
      error:
        'Cash on Delivery is currently turned OFF by the store. Please pay via UPI.',
      field: 'submit',
    };
  }

  const cleanName = sanitizeTextInput(params.customerName, 80);
  const cleanMobile = sanitizePhone10(params.customerMobile);
  const cleanAddress = sanitizeAddressInput(params.address, 260);

  if (cleanName.length < 2) {
    return {
      ok: false,
      error: 'Enter your full name (at least 2 characters).',
      field: 'customerName',
    };
  }
  if (!/^\d{10}$/.test(cleanMobile)) {
    return {
      ok: false,
      error: 'Enter a valid 10-digit mobile number.',
      field: 'customerMobile',
    };
  }
  if (cleanAddress.length < 8) {
    return {
      ok: false,
      error: 'Enter your House/Flat No. and a nearby landmark.',
      field: 'address',
    };
  }
  if (!params.floorLevel) {
    return {
      ok: false,
      error: 'Please select your floor level.',
      field: 'floorLevel',
    };
  }
  if (typeof params.hasLift !== 'boolean') {
    return {
      ok: false,
      error: 'Please select whether a lift is available (Yes or No).',
      field: 'hasLift',
    };
  }

  const validGps = isValidGeoPoint(params.customerLocation)
    ? {
        lat: Number(params.customerLocation!.lat.toFixed(6)),
        lng: Number(params.customerLocation!.lng.toFixed(6)),
      }
    : null;

  if (storeSettings.radiusEnabled) {
    if (!validGps) {
      return {
        ok: false,
        error: `GPS location is required to verify you are within our ${storeSettings.deliveryRadiusKm} km delivery radius.`,
        field: 'location',
      };
    }
    const radiusCheck = checkDeliveryRadius(
      validGps.lat,
      validGps.lng,
      storeSettings
    );
    if (radiusCheck.blocked) {
      return {
        ok: false,
        error: radiusCheck.modalMessage,
        field: 'location',
      };
    }
  }

  const cleanUtr =
    params.paymentMethod === 'UPI' ? sanitizeUtrInput(params.upiUtr ?? '') : '';
  if (params.paymentMethod === 'UPI' && !isValidUtr(cleanUtr)) {
    return {
      ok: false,
      error:
        'Enter a valid 12-digit numeric UTR / transaction reference number after paying via UPI.',
      field: 'upiUtr',
    };
  }

  // Rebuild items strictly from authoritative catalog prices and stock limits
  const productById = new Map(catalog.map((p) => [p.id, p]));
  const items: OrderItem[] = [];
  let canonicalSubtotal = 0;
  let totalSavings = 0;

  for (const [productId, rawQty] of Object.entries(cart)) {
    if (!Number.isInteger(rawQty) || rawQty <= 0) continue;
    const product = productById.get(productId);
    if (!product) {
      return {
        ok: false,
        error: 'One or more items in your cart are no longer available. Please refresh.',
        field: 'cart',
      };
    }
    if (!product.inStock || product.stock <= 0) {
      return {
        ok: false,
        error: `"${product.name}" is currently out of stock.`,
        field: 'cart',
      };
    }
    if (rawQty > 500 || rawQty > product.stock) {
      return {
        ok: false,
        error: `Requested quantity for "${product.name}" exceeds available stock (${product.stock}).`,
        field: 'cart',
      };
    }

    const pricing = resolveProductPricing(product);
    const unitPrice = pricing.effectivePrice;
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      return {
        ok: false,
        error: `Invalid price detected for "${product.name}".`,
        field: 'cart',
      };
    }

    canonicalSubtotal += unitPrice * rawQty;
    totalSavings += pricing.savingsPerUnit * rawQty;
    items.push({
      productId: product.id,
      name: sanitizeTextInput(product.name, 100),
      price: unitPrice,
      originalPrice: pricing.originalPrice,
      savingsPerUnit: pricing.savingsPerUnit,
      quantity: rawQty,
      category: product.category,
    });
  }

  if (items.length === 0 || canonicalSubtotal <= 0) {
    return {
      ok: false,
      error: 'Please add at least one valid item to your cart.',
      field: 'cart',
    };
  }

  const minCheck = checkMinimumOrderAmount(
    canonicalSubtotal,
    storeSettings.minOrderAmount
  );
  if (!minCheck.met && minCheck.message) {
    return {
      ok: false,
      error: minCheck.message,
      field: 'cart',
    };
  }

  const canonicalBill = calculateOrderBillBreakdown(
    canonicalSubtotal,
    params.floorLevel,
    params.hasLift,
    storeSettings
  );

  if (
    typeof params.expectedClientTotal === 'number' &&
    Number.isFinite(params.expectedClientTotal) &&
    Math.round(params.expectedClientTotal) !== canonicalBill.totalAmount
  ) {
    return {
      ok: false,
      error:
        'Order prices or fees were updated just now. Please review the updated total and tap Place Order again.',
      field: 'submit',
    };
  }

  let eventDetails: Order['eventDetails'] = null;
  if (params.serviceMode === 'events') {
    const cleanDate = sanitizeTextInput(params.eventDate ?? '', 30);
    const cleanSlot = sanitizeTextInput(params.timeSlot ?? '', 60);
    const cleanNotes = sanitizeAddressInput(params.eventNotes ?? '', 240);
    if (!cleanDate) {
      return {
        ok: false,
        error: 'Select your event date for bulk water supply.',
        field: 'eventDate',
      };
    }
    if (!cleanSlot) {
      return {
        ok: false,
        error: 'Select a preferred delivery time slot.',
        field: 'timeSlot',
      };
    }
    eventDetails = {
      eventDate: cleanDate,
      timeSlot: cleanSlot,
      notes: cleanNotes,
    };
  }

  let autoAssignedRider: RiderRecord | null = null;
  if (storeSettings.autoAssign && params.riders && params.existingOrders) {
    autoAssignedRider = pickBestOnlineRiderForAutoAssign(
      params.riders,
      params.existingOrders
    );
  }

  const now = params.nowMs ?? Date.now();
  const orderId = params.dailySequence?.orderKey || createOrderId(now);

  const order: Order = {
    id: orderId,
    orderNumber: params.dailySequence?.orderNumber ?? null,
    orderDateIst: params.dailySequence?.orderDateIst ?? null,
    customerName: cleanName,
    customerMobile: cleanMobile,
    address: cleanAddress,
    customerLat: validGps ? validGps.lat : null,
    customerLng: validGps ? validGps.lng : null,
    customerLocation: validGps,
    gpsStatus: validGps ? 'captured' : 'address_only',
    floorLevel: params.floorLevel,
    hasLift: params.hasLift,
    itemsSubtotal: canonicalBill.itemsSubtotal,
    platformFee: canonicalBill.platformFee,
    deliveryFee: canonicalBill.deliveryFee,
    floorCharge: canonicalBill.floorCharge,
    ownerApproved: Boolean(autoAssignedRider),
    autoAssigned: Boolean(autoAssignedRider),
    serviceMode: params.serviceMode,
    eventDetails,
    paymentMethod: params.paymentMethod,
    upiUtr: params.paymentMethod === 'UPI' ? cleanUtr : null,
    upiVerified: false,
    upiVerifiedAt: null,
    items,
    totalAmount: canonicalBill.totalAmount,
    totalSavings,
    status: autoAssignedRider ? 'assigned' : 'pending',
    assignedRiderId: autoAssignedRider ? autoAssignedRider.id : null,
    assignedRiderName: autoAssignedRider ? autoAssignedRider.name : null,
    assignedRiderPhone: autoAssignedRider ? autoAssignedRider.mobile : null,
    assignedRiderMobile: autoAssignedRider ? autoAssignedRider.mobile : null,
    assignedAt: autoAssignedRider ? now : null,
    createdAt: now,
    updatedAt: now,
    deliveredAt: null,
  };

  return { ok: true, order, autoAssignedRider };
}

/**
 * Final integrity validation immediately prior to writing an Order to Firebase RTDB.
 * Blocks tampered totals, invalid quantities, malformed phone numbers, or invalid UTRs.
 */
export function validateOrderWritePayload(order: Order): string | null {
  if (!order || typeof order !== 'object') {
    return 'Invalid order payload.';
  }
  if (!order.id || !/^DD-[A-Za-z0-9_-]{4,24}$/.test(order.id)) {
    return 'Invalid order ID format.';
  }
  if (
    order.orderNumber !== undefined &&
    order.orderNumber !== null &&
    (!Number.isInteger(order.orderNumber) || order.orderNumber <= 0)
  ) {
    return 'Invalid daily order number.';
  }
  if (!order.customerName || order.customerName.trim().length < 2) {
    return 'Customer name is required.';
  }
  if (!/^\d{10}$/.test(order.customerMobile)) {
    return 'Customer mobile must be exactly 10 digits.';
  }
  if (!order.address || order.address.trim().length < 8) {
    return 'Delivery address is too short.';
  }
  if (!Array.isArray(order.items) || order.items.length === 0) {
    return 'Order must contain at least one item.';
  }

  let recomputedSubtotal = 0;
  for (const item of order.items) {
    if (
      !item ||
      typeof item.price !== 'number' ||
      !Number.isFinite(item.price) ||
      item.price <= 0 ||
      !Number.isInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > 500
    ) {
      return 'Invalid item price or quantity in order.';
    }
    recomputedSubtotal += Math.round(item.price) * item.quantity;
  }

  const platformFee = Math.max(0, Math.round(order.platformFee ?? 0));
  const deliveryFee = Math.max(0, Math.round(order.deliveryFee ?? 0));
  const floorCharge = Math.max(0, Math.round(order.floorCharge ?? 0));
  const expectedTotal = recomputedSubtotal + platformFee + deliveryFee + floorCharge;

  if (
    typeof order.totalAmount !== 'number' ||
    !Number.isFinite(order.totalAmount) ||
    Math.round(order.totalAmount) !== expectedTotal ||
    order.totalAmount <= 0
  ) {
    return 'Order total integrity check failed.';
  }

  if (order.paymentMethod === 'UPI') {
    if (!order.upiUtr || !isValidUtr(order.upiUtr)) {
      return 'UPI orders require a valid 12-digit numeric UTR.';
    }
  }

  return null;
}

export interface ProductStockDeduction {
  productId: string;
  previousStock: number;
  deductedQty: number;
  nextStock: number;
  nextInStock: boolean;
}

/**
 * Computes exact post-order stock deductions for each unique product in an order,
 * clamping stock to >= 0 and automatically setting inStock=false when stock reaches 0.
 */
export function computeStockDeductions(
  items: OrderItem[],
  catalog: Array<Pick<Product, 'id' | 'stock' | 'inStock'>>
): ProductStockDeduction[] {
  const qtyByProductId = new Map<string, number>();
  for (const item of items) {
    if (!item || !item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      continue;
    }
    qtyByProductId.set(
      item.productId,
      (qtyByProductId.get(item.productId) ?? 0) + item.quantity
    );
  }

  const productById = new Map(catalog.map((p) => [p.id, p]));
  const deductions: ProductStockDeduction[] = [];

  for (const [productId, deductedQty] of qtyByProductId.entries()) {
    const product = productById.get(productId);
    if (!product) continue;
    const previousStock =
      typeof product.stock === 'number' && Number.isFinite(product.stock)
        ? Math.max(0, Math.round(product.stock))
        : 0;
    const nextStock = Math.max(0, previousStock - deductedQty);
    deductions.push({
      productId,
      previousStock,
      deductedQty,
      nextStock,
      nextInStock: nextStock > 0 && product.inStock !== false,
    });
  }

  return deductions;
}

