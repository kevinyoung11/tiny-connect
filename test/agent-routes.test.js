import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { createAgentRouter } from '../agent-routes.js';
import { createMemoryAgentStore } from '../agent-store.js';

test('agent routes create safe tasks and start runner', async () => {
  const store = createMemoryAgentStore();
  const started = [];
  const app = createTestApp(store, {
    async startTask(args) {
      started.push(args.task.id);
      await store.updateTask({ userId: args.userId, taskId: args.task.id, patch: { status: 'running' } });
    }
  });

  const res = await requestJson(app, '/api/agent/tasks', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'npm test', title: 'Run tests' }
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.task.status, 'running');
  assert.equal(started.length, 1);

  const snapshot = await requestJson(app, '/api/agent/snapshot');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.tasks.length, 1);
  assert.equal(snapshot.body.approvals.length, 0);
});

test('agent routes require approval for high-risk tasks and approval starts runner', async () => {
  const store = createMemoryAgentStore();
  const started = [];
  const app = createTestApp(store, {
    async startTask(args) {
      started.push(args.task.id);
      await store.updateTask({ userId: args.userId, taskId: args.task.id, patch: { status: 'running' } });
    }
  });

  const created = await requestJson(app, '/api/agent/tasks', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'git push origin main', title: 'Push' }
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.task.status, 'waiting_approval');
  assert.equal(created.body.approval.status, 'pending');
  assert.equal(started.length, 0);

  const resolved = await requestJson(app, `/api/agent/approvals/${created.body.approval.id}/resolve`, {
    method: 'POST',
    body: { status: 'approved' }
  });

  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.approval.status, 'approved');
  assert.equal(started.length, 1);
});

test('mcp tool endpoint creates agent task', async () => {
  const store = createMemoryAgentStore();
  const app = createTestApp(store, {
    async startTask({ userId, task }) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'running' } });
    }
  });

  const res = await requestJson(app, '/api/mcp/tools/create_agent_task', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'echo mcp' }
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.task.kind, 'shell');
});

test('agent routes send input through the runner instead of appending fake output', async () => {
  const store = createMemoryAgentStore();
  const sent = [];
  const app = createTestApp(store, {
    async startTask({ userId, task }) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'running' } });
    },
    async sendInput(args) {
      sent.push(args);
    }
  });
  const created = await requestJson(app, '/api/agent/tasks', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'cat', title: 'Interactive shell' }
  });

  const res = await requestJson(app, `/api/agent/tasks/${created.body.task.id}/input`, {
    method: 'POST',
    body: { input: 'continue\n' }
  });

  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].taskId, created.body.task.id);
  assert.equal(sent[0].input, 'continue\n');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: created.body.task.id })).outputTail, '');
});

test('mcp tool endpoint sends input to an existing task', async () => {
  const store = createMemoryAgentStore();
  const sent = [];
  const app = createTestApp(store, {
    async startTask({ userId, task }) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'running' } });
    },
    async sendInput(args) {
      sent.push(args);
    }
  });
  const created = await requestJson(app, '/api/mcp/tools/create_agent_task', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'cat' }
  });

  const res = await requestJson(app, '/api/mcp/tools/send_agent_input', {
    method: 'POST',
    body: { taskId: created.body.task.id, input: 'next step' }
  });

  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].taskId, created.body.task.id);
  assert.equal(sent[0].input, 'next step');
});

test('agent snapshot includes delivery state for each task', async () => {
  const store = createMemoryAgentStore();
  const app = createTestApp(store, {
    async startTask({ userId, task }) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'running' } });
    },
    async sendInput() {}
  });
  const created = await requestJson(app, '/api/agent/tasks', {
    method: 'POST',
    body: { kind: 'shell', prompt: 'echo ok', title: 'Delivery task' }
  });
  await requestJson(app, `/api/agent/tasks/${created.body.task.id}/delivery`, {
    method: 'POST',
    body: { prUrl: 'https://example.test/pr/1', ciStatus: 'passed', summary: 'Ready' }
  });

  const snapshot = await requestJson(app, '/api/agent/snapshot');

  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.tasks[0].delivery.prUrl, 'https://example.test/pr/1');
  assert.equal(snapshot.body.tasks[0].delivery.ciStatus, 'passed');
});

test('agent routes refresh tmux output through runner capture before returning detail and snapshot', async () => {
  const store = createMemoryAgentStore();
  const captured = [];
  const app = createTestApp(store, {
    async startTask({ userId, task }) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'running' } });
    },
    async sendInput() {},
    async captureOutput({ userId, taskId }) {
      captured.push(taskId);
      await store.replaceOutput({ userId, taskId, output: 'captured-pane-output' });
      return { output: 'captured-pane-output' };
    }
  });
  const created = await requestJson(app, '/api/agent/tasks', {
    method: 'POST',
    body: { kind: 'codex', prompt: 'work', title: 'Codex replay' }
  });

  const detail = await requestJson(app, `/api/agent/tasks/${created.body.task.id}`);
  const output = await requestJson(app, `/api/agent/tasks/${created.body.task.id}/output`);
  const snapshot = await requestJson(app, '/api/agent/snapshot');

  assert.deepEqual(captured, [created.body.task.id, created.body.task.id, created.body.task.id]);
  assert.equal(detail.body.task.outputTail, 'captured-pane-output');
  assert.equal(output.body.output, 'captured-pane-output');
  assert.equal(snapshot.body.tasks[0].outputTail, 'captured-pane-output');
});

function createTestApp(store, runner) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter({ store, runner, getScope: async () => ({ userId: 'user_1' }) }));
  app.use('/api/mcp/tools', createAgentRouter({ store, runner, getScope: async () => ({ userId: 'user_1' }), mcpOnly: true }));
  return app;
}

async function requestJson(app, path, options = {}) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const { port } = server.address();
    return await requestJsonFromServer({ port, path, options });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function requestJsonFromServer({ port, path, options }) {
  const body = options.body ? JSON.stringify(options.body) : '';
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} });
        } catch (error) {
          reject(new Error(`Failed to parse JSON response ${res.statusCode}: ${raw.slice(0, 80)}`, { cause: error }));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
