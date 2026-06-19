#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

export async function runApprovalHook({
  argv = process.argv.slice(2),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now()
} = {}) {
  try {
    const options = parseArgs(argv);
    validateOptions(options);
    const approval = await requestApproval({ options, fetchImpl });
    const resolved = await waitForResolution({ options, approvalId: approval.id, fetchImpl, sleep, now });
    if (resolved.status === 'approved') {
      return { exitCode: 0, stdout: `approved ${approval.id}\n`, stderr: '' };
    }
    return { exitCode: 2, stdout: '', stderr: `approval ${approval.id} ${resolved.status || 'rejected'}\n` };
  } catch (error) {
    const exitCode = error.code === 'USAGE' ? 64 : error.code === 'TIMEOUT' ? 3 : 1;
    return { exitCode, stdout: '', stderr: `${error.message}\n` };
  }
}

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.AGENT_CONSOLE_URL || 'http://127.0.0.1:8787',
    deviceFingerprint: process.env.AGENT_DEVICE_FINGERPRINT || '',
    timeoutMs: 10 * 60 * 1000,
    pollMs: 2000,
    reason: '',
    diffSummary: ''
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--base-url') options.baseUrl = next();
    else if (arg === '--task-id') options.taskId = next();
    else if (arg === '--command') options.command = next();
    else if (arg === '--reason') options.reason = next();
    else if (arg === '--diff-summary') options.diffSummary = next();
    else if (arg === '--device-fingerprint') options.deviceFingerprint = next();
    else if (arg === '--timeout-ms') options.timeoutMs = Number(next());
    else if (arg === '--poll-ms') options.pollMs = Number(next());
    else throw usage(`unsupported option: ${arg}`);
  }
  return options;
}

function validateOptions(options) {
  if (!options.taskId) throw usage('task-id is required');
  if (!options.command) throw usage('command is required');
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw usage('timeout-ms must be positive');
  if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) throw usage('poll-ms must be positive');
}

async function requestApproval({ options, fetchImpl }) {
  const payload = {
    command: options.command,
    reason: options.reason,
    diffSummary: options.diffSummary
  };
  const body = await requestJson(fetchImpl, `${trimSlash(options.baseUrl)}/api/agent/tasks/${encodeURIComponent(options.taskId)}/approval-requests`, {
    method: 'POST',
    headers: requestHeaders(options),
    body: JSON.stringify(payload)
  });
  return body.approval;
}

async function waitForResolution({ options, approvalId, fetchImpl, sleep, now }) {
  const deadline = now() + options.timeoutMs;
  while (now() <= deadline) {
    const detail = await requestJson(fetchImpl, `${trimSlash(options.baseUrl)}/api/agent/approvals/${encodeURIComponent(approvalId)}`, {
      headers: requestHeaders(options)
    });
    const approval = detail.approval || {};
    if (approval.status === 'approved' || approval.status === 'rejected') return approval;
    await sleep(options.pollMs);
  }
  const error = new Error(`approval ${approvalId} timed out`);
  error.code = 'TIMEOUT';
  throw error;
}

async function requestJson(fetchImpl, url, init) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message || `request failed with status ${response.status}`);
  }
  return response.json();
}

function requestHeaders(options) {
  const headers = { 'Content-Type': 'application/json' };
  if (options.deviceFingerprint) headers['x-device-fingerprint'] = options.deviceFingerprint;
  return headers;
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function usage(message) {
  const error = new Error(message);
  error.code = 'USAGE';
  return error;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runApprovalHook();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}
