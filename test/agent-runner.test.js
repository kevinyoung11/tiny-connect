import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMemoryAgentStore } from '../agent-store.js';
import { createAgentRunner } from '../agent-runner.js';

test('agent runner starts a task and records successful output', async () => {
  const store = createMemoryAgentStore();
  const child = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return child;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Echo',
    kind: 'shell',
    prompt: 'echo ok',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-1'
  });

  await runner.startTask({ userId: 'user_1', task });
  child.stdout.emit('data', Buffer.from('ok\n'));
  child.emit('exit', 0);
  await flushAsyncHandlers();

  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.deepEqual(spawned, [{ command: 'bash', args: ['-lc', 'echo ok'] }]);
  assert.equal(updated.status, 'completed');
  assert.equal(updated.outputTail, 'ok\n');
});

test('agent runner keeps cancelled status when killed task exits later', async () => {
  const store = createMemoryAgentStore();
  const child = createFakeChild();
  const runner = createAgentRunner({ store, spawnImpl: () => child });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Fail',
    kind: 'shell',
    prompt: 'exit 1',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-2'
  });

  await runner.startTask({ userId: 'user_1', task });
  await runner.cancelTask({ userId: 'user_1', taskId: task.id });
  assert.equal(child.killedWith, 'SIGTERM');

  child.stderr.emit('data', Buffer.from('bad\n'));
  child.emit('exit', 1);
  await flushAsyncHandlers();

  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.status, 'cancelled');
  assert.equal(updated.outputTail, 'bad\n');
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    child.killedWith = signal;
  };
  return child;
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}
