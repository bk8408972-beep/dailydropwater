import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWeeklyArchiveRecord,
  selectOrdersEligibleForAutoArchive,
  SEVEN_DAYS_MS,
} from './weeklyArchive';
import type { Order } from '../types';

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'DD-1',
    customerName: 'Secret Customer Name',
    customerMobile: '9848099999',
    address: 'Flat 99, Private Road, Tolichowki',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [],
    totalAmount: 120,
    status: 'delivered',
    assignedRiderId: 'DD001',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deliveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

test('selectOrdersEligibleForAutoArchive selects ONLY completed orders >= 7 days old and NEVER touches active orders', () => {
  const now = 1_710_000_000_000;
  const eightDaysAgo = now - SEVEN_DAYS_MS - 86_400_000;
  const threeDaysAgo = now - 3 * 86_400_000;

  const orders: Order[] = [
    makeOrder({ id: 'DD-OLD-DELIVERED', status: 'delivered', deliveredAt: eightDaysAgo }),
    makeOrder({ id: 'DD-OLD-REJECTED', status: 'rejected', updatedAt: eightDaysAgo, deliveredAt: null }),
    makeOrder({ id: 'DD-RECENT-DELIVERED', status: 'delivered', deliveredAt: threeDaysAgo }),
    // Even if an active/pending order is 10 days old, it must NEVER be auto-deleted
    makeOrder({ id: 'DD-OLD-PENDING', status: 'pending', createdAt: eightDaysAgo, updatedAt: eightDaysAgo, deliveredAt: null }),
    makeOrder({ id: 'DD-OLD-ACTIVE', status: 'out_for_delivery', createdAt: eightDaysAgo, updatedAt: eightDaysAgo, deliveredAt: null }),
  ];

  const eligible = selectOrdersEligibleForAutoArchive(orders, now);
  assert.deepEqual(
    eligible.map((o) => o.id),
    ['DD-OLD-DELIVERED', 'DD-OLD-REJECTED']
  );
});

test('buildWeeklyArchiveRecord preserves financial & UTR summary without any customer PII', () => {
  const now = 1_710_000_000_000;
  const orders: Order[] = [
    makeOrder({
      id: 'DD-COD-1',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 110,
      status: 'delivered',
    }),
    makeOrder({
      id: 'DD-UPI-1',
      paymentMethod: 'UPI',
      upiUtr: '123456789012',
      upiVerified: true,
      totalAmount: 200,
      status: 'delivered',
    }),
    makeOrder({
      id: 'DD-REJ-1',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 90,
      status: 'rejected',
      deliveredAt: null,
    }),
  ];

  const record = buildWeeklyArchiveRecord(orders, 'auto_7_day', now);
  assert.equal(record.orderCount, 3);
  assert.equal(record.deliveredCount, 2);
  assert.equal(record.codRevenue, 110);
  assert.equal(record.upiRevenue, 200);
  assert.equal(record.totalRevenue, 310);
  assert.equal(record.transactions.length, 3);

  // Confirm ZERO customer PII (name, phone, address) is serialized in financial archive backup
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes('Secret Customer Name'), false);
  assert.equal(serialized.includes('9848099999'), false);
  assert.equal(serialized.includes('Private Road'), false);
  assert.equal(serialized.includes('123456789012'), true);
});
