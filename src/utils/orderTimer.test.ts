import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCountdownMMSS,
  getRiderAcceptanceCountdown,
  isAwaitingRiderAcceptance,
  isOrderTimedOutUnassigned,
  isOwnerAlertOrder,
  resolveBackNavigationAction,
  RIDER_ACCEPTANCE_WINDOW_MS,
  shouldAutoUnassignOrder,
} from './orderTimer';

test('formatCountdownMMSS formats 03:00, 02:45, and 00:00 accurately', () => {
  assert.equal(formatCountdownMMSS(180), '03:00');
  assert.equal(formatCountdownMMSS(165), '02:45');
  assert.equal(formatCountdownMMSS(5), '00:05');
  assert.equal(formatCountdownMMSS(0), '00:00');
  assert.equal(formatCountdownMMSS(-12), '00:00');
});

test('getRiderAcceptanceCountdown computes live remaining time, progress, urgency, and expiry', () => {
  const base = 1_750_000_000_000;
  const order = { assignedAt: base, updatedAt: base, createdAt: base - 5000 };

  const atStart = getRiderAcceptanceCountdown(order, base);
  assert.equal(atStart.formatted, '03:00');
  assert.equal(atStart.progressPercent, 100);
  assert.equal(atStart.isExpired, false);
  assert.equal(atStart.isUrgent, false);

  const after15s = getRiderAcceptanceCountdown(order, base + 15_000);
  assert.equal(after15s.formatted, '02:45');
  assert.equal(after15s.isExpired, false);
  assert.equal(after15s.isUrgent, false);

  const at30sLeft = getRiderAcceptanceCountdown(order, base + 150_000);
  assert.equal(at30sLeft.formatted, '00:30');
  assert.equal(at30sLeft.isUrgent, true);
  assert.equal(at30sLeft.isExpired, false);

  const atExpiry = getRiderAcceptanceCountdown(
    order,
    base + RIDER_ACCEPTANCE_WINDOW_MS
  );
  assert.equal(atExpiry.formatted, '00:00');
  assert.equal(atExpiry.progressPercent, 0);
  assert.equal(atExpiry.isExpired, true);
});

test('isAwaitingRiderAcceptance and shouldAutoUnassignOrder detect placed, pending, assigned timeouts', () => {
  const base = 1_750_000_000_000;

  assert.equal(
    isAwaitingRiderAcceptance({ status: 'assigned', assignedRiderId: 'DD001' }),
    true
  );
  assert.equal(
    isAwaitingRiderAcceptance({ status: 'pending', assignedRiderId: 'DD001' }),
    true
  );
  assert.equal(
    isAwaitingRiderAcceptance({ status: 'placed', assignedRiderId: 'DD001' }),
    true
  );
  assert.equal(
    isAwaitingRiderAcceptance({ status: 'accepted', assignedRiderId: 'DD001' }),
    false
  );
  assert.equal(
    isAwaitingRiderAcceptance({ status: 'unassigned', assignedRiderId: null }),
    false
  );
  assert.equal(isOrderTimedOutUnassigned({ status: 'unassigned' }), true);

  // Should auto-unassign after 180s
  assert.equal(
    shouldAutoUnassignOrder(
      {
        status: 'assigned',
        assignedRiderId: 'DD001',
        assignedAt: base,
        updatedAt: base,
        createdAt: base,
      },
      base + 179_000
    ),
    false
  );
  assert.equal(
    shouldAutoUnassignOrder(
      {
        status: 'assigned',
        assignedRiderId: 'DD001',
        assignedAt: base,
        updatedAt: base,
        createdAt: base,
      },
      base + 181_000
    ),
    true
  );
});

test('isOwnerAlertOrder rings for newly placed/pending unreviewed orders and timed-out unassigned orders', () => {
  assert.equal(
    isOwnerAlertOrder({ status: 'pending', ownerApproved: false, assignedRiderId: null }),
    true
  );
  assert.equal(
    isOwnerAlertOrder({ status: 'placed', ownerApproved: false, assignedRiderId: null }),
    true
  );
  assert.equal(
    isOwnerAlertOrder({ status: 'unassigned', ownerApproved: true, assignedRiderId: null }),
    true
  );
  assert.equal(
    isOwnerAlertOrder({ status: 'assigned', ownerApproved: true, assignedRiderId: 'DD001' }),
    false
  );
  assert.equal(
    isOwnerAlertOrder({ status: 'delivered', ownerApproved: true, assignedRiderId: 'DD001' }),
    false
  );
});

test('resolveBackNavigationAction closes overlays first, returns to main tab next, then uses double-back-to-exit', () => {
  const now = 10_000;

  assert.equal(
    resolveBackNavigationAction({
      hasOpenOverlay: true,
      isOnSubView: true,
      lastBackPressAt: null,
      nowMs: now,
    }),
    'close_overlay'
  );

  assert.equal(
    resolveBackNavigationAction({
      hasOpenOverlay: false,
      isOnSubView: true,
      lastBackPressAt: null,
      nowMs: now,
    }),
    'return_home'
  );

  assert.equal(
    resolveBackNavigationAction({
      hasOpenOverlay: false,
      isOnSubView: false,
      lastBackPressAt: null,
      nowMs: now,
    }),
    'warn_press_again'
  );

  assert.equal(
    resolveBackNavigationAction({
      hasOpenOverlay: false,
      isOnSubView: false,
      lastBackPressAt: now - 1200,
      nowMs: now,
    }),
    'allow_exit'
  );

  assert.equal(
    resolveBackNavigationAction({
      hasOpenOverlay: false,
      isOnSubView: false,
      lastBackPressAt: now - 4000,
      nowMs: now,
    }),
    'warn_press_again'
  );
});
