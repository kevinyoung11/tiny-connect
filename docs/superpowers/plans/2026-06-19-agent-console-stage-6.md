# Agent Console Stage 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a usable vertical slice for mobile Codex/Claude continuous task control with tasks, runners, approvals, delivery state, frontend console, and MCP-compatible endpoints.

**Architecture:** Keep `/terminal` unchanged and add a new Agent layer beside it. The backend uses focused domain modules and stores; the frontend uses new ES modules instead of adding task orchestration to `client.js`.

**Tech Stack:** Node.js ESM, Express, Supabase/Postgres schema, Node `node:test`, vanilla JS frontend modules, xterm remains unchanged.

---

## File Structure

- Create `agent-domain.js`: pure validation, risk classification, task normalization, runner command builders, ring buffer.
- Create `agent-store.js`: in-memory agent store for tests/dev and store interface contract.
- Modify `supabase-store.js`: schema tables and `createSupabaseAgentStore()`.
- Create `agent-runner.js`: local process runner manager with injectable spawn.
- Create `agent-routes.js`: Express router factory for `/api/agent/*` and `/api/mcp/tools/*`.
- Modify `server.js`: instantiate agent store/runner and mount routes.
- Create `public/agent-api.js`: browser fetch helpers.
- Create `public/agent-ui.js`: render functions for tasks, approvals, output, delivery.
- Create `public/agent-console.js`: bind UI events and polling.
- Modify `public/index.html`: add Agent button and sheet root.
- Modify `public/client.js`: import/init Agent Console only.
- Modify `public/styles.css`: Agent Console sheet styles.
- Create `test/agent-domain.test.js`, `test/agent-store.test.js`, `test/agent-runner.test.js`, `test/agent-routes.test.js`, `test/agent-ui.test.js`, `test/agent-console-page.test.js`.
- Create `scripts/smoke-agent-flow.js`: end-to-end local smoke check.

## Task 1: Agent Domain

**Files:**
- Create: `agent-domain.js`
- Test: `test/agent-domain.test.js`

- [ ] **Step 1: Write failing domain tests**

Create `test/agent-domain.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendOutput,
  buildRunnerCommand,
  classifyRisk,
  createRingBuffer,
  normalizeTaskInput,
  requiresApproval,
  sanitizeTmuxName
} from '../agent-domain.js';

test('normalizes supported agent task input', () => {
  const task = normalizeTaskInput({
    kind: 'codex',
    prompt: 'Fix mobile scroll',
    title: '',
    model: 'gpt-5-codex',
    projectPath: '/repo'
  });

  assert.equal(task.kind, 'codex');
  assert.equal(task.title, 'Fix mobile scroll');
  assert.equal(task.prompt, 'Fix mobile scroll');
  assert.equal(task.model, 'gpt-5-codex');
  assert.equal(task.projectPath, '/repo');
});

test('rejects unsupported task kind and empty prompt', () => {
  assert.throws(() => normalizeTaskInput({ kind: 'python', prompt: 'x' }), /Unsupported task kind/);
  assert.throws(() => normalizeTaskInput({ kind: 'codex', prompt: ' ' }), /prompt is required/);
});

test('classifies risky actions', () => {
  assert.equal(classifyRisk('run npm test'), 'safe');
  assert.equal(classifyRisk('npm install lodash'), 'medium');
  assert.equal(classifyRisk('git push origin main'), 'high');
  assert.equal(classifyRisk('rm -rf /'), 'critical');
});

test('requires approval for high and critical risk', () => {
  assert.equal(requiresApproval('safe'), false);
  assert.equal(requiresApproval('medium'), false);
  assert.equal(requiresApproval('high'), true);
  assert.equal(requiresApproval('critical'), true);
});

test('builds runner commands for shell codex and claude', () => {
  assert.deepEqual(buildRunnerCommand({ kind: 'shell', prompt: 'echo ok' }), {
    command: 'bash',
    args: ['-lc', 'echo ok']
  });
  assert.deepEqual(buildRunnerCommand({ kind: 'codex', prompt: 'fix bug' }), {
    command: 'codex',
    args: ['fix bug']
  });
  assert.deepEqual(buildRunnerCommand({ kind: 'claude', prompt: 'fix bug' }), {
    command: 'claude',
    args: ['fix bug']
  });
});

test('sanitizes tmux names and keeps output ring bounded', () => {
  assert.equal(sanitizeTmuxName('task_ABC:/bad'), 'task-ABC-bad');
  const ring = createRingBuffer(12);
  appendOutput(ring, 'hello ');
  appendOutput(ring, 'world and more');
  assert.equal(ring.text, 'rld and more');
});
```

- [ ] **Step 2: Run domain tests and verify they fail**

Run: `npm test -- test/agent-domain.test.js`

Expected: FAIL because `agent-domain.js` does not exist.

- [ ] **Step 3: Implement domain module**

Create `agent-domain.js`:

```js
const supportedKinds = new Set(['shell', 'codex', 'claude']);

export function normalizeTaskInput(input = {}) {
  const kind = String(input.kind || 'codex').trim();
  if (!supportedKinds.has(kind)) throw new Error(`Unsupported task kind: ${kind}`);
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required');
  return {
    kind,
    prompt,
    title: String(input.title || prompt).trim().slice(0, 120),
    model: String(input.model || '').trim(),
    projectPath: String(input.projectPath || '').trim(),
    metadata: typeof input.metadata === 'object' && input.metadata ? input.metadata : {}
  };
}

export function classifyRisk(text = '') {
  const value = String(text).toLowerCase();
  if (/(rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from|secret|private[_-]?key)/.test(value)) return 'critical';
  if (/(git\s+push|deploy|release|merge|docker\s+push|kubectl|terraform\s+apply)/.test(value)) return 'high';
  if (/(npm\s+install|pnpm\s+install|yarn\s+add|git\s+commit|git\s+checkout\s+-b|pip\s+install)/.test(value)) return 'medium';
  return 'safe';
}

export function requiresApproval(riskLevel) {
  return riskLevel === 'high' || riskLevel === 'critical';
}

export function buildRunnerCommand(task) {
  if (task.kind === 'shell') return { command: 'bash', args: ['-lc', task.prompt] };
  if (task.kind === 'codex') return { command: 'codex', args: [task.prompt] };
  if (task.kind === 'claude') return { command: 'claude', args: [task.prompt] };
  throw new Error(`Unsupported task kind: ${task.kind}`);
}

export function sanitizeTmuxName(value) {
  return String(value || 'task')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'task';
}

export function createRingBuffer(maxChars = 12000) {
  return { maxChars, text: '' };
}

export function appendOutput(ring, chunk) {
  ring.text = `${ring.text}${String(chunk)}`;
  if (ring.text.length > ring.maxChars) ring.text = ring.text.slice(-ring.maxChars);
  return ring.text;
}
```

- [ ] **Step 4: Run domain tests and verify pass**

Run: `npm test -- test/agent-domain.test.js`

Expected: PASS.

## Task 2: Agent Store

**Files:**
- Create: `agent-store.js`
- Test: `test/agent-store.test.js`

- [ ] **Step 1: Write failing store tests**

Create `test/agent-store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAgentStore } from '../agent-store.js';

test('memory agent store creates lists and updates tasks by user', async () => {
  const store = createMemoryAgentStore();
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Fix scroll',
    kind: 'shell',
    prompt: 'echo ok',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-1'
  });
  await store.createTask({
    userId: 'user_2',
    title: 'Other',
    kind: 'shell',
    prompt: 'echo no',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-2'
  });
  await store.updateTask({ userId: 'user_1', taskId: task.id, patch: { status: 'running' } });

  const list = await store.listTasks({ userId: 'user_1' });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'running');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).id, task.id);
  await assert.rejects(() => store.getTask({ userId: 'user_2', taskId: task.id }), /not found/);
});

test('memory agent store handles approvals delivery output and audit logs', async () => {
  const store = createMemoryAgentStore();
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Deploy',
    kind: 'shell',
    prompt: 'git push',
    status: 'waiting_approval',
    riskLevel: 'high',
    tmuxSession: 'tc-shell-3'
  });
  const approval = await store.createApproval({
    userId: 'user_1',
    taskId: task.id,
    riskLevel: 'high',
    command: 'git push',
    reason: 'push requires approval',
    diffSummary: '+ code'
  });
  await store.resolveApproval({ userId: 'user_1', approvalId: approval.id, status: 'approved' });
  await store.appendOutput({ userId: 'user_1', taskId: task.id, chunk: 'done' });
  await store.updateDelivery({ userId: 'user_1', taskId: task.id, patch: { prUrl: 'https://example.test/pr/1', ciStatus: 'passed' } });
  await store.logAudit({ userId: 'user_1', taskId: task.id, event: 'task_completed', message: 'done' });

  assert.equal((await store.listApprovals({ userId: 'user_1', status: 'approved' })).length, 1);
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).outputTail, 'done');
  assert.equal((await store.getDelivery({ userId: 'user_1', taskId: task.id })).ciStatus, 'passed');
  assert.equal((await store.listAuditLogs({ userId: 'user_1', taskId: task.id })).length, 1);
});
```

- [ ] **Step 2: Run store tests and verify fail**

Run: `npm test -- test/agent-store.test.js`

Expected: FAIL because `agent-store.js` does not exist.

- [ ] **Step 3: Implement memory store**

Create `agent-store.js` with `createMemoryAgentStore()` implementing all tested methods. Use `randomUUID` and arrays/maps, filter by `userId`, and throw `task not found` / `approval not found` for cross-user access.

- [ ] **Step 4: Run store tests and verify pass**

Run: `npm test -- test/agent-store.test.js`

Expected: PASS.

## Task 3: Runner Manager

**Files:**
- Create: `agent-runner.js`
- Test: `test/agent-runner.test.js`

- [ ] **Step 1: Write failing runner tests**

Create tests for:

- runner starts via injected spawn;
- stdout updates store output and status;
- non-zero exit marks failed;
- cancel calls child kill.

- [ ] **Step 2: Implement runner manager**

Create `createAgentRunner({ store, spawnImpl })` with:

- `startTask({ userId, task })`;
- `cancelTask({ userId, taskId })`;
- internal process map;
- update task status and audit logs.

## Task 4: Agent REST and MCP Routes

**Files:**
- Create: `agent-routes.js`
- Test: `test/agent-routes.test.js`

- [ ] **Step 1: Write failing route tests**

Use Express app with `createMemoryAgentStore()`, fake `getScope`, and fake runner. Test:

- `POST /api/agent/tasks` creates safe shell task and starts runner;
- high-risk prompt creates approval and does not start;
- resolving approval starts runner;
- MCP endpoint creates task.

- [ ] **Step 2: Implement route factory**

Create `createAgentRouter({ store, runner, getScope })` returning an Express router.

## Task 5: Supabase Schema and Store

**Files:**
- Modify: `supabase-store.js`
- Modify: `test/supabase-store.test.js`

- [x] **Step 1: Add failing schema assertions**

Assert `agent_tasks`, `agent_approvals`, `agent_audit_logs`, and `agent_delivery` creation SQL and indexes.

- [x] **Step 2: Implement schema and `createSupabaseAgentStore()`**

Use existing Supabase patterns and sanitize text/meta like activity store.

## Task 6: Server Integration

**Files:**
- Modify: `server.js`
- Test: `test/server-startup.test.js`

- [x] **Step 1: Add failing server import/mount test**

Assert server imports without Supabase env and that Agent route module can be mounted.

- [x] **Step 2: Wire agent store, runner, and routes**

Instantiate memory store when Supabase is not configured, Supabase store when configured. Mount `/api/agent` and `/api/mcp/tools`.

## Task 7: Frontend Agent Modules

**Files:**
- Create: `public/agent-api.js`
- Create: `public/agent-ui.js`
- Test: `test/agent-ui.test.js`

- [x] **Step 1: Write failing UI tests**

Test renderers output task rows, approval cards, output tail, and delivery cards into fake DOM containers.

- [x] **Step 2: Implement API and UI modules**

Keep functions focused and DOM-oriented like `profile-ui.js`.

## Task 8: Agent Console Integration

**Files:**
- Create: `public/agent-console.js`
- Modify: `public/index.html`
- Modify: `public/client.js`
- Modify: `public/styles.css`
- Test: `test/agent-console-page.test.js`

- [x] **Step 1: Write failing page tests**

Assert page has `#agentBtn`, `#agentSheet`, create form fields, approval list, task list, and imports `agent-console.js`.

- [x] **Step 2: Implement page integration**

Add HUD button, sheet markup, styles, and minimal client import/init.

## Task 9: Smoke Flow

**Files:**
- Create: `scripts/smoke-agent-flow.js`
- Modify: `package.json`

- [x] **Step 1: Write smoke script**

Script starts server on a test port, creates a shell task, polls completion, creates a high-risk task, resolves approval, updates delivery, verifies task detail.

- [x] **Step 2: Add npm script**

Add `"smoke:agent": "node scripts/smoke-agent-flow.js"`.

## Final Verification

- [ ] Run `npm test`.
- [ ] Run `npm run smoke:agent`.
- [ ] Open `/controller-demo.html` still returns 200.
- [ ] Open root app still returns 200.
- [ ] Confirm `/terminal` behavior was not modified except import wiring.
- [ ] Commit and push only after all checks pass.

## Task 10: Continuous Session Control Hardening

**Files:**
- Modify: `agent-domain.js`
- Modify: `agent-runner.js`
- Modify: `agent-routes.js`
- Modify: `public/agent-api.js`
- Modify: `public/agent-console.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `scripts/smoke-agent-flow.js`
- Tests: `test/agent-domain.test.js`, `test/agent-runner.test.js`, `test/agent-routes.test.js`, `test/agent-ui.test.js`, `test/agent-console-page.test.js`

- [x] Add failing tests proving `codex`/`claude` start through persistent tmux sessions.
- [x] Implement tmux-backed start commands for `codex` and `claude`.
- [x] Add shell-escaping tests for tmux command prompt/model values.
- [x] Implement safe POSIX single-quote escaping for tmux command payloads.
- [x] Add runner tests for sending input to local stdin and tmux sessions.
- [x] Implement `runner.sendInput()`.
- [x] Add REST and MCP tests for task input.
- [x] Wire `POST /api/agent/tasks/:id/input` and MCP `send_agent_input` to the runner.
- [x] Add mobile input form and Agent API helper.
- [x] Include delivery state in `/api/agent/snapshot` so the phone console can render PR/CI data during polling.
- [x] Extend smoke flow to send input into an interactive shell task.
