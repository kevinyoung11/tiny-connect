import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const metadataFile = 'keys.json';

export function createKeyStore(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadataPath = path.join(directory, metadataFile);

  function readMetadata() {
    if (!fs.existsSync(metadataPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }

  function writeMetadata(keys) {
    fs.writeFileSync(metadataPath, JSON.stringify(keys, null, 2), { mode: 0o600 });
  }

  return {
    createKey({ name, privateKey }) {
      const cleanName = requiredString(name, 'name');
      const keyMaterial = requiredString(privateKey, 'privateKey');
      const id = slugify(cleanName) + '-' + crypto.randomBytes(4).toString('hex');
      const privateKeyPath = path.join(directory, `${id}.key`);

      fs.writeFileSync(privateKeyPath, normalizePrivateKey(keyMaterial), { mode: 0o600 });

      const keys = readMetadata();
      keys.push({ id, name: cleanName, privateKeyPath });
      writeMetadata(keys);

      return { id, name: cleanName, privateKeyPath };
    },

    listKeys() {
      return readMetadata().map(({ id, name }) => ({ id, name }));
    },

    getPrivateKeyPath(id) {
      const cleanId = requiredString(id, 'keyId');
      const key = readMetadata().find((item) => item.id === cleanId);
      if (!key) {
        throw new Error(`key not found: ${cleanId}`);
      }
      return key.privateKeyPath;
    },

    deleteKey(id) {
      const cleanId = requiredString(id, 'keyId');
      const keys = readMetadata();
      const idx = keys.findIndex(k => k.id === cleanId);
      if (idx === -1) throw new Error(`key not found: ${cleanId}`);
      const [removed] = keys.splice(idx, 1);
      try { fs.unlinkSync(removed.privateKeyPath); } catch (_) {}
      writeMetadata(keys);
    }
  };
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function normalizePrivateKey(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function slugify(value) {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'key';
}
