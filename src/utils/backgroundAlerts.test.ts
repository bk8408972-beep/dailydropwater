import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEAVY_NOTIFICATION_VIBRATE,
  buildOrderNotificationPayload,
  createSilentWavDataUrl,
  detectNewlyArrivedRiderOrders,
  getMediaSessionTitle,
  isBackgroundKeepAliveActive,
  stopDutyBackgroundKeepAlive,
} from './backgroundAlerts';

test('buildOrderNotificationPayload builds high-priority Rider notification with tag, renotify, requireInteraction, and heavy vibration', () => {
  const payload = buildOrderNotificationPayload(
    {
      id: 'DD-2026-101',
      customerName: 'Aarav Sharma',
      address: 'Flat 302, Jubilee Enclave, Hyderabad',
      totalAmount: 140,
      status: 'assigned',
    },
    'rider'
  );

  assert.match(payload.title, /DD-2026-101/);
  assert.equal(payload.options.tag, 'new-order-DD-2026-101');
  assert.equal(payload.options.renotify, true);
  assert.equal(payload.options.requireInteraction, true);
  assert.equal(payload.options.silent, false);
  assert.deepEqual(payload.options.vibrate, [1000, 300, 1000, 300, 1000, 300, 1000]);
  assert.deepEqual(payload.options.vibrate, HEAVY_NOTIFICATION_VIBRATE);
  assert.equal(payload.options.data.role, 'rider');
  assert.equal(payload.options.data.orderId, 'DD-2026-101');
  assert.match(payload.options.data.url, /^\/\?app=rider/);
});

test('buildOrderNotificationPayload builds Owner notification for new placed orders and timed-out unassigned orders', () => {
  const placed = buildOrderNotificationPayload(
    {
      id: 'DD-2026-202',
      customerName: 'Priya Nair',
      address: 'Road 4, Banjara Hills',
      totalAmount: 210,
      status: 'placed',
    },
    'owner'
  );

  assert.match(placed.title, /New DailyDrop Order — DD-2026-202/);
  assert.equal(placed.options.tag, 'new-order-DD-2026-202');
  assert.equal(placed.options.renotify, true);
  assert.equal(placed.options.requireInteraction, true);
  assert.equal(placed.options.data.role, 'owner');
  assert.match(placed.options.data.url, /^\/\?app=owner/);

  const unassigned = buildOrderNotificationPayload(
    {
      id: 'DD-2026-203',
      customerName: 'Kiran Rao',
      address: 'Block B, Madhapur',
      totalAmount: 95,
      status: 'unassigned',
    },
    'owner'
  );

  assert.match(unassigned.title, /Timed Out/);
  assert.equal(unassigned.options.tag, 'new-order-DD-2026-203');
});

test('createSilentWavDataUrl outputs a valid RIFF/WAVE silent 8-bit PCM audio data URL', () => {
  const url = createSilentWavDataUrl(1);
  assert.ok(url.startsWith('data:audio/wav;base64,'));

  const base64 = url.slice('data:audio/wav;base64,'.length);
  const buf = Buffer.from(base64, 'base64');

  assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(buf.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'fmt ');
  assert.equal(buf.subarray(36, 40).toString('ascii'), 'data');
  // 8000 samples at 8000 Hz mono 8-bit PCM = 8000 bytes + 44 header bytes
  assert.equal(buf.length, 8044);
  // First and last PCM samples are exact 8-bit digital silence (0x80)
  assert.equal(buf[44], 0x80);
  assert.equal(buf[buf.length - 1], 0x80);
});

test('getMediaSessionTitle returns exact Rider Duty ON and Owner titles', () => {
  assert.equal(
    getMediaSessionTitle('rider'),
    'DailyDrop Duty ON - Listening for Orders'
  );
  assert.equal(
    getMediaSessionTitle('owner'),
    'DailyDrop Owner - Listening for Orders'
  );
});

test('stopDutyBackgroundKeepAlive resets keep-alive active flag cleanly', () => {
  stopDutyBackgroundKeepAlive();
  assert.equal(isBackgroundKeepAliveActive(), false);
});

test('detectNewlyArrivedRiderOrders stays 100% silent on initial load, Duty OFF, and toggling Duty ON — ringing ONLY on brand new orders while Duty ON', () => {
  const existingOrder = { id: 'DD-OLD', assignedAt: 1000, updatedAt: 1000, createdAt: 1000 };
  const freshOrder = { id: 'DD-NEW', assignedAt: 2000, updatedAt: 2000, createdAt: 2000 };
  const reassignedOrder = { id: 'DD-NEW', assignedAt: 3000, updatedAt: 3000, createdAt: 2000 };

  // 1. Initial load: never rings, records existing keys
  const step1 = detectNewlyArrivedRiderOrders([existingOrder], new Set(), {
    isDutyOnline: true,
    ordersInitialized: false,
  });
  assert.equal(step1.newlyArrived.length, 0);

  // 2. Duty OFF when a new order arrives: never rings
  const step2 = detectNewlyArrivedRiderOrders([existingOrder, freshOrder], step1.nextKnownKeys, {
    isDutyOnline: false,
    ordersInitialized: true,
  });
  assert.equal(step2.newlyArrived.length, 0);

  // 3. Exact moment Rider toggles Duty ON: never rings even if orders exist
  const step3 = detectNewlyArrivedRiderOrders([existingOrder, freshOrder], new Set(), {
    isDutyOnline: true,
    ordersInitialized: true,
    justTurnedDutyOn: true,
  });
  assert.equal(step3.newlyArrived.length, 0);

  // 4. Rider is Duty ON and a brand-new order arrives: rings immediately!
  const step4 = detectNewlyArrivedRiderOrders([existingOrder, freshOrder], step1.nextKnownKeys, {
    isDutyOnline: true,
    ordersInitialized: true,
  });
  assert.deepEqual(
    step4.newlyArrived.map((o) => o.id),
    ['DD-NEW']
  );

  // 5. Same snapshot again: does NOT double-trigger
  const step5 = detectNewlyArrivedRiderOrders([existingOrder, freshOrder], step4.nextKnownKeys, {
    isDutyOnline: true,
    ordersInitialized: true,
  });
  assert.equal(step5.newlyArrived.length, 0);

  // 6. Order re-assigned with a fresh assignedAt timestamp while Duty ON: rings again!
  const step6 = detectNewlyArrivedRiderOrders([existingOrder, reassignedOrder], step5.nextKnownKeys, {
    isDutyOnline: true,
    ordersInitialized: true,
  });
  assert.deepEqual(
    step6.newlyArrived.map((o) => o.id),
    ['DD-NEW']
  );
});
