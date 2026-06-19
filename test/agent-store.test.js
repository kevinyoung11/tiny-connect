import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAgentStore } from '../agent-store.js';

test('memory agent store creates lists and updates tasks by user', async () => {
  const store = createMemoryAgentStore();
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Fix scroll',
    kind: 'shell',
    prompt: 'echo ok',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-1'
  });
  await store.createTask({
    userId: 'user_2',
    title: 'Other',
    kind: 'shell',
    prompt: 'echo no',
    status: 'queued',
    riskLevel: 'safe',
    tmuxSession: 'tc-shell-2'
  });
  await store.updateTask({ userId: 'user_1', taskId: task.id, patch: { status: 'running' } });

  const list = await store.listTasks({ userId: 'user_1' });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'running');
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).id, task.id);
  await assert.rejects(() => store.getTask({ userId: 'user_2', taskId: task.id }), /task not found/);
});

test('memory agent store handles approvals delivery output and audit logs', async () => {
  const store = createMemoryAgentStore();
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Deploy',
    kind: 'shell',
    prompt: 'git push',
    status: 'waiting_approval',
    riskLevel: 'high',
    tmuxSession: 'tc-shell-3'
  });
  const approval = await store.createApproval({
    userId: 'user_1',
    taskId: task.id,
    riskLevel: 'high',
    command: 'git push',
    reason: 'push requires approval',
    diffSummary: '+ code'
  });
  await store.resolveApproval({ userId: 'user_1', approvalId: approval.id, status: 'approved' });
  await store.appendOutput({ userId: 'user_1', taskId: task.id, chunk: 'done' });
  await store.updateDelivery({
    userId: 'user_1',
    taskId: task.id,
    patch: { prUrl: 'https://example.test/pr/1', ciStatus: 'passed' }
  });
  await store.logAudit({ userId: 'user_1', taskId: task.id, event: 'task_completed', message: 'done' });

  assert.equal((await store.listApprovals({ userId: 'user_1', status: 'approved' })).length, 1);
  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).outputTail, 'done');
  assert.equal((await store.getDelivery({ userId: 'user_1', taskId: task.id })).ciStatus, 'passed');
  assert.equal((await store.listAuditLogs({ userId: 'user_1', taskId: task.id })).length, 1);
});

test('memory agent store returns newest tasks first and limits output tail', async () => {
  const store = createMemoryAgentStore({ outputMaxChars: 8 });
  const first = await store.createTask({
    userId: 'user_1',
    title: 'First',
    kind: 'shell',
    prompt: 'echo first',
    status: 'queued',
    riskLevel: 'safe'
  });
  const second = await store.createTask({
    userId: 'user_1',
    title: 'Second',
    kind: 'shell',
    prompt: 'echo second',
    status: 'queued',
    riskLevel: 'safe'
  });

  await store.appendOutput({ userId: 'user_1', taskId: first.id, chunk: 'hello world' });

  assert.deepEqual((await store.listTasks({ userId: 'user_1' })).map((task) => task.id), [second.id, first.id]);
  assert.equal((await store.getTask({ userId: 'user_1', taskId: first.id })).outputTail, 'lo world');
});

test('memory agent store replaces output tail without duplicating previous capture', async () => {
  const store = createMemoryAgentStore({ outputMaxChars: 20 });
  const task = await store.createTask({
    userId: 'user_1',
    title: 'Replay',
    kind: 'codex',
    prompt: 'work',
    status: 'running',
    riskLevel: 'safe'
  });

  await store.appendOutput({ userId: 'user_1', taskId: task.id, chunk: 'old pane' });
  await store.replaceOutput({ userId: 'user_1', taskId: task.id, output: 'new pane' });
  await store.replaceOutput({ userId: 'user_1', taskId: task.id, output: 'new pane' });

  assert.equal((await store.getTask({ userId: 'user_1', taskId: task.id })).outputTail, 'new pane');
});
