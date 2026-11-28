import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyOrderKey,
  computeNextDailyOrderCounter,
  formatOrderIdLabel,
  getIstDateString,
  getOrderDisplayNumber,
  isValidOrderLookupQuery,
  matchesOrderLookupQuery,
} from './orderSequence';

test('getIstDateString rolls over at exact 12:00 AM midnight IST (18:30 UTC)', () => {
  // 2026-11-28 23:59:59 IST === 2026-11-28 18:29:59 UTC
  const beforeMidnightIst = Date.UTC(2026, 10, 28, 18, 29, 59);
  assert.equal(getIstDateString(beforeMidnightIst), '2026-11-28');

  // 2026-11-29 00:00:00 IST === 2026-11-28 18:30:00 UTC
  const atMidnightIst = Date.UTC(2026, 10, 28, 18, 30, 0);
  assert.equal(getIstDateString(atMidnightIst), '2026-11-29');
});

test('computeNextDailyOrderCounter increments sequentially up to 500+ on same IST day and resets to 1 at midnight IST', () => {
  const day1Morning = Date.UTC(2026, 10, 28, 4, 0, 0); // 09:30 AM IST on 2026-11-28
  const first = computeNextDailyOrderCounter(null, day1Morning);
  assert.equal(first.date, '2026-11-28');
  assert.equal(first.count, 1);

  const second = computeNextDailyOrderCounter(first, day1Morning + 60_000);
  assert.equal(second.date, '2026-11-28');
  assert.equal(second.count, 2);

  // Supports 500 and beyond on high-volume days
  const after500 = computeNextDailyOrderCounter(
    { date: '2026-11-28', count: 500, updatedAt: day1Morning },
    Date.UTC(2026, 10, 28, 18, 29, 59)
  );
  assert.equal(after500.date, '2026-11-28');
  assert.equal(after500.count, 501);

  // Resets automatically to 1 at 12:00 AM midnight IST next day
  const day2Midnight = Date.UTC(2026, 10, 28, 18, 30, 0);
  const resetFirst = computeNextDailyOrderCounter(after500, day2Midnight);
  assert.equal(resetFirst.date, '2026-11-29');
  assert.equal(resetFirst.count, 1);
});

test('formatOrderIdLabel displays plain numbers without any T or # prefix and buildDailyOrderKey stays collision-free across days', () => {
  const keyDay1 = buildDailyOrderKey('2026-11-28', 1);
  const keyDay2 = buildDailyOrderKey('2026-11-29', 1);
  assert.notEqual(keyDay1, keyDay2);
  assert.equal(keyDay1, 'DD-20261128-1');
  assert.equal(keyDay2, 'DD-20261129-1');

  assert.equal(getOrderDisplayNumber({ id: keyDay1, orderNumber: 1 }), '1');
  assert.equal(formatOrderIdLabel({ id: keyDay1, orderNumber: 1 }), 'Order ID: 1');
  assert.equal(formatOrderIdLabel({ id: 'DD-20261128-502', orderNumber: 502 }), 'Order ID: 502');
  assert.equal(formatOrderIdLabel({ id: 'DD-20261128-7' }), 'Order ID: 7');
  assert.equal(formatOrderIdLabel({ id: 'DD-99123456' }), 'Order ID: DD-99123456');
});

test('lookup helpers match 10-digit mobile, plain daily order numbers, and Order ID labels cleanly', () => {
  const order = {
    id: 'DD-20261128-3',
    orderNumber: 3,
    customerMobile: '9000012345',
  };

  assert.equal(isValidOrderLookupQuery('3'), true);
  assert.equal(isValidOrderLookupQuery('Order ID: 3'), true);
  assert.equal(isValidOrderLookupQuery('9000012345'), true);
  assert.equal(isValidOrderLookupQuery(''), false);

  assert.equal(matchesOrderLookupQuery(order, '3'), true);
  assert.equal(matchesOrderLookupQuery(order, 'Order ID: 3'), true);
  assert.equal(matchesOrderLookupQuery(order, '#3'), true);
  assert.equal(matchesOrderLookupQuery(order, '9000012345'), true);
  assert.equal(matchesOrderLookupQuery(order, 'DD-20261128-3'), true);
  assert.equal(matchesOrderLookupQuery(order, '4'), false);
});
