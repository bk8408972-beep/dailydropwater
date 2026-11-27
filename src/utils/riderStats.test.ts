import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RIDER_ACTIVE_ORDERS,
  canRiderAcceptAnotherOrder,
  computeRiderStats,
  countRiderAcceptedActiveOrders,
  getRiderCompletedOrders,
  partitionRiderActiveOrders,
} from './riderStats';
import type { Order } from '../types';

function makeOrder(overrides: Partial<Order>): Order {
  return {
    id: 'DD-100',
    customerName: 'Amina',
    customerMobile: '9848011111',
    address: 'Tolichowki',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [],
    totalAmount: 100,
    status: 'delivered',
    assignedRiderId: 'DD001',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    deliveredAt: 1_700_000_000_000,
    ...overrides,
  };
}

test('computeRiderStats counts Today Delivered, Total Delivered, and COD-only cash collected (strictly excluding UPI)', () => {
  const now = new Date('2026-04-15T14:00:00Z').getTime();
  const todayMorning = new Date('2026-04-15T09:00:00Z').getTime();
  const yesterday = new Date('2026-04-14T09:00:00Z').getTime();

  const orders: Order[] = [
    // Today COD delivered -> counts toward today, total, AND COD cash
    makeOrder({
      id: 'DD-1',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 110,
      status: 'delivered',
      deliveredAt: todayMorning,
    }),
    // Today UPI delivered -> counts toward today & total, NEVER toward COD cash
    makeOrder({
      id: 'DD-2',
      paymentMethod: 'UPI',
      upiUtr: '123456789012',
      upiVerified: true,
      totalAmount: 250,
      status: 'delivered',
      deliveredAt: todayMorning + 60_000,
    }),
    // Yesterday COD delivered -> counts toward total & COD cash, not today
    makeOrder({
      id: 'DD-3',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 90,
      status: 'delivered',
      deliveredAt: yesterday,
    }),
    // Active COD order -> counts toward assigned & active, NOT cash collected yet
    makeOrder({
      id: 'DD-4',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 150,
      status: 'out_for_delivery',
      deliveredAt: null,
    }),
    // Different rider -> ignored
    makeOrder({
      id: 'DD-5',
      assignedRiderId: 'DD002',
      paymentMethod: 'Cash on Delivery',
      totalAmount: 500,
      status: 'delivered',
      deliveredAt: todayMorning,
    }),
  ];

  const stats = computeRiderStats(orders, 'DD001', now);
  assert.equal(stats.assignedCount, 4);
  assert.equal(stats.activeCount, 1);
  assert.equal(stats.todayDeliveredCount, 2);
  assert.equal(stats.totalDeliveredCount, 3);
  assert.equal(stats.totalCodCashCollected, 200); // 110 + 90 ONLY (excludes 250 UPI and 150 active)
  assert.equal(stats.todayCodCashCollected, 110);
});

test('getRiderCompletedOrders returns only delivered orders for the specified rider sorted newest first', () => {
  const orders: Order[] = [
    makeOrder({ id: 'DD-OLD', deliveredAt: 1000, status: 'delivered' }),
    makeOrder({ id: 'DD-NEW', deliveredAt: 5000, status: 'delivered' }),
    makeOrder({ id: 'DD-ACT', deliveredAt: null, status: 'accepted' }),
    makeOrder({
      id: 'DD-OTHER',
      assignedRiderId: 'DD002',
      deliveredAt: 9000,
      status: 'delivered',
    }),
  ];

  const completed = getRiderCompletedOrders(orders, 'DD001');
  assert.deepEqual(
    completed.map((o) => o.id),
    ['DD-NEW', 'DD-OLD']
  );
});

test('canRiderAcceptAnotherOrder allows up to 5 simultaneous active orders and opens a slot when one is delivered', () => {
  assert.equal(MAX_RIDER_ACTIVE_ORDERS, 5);

  const fourAccepted: Order[] = [
    makeOrder({ id: 'DD-A1', status: 'accepted', deliveredAt: null }),
    makeOrder({ id: 'DD-A2', status: 'reached_pickup', deliveredAt: null }),
    makeOrder({ id: 'DD-A3', status: 'out_for_delivery', deliveredAt: null }),
    makeOrder({ id: 'DD-A4', status: 'accepted', deliveredAt: null }),
    // Incoming awaiting acceptance does NOT consume an accepted slot yet
    makeOrder({ id: 'DD-IN1', status: 'assigned', deliveredAt: null }),
    // Delivered order does NOT consume an active slot
    makeOrder({ id: 'DD-DONE', status: 'delivered' }),
  ];

  assert.equal(countRiderAcceptedActiveOrders(fourAccepted, 'DD001'), 4);
  const cap4 = canRiderAcceptAnotherOrder(fourAccepted, 'DD001');
  assert.equal(cap4.allowed, true);
  assert.equal(cap4.activeAcceptedCount, 4);
  assert.equal(cap4.remainingSlots, 1);

  // Accepting 5th order fills all 5 slots -> 6th order cannot be accepted until one finishes
  const fiveAccepted: Order[] = [
    ...fourAccepted.slice(0, 4),
    makeOrder({ id: 'DD-A5', status: 'accepted', deliveredAt: null }),
    makeOrder({ id: 'DD-IN6', status: 'assigned', deliveredAt: null }),
  ];
  const cap5 = canRiderAcceptAnotherOrder(fiveAccepted, 'DD001');
  assert.equal(cap5.allowed, false);
  assert.equal(cap5.activeAcceptedCount, 5);
  assert.equal(cap5.remainingSlots, 0);

  // Partition keeps incoming awaiting orders separate from accepted active deliveries
  const partitioned = partitionRiderActiveOrders(fiveAccepted, 'DD001');
  assert.deepEqual(
    partitioned.incomingOrders.map((o) => o.id),
    ['DD-IN6']
  );
  assert.equal(partitioned.acceptedActiveOrders.length, 5);
  assert.equal(partitioned.acceptedActiveOrders[0].id, 'DD-A3'); // out_for_delivery first
  assert.equal(partitioned.acceptedActiveOrders[1].id, 'DD-A2'); // reached_pickup second
});
