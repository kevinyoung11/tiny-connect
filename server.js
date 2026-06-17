import os from 'node:os';
import path from 'node:path';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const defaultShell = os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh';
const shell = process.env.TERMINAL_SHELL || defaultShell;
const startupCommand = process.env.STARTUP_COMMAND || '';
const keyStore = createKeyStore(path.join(__dirname, '.keys'));

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/xterm', express.static(path.join(__dirname, 'node_modules', '@xterm', 'xterm')));
app.use('/xterm-fit', express.static(path.join(__dirname, 'node_modules', '@xterm', 'addon-fit')));

app.get('/api/keys', (req, res) => {
  res.json({ keys: keyStore.listKeys() });
});

app.post('/api/keys', (req, res) => {
  try {
    const key = keyStore.createKey({
      name: req.body?.name,
      privateKey: req.body?.privateKey
    });
    res.status(201).json({ key: { id: key.id, name: key.name } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/terminal' });

function createTerminal(ws) {
  let transport = null;
  let connected = false;
  const fallbackTimer = setTimeout(() => {
    if (!connected) {
      connected = true;
      transport = createLocalTransport(ws);
    }
  }, 1000);

  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'connect' && !connected) {
      clearTimeout(fallbackTimer);
      connected = true;
      try {
        const config = buildConnectionConfig(message.config || {}, {
          resolveKeyPath: (keyId) => keyStore.getPrivateKeyPath(keyId)
        });
        transport = config.mode === 'ssh'
          ? createSshTransport(ws, config)
          : createLocalTransport(ws);
      } catch (error) {
        sendData(ws, `Connection configuration error: ${error.message}\r\n`);
        ws.close();
      }
      return;
    }

    if (!transport) {
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
    if (transport) {
      transport.close();
    }
  });
}

function createLocalTransport(ws) {
  const bridge = spawn('python3', [path.join(__dirname, 'pty_bridge.py')], {
    cwd: os.homedir(),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TERMINAL_SHELL: shell,
      STARTUP_COMMAND: startupCommand,
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_CTYPE: process.env.LC_CTYPE || 'en_US.UTF-8',
      TERM: 'xterm-256color'
    }
  });

  bridge.on('error', (error) => {
    sendData(ws, `Failed to start terminal bridge\r\n${error.message}\r\n`);
    ws.close();
  });

  bridge.stdout.on('data', (data) => {
    sendData(ws, data.toString('utf8'));
  });

  bridge.stderr.on('data', (data) => {
    sendData(ws, data.toString('utf8'));
  });

  bridge.on('exit', (exitCode) => {
    sendExit(ws, exitCode);
  });

  return {
    input(data) {
      bridge.stdin.write(JSON.stringify({ type: 'input', data }) + '\n');
    },
    resize(cols, rows) {
      bridge.stdin.write(JSON.stringify({ type: 'resize', cols, rows }) + '\n');
    },
    close() {
      bridge.kill();
    }
  };
}

function createSshTransport(ws, config) {
  const client = new Client();
  let stream = null;

  client.on('ready', () => {
    sendData(ws, `SSH connected to ${config.username}@${config.host}\r\n`);
    client.shell({
      term: 'xterm-256color',
      cols: 80,
      rows: 24,
      modes: {
        ECHO: 1,
        ICANON: 1,
        ISIG: 1
      }
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
        client.end();
        sendExit(ws, 0);
      });

      if (startupCommand) {
        stream.write(`${startupCommand}\r`);
      }
    });
  });

  client.on('error', (error) => {
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
    input(data) {
      if (stream) {
        stream.write(data);
      }
    },
    resize(cols, rows) {
      if (stream) {
        stream.setWindow(rows, cols, 0, 0);
      }
    },
    close() {
      if (stream) {
        stream.close();
      }
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

server.listen(port, host, () => {
  const nets = os.networkInterfaces();
  const addresses = Object.values(nets)
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => `http://${net.address}:${port}`);

  console.log(`yy-terminal listening on http://localhost:${port}`);
  for (const address of addresses) {
    console.log(`LAN: ${address}`);
  }
  if (startupCommand) {
    console.log(`Startup command: ${startupCommand}`);
  }
});
