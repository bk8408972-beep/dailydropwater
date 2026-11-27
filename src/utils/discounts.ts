import type { OrderItem, Product } from '../types';

export interface ResolvedProductPricing {
  originalPrice: number;
  offerPrice: number;
  effectivePrice: number;
  savingsPerUnit: number;
  isDiscountActive: boolean;
}

/**
 * Resolves authoritative selling price, MRP (originalPrice), offerPrice, and per-unit savings.
 * Backwards-compatible with legacy products that only have `price`.
 */
export function resolveProductPricing(
  product: Pick<Product, 'price' | 'originalPrice' | 'offerPrice' | 'discountEnabled'>
): ResolvedProductPricing {
  const fallbackPrice =
    typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0
      ? Math.round(product.price)
      : 0;

  const originalPrice =
    typeof product.originalPrice === 'number' &&
    Number.isFinite(product.originalPrice) &&
    product.originalPrice > 0
      ? Math.round(product.originalPrice)
      : fallbackPrice;

  const offerPrice =
    typeof product.offerPrice === 'number' &&
    Number.isFinite(product.offerPrice) &&
    product.offerPrice > 0
      ? Math.round(product.offerPrice)
      : fallbackPrice;

  const isDiscountActive =
    product.discountEnabled === true &&
    originalPrice > 0 &&
    offerPrice > 0 &&
    offerPrice < originalPrice;

  const effectivePrice = isDiscountActive
    ? offerPrice
    : originalPrice > 0
      ? originalPrice
      : fallbackPrice;

  const savingsPerUnit = isDiscountActive ? originalPrice - offerPrice : 0;

  return {
    originalPrice: originalPrice > 0 ? originalPrice : effectivePrice,
    offerPrice: offerPrice > 0 ? offerPrice : effectivePrice,
    effectivePrice,
    savingsPerUnit,
    isDiscountActive,
  };
}

/**
 * Calculates total rupee savings across all items and quantities in a cart.
 */
export function calculateCartSavings(
  cart: Record<string, number>,
  products: Array<Pick<Product, 'id' | 'price' | 'originalPrice' | 'offerPrice' | 'discountEnabled'>>
): number {
  const productMap = new Map(products.map((p) => [p.id, p]));
  let totalSavings = 0;

  for (const [productId, rawQty] of Object.entries(cart)) {
    if (!Number.isInteger(rawQty) || rawQty <= 0) continue;
    const product = productMap.get(productId);
    if (!product) continue;
    const { savingsPerUnit } = resolveProductPricing(product);
    if (savingsPerUnit > 0) {
      totalSavings += savingsPerUnit * rawQty;
    }
  }

  return Math.max(0, Math.round(totalSavings));
}

/**
 * Calculates total savings recorded across OrderItems (supports both savingsPerUnit and originalPrice - price).
 */
export function calculateOrderSavings(items: OrderItem[]): number {
  let total = 0;
  for (const item of items) {
    if (!item || !Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    if (
      typeof item.savingsPerUnit === 'number' &&
      Number.isFinite(item.savingsPerUnit) &&
      item.savingsPerUnit > 0
    ) {
      total += Math.round(item.savingsPerUnit) * item.quantity;
    } else if (
      typeof item.originalPrice === 'number' &&
      Number.isFinite(item.originalPrice) &&
      item.originalPrice > item.price
    ) {
      total += Math.round(item.originalPrice - item.price) * item.quantity;
    }
  }
  return Math.max(0, Math.round(total));
}

/**
 * Validates Owner MRP / Offer Price / Discount ON-OFF edits before writing to Firebase.
 */
export function validateProductDiscountDraft(params: {
  originalPrice: number;
  offerPrice: number;
  discountEnabled: boolean;
}): { ok: true; activePrice: number; originalPrice: number; offerPrice: number; discountEnabled: boolean } | { ok: false; error: string } {
  const mrp = Math.round(params.originalPrice);
  const offer = Math.round(params.offerPrice);

  if (!Number.isFinite(mrp) || mrp <= 0 || mrp > 100000) {
    return { ok: false, error: 'Original Price (MRP) must be greater than ₹0.' };
  }

  if (params.discountEnabled) {
    if (!Number.isFinite(offer) || offer <= 0 || offer > 100000) {
      return { ok: false, error: 'Offer Price must be greater than ₹0 when Discount is ON.' };
    }
    if (offer >= mrp) {
      return {
        ok: false,
        error: 'Offer Price must be lower than Original Price (MRP) to turn Discount ON.',
      };
    }
    return {
      ok: true,
      activePrice: offer,
      originalPrice: mrp,
      offerPrice: offer,
      discountEnabled: true,
    };
  }

  const safeOffer =
    Number.isFinite(offer) && offer > 0 && offer <= 100000 ? offer : mrp;

  return {
    ok: true,
    activePrice: mrp,
    originalPrice: mrp,
    offerPrice: safeOffer,
    discountEnabled: false,
  };
}

/**
 * Formats the exact full-screen celebration headline for customer discount savings.
 */
export function formatSavingsCelebrationHeadline(totalSavings: number): string {
  const cleanSavings = Math.max(0, Math.round(totalSavings));
  return `Congratulations! Aapko ₹${cleanSavings} Discount Ho Gaya!`;
}

/**
 * Formats the green discount badge displayed right next to the main price on product cards
 * (e.g. "₹20 Discount" or "₹50 Discount") whenever MRP minus Selling Price > ₹0.
 */
export function formatDiscountAmountBadge(savingsPerUnit: number): string | null {
  const clean = Math.round(savingsPerUnit);
  if (!Number.isFinite(clean) || clean <= 0) {
    return null;
  }
  return `₹${clean} Discount`;
}
