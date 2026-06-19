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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS connection_logs (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      event      TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'info',
      host       TEXT,
      username   TEXT,
      message    TEXT,
      meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      kind            TEXT NOT NULL,
      prompt          TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued',
      risk_level      TEXT NOT NULL DEFAULT 'safe',
      tmux_session    TEXT,
      model           TEXT,
      project_path    TEXT,
      output_tail     TEXT NOT NULL DEFAULT '',
      metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_approvals (
      id           TEXT PRIMARY KEY,
      task_id      TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id      TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      status       TEXT NOT NULL DEFAULT 'pending',
      risk_level   TEXT NOT NULL DEFAULT 'high',
      command      TEXT NOT NULL DEFAULT '',
      reason       TEXT NOT NULL DEFAULT '',
      diff_summary TEXT NOT NULL DEFAULT '',
      metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at  TIMESTAMPTZ
    )
  `);
  await pool.query(`ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_delivery (
      task_id           TEXT PRIMARY KEY REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id           TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      pr_url            TEXT NOT NULL DEFAULT '',
      ci_status         TEXT NOT NULL DEFAULT 'unknown',
      deployment_status TEXT NOT NULL DEFAULT 'none',
      summary           TEXT NOT NULL DEFAULT '',
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_audit_logs (
      id         TEXT PRIMARY KEY,
      task_id    TEXT,
      user_id    TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      event      TEXT NOT NULL,
      message    TEXT NOT NULL DEFAULT '',
      meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS user_devices_fp_idx ON user_devices(device_fingerprint)');
  await pool.query('CREATE INDEX IF NOT EXISTS ssh_keys_user_idx ON ssh_keys(user_id, created_at ASC)');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS conn_profiles_user_name_uidx ON connection_profiles(user_id, name)');
  await pool.query('CREATE INDEX IF NOT EXISTS conn_profiles_user_idx ON connection_profiles(user_id, created_at ASC)');
  await pool.query('CREATE INDEX IF NOT EXISTS connection_logs_user_created_idx ON connection_logs(user_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS agent_tasks_user_status_idx ON agent_tasks(user_id, status, updated_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS agent_approvals_user_status_idx ON agent_approvals(user_id, status, requested_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS agent_audit_user_task_idx ON agent_audit_logs(user_id, task_id, created_at DESC)');
  await enablePermissiveRls(pool, [
    'app_users',
    'user_devices',
    'tiny_connect_user_settings',
    'ssh_keys',
    'connection_profiles',
    'connection_logs',
    'agent_tasks',
    'agent_approvals',
    'agent_delivery',
    'agent_audit_logs'
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
    },

    async listDevices({ userId, deviceFingerprint }) {
      requireUserId({ userId });
      const currentFp = deviceFingerprint ? sanitizeFingerprint(deviceFingerprint) : '';
      const result = await sb().from('user_devices')
        .select('id, device_fingerprint, user_agent, created_at, last_seen_at')
        .eq('user_id', userId)
        .order('last_seen_at', { ascending: false });
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map((device) => ({
        id: device.id,
        idHash: createHash('sha256').update(device.device_fingerprint).digest('hex').slice(0, 12),
        current: Boolean(currentFp && device.device_fingerprint === currentFp),
        userAgent: device.user_agent || '',
        createdAt: device.created_at,
        lastSeenAt: device.last_seen_at
      }));
    },

    async unlinkDevice({ userId, deviceId, deviceFingerprint }) {
      requireUserId({ userId });
      if (!deviceId) throw new Error('deviceId is required');
      const currentFp = deviceFingerprint ? sanitizeFingerprint(deviceFingerprint) : '';
      const result = await sb().from('user_devices')
        .delete()
        .eq('id', deviceId)
        .eq('user_id', userId)
        .neq('device_fingerprint', currentFp || '__none__')
        .select('id')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('Device not found or cannot unlink current device');
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

/* ── Activity store ─────────────────────────────────────────────────────── */

export function createSupabaseActivityStore() {
  return {
    async init() {
      await ensureTables();
    },

    async logConnection({ userId, event, status = 'info', host, username, message, meta }) {
      requireUserId({ userId });
      await sbCheck(
        await sb().from('connection_logs').insert({
          id: `log_${randomUUID()}`,
          user_id: userId,
          event: sanitizeLogText(event, 80) || 'event',
          status: ['info', 'ok', 'warn', 'error'].includes(status) ? status : 'info',
          host: sanitizeLogText(host, 180),
          username: sanitizeLogText(username, 120),
          message: sanitizeLogText(message, 500),
          meta: sanitizeLogMeta(meta)
        }),
        'insert connection_logs'
      );
    },

    async listConnectionLogs(options = {}) {
      const userId = requireUserId(options);
      const limit = Math.min(200, Math.max(1, Number(options.limit) || 80));
      const result = await sb().from('connection_logs')
        .select('id, event, status, host, username, message, meta, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map((row) => ({
        id: row.id,
        event: row.event,
        status: row.status,
        host: row.host || '',
        username: row.username || '',
        message: row.message || '',
        meta: row.meta || {},
        createdAt: row.created_at
      }));
    }
  };
}

export function createSupabaseAgentStore() {
  return {
    async init() {
      await ensureTables();
    },

    async createTask(input) {
      const row = {
        id: input.id || `task_${randomUUID()}`,
        user_id: requireUserId(input),
        title: sanitizeLogText(input.title || input.prompt || 'Untitled task', 160),
        kind: sanitizeLogText(input.kind || 'codex', 24),
        prompt: sanitizeLogText(input.prompt || '', 4000),
        status: sanitizeLogText(input.status || 'queued', 40),
        risk_level: sanitizeLogText(input.riskLevel || 'safe', 24),
        tmux_session: sanitizeLogText(input.tmuxSession || '', 120),
        model: sanitizeLogText(input.model || '', 120),
        project_path: sanitizeLogText(input.projectPath || '', 500),
        output_tail: sanitizeLogText(input.outputTail || '', 12000),
        metadata: sanitizeLogMeta(input.metadata || {})
      };
      await sbCheck(await sb().from('agent_tasks').insert(row), 'insert agent_tasks');
      await this.updateDelivery({ userId: row.user_id, taskId: row.id, patch: {} });
      return toAgentTask(row);
    },

    async listTasks({ userId }) {
      const result = await sb().from('agent_tasks')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .order('created_at', { ascending: false });
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map(toAgentTask);
    },

    async getTask({ userId, taskId }) {
      const result = await sb().from('agent_tasks')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .eq('id', taskId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('task not found');
      return toAgentTask(result.data);
    },

    async updateTask({ userId, taskId, patch }) {
      const row = agentTaskPatch(patch || {});
      row.updated_at = new Date().toISOString();
      const result = await sb().from('agent_tasks')
        .update(row)
        .eq('user_id', requireUserId({ userId }))
        .eq('id', taskId)
        .select('*')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('task not found');
      return toAgentTask(result.data);
    },

    async appendOutput({ userId, taskId, chunk }) {
      const task = await this.getTask({ userId, taskId });
      const next = `${task.outputTail || ''}${String(chunk)}`.slice(-12000);
      await this.updateTask({ userId, taskId, patch: { outputTail: next } });
      return next;
    },

    async replaceOutput({ userId, taskId, output }) {
      const next = String(output || '').slice(-12000);
      await this.updateTask({ userId, taskId, patch: { outputTail: next } });
      return next;
    },

    async createApproval(input) {
      const row = {
        id: input.id || `approval_${randomUUID()}`,
        task_id: input.taskId,
        user_id: requireUserId(input),
        status: input.status || 'pending',
        risk_level: input.riskLevel || 'high',
        command: sanitizeLogText(input.command || '', 4000),
        reason: sanitizeLogText(input.reason || '', 1000),
        diff_summary: sanitizeLogText(input.diffSummary || '', 4000),
        metadata: sanitizeLogMeta(input.metadata || {})
      };
      await sbCheck(await sb().from('agent_approvals').insert(row), 'insert agent_approvals');
      return toAgentApproval(row);
    },

    async listApprovals({ userId, status } = {}) {
      let query = sb().from('agent_approvals')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .order('requested_at', { ascending: false });
      if (status) query = query.eq('status', status);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map(toAgentApproval);
    },

    async getApproval({ userId, approvalId }) {
      const result = await sb().from('agent_approvals')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .eq('id', approvalId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('approval not found');
      return toAgentApproval(result.data);
    },

    async resolveApproval({ userId, approvalId, status }) {
      const result = await sb().from('agent_approvals')
        .update({ status, resolved_at: new Date().toISOString() })
        .eq('user_id', requireUserId({ userId }))
        .eq('id', approvalId)
        .select('*')
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      if (!result.data) throw new Error('approval not found');
      return toAgentApproval(result.data);
    },

    async getDelivery({ userId, taskId }) {
      const result = await sb().from('agent_delivery')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .eq('task_id', taskId)
        .maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return result.data ? toAgentDelivery(result.data) : null;
    },

    async updateDelivery({ userId, taskId, patch }) {
      const row = {
        task_id: taskId,
        user_id: requireUserId({ userId }),
        pr_url: sanitizeLogText(patch?.prUrl || patch?.pr_url || '', 1000),
        ci_status: sanitizeLogText(patch?.ciStatus || patch?.ci_status || 'unknown', 40),
        deployment_status: sanitizeLogText(patch?.deploymentStatus || patch?.deployment_status || 'none', 40),
        summary: sanitizeLogText(patch?.summary || '', 1000),
        updated_at: new Date().toISOString()
      };
      await sbCheck(
        await sb().from('agent_delivery').upsert(row, { onConflict: 'task_id' }),
        'upsert agent_delivery'
      );
      return this.getDelivery({ userId, taskId });
    },

    async logAudit({ userId, taskId, event, message = '', meta = {} }) {
      const row = {
        id: `audit_${randomUUID()}`,
        task_id: taskId || null,
        user_id: requireUserId({ userId }),
        event: sanitizeLogText(event, 120),
        message: sanitizeLogText(message, 1000),
        meta: sanitizeLogMeta(meta)
      };
      await sbCheck(await sb().from('agent_audit_logs').insert(row), 'insert agent_audit_logs');
      return toAgentAudit(row);
    },

    async listAuditLogs({ userId, taskId } = {}) {
      let query = sb().from('agent_audit_logs')
        .select('*')
        .eq('user_id', requireUserId({ userId }))
        .order('created_at', { ascending: false });
      if (taskId) query = query.eq('task_id', taskId);
      const result = await query;
      if (result.error) throw new Error(result.error.message);
      return (result.data || []).map(toAgentAudit);
    }
  };
}

function toAgentTask(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    riskLevel: row.risk_level,
    tmuxSession: row.tmux_session || '',
    model: row.model || '',
    projectPath: row.project_path || '',
    outputTail: row.output_tail || '',
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function agentTaskPatch(patch) {
  const row = {};
  if ('status' in patch) row.status = sanitizeLogText(patch.status, 40);
  if ('riskLevel' in patch) row.risk_level = sanitizeLogText(patch.riskLevel, 24);
  if ('tmuxSession' in patch) row.tmux_session = sanitizeLogText(patch.tmuxSession, 120);
  if ('outputTail' in patch) row.output_tail = sanitizeLogText(patch.outputTail, 12000);
  if ('runnerCommand' in patch) row.metadata = sanitizeLogMeta({ runnerCommand: patch.runnerCommand });
  if ('error' in patch) row.metadata = sanitizeLogMeta({ error: patch.error });
  if ('exitCode' in patch) row.metadata = sanitizeLogMeta({ exitCode: patch.exitCode });
  return row;
}

function toAgentApproval(row) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    status: row.status,
    riskLevel: row.risk_level,
    command: row.command || '',
    reason: row.reason || '',
    diffSummary: row.diff_summary || '',
    metadata: row.metadata || {},
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at || null
  };
}

function toAgentDelivery(row) {
  return {
    taskId: row.task_id,
    userId: row.user_id,
    prUrl: row.pr_url || '',
    ciStatus: row.ci_status || 'unknown',
    deploymentStatus: row.deployment_status || 'none',
    summary: row.summary || '',
    updatedAt: row.updated_at
  };
}

function toAgentAudit(row) {
  return {
    id: row.id,
    taskId: row.task_id || null,
    userId: row.user_id,
    event: row.event,
    message: row.message || '',
    meta: row.meta || {},
    createdAt: row.created_at
  };
}

function sanitizeLogText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/-----BEGIN[\s\S]*?-----END[\s\S]*?-----/g, '[redacted-key]');
  return text.slice(0, maxLength);
}

function sanitizeLogMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    if (/pass|key|secret|token/i.test(key)) continue;
    safe[key] = typeof value === 'string' ? sanitizeLogText(value, 180) : value;
  }
  return safe;
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
