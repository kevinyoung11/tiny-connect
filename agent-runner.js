import { spawn } from 'node:child_process';
import { buildRunnerCommand } from './agent-domain.js';

export function createAgentRunner({ store, spawnImpl = spawn } = {}) {
  if (!store) throw new Error('store is required');
  const processes = new Map();

  async function startTask({ userId, task }) {
    if (!userId) throw new Error('userId is required');
    if (!task?.id) throw new Error('task is required');
    const commandSpec = buildRunnerCommand(task);
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

  async function cancelTask({ userId, taskId }) {
    const child = processes.get(taskId);
    if (child) child.kill('SIGTERM');
    await store.updateTask({ userId, taskId, patch: { status: 'cancelled' } });
    await store.logAudit?.({ userId, taskId, event: 'task_cancelled', message: 'cancel requested' });
    return { ok: true };
  }

  return { startTask, cancelTask };
}
