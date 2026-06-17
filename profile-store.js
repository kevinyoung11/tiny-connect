import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createProfileStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'profiles.json');

  function read() {
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { return []; }
  }

  function write(profiles) {
    fs.writeFileSync(file, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  }

  return {
    listProfiles() {
      return read();
    },

    createProfile({ name, host, port, username, keyId, passphrase, tmux }) {
      const cleanName = requiredString(name, 'name');
      const id = slugify(cleanName) + '-' + crypto.randomBytes(4).toString('hex');
      const profile = {
        id,
        name: cleanName,
        host: String(host || ''),
        port: String(port || '22'),
        username: String(username || ''),
        keyId: String(keyId || ''),
        passphrase: String(passphrase || ''),
        tmux: Boolean(tmux),
      };
      const profiles = read();
      profiles.push(profile);
      write(profiles);
      return profile;
    },

    deleteProfile(id) {
      const profiles = read();
      const next = profiles.filter(p => p.id !== id);
      if (next.length === profiles.length) throw new Error(`profile not found: ${id}`);
      write(next);
    }
  };
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function slugify(value) {
  const s = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return s || 'profile';
}
