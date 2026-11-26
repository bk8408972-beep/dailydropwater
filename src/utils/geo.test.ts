import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateHaversineKm,
  checkDeliveryRadius,
  checkTolichowkiZone,
  DELIVERY_RADIUS_KM,
  estimateEtaMinutes,
  formatRelativeTime,
  formatShortDistanceKm,
  isValidGeoPoint,
  TOLICHOWKI_CENTER,
} from './geo';

test('Tolichowki center itself has 0 km distance and is inside zone', () => {
  const result = checkTolichowkiZone(
    TOLICHOWKI_CENTER.lat,
    TOLICHOWKI_CENTER.lng
  );
  assert.equal(result.distanceKm, 0);
  assert.equal(result.withinZone, true);
  assert.equal(result.formattedDistance, '0.00 km');
});

test('Nearby Tolichowki landmark (~1.4 km away) is within 3 km delivery zone', () => {
  const result = checkTolichowkiZone(17.4055, 78.4255);
  assert.ok(result.distanceKm > 0.5 && result.distanceKm <= DELIVERY_RADIUS_KM);
  assert.equal(result.withinZone, true);
});

test('Location outside 3 km radius (Banjara Hills / HITEC City) is flagged outside zone', () => {
  const result = checkTolichowkiZone(17.4435, 78.3772);
  assert.ok(result.distanceKm > DELIVERY_RADIUS_KM);
  assert.equal(result.withinZone, false);
});

test('Haversine distance is symmetric', () => {
  const d1 = calculateHaversineKm(17.3984, 78.4146, 17.42, 78.43);
  const d2 = calculateHaversineKm(17.42, 78.43, 17.3984, 78.4146);
  assert.ok(Math.abs(d1 - d2) < 1e-9);
});

test('isValidGeoPoint validates coordinate ranges safely', () => {
  assert.equal(isValidGeoPoint({ lat: 17.3984, lng: 78.4146 }), true);
  assert.equal(isValidGeoPoint({ lat: 95, lng: 78.4 }), false);
  assert.equal(isValidGeoPoint({ lat: NaN, lng: 78.4 }), false);
  assert.equal(isValidGeoPoint(null), false);
});

test('estimateEtaMinutes and formatShortDistanceKm produce accurate rider ETAs', () => {
  assert.equal(estimateEtaMinutes(0.7), 4);
  assert.equal(estimateEtaMinutes(0.1), 2);
  assert.equal(estimateEtaMinutes(2.0), 9);
  assert.equal(formatShortDistanceKm(0.72), '0.7 km away');
  assert.equal(formatShortDistanceKm(0.05), '< 0.1 km away');
});

test('formatRelativeTime formats live GPS freshness clearly', () => {
  const now = 1_700_000_100_000;
  assert.equal(formatRelativeTime(now - 3000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 25_000, now), '25s ago');
  assert.equal(formatRelativeTime(now - 180_000, now), '3m ago');
  assert.equal(formatRelativeTime(null, now), 'No GPS yet');
});

test('checkDeliveryRadius enforces Owner-configured radius and store GPS and honors radiusEnabled toggle', () => {
  // Store base GPS (17.3984, 78.4136), 3 km limit ON, customer ~6.3 km away (HITEC City)
  const blocked = checkDeliveryRadius(17.4435, 78.3772, {
    radiusEnabled: true,
    deliveryRadiusKm: 3,
    storeLat: 17.3984,
    storeLng: 78.4136,
  });
  assert.equal(blocked.withinRadius, false);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.distanceKm > 5);
  assert.equal(
    blocked.modalMessage,
    `🚫 Outside 3 km delivery radius — We currently deliver only within a 3 km radius. Your location is ${blocked.distanceKm.toFixed(2)} km away, so this order cannot be placed.`
  );

  // Same customer when Owner switches radiusEnabled OFF -> NOT blocked
  const allowedWhenOff = checkDeliveryRadius(17.4435, 78.3772, {
    radiusEnabled: false,
    deliveryRadiusKm: 3,
    storeLat: 17.3984,
    storeLng: 78.4136,
  });
  assert.equal(allowedWhenOff.withinRadius, false);
  assert.equal(allowedWhenOff.blocked, false);

  // Same customer when Owner expands radius to 7 km -> withinRadius and NOT blocked
  const allowedWhenExpanded = checkDeliveryRadius(17.4435, 78.3772, {
    radiusEnabled: true,
    deliveryRadiusKm: 7,
    storeLat: 17.3984,
    storeLng: 78.4136,
  });
  assert.equal(allowedWhenExpanded.withinRadius, true);
  assert.equal(allowedWhenExpanded.blocked, false);
});
