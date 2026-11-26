import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleMapsDrivingDirectionsUrl } from './androidIntents.ts';

test('buildGoogleMapsDrivingDirectionsUrl returns exact GPS driving directions URL when coordinates exist', () => {
  const url = buildGoogleMapsDrivingDirectionsUrl({
    lat: 17.4312,
    lng: 78.4071,
    address: 'Flat 302, Green Park Residency, Road No 4, Jubilee Hills',
  });
  assert.equal(
    url,
    'https://www.google.com/maps/dir/?api=1&destination=17.4312,78.4071&travelmode=driving'
  );
  assert.ok(!url.startsWith('intent://'));
  assert.ok(!url.startsWith('geo:'));
});

test('buildGoogleMapsDrivingDirectionsUrl encodes full text address when GPS coordinates are unavailable', () => {
  const address = 'Flat 302, Green Park Residency, Road No 4, Jubilee Hills';
  const url = buildGoogleMapsDrivingDirectionsUrl({
    lat: null,
    lng: undefined,
    address,
  });
  assert.equal(
    url,
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
  );
});

test('buildGoogleMapsDrivingDirectionsUrl falls back to encoded address for invalid coordinates', () => {
  const address = 'H.No 8-2-120, Banjara Hills';
  const url = buildGoogleMapsDrivingDirectionsUrl({
    lat: Number.NaN,
    lng: 200,
    address,
  });
  assert.equal(
    url,
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`
  );
});
