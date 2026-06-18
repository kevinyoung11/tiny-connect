import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDatabaseUrl,
  getSupabaseConfigStatus,
  initializeSupabaseSchema,
  isSupabaseConfigured,
  resolveScopedKeyPath
} from '../supabase-store.js';

test('recognizes Supabase API credentials and the Direct_Link database env var', () => {
  const original = snapshotEnv();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DIRECT_LINK;
  delete process.env.DIRECT_URL;
  delete process.env.DATABASE_URL;
  delete process.env.Direct_Link;

  try {
    assert.equal(isSupabaseConfigured(), false);
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    assert.equal(isSupabaseConfigured(), false);

    process.env.Direct_Link = 'postgresql://example/supabase';

    assert.equal(isSupabaseConfigured(), true);
    assert.equal(getDatabaseUrl(), 'postgresql://example/supabase');
    assert.deepEqual(getSupabaseConfigStatus(), {
      configured: true,
      hasSupabaseUrl: true,
      hasServiceRoleKey: true,
      hasDatabaseUrl: true,
      databaseUrlVariable: 'Direct_Link'
    });
  } finally {
    restoreEnv(original);
  }
});

test('initializes Supabase tables, indexes, and permissive RLS policies', async () => {
  const pool = createMockPool();

  await initializeSupabaseSchema(pool);

  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS app_users/);
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS tiny_connect_user_settings/);
  assert.match(pool.sql(), /CREATE UNIQUE INDEX IF NOT EXISTS user_devices_fp_idx/);
  assert.match(pool.sql(), /CREATE UNIQUE INDEX IF NOT EXISTS conn_profiles_user_name_uidx/);
  assert.match(pool.sql(), /ALTER TABLE app_users ENABLE ROW LEVEL SECURITY/);
  assert.match(pool.sql(), /CREATE POLICY "app_users_client_select" ON app_users FOR SELECT TO anon, authenticated USING \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "ssh_keys_client_insert" ON ssh_keys FOR INSERT TO anon, authenticated WITH CHECK \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "connection_profiles_client_update" ON connection_profiles FOR UPDATE TO anon, authenticated USING \(true\) WITH CHECK \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "tiny_connect_user_settings_client_delete" ON tiny_connect_user_settings FOR DELETE TO anon, authenticated USING \(true\)/);
});

test('resolves local key cache paths under the owning user id', () => {
  const pathA = resolveScopedKeyPath('/tmp/tiny-connect-keys', 'user_a', 'key_prod');
  const pathB = resolveScopedKeyPath('/tmp/tiny-connect-keys', 'user_b', 'key_prod');

  assert.equal(pathA, '/tmp/tiny-connect-keys/user_a/key_prod.pem');
  assert.equal(pathB, '/tmp/tiny-connect-keys/user_b/key_prod.pem');
  assert.notEqual(pathA, pathB);
});

function createMockPool() {
  const calls = [];
  return {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
    sql() {
      return calls.map((call) => call.sql).join('\n');
    }
  };
}

function snapshotEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DIRECT_LINK: process.env.DIRECT_LINK,
    DIRECT_URL: process.env.DIRECT_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    Direct_Link: process.env.Direct_Link
  };
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
