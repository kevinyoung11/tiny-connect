import { Terminal } from '/xterm/lib/xterm.js';
import { FitAddon } from '/xterm-fit/lib/addon-fit.js';

const status = document.querySelector('#status');
const connectForm = document.querySelector('#connectForm');
const modeInput = document.querySelector('#mode');
const sshFields = document.querySelectorAll('[data-ssh-field]');
const hostInput = document.querySelector('#host');
const portInput = document.querySelector('#port');
const usernameInput = document.querySelector('#username');
const keyIdInput = document.querySelector('#keyId');
const passphraseInput = document.querySelector('#passphrase');
const keyForm = document.querySelector('#keyForm');
const keyNameInput = document.querySelector('#keyName');
const privateKeyInput = document.querySelector('#privateKey');
const terminalHost = document.querySelector('#terminal');
const commandBar = document.querySelector('#commandBar');
const commandInput = document.querySelector('#commandInput');
const pasteButton = document.querySelector('#paste');

const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'Menlo, "SF Mono", "Noto Sans Mono CJK SC", "Source Han Mono SC", monospace',
  fontSize: 14,
  lineHeight: 1.25,
  allowProposedApi: false,
  theme: {
    background: '#101214',
    foreground: '#e6e8eb',
    cursor: '#f7d35f',
    selectionBackground: '#315f7d'
  }
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalHost);
fitAddon.fit();

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
let ws = null;
updateModeFields();
loadKeys();

function connect() {
  const socket = new WebSocket(`${protocol}//${window.location.host}/terminal`);
  status.textContent = 'connecting';

  socket.addEventListener('open', () => {
    status.textContent = 'connected';
    socket.send(JSON.stringify({ type: 'connect', config: readConnectionConfig() }));
    connectForm.classList.add('is-connected');
    resize();
    term.focus();
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'data') {
      term.write(message.data);
    }
    if (message.type === 'exit') {
      status.textContent = `exited ${message.exitCode}`;
    }
  });

  socket.addEventListener('close', () => {
    status.textContent = 'closed';
    connectForm.classList.remove('is-connected');
  });

  return socket;
}

connectForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  term.clear();
  ws = connect();
});

modeInput.addEventListener('change', updateModeFields);

keyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = 'saving key';

  const response = await fetch('/api/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: keyNameInput.value,
      privateKey: privateKeyInput.value
    })
  });

  const body = await response.json();
  if (!response.ok) {
    status.textContent = body.error || 'key save failed';
    return;
  }

  keyNameInput.value = '';
  privateKeyInput.value = '';
  await loadKeys(body.key.id);
  status.textContent = 'key saved';
});

term.onData((data) => {
  send({ type: 'input', data });
});

document.querySelectorAll('[data-send]').forEach((button) => {
  button.addEventListener('click', () => {
    send({ type: 'input', data: button.dataset.send });
    term.focus();
  });
});

pasteButton.addEventListener('click', async () => {
  const text = await navigator.clipboard.readText();
  send({ type: 'input', data: text });
  term.focus();
});

commandBar.addEventListener('submit', (event) => {
  event.preventDefault();
  const value = commandInput.value;
  if (!value) return;
  send({ type: 'input', data: `${value}\r` });
  commandInput.value = '';
  term.focus();
});

window.addEventListener('resize', () => {
  window.requestAnimationFrame(resize);
});

function resize() {
  fitAddon.fit();
  send({ type: 'resize', cols: term.cols, rows: term.rows });
}

function send(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function updateModeFields() {
  const isSsh = modeInput.value === 'ssh';
  document.body.classList.toggle('is-ssh', isSsh);
  sshFields.forEach((field) => {
    field.hidden = !isSsh;
    field.required = isSsh && field.id !== 'passphrase' && field.id !== 'port';
  });
}

function readConnectionConfig() {
  if (modeInput.value === 'local') {
    return { mode: 'local' };
  }

  return {
    mode: 'ssh',
    host: hostInput.value,
    port: portInput.value || '22',
    username: usernameInput.value,
    keyId: keyIdInput.value,
    passphrase: passphraseInput.value
  };
}

async function loadKeys(selectedId = '') {
  const response = await fetch('/api/keys');
  const body = await response.json();
  keyIdInput.textContent = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = body.keys.length ? 'Select key' : 'No keys saved';
  keyIdInput.append(placeholder);

  for (const key of body.keys) {
    const option = document.createElement('option');
    option.value = key.id;
    option.textContent = key.name;
    keyIdInput.append(option);
  }

  if (selectedId) {
    keyIdInput.value = selectedId;
  }
}
