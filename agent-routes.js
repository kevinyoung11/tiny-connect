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
    router.post('/get_agent_output', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      await refreshTaskOutput({ store, runner, scope, taskId: req.body?.taskId });
      const task = await store.getTask({ ...scope, taskId: req.body?.taskId });
      res.json({ output: task.outputTail || '' });
    }));
    router.post('/list_pending_approvals', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json({ approvals: await store.listApprovals({ ...scope, status: 'pending' }) });
    }));
    router.post('/get_agent_approval', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json({ approval: await store.getApproval({ ...scope, approvalId: req.body?.approvalId }) });
    }));
    router.post('/resolve_approval', asyncHandler(async (req, res) => {
      const result = await resolveApprovalFlow({ req, store, runner, getScope, approvalId: req.body?.approvalId });
      res.json(result);
    }));
    router.post('/send_agent_input', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      await sendTaskInputFlow({ store, runner, scope, taskId: req.body?.taskId, input: req.body?.input || '' });
      res.json({ ok: true });
    }));
    router.post('/request_agent_approval', asyncHandler(async (req, res) => {
      const result = await requestTaskApprovalFlow({ req, store, getScope, taskId: req.body?.taskId });
      res.status(201).json(result);
    }));
    router.post('/get_agent_delivery', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      res.json({ delivery: await store.getDelivery({ ...scope, taskId: req.body?.taskId }) });
    }));
    router.post('/update_agent_delivery', asyncHandler(async (req, res) => {
      const scope = await getScope(req);
      const taskId = req.body?.taskId || req.body?.task_id;
      const delivery = await store.updateDelivery({ ...scope, taskId, patch: req.body || {} });
      res.json({ delivery });
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
    await sendTaskInputFlow({ store, runner, scope, taskId: req.params.id, input: req.body?.input || '' });
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

  router.get('/approvals/:id', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    res.json({ approval: await store.getApproval({ ...scope, approvalId: req.params.id }) });
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

  router.post('/delivery/webhook', asyncHandler(async (req, res) => {
    const scope = await getScope(req);
    const result = await deliveryWebhookFlow({ req, store, scope });
    res.json(result);
  }));

  return router;
}

async function deliveryWebhookFlow({ req, store, scope }) {
  const taskId = req.body?.taskId || req.body?.task_id;
  if (!taskId) throw new Error('taskId is required');
  const task = await store.getTask({ ...scope, taskId });
  const patch = mapDeliveryWebhook(req.body || {});
  const delivery = await store.updateDelivery({ ...scope, taskId: task.id, patch });
  await store.logAudit?.({ ...scope, taskId: task.id, event: 'delivery_updated', message: req.body?.event || 'delivery_webhook', meta: { patch } });
  return { delivery };
}

function mapDeliveryWebhook(payload) {
  if (payload.event === 'pull_request') {
    const pr = payload.pull_request || {};
    return {
      prUrl: pr.html_url || payload.prUrl || '',
      prNumber: pr.number || payload.prNumber || null,
      branch: pr.head?.ref || payload.branch || '',
      commitSha: pr.head?.sha || payload.commitSha || '',
      deliveryStatus: payload.action === 'closed' && pr.merged ? 'merged' : 'open',
      summary: `Pull request ${payload.action || 'updated'}`
    };
  }
  if (payload.event === 'check_suite' || payload.event === 'check_run') {
    const check = payload.check_suite || payload.check_run || {};
    return {
      ciStatus: mapCiStatus(check.conclusion || check.status),
      ciUrl: check.html_url || payload.ciUrl || '',
      summary: `CI ${check.conclusion || check.status || 'updated'}`
    };
  }
  if (payload.event === 'deployment_status') {
    const status = payload.deployment_status || {};
    return {
      deploymentStatus: mapDeploymentStatus(status.state),
      previewUrl: status.environment_url || payload.previewUrl || '',
      deploymentUrl: status.target_url || payload.deploymentUrl || '',
      summary: `Deployment ${status.state || 'updated'}`
    };
  }
  return {
    prUrl: payload.prUrl || payload.pr_url || '',
    ciStatus: payload.ciStatus || payload.ci_status || 'unknown',
    deploymentStatus: payload.deploymentStatus || payload.deployment_status || 'none',
    summary: payload.summary || 'Delivery updated'
  };
}

function mapCiStatus(value) {
  if (value === 'success') return 'passed';
  if (value === 'failure' || value === 'timed_out' || value === 'cancelled') return 'failed';
  if (value === 'queued' || value === 'in_progress' || value === 'requested') return 'pending';
  return value || 'unknown';
}

function mapDeploymentStatus(value) {
  if (value === 'success') return 'deployed';
  if (value === 'failure' || value === 'error') return 'failed';
  if (value === 'in_progress' || value === 'queued' || value === 'pending') return 'pending';
  return value || 'none';
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
    await startTaskOrMarkFailed({ store, runner, scope, task });
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
      await sendTaskInputFlow({ store, runner, scope, taskId: task.id, input: approval.command });
      await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'running' } });
    } else {
      await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'queued' } });
      await startTaskOrMarkFailed({ store, runner, scope, task: await store.getTask({ ...scope, taskId: task.id }) });
    }
  } else {
    await store.updateTask({ ...scope, taskId: task.id, patch: { status: approval.metadata?.mode === 'command' ? 'running' : 'cancelled' } });
  }
  await store.logAudit?.({ ...scope, taskId: task.id, event: `approval_${status}`, message: approval.command });
  return { approval, task: await store.getTask({ ...scope, taskId: task.id }) };
}

async function startTaskOrMarkFailed({ store, runner, scope, task }) {
  try {
    await runner.startTask({ ...scope, task });
  } catch (error) {
    await markTaskFailed({ store, scope, taskId: task.id, message: error.message });
    throw error;
  }
}

async function sendTaskInputFlow({ store, runner, scope, taskId, input }) {
  try {
    await runner.sendInput({ ...scope, taskId, input });
  } catch (error) {
    if (isMissingTmuxSessionError(error)) {
      await markTaskFailed({ store, scope, taskId, message: error.message });
    }
    throw error;
  }
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
  let task = await store.getTask({ ...scope, taskId });
  if (task.status === 'running' && typeof runner.refreshTaskStatus === 'function') {
    task = await runner.refreshTaskStatus({ ...scope, taskId: task.id }) || await store.getTask({ ...scope, taskId: task.id });
  }
  if (task.status !== 'running' || (task.kind !== 'codex' && task.kind !== 'claude') || typeof runner.captureOutput !== 'function') {
    return task;
  }
  try {
    await runner.captureOutput({ ...scope, taskId });
    return await store.getTask({ ...scope, taskId });
  } catch (error) {
    if (isMissingTmuxSessionError(error)) {
      await markTaskFailed({ store, scope, taskId: task.id, message: error.message });
      return await store.getTask({ ...scope, taskId });
    }
    return task;
  }
}

async function markTaskFailed({ store, scope, taskId, message }) {
  const task = await store.getTask({ ...scope, taskId });
  await store.updateTask({ ...scope, taskId: task.id, patch: { status: 'failed', error: message } });
  await store.logAudit?.({ ...scope, taskId: task.id, event: 'task_failed', message });
}

function isMissingTmuxSessionError(error) {
  return /can't find session|no such session|session not found/i.test(error?.message || '');
}

function asyncHandler(fn) {
  return (req, res) => {
    Promise.resolve(fn(req, res)).catch((error) => {
      const status = /not found/i.test(error.message) ? 404 : 400;
      res.status(status).json({ error: error.message });
    });
  };
}
