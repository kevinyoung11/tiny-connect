import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSupabaseAgentStore,
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
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS connection_logs/);
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS agent_tasks/);
  assert.match(pool.sql(), /runner_pid\s+INTEGER/);
  assert.match(pool.sql(), /runner_command\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /exit_code\s+INTEGER/);
  assert.match(pool.sql(), /error\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /branch\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /pr_url\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /ci_status\s+TEXT NOT NULL DEFAULT 'unknown'/);
  assert.match(pool.sql(), /delivery_status\s+TEXT NOT NULL DEFAULT 'none'/);
  assert.match(pool.sql(), /ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS runner_pid INTEGER/);
  assert.match(pool.sql(), /ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS runner_command TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS exit_code INTEGER/);
  assert.match(pool.sql(), /ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'none'/);
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS agent_approvals/);
  assert.match(pool.sql(), /ALTER TABLE agent_approvals ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS agent_delivery/);
  assert.match(pool.sql(), /ALTER TABLE agent_delivery ADD COLUMN IF NOT EXISTS pr_number INTEGER/);
  assert.match(pool.sql(), /ALTER TABLE agent_delivery ADD COLUMN IF NOT EXISTS ci_url TEXT NOT NULL DEFAULT ''/);
  assert.match(pool.sql(), /ALTER TABLE agent_delivery ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'none'/);
  assert.match(pool.sql(), /CREATE TABLE IF NOT EXISTS agent_audit_logs/);
  assert.match(pool.sql(), /CREATE UNIQUE INDEX IF NOT EXISTS user_devices_fp_idx/);
  assert.match(pool.sql(), /CREATE UNIQUE INDEX IF NOT EXISTS conn_profiles_user_name_uidx/);
  assert.match(pool.sql(), /CREATE INDEX IF NOT EXISTS connection_logs_user_created_idx/);
  assert.match(pool.sql(), /CREATE INDEX IF NOT EXISTS agent_tasks_user_status_idx/);
  assert.match(pool.sql(), /CREATE INDEX IF NOT EXISTS agent_approvals_user_status_idx/);
  assert.match(pool.sql(), /CREATE INDEX IF NOT EXISTS agent_audit_user_task_idx/);
  assert.match(pool.sql(), /ALTER TABLE app_users ENABLE ROW LEVEL SECURITY/);
  assert.match(pool.sql(), /CREATE POLICY "app_users_client_select" ON app_users FOR SELECT TO anon, authenticated USING \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "ssh_keys_client_insert" ON ssh_keys FOR INSERT TO anon, authenticated WITH CHECK \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "connection_profiles_client_update" ON connection_profiles FOR UPDATE TO anon, authenticated USING \(true\) WITH CHECK \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "connection_logs_client_select" ON connection_logs FOR SELECT TO anon, authenticated USING \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "tiny_connect_user_settings_client_delete" ON tiny_connect_user_settings FOR DELETE TO anon, authenticated USING \(true\)/);
  assert.match(pool.sql(), /CREATE POLICY "agent_tasks_client_select" ON agent_tasks FOR SELECT TO anon, authenticated USING \(true\)/);
});

test('resolves local key cache paths under the owning user id', () => {
  const pathA = resolveScopedKeyPath('/tmp/tiny-connect-keys', 'user_a', 'key_prod');
  const pathB = resolveScopedKeyPath('/tmp/tiny-connect-keys', 'user_b', 'key_prod');

  assert.equal(pathA, '/tmp/tiny-connect-keys/user_a/key_prod.pem');
  assert.equal(pathB, '/tmp/tiny-connect-keys/user_b/key_prod.pem');
  assert.notEqual(pathA, pathB);
});

test('supabase agent store persists lifecycle fields as task columns', async () => {
  const fake = createFakeSupabaseClient();
  const store = createSupabaseAgentStore({ supabase: fake });

  const task = await store.createTask({
    id: 'task_1',
    userId: 'user_1',
    title: 'Codex lifecycle',
    kind: 'codex',
    prompt: 'work',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-1',
    runnerPid: 123,
    runnerCommand: 'tmux',
    branch: 'agent/task-1',
    prUrl: 'https://github.test/repo/pull/1',
    ciStatus: 'pending',
    deliveryStatus: 'open',
    metadata: { keep: true }
  });

  const updated = await store.updateTask({
    userId: 'user_1',
    taskId: task.id,
    patch: {
      status: 'failed',
      exitCode: 2,
      error: 'codex failed'
    }
  });

  assert.equal(fake.tables.agent_tasks.rows[0].runner_pid, 123);
  assert.equal(fake.tables.agent_tasks.rows[0].runner_command, 'tmux');
  assert.equal(fake.tables.agent_tasks.rows[0].branch, 'agent/task-1');
  assert.equal(fake.tables.agent_tasks.rows[0].pr_url, 'https://github.test/repo/pull/1');
  assert.equal(fake.tables.agent_tasks.rows[0].ci_status, 'pending');
  assert.equal(fake.tables.agent_tasks.rows[0].delivery_status, 'open');
  assert.equal(fake.tables.agent_tasks.rows[0].metadata.keep, true);
  assert.equal(fake.tables.agent_tasks.rows[0].exit_code, 2);
  assert.equal(fake.tables.agent_tasks.rows[0].error, 'codex failed');
  assert.deepEqual(fake.tables.agent_tasks.updates[0].patch, {
    status: 'failed',
    exit_code: 2,
    error: 'codex failed',
    updated_at: fake.tables.agent_tasks.updates[0].patch.updated_at
  });
  assert.equal(updated.runnerPid, 123);
  assert.equal(updated.runnerCommand, 'tmux');
  assert.equal(updated.exitCode, 2);
  assert.equal(updated.error, 'codex failed');
  assert.deepEqual(updated.metadata, { keep: true });
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

function createFakeSupabaseClient() {
  const tables = {
    agent_tasks: { rows: [], updates: [] },
    agent_delivery: { rows: [], updates: [] }
  };

  return {
    tables,
    from(name) {
      tables[name] ||= { rows: [], updates: [] };
      return createFakeQuery(tables[name]);
    }
  };
}

function createFakeQuery(table) {
  const state = {
    filters: [],
    selected: false,
    single: false,
    operation: null,
    payload: null
  };
  const query = {
    insert(row) {
      table.rows.push(structuredClone(row));
      state.operation = 'insert';
      state.payload = row;
      return Promise.resolve({ error: null, data: [row] });
    },
    upsert(row) {
      const existing = table.rows.find((item) => item.task_id === row.task_id);
      if (existing) Object.assign(existing, structuredClone(row));
      else table.rows.push(structuredClone(row));
      state.operation = 'upsert';
      state.payload = row;
      return Promise.resolve({ error: null, data: [row] });
    },
    update(patch) {
      state.operation = 'update';
      state.payload = patch;
      table.updates.push({ patch: structuredClone(patch), filters: state.filters });
      return query;
    },
    select() {
      state.selected = true;
      return query;
    },
    eq(column, value) {
      state.filters.push({ column, value });
      return query;
    },
    order() {
      return query;
    },
    maybeSingle() {
      const row = table.rows.find((item) => state.filters.every((filter) => item[filter.column] === filter.value));
      if (row && state.operation === 'update') Object.assign(row, structuredClone(state.payload));
      return Promise.resolve({ error: null, data: row ? structuredClone(row) : null });
    },
    then(resolve, reject) {
      const rows = table.rows.filter((item) => state.filters.every((filter) => item[filter.column] === filter.value));
      return Promise.resolve({ error: null, data: structuredClone(rows) }).then(resolve, reject);
    }
  };
  return query;
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
