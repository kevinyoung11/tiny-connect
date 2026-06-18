import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';
import { getDeviceFingerprint, withDeviceIdentity } from './identity.js';
import { applyProfileToConnectionForm, renderProfileOptions } from './profile-ui.js';

/* ─── Terminal theme ─────────────────────────────────────────────────────── */
const TERM_OPTS = {
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
    black:   '#1a1b26', red:     '#f7768e', green:   '#9ece6a', yellow:  '#e0af68',
    blue:    '#7aa2f7', magenta: '#bb9af7', cyan:    '#7dcfff', white:   '#a9b1d6',
    brightBlack:   '#444b6a', brightRed:   '#ff7a93', brightGreen:  '#b9f27c',
    brightYellow:  '#ff9e64', brightBlue:  '#7da6ff', brightMagenta:'#bb9af7',
    brightCyan:    '#0db9d7', brightWhite: '#acb0d0',
  },
};

/* ─── DOM refs ───────────────────────────────────────────────────────────── */
const backdrop          = document.querySelector('#backdrop');
const connectModal      = document.querySelector('#connectModal');
const connectForm       = document.querySelector('#connectForm');
const connectBtn        = document.querySelector('#connectBtn');
const btnLabel          = connectBtn.querySelector('.btn-label');
const spinner           = document.querySelector('#spinner');
const sshFields         = document.querySelector('#sshFields');
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
const savedPanel        = document.querySelector('#savedPanel');
const profileSelect     = document.querySelector('#profileSelect');
const deleteProfileBtn  = document.querySelector('#deleteProfileBtn');
const profileSavePanel  = document.querySelector('#profileSavePanel');
const profileNameInput  = document.querySelector('#profileNameInput');
const profileSaveConfirm = document.querySelector('#profileSaveConfirm');
const profileSaveCancel = document.querySelector('#profileSaveCancel');
const hud               = document.querySelector('#hud');
const statusDot         = document.querySelector('#statusDot');
const hudHost           = document.querySelector('#hudHost');
const disconnectBtn     = document.querySelector('#disconnectBtn');
const filesBtn          = document.querySelector('#filesBtn');
const settingsBtn       = document.querySelector('#settingsBtn');
const modalSettingsBtn  = document.querySelector('#modalSettingsBtn');
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
const fontPreview       = document.querySelector('#fontPreview');
const keepaliveInput    = document.querySelector('#keepaliveInput');
const disconnectTimeoutInput = document.querySelector('#disconnectTimeoutInput');
const autoReconnectInput = document.querySelector('#autoReconnectInput');
const addHabitBtn       = document.querySelector('#addHabitBtn');
const habitList         = document.querySelector('#habitList');
const createPairingCodeBtn = document.querySelector('#createPairingCodeBtn');
const pairingCodeBox    = document.querySelector('#pairingCodeBox');
const pairingCodeInput  = document.querySelector('#pairingCodeInput');
const linkDeviceBtn     = document.querySelector('#linkDeviceBtn');

/* ─── Session class ──────────────────────────────────────────────────────── */
class Session {
  constructor() {
    this.sshSessionId = null;
    this.ws = null;
    this.label = 'New Session';
    this.connected = false;
    this.reconnectTimer = null;
    this.manualClose = false;

    this.el = document.createElement('div');
    this.el.className = 'terminal-pane';
    this.el.hidden = true;
    termContainer.append(this.el);

    this.term = new Terminal(TERM_OPTS);
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(this.el);
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
    this.manualClose = true;
    this.send({ type: 'close' });
    this.ws?.close();
    this.term.dispose();
    this.el.remove();
  }
}

/* ─── State ──────────────────────────────────────────────────────────────── */
let sessions      = [];
let activeSession = null;
let currentMode   = 'ssh';
let profilesCache = [];
let keysCache     = [];
let appSettings   = {
  fontSize: 14,
  keepaliveIntervalSeconds: 30,
  disconnectTimeout: '30m',
  autoReconnect: true,
  habits: []
};
let sftpCwd       = '.';
let sftpSessionId = null;

/* ─── Init ───────────────────────────────────────────────────────────────── */
openModal();
loadSettings();
loadKeys();
loadProfiles();
renderModeTabs();

/* ─── Mode tabs ──────────────────────────────────────────────────────────── */
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
  sshFields.hidden = currentMode === 'saved';
  if (savedPanel) savedPanel.hidden = currentMode !== 'saved';
}

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
    closeModal();
    showHud();
    showMbar();
    setActiveSession(sess);
    setConnecting(false);
  });

  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'data')    sess.term.write(msg.data);
    if (msg.type === 'session') { sess.sshSessionId = msg.id; if (sess === activeSession) updateHud(); }
    if (msg.type === 'exit')    onSessionDisconnect(sess, `exited ${msg.exitCode}`);
  });

  socket.addEventListener('close', () => onSessionDisconnect(sess, 'disconnected'));
  socket.addEventListener('error', () => { setConnecting(false); toast('Connection error', 'err'); });
}

function onSessionDisconnect(sess, reason) {
  sess.ws = null;
  sess.connected = false;
  sess.term.writeln(`\r\n\x1b[2m── ${reason} ──\x1b[0m\r\n`);
  setConnecting(false);
  renderTabs();
  if (sess === activeSession) updateHud();
  if (!sess.manualClose) scheduleReconnect(sess);
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
  });
  socket.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'data') sess.term.write(msg.data);
    if (msg.type === 'session') sess.sshSessionId = msg.id;
    if (msg.type === 'exit') onSessionDisconnect(sess, `exited ${msg.exitCode}`);
  });
  socket.addEventListener('close', () => {
    sess.ws = null;
    sess.connected = false;
    renderTabs();
    if (sess === activeSession) updateHud();
    scheduleReconnect(sess);
  });
  socket.addEventListener('error', () => {
    sess.ws = null;
    sess.connected = false;
    renderTabs();
    if (sess === activeSession) updateHud();
  });
  sess.connected = true;
  renderTabs();
  updateHud();
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
  if (filesBtn) filesBtn.hidden = !(sess.connected && sess.sshSessionId);
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
  if (text) activeSession?.send({ type: 'input', data: text });
  activeSession?.term.focus();
}

copyModeBtn?.addEventListener('click', openCopyMode);
closeCopyLayerBtn?.addEventListener('click', closeCopyMode);

function openCopyMode() {
  if (!activeSession) return;
  const buffer = activeSession.term.buffer.active;
  const lines = [];
  for (let index = 0; index < buffer.length; index += 1) {
    lines.push(buffer.getLine(index)?.translateToString(true) || '');
  }
  copyText.textContent = lines.join('\n').replace(/\n+$/g, '');
  copyLayer.removeAttribute('hidden');
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
  cmdInput.value = '';
  activeSession?.term.focus();
});

/* ─── Resize ─────────────────────────────────────────────────────────────── */
window.addEventListener('resize', () => requestAnimationFrame(() => activeSession?.fit()));
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(() => activeSession?.fit()));

/* ─── Add key sheet ──────────────────────────────────────────────────────── */
addKeyBtn.addEventListener('click', openKeySheet);
closeKeySheet.addEventListener('click', closeKeySheet_fn);
settingsBtn?.addEventListener('click', openSettingsSheet);
modalSettingsBtn?.addEventListener('click', openSettingsSheet);
closeSettingsSheetBtn?.addEventListener('click', closeSettingsSheetFn);
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

settingsForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const next = {
    fontSize: Number(fontSizeInput.value),
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
    renderProfileSelect();
  } catch (_) {}
}

function renderProfileSelect() {
  if (!profileSelect) return;
  renderProfileOptions(profileSelect, profilesCache);
  if (deleteProfileBtn) deleteProfileBtn.hidden = true;
}

profileSelect?.addEventListener('change', () => {
  const profile = profilesCache.find(p => p.id === profileSelect.value);
  if (deleteProfileBtn) deleteProfileBtn.hidden = !profile;
  if (!profile) return;
  currentMode = 'ssh';
  renderModeTabs();
  applyProfileToConnectionForm(profile, {
    hostInput,
    portInput,
    usernameInput,
    keyIdInput,
    passphraseInput,
    useTmuxInput,
  });
});

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
    if (body.profile?.id) {
      profileSelect.value = body.profile.id;
      if (deleteProfileBtn) deleteProfileBtn.hidden = false;
    }
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

deleteProfileBtn?.addEventListener('click', async () => {
  const id = profileSelect.value;
  if (!id) return;
  const profile = profilesCache.find(p => p.id === id);
  if (!confirm(`Delete saved host "${profile?.name || id}"?`)) return;
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(id)}`, withDeviceIdentity({ method: 'DELETE' }));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Delete failed');
    await loadProfiles();
    toast('Saved host deleted', 'ok');
  } catch (err) {
    toast(err.message, 'err');
  }
});

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
    keepaliveIntervalSeconds: Number(settings.keepaliveIntervalSeconds) || 30,
    disconnectTimeout: settings.disconnectTimeout || '30m',
    autoReconnect: settings.autoReconnect !== false,
    habits: Array.isArray(settings.habits) ? settings.habits : []
  };
  TERM_OPTS.fontSize = appSettings.fontSize;
  if (fontPreview) fontPreview.style.fontSize = `${appSettings.fontSize}px`;
  for (const sess of sessions) {
    sess.term.options.fontSize = appSettings.fontSize;
    sess.fit();
  }
}

function renderSettingsForm() {
  if (!settingsForm) return;
  fontSizeInput.value = String(appSettings.fontSize);
  fontSizeValue.textContent = String(appSettings.fontSize);
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
  settingsSheet.removeAttribute('hidden');
  requestAnimationFrame(() => settingsSheet.classList.add('open'));
}
function closeSettingsSheetFn() {
  settingsSheet.classList.remove('open');
  setTimeout(() => settingsSheet.setAttribute('hidden', ''), 320);
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
