import os from 'node:os';
import path from 'node:path';

export function buildConnectionConfig(input = {}, options = {}) {
  const mode = input.mode || 'local';

  if (mode === 'local') {
    return { mode: 'local' };
  }

  if (mode !== 'ssh') {
    throw new Error(`unsupported connection mode: ${mode}`);
  }

  const host = requiredString(input.host, 'host');
  const username = requiredString(input.username, 'username');
  const privateKeyPath = resolvePrivateKeyPath(input, options);
  const port = input.port ? Number(input.port) : 22;

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }

  return {
    mode: 'ssh',
    host,
    port,
    username,
    privateKeyPath: expandHome(privateKeyPath),
    passphrase: typeof input.passphrase === 'string' ? input.passphrase : '',
    tmux: input.tmux === true,
  };
}

function resolvePrivateKeyPath(input, options) {
  if (typeof input.keyId === 'string' && input.keyId.trim() !== '') {
    if (typeof options.resolveKeyPath !== 'function') {
      throw new Error('resolveKeyPath is required when keyId is provided');
    }
    return options.resolveKeyPath(input.keyId.trim());
  }
  return requiredString(input.privateKeyPath, 'privateKeyPath');
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function expandHome(value) {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}
