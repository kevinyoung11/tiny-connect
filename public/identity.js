const storageKey = 'tinyconnect.deviceFingerprint';

export function getDeviceFingerprint() {
  const stored = localStorage.getItem(storageKey);
  if (stored) return stored;

  const raw = [
    navigator.userAgent || '',
    navigator.language || '',
    screen.width || 0,
    screen.height || 0,
    screen.colorDepth || 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  ].join('|');
  const fingerprint = `fp_${hashString(raw)}`;
  localStorage.setItem(storageKey, fingerprint);
  return fingerprint;
}

export function withDeviceIdentity(init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('X-Device-Fingerprint', getDeviceFingerprint());
  return { ...init, headers };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
