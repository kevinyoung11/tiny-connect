import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';
import { WebLinksAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-web-links@0.12.0/+esm';
import { SearchAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-search@0.16.0/+esm';
import { Unicode11Addon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-unicode11@0.9.0/+esm';
import { getDeviceFingerprint, withDeviceIdentity } from './identity.js';
import { applyProfileToConnectionForm, renderProfileMenu } from './profile-ui.js';

const FONT_STACKS = {
  system: '"SF Mono","Fira Code",ui-monospace,Menlo,"Noto Sans Mono CJK SC",monospace',
  jetbrains: '"JetBrains Mono","SF Mono","Noto Sans Mono CJK SC",monospace',
  fira: '"Fira Code","SF Mono","Noto Sans Mono CJK SC",monospace',
  cascadia: '"Cascadia Code","SF Mono","Noto Sans Mono CJK SC",monospace',
  hack: '"Hack","SF Mono","Noto Sans Mono CJK SC",monospace',
  meslo: '"MesloLGS NF","Meslo LG S","SF Mono","Noto Sans Mono CJK SC",monospace',
  'noto-cjk': '"Noto Sans Mono CJK SC","Noto Sans Mono CJK","SF Mono",monospace'
};

const FONT_LABELS = {
  system: 'System Mono',
  jetbrains: 'JetBrains Mono',
  fira: 'Fira Code',
  cascadia: 'Cascadia Code',
  hack: 'Hack',
  meslo: 'Meslo / Nerd Font',
  'noto-cjk': 'Noto Sans Mono CJK'
};

const THEME_LABELS = {
  'tiny-dark': 'Tiny Dark',
  'tokyo-night': 'Tokyo Night',
  dracula: 'Dracula',
  nord: 'Nord',
  catppuccin: 'Catppuccin Mocha',
  'solarized-dark': 'Solarized Dark',
  'gruvbox-dark': 'Gruvbox Dark',
  'github-light': 'GitHub Light',
  'solarized-light': 'Solarized Light',
  'catppuccin-latte': 'Catppuccin Latte',
  'nord-light': 'Nord Light',
  'paper-light': 'Paper Light',
  'rose-pine-dawn': 'Rose Pine Dawn'
};

const TERM_THEMES = {
  'tiny-dark': {
    background: '#09090d', foreground: '#c8ccd6', cursor: '#00d4aa', cursorAccent: '#09090d',
    selectionBackground: 'rgba(0,212,170,0.22)',
    black: '#1a1b26', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#444b6a', brightRed: '#ff7a93', brightGreen: '#b9f27c', brightYellow: '#ff9e64', brightBlue: '#7da6ff', brightMagenta: '#bb9af7', brightCyan: '#0db9d7', brightWhite: '#acb0d0'
  },
  'tokyo-night': { background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5', black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6', brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68', brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5' },
  dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' },
  nord: { background: '#2e3440', foreground: '#d8dee9', cursor: '#88c0d0', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' },
  catppuccin: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc', black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de', brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8' },
  'solarized-dark': { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  'gruvbox-dark': { background: '#282828', foreground: '#ebdbb2', cursor: '#fabd2f', black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984', brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2' },
  'github-light': { background: '#ffffff', foreground: '#24292f', cursor: '#0969da', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#9a6700', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' },
  'solarized-light': { background: '#fdf6e3', foreground: '#657b83', cursor: '#586e75', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3' },
  'catppuccin-latte': { background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78', black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d', blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be', brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc' },
  'nord-light': { background: '#eceff4', foreground: '#2e3440', cursor: '#5e81ac', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#d08770', blue: '#5e81ac', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#ffffff' },
  'paper-light': { background: '#f8f5ed', foreground: '#2f2a24', cursor: '#7c5c28', black: '#2f2a24', red: '#a33b3b', green: '#587539', yellow: '#9a6a1f', blue: '#3d6f9f', magenta: '#7c4f8b', cyan: '#3f7b72', white: '#d8d0c2', brightBlack: '#8b8378', brightRed: '#c44949', brightGreen: '#6d8d45', brightYellow: '#b98228', brightBlue: '#4a83ba', brightMagenta: '#9362a4', brightCyan: '#4f9488', brightWhite: '#fffaf0' },
  'rose-pine-dawn': { background: '#faf4ed', foreground: '#575279', cursor: '#d7827e', black: '#575279', red: '#b4637a', green: '#286983', yellow: '#ea9d34', blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#cecacd', brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34', brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#f2e9e1' }
};

/* ─── Terminal theme ─────────────────────────────────────────────────────── */
const TERM_OPTS = {
  cursorBlink: true,
  convertEol: true,
  scrollback: 10000,
  fontFamily: '"SF Mono","Fira Code",ui-monospace,Menlo,"Noto Sans Mono CJK SC",monospace',
  fontSize: 14,
  lineHeight: 1.3,
  allowProposedApi: false,
  theme: TERM_THEMES['tiny-dark'],
};

/* ─── DOM refs ───────────────────────────────────────────────────────────── */
const backdrop          = document.querySelector('#backdrop');
const connectModal      = document.querySelector('#connectModal');
const connectForm       = document.querySelector('#connectForm');
const connectBtn        = document.querySelector('#connectBtn');
const btnLabel          = connectBtn.querySelector('.btn-label');
const spinner           = document.querySelector('#spinner');
const hostInput         = document.querySelector('#host');
const portInput         = document.querySelector('#port');
const usernameInput     = document.querySelector('#username');
const keyIdInput        = document.querySelector('#keyId');
const passphraseInput   = document.querySelector('#passphrase');
const useTmuxInput      = document.querySelector('#useTmux');
const addKeyBtn         = document.querySelector('#addKeyBtn');
const deleteKeyBtn      = document.querySelector('#deleteKeyBtn');
const keySheet          = document.querySelector('#keySheet');
const closeKeySheet     = document.querySelector('#closeKeySheet');
const keyForm           = document.querySelector('#keyForm');
const keyNameInput      = document.querySelector('#keyName');
const privateKeyInput   = document.querySelector('#privateKey');
const profileToggle     = document.querySelector('#profileToggle');
const profileMenu       = document.querySelector('#profileMenu');
const profileSavePanel  = document.querySelector('#profileSavePanel');
const profileNameInput  = document.querySelector('#profileNameInput');
const profileSaveConfirm = document.querySelector('#profileSaveConfirm');
const profileSaveCancel = document.querySelector('#profileSaveCancel');
const hud               = document.querySelector('#hud');
const statusDot         = document.querySelector('#statusDot');
const hudHost           = document.querySelector('#hudHost');
const hudState          = document.querySelector('#hudState');
const disconnectBtn     = document.querySelector('#disconnectBtn');
const filesBtn          = document.querySelector('#filesBtn');
const settingsBtn       = document.querySelector('#settingsBtn');
const modalSettingsBtn  = document.querySelector('#modalSettingsBtn');
const searchBtn         = document.querySelector('#searchBtn');
const tabBar            = document.querySelector('#tabBar');
const tabList           = document.querySelector('#tabList');
const newTabBtn         = document.querySelector('#newTabBtn');
const workspace         = document.querySelector('#workspace');
const termContainer     = document.querySelector('#termContainer');
const mbar              = document.querySelector('#mbar');
const cmdForm           = document.querySelector('#cmdForm');
const cmdInput          = document.querySelector('#cmdInput');
const pasteBtn          = document.querySelector('#pasteBtn');
const mbarPasteBtn      = document.querySelector('#mbarPasteBtn');
const copyModeBtn       = document.querySelector('#copyModeBtn');
const copyLayer         = document.querySelector('#copyLayer');
const closeCopyLayerBtn = document.querySelector('#closeCopyLayer');
const copyText          = document.querySelector('#copyText');
const debugSheet        = document.querySelector('#debugSheet');
const closeDebugSheetBtn = document.querySelector('#closeDebugSheet');
const debugList         = document.querySelector('#debugList');
const sftpSheet         = document.querySelector('#sftpSheet');
const closeSftpSheetBtn = document.querySelector('#closeSftpSheet');
const sftpPathEl        = document.querySelector('#sftpPath');
const sftpListEl        = document.querySelector('#sftpList');
const sftpUpBtn         = document.querySelector('#sftpUpBtn');
const sftpFileInput     = document.querySelector('#sftpFileInput');
const settingsSheet     = document.querySelector('#settingsSheet');
const closeSettingsSheetBtn = document.querySelector('#closeSettingsSheet');
const settingsForm      = document.querySelector('#settingsForm');
const fontSizeInput     = document.querySelector('#fontSizeInput');
const fontSizeValue     = document.querySelector('#fontSizeValue');
const fontFamilyInput   = document.querySelector('#fontFamilyInput');
const themeInput        = document.querySelector('#themeInput');
const fontPreview       = document.querySelector('#fontPreview');
const fontPreviewMeta   = document.querySelector('#fontPreviewMeta');
const keepaliveInput    = document.querySelector('#keepaliveInput');
const disconnectTimeoutInput = document.querySelector('#disconnectTimeoutInput');
const autoReconnectInput = document.querySelector('#autoReconnectInput');
const addHabitBtn       = document.querySelector('#addHabitBtn');
const habitList         = document.querySelector('#habitList');
const createPairingCodeBtn = document.querySelector('#createPairingCodeBtn');
const pairingCodeBox    = document.querySelector('#pairingCodeBox');
const pairingCodeInput  = document.querySelector('#pairingCodeInput');
const linkDeviceBtn     = document.querySelector('#linkDeviceBtn');
const settingsDebugBtn  = document.querySelector('#settingsDebugBtn');

/* ─── Session class ──────────────────────────────────────────────────────── */
class Session {
  constructor() {
    this.sshSessionId = null;
    this.ws = null;
    this.label = 'New Session';
    this.connected = false;
    this.status = 'disconnected';
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.touchScrollCleanup = null;
    this.manualClose = false;
    this.commandHistory = [];
    this.historyIndex = -1;

    this.el = document.createElement('div');
    this.el.className = 'terminal-pane';
    this.el.hidden = true;
    termContainer.append(this.el);

    this.term = new Terminal(TERM_OPTS);
    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.term.loadAddon(this.searchAddon);
    try {
      const unicode11 = new Unicode11Addon();
      this.term.loadAddon(unicode11);
      this.term.unicode.activeVersion = '11';
    } catch (_) {}
    this.term.open(this.el);
    this.touchScrollCleanup = installTouchScrollBridge(this.el, this.term);
    this.term.onData(data => this.send({ type: 'input', data }));
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  fit() {
    this.fitAddon.fit();
    this.send({ type: 'resize', cols: this.term.cols, rows: this.term.rows });
  }

  activate() {
    this.el.hidden = false;
    requestAnimationFrame(() => {
      this.fitAddon.fit();
      this.send({ type: 'resize', cols: this.term.cols, rows: this.term.rows });
      this.term.focus();
    });
  }

  deactivate() {
    this.el.hidden = true;
  }

  close() {
    clearTimeout(this.reconnectTimer);
    stopHeartbeat(this);
    this.manualClose = true;
    this.touchScrollCleanup?.();
    this.send({ type: 'close' });
    this.ws?.close();
    this.term.dispose();
    this.el.remove();
  }
}

function installTouchScrollBridge(pane, term) {
  let startX = 0;
  let lastY = 0;
  let pendingPixels = 0;
  let dragging = false;

  const lineHeight = () => {
    const screen = pane.querySelector('.xterm-screen');
    const height = Number.parseFloat(getComputedStyle(screen || pane).lineHeight);
    return Number.isFinite(height) && height > 0 ? height : (term.options.fontSize || 14) * (term.options.lineHeight || 1.3);
  };

  const onTouchStart = (event) => {
    if (event.touches.length !== 1 || event.target.closest('button,input,textarea,select')) return;
    const touch = event.touches[0];
    startX = touch.clientX;
    lastY = touch.clientY;
    pendingPixels = 0;
    dragging = true;
  };

  const onTouchMove = (event) => {
    if (!dragging || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaY = lastY - touch.clientY;
    const deltaX = Math.abs(touch.clientX - startX);
    lastY = touch.clientY;

    if (Math.abs(deltaY) < 1 || deltaX > Math.abs(deltaY) * 1.4) return;

    pendingPixels += deltaY;
    const lines = Math.trunc(pendingPixels / lineHeight());
    if (lines === 0) return;

    term.scrollLines(lines);
    pendingPixels -= lines * lineHeight();
    event.preventDefault();
  };

  const onTouchEnd = () => {
    dragging = false;
    pendingPixels = 0;
  };

  pane.addEventListener('touchstart', onTouchStart, { passive: true });
  pane.addEventListener('touchmove', onTouchMove, { passive: false });
  pane.addEventListener('touchend', onTouchEnd, { passive: true });
  pane.addEventListener('touchcancel', onTouchEnd, { passive: true });

  return () => {
    pane.removeEventListener('touchstart', onTouchStart);
    pane.removeEventListener('touchmove', onTouchMove);
    pane.removeEventListener('touchend', onTouchEnd);
    pane.removeEventListener('touchcancel', onTouchEnd);
  };
}

/* ─── State ──────────────────────────────────────────────────────────────── */
let sessions      = [];
let activeSession = null;
let profilesCache = [];
let keysCache     = [];
let appSettings   = {
  fontSize: 14,
  fontFamily: 'system',
  theme: 'tiny-dark',
  keepaliveIntervalSeconds: 30,
  disconnectTimeout: 'never',
  autoReconnect: true,
  habits: []
};
let sftpCwd       = '.';
let sftpSessionId = null;
let debugTab      = 'logs';
let pageSuspended = document.visibilityState === 'hidden';

/* ─── Init ───────────────────────────────────────────────────────────────── */
openModal();
loadSettings();
loadKeys();
loadProfiles();

/* ─── Connect ────────────────────────────────────────────────────────────── */
connectForm.addEventListener('submit', e => { e.preventDefault(); doConnect(); });

function doConnect() {
  setConnecting(true);

  const sess = new Session();
  sessions.push(sess);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
  sess.ws = socket;

  socket.addEventListener('open', () => {
    const config = buildConfig();
    socket.send(JSON.stringify({
      type: 'connect',
      config: { ...config, settings: appSettings },
      deviceFingerprint: getDeviceFingerprint()
    }));
    sess.label = config.mode === 'ssh' ? `${config.username}@${config.host}` : 'local';
    sess.connected = true;
    setSessionStatus(sess, config.tmux ? 'attaching_tmux' : 'connected');
    closeModal();
    showHud();
    showMbar();
    setActiveSession(sess);
    setConnecting(false);
    startHeartbeat(sess);
  });

  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'heartbeat') return;
    if (msg.type === 'data')    sess.term.write(msg.data);
    if (msg.type === 'session') { sess.sshSessionId = msg.id; if (sess === activeSession) updateHud(); }
    if (msg.type === 'status')  setSessionStatus(sess, msg.status, msg.message);
    if (msg.type === 'exit')    onSessionDisconnect(sess, `exited ${msg.exitCode}`);
  });

  socket.addEventListener('close', () => onSessionDisconnect(sess, pageSuspended ? 'suspended' : 'disconnected'));
  socket.addEventListener('error', () => { setConnecting(false); toast('Connection error', 'err'); });
}

function onSessionDisconnect(sess, reason) {
  stopHeartbeat(sess);
  sess.ws = null;
  sess.connected = false;
  const expectedSuspend = reason === 'suspended' && sess.sshSessionId;
  setSessionStatus(sess, expectedSuspend ? 'suspended' : sess.sshSessionId ? 'detached' : 'disconnected');
  if (!expectedSuspend) sess.term.writeln(`\r\n\x1b[2m── ${reason} ──\x1b[0m\r\n`);
  setConnecting(false);
  renderTabs();
  if (sess === activeSession) updateHud();
  if (!sess.manualClose && !expectedSuspend) scheduleReconnect(sess);
}

function buildConfig() {
  const tmux = useTmuxInput?.checked ?? false;
  return {
    mode:       'ssh',
    host:       hostInput.value.trim(),
    port:       portInput.value || '22',
    username:   usernameInput.value.trim(),
    keyId:      keyIdInput.value,
    passphrase: passphraseInput.value,
    tmux,
  };
}

/* ─── Disconnect ─────────────────────────────────────────────────────────── */
disconnectBtn.addEventListener('click', () => {
  if (!activeSession) return;
  activeSession.manualClose = true;
  activeSession.send({ type: 'close' });
  activeSession.ws?.close();
});

function scheduleReconnect(sess) {
  if (!appSettings.autoReconnect || !sess.sshSessionId) return;
  clearTimeout(sess.reconnectTimer);
  setSessionStatus(sess, 'reconnecting');
  sess.reconnectTimer = setTimeout(() => reconnectSession(sess), 1200);
}

function reconnectSession(sess) {
  if (!sess.sshSessionId || sess.ws) return;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/terminal`);
  sess.ws = socket;
  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      type: 'reconnect',
      sessionId: sess.sshSessionId,
      deviceFingerprint: getDeviceFingerprint()
    }));
    startHeartbeat(sess);
  });
  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'heartbeat') return;
    if (msg.type === 'data') sess.term.write(msg.data);
    if (msg.type === 'session') sess.sshSessionId = msg.id;
    if (msg.type === 'status') setSessionStatus(sess, msg.status, msg.message);
    if (msg.type === 'exit') onSessionDisconnect(sess, `exited ${msg.exitCode}`);
  });
  socket.addEventListener('close', () => {
    stopHeartbeat(sess);
    sess.ws = null;
    sess.connected = false;
    setSessionStatus(sess, pageSuspended ? 'suspended' : 'detached');
    renderTabs();
    if (sess === activeSession) updateHud();
    if (!pageSuspended) scheduleReconnect(sess);
  });
  socket.addEventListener('error', () => {
    stopHeartbeat(sess);
    sess.ws = null;
    sess.connected = false;
    setSessionStatus(sess, 'reconnecting');
    renderTabs();
    if (sess === activeSession) updateHud();
  });
  sess.connected = true;
  setSessionStatus(sess, 'reconnecting');
  renderTabs();
  updateHud();
}

function startHeartbeat(sess) {
  stopHeartbeat(sess);
  sess.heartbeatTimer = setInterval(() => {
    sess.send({ type: 'heartbeat', at: Date.now() });
  }, 20000);
}

function stopHeartbeat(sess) {
  clearInterval(sess.heartbeatTimer);
  sess.heartbeatTimer = null;
}

/* ─── Multi-tab management ───────────────────────────────────────────────── */
newTabBtn.addEventListener('click', () => openModal());

function setActiveSession(sess) {
  if (activeSession === sess) { sess.activate(); return; }
  activeSession?.deactivate();
  activeSession = sess;
  sess.activate();
  renderTabs();
  updateHud();
}

function closeSession(sess) {
  sess.close();
  sessions = sessions.filter(s => s !== sess);

  if (activeSession === sess) {
    activeSession = null;
    if (sessions.length > 0) {
      const next = sessions[sessions.length - 1];
      activeSession = next;
      next.activate();
    }
  }

  renderTabs();
  updateHud();

  if (sessions.length === 0) {
    hideHud();
    hideMbar();
    hideTabBar();
    openModal();
  }
}

function renderTabs() {
  tabList.innerHTML = '';
  for (const sess of sessions) {
    const item = document.createElement('div');
    item.className = 'tab-item'
      + (sess === activeSession ? ' active' : '')
      + (sess.connected ? '' : ' disconnected');

    const label = document.createElement('span');
    label.className = 'tab-label';
    label.textContent = sess.label;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.addEventListener('click', e => { e.stopPropagation(); closeSession(sess); });

    item.append(label, closeBtn);
    item.addEventListener('click', () => setActiveSession(sess));
    tabList.append(item);
  }

  if (sessions.length > 0) showTabBar(); else hideTabBar();
}

/* ─── HUD ────────────────────────────────────────────────────────────────── */
function updateHud() {
  const sess = activeSession;
  if (!sess) { filesBtn && (filesBtn.hidden = true); return; }

  hudHost.textContent = sess.label;
  statusDot.classList.toggle('off', !sess.connected);
  hudState.textContent = statusLabel(sess.status);
  hudState.dataset.status = sess.status;
  if (filesBtn) filesBtn.hidden = !(sess.connected && sess.sshSessionId);
}

function setSessionStatus(sess, status, message = '') {
  sess.status = status;
  renderTabs();
  if (sess === activeSession) updateHud();
  if (status === 'restored') toast(message || '已恢复上次会话', 'ok');
  if (status === 'attached_tmux') toast(message || 'Attached to tmux', 'ok');
}

function statusLabel(status) {
  return ({
    connected: 'Connected',
    attaching_tmux: 'Attaching tmux',
    attached_tmux: 'Attached to tmux',
    detached: 'Detached',
    reconnecting: 'Reconnecting',
    restored: 'Restored',
    suspended: 'Suspended',
    disconnected: 'Disconnected'
  })[status] || 'Connected';
}

document.addEventListener('visibilitychange', () => {
  pageSuspended = document.visibilityState === 'hidden';
  if (pageSuspended) {
    for (const sess of sessions) {
      if (sess.connected && sess.sshSessionId) setSessionStatus(sess, 'suspended');
    }
    return;
  }
  resumeSuspendedSessions();
});

window.addEventListener('pageshow', () => {
  pageSuspended = false;
  resumeSuspendedSessions();
});
window.addEventListener('online', resumeSuspendedSessions);

function resumeSuspendedSessions() {
  for (const sess of sessions) {
    if (!sess.manualClose && sess.sshSessionId && !sess.ws) {
      setSessionStatus(sess, 'reconnecting');
      reconnectSession(sess);
    }
  }
}

/* ─── [data-send] buttons ────────────────────────────────────────────────── */
document.querySelectorAll('[data-send]').forEach(btn => {
  btn.addEventListener('click', () => {
    activeSession?.send({ type: 'input', data: btn.dataset.send });
    activeSession?.term.focus();
  });
});

/* ─── Paste ──────────────────────────────────────────────────────────────── */
pasteBtn?.addEventListener('click', pasteToActiveSession);
mbarPasteBtn?.addEventListener('click', pasteToActiveSession);

async function pasteToActiveSession() {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (!text) return;
  cmdInput.value = `${cmdInput.value}${text}`;
  cmdInput.focus();
}

copyModeBtn?.addEventListener('click', openCopyMode);
closeCopyLayerBtn?.addEventListener('click', closeCopyMode);
document.querySelectorAll('[data-copy-scope]').forEach((button) => {
  button.addEventListener('click', () => renderCopyText(button.dataset.copyScope));
});

function openCopyMode(scope = 'screen') {
  if (!activeSession) return;
  renderCopyText(scope);
  copyLayer.removeAttribute('hidden');
}

function renderCopyText(scope = 'screen') {
  if (!activeSession) return;
  const buffer = activeSession.term.buffer.active;
  const lines = [];
  const start = scope === 'screen'
    ? Math.max(0, buffer.baseY)
    : scope === 'tail'
      ? Math.max(0, buffer.length - 80)
      : 0;
  const end = scope === 'screen'
    ? Math.min(buffer.length, buffer.baseY + activeSession.term.rows)
    : buffer.length;
  for (let index = start; index < end; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '');
  }
  copyText.textContent = lines.join('\n').replace(/\n+$/g, '');
}

function closeCopyMode() {
  copyLayer.setAttribute('hidden', '');
  copyText.textContent = '';
}

/* ─── Command bar ────────────────────────────────────────────────────────── */
cmdForm.addEventListener('submit', e => {
  e.preventDefault();
  const val = cmdInput.value;
  if (!val) return;
  activeSession?.send({ type: 'input', data: val + '\r' });
  if (activeSession) {
    activeSession.commandHistory = [val, ...activeSession.commandHistory.filter((item) => item !== val)].slice(0, 50);
    activeSession.historyIndex = -1;
  }
  cmdInput.value = '';
  activeSession?.term.focus();
});

cmdInput.addEventListener('keydown', (event) => {
  if (!activeSession) return;
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeSession.historyIndex = Math.min(activeSession.commandHistory.length - 1, activeSession.historyIndex + 1);
    cmdInput.value = activeSession.commandHistory[activeSession.historyIndex] || cmdInput.value;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeSession.historyIndex = Math.max(-1, activeSession.historyIndex - 1);
    cmdInput.value = activeSession.historyIndex >= 0 ? activeSession.commandHistory[activeSession.historyIndex] : '';
  }
});

document.querySelectorAll('[data-draft]').forEach((button) => {
  button.addEventListener('click', () => {
    cmdInput.value = button.dataset.draft || '';
    cmdInput.focus();
  });
});

searchBtn?.addEventListener('click', () => {
  if (!activeSession) return;
  const term = prompt('Search terminal');
  if (term) activeSession.searchAddon.findNext(term);
});

settingsDebugBtn?.addEventListener('click', openDebugSheet);
closeDebugSheetBtn?.addEventListener('click', closeDebugSheet);
document.querySelectorAll('[data-debug-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    debugTab = button.dataset.debugTab;
    document.querySelectorAll('[data-debug-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
    loadDebugData();
  });
});

/* ─── Resize ─────────────────────────────────────────────────────────────── */
window.addEventListener('resize', () => requestAnimationFrame(() => activeSession?.fit()));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(() => activeSession?.fit()));

async function openDebugSheet() {
  backdrop.classList.add('open');
  debugSheet.removeAttribute('hidden');
  requestAnimationFrame(() => debugSheet.classList.add('open'));
  await loadDebugData();
}

function closeDebugSheet() {
  debugSheet.classList.remove('open');
  setTimeout(() => {
    debugSheet.setAttribute('hidden', '');
    if (connectModal.hasAttribute('hidden') && settingsSheet.hasAttribute('hidden')) backdrop.classList.remove('open');
  }, 220);
}

async function loadDebugData() {
  if (!debugList) return;
  debugList.textContent = 'Loading...';
  try {
    const endpoint = debugTab === 'devices' ? '/api/devices' : '/api/logs?limit=100';
    const res = await fetch(endpoint, withDeviceIdentity());
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Debug unavailable');
    debugList.innerHTML = '';
    if (debugTab === 'devices') renderDevices(body.devices || []);
    else renderLogs(body.logs || []);
  } catch (err) {
    debugList.textContent = err.message;
  }
}

function renderLogs(logs) {
  if (!logs.length) {
    debugList.textContent = 'No logs';
    return;
  }
  for (const log of logs) {
    const row = document.createElement('div');
    row.className = `debug-row debug-row--${log.status}`;
    const time = new Date(log.createdAt).toLocaleString();
    row.innerHTML = `
      <div class="debug-row-main">${escapeHtml(log.event)} · ${escapeHtml(log.status)}</div>
      <div class="debug-row-sub">${escapeHtml(time)} · ${escapeHtml([log.username, log.host].filter(Boolean).join('@'))}</div>
      <div class="debug-row-msg">${escapeHtml(log.message || '')}</div>
    `;
    debugList.append(row);
  }
}

function renderDevices(devices) {
  if (!devices.length) {
    debugList.textContent = 'No devices';
    return;
  }
  for (const device of devices) {
    const row = document.createElement('div');
    row.className = `debug-row${device.current ? ' debug-row--current' : ''}`;
    const seen = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '';
    const unlink = device.current ? '' : `<button type="button" class="mini-btn" data-unlink-device="${escapeAttr(device.id)}">Unlink</button>`;
    row.innerHTML = `
      <div class="debug-row-main">${device.current ? 'Current device' : 'Linked device'} · ${escapeHtml(device.idHash)}</div>
      <div class="debug-row-sub">Last seen ${escapeHtml(seen)}</div>
      <div class="debug-row-msg">${escapeHtml(device.userAgent || '')}</div>
      ${unlink}
    `;
    debugList.append(row);
  }
}

debugList?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-unlink-device]');
  if (!button) return;
  if (!confirm('Unlink this device?')) return;
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(button.dataset.unlinkDevice)}`, withDeviceIdentity({ method: 'DELETE' }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Unlink failed');
    await loadDebugData();
    toast('Device unlinked', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ─── Add key sheet ──────────────────────────────────────────────────────── */
addKeyBtn.addEventListener('click', openKeySheet);
closeKeySheet.addEventListener('click', closeKeySheet_fn);
settingsBtn?.addEventListener('click', openSettingsSheet);
modalSettingsBtn?.addEventListener('click', openSettingsSheet);
closeSettingsSheetBtn?.addEventListener('click', closeSettingsSheetFn);
backdrop?.addEventListener('click', () => {
  if (!debugSheet?.hasAttribute('hidden')) {
    closeDebugSheet();
    return;
  }
  if (!settingsSheet?.hasAttribute('hidden')) closeSettingsSheetFn();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !debugSheet?.hasAttribute('hidden')) closeDebugSheet();
  if (event.key === 'Escape' && !settingsSheet?.hasAttribute('hidden')) closeSettingsSheetFn();
});
addHabitBtn?.addEventListener('click', () => {
  appSettings.habits.push({
    id: `habit-${Date.now()}`,
    name: 'Open Codex',
    command: 'codex',
    priority: appSettings.habits.length + 1,
    enabled: true
  });
  renderSettingsForm();
});
createPairingCodeBtn?.addEventListener('click', createPairingCode);
linkDeviceBtn?.addEventListener('click', linkDevice);
fontSizeInput?.addEventListener('input', () => {
  fontSizeValue.textContent = fontSizeInput.value;
  applySettings({ ...appSettings, fontSize: Number(fontSizeInput.value) });
});
fontFamilyInput?.addEventListener('change', () => {
  applySettings({ ...appSettings, fontFamily: fontFamilyInput.value });
});
themeInput?.addEventListener('change', () => {
  applySettings({ ...appSettings, theme: themeInput.value });
});

settingsForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const next = {
    fontSize: Number(fontSizeInput.value),
    fontFamily: fontFamilyInput.value,
    theme: themeInput.value,
    keepaliveIntervalSeconds: Number(keepaliveInput.value),
    disconnectTimeout: disconnectTimeoutInput.value,
    autoReconnect: autoReconnectInput.checked,
    habits: readHabitForm()
  };
  try {
    const res = await fetch('/api/settings', withDeviceIdentity({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: next })
    }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    applySettings(body.settings);
    renderSettingsForm();
    closeSettingsSheetFn();
    toast('Settings saved', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

keyForm.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = keyForm.querySelector('button[type=submit]');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const res = await fetch('/api/keys', withDeviceIdentity({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: keyNameInput.value, privateKey: privateKeyInput.value }),
    }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    keyNameInput.value = '';
    privateKeyInput.value = '';
    await loadKeys(body.key.id);
    closeKeySheet_fn();
    toast('Key saved', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

/* ─── Delete key ─────────────────────────────────────────────────────────── */
deleteKeyBtn?.addEventListener('click', async () => {
  const id = keyIdInput.value;
  if (!id) return;
  const key = keysCache.find(k => k.id === id);
  if (!confirm(`Delete key "${key?.name || id}"?`)) return;
  try {
    const res = await fetch(`/api/keys/${encodeURIComponent(id)}`, withDeviceIdentity({ method: 'DELETE' }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Delete failed');
    await loadKeys();
    toast('Key deleted', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ─── Profile management ─────────────────────────────────────────────────── */
async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles', withDeviceIdentity());
    const body = await res.json();
    profilesCache = body.profiles || [];
    renderProfilePicker();
  } catch (_) {}
}

function renderProfilePicker() {
  if (!profileMenu) return;
  renderProfileMenu(profileMenu, profilesCache);
  if (profileToggle) profileToggle.disabled = profilesCache.length === 0;
}

profileToggle?.addEventListener('click', () => {
  if (!profilesCache.length) return;
  setProfileMenuOpen(profileMenu.hasAttribute('hidden'));
});

profileMenu?.addEventListener('click', async (event) => {
  const deleteButton = event.target.closest('[data-delete-profile-id]');
  if (deleteButton) {
    event.stopPropagation();
    await deleteProfileById(deleteButton.dataset.deleteProfileId);
    return;
  }

  const item = event.target.closest('[data-profile-id]');
  if (!item) return;
  const profile = profilesCache.find(p => p.id === item.dataset.profileId);
  if (!profile) return;
  setProfileMenuOpen(false);
  applyProfile(profile);
});

document.addEventListener('click', (event) => {
  if (profileMenu?.hasAttribute('hidden')) return;
  if (event.target.closest('.host-combo')) return;
  setProfileMenuOpen(false);
});

function applyProfile(profile) {
  applyProfileToConnectionForm(profile, {
    hostInput,
    portInput,
    usernameInput,
    keyIdInput,
    passphraseInput,
    useTmuxInput,
  });
}

function setProfileMenuOpen(open) {
  if (!profileMenu || !profileToggle) return;
  profileMenu.toggleAttribute('hidden', !open);
  profileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

/* ─── Inline profile save panel ──────────────────────────────────────────── */
profileNameInput?.addEventListener('focus', () => {
  if (profileNameInput.value.trim()) return;
  profileNameInput.value = [usernameInput.value.trim(), hostInput.value.trim()]
    .filter(Boolean).join('@') || '';
  profileNameInput.select();
});

profileSaveCancel?.addEventListener('click', () => { profileNameInput.value = ''; });

profileNameInput?.addEventListener('keydown', e => {
  if (e.key === 'Escape') profileNameInput.value = '';
});

async function doSaveProfile() {
  const name = profileNameInput.value.trim();
  if (!name) { profileNameInput.focus(); return; }
  profileSaveConfirm.disabled = true;
  profileSaveConfirm.textContent = '…';
  try {
    const res = await fetch('/api/profiles', withDeviceIdentity({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        host:     hostInput.value.trim(),
        port:     portInput.value || '22',
        username: usernameInput.value.trim(),
        keyId:    keyIdInput.value,
        passphrase: passphraseInput.value,
        tmux: useTmuxInput?.checked ?? false,
      }),
    }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Save failed');
    await loadProfiles();
    setProfileMenuOpen(false);
    profileNameInput.value = '';
    toast(`Saved host "${name}"`, 'ok');
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    profileSaveConfirm.disabled = false;
    profileSaveConfirm.textContent = 'Save';
  }
}

profileSaveConfirm?.addEventListener('click', doSaveProfile);
profileNameInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); doSaveProfile(); }
});

async function deleteProfileById(id) {
  if (!id) return;
  const profile = profilesCache.find(p => p.id === id);
  if (!confirm(`Delete saved host "${profile?.name || id}"?`)) return;
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, withDeviceIdentity({ method: 'DELETE' }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Delete failed');
    await loadProfiles();
    setProfileMenuOpen(profilesCache.length > 0);
    toast('Saved host deleted', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ─── SFTP ───────────────────────────────────────────────────────────────── */
filesBtn?.addEventListener('click', openSftp);
closeSftpSheetBtn?.addEventListener('click', closeSftp);

function openSftp() {
  const sess = activeSession;
  if (!sess?.sshSessionId) return;
  sftpSessionId = sess.sshSessionId;
  sftpSheet.removeAttribute('hidden');
  requestAnimationFrame(() => sftpSheet.classList.add('open'));
  loadSftpDir('.');
}

function closeSftp() {
  sftpSheet.classList.remove('open');
  setTimeout(() => sftpSheet.setAttribute('hidden', ''), 320);
}

async function loadSftpDir(dir) {
  sftpCwd = dir;
  sftpPathEl.textContent = dir === '.' ? '~' : dir;
  sftpListEl.innerHTML = '<div class="sftp-loading">Loading…</div>';
  try {
    const res = await fetch(`/api/sftp/${sftpSessionId}/ls?path=${encodeURIComponent(dir)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    renderSftpEntries(body.entries, body.path);
  } catch (err) {
    sftpListEl.innerHTML = `<div class="sftp-loading" style="color:var(--danger)">${escHtml(err.message)}</div>`;
  }
}

function renderSftpEntries(entries, basePath) {
  sftpListEl.innerHTML = '';
  if (!entries?.length) {
    sftpListEl.innerHTML = '<div class="sftp-loading">Empty directory</div>';
    return;
  }
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'sftp-entry' + (entry.isDir ? ' is-dir' : '');

    const icon = document.createElement('span');
    icon.className = 'sftp-entry-icon';
    icon.textContent = entry.isDir ? '📁' : '📄';

    const name = document.createElement('span');
    name.className = 'sftp-entry-name';
    name.textContent = entry.name;

    const size = document.createElement('span');
    size.className = 'sftp-entry-size';
    size.textContent = entry.isDir ? '' : fmtSize(entry.size);

    row.append(icon, name, size);

    if (entry.isDir) {
      row.addEventListener('click', () => {
        const next = basePath === '.' ? entry.name : `${basePath}/${entry.name}`;
        loadSftpDir(next);
      });
    } else {
      const filePath = basePath === '.' ? entry.name : `${basePath}/${entry.name}`;
      row.addEventListener('click', () => sftpDownload(filePath, entry.name));
    }
    sftpListEl.append(row);
  }
}

function sftpDownload(filePath, filename) {
  const a = document.createElement('a');
  a.href = `/api/sftp/${sftpSessionId}/download?path=${encodeURIComponent(filePath)}`;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}

sftpUpBtn?.addEventListener('click', () => {
  if (sftpCwd === '.' || sftpCwd === '/') return;
  const parts = sftpCwd.split('/').filter(Boolean);
  parts.pop();
  loadSftpDir(parts.length === 0 ? '/' : '/' + parts.join('/'));
});

sftpFileInput?.addEventListener('change', async () => {
  const files = Array.from(sftpFileInput.files);
  let ok = 0;
  for (const file of files) {
    const remotePath = sftpCwd === '.' ? file.name
      : sftpCwd === '/' ? `/${file.name}`
      : `${sftpCwd}/${file.name}`;
    try {
      const res = await fetch(
        `/api/sftp/${sftpSessionId}/upload?path=${encodeURIComponent(remotePath)}`,
        { method: 'POST', body: file }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      ok++;
    } catch (err) {
      toast(`${file.name}: ${err.message}`, 'err');
    }
  }
  sftpFileInput.value = '';
  if (ok > 0) toast(`Uploaded ${ok} file${ok > 1 ? 's' : ''}`, 'ok');
  loadSftpDir(sftpCwd);
});

/* ─── API helpers ────────────────────────────────────────────────────────── */
async function loadKeys(selectedId = '') {
  try {
    const res  = await fetch('/api/keys', withDeviceIdentity());
    const body = await res.json();
    keysCache = body.keys || [];
    keyIdInput.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = keysCache.length ? '— Select key —' : '— No keys saved —';
    keyIdInput.append(ph);
    for (const key of keysCache) {
      const opt = document.createElement('option');
      opt.value = key.id;
      opt.textContent = key.name;
      keyIdInput.append(opt);
    }
    if (selectedId) keyIdInput.value = selectedId;
    if (deleteKeyBtn) deleteKeyBtn.hidden = !keyIdInput.value;
  } catch (_) {}
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings', withDeviceIdentity());
    const body = await res.json();
    if (res.ok) applySettings(body.settings || {});
    else throw new Error(body.error || 'Settings unavailable');
  } catch (err) {
    toast(err.message, 'err');
  }
  renderSettingsForm();
}

function applySettings(settings) {
  appSettings = {
    fontSize: Number(settings.fontSize) || 14,
    fontFamily: settings.fontFamily || 'system',
    theme: settings.theme || 'tiny-dark',
    keepaliveIntervalSeconds: Number(settings.keepaliveIntervalSeconds) || 30,
    disconnectTimeout: settings.disconnectTimeout || 'never',
    autoReconnect: settings.autoReconnect !== false,
    habits: Array.isArray(settings.habits) ? settings.habits : []
  };
  TERM_OPTS.fontSize = appSettings.fontSize;
  TERM_OPTS.fontFamily = FONT_STACKS[appSettings.fontFamily] || FONT_STACKS.system;
  TERM_OPTS.theme = TERM_THEMES[appSettings.theme] || TERM_THEMES['tiny-dark'];
  if (fontPreview) {
    fontPreview.style.fontSize = `${appSettings.fontSize}px`;
    fontPreview.style.fontFamily = TERM_OPTS.fontFamily;
    fontPreview.style.background = TERM_OPTS.theme.background;
    fontPreview.style.color = TERM_OPTS.theme.foreground;
    fontPreview.style.borderColor = TERM_OPTS.theme.cursor || 'var(--border)';
  }
  if (fontPreviewMeta) {
    fontPreviewMeta.textContent = `${FONT_LABELS[appSettings.fontFamily] || appSettings.fontFamily} · ${THEME_LABELS[appSettings.theme] || appSettings.theme} · ${appSettings.fontSize}px`;
    fontPreviewMeta.style.fontFamily = TERM_OPTS.fontFamily;
    fontPreviewMeta.style.background = TERM_OPTS.theme.background;
    fontPreviewMeta.style.color = TERM_OPTS.theme.foreground;
    fontPreviewMeta.style.borderColor = TERM_OPTS.theme.cursor || 'var(--border)';
  }
  for (const sess of sessions) {
    sess.term.options.fontSize = appSettings.fontSize;
    sess.term.options.fontFamily = TERM_OPTS.fontFamily;
    sess.term.options.theme = TERM_OPTS.theme;
    sess.fit();
  }
}

function renderSettingsForm() {
  if (!settingsForm) return;
  fontSizeInput.value = String(appSettings.fontSize);
  fontSizeValue.textContent = String(appSettings.fontSize);
  fontFamilyInput.value = appSettings.fontFamily;
  themeInput.value = appSettings.theme;
  keepaliveInput.value = String(appSettings.keepaliveIntervalSeconds);
  disconnectTimeoutInput.value = appSettings.disconnectTimeout;
  autoReconnectInput.checked = appSettings.autoReconnect;
  renderHabits();
}

function renderHabits() {
  if (!habitList) return;
  habitList.innerHTML = '';
  if (!appSettings.habits.length) {
    const empty = document.createElement('div');
    empty.className = 'habit-empty';
    empty.textContent = 'No startup habits';
    habitList.append(empty);
    return;
  }
  for (const habit of appSettings.habits) {
    const row = document.createElement('div');
    row.className = 'habit-row';
    row.dataset.id = habit.id;
    row.innerHTML = `
      <input class="habit-enabled" type="checkbox" ${habit.enabled ? 'checked' : ''} aria-label="Enabled" />
      <input class="habit-priority" type="number" min="1" max="999" value="${escapeAttr(habit.priority)}" aria-label="Priority" />
      <input class="habit-name" type="text" value="${escapeAttr(habit.name)}" placeholder="Name" />
      <textarea class="habit-command" rows="2" placeholder="cd ~/project && codex">${escapeHtml(habit.command)}</textarea>
      <button type="button" class="mini-btn habit-delete">Delete</button>
    `;
    row.querySelector('.habit-delete').addEventListener('click', () => {
      appSettings.habits = appSettings.habits.filter((item) => item.id !== habit.id);
      renderSettingsForm();
    });
    habitList.append(row);
  }
}

function readHabitForm() {
  if (!habitList) return [];
  return Array.from(habitList.querySelectorAll('.habit-row')).map((row, index) => ({
    id: row.dataset.id || `habit-${index + 1}`,
    enabled: row.querySelector('.habit-enabled').checked,
    priority: Number(row.querySelector('.habit-priority').value) || index + 1,
    name: row.querySelector('.habit-name').value,
    command: row.querySelector('.habit-command').value
  }));
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

async function createPairingCode() {
  try {
    const res = await fetch('/api/devices/pairing-code', withDeviceIdentity({ method: 'POST' }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Failed to create pairing code');
    pairingCodeBox.hidden = false;
    pairingCodeBox.textContent = `${body.pairing.code} · expires in 10 min`;
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function linkDevice() {
  const code = pairingCodeInput.value.trim();
  if (!code) return;
  try {
    const res = await fetch('/api/devices/link', withDeviceIdentity({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Failed to link device');
    pairingCodeInput.value = '';
    toast('Device linked', 'ok');
    await Promise.all([loadSettings(), loadKeys(), loadProfiles()]);
  } catch (err) {
    toast(err.message, 'err');
  }
}

keyIdInput?.addEventListener('change', () => {
  if (deleteKeyBtn) deleteKeyBtn.hidden = !keyIdInput.value;
});

/* ─── UI state helpers ───────────────────────────────────────────────────── */
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
function closeKeySheet_fn() {
  keySheet.classList.remove('open');
  setTimeout(() => keySheet.setAttribute('hidden', ''), 320);
}

function openSettingsSheet() {
  renderSettingsForm();
  backdrop.classList.add('open');
  settingsSheet.removeAttribute('hidden');
  requestAnimationFrame(() => settingsSheet.classList.add('open'));
}
function closeSettingsSheetFn() {
  settingsSheet.classList.remove('open');
  setTimeout(() => {
    settingsSheet.setAttribute('hidden', '');
    if (connectModal.hasAttribute('hidden')) backdrop.classList.remove('open');
  }, 320);
}

function showHud() {
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

function showTabBar() {
  tabBar.removeAttribute('hidden');
  requestAnimationFrame(() => {
    tabBar.classList.add('open');
    workspace.classList.add('tabs-on');
  });
}
function hideTabBar() {
  tabBar.classList.remove('open');
  workspace.classList.remove('tabs-on');
  setTimeout(() => tabBar.setAttribute('hidden', ''), 300);
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

/* ─── Utility ────────────────────────────────────────────────────────────── */
function fmtSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─── Toast ──────────────────────────────────────────────────────────────── */
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
