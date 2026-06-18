import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, getDefaultStartupHabit, normalizeSettings } from '../settings.js';

test('normalizes missing settings to product defaults', () => {
  assert.deepEqual(normalizeSettings({}), defaultSettings);
});

test('clamps terminal font size between 10 and 24 and keepalive interval', () => {
  assert.deepEqual(normalizeSettings({
    fontSize: 80,
    keepaliveIntervalSeconds: 1,
    disconnectTimeout: 'never',
    autoReconnect: true
  }), {
    fontSize: 24,
    keepaliveIntervalSeconds: 10,
    disconnectTimeout: 'never',
    autoReconnect: true,
    habits: []
  });

  assert.equal(normalizeSettings({ fontSize: 6 }).fontSize, 10);
});

test('rejects unsupported disconnect timeout values by using default', () => {
  assert.equal(normalizeSettings({ disconnectTimeout: 'forever-ish' }).disconnectTimeout, '30m');
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
