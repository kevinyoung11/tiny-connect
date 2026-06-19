const supportedKinds = new Set(['shell', 'codex', 'claude']);

export function normalizeTaskInput(input = {}) {
  const kind = String(input.kind || 'codex').trim();
  if (!supportedKinds.has(kind)) throw new Error(`Unsupported task kind: ${kind}`);
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required');
  return {
    kind,
    prompt,
    title: String(input.title || prompt).trim().slice(0, 120),
    model: String(input.model || '').trim(),
    projectPath: String(input.projectPath || '').trim(),
    metadata: typeof input.metadata === 'object' && input.metadata ? input.metadata : {}
  };
}

export function classifyRisk(text = '') {
  const value = String(text).toLowerCase();
  if (/(rm\s+-rf|drop\s+database|truncate\s+table|delete\s+from|secret|private[_-]?key)/.test(value)) return 'critical';
  if (/(git\s+push|deploy|release|merge|docker\s+push|kubectl|terraform\s+apply)/.test(value)) return 'high';
  if (/(npm\s+install|pnpm\s+install|yarn\s+add|git\s+commit|git\s+checkout\s+-b|pip\s+install)/.test(value)) return 'medium';
  return 'safe';
}

export function requiresApproval(riskLevel) {
  return riskLevel === 'high' || riskLevel === 'critical';
}

export function buildRunnerCommand(task) {
  if (task.kind === 'shell') return { command: 'bash', args: ['-lc', task.prompt] };
  if (task.kind === 'codex') return { command: 'codex', args: [task.prompt] };
  if (task.kind === 'claude') return { command: 'claude', args: [task.prompt] };
  throw new Error(`Unsupported task kind: ${task.kind}`);
}

export function buildTmuxRunnerCommand(task) {
  const session = sanitizeTmuxName(task.tmuxSession || `${task.kind}-${task.id || 'task'}`);
  const args = ['new-session', '-A', '-s', session];
  if (task.projectPath) args.push('-c', task.projectPath);
  args.push(buildAgentCommandLine(task));
  return { command: 'tmux', args };
}

function buildAgentCommandLine(task) {
  if (task.kind !== 'codex' && task.kind !== 'claude') {
    const spec = buildRunnerCommand(task);
    return [spec.command, ...spec.args.map(shellQuote)].join(' ');
  }
  const parts = [task.kind];
  if (task.model) parts.push('--model', shellQuote(task.model));
  parts.push(shellQuote(task.prompt));
  return parts.join(' ');
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function sanitizeTmuxName(value) {
  return String(value || 'task')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'task';
}

export function createRingBuffer(maxChars = 12000) {
  return { maxChars, text: '' };
}

export function appendOutput(ring, chunk) {
  ring.text = `${ring.text}${String(chunk)}`;
  if (ring.text.length > ring.maxChars) ring.text = ring.text.slice(-ring.maxChars);
  return ring.text;
}
