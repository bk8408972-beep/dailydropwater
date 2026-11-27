import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeExternalUrl,
  isValidUpiIdFormat,
  sanitizeAddressInput,
  sanitizePhone10,
  sanitizeTextInput,
  sanitizeUpiId,
  validateAndBuildCanonicalOrder,
  validateOrderWritePayload,
} from './security';
import { DEFAULT_STORE_SETTINGS } from './storeSettings';
import type { Product } from '../types';

const SAMPLE_CATALOG: Product[] = [
  {
    id: 'local_20l',
    name: 'Local Water Can (20L)',
    category: 'Water Cans',
    price: 30,
    stock: 20,
    inStock: true,
  },
  {
    id: 'bisleri_20l',
    name: 'Bisleri Water Can (20L)',
    category: 'Water Cans',
    price: 90,
    stock: 0,
    inStock: false,
  },
];

test('sanitizeTextInput strips HTML tags, control chars, and clamps length', () => {
  assert.equal(
    sanitizeTextInput('  <script>alert(1)</script>   Azeem\u0000 Khan  ', 40),
    'scriptalert(1)/script Azeem Khan'
  );
  assert.equal(sanitizeTextInput('abcdefghij', 5), 'abcde');
});

test('sanitizeAddressInput removes angle brackets and control bytes cleanly', () => {
  assert.equal(
    sanitizeAddressInput('Flat <b>204</b>, Main Road\u0007', 100),
    'Flat b204/b, Main Road'
  );
});

test('sanitizePhone10 normalizes +91 and leading 0 formats to 10 digits', () => {
  assert.equal(sanitizePhone10('+91 98480-12345'), '9848012345');
  assert.equal(sanitizePhone10('09848012345'), '9848012345');
  assert.equal(sanitizePhone10('9848012345999'), '9848012345');
});

test('sanitizeUpiId and isValidUpiIdFormat enforce valid VPA syntax', () => {
  assert.equal(sanitizeUpiId('  daily.drop@ybl<script> '), 'daily.drop@yblscript');
  assert.equal(isValidUpiIdFormat('dailydrop@ybl'), true);
  assert.equal(isValidUpiIdFormat('not-a-upi-id'), false);
});

test('isSafeExternalUrl allows https/tel/upi and rejects javascript/data/intent schemes', () => {
  assert.equal(isSafeExternalUrl('https://maps.google.com/?q=17.39,78.41'), true);
  assert.equal(isSafeExternalUrl('tel:9885138592'), true);
  assert.equal(isSafeExternalUrl('upi://pay?pa=store@ybl&am=60&cu=INR'), true);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeExternalUrl('intent://maps.google.com'), false);
});

test('validateAndBuildCanonicalOrder recalculates totals authoritatively and rejects tampered totals', () => {
  const settings = {
    ...DEFAULT_STORE_SETTINGS,
    isOpen: true,
    platformFee: 5,
    deliveryFee: 10,
    floor2Charge: 10,
    radiusEnabled: true,
    deliveryRadiusKm: 3,
    storeLat: 17.3984,
    storeLng: 78.4136,
    minOrderAmount: 0,
  };

  // Tampered expectedClientTotal (trying to pay ₹1 instead of ₹85) is rejected
  const tampered = validateAndBuildCanonicalOrder({
    cart: { local_20l: 2 },
    catalog: SAMPLE_CATALOG,
    storeSettings: settings,
    customerName: '<b>Imran</b>',
    customerMobile: '+91 9848012345',
    address: 'Flat 202, Lake View Apartments',
    customerLocation: { lat: 17.3985, lng: 78.4137 },
    floorLevel: 'floor_2',
    hasLift: false,
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    expectedClientTotal: 1,
  });
  assert.equal(tampered.ok, false);

  // Valid order builds sanitized canonical totals (2 * 30 = 60 + 5 + 10 + 10 = 85)
  const valid = validateAndBuildCanonicalOrder({
    cart: { local_20l: 2 },
    catalog: SAMPLE_CATALOG,
    storeSettings: settings,
    customerName: '<b>Imran</b>',
    customerMobile: '+91 9848012345',
    address: 'Flat 202, Lake View Apartments',
    customerLocation: { lat: 17.3985, lng: 78.4137 },
    floorLevel: 'floor_2',
    hasLift: false,
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    expectedClientTotal: 85,
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(valid.order.customerName, 'bImran/b');
    assert.equal(valid.order.customerMobile, '9848012345');
    assert.equal(valid.order.itemsSubtotal, 60);
    assert.equal(valid.order.platformFee, 5);
    assert.equal(valid.order.deliveryFee, 10);
    assert.equal(valid.order.floorCharge, 10);
    assert.equal(valid.order.totalAmount, 85);
    assert.equal(validateOrderWritePayload(valid.order), null);
  }
});

test('validateAndBuildCanonicalOrder strictly enforces 12-digit UTR on UPI orders and rejects out-of-stock items', () => {
  const upiSettings = {
    ...DEFAULT_STORE_SETTINGS,
    isOpen: true,
    upiEnabled: true,
    codEnabled: true,
    upiId: 'dailydrop@ybl',
    radiusEnabled: false,
    minOrderAmount: 0,
  };

  const badUtr = validateAndBuildCanonicalOrder({
    cart: { local_20l: 1 },
    catalog: SAMPLE_CATALOG,
    storeSettings: upiSettings,
    customerName: 'Sameer',
    customerMobile: '9848012345',
    address: 'House 12, Green Park Road',
    customerLocation: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'fast',
    paymentMethod: 'UPI',
    upiUtr: '12345',
  });
  assert.equal(badUtr.ok, false);

  const outOfStock = validateAndBuildCanonicalOrder({
    cart: { bisleri_20l: 1 },
    catalog: SAMPLE_CATALOG,
    storeSettings: upiSettings,
    customerName: 'Sameer',
    customerMobile: '9848012345',
    address: 'House 12, Green Park Road',
    customerLocation: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'fast',
    paymentMethod: 'UPI',
    upiUtr: '123456789012',
  });
  assert.equal(outOfStock.ok, false);

  const goodUpi = validateAndBuildCanonicalOrder({
    cart: { local_20l: 1 },
    catalog: SAMPLE_CATALOG,
    storeSettings: upiSettings,
    customerName: 'Sameer',
    customerMobile: '9848012345',
    address: 'House 12, Green Park Road',
    customerLocation: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'fast',
    paymentMethod: 'UPI',
    upiUtr: '412345678901',
  });
  assert.equal(goodUpi.ok, true);
  if (goodUpi.ok) {
    assert.equal(goodUpi.order.upiUtr, '412345678901');
    assert.equal(goodUpi.order.upiVerified, false);
    assert.equal(validateOrderWritePayload(goodUpi.order), null);
  }
});

test('validateOrderWritePayload catches tampered totalAmount mismatch', () => {
  const valid = validateAndBuildCanonicalOrder({
    cart: { local_20l: 2 },
    catalog: SAMPLE_CATALOG,
    storeSettings: { ...DEFAULT_STORE_SETTINGS, radiusEnabled: false, minOrderAmount: 0 },
    customerName: 'Azeem',
    customerMobile: '9848012345',
    address: 'Flat 101, Sunrise Residency',
    customerLocation: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) {
    const forged = { ...valid.order, totalAmount: 10 };
    assert.ok(validateOrderWritePayload(forged));
  }
});

test('validateAndBuildCanonicalOrder enforces Owner Minimum Order Amount with exact guidance message', () => {
  const belowMin = validateAndBuildCanonicalOrder({
    cart: { local_20l: 2 }, // ₹60 < ₹100 default
    catalog: SAMPLE_CATALOG,
    storeSettings: { ...DEFAULT_STORE_SETTINGS, radiusEnabled: false, minOrderAmount: 100 },
    customerName: 'Azeem',
    customerMobile: '9848012345',
    address: 'Flat 101, Sunrise Residency',
    customerLocation: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
  });
  assert.equal(belowMin.ok, false);
  if (!belowMin.ok) {
    assert.equal(
      belowMin.error,
      'Minimum order ₹100 ka hona zaroori hai — ₹40 ka item aur add karein'
    );
  }
});
