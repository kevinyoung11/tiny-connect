/**
 * Supabase/PostgreSQL-backed stores for users, SSH keys, profiles, and settings.
 * Requires DATABASE_URL or DIRECT_URL env var pointing to a Postgres connection string.
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

const { Pool } = pg;

let _pool = null;
let _tablesReady = false;

function slugify(str, fallback = 'item') {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || fallback;
}

function getPool() {
  if (_pool) return _pool;
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('No database URL configured (set DIRECT_URL or DATABASE_URL)');
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 5 });
  _pool.on('error', (err) => console.error('[supabase-store] pool error:', err.message));
  return _pool;
}

function resolvePool(options = {}) {
  return options.pool || getPool();
}

async function initTables(pool = getPool()) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id           TEXT PRIMARY KEY,
      auth_user_id TEXT UNIQUE,
      display_name TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS user_settings (
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
  await pool.query("ALTER TABLE connection_profiles ADD COLUMN IF NOT EXISTS passphrase TEXT NOT NULL DEFAULT ''");
  await pool.query('ALTER TABLE connection_profiles ADD COLUMN IF NOT EXISTS tmux BOOLEAN NOT NULL DEFAULT FALSE');
  await pool.query('CREATE INDEX IF NOT EXISTS ssh_keys_user_created_idx ON ssh_keys(user_id, created_at ASC)');
  await pool.query('CREATE INDEX IF NOT EXISTS connection_profiles_user_created_idx ON connection_profiles(user_id, created_at ASC)');
}

async function ensureTables(pool = getPool()) {
  if (_tablesReady) return;
  await initTables(pool);
  _tablesReady = true;
}

function requireUserId(options = {}) {
  if (!options.userId || typeof options.userId !== 'string') {
    throw new Error('userId is required');
  }
  return options.userId;
}

function sanitizeFingerprint(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('deviceFingerprint is required');
  }
  return createHash('sha256').update(value.trim()).digest('hex');
}

/* ── User store ─────────────────────────────────────────────────────────── */

export function createSupabaseUserStore(options = {}) {
  const pool = resolvePool(options);

  return {
    async init() {
      await ensureTables(pool);
    },

    async ensureUserForDevice({ deviceFingerprint, userAgent }) {
      await ensureTables(pool);
      const fingerprintHash = sanitizeFingerprint(deviceFingerprint);
      const existing = await pool.query(
        `SELECT u.id, u.auth_user_id, u.display_name
         FROM user_devices d
         JOIN app_users u ON u.id = d.user_id
         WHERE d.device_fingerprint = $1`,
        [fingerprintHash]
      );
      if (existing.rows[0]) {
        await pool.query('UPDATE user_devices SET last_seen_at = NOW(), user_agent = $2 WHERE device_fingerprint = $1', [
          fingerprintHash,
          userAgent || null
        ]);
        return toUser(existing.rows[0]);
      }

      const userId = `user_${randomUUID()}`;
      const inserted = await pool.query(
        'INSERT INTO app_users (id, display_name) VALUES ($1, $2) RETURNING id, auth_user_id, display_name',
        [userId, 'Anonymous device']
      );
      await pool.query(
        'INSERT INTO user_devices (id, user_id, device_fingerprint, user_agent) VALUES ($1, $2, $3, $4)',
        [`device_${randomUUID()}`, userId, fingerprintHash, userAgent || null]
      );
      await pool.query(
        'INSERT INTO user_settings (user_id, settings) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING',
        [userId, {}]
      );
      return toUser(inserted.rows[0]);
    },

    async linkAuthUser({ userId, authUserId, displayName }) {
      await ensureTables(pool);
      if (!userId || !authUserId) throw new Error('userId and authUserId are required');
      const { rows } = await pool.query(
        `UPDATE app_users
         SET auth_user_id = $2,
             display_name = COALESCE($3, display_name),
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, auth_user_id, display_name`,
        [userId, authUserId, displayName || null]
      );
      if (!rows[0]) throw new Error('User not found');
      return toUser(rows[0]);
    },

    async getUserSettings({ userId }) {
      await ensureTables(pool);
      const { rows } = await pool.query('SELECT settings FROM user_settings WHERE user_id = $1', [userId]);
      return rows[0]?.settings || {};
    },

    async saveUserSettings({ userId, settings }) {
      await ensureTables(pool);
      await pool.query(
        `INSERT INTO user_settings (user_id, settings)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = NOW()`,
        [userId, settings || {}]
      );
      return settings || {};
    }
  };
}

/* ── Key store ──────────────────────────────────────────────────────────── */

export function createSupabaseKeyStore(localDir, options = {}) {
  const pool = resolvePool(options);
  fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });

  function localPath(id) {
    return path.join(localDir, `${id}.pem`);
  }

  async function syncKeyToLocal(id, privateKey) {
    const fp = localPath(id);
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, privateKey, { mode: 0o600 });
    }
  }

  return {
    async init() {
      await ensureTables(pool);
      const { rows } = await pool.query('SELECT id, private_key FROM ssh_keys');
      for (const row of rows) {
        await syncKeyToLocal(row.id, row.private_key);
      }
    },

    async createKey({ userId, name, privateKey }) {
      if (!name?.trim()) throw new Error('Key name is required');
      if (!privateKey?.trim()) throw new Error('Private key content is required');
      const ownerId = requireUserId({ userId });
      const id = `${slugify(name, 'key')}-${randomBytes(4).toString('hex')}`;
      await ensureTables(pool);
      await pool.query(
        'INSERT INTO ssh_keys (id, user_id, name, private_key) VALUES ($1, $2, $3, $4)',
        [id, ownerId, name.trim(), privateKey.trim()]
      );
      await syncKeyToLocal(id, privateKey.trim());
      return { id, name: name.trim() };
    },

    async listKeys(options = {}) {
      const userId = requireUserId(options);
      await ensureTables(pool);
      const { rows } = await pool.query('SELECT id, name FROM ssh_keys WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
      return rows;
    },

    async deleteKey(id, options = {}) {
      const userId = requireUserId(options);
      await ensureTables(pool);
      const { rowCount } = await pool.query('DELETE FROM ssh_keys WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw new Error('Key not found');
      try { fs.unlinkSync(localPath(id)); } catch (_) {}
    },

    getPrivateKeyPath(id) {
      const fp = localPath(id);
      if (!fs.existsSync(fp)) throw new Error(`Key file not found locally for id: ${id}`);
      return fp;
    },
  };
}

/* ── Profile store ──────────────────────────────────────────────────────── */

export function createSupabaseProfileStore(options = {}) {
  const pool = resolvePool(options);

  return {
    async init() {
      await ensureTables(pool);
    },

    async listProfiles(options = {}) {
      const userId = requireUserId(options);
      await ensureTables(pool);
      const { rows } = await pool.query(
        'SELECT id, name, host, port, username, key_id, passphrase, tmux FROM connection_profiles WHERE user_id = $1 ORDER BY created_at ASC',
        [userId]
      );
      return rows.map(r => ({ ...r, keyId: r.key_id }));
    },

    async createProfile({ userId, name, host, port, username, keyId, passphrase, tmux }) {
      if (!name?.trim()) throw new Error('Profile name is required');
      if (!host?.trim()) throw new Error('Host is required');
      if (!username?.trim()) throw new Error('Username is required');
      const ownerId = requireUserId({ userId });
      const id = `${slugify(name, 'profile')}-${randomBytes(4).toString('hex')}`;
      await ensureTables(pool);
      await pool.query(
        'INSERT INTO connection_profiles (id, user_id, name, host, port, username, key_id, passphrase, tmux) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, ownerId, name.trim(), host.trim(), Number(port) || 22, username.trim(), keyId || null, String(passphrase || ''), Boolean(tmux)]
      );
      return {
        id,
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        keyId: keyId || null,
        passphrase: String(passphrase || ''),
        tmux: Boolean(tmux)
      };
    },

    async deleteProfile(id, options = {}) {
      const userId = requireUserId(options);
      await ensureTables(pool);
      const { rowCount } = await pool.query('DELETE FROM connection_profiles WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw new Error('Profile not found');
    },
  };
}

function toUser(row) {
  return {
    id: row.id,
    authUserId: row.auth_user_id || null,
    displayName: row.display_name
  };
}

export function isSupabaseConfigured() {
  return !!(process.env.DIRECT_URL || process.env.DATABASE_URL);
}
