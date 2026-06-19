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

test('agent runner starts codex tasks inside a persistent tmux session', async () => {
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
    title: 'Codex',
    kind: 'codex',
    prompt: 'fix mobile scroll',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-test',
    projectPath: '/repo'
  });

  await runner.startTask({ userId: 'user_1', task });

  assert.deepEqual(spawned, [{
    command: 'tmux',
    args: ['new-session', '-A', '-d', '-s', 'tc-codex-test', '-c', '/repo', "codex 'fix mobile scroll'"]
  }]);
  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.runnerCommand, 'tmux');
});

test('agent runner keeps tmux backed tasks running when detached launcher exits', async () => {
  const store = createMemoryAgentStore();
  const child = createFakeChild();
  const runner = createAgentRunner({ store, spawnImpl: () => child });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'fix mobile scroll',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-detached'
  });

  await runner.startTask({ userId: 'user_1', task });
  child.emit('exit', 0);
  await flushAsyncHandlers();

  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.status, 'running');
  assert.equal(updated.exitCode, undefined);
});

test('agent runner fails tmux backed tasks when detached launcher fails', async () => {
  const store = createMemoryAgentStore();
  const child = createFakeChild();
  const runner = createAgentRunner({ store, spawnImpl: () => child });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'fix mobile scroll',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-detached-fail'
  });

  await runner.startTask({ userId: 'user_1', task });
  child.stderr.emit('data', Buffer.from('open terminal failed\n'));
  child.emit('exit', 1);
  await flushAsyncHandlers();

  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.status, 'failed');
  assert.equal(updated.exitCode, 1);
  assert.equal(updated.outputTail, 'open terminal failed\n');
});

test('agent runner sends input to a running process stdin', async () => {
  const store = createMemoryAgentStore();
  const child = createFakeChild();
  const runner = createAgentRunner({ store, spawnImpl: () => child });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Shell',
    kind: 'shell',
    prompt: 'cat',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-input'
  });

  await runner.startTask({ userId: 'user_1', task });
  await runner.sendInput({ userId: 'user_1', taskId: task.id, input: 'continue\n' });

  assert.equal(child.stdin.writes.join(''), 'continue\n');
});

test('agent runner sends input to tmux backed codex sessions', async () => {
  const store = createMemoryAgentStore();
  const taskChild = createFakeChild();
  const sendChild = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return spawned.length === 1 ? taskChild : sendChild;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'start work',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-input'
  });

  await runner.startTask({ userId: 'user_1', task });
  const sendPromise = runner.sendInput({ userId: 'user_1', taskId: task.id, input: 'continue this task' });
  await flushAsyncHandlers();

  assert.deepEqual(spawned[1], {
    command: 'tmux',
    args: ['send-keys', '-t', 'tc-codex-input', 'continue this task', 'Enter']
  });
  sendChild.emit('exit', 0);
  await sendPromise;
});

test('agent runner waits for tmux send-keys to finish', async () => {
  const store = createMemoryAgentStore();
  const taskChild = createFakeChild();
  const sendChild = createFakeChild();
  const children = [taskChild, sendChild];
  const runner = createAgentRunner({
    store,
    spawnImpl() {
      return children.shift();
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'start work',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-input-wait'
  });

  await runner.startTask({ userId: 'user_1', task });
  const sent = runner.sendInput({ userId: 'user_1', taskId: task.id, input: 'continue this task' });
  let finished = false;
  sent.then(() => { finished = true; });
  await flushAsyncHandlers();
  assert.equal(finished, false);
  sendChild.emit('exit', 0);
  await sent;
  assert.equal(finished, true);
});

test('agent runner kills tmux backed sessions when cancelled', async () => {
  const store = createMemoryAgentStore();
  const taskChild = createFakeChild();
  const killChild = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return spawned.length === 1 ? taskChild : killChild;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'start work',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-cancel'
  });

  await runner.startTask({ userId: 'user_1', task });
  await runner.cancelTask({ userId: 'user_1', taskId: task.id });

  assert.deepEqual(spawned[1], {
    command: 'tmux',
    args: ['kill-session', '-t', 'tc-codex-cancel']
  });
  assert.equal(taskChild.killedWith, undefined);
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).status, 'cancelled');
});

test('agent runner captures tmux pane output after process map is gone', async () => {
  const store = createMemoryAgentStore();
  const captureChild = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return captureChild;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'continue work',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-replay'
  });

  const capturePromise = runner.captureOutput({ userId: 'user_1', taskId: task.id });
  await flushAsyncHandlers();
  captureChild.stdout.emit('data', Buffer.from('line one\nline two\n'));
  captureChild.emit('exit', 0);
  const result = await capturePromise;

  assert.deepEqual(spawned[0], {
    command: 'tmux',
    args: ['capture-pane', '-p', '-t', 'tc-codex-replay', '-S', '-2000']
  });
  assert.equal(result.output, 'line one\nline two\n');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).outputTail, 'line one\nline two\n');
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = {
    writes: [],
    write(value) {
      child.stdin.writes.push(value);
      return true;
    }
  };
  child.kill = (signal) => {
    child.killedWith = signal;
  };
  return child;
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}
