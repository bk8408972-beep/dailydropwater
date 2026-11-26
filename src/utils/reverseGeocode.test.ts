import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReadableAreaName } from './reverseGeocode';

test('extractReadableAreaName returns suburb and city cleanly without hardcoded neighborhoods', () => {
  const name = extractReadableAreaName({
    address: {
      suburb: 'Banjara Hills',
      city: 'Hyderabad',
      state: 'Telangana',
    },
  });
  assert.equal(name, 'Banjara Hills, Hyderabad');
});

test('extractReadableAreaName sanitizes angle brackets and avoids duplicate locality/city', () => {
  const deduped = extractReadableAreaName({
    address: {
      city: '<Hyderabad>',
      state_district: 'Hyderabad',
    },
  });
  assert.equal(deduped, 'Hyderabad');
});

test('extractReadableAreaName falls back to display_name and returns null on empty payload', () => {
  assert.equal(
    extractReadableAreaName({
      display_name: 'Jubilee Hills, Hyderabad, Telangana, India',
    }),
    'Jubilee Hills, Hyderabad'
  );
  assert.equal(extractReadableAreaName(null), null);
  assert.equal(extractReadableAreaName({}), null);
});
