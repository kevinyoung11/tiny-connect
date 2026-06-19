import test from 'node:test';
import assert from 'node:assert/strict';
import { initAgentConsole } from '../public/agent-console.js';

test('agent console refreshes and reports errors when sending input fails', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  const calls = [];
  const toasts = [];
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/agent/snapshot') {
      return jsonResponse({
        tasks: [{
          id: 'task_1',
          title: 'Fix mobile scroll',
          kind: 'codex',
          status: calls.filter((call) => call.url === '/api/agent/snapshot').length === 1 ? 'running' : 'failed',
          riskLevel: 'safe',
          error: "can't find session: tc-codex"
        }],
        approvals: []
      });
    }
    if (url === '/api/profiles') {
      return jsonResponse({ profiles: [{ id: 'profile_1', name: 'Dev', host: 'dev.example.com', username: 'deploy' }] });
    }
    if (url === '/api/agent/tasks/task_1/input') {
      return jsonResponse({ error: "can't find session: tc-codex" }, { ok: false, status: 400 });
    }
    return jsonResponse({});
  };

  let consoleController = null;
  try {
    consoleController = initAgentConsole({
      withIdentity: (init = {}) => init,
      toast: (message, level) => toasts.push({ message, level })
    });
    dom.agentBtn.dispatch('click');
    await flushAsyncHandlers();
    dom.agentProfile.value = 'profile_1';
    dom.agentInput.value = 'continue';

    await dom.agentInputForm.dispatch('submit', { preventDefault() {} });

    assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
      ['/api/profiles', 'GET'],
      ['/api/agent/snapshot', 'GET'],
      ['/api/agent/tasks/task_1/input', 'POST'],
      ['/api/agent/snapshot', 'GET']
    ]);
    assert.equal(toasts[0].message, "can't find session: tc-codex");
    assert.equal(toasts[0].level, 'err');
    assert.equal(dom.agentInput.value, 'continue');
    assert.match(collectText(dom.agentTaskList), /failed/);
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

test('agent console refreshes and reports errors when resolving approval fails', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  const calls = [];
  const toasts = [];
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/agent/snapshot') {
      const snapshotCount = calls.filter((call) => call.url === '/api/agent/snapshot').length;
      return jsonResponse({
        tasks: [{
          id: 'task_1',
          title: 'Deploy safely',
          kind: 'codex',
          status: snapshotCount === 1 ? 'waiting_approval' : 'failed',
          riskLevel: 'high'
        }],
        approvals: snapshotCount === 1 ? [{
          id: 'approval_1',
          taskId: 'task_1',
          status: 'pending',
          riskLevel: 'high',
          command: 'git push origin main'
        }] : []
      });
    }
    if (url === '/api/profiles') {
      return jsonResponse({ profiles: [{ id: 'profile_1', name: 'Dev', host: 'dev.example.com', username: 'deploy' }] });
    }
    if (url === '/api/agent/approvals/approval_1/resolve') {
      return jsonResponse({ error: 'session not found: tc-codex' }, { ok: false, status: 404 });
    }
    return jsonResponse({});
  };

  let consoleController = null;
  try {
    consoleController = initAgentConsole({
      withIdentity: (init = {}) => init,
      toast: (message, level) => toasts.push({ message, level })
    });
    dom.agentBtn.dispatch('click');
    await flushAsyncHandlers();
    dom.agentProfile.value = 'profile_1';
    const approveButton = findElement(dom.agentApprovalList, (element) => element.dataset.approvalAction === 'approved');

    await dom.agentApprovalList.dispatch('click', { target: approveButton });

    assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
      ['/api/profiles', 'GET'],
      ['/api/agent/snapshot', 'GET'],
      ['/api/agent/approvals/approval_1/resolve', 'POST'],
      ['/api/agent/snapshot', 'GET']
    ]);
    assert.equal(toasts[0].message, 'session not found: tc-codex');
    assert.equal(toasts[0].level, 'err');
    assert.match(collectText(dom.agentTaskList), /failed/);
    assert.match(collectText(dom.agentApprovalList), /No pending approvals/);
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

test('agent console reports task creation errors and keeps the prompt draft', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  const calls = [];
  const toasts = [];
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/agent/snapshot') {
      return jsonResponse({ tasks: [], approvals: [] });
    }
    if (url === '/api/profiles') {
      return jsonResponse({ profiles: [{ id: 'profile_1', name: 'Dev', host: 'dev.example.com', username: 'deploy' }] });
    }
    if (url === '/api/agent/tasks') {
      return jsonResponse({ error: 'codex command not found' }, { ok: false, status: 400 });
    }
    return jsonResponse({});
  };

  let consoleController = null;
  try {
    consoleController = initAgentConsole({
      withIdentity: (init = {}) => init,
      toast: (message, level) => toasts.push({ message, level })
    });
    dom.agentBtn.dispatch('click');
    await flushAsyncHandlers();
    dom.agentProfile.value = 'profile_1';
    dom.agentPrompt.value = 'Fix mobile scroll';
    dom.agentModel.value = 'gpt-5-codex';
    dom.agentProjectPath.value = '/repo/tiny-connect';

    await dom.agentTaskForm.dispatch('submit', { preventDefault() {} });

    assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
      ['/api/profiles', 'GET'],
      ['/api/agent/snapshot', 'GET'],
      ['/api/agent/tasks', 'POST'],
      ['/api/agent/snapshot', 'GET']
    ]);
    assert.equal(toasts[0].message, 'codex command not found');
    assert.equal(toasts[0].level, 'err');
    assert.equal(dom.agentPrompt.value, 'Fix mobile scroll');
    assert.match(collectText(dom.agentTaskList), /No agent tasks yet/);
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

test('agent console reports validation errors instead of ignoring mobile taps', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  const toasts = [];
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url) => {
    if (url === '/api/agent/snapshot') return jsonResponse({ tasks: [], approvals: [] });
    if (url === '/api/profiles') return jsonResponse({ profiles: [] });
    return jsonResponse({});
  };

  let consoleController = null;
  try {
    consoleController = initAgentConsole({
      withIdentity: (init = {}) => init,
      toast: (message, level) => toasts.push({ message, level })
    });
    dom.agentBtn.dispatch('click');
    await flushAsyncHandlers();

    await dom.agentTaskForm.dispatch('submit', { preventDefault() {} });
    dom.agentProfile.value = 'profile_1';
    await dom.agentTaskForm.dispatch('submit', { preventDefault() {} });
    dom.agentInput.value = 'continue';
    await dom.agentInputForm.dispatch('submit', { preventDefault() {} });
    dom.agentInput.value = '';
    await dom.agentInputForm.dispatch('submit', { preventDefault() {} });

    assert.deepEqual(toasts, [
      { message: 'Select an SSH host first.', level: 'err' },
      { message: 'Task prompt is required.', level: 'err' },
      { message: 'Select a task before sending input.', level: 'err' },
      { message: 'Input is required.', level: 'err' }
    ]);
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

test('agent console shows busy state while starting and sending tasks', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  const calls = [];
  let resolveStart;
  let resolveSend;
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/agent/snapshot') {
      return jsonResponse({
        tasks: [{ id: 'task_1', title: 'Task', kind: 'codex', status: 'running' }],
        approvals: []
      });
    }
    if (url === '/api/profiles') {
      return jsonResponse({ profiles: [{ id: 'profile_1', name: 'Dev', host: 'dev.example.com', username: 'deploy' }] });
    }
    if (url === '/api/agent/tasks') {
      await new Promise((resolve) => { resolveStart = resolve; });
      return jsonResponse({ task: { id: 'task_1' } });
    }
    if (url === '/api/agent/tasks/task_1/input') {
      await new Promise((resolve) => { resolveSend = resolve; });
      return jsonResponse({ ok: true });
    }
    return jsonResponse({});
  };

  let consoleController = null;
  try {
    consoleController = initAgentConsole({ withIdentity: (init = {}) => init });
    dom.agentBtn.dispatch('click');
    await flushAsyncHandlers();
    dom.agentProfile.value = 'profile_1';
    dom.agentPrompt.value = 'Ship it';

    const startPromise = dom.agentTaskForm.dispatch('submit', { preventDefault() {} });
    await flushAsyncHandlers();
    assert.equal(dom.agentStartBtn.disabled, true);
    assert.equal(dom.agentStartBtn.textContent, 'Starting...');
    resolveStart();
    await startPromise;
    assert.equal(dom.agentStartBtn.disabled, false);
    assert.equal(dom.agentStartBtn.textContent, 'Start');

    dom.agentInput.value = 'continue';
    const sendPromise = dom.agentInputForm.dispatch('submit', { preventDefault() {} });
    await flushAsyncHandlers();
    assert.equal(dom.agentSendBtn.disabled, true);
    assert.equal(dom.agentSendBtn.textContent, 'Sending...');
    resolveSend();
    await sendPromise;
    assert.equal(dom.agentSendBtn.disabled, false);
    assert.equal(dom.agentSendBtn.textContent, 'Send');
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

test('agent console follows output only when viewer is already near the bottom', async () => {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalFetch = globalThis.fetch;
  const dom = createAgentConsoleDom();
  let snapshotCount = 0;
  globalThis.document = dom.document;
  globalThis.requestAnimationFrame = (fn) => fn();
  globalThis.fetch = async (url) => {
    if (url === '/api/agent/snapshot') {
      snapshotCount += 1;
      return jsonResponse({
        tasks: [{
          id: 'task_1',
          title: 'Follow output',
          kind: 'codex',
          status: 'running',
          riskLevel: 'safe',
          outputTail: snapshotCount === 1 ? 'first line' : 'first line\nsecond line'
        }],
        approvals: []
      });
    }
    return jsonResponse({});
  };
  dom.agentOutput.clientHeight = 100;
  dom.agentOutput.scrollHeight = 300;
  dom.agentOutput.scrollTop = 198;

  let consoleController = null;
  try {
    consoleController = initAgentConsole({ withIdentity: (init = {}) => init });
    await consoleController.refresh();

    assert.equal(dom.agentOutput.scrollTop, 200);

    dom.agentOutput.scrollTop = 40;
    dom.agentOutput.scrollHeight = 420;
    await consoleController.refresh();

    assert.equal(dom.agentOutput.scrollTop, 40);
  } finally {
    consoleController?.close();
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.fetch = originalFetch;
  }
});

function createAgentConsoleDom() {
  const byId = new Map();
  const elements = {
    agentBtn: createElement('button'),
    agentSheet: createElement('div'),
    closeAgentSheet: createElement('button'),
    agentTaskForm: createElement('form'),
    agentInputForm: createElement('form'),
    agentStartBtn: createElement('button'),
    agentSendBtn: createElement('button'),
    agentProfile: createElement('select'),
    agentKind: createElement('select'),
    agentModel: createElement('input'),
    agentProjectPath: createElement('input'),
    agentPrompt: createElement('input'),
    agentInput: createElement('input'),
    agentTaskList: createElement('div'),
    agentApprovalList: createElement('div'),
    agentOutput: createElement('div'),
    agentDelivery: createElement('div')
  };
  for (const [id, element] of Object.entries(elements)) {
    element.id = id;
    byId.set(`#${id}`, element);
  }
  elements.agentKind.value = 'codex';
  elements.agentBtn.dataset.agentOpen = '';
  elements.agentStartBtn.attributes.type = 'submit';
  elements.agentSendBtn.attributes.type = 'submit';
  elements.agentStartBtn.textContent = 'Start';
  elements.agentSendBtn.textContent = 'Send';
  elements.agentTaskForm.children.push(elements.agentStartBtn);
  elements.agentInputForm.children.push(elements.agentSendBtn);
  return {
    ...elements,
    document: {
      querySelectorAll(selector) {
        if (selector === '[data-agent-open]') return [elements.agentBtn];
        return [];
      },
      querySelector(selector) {
        return byId.get(selector) || null;
      },
      createElement
    }
  };
}

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    id: '',
    value: '',
    className: '',
    textContent: '',
    hidden: false,
    children: [],
    dataset: {},
    attributes: {},
    listeners: {},
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); }
    },
    append(...children) {
      this.children.push(...children);
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'hidden') this.hidden = true;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      if (name === 'hidden') this.hidden = false;
    },
    getAttribute(name) {
      return this.attributes[name];
    },
    querySelector(selector) {
      if (selector === 'button[type="submit"]') {
        return this.children.find((child) => child.tagName === 'BUTTON' && child.attributes.type === 'submit') || null;
      }
      return null;
    },
    addEventListener(type, handler) {
      this.listeners[type] ||= [];
      this.listeners[type].push(handler);
    },
    closest(selector) {
      if (selector === '[data-task-id]' && this.dataset.taskId) return this;
      if (selector === '[data-task-action]' && this.dataset.taskAction) return this;
      if (selector === '[data-approval-action]' && this.dataset.approvalAction) return this;
      return null;
    },
    async dispatch(type, event = {}) {
      for (const handler of this.listeners[type] || []) {
        await handler({ ...event, target: event.target || this });
      }
    }
  };
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body
  };
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}

function collectText(node) {
  return [
    node.textContent || '',
    ...(node.children || []).map(collectText)
  ].filter(Boolean).join(' ');
}

function findElement(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}
