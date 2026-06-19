import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendOutput,
  buildRunnerCommand,
  buildTmuxRunnerCommand,
  classifyRisk,
  createRingBuffer,
  normalizeTaskInput,
  requiresApproval,
  sanitizeTmuxName
} from '../agent-domain.js';

test('normalizes supported agent task input', () => {
  const task = normalizeTaskInput({
    kind: 'codex',
    prompt: 'Fix mobile scroll',
    title: '',
    model: 'gpt-5-codex',
    projectPath: '/repo'
  });

  assert.equal(task.kind, 'codex');
  assert.equal(task.title, 'Fix mobile scroll');
  assert.equal(task.prompt, 'Fix mobile scroll');
  assert.equal(task.model, 'gpt-5-codex');
  assert.equal(task.projectPath, '/repo');
});

test('rejects unsupported task kind and empty prompt', () => {
  assert.throws(() => normalizeTaskInput({ kind: 'python', prompt: 'x' }), /Unsupported task kind/);
  assert.throws(() => normalizeTaskInput({ kind: 'codex', prompt: ' ' }), /prompt is required/);
});

test('classifies risky actions', () => {
  assert.equal(classifyRisk('run npm test'), 'safe');
  assert.equal(classifyRisk('npm install lodash'), 'medium');
  assert.equal(classifyRisk('git push origin main'), 'high');
  assert.equal(classifyRisk('rm -rf /'), 'critical');
});

test('requires approval for high and critical risk', () => {
  assert.equal(requiresApproval('safe'), false);
  assert.equal(requiresApproval('medium'), false);
  assert.equal(requiresApproval('high'), true);
  assert.equal(requiresApproval('critical'), true);
});

test('builds runner commands for shell codex and claude', () => {
  assert.deepEqual(buildRunnerCommand({ kind: 'shell', prompt: 'echo ok' }), {
    command: 'bash',
    args: ['-lc', 'echo ok']
  });
  assert.deepEqual(buildRunnerCommand({ kind: 'codex', prompt: 'fix bug' }), {
    command: 'codex',
    args: ['fix bug']
  });
  assert.deepEqual(buildRunnerCommand({ kind: 'claude', prompt: 'fix bug' }), {
    command: 'claude',
    args: ['fix bug']
  });
});

test('builds persistent tmux runner commands for codex and claude sessions', () => {
  assert.deepEqual(buildTmuxRunnerCommand({
    kind: 'codex',
    prompt: 'fix mobile scroll',
    tmuxSession: 'tc-codex-abc',
    projectPath: '/repo',
    model: 'gpt-5-codex'
  }), {
    command: 'tmux',
    args: [
      'new-session',
      '-A',
      '-d',
      '-s',
      'tc-codex-abc',
      '-c',
      '/repo',
      "codex --model 'gpt-5-codex' 'fix mobile scroll'"
    ]
  });
  assert.deepEqual(buildTmuxRunnerCommand({
    kind: 'claude',
    prompt: 'fix mobile scroll',
    tmuxSession: 'tc-claude-abc'
  }), {
    command: 'tmux',
    args: ['new-session', '-A', '-d', '-s', 'tc-claude-abc', "claude 'fix mobile scroll'"]
  });
});

test('tmux runner command shell-quotes model and prompt values', () => {
  const command = buildTmuxRunnerCommand({
    kind: 'codex',
    prompt: "fix 'quotes'; rm -rf /",
    tmuxSession: 'tc-safe',
    model: "gpt';bad"
  });

  assert.equal(command.args.at(-1), "codex --model 'gpt'\\'';bad' 'fix '\\''quotes'\\''; rm -rf /'");
});

test('sanitizes tmux names and keeps output ring bounded', () => {
  assert.equal(sanitizeTmuxName('task_ABC:/bad'), 'task_ABC-bad');
  const ring = createRingBuffer(12);
  appendOutput(ring, 'hello ');
  appendOutput(ring, 'world and more');
  assert.equal(ring.text, 'rld and more');
});
