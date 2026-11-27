import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRolePwaManifest, getRolePwaMeta } from './pwaManifest.ts';

test('buildRolePwaManifest returns standalone DailyDrop Owner manifest for owner role', () => {
  const manifest = buildRolePwaManifest('owner', 'https://dailydrop.app');
  assert.equal(manifest.name, 'DailyDrop Owner');
  assert.equal(manifest.short_name, 'DD Owner');
  assert.ok(manifest.short_name.length <= 12);
  assert.equal(manifest.start_url, 'https://dailydrop.app/?app=owner');
  assert.equal(manifest.id, 'https://dailydrop.app/?app=owner');
  assert.equal(manifest.display, 'standalone');
  assert.ok(
    manifest.icons.some(
      (i) => i.src === 'https://dailydrop.app/icon-owner-192x192.png' && i.sizes === '192x192' && i.purpose === 'any'
    )
  );
  assert.ok(
    manifest.icons.some(
      (i) => i.src === 'https://dailydrop.app/icon-owner-512x512.png' && i.sizes === '512x512' && i.purpose === 'any'
    )
  );
  assert.ok(
    manifest.icons.some(
      (i) => i.src === 'https://dailydrop.app/icon-owner-maskable-512x512.png' && i.purpose === 'maskable'
    )
  );
});

test('buildRolePwaManifest returns standalone DailyDrop Rider manifest for rider role', () => {
  const manifest = buildRolePwaManifest('rider', 'https://dailydrop.app');
  assert.equal(manifest.name, 'DailyDrop Rider');
  assert.equal(manifest.short_name, 'DD Rider');
  assert.ok(manifest.short_name.length <= 12);
  assert.equal(manifest.start_url, 'https://dailydrop.app/?app=rider');
  assert.equal(manifest.id, 'https://dailydrop.app/?app=rider');
  assert.equal(manifest.display, 'standalone');
  assert.ok(
    manifest.icons.some(
      (i) => i.src === 'https://dailydrop.app/icon-rider-192x192.png' && i.sizes === '192x192'
    )
  );
  assert.ok(
    manifest.icons.some(
      (i) => i.src === 'https://dailydrop.app/icon-rider-maskable-512x512.png' && i.purpose === 'maskable'
    )
  );
});

test('buildRolePwaManifest keeps DailyDrop Water and start_url / for default customer role', () => {
  const relative = buildRolePwaManifest('customer');
  assert.equal(relative.name, 'DailyDrop Water');
  assert.equal(relative.start_url, '/');
  assert.equal(relative.id, '/');
  assert.equal(relative.display, 'standalone');

  const ownerRel = buildRolePwaManifest('owner');
  assert.equal(ownerRel.start_url, '/?app=owner');
  const riderRel = buildRolePwaManifest('rider');
  assert.equal(riderRel.start_url, '/?app=rider');

  // Owner, Rider, and Customer each have distinct app IDs & icons so Android installs them separately
  assert.notEqual(ownerRel.id, riderRel.id);
  assert.notEqual(ownerRel.id, relative.id);
  assert.notEqual(riderRel.id, relative.id);
  assert.equal(getRolePwaMeta('owner').installButtonLabel, '⬇️ Download Owner App');
  assert.equal(getRolePwaMeta('rider').installButtonLabel, '⬇️ Download Rider App');
});
