import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyStore } from '../key-store.js';

test('creates a private key file and lists it without key material', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yy-terminal-keys-'));
  const store = createKeyStore(dir);

  const key = store.createKey({
    name: 'deploy',
    privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----\n'
  });

  assert.match(key.id, /^[a-z0-9-]+$/);
  assert.equal(key.name, 'deploy');
  assert.equal(key.privateKeyPath.startsWith(dir), true);
  assert.equal(fs.existsSync(key.privateKeyPath), true);

  const mode = fs.statSync(key.privateKeyPath).mode & 0o777;
  assert.equal(mode, 0o600);

  assert.deepEqual(store.listKeys(), [
    {
      id: key.id,
      name: 'deploy'
    }
  ]);
});

test('resolves a created key path by id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yy-terminal-keys-'));
  const store = createKeyStore(dir);
  const key = store.createKey({
    name: 'work',
    privateKey: 'private'
  });

  assert.equal(store.getPrivateKeyPath(key.id), key.privateKeyPath);
});
