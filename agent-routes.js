import express from 'express';
import { classifyRisk, normalizeTaskInput, requiresApproval, sanitizeTmuxName } from './agent-domain.js';

export function createAgentRouter({ store, runner, getScope, mcpOnly = false } = {}) {
  if (!store) throw new Error('store is required');
  if (!runner) throw new Error('runner is required');
  if (typeof getScope !== 'function') throw new Error('getScope is required');
  const router = express.Router();

  if (mcpOnly) {
    router.post('/create_agent_task', asyncHandler(async (req, res) => {
      const result = await createTaskFlow({ req, store, runner, getScope });
      res.status(201).json(result);
    }));
    router.post('/list_agent_tasks', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json({ tasks: await store.listTasks(scope) });
    }));
    router.post('/get_agent_task', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json(await taskDetail({ store, runner, scope, taskId: req.body?.taskId }));
    }));
    router.post('/list_pending_approvals', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json({ approvals: await store.listApprovals({ ...scope, status: 'pending' }) });
    }));
    router.post('/resolve_approval', asyncHandler(async (req, res) => {
      const result = await resolveApprovalFlow({ req, store, runner, getScope, approvalId: req.body?.approvalId });
      res.json(result);
    }));
    router.post('/send_agent_input', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      await runner.sendInput({ ...scope, taskId: req.body?.taskId, input: req.body?.input || '' });
      res.json({ ok: true });
    }));
    router.post('/request_agent_approval', asyncHandler(async (req, res) => {
      const result = await requestTaskApprovalFlow({ req, store, getScope, taskId: req.body?.taskId });
      res.status(201).json(result);
    }));
    return router;
  }

  router.get('/tasks', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    res.json({ tasks: await store.listTasks(scope) });
  }));

  router.get('/snapshot', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    const tasks = await tasksWithDelivery({ store, runner, scope });
    const approvals = await store.listApprovals({ ...scope, status: 'pending' });
    res.json({ tasks, approvals });
  }));

  router.post('/tasks', asyncHandler(async (req, res) => {
    const result = await createTaskFlow({ req, store, runner, getScope });
    res.status(201).json(result);
  }));

  router.get('/tasks/:id', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    res.json(await taskDetail({ store, runner, scope, taskId: req.params.id }));
  }));

  router.get('/tasks/:id/output', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    await refreshTaskOutput({ store, runner, scope, taskId: req.params.id });
    const task = await store.getTask({ ...scope, taskId: req.params.id });
    res.json({ output: task.outputTail || '' });
  }));

  router.post('/tasks/:id/input', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    await runner.sendInput({ ...scope, taskId: req.params.id, input: req.body?.input || '' });
    res.json({ ok: true });
  }));

  router.post('/tasks/:id/approval-requests', asyncHandler(async (req, res) => {
    const result = await requestTaskApprovalFlow({ req, store, getScope, taskId: req.params.id });
    res.status(201).json(result);
  }));

  router.post('/tasks/:id/cancel', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    await runner.cancelTask({ ...scope, taskId: req.params.id });
    res.json({ ok: true });
  }));

  router.get('/approvals', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    res.json({ approvals: await store.listApprovals({ ...scope, status: req.query.status || 'pending' }) });
  }));

  router.post('/approvals/:id/resolve', asyncHandler(async (req, res) => {
    const result = await resolveApprovalFlow({ req, store, runner, getScope, approvalId: req.params.id });
    res.json(result);
  }));

  router.get('/tasks/:id/delivery', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    res.json({ delivery: await store.getDelivery({ ...scope, taskId: req.params.id }) });
  }));

  router.post('/tasks/:id/delivery', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    const delivery = await store.updateDelivery({ ...scope, taskId: req.params.id, patch: req.body || {} });
    res.json({ delivery });
  }));

  return router;
}

async function requestTaskApprovalFlow({ req, store, getScope, taskId }) {
  const scope = await getScope(req);
  const task = await store.getTask({ ...scope, taskId });
  const command = String(req.body?.command || '').trim();
  if (!command) throw new Error('command is required');
  const riskLevel = classifyRisk(command);
  const approval = await store.createApproval({
    ...scope,
    taskId: task.id,
    riskLevel,
    command,
    reason: req.body?.reason || `${riskLevel} risk command requires mobile approval`,
    diffSummary: req.body?.diffSummary || '',
    metadata: { mode: 'command' }
  });
  await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'waiting_approval' } });
  await store.logAudit?.({ ...scope, taskId: task.id, event: 'approval_requested', message: command, meta: { mode: 'command' } });
  return { approval, task: await store.getTask({ ...scope, taskId: task.id }) };
}

async function createTaskFlow({ req, store, runner, getScope }) {
  const scope = await getScope(req);
  const input = normalizeTaskInput(req.body || {});
  const riskLevel = classifyRisk(`${input.prompt} ${req.body?.command || ''}`);
  const status = requiresApproval(riskLevel) ? 'waiting_approval' : 'queued';
  const task = await store.createTask({
    ...scope,
    ...input,
    status,
    riskLevel,
    tmuxSession: `tc-${input.kind}-${sanitizeTmuxName(Date.now().toString(36))}`
  });
  await store.logAudit?.({ ...scope, taskId: task.id, event: 'task_created', message: input.title });

  let approval = null;
  if (requiresApproval(riskLevel)) {
    approval = await store.createApproval({
      ...scope,
      taskId: task.id,
      riskLevel,
      command: input.prompt,
      reason: `${riskLevel} risk requires mobile approval`,
      diffSummary: req.body?.diffSummary || ''
    });
    await store.logAudit?.({ ...scope, taskId: task.id, event: 'approval_requested', message: approval.reason });
  } else {
    await runner.startTask({ ...scope, task });
  }

  return { task: await store.getTask({ ...scope, taskId: task.id }), approval };
}

async function resolveApprovalFlow({ req, store, runner, getScope, approvalId }) {
  const scope = await getScope(req);
  const status = req.body?.status === 'rejected' ? 'rejected' : 'approved';
  const approval = await store.resolveApproval({ ...scope, approvalId, status });
  const task = await store.getTask({ ...scope, taskId: approval.taskId });
  if (status === 'approved') {
    if (approval.metadata?.mode === 'command') {
      await runner.sendInput({ ...scope, taskId: task.id, input: approval.command });
      await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'running' } });
    } else {
      await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'queued' } });
      await runner.startTask({ ...scope, task: await store.getTask({ ...scope, taskId: task.id }) });
    }
  } else {
    await store.updateTask({ ...scope, taskId: task.id, patch: { status: approval.metadata?.mode === 'command' ? 'running' : 'cancelled' } });
  }
  await store.logAudit?.({ ...scope, taskId: task.id, event: `approval_${status}`, message: approval.command });
  return { approval, task: await store.getTask({ ...scope, taskId: task.id }) };
}

async function taskDetail({ store, runner, scope, taskId }) {
  await refreshTaskOutput({ store, runner, scope, taskId });
  const task = await store.getTask({ ...scope, taskId });
  const approvals = await store.listApprovals({ ...scope });
  const approval = approvals.find((item) => item.taskId === task.id && item.status === 'pending') || null;
  const delivery = await store.getDelivery({ ...scope, taskId: task.id });
  return { task, approval, delivery };
}

async function tasksWithDelivery({ store, runner, scope }) {
  const tasks = await store.listTasks(scope);
  return Promise.all(tasks.map(async (task) => {
    const refreshed = await refreshTaskOutput({ store, runner, scope, taskId: task.id });
    return {
      ...refreshed,
      delivery: await store.getDelivery({ ...scope, taskId: task.id })
    };
  }));
}

async function refreshTaskOutput({ store, runner, scope, taskId }) {
  const task = await store.getTask({ ...scope, taskId });
  if (task.status !== 'running' || (task.kind !== 'codex' && task.kind !== 'claude') || typeof runner.captureOutput !== 'function') {
    return task;
  }
  try {
    await runner.captureOutput({ ...scope, taskId });
    return await store.getTask({ ...scope, taskId });
  } catch {
    return task;
  }
}

function asyncHandler(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    });
  };
}
