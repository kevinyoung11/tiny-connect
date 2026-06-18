/**
 * Supabase-backed stores using @supabase/supabase-js for all CRUD.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.
 * Optionally uses Direct_Link / DIRECT_URL / DATABASE_URL for DDL (table creation).
 */
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const { Pool } = pg;

/* ── Supabase JS client ─────────────────────────────────────────────────── */

let _sb = null;
function sb() {
  if (_sb) return _sb;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  _sb = createClient(url, key, { auth: { persistSession: false } });
  return _sb;
}

/* ── pg pool (DDL only) ─────────────────────────────────────────────────── */

let _pool = null;
function getPgPool() {
  if (_pool) return _pool;
  const cs = getDatabaseUrl();
  if (!cs) return null;
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 3 });
  _pool.on('error', (err) => console.error('[supabase-store] pg error:', err.message));
  return _pool;
}

export function getDatabaseUrl() {
  return process.env.Direct_Link
    || process.env.DIRECT_LINK
    || process.env.DIRECT_URL
    || process.env.DATABASE_URL
    || '';
}

export function resolveScopedKeyPath(localDir, userId, keyId) {
  if (!userId || typeof userId !== 'string') throw new Error('userId is required');
  if (!keyId || typeof keyId !== 'string') throw new Error('keyId is required');
  return path.join(localDir, userId, `${keyId}.pem`);
}

/* ── Table init ─────────────────────────────────────────────────────────── */

const _readyPools = new WeakSet();
let _schemaWarningPrinted = false;
async function ensureTables() {
  const pool = getPgPool();
  if (!pool) return;
  try {
    await initializeSupabaseSchema(pool);
  } catch (error) {
    if (!_schemaWarningPrinted) {
      console.warn(`[supabase-store] schema init skipped: ${error.message}`);
      _schemaWarningPrinted = true;
    }
  }
}

export async function initializeSupabaseSchema(pool) {
  if (!pool) return;
  if (_readyPools.has(pool)) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id           TEXT PRIMARY KEY,
      auth_user_id TEXT UNIQUE,
      display_name TEXT NOT NULL DEFAULT 'Anonymous device',
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_devices (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      device_fingerprint TEXT NOT NULL UNIQUE,
      user_agent         TEXT,
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      last_seen_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tiny_connect_user_settings (
      user_id    TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      settings   JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ssh_keys (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connection_profiles (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name       TEXT NOT NULL,
      host       TEXT NOT NULL,
      port       INTEGER DEFAULT 22,
      username   TEXT NOT NULL,
      key_id     TEXT,
      passphrase TEXT NOT NULL DEFAULT '',
      tmux       BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS user_devices_fp_idx ON user_devices(device_fingerprint)');
  await pool.query('CREATE INDEX IF NOT EXISTS ssh_keys_user_idx ON ssh_keys(user_id, created_at ASC)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS conn_profiles_user_name_uidx ON connection_profiles(user_id, name)');
  await pool.query('CREATE INDEX IF NOT EXISTS conn_profiles_user_idx ON connection_profiles(user_id, created_at ASC)');
  await enablePermissiveRls(pool, [
    'app_users',
    'user_devices',
    'tiny_connect_user_settings',
    'ssh_keys',
    'connection_profiles'
  ]);

  _readyPools.add(pool);
}

async function enablePermissiveRls(pool, tables) {
  for (const table of tables) {
    await pool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    await pool.query(`DROP POLICY IF EXISTS "${table}_client_select" ON ${table}`);
    await pool.query(`DROP POLICY IF EXISTS "${table}_client_insert" ON ${table}`);
    await pool.query(`DROP POLICY IF EXISTS "${table}_client_update" ON ${table}`);
    await pool.query(`DROP POLICY IF EXISTS "${table}_client_delete" ON ${table}`);
    await pool.query(`CREATE POLICY "${table}_client_select" ON ${table} FOR SELECT TO anon, authenticated USING (true)`);
    await pool.query(`CREATE POLICY "${table}_client_insert" ON ${table} FOR INSERT TO anon, authenticated WITH CHECK (true)`);
    await pool.query(`CREATE POLICY "${table}_client_update" ON ${table} FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)`);
    await pool.query(`CREATE POLICY "${table}_client_delete" ON ${table} FOR DELETE TO anon, authenticated USING (true)`);
  }
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function slugify(str, fallback = 'item') {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || fallback;
}

function sanitizeFingerprint(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('deviceFingerprint is required');
  return createHash('sha256').update(value.trim()).digest('hex');
}

function requireUserId(options = {}) {
  if (!options.userId || typeof options.userId !== 'string') throw new Error('userId is required');
  return options.userId;
}

function toUser(row) {
  return { id: row.id, authUserId: row.auth_user_id || null, displayName: row.display_name };
}

async function sbCheck(result, label) {
  if (result.error) throw new Error(`[supabase-store] ${label}: ${result.error.message}`);
  return result.data;
}

/* ── User store ─────────────────────────────────────────────────────────── */

export function createSupabaseUserStore() {
  return {
    async init() {
      await ensureTables();
    },

    async ensureUserForDevice({ deviceFingerprint, userAgent }) {
      await ensureTables();
      const fp = sanitizeFingerprint(deviceFingerprint);

      const existing = await sb()
        .from('user_devices')
        .select('user_id, app_users(id, auth_user_id, display_name)')
        .eq('device_fingerprint', fp)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);

      if (existing.data) {
        await sb().from('user_devices')
          .update({ last_seen_at: new Date().toISOString(), user_agent: userAgent || null })
          .eq('device_fingerprint', fp);
        return toUser(existing.data.app_users);
      }

      const userId = `user_${randomUUID()}`;
      await sbCheck(
        await sb().from('app_users').insert({ id: userId, display_name: 'Anonymous device' }),
        'insert app_users'
      );
      await sbCheck(
        await sb().from('user_devices').insert({
          id: `device_${randomUUID()}`,
          user_id: userId,
          device_fingerprint: fp,
          user_agent: userAgent || null
        }),
        'insert user_devices'
      );
      await sb().from('tiny_connect_user_settings')
        .upsert({ user_id: userId, settings: {} }, { onConflict: 'user_id', ignoreDuplicates: true });

      return { id: userId, authUserId: null, displayName: 'Anonymous device' };
    },

    async linkAuthUser({ userId, authUserId, displayName }) {
      if (!userId || !authUserId) throw new Error('userId and authUserId are required');
      const result = await sb().from('app_users')
        .update({ auth_user_id: authUserId, display_name: displayName || undefined, updated_at: new Date().toISOString() })
        .eq('id', userId)
        .select('id, auth_user_id, display_name')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('User not found');
      return toUser(result.data);
    },

    async getUserSettings({ userId }) {
      const result = await sb().from('tiny_connect_user_settings')
        .select('settings')
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data?.settings || {};
    },

    async saveUserSettings({ userId, settings }) {
      const current = await this.getUserSettings({ userId });
      const nextSettings = { ...current, ...(settings || {}) };
      await sbCheck(
        await sb().from('tiny_connect_user_settings')
          .upsert({ user_id: userId, settings: nextSettings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' }),
        'upsert user_settings'
      );
      return this.getUserSettings({ userId });
    },

    async createPairingCode({ userId }) {
      requireUserId({ userId });
      const code = randomDigits(6);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await this.saveUserSettings({
        userId,
        settings: { devicePairing: { code, expiresAt, usedAt: null } }
      });
      return { code, expiresAt };
    },

    async linkDeviceWithPairingCode({ deviceFingerprint, userAgent, code }) {
      const cleanCode = String(code || '').replace(/\D/g, '');
      if (cleanCode.length !== 6) throw new Error('Pairing code must be 6 digits');
      const fp = sanitizeFingerprint(deviceFingerprint);
      const result = await sb().from('tiny_connect_user_settings')
        .select('user_id, settings');
      if (result.error) throw new Error(result.error.message);
      const match = (result.data || []).find((row) => row.settings?.devicePairing?.code === cleanCode);
      if (!match || match.settings.devicePairing.usedAt) throw new Error('Pairing code not found');
      if (new Date(match.settings.devicePairing.expiresAt).getTime() < Date.now()) throw new Error('Pairing code expired');

      await sbCheck(
        await sb().from('user_devices').upsert({
          id: `device_${randomUUID()}`,
          user_id: match.user_id,
          device_fingerprint: fp,
          user_agent: userAgent || null,
          last_seen_at: new Date().toISOString()
        }, { onConflict: 'device_fingerprint' }),
        'upsert paired user_devices'
      );
      await this.saveUserSettings({
        userId: match.user_id,
        settings: {
          devicePairing: {
            ...match.settings.devicePairing,
            usedAt: new Date().toISOString()
          }
        }
      });
      return { id: match.user_id, authUserId: null, displayName: 'Anonymous device' };
    }
  };
}

function randomDigits(length) {
  let value = '';
  while (value.length < length) {
    value += String(randomBytes(1)[0] % 10);
  }
  return value;
}

/* ── Key store ──────────────────────────────────────────────────────────── */

export function createSupabaseKeyStore(localDir) {
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });

  function localPath(userId, id) {
    return resolveScopedKeyPath(localDir, userId, id);
  }

  function syncLocalKey(userId, id, privateKey) {
    const fp = localPath(userId, id);
    fs.mkdirSync(path.dirname(fp), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(fp)) fs.writeFileSync(fp, privateKey, { mode: 0o600 });
  }

  return {
    async init() {
      await ensureTables();
    },

    async createKey({ userId, name, privateKey }) {
      if (!name?.trim()) throw new Error('Key name is required');
      if (!privateKey?.trim()) throw new Error('Private key content is required');
      requireUserId({ userId });
      const id = `${slugify(name, 'key')}-${randomBytes(4).toString('hex')}`;
      await sbCheck(
        await sb().from('ssh_keys').insert({ id, user_id: userId, name: name.trim(), private_key: privateKey.trim() }),
        'insert ssh_keys'
      );
      syncLocalKey(userId, id, privateKey.trim());
      return { id, name: name.trim() };
    },

    async listKeys(options = {}) {
      const userId = requireUserId(options);
      const result = await sb().from('ssh_keys')
        .select('id, name')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (result.error) throw new Error(result.error.message);
      return result.data || [];
    },

    async deleteKey(id, options = {}) {
      const userId = requireUserId(options);
      const result = await sb().from('ssh_keys')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('Key not found');
      try { fs.unlinkSync(localPath(userId, id)); } catch (_) {}
    },

    async getPrivateKeyPath(id, options = {}) {
      const userId = requireUserId(options);
      const result = await sb().from('ssh_keys')
        .select('private_key')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('Key not found');
      syncLocalKey(userId, id, result.data.private_key);
      const fp = localPath(userId, id);
      return fp;
    }
  };
}

/* ── Profile store ──────────────────────────────────────────────────────── */

export function createSupabaseProfileStore() {
  return {
    async init() {
      await ensureTables();
    },

    async listProfiles(options = {}) {
      const userId = requireUserId(options);
      const result = await sb().from('connection_profiles')
        .select('id, name, host, port, username, key_id, passphrase, tmux')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map(r => ({ ...r, keyId: r.key_id }));
    },

    async createProfile({ userId, name, host, port, username, keyId, passphrase, tmux }) {
      if (!name?.trim()) throw new Error('Profile name is required');
      if (!host?.trim()) throw new Error('Host is required');
      if (!username?.trim()) throw new Error('Username is required');
      requireUserId({ userId });
      const id = `${slugify(name, 'profile')}-${randomBytes(4).toString('hex')}`;
      await sbCheck(
        await sb().from('connection_profiles')
          .delete()
          .eq('user_id', userId)
          .eq('name', name.trim()),
        'delete duplicate connection_profiles'
      );
      const saved = await sbCheck(
        await sb().from('connection_profiles')
          .insert({
            id, user_id: userId,
            name: name.trim(), host: host.trim(),
            port: Number(port) || 22, username: username.trim(),
            key_id: keyId || null,
            passphrase: String(passphrase || ''),
            tmux: Boolean(tmux)
          })
          .select('id, name, host, port, username, key_id, passphrase, tmux')
          .maybeSingle(),
        'insert connection_profiles'
      );
      return { ...saved, keyId: saved.key_id };
    },

    async deleteProfile(id, options = {}) {
      const userId = requireUserId(options);
      const result = await sb().from('connection_profiles')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('Profile not found');
    }
  };
}

/* ── Config check ───────────────────────────────────────────────────────── */

export function isSupabaseConfigured() {
  return getSupabaseConfigStatus().configured;
}

export function getSupabaseConfigStatus() {
  const hasSupabaseUrl = Boolean(process.env.SUPABASE_URL);
  const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const databaseUrlVariable = getDatabaseUrlVariableName();
  return {
    configured: hasSupabaseUrl && hasServiceRoleKey && Boolean(databaseUrlVariable),
    hasSupabaseUrl,
    hasServiceRoleKey,
    hasDatabaseUrl: Boolean(databaseUrlVariable),
    databaseUrlVariable
  };
}

function getDatabaseUrlVariableName() {
  if (process.env.Direct_Link) return 'Direct_Link';
  if (process.env.DIRECT_LINK) return 'DIRECT_LINK';
  if (process.env.DIRECT_URL) return 'DIRECT_URL';
  if (process.env.DATABASE_URL) return 'DATABASE_URL';
  return '';
}
