import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import http from 'node:http';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';
import { buildConnectionConfig } from './connection-config.js';
import { createKeyStore } from './key-store.js';
import { createProfileStore } from './profile-store.js';
import { createSupabaseKeyStore, createSupabaseProfileStore, isSupabaseConfigured } from './supabase-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';
const shell = process.env.TERMINAL_SHELL || defaultShell;
const startupCommand = process.env.STARTUP_COMMAND || '';

const keysDir = process.env.VERCEL ? '/tmp/.keys' : path.join(__dirname, '.keys');
const profilesDir = process.env.VERCEL ? '/tmp/.profiles' : path.join(__dirname, '.profiles');

let keyStore, profileStore;
if (isSupabaseConfigured()) {
  keyStore = createSupabaseKeyStore(keysDir);
  profileStore = createSupabaseProfileStore();
  // init() is async; errors are non-fatal (falls through to file store on individual ops)
  Promise.all([keyStore.init(), profileStore.init()])
    .then(() => console.log('[supabase] connected and tables ready'))
    .catch(err => console.error('[supabase] init failed, file store still available:', err.message));
} else {
  keyStore = createKeyStore(keysDir);
  profileStore = createProfileStore(profilesDir);
}

// sessionId → { client: ssh2.Client, config }
const sshSessions = new Map();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm')));
app.use('/xterm-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit')));

/* ── SSH Key endpoints ─────────────────────────────────────────────────────── */
app.get('/api/keys', async (req, res) => {
  try {
    const keys = await Promise.resolve(keyStore.listKeys());
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/keys', async (req, res) => {
  try {
    const key = await Promise.resolve(keyStore.createKey({ name: req.body?.name, privateKey: req.body?.privateKey }));
    res.status(201).json({ key: { id: key.id, name: key.name } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/keys/:id', async (req, res) => {
  try {
    await Promise.resolve(keyStore.deleteKey?.(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

/* ── Profile endpoints ─────────────────────────────────────────────────────── */
app.get('/api/profiles', async (req, res) => {
  try {
    const profiles = await Promise.resolve(profileStore.listProfiles());
    res.json({ profiles });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/profiles', async (req, res) => {
  try {
    const profile = await Promise.resolve(profileStore.createProfile(req.body || {}));
    res.status(201).json({ profile });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/profiles/:id', async (req, res) => {
  try {
    await Promise.resolve(profileStore.deleteProfile(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

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
      try {
        const config = buildConnectionConfig(message.config || {}, {
          resolveKeyPath: (keyId) => keyStore.getPrivateKeyPath(keyId)
        });
        if (config.mode === 'ssh') {
          transport = createSshTransport(ws, config);
        } else {
          transport = createLocalTransport(ws, { tmux: message.config?.tmux === true });
        }
      } catch (error) {
        sendData(ws, `Connection configuration error: ${error.message}\r\n`);
        ws.close();
      }
      return;
    }

    if (!transport) return;

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
    input(data) { bridge.stdin.write(JSON.stringify({ type: 'input', data }) + '\n'); },
    resize(cols, rows) { bridge.stdin.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n'); },
    close() { bridge.kill(); }
  };
}

function createSshTransport(ws, config) {
  const sessionId = randomUUID();
  const client = new Client();
  let stream = null;

  client.on('ready', () => {
    sshSessions.set(sessionId, { client, config });
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'session', id: sessionId }));
    }
    sendData(ws, `SSH connected to ${config.username}@${config.host}\r\n`);

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
      stream.on('data', (data) => sendData(ws, data.toString('utf8')));
      stream.stderr.on('data', (data) => sendData(ws, data.toString('utf8')));
      stream.on('close', () => {
        sshSessions.delete(sessionId);
        client.end();
        sendExit(ws, 0);
      });

      if (config.tmux) {
        setTimeout(() => { if (stream) stream.write('tmux new-session -A -s tc\r'); }, 400);
      } else if (startupCommand) {
        stream.write(`${startupCommand}\r`);
      }
    });
  });

  client.on('error', (error) => {
    sshSessions.delete(sessionId);
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
      keepaliveInterval: 30000
    });
  } catch (error) {
    sendData(ws, `SSH setup failed: ${error.message}\r\n`);
    ws.close();
  }

  return {
    input(data) { if (stream) stream.write(data); },
    resize(cols, rows) { if (stream) stream.setWindow(rows, cols, 0, 0); },
    close() {
      sshSessions.delete(sessionId);
      if (stream) stream.close();
      client.end();
    }
  };
}

wss.on('connection', createTerminal);

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
