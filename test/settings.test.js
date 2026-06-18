import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTmuxStartupCommand,
  defaultSettings,
  getDefaultStartupHabit,
  normalizeSettings
} from '../settings.js';

test('normalizes missing settings to product defaults', () => {
  assert.deepEqual(normalizeSettings({}), defaultSettings);
});

test('clamps terminal font size between 10 and 24 and keepalive interval', () => {
  assert.deepEqual(normalizeSettings({
    fontSize: 80,
    fontFamily: 'dracula-font',
    theme: 'tokyo-night',
    keepaliveIntervalSeconds: 1,
    disconnectTimeout: 'never',
    autoReconnect: true
  }), {
    fontSize: 24,
    fontFamily: 'system',
    theme: 'tokyo-night',
    keepaliveIntervalSeconds: 10,
    disconnectTimeout: 'never',
    autoReconnect: true,
    habits: []
  });

  assert.equal(normalizeSettings({ fontSize: 6 }).fontSize, 10);
  assert.equal(normalizeSettings({ fontFamily: 'jetbrains' }).fontFamily, 'jetbrains');
  assert.equal(normalizeSettings({ theme: 'dracula' }).theme, 'dracula');
  assert.equal(normalizeSettings({ theme: 'github-light' }).theme, 'github-light');
  assert.equal(normalizeSettings({ theme: 'catppuccin-latte' }).theme, 'catppuccin-latte');
});

test('rejects unsupported disconnect timeout values by using default', () => {
  assert.equal(normalizeSettings({ disconnectTimeout: 'forever-ish' }).disconnectTimeout, 'never');
});

test('normalizes startup habits and selects the enabled habit with highest priority', () => {
  const settings = normalizeSettings({
    habits: [
      { id: 'b', name: 'Later', command: 'echo later', priority: 20, enabled: true },
      { id: 'a', name: 'Codex', command: 'cd ~/code && codex', priority: 1, enabled: true },
      { id: 'disabled', name: 'Disabled', command: 'echo disabled', priority: 0, enabled: false },
      { id: '', name: '', command: '', priority: 2, enabled: true }
    ]
  });

  assert.deepEqual(settings.habits, [
    { id: 'a', name: 'Codex', command: 'cd ~/code && codex', priority: 1, enabled: true },
    { id: 'disabled', name: 'Disabled', command: 'echo disabled', priority: 1, enabled: false },
    { id: 'b', name: 'Later', command: 'echo later', priority: 20, enabled: true }
  ]);
  assert.equal(getDefaultStartupHabit(settings).command, 'cd ~/code && codex');
});

test('builds tmux startup command that only runs habit for a new session', () => {
  const command = buildTmuxStartupCommand({
    habits: [
      { id: 'codex', name: 'Codex', command: 'cd ~/code && codex', priority: 1, enabled: true }
    ]
  });

  assert.equal(
    command,
    "tmux has-session -t 'tc' 2>/dev/null || tmux new-session -d -s 'tc' 'cd ~/code && codex'; tmux set-option -g mouse on; tmux attach-session -t 'tc'"
  );
});
