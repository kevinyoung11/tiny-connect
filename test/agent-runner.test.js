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
    args: ['new-session', '-A', '-d', '-s', 'tc-codex-test', '-c', '/repo', "sh -lc 'codex '\\''fix mobile scroll'\\''; code=$?; printf '\\''\\n__tiny_connect_exit:%s__\\n'\\'' \"$code\"; exit \"$code\"'"]
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

test('agent runner keeps tmux backed tasks running while session exists', async () => {
  const store = createMemoryAgentStore();
  const statusChild = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return statusChild;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'continue work',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-live'
  });

  const refresh = runner.refreshTaskStatus({ userId: 'user_1', taskId: task.id });
  await flushAsyncHandlers();
  statusChild.emit('exit', 0);
  const refreshed = await refresh;

  assert.deepEqual(spawned[0], {
    command: 'tmux',
    args: ['has-session', '-t', 'tc-codex-live']
  });
  assert.equal(refreshed.status, 'running');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).status, 'running');
});

test('agent runner marks tmux backed tasks completed from captured exit sentinel', async () => {
  const store = createMemoryAgentStore();
  const statusChild = createFakeChild();
  const captureChild = createFakeChild();
  const spawned = [];
  const runner = createAgentRunner({
    store,
    spawnImpl(command, args) {
      spawned.push({ command, args });
      return spawned.length === 1 ? statusChild : captureChild;
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'continue work',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-done'
  });

  const refresh = runner.refreshTaskStatus({ userId: 'user_1', taskId: task.id });
  await flushAsyncHandlers();
  statusChild.stderr.emit('data', Buffer.from("can't find session: tc-codex-done\n"));
  statusChild.emit('exit', 1);
  await flushAsyncHandlers();
  captureChild.stdout.emit('data', Buffer.from('finished work\n__tiny_connect_exit:0__\n'));
  captureChild.emit('exit', 0);
  const refreshed = await refresh;

  assert.deepEqual(spawned.map((item) => item.args[0]), ['has-session', 'capture-pane']);
  assert.equal(refreshed.status, 'completed');
  assert.equal(refreshed.exitCode, 0);
  assert.equal(refreshed.outputTail, 'finished work');
});

test('agent runner marks tmux backed tasks failed from captured exit sentinel', async () => {
  const store = createMemoryAgentStore();
  const statusChild = createFakeChild();
  const captureChild = createFakeChild();
  const children = [statusChild, captureChild];
  const runner = createAgentRunner({
    store,
    spawnImpl() {
      return children.shift();
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Claude',
    kind: 'claude',
    prompt: 'continue work',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-claude-failed'
  });

  const refresh = runner.refreshTaskStatus({ userId: 'user_1', taskId: task.id });
  await flushAsyncHandlers();
  statusChild.emit('exit', 1);
  await flushAsyncHandlers();
  captureChild.stdout.emit('data', Buffer.from('failed work\n__tiny_connect_exit:2__\n'));
  captureChild.emit('exit', 0);
  const refreshed = await refresh;

  assert.equal(refreshed.status, 'failed');
  assert.equal(refreshed.exitCode, 2);
  assert.equal(refreshed.outputTail, 'failed work');
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
