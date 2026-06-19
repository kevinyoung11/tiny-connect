import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.env.SMOKE_PORT || 8796);
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  'Content-Type': 'application/json',
  'x-device-fingerprint': 'agent-smoke-device'
};

const fakeBinDir = await installFakeTmux();
process.env.PATH = `${fakeBinDir}:${process.env.PATH || ''}`;
process.env.FAKE_TMUX_SEND_LOG = join(fakeBinDir, 'send.log');
process.env.PORT = String(port);
process.env.HOST = '127.0.0.1';

const { default: server } = await import('../server.js');
if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

try {
  const safe = await post('/api/agent/tasks', { kind: 'shell', prompt: 'printf agent-smoke-ok', title: 'Smoke safe task' });
  await waitForTask(safe.task.id, (task) => task.status === 'completed' && task.outputTail.includes('agent-smoke-ok'));

  const interactive = await post('/api/agent/tasks', { kind: 'shell', prompt: 'cat', title: 'Smoke interactive task' });
  await post(`/api/agent/tasks/${interactive.task.id}/input`, { input: 'agent-input-ok\n' });
  await waitForTask(interactive.task.id, (task) => task.outputTail.includes('agent-input-ok'));
  await post(`/api/agent/tasks/${interactive.task.id}/cancel`, {});

  const risky = await post('/api/agent/tasks', { kind: 'shell', prompt: 'git push origin main', title: 'Smoke approval task' });
  assert(risky.task.status === 'waiting_approval', 'risky task should wait for approval');
  assert(risky.approval?.id, 'risky task should create approval');

  await post(`/api/agent/approvals/${risky.approval.id}/resolve`, { status: 'rejected' });
  const rejected = await get(`/api/agent/tasks/${risky.task.id}`);
  assert(rejected.task.status === 'cancelled', 'rejected task should be cancelled');

  const delivery = await post(`/api/agent/tasks/${safe.task.id}/delivery`, {
    prUrl: 'https://example.test/pr/1',
    ciStatus: 'passed',
    summary: 'Smoke delivery'
  });
  assert(delivery.delivery.ciStatus === 'passed', 'delivery should be updated');

  const mcp = await post('/api/mcp/tools/create_agent_task', { kind: 'shell', prompt: 'printf mcp-ok', title: 'MCP smoke' });
  assert(mcp.task.id, 'mcp tool should create task');

  const codex = await post('/api/agent/tasks', { kind: 'codex', prompt: 'inspect current task', title: 'Tmux capture smoke' });
  const codexDetail = await get(`/api/agent/tasks/${codex.task.id}`);
  assert(codexDetail.task.outputTail.includes('fake-tmux-pane-ok'), 'codex task detail should capture tmux pane output');
  const codexOutput = await get(`/api/agent/tasks/${codex.task.id}/output`);
  assert(codexOutput.output.includes('fake-tmux-pane-ok'), 'codex output endpoint should capture tmux pane output');
  await post(`/api/agent/tasks/${codex.task.id}/input`, { input: 'continue' });

  const commandApproval = await post(`/api/agent/tasks/${codex.task.id}/approval-requests`, {
    command: 'git push origin main',
    reason: 'Smoke command approval',
    diffSummary: '+ smoke'
  });
  assert(commandApproval.task.status === 'waiting_approval', 'running command approval should pause task');
  await post(`/api/agent/approvals/${commandApproval.approval.id}/resolve`, { status: 'approved' });
  const sendLog = await readFile(process.env.FAKE_TMUX_SEND_LOG, 'utf8');
  assert(sendLog.includes('git push origin main'), 'approved command should be sent to tmux session');

  await post(`/api/agent/tasks/${codex.task.id}/cancel`, {});

  console.log('agent smoke flow passed');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function waitForTask(taskId, predicate) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const detail = await get(`/api/agent/tasks/${taskId}`);
    if (predicate(detail.task)) return detail.task;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for task ${taskId}`);
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers });
  return readJson(response);
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return readJson(response);
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function installFakeTmux() {
  const dir = await mkdtemp(join(tmpdir(), 'tiny-connect-fake-tmux-'));
  const tmuxPath = join(dir, 'tmux');
  await writeFile(tmuxPath, `#!/bin/sh
case "$1" in
  new-session)
    sleep 3
    ;;
  capture-pane)
    printf 'fake-tmux-pane-ok\\n'
    ;;
  send-keys)
    printf '%s\\n' "$*" >> "$FAKE_TMUX_SEND_LOG"
    exit 0
    ;;
  kill-session)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`);
  await chmod(tmuxPath, 0o755);
  return dir;
}
