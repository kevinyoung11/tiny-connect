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
    dom.agentInput.value = 'continue';

    await dom.agentInputForm.dispatch('submit', { preventDefault() {} });

    assert.deepEqual(calls.map((call) => [call.url, call.init.method || 'GET']), [
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

function createAgentConsoleDom() {
  const byId = new Map();
  const elements = {
    agentBtn: createElement('button'),
    agentSheet: createElement('div'),
    closeAgentSheet: createElement('button'),
    agentTaskForm: createElement('form'),
    agentInputForm: createElement('form'),
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
  return {
    ...elements,
    document: {
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
        await handler({ target: this, ...event });
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
