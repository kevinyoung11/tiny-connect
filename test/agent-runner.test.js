import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('agent runner executes tasks through the selected ssh profile', async () => {
  const store = createMemoryAgentStore();
  const ssh = createFakeSshClient();
  const connections = [];
  const keyPath = join(mkdtempSync(join(tmpdir(), 'tiny-connect-agent-')), 'key.pem');
  writeFileSync(keyPath, 'PRIVATE KEY');
  const runner = createAgentRunner({
    store,
    sshClientFactory: () => ssh,
    profileStore: {
      async listProfiles() {
        return [{
          id: 'profile_1',
          host: 'dev.example.com',
          port: 2222,
          username: 'deploy',
          keyId: 'key_1',
          passphrase: 'secret'
        }];
      }
    },
    keyStore: {
      async getPrivateKeyPath(keyId, scope) {
        connections.push({ keyId, scope });
        return keyPath;
      }
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Remote',
    kind: 'shell',
    prompt: 'echo remote',
    status: 'queued',
    riskLevel: 'safe',
    metadata: { profileId: 'profile_1' }
  });

  const started = runner.startTask({ userId: 'user_1', task });
  await flushAsyncHandlers();
  assert.deepEqual(ssh.connectOptions, {
    host: 'dev.example.com',
    port: 2222,
    username: 'deploy',
    privateKey: Buffer.from('PRIVATE KEY'),
    passphrase: 'secret'
  });
  ssh.emit('ready');
  await flushAsyncHandlers();
  assert.equal(ssh.execCommand, "bash '-lc' 'echo remote'");
  ssh.execStream.emit('data', Buffer.from('remote\n'));
  ssh.execStream.stderr.emit('data', Buffer.from('warn\n'));
  ssh.execStream.emit('close', 0);
  await started;

  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.status, 'completed');
  assert.equal(updated.outputTail, 'remote\nwarn\n');
  assert.equal(updated.runnerCommand, 'ssh:dev.example.com');
  assert.equal(ssh.ended, true);
  assert.deepEqual(connections, [{ keyId: 'key_1', scope: { userId: 'user_1' } }]);
});

test('agent runner starts selected ssh codex tasks inside a remote tmux session', async () => {
  const store = createMemoryAgentStore();
  const createdClients = [];
  const runner = createAgentRunner({
    store,
    sshClientFactory: () => {
      const client = createFakeSshClient();
      createdClients.push(client);
      return client;
    },
    profileStore: createProfileStore([{
      id: 'profile_1',
      host: 'dev.example.com',
      port: 22,
      username: 'deploy'
    }]),
    keyStore: createKeyStore()
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'hello',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-remote',
    metadata: { profileId: 'profile_1' }
  });

  const started = runner.startTask({ userId: 'user_1', task });
  await flushAsyncHandlers();
  createdClients[0].emit('ready');
  await flushAsyncHandlers();
  createdClients[0].execStream.emit('close', 0);
  await flushAsyncHandlers();
  createdClients[1].emit('ready');
  await flushAsyncHandlers();
  createdClients[1].execStream.emit('close', 0);
  await flushAsyncHandlers();
  createdClients[2].emit('ready');
  await flushAsyncHandlers();
  createdClients[2].execStream.emit('data', Buffer.from('Codex ready\n'));
  createdClients[2].execStream.emit('close', 0);
  await started;

  assert.equal(createdClients[0].execCommand, "tmux new-session -A -d -s 'tc-codex-remote' codex");
  assert.equal(createdClients[1].execCommand, "tmux send-keys -t 'tc-codex-remote' 'hello' Enter");
  assert.equal(createdClients[2].execCommand, "tmux capture-pane -p -t 'tc-codex-remote' -S '-2000'");
  const updated = await store.getTask({ userId: 'user_1', taskId: task.id });
  assert.equal(updated.status, 'running');
  assert.equal(updated.outputTail, 'Codex ready\n');
  assert.equal(updated.runnerCommand, 'ssh-tmux:dev.example.com:tc-codex-remote');
  assert.equal(updated.metadata.sshMode, 'tmux');
});

test('agent runner sends input and captures output for selected ssh tmux tasks', async () => {
  const store = createMemoryAgentStore();
  const createdClients = [];
  const runner = createAgentRunner({
    store,
    sshClientFactory: () => {
      const client = createFakeSshClient();
      createdClients.push(client);
      return client;
    },
    profileStore: createProfileStore([{
      id: 'profile_1',
      host: 'dev.example.com',
      port: 22,
      username: 'deploy'
    }]),
    keyStore: createKeyStore()
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'hello',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-remote',
    metadata: { profileId: 'profile_1', sshMode: 'tmux' }
  });

  const send = runner.sendInput({ userId: 'user_1', taskId: task.id, input: 'continue this task' });
  await flushAsyncHandlers();
  createdClients[0].emit('ready');
  await flushAsyncHandlers();
  createdClients[0].execStream.emit('close', 0);
  await send;

  const capture = runner.captureOutput({ userId: 'user_1', taskId: task.id });
  await flushAsyncHandlers();
  createdClients[1].emit('ready');
  await flushAsyncHandlers();
  createdClients[1].execStream.emit('data', Buffer.from('codex reply\n'));
  createdClients[1].execStream.emit('close', 0);
  const result = await capture;

  assert.equal(createdClients[0].execCommand, "tmux send-keys -t 'tc-codex-remote' 'continue this task' Enter");
  assert.equal(createdClients[1].execCommand, "tmux capture-pane -p -t 'tc-codex-remote' -S '-2000'");
  assert.equal(result.output, 'codex reply\n');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).outputTail, 'codex reply\n');
});

test('agent runner includes remote stderr when selected ssh tmux commands fail', async () => {
  const store = createMemoryAgentStore();
  const createdClients = [];
  const runner = createAgentRunner({
    store,
    sshClientFactory: () => {
      const client = createFakeSshClient();
      createdClients.push(client);
      return client;
    },
    profileStore: createProfileStore([{
      id: 'profile_1',
      host: 'dev.example.com',
      port: 22,
      username: 'deploy'
    }]),
    keyStore: createKeyStore()
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'hello',
    status: 'running',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-remote',
    metadata: { profileId: 'profile_1', sshMode: 'tmux' }
  });

  const send = assert.rejects(
    () => runner.sendInput({ userId: 'user_1', taskId: task.id, input: 'continue' }),
    /remote command exited 127: tmux: command not found/
  );
  await flushAsyncHandlers();
  createdClients[0].emit('ready');
  await flushAsyncHandlers();
  createdClients[0].execStream.stderr.emit('data', Buffer.from('tmux: command not found\n'));
  createdClients[0].execStream.emit('close', 127);
  await send;
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

test('agent runner tolerates missing tmux while cancelling tmux backed sessions', async () => {
  const store = createMemoryAgentStore();
  const taskChild = createFakeChild();
  const killChild = createFakeChild();
  const runner = createAgentRunner({
    store,
    spawnImpl() {
      return taskChild.started ? killChild : Object.assign(taskChild, { started: true });
    }
  });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Codex',
    kind: 'codex',
    prompt: 'start work',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-codex-cancel-missing-tmux'
  });

  await runner.startTask({ userId: 'user_1', task });
  const cancelled = await runner.cancelTask({ userId: 'user_1', taskId: task.id });
  killChild.emit('error', Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' }));
  await flushAsyncHandlers();

  assert.deepEqual(cancelled, { ok: true });
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

function createFakeSshClient() {
  const client = new EventEmitter();
  client.execStream = new EventEmitter();
  client.execStream.stderr = new EventEmitter();
  client.connect = (options) => {
    client.connectOptions = options;
  };
  client.exec = (command, callback) => {
    client.execCommand = command;
    callback(null, client.execStream);
  };
  client.end = () => {
    client.ended = true;
  };
  return client;
}

function createProfileStore(profiles) {
  return {
    async listProfiles() {
      return profiles;
    }
  };
}

function createKeyStore() {
  return {
    async getPrivateKeyPath() {
      return undefined;
    }
  };
}

async function flushAsyncHandlers() {
  await new Promise((resolve) => setImmediate(resolve));
}
