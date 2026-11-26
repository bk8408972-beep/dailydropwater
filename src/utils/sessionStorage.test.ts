import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHydratedRiderFromSession,
  clearCustomerProfile,
  clearOwnerSession,
  clearRiderSession,
  CUSTOMER_PROFILE_STORAGE_KEY,
  loadCustomerProfile,
  loadOwnerSession,
  loadRiderSession,
  OWNER_SESSION_STORAGE_KEY,
  RIDER_SESSION_STORAGE_KEY,
  saveCustomerProfile,
  saveOwnerSession,
  saveRiderSession,
  type StorageLike,
} from './sessionStorage';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('Owner persistent session saves, reloads cleanly, and clears on logout', () => {
  const storage = createMemoryStorage();
  assert.equal(loadOwnerSession(storage), null);

  const saved = saveOwnerSession(storage, 1700000000000);
  assert.equal(saved.authenticated, true);
  assert.equal(saved.loggedInAt, 1700000000000);

  const loaded = loadOwnerSession(storage);
  assert.deepEqual(loaded, { authenticated: true, loggedInAt: 1700000000000 });

  // Corrupt JSON does not throw
  storage.setItem(OWNER_SESSION_STORAGE_KEY, '{bad-json');
  assert.equal(loadOwnerSession(storage), null);

  saveOwnerSession(storage);
  clearOwnerSession(storage);
  assert.equal(loadOwnerSession(storage), null);
});

test('Rider persistent session saves login + Duty ON/OFF state and hydrates cleanly on reopen', () => {
  const storage = createMemoryStorage();
  assert.equal(loadRiderSession(storage), null);

  saveRiderSession(
    {
      id: 'dd005',
      name: 'Imran Rider',
      mobile: '9848011122',
      isOnline: true,
      dutyOnTime: 1700000123456,
    },
    storage,
    1700000000000
  );

  const loaded = loadRiderSession(storage);
  assert.ok(loaded);
  assert.equal(loaded.riderId, 'DD005');
  assert.equal(loaded.name, 'Imran Rider');
  assert.equal(loaded.isOnline, true);
  assert.equal(loaded.dutyOnTime, 1700000123456);

  const hydrated = buildHydratedRiderFromSession(loaded);
  assert.equal(hydrated.id, 'DD005');
  assert.equal(hydrated.isOnline, true);
  assert.equal(hydrated.isActive, true);
  assert.equal(hydrated.password, '');

  // Switching Duty OFF persists cleanly
  saveRiderSession(
    {
      id: 'DD005',
      name: 'Imran Rider',
      mobile: '9848011122',
      isOnline: false,
      dutyOnTime: 1700000123456,
    },
    storage,
    loaded.loggedInAt
  );
  assert.equal(loadRiderSession(storage)?.isOnline, false);

  // Corrupt JSON handled safely
  storage.setItem(RIDER_SESSION_STORAGE_KEY, 'not-json');
  assert.equal(loadRiderSession(storage), null);

  clearRiderSession(storage);
  assert.equal(loadRiderSession(storage), null);
});

test('Customer profile persists across restarts without passwords and clears cleanly on logout', () => {
  const storage = createMemoryStorage();
  assert.equal(loadCustomerProfile(storage), null);

  const saved = saveCustomerProfile(
    {
      name: 'Farhan Ahmed',
      mobile: '+91 98480 12345',
      address: 'Flat 301, Al-Hasnath Colony, Tolichowki',
    },
    storage,
    1700000000000
  );
  assert.deepEqual(saved, {
    name: 'Farhan Ahmed',
    mobile: '9848012345',
    address: 'Flat 301, Al-Hasnath Colony, Tolichowki',
    updatedAt: 1700000000000,
  });

  const loaded = loadCustomerProfile(storage);
  assert.deepEqual(loaded, saved);

  // Corrupt JSON does not throw
  storage.setItem(CUSTOMER_PROFILE_STORAGE_KEY, '{corrupt');
  assert.equal(loadCustomerProfile(storage), null);

  saveCustomerProfile(
    { name: 'Farhan', mobile: '9848012345', address: 'Tolichowki' },
    storage
  );
  clearCustomerProfile(storage);
  assert.equal(loadCustomerProfile(storage), null);
});
