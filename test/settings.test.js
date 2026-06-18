import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, normalizeSettings } from '../settings.js';

test('normalizes missing settings to product defaults', () => {
  assert.deepEqual(normalizeSettings({}), defaultSettings);
});

test('clamps terminal font size and keepalive interval', () => {
  assert.deepEqual(normalizeSettings({
    fontSize: 80,
    keepaliveIntervalSeconds: 1,
    disconnectTimeout: 'never',
    autoReconnect: true
  }), {
    fontSize: 24,
    keepaliveIntervalSeconds: 10,
    disconnectTimeout: 'never',
    autoReconnect: true
  });
});

test('rejects unsupported disconnect timeout values by using default', () => {
  assert.equal(normalizeSettings({ disconnectTimeout: 'forever-ish' }).disconnectTimeout, '30m');
});
