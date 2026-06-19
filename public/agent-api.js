const jsonContentType = 'application/json';

export function createAgentApi({ fetchImpl = globalThis.fetch, withIdentity = (init) => init } = {}) {
  return {
    fetchSnapshot(options = {}) {
      return requestJson('/api/agent/snapshot', {}, { fetchImpl, withIdentity, ...options });
    },
    startTask(task, options = {}) {
      return requestJson('/api/agent/tasks', jsonRequest('POST', task), { fetchImpl, withIdentity, ...options });
    },
    resolveApproval(approvalId, status, options = {}) {
      return requestJson(
        `/api/agent/approvals/${encodeURIComponent(approvalId)}/resolve`,
        jsonRequest('POST', { status }),
        { fetchImpl, withIdentity, ...options }
      );
    }
  };
}

export function fetchAgentSnapshot(options = {}) {
  return createAgentApi(options).fetchSnapshot();
}

export function startAgentTask(task, options = {}) {
  return createAgentApi(options).startTask(task);
}

export function resolveAgentApproval(approvalId, status, options = {}) {
  return createAgentApi(options).resolveApproval(approvalId, status);
}

function jsonRequest(method, body) {
  const headers = new Headers();
  headers.set('Content-Type', jsonContentType);
  return {
    method,
    headers,
    body: JSON.stringify(body || {})
  };
}

async function requestJson(endpoint, init, { fetchImpl, withIdentity }) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable');
  }

  const response = await fetchImpl(endpoint, withIdentity(init));
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Agent request failed with status ${response.status}`);
  }

  if (response.status === 204) return null;
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes(jsonContentType) || typeof response.json === 'function') {
    return response.json();
  }
  return null;
}

async function readErrorMessage(response) {
  try {
    if (typeof response.json === 'function') {
      const payload = await response.json();
      return payload?.error || payload?.message || '';
    }
    if (typeof response.text === 'function') return response.text();
  } catch {
    return '';
  }
  return '';
}
