import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createSupabaseKeyStore,
  createSupabaseProfileStore,
  createSupabaseUserStore
} from '../supabase-store.js';

test('ensures an anonymous user for a device fingerprint', async () => {
  const pool = createMockPool({
    selectUserByFingerprint: [],
    insertUser: [{ id: 'user_anon_1', auth_user_id: null, display_name: 'Anonymous device' }]
  });
  const store = createSupabaseUserStore({ pool });

  const user = await store.ensureUserForDevice({
    deviceFingerprint: 'device_fp_1',
    userAgent: 'Node Test'
  });

  assert.equal(user.id, 'user_anon_1');
  assert.equal(user.displayName, 'Anonymous device');
  assert.match(pool.sql(), /INSERT INTO app_users/);
  assert.match(pool.sql(), /INSERT INTO user_devices/);
});

test('scopes Supabase keys to the current user', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiny-connect-supabase-keys-'));
  const pool = createMockPool({
    listKeys: [{ id: 'key_1', name: 'prod' }]
  });
  const store = createSupabaseKeyStore(dir, { pool });

  await store.createKey({
    userId: 'user_1',
    name: 'prod',
    privateKey: 'private'
  });
  const keys = await store.listKeys({ userId: 'user_1' });
  await store.deleteKey('key_1', { userId: 'user_1' });

  assert.deepEqual(keys, [{ id: 'key_1', name: 'prod' }]);
  assert.match(pool.sql(), /INSERT INTO ssh_keys \(id, user_id, name, private_key\)/);
  assert.match(pool.sql(), /SELECT id, name FROM ssh_keys WHERE user_id = \$1/);
  assert.match(pool.sql(), /DELETE FROM ssh_keys WHERE id = \$1 AND user_id = \$2/);
});

test('scopes Supabase connection profiles and settings to the current user', async () => {
  const pool = createMockPool({
    listProfiles: [
      { id: 'profile_1', name: 'prod', host: 'prod.example.com', port: 22, username: 'root', key_id: 'key_1', passphrase: 'secret', tmux: true }
    ],
    getSettings: [{ settings: { theme: 'dark' } }]
  });
  const profileStore = createSupabaseProfileStore({ pool });
  const userStore = createSupabaseUserStore({ pool });

  await profileStore.createProfile({
    userId: 'user_1',
    name: 'prod',
    host: 'prod.example.com',
    port: 22,
    username: 'root',
    keyId: 'key_1',
    passphrase: 'secret',
    tmux: true
  });
  const profiles = await profileStore.listProfiles({ userId: 'user_1' });
  const settings = await userStore.getUserSettings({ userId: 'user_1' });
  await userStore.saveUserSettings({ userId: 'user_1', settings: { theme: 'light' } });

  assert.equal(profiles[0].keyId, 'key_1');
  assert.equal(profiles[0].passphrase, 'secret');
  assert.equal(profiles[0].tmux, true);
  assert.deepEqual(settings, { theme: 'dark' });
  assert.match(pool.sql(), /INSERT INTO connection_profiles \(id, user_id, name, host, port, username, key_id, passphrase, tmux\)/);
  assert.match(pool.sql(), /SELECT id, name, host, port, username, key_id, passphrase, tmux FROM connection_profiles WHERE user_id = \$1/);
  assert.match(pool.sql(), /INSERT INTO user_settings \(user_id, settings\)/);
});

function createMockPool(fixtures = {}) {
  const calls = [];
  return {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (/FROM user_devices/.test(sql)) return { rows: fixtures.selectUserByFingerprint || [] };
      if (/INSERT INTO app_users/.test(sql)) return { rows: fixtures.insertUser || [{ id: 'user_1', display_name: 'Anonymous device' }] };
      if (/SELECT id, name FROM ssh_keys/.test(sql)) return { rows: fixtures.listKeys || [] };
      if (/SELECT id, name, host, port, username, key_id, passphrase, tmux FROM connection_profiles/.test(sql)) {
        return { rows: fixtures.listProfiles || [] };
      }
      if (/SELECT settings FROM user_settings/.test(sql)) return { rows: fixtures.getSettings || [] };
      return { rows: [], rowCount: 1 };
    },
    sql() {
      return calls.map((call) => call.sql).join('\n');
    }
  };
}
