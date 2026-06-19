import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Client } from 'ssh2';
import { buildRunnerCommand, buildTmuxRunnerCommand } from './agent-domain.js';

export function createAgentRunner({ store, spawnImpl = spawn, sshClientFactory = () => new Client(), profileStore, keyStore } = {}) {
  if (!store) throw new Error('store is required');
  const processes = new Map();

  async function startTask({ userId, task }) {
    if (!userId) throw new Error('userId is required');
    if (!task?.id) throw new Error('task is required');
    if (task.metadata?.profileId) {
      return startSshTask({ userId, task });
    }
    const commandSpec = buildStartCommand(task);
    await store.updateTask({ userId, taskId: task.id, patch: { status: 'running', runnerCommand: commandSpec.command } });
    await store.logAudit?.({ userId, taskId: task.id, event: 'runner_started', message: commandSpec.command });

    const child = spawnImpl(commandSpec.command, commandSpec.args, {
      cwd: task.projectPath || undefined,
      env: process.env
    });
    processes.set(task.id, child);

    const append = (chunk) => {
      store.appendOutput({ userId, taskId: task.id, chunk: chunk.toString('utf8') }).catch(() => {});
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', async (error) => {
      processes.delete(task.id);
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'failed', error: error.message } });
      await store.logAudit?.({ userId, taskId: task.id, event: 'task_failed', message: error.message });
    });
    child.on('exit', async (code) => {
      processes.delete(task.id);
      const latest = await store.getTask({ userId, taskId: task.id });
      if (latest.status === 'cancelled') {
        await store.logAudit?.({ userId, taskId: task.id, event: 'task_cancelled', message: `exit ${code}` });
        return;
      }
      if (isTmuxBacked(task) && code === 0) {
        await store.logAudit?.({ userId, taskId: task.id, event: 'tmux_session_started', message: task.tmuxSession || '' });
        return;
      }
      const status = code === 0 ? 'completed' : 'failed';
      await store.updateTask({ userId, taskId: task.id, patch: { status, exitCode: code } });
      await store.logAudit?.({ userId, taskId: task.id, event: status === 'completed' ? 'task_completed' : 'task_failed', message: `exit ${code}` });
    });

    return { pid: child.pid || null };
  }

  async function startSshTask({ userId, task }) {
    if (!profileStore) throw new Error('profileStore is required for SSH agent tasks');
    if (!keyStore) throw new Error('keyStore is required for SSH agent tasks');
    const profile = await getProfile({ userId, profileId: task.metadata.profileId });
    const privateKeyPath = profile.keyId
      ? await keyStore.getPrivateKeyPath(profile.keyId, { userId })
      : undefined;
    const privateKey = privateKeyPath ? fs.readFileSync(privateKeyPath) : undefined;
    const commandLine = buildRemoteCommandLine(task);
    await store.updateTask({
      userId,
      taskId: task.id,
      patch: {
        status: 'running',
        runnerCommand: `ssh:${profile.host}`,
        metadata: { ...(task.metadata || {}), sshHost: profile.host, sshUsername: profile.username }
      }
    });
    await store.logAudit?.({ userId, taskId: task.id, event: 'runner_started', message: `ssh:${profile.host}` });
    try {
      await runSshExec({
        profile,
        privateKey,
        commandLine,
        onOutput: (chunk) => store.appendOutput({ userId, taskId: task.id, chunk: chunk.toString('utf8') })
      });
      const latest = await store.getTask({ userId, taskId: task.id });
      if (latest.status !== 'cancelled') {
        await store.updateTask({ userId, taskId: task.id, patch: { status: 'completed', exitCode: 0 } });
        await store.logAudit?.({ userId, taskId: task.id, event: 'task_completed', message: 'ssh command completed' });
      }
    } catch (error) {
      await store.updateTask({ userId, taskId: task.id, patch: { status: 'failed', error: error.message } });
      await store.logAudit?.({ userId, taskId: task.id, event: 'task_failed', message: error.message });
      throw error;
    }
    return { pid: null };
  }

  async function getProfile({ userId, profileId }) {
    const profiles = await profileStore.listProfiles({ userId });
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) throw new Error('SSH profile not found');
    return profile;
  }

  function runSshExec({ profile, privateKey, commandLine, onOutput }) {
    return new Promise((resolve, reject) => {
      const client = sshClientFactory();
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        try { client.end(); } catch (_) {}
        error ? reject(error) : resolve();
      };
      client.on('ready', () => {
        client.exec(commandLine, (error, stream) => {
          if (error) {
            finish(error);
            return;
          }
          stream.on('data', (chunk) => onOutput(chunk).catch(() => {}));
          stream.stderr?.on('data', (chunk) => onOutput(chunk).catch(() => {}));
          stream.on('close', (code) => {
            if (code === 0) finish();
            else finish(new Error(`remote command exited ${code}`));
          });
        });
      });
      client.on('error', finish);
      client.connect({
        host: profile.host,
        port: Number(profile.port) || 22,
        username: profile.username,
        privateKey,
        passphrase: profile.passphrase || undefined
      });
    });
  }

  async function sendInput({ userId, taskId, input }) {
    if (!userId) throw new Error('userId is required');
    const task = await store.getTask({ userId, taskId });
    const child = processes.get(taskId);
    const text = String(input || '');
    if (!text) return { ok: true };

    if (isTmuxBacked(task)) {
      const send = spawnImpl('tmux', ['send-keys', '-t', task.tmuxSession, text, 'Enter'], { env: process.env });
      processes.set(`${taskId}:input:${Date.now()}`, send);
      await waitForChildExit(send, 'tmux send-keys');
    } else if (child?.stdin?.write) {
      child.stdin.write(text);
    } else {
      throw new Error('task input stream is unavailable');
    }

    await store.logAudit?.({ userId, taskId, event: 'input_sent', message: text.slice(0, 160) });
    return { ok: true };
  }

  async function captureOutput({ userId, taskId, lines = 2000 }) {
    if (!userId) throw new Error('userId is required');
    const task = await store.getTask({ userId, taskId });
    if (!isTmuxBacked(task)) return { output: task.outputTail || '' };

    const output = await captureTmuxPane(task.tmuxSession, lines);
    await replaceOutput({ userId, taskId, output });
    await store.logAudit?.({ userId, taskId, event: 'output_captured', message: task.tmuxSession });
    return { output };
  }

  async function refreshTaskStatus({ userId, taskId }) {
    if (!userId) throw new Error('userId is required');
    const task = await store.getTask({ userId, taskId });
    if (!isTmuxBacked(task) || task.status !== 'running') return task;
    if (await tmuxHasSession(task.tmuxSession)) return task;
    const output = await captureTmuxPane(task.tmuxSession, 2000);
    const exitCode = parseExitSentinel(output);
    if (exitCode === null) return task;
    const outputTail = stripExitSentinel(output);
    await replaceOutput({ userId, taskId, output: outputTail });
    const status = exitCode === 0 ? 'completed' : 'failed';
    await store.updateTask({ userId, taskId, patch: { status, exitCode } });
    await store.logAudit?.({ userId, taskId, event: status === 'completed' ? 'task_completed' : 'task_failed', message: `exit ${exitCode}` });
    return await store.getTask({ userId, taskId });
  }

  async function cancelTask({ userId, taskId }) {
    const task = await store.getTask({ userId, taskId });
    const child = processes.get(taskId);
    if (isTmuxBacked(task)) {
      const kill = spawnImpl('tmux', ['kill-session', '-t', task.tmuxSession], { env: process.env });
      kill.on('error', (error) => {
        store.logAudit?.({ userId, taskId, event: 'tmux_cancel_failed', message: error.message }).catch(() => {});
      });
    } else if (child) {
      child.kill('SIGTERM');
    }
    await store.updateTask({ userId, taskId, patch: { status: 'cancelled' } });
    await store.logAudit?.({ userId, taskId, event: 'task_cancelled', message: 'cancel requested' });
    return { ok: true };
  }

  function waitForChildExit(child, label) {
    return new Promise((resolve, reject) => {
      let errorOutput = '';
      child.stderr?.on('data', (chunk) => { errorOutput += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(errorOutput || `${label} exited ${code}`));
      });
    });
  }

  function captureTmuxPane(tmuxSession, lines) {
    return new Promise((resolve, reject) => {
      const child = spawnImpl('tmux', ['capture-pane', '-p', '-t', tmuxSession, '-S', `-${Number(lines) || 2000}`], { env: process.env });
      let output = '';
      let errorOutput = '';
      child.stdout?.on('data', (chunk) => { output += chunk.toString('utf8'); });
      child.stderr?.on('data', (chunk) => { errorOutput += chunk.toString('utf8'); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(errorOutput || `tmux capture-pane exited ${code}`));
      });
    });
  }

  function tmuxHasSession(tmuxSession) {
    return new Promise((resolve) => {
      const child = spawnImpl('tmux', ['has-session', '-t', tmuxSession], { env: process.env });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => {
        resolve(code === 0);
      });
    });
  }

  async function replaceOutput({ userId, taskId, output }) {
    if (typeof store.replaceOutput === 'function') {
      return store.replaceOutput({ userId, taskId, output });
    }
    const latest = await store.getTask({ userId, taskId });
    const previous = latest.outputTail || '';
    await store.updateTask({ userId, taskId, patch: { outputTail: '' } });
    await store.appendOutput({ userId, taskId, chunk: output || previous });
  }

  return { startTask, sendInput, captureOutput, refreshTaskStatus, cancelTask };
}

function parseExitSentinel(output) {
  const match = String(output || '').match(/__tiny_connect_exit:(\d+)__/);
  return match ? Number(match[1]) : null;
}

function stripExitSentinel(output) {
  return String(output || '').replace(/\n?__tiny_connect_exit:\d+__\n?/g, '');
}

function buildStartCommand(task) {
  if (isTmuxBacked(task)) return buildTmuxRunnerCommand(task);
  return buildRunnerCommand(task);
}

function isTmuxBacked(task) {
  return task.kind === 'codex' || task.kind === 'claude';
}

function buildRemoteCommandLine(task) {
  const spec = buildRunnerCommand(task);
  return [spec.command, ...spec.args.map(shellQuote)].join(' ');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
