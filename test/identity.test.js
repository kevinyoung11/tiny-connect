import test from 'node:test';
import assert from 'node:assert/strict';
import { getDeviceFingerprint, withDeviceIdentity } from '../public/identity.js';

test('generates and reuses a device fingerprint', () => {
  installBrowserGlobals();

  const first = getDeviceFingerprint();
  const second = getDeviceFingerprint();

  assert.match(first, /^fp_[a-f0-9]{8}$/);
  assert.equal(second, first);
});

test('adds device fingerprint to API request headers', () => {
  installBrowserGlobals();

  const init = withDeviceIdentity({ headers: { 'Content-Type': 'application/json' } });

  assert.equal(init.headers.get('Content-Type'), 'application/json');
  assert.match(init.headers.get('X-Device-Fingerprint'), /^fp_[a-f0-9]{8}$/);
});

function installBrowserGlobals() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.get(key) || null;
    },
    setItem(key, value) {
      store.set(key, value);
    }
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'Node Test', language: 'en-US' }
  });
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { width: 1440, height: 900, colorDepth: 24 }
  });
}
