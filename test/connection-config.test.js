import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildConnectionConfig } from '../connection-config.js';

test('builds a local connection when no mode is provided', () => {
  assert.deepEqual(buildConnectionConfig({}), {
    mode: 'local'
  });
});

test('builds ssh config with default port and expanded private key path', () => {
  const config = buildConnectionConfig({
    mode: 'ssh',
    host: 'example.com',
    username: 'deploy',
    privateKeyPath: '~/.ssh/id_ed25519'
  });

  assert.deepEqual(config, {
    mode: 'ssh',
    host: 'example.com',
    port: 22,
    username: 'deploy',
    privateKeyPath: path.join(os.homedir(), '.ssh/id_ed25519'),
    passphrase: ''
  });
});

test('rejects ssh config without required fields', () => {
  assert.throws(
    () => buildConnectionConfig({ mode: 'ssh', host: 'example.com' }),
    /username is required/
  );
});

test('builds ssh config from selected managed key id', () => {
  const config = buildConnectionConfig(
    {
      mode: 'ssh',
      host: 'example.com',
      username: 'deploy',
      keyId: 'deploy-1234'
    },
    {
      resolveKeyPath: (keyId) => `/tmp/${keyId}.key`
    }
  );

  assert.equal(config.privateKeyPath, '/tmp/deploy-1234.key');
});
