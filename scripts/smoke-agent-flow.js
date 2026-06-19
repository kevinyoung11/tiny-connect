import server from '../server.js';

const port = Number(process.env.SMOKE_PORT || 8796);
const baseUrl = `http://127.0.0.1:${port}`;
const headers = {
  'Content-Type': 'application/json',
  'x-device-fingerprint': 'agent-smoke-device'
};

await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

try {
  const safe = await post('/api/agent/tasks', { kind: 'shell', prompt: 'printf agent-smoke-ok', title: 'Smoke safe task' });
  await waitForTask(safe.task.id, (task) => task.status === 'completed' && task.outputTail.includes('agent-smoke-ok'));

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
