import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
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

function createTestApp(store, runner) {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter({ store, runner, getScope: async () => ({ userId: 'user_1' }) }));
  app.use('/api/mcp/tools', createAgentRouter({ store, runner, getScope: async () => ({ userId: 'user_1' }), mcpOnly: true }));
  return app;
}

async function requestJson(app, path, options = {}) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json();
    return { status: response.status, body };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
