import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFloorCharge,
  calculateOrderBillBreakdown,
  DEFAULT_STORE_SETTINGS,
  formatFloorLiftSummary,
  normalizeStoreSettings,
  pickBestOnlineRiderForAutoAssign,
} from './storeSettings';
import type { Order, RiderRecord } from '../types';

test('normalizeStoreSettings applies safe defaults and clamps invalid fees', () => {
  assert.deepEqual(normalizeStoreSettings(null), DEFAULT_STORE_SETTINGS);
  assert.deepEqual(normalizeStoreSettings(undefined), DEFAULT_STORE_SETTINGS);

  const parsed = normalizeStoreSettings({
    isOpen: false,
    autoAssign: false,
    platformFee: 7,
    deliveryFee: 15,
    floor2Charge: -5,
    floor3PlusCharge: 25,
    radiusEnabled: false,
    deliveryRadiusKm: 5,
    storeLat: 17.4123456,
    storeLng: 78.4567891,
    upiEnabled: true,
    codEnabled: false,
    upiId: '  dailydrop@okaxis  ',
    upiName: '  DailyDrop Tolichowki  ',
  });

  assert.equal(parsed.isOpen, false);
  assert.equal(parsed.autoAssign, false);
  assert.equal(parsed.platformFee, 7);
  assert.equal(parsed.deliveryFee, 15);
  assert.equal(parsed.floor2Charge, 10); // negative falls back to default 10
  assert.equal(parsed.floor3PlusCharge, 25);
  assert.equal(parsed.radiusEnabled, false);
  assert.equal(parsed.deliveryRadiusKm, 5);
  assert.equal(parsed.storeLat, 17.412346);
  assert.equal(parsed.storeLng, 78.456789);
  assert.equal(parsed.upiEnabled, true);
  assert.equal(parsed.codEnabled, false);
  assert.equal(parsed.upiId, 'dailydrop@okaxis');
  assert.equal(parsed.upiName, 'DailyDrop Tolichowki');

  // Invalid radius / coordinates / empty UPI name fall back safely
  const clamped = normalizeStoreSettings({
    deliveryRadiusKm: -2,
    storeLat: 999,
    storeLng: -999,
    upiName: '   ',
  });
  assert.equal(clamped.radiusEnabled, true);
  assert.equal(clamped.deliveryRadiusKm, 3);
  assert.equal(clamped.storeLat, 17.3984);
  assert.equal(clamped.storeLng, 78.4136);
  assert.equal(clamped.upiEnabled, false);
  assert.equal(clamped.codEnabled, true);
  assert.equal(clamped.upiName, 'DailyDrop Water');
});

test('calculateFloorCharge enforces Ground/1st and Lift free policy, charging only without lift on 2nd and 3rd+ floors', () => {
  const settings = { floor2Charge: 10, floor3PlusCharge: 20 };

  assert.equal(calculateFloorCharge('ground_1st', false, settings), 0);
  assert.equal(calculateFloorCharge('ground_1st', true, settings), 0);
  assert.equal(calculateFloorCharge('floor_2', true, settings), 0);
  assert.equal(calculateFloorCharge('floor_3_plus', true, settings), 0);

  assert.equal(calculateFloorCharge('floor_2', false, settings), 10);
  assert.equal(calculateFloorCharge('floor_3_plus', false, settings), 20);

  // Custom owner-configured floor charges
  assert.equal(
    calculateFloorCharge('floor_2', false, { floor2Charge: 15, floor3PlusCharge: 30 }),
    15
  );
  assert.equal(
    calculateFloorCharge('floor_3_plus', false, { floor2Charge: 15, floor3PlusCharge: 30 }),
    30
  );
});

test('calculateOrderBillBreakdown computes items + platformFee + deliveryFee + floorCharge accurately', () => {
  const billNoLift3rd = calculateOrderBillBreakdown(180, 'floor_3_plus', false, {
    platformFee: 7,
    deliveryFee: 15,
    floor2Charge: 10,
    floor3PlusCharge: 20,
  });
  assert.deepEqual(billNoLift3rd, {
    itemsSubtotal: 180,
    platformFee: 7,
    deliveryFee: 15,
    floorCharge: 20,
    totalAmount: 222,
  });

  const billWithLift3rd = calculateOrderBillBreakdown(180, 'floor_3_plus', true, {
    platformFee: 5,
    deliveryFee: 10,
    floor2Charge: 10,
    floor3PlusCharge: 20,
  });
  assert.deepEqual(billWithLift3rd, {
    itemsSubtotal: 180,
    platformFee: 5,
    deliveryFee: 10,
    floorCharge: 0,
    totalAmount: 195,
  });
});

test('formatFloorLiftSummary formats floor and lift status cleanly for Order cards', () => {
  assert.equal(
    formatFloorLiftSummary({ floorLevel: 'floor_3_plus', hasLift: false, floorCharge: 20 }),
    '3rd Floor & Above · No Lift (+₹20)'
  );
  assert.equal(
    formatFloorLiftSummary({ floorLevel: 'floor_2', hasLift: true, floorCharge: 0 }),
    '2nd Floor · Lift: Yes'
  );
  assert.equal(formatFloorLiftSummary({}), null);
});

test('pickBestOnlineRiderForAutoAssign picks Duty-ON rider with fewest active orders and ignores offline/blocked riders', () => {
  const riders: RiderRecord[] = [
    {
      id: 'DD001',
      name: 'Imran',
      mobile: '9848000001',
      password: 'p',
      isActive: true,
      isOnline: true,
      createdAt: 1,
    },
    {
      id: 'DD002',
      name: 'Salman',
      mobile: '9848000002',
      password: 'p',
      isActive: true,
      isOnline: true,
      createdAt: 2,
    },
    {
      id: 'DD003',
      name: 'Offline Rider',
      mobile: '9848000003',
      password: 'p',
      isActive: true,
      isOnline: false,
      createdAt: 3,
    },
    {
      id: 'DD004',
      name: 'Blocked Rider',
      mobile: '9848000004',
      password: 'p',
      isActive: false,
      isOnline: true,
      createdAt: 4,
    },
  ];

  const baseOrder: Order = {
    id: 'DD-1',
    customerName: 'Cust',
    customerMobile: '9000000001',
    address: 'Tolichowki',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [],
    totalAmount: 90,
    status: 'out_for_delivery',
    assignedRiderId: 'DD001',
    createdAt: 1,
    updatedAt: 1,
  };

  // DD001 has 1 active order, DD002 has 0 -> picks DD002
  const picked1 = pickBestOnlineRiderForAutoAssign(riders, [baseOrder]);
  assert.equal(picked1?.id, 'DD002');

  // Delivered orders do NOT count as active workload -> DD001 has 0 active, DD002 has 0 active -> tie-break DD001
  const picked2 = pickBestOnlineRiderForAutoAssign(riders, [
    { ...baseOrder, status: 'delivered' },
  ]);
  assert.equal(picked2?.id, 'DD001');

  // Zero online active riders -> returns null
  const pickedNone = pickBestOnlineRiderForAutoAssign(
    riders.map((r) => ({ ...r, isOnline: false })),
    []
  );
  assert.equal(pickedNone, null);
});
