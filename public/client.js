import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';

/* ─── DOM refs ──────────────────────────────────────────────────────────── */
const backdrop     = document.querySelector('#backdrop');
const connectModal = document.querySelector('#connectModal');
const connectForm  = document.querySelector('#connectForm');
const connectBtn   = document.querySelector('#connectBtn');
const btnLabel     = connectBtn.querySelector('.btn-label');
const spinner      = document.querySelector('#spinner');
const sshFields    = document.querySelector('#sshFields');
const hostInput    = document.querySelector('#host');
const portInput    = document.querySelector('#port');
const usernameInput = document.querySelector('#username');
const keyIdInput   = document.querySelector('#keyId');
const passphraseInput = document.querySelector('#passphrase');
const addKeyBtn    = document.querySelector('#addKeyBtn');
const keySheet     = document.querySelector('#keySheet');
const closeKeySheet = document.querySelector('#closeKeySheet');
const keyForm      = document.querySelector('#keyForm');
const keyNameInput = document.querySelector('#keyName');
const privateKeyInput = document.querySelector('#privateKey');
const hud          = document.querySelector('#hud');
const hudHost      = document.querySelector('#hudHost');
const disconnectBtn = document.querySelector('#disconnectBtn');
const workspace    = document.querySelector('#workspace');
const terminalEl   = document.querySelector('#terminal');
const mbar         = document.querySelector('#mbar');
const cmdForm      = document.querySelector('#cmdForm');
const cmdInput     = document.querySelector('#cmdInput');
const pasteBtn     = document.querySelector('#pasteBtn');

/* ─── Terminal ──────────────────────────────────────────────────────────── */
const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  scrollback: 5000,
  fontFamily: '"SF Mono","Fira Code",ui-monospace,Menlo,"Noto Sans Mono CJK SC",monospace',
  fontSize: 14,
  lineHeight: 1.3,
  allowProposedApi: false,
  theme: {
    background:          '#09090d',
    foreground:          '#c8ccd6',
    cursor:              '#00d4aa',
    cursorAccent:        '#09090d',
    selectionBackground: 'rgba(0,212,170,0.22)',
    black:               '#1a1b26',
    red:                 '#f7768e',
    green:               '#9ece6a',
    yellow:              '#e0af68',
    blue:                '#7aa2f7',
    magenta:             '#bb9af7',
    cyan:                '#7dcfff',
    white:               '#a9b1d6',
    brightBlack:         '#444b6a',
    brightRed:           '#ff7a93',
    brightGreen:         '#b9f27c',
    brightYellow:        '#ff9e64',
    brightBlue:          '#7da6ff',
    brightMagenta:       '#bb9af7',
    brightCyan:          '#0db9d7',
    brightWhite:         '#acb0d0',
  },
});

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);
term.open(terminalEl);
fitAddon.fit();

/* ─── State ─────────────────────────────────────────────────────────────── */
let ws          = null;
let currentMode = 'ssh';

/* ─── Init ──────────────────────────────────────────────────────────────── */
openModal();
loadKeys();
renderModeTabs();

/* ─── Mode tabs ─────────────────────────────────────────────────────────── */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    currentMode = tab.dataset.mode;
    renderModeTabs();
  });
});

function renderModeTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.mode === currentMode;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  sshFields.hidden = currentMode !== 'ssh';
}

/* ─── Connect ───────────────────────────────────────────────────────────── */
connectForm.addEventListener('submit', e => {
  e.preventDefault();
  doConnect();
});

function doConnect() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.close();
    term.clear();
  }
  setConnecting(true);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
  ws = socket;

  socket.addEventListener('open', () => {
    const config = buildConfig();
    socket.send(JSON.stringify({ type: 'connect', config }));
    closeModal();
    showHud(config.mode === 'ssh' ? `${config.username}@${config.host}` : 'local');
    showMbar();
    fit();
    term.focus();
    setConnecting(false);
  });

  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'data') term.write(msg.data);
    if (msg.type === 'exit') handleDisconnect(`exited ${msg.exitCode}`);
  });

  socket.addEventListener('close', () => handleDisconnect('disconnected'));

  socket.addEventListener('error', () => {
    setConnecting(false);
    toast('Connection error', 'err');
  });
}

function handleDisconnect(reason) {
  ws = null;
  hideHud();
  hideMbar();
  openModal();
  term.writeln(`\r\n\x1b[2m── ${reason} ──\x1b[0m\r\n`);
  setConnecting(false);
}

function buildConfig() {
  if (currentMode === 'local') return { mode: 'local' };
  return {
    mode:       'ssh',
    host:       hostInput.value.trim(),
    port:       portInput.value || '22',
    username:   usernameInput.value.trim(),
    keyId:      keyIdInput.value,
    passphrase: passphraseInput.value,
  };
}

/* ─── Disconnect ────────────────────────────────────────────────────────── */
disconnectBtn.addEventListener('click', () => ws?.close());

/* ─── Add key sheet ─────────────────────────────────────────────────────── */
addKeyBtn.addEventListener('click', openKeySheet);
closeKeySheet.addEventListener('click', closeSheet);

keyForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = keyForm.querySelector('button[type=submit]');
  btn.disabled = true;
  const orig = btn.querySelector('.btn-label')?.textContent || btn.textContent;
  btn.textContent = 'Saving…';

  try {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: keyNameInput.value, privateKey: privateKeyInput.value }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');

    keyNameInput.value   = '';
    privateKeyInput.value = '';
    await loadKeys(body.key.id);
    closeSheet();
    toast('Key saved', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

/* ─── Terminal → server ─────────────────────────────────────────────────── */
term.onData(data => send({ type: 'input', data }));

/* ─── [data-send] buttons ───────────────────────────────────────────────── */
document.querySelectorAll('[data-send]').forEach(btn => {
  btn.addEventListener('click', () => {
    send({ type: 'input', data: btn.dataset.send });
    term.focus();
  });
});

/* ─── Paste ─────────────────────────────────────────────────────────────── */
pasteBtn?.addEventListener('click', async () => {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (text) send({ type: 'input', data: text });
  term.focus();
});

/* ─── Command bar ───────────────────────────────────────────────────────── */
cmdForm.addEventListener('submit', e => {
  e.preventDefault();
  const val = cmdInput.value;
  if (!val) return;
  send({ type: 'input', data: val + '\r' });
  cmdInput.value = '';
  term.focus();
});

/* ─── Resize ────────────────────────────────────────────────────────────── */
window.addEventListener('resize', () => requestAnimationFrame(fit));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(fit));

function fit() {
  fitAddon.fit();
  send({ type: 'resize', cols: term.cols, rows: term.rows });
}

/* ─── API helpers ───────────────────────────────────────────────────────── */
function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function loadKeys(selectedId = '') {
  try {
    const res  = await fetch('/api/keys');
    const body = await res.json();

    keyIdInput.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = body.keys.length ? '— Select key —' : '— No keys saved —';
    keyIdInput.append(ph);

    for (const key of body.keys) {
      const opt = document.createElement('option');
      opt.value = key.id;
      opt.textContent = key.name;
      keyIdInput.append(opt);
    }
    if (selectedId) keyIdInput.value = selectedId;
  } catch (_) {}
}

/* ─── UI state helpers ──────────────────────────────────────────────────── */
function openModal() {
  backdrop.classList.add('open');
  connectModal.removeAttribute('hidden');
  requestAnimationFrame(() => connectModal.classList.add('open'));
}
function closeModal() {
  backdrop.classList.remove('open');
  connectModal.classList.remove('open');
  setTimeout(() => connectModal.setAttribute('hidden', ''), 300);
}

function openKeySheet() {
  keySheet.removeAttribute('hidden');
  requestAnimationFrame(() => keySheet.classList.add('open'));
}
function closeSheet() {
  keySheet.classList.remove('open');
  setTimeout(() => keySheet.setAttribute('hidden', ''), 320);
}

function showHud(host) {
  hudHost.textContent = host;
  hud.removeAttribute('hidden');
  requestAnimationFrame(() => {
    hud.classList.add('open');
    workspace.classList.add('hud-on');
  });
}
function hideHud() {
  hud.classList.remove('open');
  workspace.classList.remove('hud-on');
  setTimeout(() => hud.setAttribute('hidden', ''), 300);
}

function showMbar() {
  mbar.removeAttribute('hidden');
  requestAnimationFrame(() => {
    mbar.classList.add('open');
    workspace.classList.add('mbar-on');
  });
}
function hideMbar() {
  mbar.classList.remove('open');
  workspace.classList.remove('mbar-on');
  setTimeout(() => mbar.setAttribute('hidden', ''), 300);
}

function setConnecting(on) {
  connectBtn.disabled = on;
  btnLabel.hidden = on;
  spinner.hidden  = !on;
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */
let toastEl, toastTimer;
function toast(msg, type = '') {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.className = `toast${type ? ` ${type}` : ''}`;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}
