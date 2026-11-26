import type { Order, PaymentMethod, StoreSettings } from '../types';

export interface PaymentAvailability {
  upiEnabled: boolean;
  codEnabled: boolean;
  availableMethods: PaymentMethod[];
  checkoutDisabled: boolean;
  defaultMethod: PaymentMethod | null;
}

/**
 * Resolves active payment options from Owner's StoreSettings:
 * - Both ON -> ['Cash on Delivery', 'UPI']
 * - UPI ON, COD OFF -> ['UPI']
 * - UPI OFF, COD ON -> ['Cash on Delivery']
 * - Both OFF -> [] (checkoutDisabled = true)
 */
export function getAvailablePaymentOptions(
  settings: Pick<StoreSettings, 'upiEnabled' | 'codEnabled'>
): PaymentAvailability {
  const upiEnabled = Boolean(settings.upiEnabled);
  const codEnabled = Boolean(settings.codEnabled);
  const availableMethods: PaymentMethod[] = [];
  if (codEnabled) availableMethods.push('Cash on Delivery');
  if (upiEnabled) availableMethods.push('UPI');

  return {
    upiEnabled,
    codEnabled,
    availableMethods,
    checkoutDisabled: availableMethods.length === 0,
    defaultMethod: availableMethods[0] ?? null,
  };
}

/**
 * Generates standard UPI deep-link URI for both scannable QR code and Open UPI App button:
 * upi://pay?pa=<upiId>&pn=<upiName>&am=<grandTotal>&cu=INR
 */
export function buildUpiPaymentUri(
  upiId: string,
  upiName: string,
  grandTotal: number
): string {
  const cleanPa = upiId.trim();
  if (!cleanPa) return '';
  const cleanPn = (upiName || 'DailyDrop Water').trim();
  const safeAmount = Math.max(0, Math.round((Number(grandTotal) || 0) * 100) / 100);
  const amountStr = Number.isInteger(safeAmount)
    ? String(safeAmount)
    : safeAmount.toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(cleanPa)}&pn=${encodeURIComponent(cleanPn)}&am=${amountStr}&cu=INR`;
}

/**
 * Strips non-digits and returns up to 12 digits for UTR input.
 */
export function sanitizeUtrInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

/**
 * Validates that a UTR / UPI Transaction Reference is strictly 12 numeric digits.
 */
export function isValidUtr(utr?: string | null): boolean {
  if (!utr) return false;
  return /^\d{12}$/.test(utr.trim());
}

/**
 * Checks whether an order was placed via UPI.
 */
export function isUpiOrder(order: Pick<Order, 'paymentMethod'>): boolean {
  return String(order.paymentMethod || '')
    .trim()
    .toUpperCase()
    .includes('UPI');
}

/**
 * Checks whether an order is Cash on Delivery (COD).
 */
export function isCodOrder(order: Pick<Order, 'paymentMethod'>): boolean {
  return !isUpiOrder(order);
}

export interface OrderPaymentBadge {
  kind: 'cod' | 'upi_pending' | 'upi_paid';
  label: string;
  shortLabel: string;
  utr?: string;
}

/**
 * Returns canonical payment badge details for Customer, Rider, and Owner order cards:
 * - UPI verified: "UPI PAID • UTR <utr>"
 * - UPI unverified: "UPI PAYMENT PENDING"
 * - COD: "Cash on Delivery (COD)"
 */
export function getOrderPaymentBadge(
  order: Pick<Order, 'paymentMethod' | 'upiUtr' | 'upiVerified'>
): OrderPaymentBadge {
  if (isUpiOrder(order)) {
    const cleanUtr = (order.upiUtr || '').trim();
    if (order.upiVerified === true) {
      return {
        kind: 'upi_paid',
        label: cleanUtr ? `UPI PAID • UTR ${cleanUtr}` : 'UPI PAID • UTR',
        shortLabel: 'UPI PAID',
        utr: cleanUtr || undefined,
      };
    }
    return {
      kind: 'upi_pending',
      label: 'UPI PAYMENT PENDING',
      shortLabel: 'UPI PENDING',
      utr: cleanUtr || undefined,
    };
  }

  return {
    kind: 'cod',
    label: 'Cash on Delivery (COD)',
    shortLabel: 'COD Cash',
  };
}
