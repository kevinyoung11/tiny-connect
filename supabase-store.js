/**
 * Supabase/PostgreSQL-backed stores for SSH keys and connection profiles.
 * Requires DATABASE_URL or DIRECT_URL env var pointing to a Postgres connection string.
 * Supabase direct URL format: postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

const { Pool } = pg;

let _pool = null;

function slugify(str) {
  return String(str).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'key';
}

function getPool() {
  if (_pool) return _pool;
  const cs = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!cs) throw new Error('No database URL configured (set DIRECT_URL or DATABASE_URL)');
  _pool = new Pool({ connectionString: cs, ssl: { rejectUnauthorized: false }, max: 5 });
  _pool.on('error', (err) => console.error('[supabase-store] pool error:', err.message));
  return _pool;
}

async function initTables() {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ssh_keys (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connection_profiles (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      host       TEXT NOT NULL,
      port       INTEGER DEFAULT 22,
      username   TEXT NOT NULL,
      key_id     TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

let _tablesReady = false;
async function ensureTables() {
  if (_tablesReady) return;
  await initTables();
  _tablesReady = true;
}

/* ── Key store ──────────────────────────────────────────────────────────── */

export function createSupabaseKeyStore(localDir) {
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
      await ensureTables();
      // Sync all keys from DB to local filesystem on startup
      const pool = getPool();
      const { rows } = await pool.query('SELECT id, private_key FROM ssh_keys');
      for (const row of rows) {
        await syncKeyToLocal(row.id, row.private_key);
      }
    },

    async createKey({ name, privateKey }) {
      if (!name?.trim()) throw new Error('Key name is required');
      if (!privateKey?.trim()) throw new Error('Private key content is required');
      const id = `${slugify(name)}-${randomBytes(4).toString('hex')}`;
      await ensureTables();
      const pool = getPool();
      await pool.query(
        'INSERT INTO ssh_keys (id, name, private_key) VALUES ($1, $2, $3)',
        [id, name.trim(), privateKey.trim()]
      );
      await syncKeyToLocal(id, privateKey.trim());
      return { id, name: name.trim() };
    },

    async listKeys() {
      await ensureTables();
      const pool = getPool();
      const { rows } = await pool.query('SELECT id, name FROM ssh_keys ORDER BY created_at ASC');
      return rows;
    },

    async deleteKey(id) {
      await ensureTables();
      const pool = getPool();
      const { rowCount } = await pool.query('DELETE FROM ssh_keys WHERE id = $1', [id]);
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

export function createSupabaseProfileStore() {
  return {
    async init() {
      await ensureTables();
    },

    async listProfiles() {
      await ensureTables();
      const pool = getPool();
      const { rows } = await pool.query(
        'SELECT id, name, host, port, username, key_id FROM connection_profiles ORDER BY created_at ASC'
      );
      return rows.map(r => ({ ...r, keyId: r.key_id }));
    },

    async createProfile({ name, host, port, username, keyId }) {
      if (!name?.trim()) throw new Error('Profile name is required');
      if (!host?.trim()) throw new Error('Host is required');
      if (!username?.trim()) throw new Error('Username is required');
      const id = `${slugify(name)}-${randomBytes(4).toString('hex')}`;
      await ensureTables();
      const pool = getPool();
      await pool.query(
        'INSERT INTO connection_profiles (id, name, host, port, username, key_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [id, name.trim(), host.trim(), Number(port) || 22, username.trim(), keyId || null]
      );
      return { id, name: name.trim(), host: host.trim(), port: Number(port) || 22, username: username.trim(), keyId: keyId || null };
    },

    async deleteProfile(id) {
      await ensureTables();
      const pool = getPool();
      const { rowCount } = await pool.query('DELETE FROM connection_profiles WHERE id = $1', [id]);
      if (rowCount === 0) throw new Error('Profile not found');
    },
  };
}

export function isSupabaseConfigured() {
  return !!(process.env.DIRECT_URL || process.env.DATABASE_URL);
}
