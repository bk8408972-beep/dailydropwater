import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRepeatOrderCart,
  checkMinimumOrderAmount,
  findLatestCustomerOrder,
  partitionCustomerOrders,
  resolvePromoActionTarget,
  sanitizeCongratsPopupSeconds,
  sanitizePromoBannerActionUrl,
  sanitizePromoBannerIntervalMinutes,
  shouldShowPromoBanner,
  validateBulkBookingInput,
  validatePromoBannerDraft,
  validateSupportContactDraft,
} from './customerFeatures';
import type { Order, Product } from '../types';

const SAMPLE_CATALOG: Product[] = [
  {
    id: 'bisleri_20l',
    name: 'Bisleri 20L Water Can',
    category: 'Water Cans',
    price: 40,
    originalPrice: 60,
    offerPrice: 40,
    discountEnabled: true,
    stock: 20,
    inStock: true,
  },
  {
    id: 'thumsup_2l',
    name: 'Thums Up 2L',
    category: 'Cold Drinks',
    price: 95,
    stock: 3,
    inStock: true,
  },
  {
    id: 'out_of_stock_item',
    name: 'Sprite 750ml',
    category: 'Cold Drinks',
    price: 45,
    stock: 0,
    inStock: false,
  },
];

test('checkMinimumOrderAmount returns exact Hinglish guidance when below minimum and passes at/above minimum', () => {
  const below = checkMinimumOrderAmount(60, 100);
  assert.equal(below.met, false);
  assert.equal(below.remaining, 40);
  assert.equal(
    below.message,
    'Minimum order ₹100 ka hona zaroori hai — ₹40 ka item aur add karein'
  );

  const exact = checkMinimumOrderAmount(100, 100);
  assert.equal(exact.met, true);
  assert.equal(exact.remaining, 0);
  assert.equal(exact.message, null);

  const above = checkMinimumOrderAmount(145, 100);
  assert.equal(above.met, true);
  assert.equal(above.remaining, 0);

  const zeroMin = checkMinimumOrderAmount(20, 0);
  assert.equal(zeroMin.met, true);
});

test('buildRepeatOrderCart verifies current live prices, caps stock, and skips unavailable items', () => {
  const prevOrder: Order = {
    id: 'DD-OLD1',
    customerName: 'Aarav',
    customerMobile: '9876543210',
    address: 'House 12, Main Street',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [
      {
        productId: 'bisleri_20l',
        name: 'Bisleri 20L Water Can',
        price: 55, // old price
        quantity: 2,
        category: 'Water Cans',
      },
      {
        productId: 'thumsup_2l',
        name: 'Thums Up 2L',
        price: 95,
        quantity: 5, // exceeds current stock of 3
        category: 'Cold Drinks',
      },
      {
        productId: 'out_of_stock_item',
        name: 'Sprite 750ml',
        price: 45,
        quantity: 1,
        category: 'Cold Drinks',
      },
    ],
    totalAmount: 630,
    status: 'delivered',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const result = buildRepeatOrderCart(prevOrder, SAMPLE_CATALOG);
  assert.deepEqual(result.cart, { bisleri_20l: 2, thumsup_2l: 3 });
  assert.equal(result.addedItemCount, 5);
  assert.equal(result.subtotal, 2 * 40 + 3 * 95);
  assert.equal(result.priceChangedCount, 1);
  assert.deepEqual(result.unavailableNames, ['Sprite 750ml']);
  assert.equal(result.adjustedStockNames.length, 1);
});

test('findLatestCustomerOrder selects the newest order matching customer mobile', () => {
  const baseOrder: Order = {
    id: 'DD-1',
    customerName: 'Aarav',
    customerMobile: '9876543210',
    address: 'House 12, Main Road',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [
      { productId: 'bisleri_20l', name: 'Bisleri 20L', price: 40, quantity: 2, category: 'Water Cans' },
    ],
    totalAmount: 80,
    status: 'delivered',
    createdAt: 1000,
    updatedAt: 1000,
  };
  const newerOrder: Order = { ...baseOrder, id: 'DD-2', createdAt: 2000 };
  const otherCustomer: Order = { ...baseOrder, id: 'DD-3', customerMobile: '9111111111', createdAt: 5000 };

  const latest = findLatestCustomerOrder([baseOrder, otherCustomer, newerOrder], '+91 98765 43210');
  assert.equal(latest?.id, 'DD-2');
});

test('validateBulkBookingInput validates quantities, event date, time slot, and builds pending request', () => {
  const invalidQty = validateBulkBookingInput({
    customerName: 'Ramesh',
    customerMobile: '9876543210',
    address: 'Royal Function Hall, Road 2',
    quantity: 0,
    eventDate: '2026-12-15',
    timeSlot: 'Morning (8 AM – 11 AM)',
  });
  assert.equal(invalidQty.ok, false);

  const valid = validateBulkBookingInput({
    customerName: 'Ramesh',
    customerMobile: '9876543210',
    address: 'Royal Function Hall, Road 2',
    quantity: 50,
    eventDate: '2026-12-15',
    timeSlot: 'Morning (8 AM – 11 AM)',
    notes: 'Gate 2 near stage',
    nowMs: 1700000123456,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.booking.quantity, 50);
    assert.equal(valid.booking.status, 'pending');
    assert.equal(valid.booking.eventDate, '2026-12-15');
  }
});

test('validateSupportContactDraft validates 10-digit mobile and optional email format', () => {
  const badMobile = validateSupportContactDraft({
    supportMobile: '12345',
    supportEmail: 'help@dailydrop.in',
  });
  assert.equal(badMobile.ok, false);

  const badEmail = validateSupportContactDraft({
    supportMobile: '9885138592',
    supportEmail: 'not-an-email',
  });
  assert.equal(badEmail.ok, false);

  const okBlankEmail = validateSupportContactDraft({
    supportMobile: '+91 9885138592',
    supportEmail: '   ',
  });
  assert.equal(okBlankEmail.ok, true);
  if (okBlankEmail.ok) {
    assert.equal(okBlankEmail.supportMobile, '9885138592');
    assert.equal(okBlankEmail.supportEmail, '');
  }

  const okFull = validateSupportContactDraft({
    supportMobile: '9123456789',
    supportEmail: 'care@dailydrop.in',
  });
  assert.equal(okFull.ok, true);
  if (okFull.ok) {
    assert.equal(okFull.supportMobile, '9123456789');
    assert.equal(okFull.supportEmail, 'care@dailydrop.in');
  }
});

test('sanitizeCongratsPopupSeconds clamps to 1..10 seconds and defaults to 4 seconds', () => {
  assert.equal(sanitizeCongratsPopupSeconds(undefined), 4);
  assert.equal(sanitizeCongratsPopupSeconds(''), 4);
  assert.equal(sanitizeCongratsPopupSeconds(0), 4);
  assert.equal(sanitizeCongratsPopupSeconds(-3), 4);
  assert.equal(sanitizeCongratsPopupSeconds(1), 1);
  assert.equal(sanitizeCongratsPopupSeconds(4), 4);
  assert.equal(sanitizeCongratsPopupSeconds('7'), 7);
  assert.equal(sanitizeCongratsPopupSeconds(10), 10);
  assert.equal(sanitizeCongratsPopupSeconds(25), 10);
});

test('validatePromoBannerDraft and shouldShowPromoBanner enforce text/phone validation and ON/OFF visibility', () => {
  const emptyWhenOn = validatePromoBannerDraft({
    promoBannerEnabled: true,
    promoBannerText: '   ',
    promoBannerPhone: '',
  });
  assert.equal(emptyWhenOn.ok, false);

  const badPhone = validatePromoBannerDraft({
    promoBannerEnabled: true,
    promoBannerText: 'Summer Offer: ₹10 OFF on 20L Cans!',
    promoBannerPhone: '12345',
  });
  assert.equal(badPhone.ok, false);

  const validWithPhone = validatePromoBannerDraft({
    promoBannerEnabled: true,
    promoBannerText: '<b>Summer Sale!</b> Flat ₹10 OFF on 20L Cans',
    promoBannerPhone: '+91 98765 43210',
  });
  assert.equal(validWithPhone.ok, true);
  if (validWithPhone.ok) {
    assert.equal(validWithPhone.promoBannerText, 'Summer Sale! Flat ₹10 OFF on 20L Cans');
    assert.equal(validWithPhone.promoBannerPhone, '9876543210');
    assert.equal(shouldShowPromoBanner(validWithPhone), true);
  }

  const validOff = validatePromoBannerDraft({
    promoBannerEnabled: false,
    promoBannerText: 'Hidden offer',
    promoBannerPhone: '',
  });
  assert.equal(validOff.ok, true);
  if (validOff.ok) {
    assert.equal(shouldShowPromoBanner(validOff), false);
  }
});

test('Running Rider Ad Banner action URL sanitizer, interval clamping, and target resolution work securely', () => {
  assert.equal(sanitizePromoBannerIntervalMinutes(undefined), 1);
  assert.equal(sanitizePromoBannerIntervalMinutes(0), 1);
  assert.equal(sanitizePromoBannerIntervalMinutes(3), 3);
  assert.equal(sanitizePromoBannerIntervalMinutes(120), 60);

  assert.equal(
    sanitizePromoBannerActionUrl('https://wa.me/919885138592?text=Hi'),
    'https://wa.me/919885138592?text=Hi'
  );
  assert.equal(
    sanitizePromoBannerActionUrl('wa.me/919885138592'),
    'https://wa.me/919885138592'
  );
  assert.equal(sanitizePromoBannerActionUrl('9876543210'), 'tel:+919876543210');
  assert.equal(sanitizePromoBannerActionUrl('javascript:alert(1)'), '');
  assert.equal(sanitizePromoBannerActionUrl('data:text/html,<h1>x</h1>'), '');

  const badUrlDraft = validatePromoBannerDraft({
    promoBannerEnabled: true,
    promoBannerText: 'Flash Sale!',
    promoBannerButtonText: 'Grab Deal',
    promoBannerActionUrl: 'javascript:alert(1)',
    promoBannerIntervalMinutes: 2,
  });
  assert.equal(badUrlDraft.ok, false);

  const okUrlDraft = validatePromoBannerDraft({
    promoBannerEnabled: true,
    promoBannerText: 'Flash Sale: ₹10 OFF!',
    promoBannerButtonText: 'WhatsApp Now',
    promoBannerActionUrl: 'https://wa.me/919876543210',
    promoBannerIntervalMinutes: 2,
  });
  assert.equal(okUrlDraft.ok, true);
  if (okUrlDraft.ok) {
    assert.equal(okUrlDraft.promoBannerButtonText, 'WhatsApp Now');
    assert.equal(okUrlDraft.promoBannerIntervalMinutes, 2);
    assert.deepEqual(resolvePromoActionTarget(okUrlDraft.promoBannerActionUrl), {
      kind: 'external',
      href: 'https://wa.me/919876543210',
    });
  }

  assert.deepEqual(resolvePromoActionTarget('', ''), {
    kind: 'scroll_catalog',
    href: '#customer-catalog',
  });
});

test('partitionCustomerOrders clearly separates multiple simultaneous active orders from past orders', () => {
  const mk = (id: string, status: Order['status'], createdAt: number): Order => ({
    id,
    customerName: 'Azeem',
    customerMobile: '9848012345',
    address: 'Flat 204, Tolichowki',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [
      {
        productId: 'bisleri_20l',
        name: 'Bisleri 20L',
        price: 70,
        quantity: 2,
        category: 'Water Cans',
      },
    ],
    totalAmount: 140,
    status,
    createdAt,
    updatedAt: createdAt,
  });

  const result = partitionCustomerOrders([
    mk('DD-PAST-1', 'delivered', 1000),
    mk('DD-ACT-1', 'pending', 2000),
    mk('DD-ACT-2', 'out_for_delivery', 3000),
    mk('DD-PAST-2', 'rejected', 1500),
    mk('DD-ACT-3', 'assigned', 4000),
  ]);

  assert.deepEqual(
    result.activeOrders.map((o) => o.id),
    ['DD-ACT-3', 'DD-ACT-2', 'DD-ACT-1']
  );
  assert.deepEqual(
    result.pastOrders.map((o) => o.id),
    ['DD-PAST-2', 'DD-PAST-1']
  );
});

