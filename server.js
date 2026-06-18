import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import process from 'node:process';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import http from 'node:http';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';
import { buildConnectionConfig } from './connection-config.js';
import {
  createSupabaseActivityStore,
  createSupabaseKeyStore,
  createSupabaseProfileStore,
  createSupabaseUserStore,
  getSupabaseConfigStatus,
  isSupabaseConfigured
} from './supabase-store.js';
import { buildTmuxStartupCommand, disconnectTimeoutToMs, getDefaultStartupHabit, normalizeSettings } from './settings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';
const shell = process.env.TERMINAL_SHELL || defaultShell;
const startupCommand = process.env.STARTUP_COMMAND || '';

const keysDir = process.env.VERCEL ? '/tmp/.keys' : path.join(__dirname, '.keys');
const supabaseConfigured = isSupabaseConfigured();

const keyStore = createSupabaseKeyStore(keysDir);
const profileStore = createSupabaseProfileStore();
const userStore = createSupabaseUserStore();
const activityStore = createSupabaseActivityStore();

// sessionId → { client, config, stream, ws, cleanupTimer, settings }
const sshSessions = new Map();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm')));
app.use('/xterm-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit')));

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    supabaseConfigured,
    supabase: getSupabaseConfigStatus()
  });
});

app.use('/api', requireSupabaseConfig);

function requireSupabaseConfig(req, res, next) {
  if (supabaseConfigured) {
    next();
    return;
  }
  res.status(503).json({
    error: 'Supabase is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and Direct_Link/DIRECT_URL/DATABASE_URL.'
  });
}

/* ── SSH Key endpoints ─────────────────────────────────────────────────────── */
app.get('/api/keys', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const keys = await Promise.resolve(keyStore.listKeys(scope));
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/keys', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const key = await Promise.resolve(keyStore.createKey({
      ...scope,
      name: req.body?.name,
      privateKey: req.body?.privateKey
    }));
    res.status(201).json({ key: { id: key.id, name: key.name } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/keys/:id', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    await Promise.resolve(keyStore.deleteKey?.(req.params.id, scope));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

/* ── Profile endpoints ─────────────────────────────────────────────────────── */
app.get('/api/profiles', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const profiles = await Promise.resolve(profileStore.listProfiles(scope));
    res.json({ profiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const profile = await Promise.resolve(profileStore.createProfile({ ...scope, ...(req.body || {}) }));
    res.status(201).json({ profile });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/profiles/:id', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    await Promise.resolve(profileStore.deleteProfile(req.params.id, scope));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const settings = normalizeSettings(await userStore.getUserSettings(scope));
    res.json({ settings, user: publicUserScope(scope) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const settings = await userStore.saveUserSettings({
      ...scope,
      settings: normalizeSettings(req.body?.settings || {})
    });
    res.json({ settings: normalizeSettings(settings), user: publicUserScope(scope) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/devices/pairing-code', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const pairing = await userStore.createPairingCode(scope);
    res.status(201).json({ pairing });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/devices/link', async (req, res) => {
  try {
    const user = await userStore.linkDeviceWithPairingCode({
      deviceFingerprint: req.get('x-device-fingerprint'),
      userAgent: req.get('user-agent') || '',
      code: req.body?.code
    });
    res.json({ user: { idHash: createHash('sha256').update(user.id).digest('hex').slice(0, 12) } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/devices', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const devices = await userStore.listDevices({
      ...scope,
      deviceFingerprint: req.get('x-device-fingerprint')
    });
    res.json({ devices });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/devices/:id', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    await userStore.unlinkDevice({
      ...scope,
      deviceId: req.params.id,
      deviceFingerprint: req.get('x-device-fingerprint')
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const scope = await getRequestScope(req);
    const logs = await activityStore.listConnectionLogs({ ...scope, limit: req.query.limit });
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

async function getRequestScope(req) {
  const deviceFingerprint = req.get('x-device-fingerprint');
  const user = await userStore.ensureUserForDevice({
    deviceFingerprint,
    userAgent: req.get('user-agent') || ''
  });
  return { userId: user.id };
}

function publicUserScope(scope) {
  return {
    idHash: createHash('sha256').update(scope.userId).digest('hex').slice(0, 12)
  };
}

async function getSocketScope(message) {
  const user = await userStore.ensureUserForDevice({
    deviceFingerprint: message.deviceFingerprint,
    userAgent: 'websocket'
  });
  return { userId: user.id };
}

/* ── SFTP endpoints ────────────────────────────────────────────────────────── */
app.get('/api/sftp/:id/ls', (req, res) => {
  const session = sshSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const dir = req.query.path || '.';
  session.client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    sftp.readdir(dir, (err2, list) => {
      sftp.end();
      if (err2) return res.status(500).json({ error: err2.message });
      const entries = list.map(e => ({
        name: e.filename,
        isDir: (e.attrs.mode & 0o170000) === 0o040000,
        size: e.attrs.size,
        mtime: e.attrs.mtime,
      })).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      res.json({ path: dir, entries });
    });
  });
});

app.get('/api/sftp/:id/download', (req, res) => {
  const session = sshSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  session.client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    const filename = path.basename(filePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '\\"')}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const readStream = sftp.createReadStream(filePath);
    readStream.on('error', e => {
      sftp.end();
      if (!res.headersSent) res.status(500).json({ error: e.message });
      else res.destroy();
    });
    readStream.on('end', () => sftp.end());
    readStream.pipe(res);
  });
});

app.post('/api/sftp/:id/upload', (req, res) => {
  const session = sshSessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const remotePath = req.query.path;
  if (!remotePath) return res.status(400).json({ error: 'path required' });
  session.client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });
    const writeStream = sftp.createWriteStream(remotePath);
    writeStream.on('close', () => { sftp.end(); res.json({ ok: true }); });
    writeStream.on('error', e => {
      sftp.end();
      if (!res.headersSent) res.status(500).json({ error: e.message });
    });
    req.pipe(writeStream);
  });
});

/* ── WebSocket ─────────────────────────────────────────────────────────────── */
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/terminal' });

function createTerminal(ws) {
  let transport = null;
  let connected = false;
  const fallbackTimer = setTimeout(() => {
    if (!connected) {
      connected = true;
      transport = createLocalTransport(ws, {});
    }
  }, 1000);

  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }

    if (message.type === 'connect' && !connected) {
      clearTimeout(fallbackTimer);
      connected = true;
      connectTransport(ws, message)
        .then((nextTransport) => { transport = nextTransport; })
        .catch((error) => {
          sendData(ws, `Connection configuration error: ${error.message}\r\n`);
          ws.close();
        });
      return;
    }

    if (message.type === 'reconnect' && !connected) {
      clearTimeout(fallbackTimer);
      connected = true;
      const session = sshSessions.get(message.sessionId);
      if (!session) {
        getSocketScope(message)
          .then((scope) => logConnection(scope, 'reconnect_failed', 'error', {}, 'Session not found'))
          .catch(() => {});
        sendData(ws, 'Reconnect failed: session not found\r\n');
        ws.close();
        return;
      }
      clearTimeout(session.cleanupTimer);
      session.ws = ws;
      transport = createAttachedSshTransport(ws, message.sessionId, session);
      ws.send(JSON.stringify({ type: 'session', id: message.sessionId }));
      ws.send(JSON.stringify({ type: 'status', status: 'restored', message: 'Restored previous session' }));
      logConnection(session.config, 'reconnect_success', 'ok', session.config, 'Restored previous session');
      sendData(ws, `Reconnected to ${session.config.username}@${session.config.host}\r\n`);
      return;
    }

    if (!transport) return;

    if (message.type === 'close') {
      if (transport?.config) logConnection(transport.config, 'manual_close', 'info', transport.config, 'Manual close requested');
      transport.close({ force: true });
      return;
    }

    if (message.type === 'input' && typeof message.data === 'string') {
      transport.input(message.data);
    }
    if (message.type === 'resize') {
      const cols = Number(message.cols);
      const rows = Number(message.rows);
      if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
        transport.resize(cols, rows);
      }
    }
  });

  ws.on('close', () => {
    clearTimeout(fallbackTimer);
    if (transport) transport.close();
  });
}

async function connectTransport(ws, message) {
  if (!supabaseConfigured) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and Direct_Link/DIRECT_URL/DATABASE_URL.');
  }
  const scope = await getSocketScope(message);
  const config = buildConnectionConfig(message.config || {}, {
    resolveKeyPath: (keyId) => `managed-key:${keyId}`
  });
  config.userId = scope.userId;
  logConnection(scope, 'connect_start', 'info', config, 'Connection requested');
  if (config.privateKeyPath?.startsWith('managed-key:')) {
    const keyId = config.privateKeyPath.slice('managed-key:'.length);
    config.privateKeyPath = await keyStore.getPrivateKeyPath(keyId, scope);
  }
  return config.mode === 'ssh'
    ? createSshTransport(ws, config)
    : createLocalTransport(ws, { tmux: message.config?.tmux === true });
}

function createLocalTransport(ws, config) {
  const effectiveStartup = config.tmux ? 'tmux new-session -A -s tc' : startupCommand;
  const bridge = spawn('python3', [path.join(__dirname, 'pty_bridge.py')], {
    cwd: os.homedir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERMINAL_SHELL: shell,
      STARTUP_COMMAND: effectiveStartup,
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
      TERM: 'xterm-256color'
    }
  });

  bridge.on('error', (error) => {
    sendData(ws, `Failed to start terminal bridge\r\n${error.message}\r\n`);
    ws.close();
  });
  bridge.stdout.on('data', (data) => sendData(ws, data.toString('utf8')));
  bridge.stderr.on('data', (data) => sendData(ws, data.toString('utf8')));
  bridge.on('exit', (exitCode) => sendExit(ws, exitCode));

  return {
    config: null,
    input(data) { bridge.stdin.write(JSON.stringify({ type: 'input', data }) + '\n'); },
    resize(cols, rows) { bridge.stdin.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n'); },
    close() { bridge.kill(); }
  };
}

function createSshTransport(ws, config) {
  const sessionId = randomUUID();
  const client = new Client();
  let stream = null;
  const settings = normalizeSettings(config.settings || {});

  client.on('ready', () => {
    sshSessions.set(sessionId, { client, config, stream: null, ws, cleanupTimer: null, settings });
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'session', id: sessionId }));
    }
    sendData(ws, `SSH connected to ${config.username}@${config.host}\r\n`);
    logConnection(config, 'connect_success', 'ok', config, config.tmux ? 'SSH connected; tmux attach requested' : 'SSH connected');

    client.shell({
      term: 'xterm-256color',
      cols: 80,
      rows: 24,
      modes: { ECHO: 1, ICANON: 1, ISIG: 1 }
    }, (error, shellStream) => {
      if (error) {
        sendData(ws, `Failed to start remote shell: ${error.message}\r\n`);
        ws.close();
        return;
      }
      stream = shellStream;
      const session = sshSessions.get(sessionId);
      if (session) session.stream = stream;
      stream.on('data', (data) => {
        const session = sshSessions.get(sessionId);
        if (session?.ws) sendData(session.ws, data.toString('utf8'));
      });
      stream.stderr.on('data', (data) => {
        const session = sshSessions.get(sessionId);
        if (session?.ws) sendData(session.ws, data.toString('utf8'));
      });
      stream.on('close', () => {
        const session = sshSessions.get(sessionId);
        if (session?.cleanupTimer) clearTimeout(session.cleanupTimer);
        sshSessions.delete(sessionId);
        client.end();
        if (session?.ws) sendExit(session.ws, 0);
      });

      if (config.tmux) {
        setTimeout(() => {
          if (!stream) return;
          stream.write(`${buildTmuxStartupCommand(config.settings)}\r`);
          ws.send(JSON.stringify({ type: 'status', status: 'attached_tmux', message: 'Attached to tmux' }));
        }, 400);
      } else if (startupCommand) {
        stream.write(`${startupCommand}\r`);
      } else {
        writeStartupHabit(stream, config.settings, 200);
      }
    });
  });

  client.on('error', (error) => {
    sshSessions.delete(sessionId);
    logConnection(config, 'connect_error', 'error', config, error.message);
    sendData(ws, `SSH connection failed: ${error.message}\r\n`);
    ws.close();
  });

  try {
    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      privateKey: fs.readFileSync(config.privateKeyPath),
      passphrase: config.passphrase || undefined,
      readyTimeout: 20000,
      keepaliveInterval: settings.keepaliveIntervalSeconds * 1000
    });
  } catch (error) {
    sendData(ws, `SSH setup failed: ${error.message}\r\n`);
    ws.close();
  }

  return {
    config,
    input(data) { if (stream) stream.write(data); },
    resize(cols, rows) { if (stream) stream.setWindow(rows, cols, 0, 0); },
    close(options = {}) {
      if (options.force) closeSshSessionNow(sessionId);
      else detachOrCloseSshSession(sessionId);
    }
  };
}

function writeStartupHabit(stream, settings, delayMs) {
  const habit = getDefaultStartupHabit(settings);
  if (!habit) return;
  setTimeout(() => {
    if (stream) stream.write(`${habit.command}\r`);
  }, delayMs);
}

function createAttachedSshTransport(ws, sessionId, session) {
  return {
    config: session.config,
    input(data) { if (session.stream) session.stream.write(data); },
    resize(cols, rows) { if (session.stream) session.stream.setWindow(rows, cols, 0, 0); },
    close(options = {}) {
      if (options.force) closeSshSessionNow(sessionId);
      else detachOrCloseSshSession(sessionId);
    }
  };
}

function closeSshSessionNow(sessionId) {
  const session = sshSessions.get(sessionId);
  if (!session) return;
  clearTimeout(session.cleanupTimer);
  sshSessions.delete(sessionId);
  if (session.stream) session.stream.close();
  session.client.end();
}

function detachOrCloseSshSession(sessionId) {
  const session = sshSessions.get(sessionId);
  if (!session) return;
  session.ws = null;
  logConnection(session.config, 'detached', 'warn', session.config, 'Client detached');
  const timeoutMs = disconnectTimeoutToMs(session.settings.disconnectTimeout);
  if (timeoutMs === null) return;
  clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    const latest = sshSessions.get(sessionId);
    if (!latest || latest.ws) return;
    sshSessions.delete(sessionId);
    logConnection(latest.config, 'session_closed', 'info', latest.config, 'Detached session cleanup timeout reached');
    if (latest.stream) latest.stream.close();
    latest.client.end();
  }, timeoutMs);
}

wss.on('connection', createTerminal);

function logConnection(scopeOrConfig, event, status, config = {}, message = '', meta = {}) {
  const userId = scopeOrConfig?.userId || config?.userId;
  if (!userId || !supabaseConfigured) return;
  activityStore.logConnection({
    userId,
    event,
    status,
    host: config.host,
    username: config.username,
    message,
    meta: {
      tmux: Boolean(config.tmux),
      mode: config.mode || 'ssh',
      ...meta
    }
  }).catch((error) => console.warn(`[logs] ${event} failed: ${error.message}`));
}

function sendData(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'data', data }));
  }
}

function sendExit(ws, exitCode) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'exit', exitCode }));
    ws.close();
  }
}

export default server;

if (!process.env.VERCEL) {
  startServer().catch((error) => {
    console.error(`[supabase] startup failed: ${error.message}`);
    process.exit(1);
  });
}

async function startServer() {
  if (supabaseConfigured) {
    await Promise.all([keyStore.init(), profileStore.init(), userStore.init(), activityStore.init()]);
    console.log('[supabase] configured; stores initialized');
  } else {
    console.warn('[supabase] not configured; /api and SSH WebSocket connections will return configuration errors');
  }

  server.listen(port, host, () => {
    const nets = os.networkInterfaces();
    const addresses = Object.values(nets)
      .flat()
      .filter(net => net && net.family === 'IPv4' && !net.internal)
      .map(net => `http://${net.address}:${port}`);
    console.log(`tiny-connect listening on http://localhost:${port}`);
    for (const address of addresses) console.log(`LAN: ${address}`);
    if (startupCommand) console.log(`Startup command: ${startupCommand}`);
  });
}
