import test from 'node:test';
import assert from 'node:assert/strict';
import type { Order } from '../types';
import {
  computeNextOrderNumber,
  formatDisplayOrderId,
  formatSequentialOrderId,
  getOrderFirebaseKey,
  isValidCustomerTrackQuery,
  isValidOrderId,
  matchesCustomerOrderSearch,
  normalizeOrdersCollection,
  parseLastOrderNumber,
  parseSequentialOrderNumber,
  runAtomicCounterIncrement,
} from './orderId';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: '#1',
    orderNumber: 1,
    customerName: 'Aarav Sharma',
    customerMobile: '9876543210',
    address: 'Flat 302, Green Park Residency',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [
      {
        productId: 'bisleri_20l',
        name: 'Bisleri 20L Water Can',
        price: 70,
        quantity: 1,
        category: 'Water Cans',
      },
    ],
    totalAmount: 70,
    status: 'pending',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

test('parseLastOrderNumber and computeNextOrderNumber start cleanly at 1 and scale past 10000 without limit', () => {
  assert.equal(parseLastOrderNumber(null), 0);
  assert.equal(parseLastOrderNumber(undefined), 0);
  assert.equal(parseLastOrderNumber(0), 0);
  assert.equal(parseLastOrderNumber(-5), 0);
  assert.equal(parseLastOrderNumber('invalid'), 0);

  assert.equal(computeNextOrderNumber(null), 1);
  assert.equal(computeNextOrderNumber(0), 1);
  assert.equal(computeNextOrderNumber(1), 2);
  assert.equal(computeNextOrderNumber(2), 3);
  assert.equal(computeNextOrderNumber(999), 1000);
  assert.equal(computeNextOrderNumber(9999), 10000);
  assert.equal(computeNextOrderNumber(100000), 100001);
});

test('formatSequentialOrderId and isValidOrderId support #1, #2, #1000, #10000+ and legacy DD- IDs', () => {
  assert.equal(formatSequentialOrderId(1), '#1');
  assert.equal(formatSequentialOrderId(2), '#2');
  assert.equal(formatSequentialOrderId(1000), '#1000');
  assert.equal(formatSequentialOrderId(10000), '#10000');
  assert.equal(formatSequentialOrderId(999999), '#999999');

  assert.equal(isValidOrderId('#1'), true);
  assert.equal(isValidOrderId('#2'), true);
  assert.equal(isValidOrderId('#1000'), true);
  assert.equal(isValidOrderId('#10000'), true);
  assert.equal(isValidOrderId('DD-500739386'), true);

  assert.equal(isValidOrderId('#0'), false);
  assert.equal(isValidOrderId('#-1'), false);
  assert.equal(isValidOrderId(''), false);
  assert.equal(isValidOrderId('bad-id'), false);
});

test('getOrderFirebaseKey avoids RTDB integer array coercion and illegal # while preserving legacy keys', () => {
  assert.equal(getOrderFirebaseKey('#1'), 'order_1');
  assert.equal(getOrderFirebaseKey('1'), 'order_1');
  assert.equal(getOrderFirebaseKey('order_42'), 'order_42');
  assert.equal(getOrderFirebaseKey('#10000'), 'order_10000');
  assert.equal(getOrderFirebaseKey('DD-500739386'), 'DD-500739386');

  assert.equal(parseSequentialOrderNumber('#1'), 1);
  assert.equal(parseSequentialOrderNumber('order_1000'), 1000);
  assert.equal(parseSequentialOrderNumber('DD-500739386'), null);

  assert.equal(formatDisplayOrderId(makeOrder({ id: 'order_7', orderNumber: 7 })), '#7');
  assert.equal(formatDisplayOrderId('order_12'), '#12');
  assert.equal(formatDisplayOrderId('DD-500739386'), 'DD-500739386');
});

test('normalizeOrdersCollection safely handles Firebase objects and sparse arrays without crashing', () => {
  const fromObject = normalizeOrdersCollection({
    order_1: makeOrder({ id: '#1', orderNumber: 1, createdAt: 100 }),
    order_2: makeOrder({ id: '#2', orderNumber: 2, createdAt: 200 }),
    'DD-500739386': makeOrder({ id: 'DD-500739386', orderNumber: undefined, createdAt: 50 }),
  });
  assert.deepEqual(
    fromObject.map((o) => o.id),
    ['#2', '#1', 'DD-500739386']
  );

  // Sparse array simulation if numeric keys ever existed
  const fromSparseArray = normalizeOrdersCollection([
    null,
    makeOrder({ id: '#1', orderNumber: 1, createdAt: 100 }),
    null,
    makeOrder({ id: '#3', orderNumber: 3, createdAt: 300 }),
  ]);
  assert.deepEqual(
    fromSparseArray.map((o) => o.id),
    ['#3', '#1']
  );
});

test('matchesCustomerOrderSearch and isValidCustomerTrackQuery support #1, 1, Order #12, mobile, and legacy DD-', () => {
  const o1 = makeOrder({ id: '#1', orderNumber: 1, customerMobile: '9876543210' });
  const o12 = makeOrder({ id: '#12', orderNumber: 12, customerMobile: '9000011111' });
  const legacy = makeOrder({ id: 'DD-500739386', orderNumber: undefined, customerMobile: '9111122222' });

  assert.equal(isValidCustomerTrackQuery('#1'), true);
  assert.equal(isValidCustomerTrackQuery('1'), true);
  assert.equal(isValidCustomerTrackQuery('#10000'), true);
  assert.equal(isValidCustomerTrackQuery('9876543210'), true);
  assert.equal(isValidCustomerTrackQuery('DD-5007'), true);

  assert.equal(matchesCustomerOrderSearch(o1, '#1'), true);
  assert.equal(matchesCustomerOrderSearch(o1, '1'), true);
  assert.equal(matchesCustomerOrderSearch(o1, 'Order #1'), true);
  assert.equal(matchesCustomerOrderSearch(o12, '#1'), false); // #1 should NOT match #12!
  assert.equal(matchesCustomerOrderSearch(o12, '#12'), true);
  assert.equal(matchesCustomerOrderSearch(o1, '9876543210'), true);
  assert.equal(matchesCustomerOrderSearch(legacy, 'DD-5007'), true);
});

test('runAtomicCounterIncrement guarantees strict sequential ordering across concurrent 412 CAS retries', async () => {
  let serverValue: number | null = null;
  let serverEtag = 'etag_0';

  const makeAdapter = (simulateOneConflict: boolean) => {
    let conflictedOnce = false;
    return {
      readWithEtag: async () => ({ value: serverValue, etag: serverEtag }),
      writeIfMatch: async (nextValue: number, etag: string | null) => {
        if (simulateOneConflict && !conflictedOnce) {
          conflictedOnce = true;
          // Simulate another concurrent order committing first
          serverValue = (serverValue ?? 0) + 1;
          serverEtag = `etag_${serverValue}`;
          return {
            ok: false,
            conflict: true,
            latestValue: serverValue,
            latestEtag: serverEtag,
            status: 412,
          };
        }
        if (etag !== serverEtag) {
          return {
            ok: false,
            conflict: true,
            latestValue: serverValue,
            latestEtag: serverEtag,
            status: 412,
          };
        }
        serverValue = nextValue;
        serverEtag = `etag_${serverValue}`;
        return { ok: true, conflict: false, status: 200 };
      },
    };
  };

  // First order starts cleanly at 1
  const first = await runAtomicCounterIncrement(makeAdapter(false));
  assert.equal(first, 1);

  // Second order hits a concurrent 412 conflict (server advances to 2), retries and commits 3
  const afterConflict = await runAtomicCounterIncrement(makeAdapter(true));
  assert.equal(afterConflict, 3);
  assert.equal(serverValue, 3);

  // Next order gets 4
  const next = await runAtomicCounterIncrement(makeAdapter(false));
  assert.equal(next, 4);
});
