import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsUrl,
  calculateCartTotals,
  computeSalesMetrics,
  DEFAULT_PRODUCTS,
  getNextRiderId,
  isSafeImageDataUrl,
  parseAppRole,
  sanitizePhoneForTel,
  validateCheckoutInput,
} from './domain';
import type { Order, RiderRecord } from '../types';

test('parseAppRole resolves direct role routes and defaults to launcher', () => {
  assert.equal(parseAppRole('?app=customer'), 'customer');
  assert.equal(parseAppRole('?app=rider'), 'rider');
  assert.equal(parseAppRole('?app=owner'), 'owner');
  assert.equal(parseAppRole('?app=OWNER'), 'owner');
  assert.equal(parseAppRole('?app=privacy'), 'privacy');
  assert.equal(parseAppRole('?app=PRIVACY'), 'privacy');
  assert.equal(parseAppRole(''), 'launcher');
  assert.equal(parseAppRole('?app=unknown'), 'launcher');
});

test('DEFAULT_PRODUCTS includes all 7 required seeded products with exact prices and stock', () => {
  const list = Object.values(DEFAULT_PRODUCTS);
  assert.equal(list.length, 7);
  assert.equal(DEFAULT_PRODUCTS.bisleri_20l.price, 90);
  assert.equal(DEFAULT_PRODUCTS.bisleri_20l.stock, 50);
  assert.equal(DEFAULT_PRODUCTS.aquafina_20l.price, 85);
  assert.equal(DEFAULT_PRODUCTS.kinley_20l.price, 85);
  assert.equal(DEFAULT_PRODUCTS.bisleri_1l_box.price, 220);
  assert.equal(DEFAULT_PRODUCTS.bisleri_1l_box.stock, 30);
  assert.equal(DEFAULT_PRODUCTS.campa_cola_2l.price, 80);
  assert.equal(DEFAULT_PRODUCTS.sprite_2l.price, 95);
  assert.equal(DEFAULT_PRODUCTS.thums_up_2l.price, 95);
});

test('getNextRiderId generates sequential DD001, DD002... IDs', () => {
  assert.equal(getNextRiderId([]), 'DD001');
  const riders: RiderRecord[] = [
    {
      id: 'DD001',
      name: 'Imran',
      mobile: '9876543210',
      password: 'pass',
      isActive: true,
      isOnline: false,
      createdAt: 1,
    },
    {
      id: 'DD003',
      name: 'Salman',
      mobile: '9876543211',
      password: 'pass',
      isActive: true,
      isOnline: true,
      createdAt: 2,
    },
  ];
  assert.equal(getNextRiderId(riders), 'DD004');
});

test('calculateCartTotals computes accurate item count and rupee subtotal', () => {
  const products = Object.values(DEFAULT_PRODUCTS);
  const totals = calculateCartTotals(
    {
      bisleri_20l: 2, // 180
      sprite_2l: 1, // 95
      unknown_id: 5, // ignored
    },
    products
  );
  assert.equal(totals.itemCount, 3);
  assert.equal(totals.subtotal, 275);
});

test('validateCheckoutInput rejects missing required fields, enforces 10-digit mobile, Floor/Lift, and events date, and keeps GPS optional', () => {
  const invalidFast = validateCheckoutInput({
    customerName: 'A',
    customerMobile: '12345',
    address: 'Flat 1',
    customerLat: null,
    customerLng: null,
    floorLevel: null,
    hasLift: null,
    serviceMode: 'fast',
    itemCount: 0,
  });
  assert.ok(invalidFast.cart);
  assert.ok(invalidFast.customerName);
  assert.ok(invalidFast.customerMobile);
  assert.ok(invalidFast.address);
  assert.ok(invalidFast.floorLevel);
  assert.ok(invalidFast.hasLift);
  assert.equal(invalidFast.location, undefined);

  const invalidEvents = validateCheckoutInput({
    customerName: 'Syed Ahmed',
    customerMobile: '9848012345',
    address: 'Flat 302, Paramount Colony, Tolichowki',
    customerLat: null,
    customerLng: null,
    floorLevel: 'ground_1st',
    hasLift: true,
    serviceMode: 'events',
    eventDate: '',
    timeSlot: '',
    itemCount: 4,
  });
  assert.equal(Object.keys(invalidEvents).length, 2);
  assert.ok(invalidEvents.eventDate);
  assert.ok(invalidEvents.timeSlot);

  const validAddressOnly = validateCheckoutInput({
    customerName: 'Syed Ahmed',
    customerMobile: '9848012345',
    address: 'Flat 302, Paramount Colony, Tolichowki',
    customerLat: null,
    customerLng: null,
    floorLevel: 'floor_2',
    hasLift: false,
    serviceMode: 'fast',
    itemCount: 2,
  });
  assert.equal(Object.keys(validAddressOnly).length, 0);

  const validWithGps = validateCheckoutInput({
    customerName: 'Syed Ahmed',
    customerMobile: '9848012345',
    address: 'Flat 302, Paramount Colony, Tolichowki',
    customerLat: 17.3991,
    customerLng: 78.4152,
    floorLevel: 'floor_3_plus',
    hasLift: true,
    serviceMode: 'fast',
    itemCount: 2,
  });
  assert.equal(Object.keys(validWithGps).length, 0);
});

test('computeSalesMetrics supports both canonical lowercase and legacy uppercase statuses', () => {
  const now = new Date('2026-11-25T15:00:00Z').getTime();
  const yesterday = now - 36 * 60 * 60 * 1000;

  const orders: Order[] = [
    {
      id: 'DD-1',
      customerName: 'A',
      customerMobile: '9000000001',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 180,
      status: 'delivered',
      createdAt: now - 3600_000,
      updatedAt: now - 1800_000,
      deliveredAt: now - 1800_000,
    },
    {
      id: 'DD-2',
      customerName: 'B',
      customerMobile: '9000000002',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 220,
      status: 'DELIVERED',
      createdAt: yesterday,
      updatedAt: yesterday,
      deliveredAt: yesterday,
    },
    {
      id: 'DD-3',
      customerName: 'C',
      customerMobile: '9000000003',
      address: 'Tolichowki',
      serviceMode: 'events',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 900,
      status: 'pending',
      createdAt: now - 600_000,
      updatedAt: now - 600_000,
    },
    {
      id: 'DD-4',
      customerName: 'D',
      customerMobile: '9000000004',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 90,
      status: 'reached_pickup',
      createdAt: now - 300_000,
      updatedAt: now - 200_000,
    },
  ];

  const metrics = computeSalesMetrics(orders, now);
  assert.equal(metrics.todayRevenue, 180);
  assert.equal(metrics.totalRevenue, 400);
  assert.equal(metrics.deliveredCount, 2);
  assert.equal(metrics.pendingCount, 1);
  assert.equal(metrics.activeCount, 2);
});

test('sanitization helpers produce safe tel, maps, and selfie data URLs', () => {
  assert.equal(sanitizePhoneForTel('+91 98480-12345;drop'), '+919848012345');
  assert.ok(
    buildGoogleMapsUrl('H.No 8-1-284, Paramount Colony').startsWith(
      'https://www.google.com/maps/search/?api=1&query='
    )
  );
  assert.equal(isSafeImageDataUrl('data:image/jpeg;base64,/9j/4AAQ'), true);
  assert.equal(isSafeImageDataUrl('javascript:alert(1)'), false);
  assert.equal(isSafeImageDataUrl('data:text/html,<script>'), false);
});

test('resolveProductImage supports gallery Base64 JPEG uploads and rejects unsafe URLs', async () => {
  const { resolveProductImage } = await import('./domain');
  const uploaded = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  assert.equal(
    resolveProductImage({
      name: 'Custom Can',
      category: 'Water Cans',
      image: uploaded,
    }),
    uploaded
  );
  assert.notEqual(
    resolveProductImage({
      name: 'Unsafe Item',
      category: 'Water Cans',
      image: 'javascript:alert(1)',
    }),
    'javascript:alert(1)'
  );
});

test('validateAudioFile enforces 3 MB max limit and valid audio formats', async () => {
  const { validateAudioFile, MAX_RINGTONE_BYTES, isSafeAudioDataUrl } =
    await import('./sound');
  assert.equal(
    validateAudioFile({ type: 'audio/mpeg', size: 512_000, name: 'ring.mp3' }),
    null
  );
  assert.ok(
    validateAudioFile({
      type: 'audio/mpeg',
      size: MAX_RINGTONE_BYTES + 1,
      name: 'huge.mp3',
    })
  );
  assert.ok(
    validateAudioFile({ type: 'text/plain', size: 1000, name: 'notes.txt' })
  );
  assert.equal(isSafeAudioDataUrl('data:audio/mpeg;base64,SUQz'), true);
  assert.equal(isSafeAudioDataUrl('javascript:alert(1)'), false);
});

test('detectCustomerOrderChanges triggers alerts across all 5 delivery workflow steps', async () => {
  const { detectCustomerOrderChanges } = await import('./domain');
  const baseOrder: Order = {
    id: 'DD-555',
    customerName: 'Amina',
    customerMobile: '9848011122',
    address: 'Paramount Colony, Tolichowki',
    serviceMode: 'fast',
    paymentMethod: 'Cash on Delivery',
    items: [],
    totalAmount: 180,
    status: 'accepted',
    assignedRiderName: 'Imran',
    createdAt: 1,
    updatedAt: 2,
  };

  const acceptedEvent = detectCustomerOrderChanges(
    { 'DD-555': { status: 'pending' } },
    [baseOrder]
  );
  assert.ok(acceptedEvent);
  assert.match(acceptedEvent.headline, /Accepted/);

  const reachedEvent = detectCustomerOrderChanges(
    { 'DD-555': { status: 'accepted' } },
    [{ ...baseOrder, status: 'reached_pickup' }]
  );
  assert.ok(reachedEvent);
  assert.match(reachedEvent.headline, /Water Plant/);

  const outEvent = detectCustomerOrderChanges(
    { 'DD-555': { status: 'reached_pickup' } },
    [{ ...baseOrder, status: 'out_for_delivery' }]
  );
  assert.ok(outEvent);
  assert.match(outEvent.headline, /Out for Delivery/);

  const deliveredEvent = detectCustomerOrderChanges(
    { 'DD-555': { status: 'out_for_delivery' } },
    [{ ...baseOrder, status: 'delivered' }]
  );
  assert.ok(deliveredEvent);
  assert.match(deliveredEvent.headline, /Delivered/);

  const noChange = detectCustomerOrderChanges(
    { 'DD-555': { status: 'accepted' } },
    [baseOrder]
  );
  assert.equal(noChange, null);
});

test('vibration patterns match requested Owner, Rider, and Customer specifications', async () => {
  const {
    OWNER_VIBRATION_PATTERN,
    RIDER_VIBRATION_PATTERN,
    CUSTOMER_VIBRATION_PATTERN,
  } = await import('./sound');
  assert.deepEqual(OWNER_VIBRATION_PATTERN, [500, 300, 500, 300, 500]);
  assert.deepEqual(RIDER_VIBRATION_PATTERN, [500, 300, 500, 300, 500]);
  assert.deepEqual(CUSTOMER_VIBRATION_PATTERN, [300, 150, 300]);
});

test('weekly cleanup selects only delivered/rejected orders and preserves active orders & active customers', async () => {
  const {
    getCompletedOrdersForCleanup,
    getInactiveCustomerMobilesForCleanup,
  } = await import('./domain');

  const orders: Order[] = [
    {
      id: 'DD-DEL',
      customerName: 'Delivered User',
      customerMobile: '9000000001',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 90,
      status: 'delivered',
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'DD-REJ',
      customerName: 'Rejected User',
      customerMobile: '9000000002',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 180,
      status: 'REJECTED',
      createdAt: 3,
      updatedAt: 4,
    },
    {
      id: 'DD-ACT',
      customerName: 'Active User',
      customerMobile: '9000000003',
      address: 'Tolichowki',
      serviceMode: 'fast',
      paymentMethod: 'Cash on Delivery',
      items: [],
      totalAmount: 95,
      status: 'reached_pickup',
      createdAt: 5,
      updatedAt: 6,
    },
  ];

  const toDelete = getCompletedOrdersForCleanup(orders);
  assert.deepEqual(
    toDelete.map((o) => o.id),
    ['DD-DEL', 'DD-REJ']
  );

  const inactiveMobiles = getInactiveCustomerMobilesForCleanup(orders, [
    '9000000001',
    '9000000002',
    '9000000003',
  ]);
  assert.deepEqual(inactiveMobiles.sort(), ['9000000001', '9000000002']);
});

test('androidIntents produces MIT App Inventor safe tel: and standard https:// Maps URLs with zero intent:// schemes', async () => {
  const {
    formatDisplayPhone10,
    formatIndianPhoneE164,
    buildPhoneCallUrl,
    buildMapsDirectionsUrl,
    buildMapsDirectionsByAddressUrl,
    buildTrackRiderMapUrl,
  } = await import('./androidIntents');

  assert.equal(formatDisplayPhone10('+91 98480-12345'), '9848012345');
  assert.equal(formatDisplayPhone10('09848012345'), '9848012345');
  assert.equal(formatIndianPhoneE164('9848012345'), '+919848012345');
  assert.equal(formatIndianPhoneE164('+91 98480-12345'), '+919848012345');

  const callUrl = buildPhoneCallUrl('9848012345');
  assert.equal(callUrl, 'tel:+919848012345');
  assert.equal(callUrl.includes('intent://'), false);

  const dirUrl = buildMapsDirectionsUrl(17.3984, 78.4146);
  assert.equal(
    dirUrl,
    'https://www.google.com/maps/dir/?api=1&destination=17.398400,78.414600'
  );
  assert.equal(dirUrl.includes('intent://'), false);

  const addrDirUrl = buildMapsDirectionsByAddressUrl(
    'Flat 302, Paramount Colony'
  );
  assert.equal(
    addrDirUrl,
    'https://www.google.com/maps/dir/?api=1&destination=Flat%20302%2C%20Paramount%20Colony%2C%20Hyderabad'
  );
  assert.equal(addrDirUrl.includes('intent://'), false);

  const trackUrl = buildTrackRiderMapUrl(17.4002, 78.4161);
  assert.equal(
    trackUrl,
    'https://www.google.com/maps/search/?api=1&query=17.400200,78.416100'
  );
  assert.equal(trackUrl.includes('intent://'), false);
});

test('buildGoogleMapEmbedUrl and formatCopyLocationText support both GPS coords and address-only fallback', async () => {
  const { buildGoogleMapEmbedUrl, formatCopyLocationText } = await import(
    './androidIntents'
  );

  assert.equal(
    buildGoogleMapEmbedUrl({
      lat: 17.3984,
      lng: 78.4146,
      address: 'DailyDrop Water Plant',
    }),
    'https://maps.google.com/maps?q=17.398400,78.414600&z=16&output=embed'
  );

  assert.equal(
    buildGoogleMapEmbedUrl({
      lat: null,
      lng: null,
      address: 'Flat 404, Green View Apartments',
    }),
    'https://maps.google.com/maps?q=Flat%20404%2C%20Green%20View%20Apartments%2C%20Hyderabad&z=16&output=embed'
  );

  assert.equal(
    formatCopyLocationText({
      lat: 17.3984,
      lng: 78.4146,
      address: 'DailyDrop Water Plant',
    }),
    '17.398400, 78.414600'
  );

  assert.equal(
    formatCopyLocationText({
      lat: null,
      lng: null,
      address: 'Flat 404, Green View Apartments',
    }),
    'Flat 404, Green View Apartments, Hyderabad'
  );
});





