import { spawn } from 'node:child_process';
import { buildRunnerCommand, buildTmuxRunnerCommand } from './agent-domain.js';

export function createAgentRunner({ store, spawnImpl = spawn } = {}) {
  if (!store) throw new Error('store is required');
  const processes = new Map();

  async function startTask({ userId, task }) {
    if (!userId) throw new Error('userId is required');
    if (!task?.id) throw new Error('task is required');
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
      const status = code === 0 ? 'completed' : 'failed';
      await store.updateTask({ userId, taskId: task.id, patch: { status, exitCode: code } });
      await store.logAudit?.({ userId, taskId: task.id, event: status === 'completed' ? 'task_completed' : 'task_failed', message: `exit ${code}` });
    });

    return { pid: child.pid || null };
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
    } else if (child?.stdin?.write) {
      child.stdin.write(text);
    } else {
      throw new Error('task input stream is unavailable');
    }

    await store.logAudit?.({ userId, taskId, event: 'input_sent', message: text.slice(0, 160) });
    return { ok: true };
  }

  async function cancelTask({ userId, taskId }) {
    const task = await store.getTask({ userId, taskId });
    const child = processes.get(taskId);
    if (isTmuxBacked(task)) {
      spawnImpl('tmux', ['kill-session', '-t', task.tmuxSession], { env: process.env });
    } else if (child) {
      child.kill('SIGTERM');
    }
    await store.updateTask({ userId, taskId, patch: { status: 'cancelled' } });
    await store.logAudit?.({ userId, taskId, event: 'task_cancelled', message: 'cancel requested' });
    return { ok: true };
  }

  return { startTask, sendInput, cancelTask };
}

function buildStartCommand(task) {
  if (isTmuxBacked(task)) return buildTmuxRunnerCommand(task);
  return buildRunnerCommand(task);
}

function isTmuxBacked(task) {
  return task.kind === 'codex' || task.kind === 'claude';
}
