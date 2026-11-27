import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSavings,
  calculateOrderSavings,
  formatDiscountAmountBadge,
  formatSavingsCelebrationHeadline,
  resolveProductPricing,
  validateProductDiscountDraft,
} from './discounts.ts';

test('resolveProductPricing handles legacy products, discount OFF, and discount ON cleanly', () => {
  // Legacy product with only price
  const legacy = resolveProductPricing({ price: 90 });
  assert.equal(legacy.isDiscountActive, false);
  assert.equal(legacy.effectivePrice, 90);
  assert.equal(legacy.originalPrice, 90);
  assert.equal(legacy.savingsPerUnit, 0);

  // Discount ON: MRP 60, Offer 40 -> SAVE 20
  const discounted = resolveProductPricing({
    price: 40,
    originalPrice: 60,
    offerPrice: 40,
    discountEnabled: true,
  });
  assert.equal(discounted.isDiscountActive, true);
  assert.equal(discounted.originalPrice, 60);
  assert.equal(discounted.offerPrice, 40);
  assert.equal(discounted.effectivePrice, 40);
  assert.equal(discounted.savingsPerUnit, 20);

  // Discount OFF: reverts active price to MRP 60 with 0 savings
  const toggledOff = resolveProductPricing({
    price: 40,
    originalPrice: 60,
    offerPrice: 40,
    discountEnabled: false,
  });
  assert.equal(toggledOff.isDiscountActive, false);
  assert.equal(toggledOff.effectivePrice, 60);
  assert.equal(toggledOff.savingsPerUnit, 0);
});

test('calculateCartSavings totals savings accurately across multiple products and quantities (₹10, ₹50, ₹200+)', () => {
  const catalog = [
    { id: 'p1', price: 40, originalPrice: 60, offerPrice: 40, discountEnabled: true }, // ₹20 off each
    { id: 'p2', price: 80, originalPrice: 90, offerPrice: 80, discountEnabled: true }, // ₹10 off each
    { id: 'p3', price: 100, originalPrice: 120, offerPrice: 100, discountEnabled: false }, // OFF -> ₹0
  ];

  assert.equal(calculateCartSavings({ p2: 1 }, catalog), 10);
  assert.equal(calculateCartSavings({ p1: 2, p2: 1, p3: 4 }, catalog), 50);
  assert.equal(calculateCartSavings({ p1: 10, p2: 3 }, catalog), 230);
  assert.equal(calculateCartSavings({ p3: 5 }, catalog), 0);
});

test('validateProductDiscountDraft enforces Offer Price < MRP when Discount is ON', () => {
  const invalid = validateProductDiscountDraft({
    originalPrice: 60,
    offerPrice: 60,
    discountEnabled: true,
  });
  assert.equal(invalid.ok, false);

  const validOn = validateProductDiscountDraft({
    originalPrice: 60,
    offerPrice: 40,
    discountEnabled: true,
  });
  assert.equal(validOn.ok, true);
  if (validOn.ok) {
    assert.equal(validOn.activePrice, 40);
    assert.equal(validOn.originalPrice, 60);
  }

  const validOff = validateProductDiscountDraft({
    originalPrice: 60,
    offerPrice: 40,
    discountEnabled: false,
  });
  assert.equal(validOff.ok, true);
  if (validOff.ok) {
    assert.equal(validOff.activePrice, 60);
  }
});

test('calculateOrderSavings and formatSavingsCelebrationHeadline produce exact celebration text', () => {
  const savings = calculateOrderSavings([
    {
      productId: 'p1',
      name: '20L Can',
      price: 40,
      originalPrice: 60,
      savingsPerUnit: 20,
      quantity: 3,
      category: 'Water Cans',
    },
    {
      productId: 'p2',
      name: 'Cold Drink',
      price: 80,
      originalPrice: 90,
      quantity: 2,
      category: 'Cold Drinks',
    },
  ]);
  assert.equal(savings, 80);
  assert.equal(
    formatSavingsCelebrationHeadline(savings),
    'Congratulations! Aapko ₹80 Discount Ho Gaya!'
  );
});

test('formatDiscountAmountBadge formats exact ₹X Discount badge whenever savings > 0', () => {
  assert.equal(formatDiscountAmountBadge(20), '₹20 Discount');
  assert.equal(formatDiscountAmountBadge(50), '₹50 Discount');
  assert.equal(formatDiscountAmountBadge(0), null);
  assert.equal(formatDiscountAmountBadge(-5), null);
});

test('resolveProductPricing resolves discount whenever MRP > Selling Price unless explicitly disabled', () => {
  const implicitDiscount = resolveProductPricing({
    price: 70,
    originalPrice: 90,
  });
  assert.equal(implicitDiscount.isDiscountActive, true);
  assert.equal(implicitDiscount.effectivePrice, 70);
  assert.equal(implicitDiscount.originalPrice, 90);
  assert.equal(implicitDiscount.savingsPerUnit, 20);
  assert.equal(formatDiscountAmountBadge(implicitDiscount.savingsPerUnit), '₹20 Discount');
});

