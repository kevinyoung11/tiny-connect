import { randomUUID } from 'node:crypto';
import { appendOutput, createRingBuffer } from './agent-domain.js';

export function createMemoryAgentStore({ outputMaxChars = 12000 } = {}) {
  const tasks = new Map();
  const approvals = new Map();
  const deliveries = new Map();
  const auditLogs = [];
  let sequence = 0;

  const now = () => new Date().toISOString();

  function assertUserId(userId) {
    if (!userId) throw new Error('userId is required');
  }

  function clone(value) {
    return value ? structuredClone(value) : value;
  }

  async function getTask({ userId, taskId }) {
    assertUserId(userId);
    const task = tasks.get(taskId);
    if (!task || task.userId !== userId) throw new Error('task not found');
    return clone(task);
  }

  return {
    async createTask(input) {
      assertUserId(input.userId);
      const timestamp = now();
      const task = {
        id: input.id || `task_${randomUUID()}`,
        userId: input.userId,
        title: input.title,
        kind: input.kind,
        prompt: input.prompt,
        status: input.status || 'queued',
        riskLevel: input.riskLevel || 'safe',
        tmuxSession: input.tmuxSession || '',
        model: input.model || '',
        projectPath: input.projectPath || '',
        metadata: input.metadata || {},
        outputTail: input.outputTail || '',
        createdAt: timestamp,
        updatedAt: timestamp,
        sequence: ++sequence
      };
      task.outputRing = createRingBuffer(outputMaxChars);
      task.outputRing.text = task.outputTail;
      tasks.set(task.id, task);
      deliveries.set(task.id, {
        taskId: task.id,
        userId: task.userId,
        prUrl: '',
        ciStatus: 'unknown',
        deploymentStatus: 'none',
        summary: '',
        updatedAt: timestamp
      });
      return clone(task);
    },

    async listTasks({ userId }) {
      assertUserId(userId);
      return [...tasks.values()]
        .filter((task) => task.userId === userId)
        .sort((a, b) => b.sequence - a.sequence)
        .map(clone);
    },

    getTask,

    async updateTask({ userId, taskId, patch }) {
      const task = await getTask({ userId, taskId });
      const original = tasks.get(taskId);
      Object.assign(original, patch || {}, { updatedAt: now() });
      return clone(original);
    },

    async appendOutput({ userId, taskId, chunk }) {
      await getTask({ userId, taskId });
      const task = tasks.get(taskId);
      task.outputTail = appendOutput(task.outputRing, chunk);
      task.updatedAt = now();
      return task.outputTail;
    },

    async replaceOutput({ userId, taskId, output }) {
      await getTask({ userId, taskId });
      const task = tasks.get(taskId);
      task.outputRing = createRingBuffer(outputMaxChars);
      task.outputTail = appendOutput(task.outputRing, output);
      task.updatedAt = now();
      return task.outputTail;
    },

    async createApproval(input) {
      assertUserId(input.userId);
      await getTask({ userId: input.userId, taskId: input.taskId });
      const timestamp = now();
      const approval = {
        id: input.id || `approval_${randomUUID()}`,
        taskId: input.taskId,
        userId: input.userId,
        status: input.status || 'pending',
        riskLevel: input.riskLevel || 'high',
        command: input.command || '',
        reason: input.reason || '',
        diffSummary: input.diffSummary || '',
        requestedAt: timestamp,
        resolvedAt: null
      };
      approvals.set(approval.id, approval);
      return clone(approval);
    },

    async listApprovals({ userId, status } = {}) {
      assertUserId(userId);
      return [...approvals.values()]
        .filter((approval) => approval.userId === userId)
        .filter((approval) => !status || approval.status === status)
        .map(clone);
    },

    async resolveApproval({ userId, approvalId, status }) {
      assertUserId(userId);
      const approval = approvals.get(approvalId);
      if (!approval || approval.userId !== userId) throw new Error('approval not found');
      approval.status = status;
      approval.resolvedAt = now();
      return clone(approval);
    },

    async getDelivery({ userId, taskId }) {
      assertUserId(userId);
      await getTask({ userId, taskId });
      return clone(deliveries.get(taskId));
    },

    async updateDelivery({ userId, taskId, patch }) {
      assertUserId(userId);
      await getTask({ userId, taskId });
      const current = deliveries.get(taskId) || { taskId, userId };
      Object.assign(current, patch || {}, { taskId, userId, updatedAt: now() });
      deliveries.set(taskId, current);
      return clone(current);
    },

    async logAudit({ userId, taskId, event, message = '', meta = {} }) {
      assertUserId(userId);
      const log = {
        id: `audit_${randomUUID()}`,
        userId,
        taskId,
        event,
        message,
        meta,
        createdAt: now()
      };
      auditLogs.push(log);
      return clone(log);
    },

    async listAuditLogs({ userId, taskId } = {}) {
      assertUserId(userId);
      return auditLogs
        .filter((log) => log.userId === userId)
        .filter((log) => !taskId || log.taskId === taskId)
        .map(clone);
    }
  };
}
