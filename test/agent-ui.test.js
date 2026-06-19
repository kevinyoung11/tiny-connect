import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelAgentTask,
  createAgentApi,
  fetchAgentSnapshot,
  resolveAgentApproval,
  sendAgentInput,
  startAgentTask
} from '../public/agent-api.js';
import {
  renderAgentApprovals,
  renderAgentDelivery,
  renderAgentOutputTail,
  renderAgentTasks
} from '../public/agent-ui.js';

test('agent api fetches snapshot and posts task or approval actions', async () => {
  const calls = [];
  const api = createAgentApi({
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, url })
      };
    },
    withIdentity: (init = {}) => ({ ...init, identity: true })
  });

  assert.deepEqual(await api.fetchSnapshot(), { ok: true, url: '/api/agent/snapshot' });
  await api.startTask({ kind: 'codex', prompt: 'fix bug' });
  await api.resolveApproval('approval_1', 'approved');
  await api.sendInput('task_1', 'continue\n');
  await api.cancelTask('task_1');

  assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
    ['/api/agent/snapshot', 'GET'],
    ['/api/agent/tasks', 'POST'],
    ['/api/agent/approvals/approval_1/resolve', 'POST'],
    ['/api/agent/tasks/task_1/input', 'POST'],
    ['/api/agent/tasks/task_1/cancel', 'POST']
  ]);
  assert.equal(calls[1].init.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].init.body, JSON.stringify({ kind: 'codex', prompt: 'fix bug' }));
  assert.equal(calls[1].init.identity, true);
  assert.equal(calls[2].init.body, JSON.stringify({ status: 'approved' }));
  assert.equal(calls[3].init.body, JSON.stringify({ input: 'continue\n' }));
});

test('agent api exports default helpers backed by global fetch', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ ok: true })
    };
  };

  try {
    await fetchAgentSnapshot({ withIdentity: (init = {}) => init });
    await startAgentTask({ prompt: 'ship it' }, { withIdentity: (init = {}) => init });
    await resolveAgentApproval('approval_2', 'rejected', { withIdentity: (init = {}) => init });
    await sendAgentInput('task_2', 'continue', { withIdentity: (init = {}) => init });
    await cancelAgentTask('task_2', { withIdentity: (init = {}) => init });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map((call) => call.url), [
    '/api/agent/snapshot',
    '/api/agent/tasks',
    '/api/agent/approvals/approval_2/resolve',
    '/api/agent/tasks/task_2/input',
    '/api/agent/tasks/task_2/cancel'
  ]);
});

test('renders agent task rows with status risk and selection metadata', () => {
  withDocument(() => {
    const root = createElement('div');

    renderAgentTasks(root, [
      {
        id: 'task_1',
        title: 'Fix mobile scroll',
        kind: 'codex',
        status: 'running',
        riskLevel: 'safe',
        updatedAt: '2026-06-19T09:00:00Z'
      }
    ], { selectedTaskId: 'task_1' });

    assert.equal(root.children.length, 1);
    const row = root.children[0];
    assert.equal(row.className, 'agent-task-row is-selected');
    assert.equal(row.dataset.taskId, 'task_1');
    assert.equal(row.getAttribute('role'), 'button');
    assert.equal(row.children[0].children[0].textContent, 'Fix mobile scroll');
    assert.equal(row.children[0].children[1].textContent, 'codex');
    assert.equal(row.children[1].children[0].textContent, 'running');
    assert.equal(row.children[1].children[1].textContent, 'safe');
    assert.equal(row.children[2].dataset.taskAction, 'cancel');
    assert.equal(row.children[2].dataset.taskId, 'task_1');
  });
});

test('renders pending approval cards with approve and reject actions', () => {
  withDocument(() => {
    const root = createElement('div');

    renderAgentApprovals(root, [
      {
        id: 'approval_1',
        taskId: 'task_1',
        riskLevel: 'high',
        command: 'git push origin main',
        reason: 'push requires approval',
        diffSummary: '+ public/agent-ui.js',
        status: 'pending'
      }
    ]);

    assert.equal(root.children.length, 1);
    const card = root.children[0];
    assert.equal(card.className, 'agent-approval-card');
    assert.equal(card.dataset.approvalId, 'approval_1');
    assert.equal(card.dataset.taskId, 'task_1');
    assert.equal(card.children[0].children[0].textContent, 'Approval required');
    assert.equal(card.children[0].children[1].textContent, 'high');
    assert.equal(card.children[1].textContent, 'git push origin main');
    assert.equal(card.children[2].textContent, 'push requires approval');
    assert.equal(card.children[3].textContent, '+ public/agent-ui.js');
    assert.equal(card.children[4].children[0].dataset.approvalAction, 'approved');
    assert.equal(card.children[4].children[1].dataset.approvalAction, 'rejected');
  });
});

test('renders output tail as preformatted text and empty state', () => {
  withDocument(() => {
    const root = createElement('div');

    renderAgentOutputTail(root, 'first line\nlast line');

    assert.equal(root.children.length, 1);
    assert.equal(root.children[0].tagName, 'PRE');
    assert.equal(root.children[0].className, 'agent-output-tail');
    assert.equal(root.children[0].textContent, 'first line\nlast line');

    renderAgentOutputTail(root, '');
    assert.equal(root.children[0].className, 'agent-empty-state');
    assert.equal(root.children[0].textContent, 'No output yet');
  });
});

test('renders delivery cards for pull request and ci status', () => {
  withDocument(() => {
    const root = createElement('div');

    renderAgentDelivery(root, {
      taskId: 'task_1',
      prUrl: 'https://example.test/pr/1',
      prNumber: 1,
      branch: 'agent/task-1',
      commitSha: 'abc123456789',
      ciStatus: 'passed',
      ciUrl: 'https://example.test/checks/1',
      previewUrl: 'https://preview.test',
      deploymentUrl: 'https://deploy.test',
      deploymentStatus: 'deployed',
      deliveryStatus: 'open',
      summary: 'Implemented UI slice'
    });

    assert.equal(root.children.length, 1);
    const card = root.children[0];
    assert.equal(card.className, 'agent-delivery-card');
    assert.equal(card.dataset.taskId, 'task_1');
    assert.equal(card.children[0].children[0].textContent, 'Delivery');
    assert.equal(card.children[0].children[1].textContent, 'passed');
    assert.equal(card.children[1].textContent, 'Implemented UI slice');
    assert.equal(card.children[2].textContent, '#1 · agent/task-1 · abc1234');
    assert.equal(card.children[3].textContent, 'open · deployed');
    assert.equal(card.children[4].children[0].getAttribute('href'), 'https://example.test/pr/1');
    assert.equal(card.children[4].children[1].getAttribute('href'), 'https://example.test/checks/1');
    assert.equal(card.children[4].children[2].getAttribute('href'), 'https://preview.test');
    assert.equal(card.children[4].children[3].getAttribute('href'), 'https://deploy.test');
  });
});

function withDocument(fn) {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement };
  try {
    fn();
  } finally {
    globalThis.document = originalDocument;
  }
}

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    children: [],
    dataset: {},
    attributes: {},
    append(...children) {
      this.children.push(...children);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name];
    }
  };
}
