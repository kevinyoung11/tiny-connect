import test from 'node:test';
import assert from 'node:assert/strict';
import { runApprovalHook } from '../scripts/agent-approval-hook.js';

test('approval hook requests approval and exits zero when approved', async () => {
  const calls = [];
  const result = await runApprovalHook({
    argv: ['--base-url', 'http://agent.test', '--task-id', 'task_1', '--command', 'git push origin main', '--poll-ms', '1'],
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/approval-requests')) {
        return jsonResponse(201, { approval: { id: 'approval_1' } });
      }
      return jsonResponse(200, { approval: { status: 'approved' } });
    },
    sleep: async () => {}
  });

  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
    ['http://agent.test/api/agent/tasks/task_1/approval-requests', 'POST'],
    ['http://agent.test/api/agent/approvals/approval_1', 'GET']
  ]);
  assert.equal(JSON.parse(calls[0].init.body).command, 'git push origin main');
});

test('approval hook exits non-zero when rejected', async () => {
  const result = await runApprovalHook({
    argv: ['--base-url', 'http://agent.test', '--task-id', 'task_1', '--command', 'deploy production'],
    fetchImpl: async (url) => {
      if (url.endsWith('/approval-requests')) return jsonResponse(201, { approval: { id: 'approval_1' } });
      return jsonResponse(200, { approval: { status: 'rejected' } });
    },
    sleep: async () => {}
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /rejected/);
});

test('approval hook exits non-zero when approval times out', async () => {
  const result = await runApprovalHook({
    argv: ['--base-url', 'http://agent.test', '--task-id', 'task_1', '--command', 'deploy production', '--timeout-ms', '2', '--poll-ms', '1'],
    now: createClock([0, 1, 3]),
    fetchImpl: async (url) => {
      if (url.endsWith('/approval-requests')) return jsonResponse(201, { approval: { id: 'approval_1' } });
      return jsonResponse(200, { approval: { status: 'pending' } });
    },
    sleep: async () => {}
  });

  assert.equal(result.exitCode, 3);
  assert.match(result.stderr, /timed out/);
});

test('approval hook validates required options', async () => {
  const result = await runApprovalHook({
    argv: ['--task-id', 'task_1'],
    fetchImpl: async () => jsonResponse(500, {})
  });

  assert.equal(result.exitCode, 64);
  assert.match(result.stderr, /command is required/);
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function createClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
