import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpiPaymentUri,
  getAvailablePaymentOptions,
  getOrderPaymentBadge,
  isCodOrder,
  isUpiOrder,
  isValidUtr,
  sanitizeUtrInput,
} from './payment';
import { DEFAULT_STORE_SETTINGS } from './storeSettings';
import type { Order } from '../types';

test('getAvailablePaymentOptions handles all 4 Owner UPI/COD switch combinations accurately', () => {
  // Default: UPI OFF, COD ON -> COD only
  assert.deepEqual(getAvailablePaymentOptions(DEFAULT_STORE_SETTINGS), {
    upiEnabled: false,
    codEnabled: true,
    availableMethods: ['Cash on Delivery'],
    checkoutDisabled: false,
    defaultMethod: 'Cash on Delivery',
  });

  // Both ON -> UPI and COD
  assert.deepEqual(
    getAvailablePaymentOptions({
      upiEnabled: true,
      codEnabled: true,
    }),
    {
      upiEnabled: true,
      codEnabled: true,
      availableMethods: ['Cash on Delivery', 'UPI'],
      checkoutDisabled: false,
      defaultMethod: 'Cash on Delivery',
    }
  );

  // UPI ON, COD OFF -> UPI only
  assert.deepEqual(
    getAvailablePaymentOptions({
      upiEnabled: true,
      codEnabled: false,
    }),
    {
      upiEnabled: true,
      codEnabled: false,
      availableMethods: ['UPI'],
      checkoutDisabled: false,
      defaultMethod: 'UPI',
    }
  );

  // Both OFF -> Disable checkout
  assert.deepEqual(
    getAvailablePaymentOptions({
      upiEnabled: false,
      codEnabled: false,
    }),
    {
      upiEnabled: false,
      codEnabled: false,
      availableMethods: [],
      checkoutDisabled: true,
      defaultMethod: null,
    }
  );
});

test('buildUpiPaymentUri generates exact upi://pay deep link with encoded params', () => {
  const uri = buildUpiPaymentUri('dailydrop@okaxis', 'DailyDrop Water', 110);
  assert.equal(
    uri,
    'upi://pay?pa=dailydrop%40okaxis&pn=DailyDrop%20Water&am=110&cu=INR'
  );
  const decimalUri = buildUpiPaymentUri('dailydrop@okaxis', 'DailyDrop Water', 110.5);
  assert.equal(
    decimalUri,
    'upi://pay?pa=dailydrop%40okaxis&pn=DailyDrop%20Water&am=110.50&cu=INR'
  );
  assert.equal(buildUpiPaymentUri('', 'DailyDrop Water', 110), '');
});

test('sanitizeUtrInput and isValidUtr enforce exact 12-digit numeric UTRs', () => {
  assert.equal(sanitizeUtrInput('1234-5678 901299'), '123456789012');
  assert.equal(isValidUtr('123456789012'), true);
  assert.equal(isValidUtr('12345678901'), false);
  assert.equal(isValidUtr('1234567890123'), false);
  assert.equal(isValidUtr('12345678901a'), false);
});

test('getOrderPaymentBadge renders COD, UPI PAYMENT PENDING, and UPI PAID • UTR accurately', () => {
  const baseOrder: Pick<Order, 'paymentMethod' | 'upiUtr' | 'upiVerified'> = {
    paymentMethod: 'Cash on Delivery',
    upiUtr: null,
    upiVerified: false,
  };

  assert.equal(isCodOrder(baseOrder), true);
  assert.equal(isUpiOrder(baseOrder), false);
  assert.deepEqual(getOrderPaymentBadge(baseOrder), {
    kind: 'cod',
    label: 'Cash on Delivery (COD)',
    shortLabel: 'COD Cash',
  });

  const pendingUpi: Pick<Order, 'paymentMethod' | 'upiUtr' | 'upiVerified'> = {
    paymentMethod: 'UPI',
    upiUtr: '123456789012',
    upiVerified: false,
  };
  assert.equal(isUpiOrder(pendingUpi), true);
  assert.equal(isCodOrder(pendingUpi), false);
  assert.deepEqual(getOrderPaymentBadge(pendingUpi), {
    kind: 'upi_pending',
    label: 'UPI PAYMENT PENDING',
    shortLabel: 'UPI PENDING',
    utr: '123456789012',
  });

  const verifiedUpi: Pick<Order, 'paymentMethod' | 'upiUtr' | 'upiVerified'> = {
    paymentMethod: 'UPI',
    upiUtr: '123456789012',
    upiVerified: true,
  };
  assert.deepEqual(getOrderPaymentBadge(verifiedUpi), {
    kind: 'upi_paid',
    label: 'UPI PAID • UTR 123456789012',
    shortLabel: 'UPI PAID',
    utr: '123456789012',
  });
});
