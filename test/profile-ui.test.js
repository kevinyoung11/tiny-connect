import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyProfileToConnectionForm, renderProfileOptions } from '../public/profile-ui.js';

test('connection modal places profile selection above profile saving', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');

  assert.ok(html.indexOf('id="profileSelect"') >= 0);
  assert.ok(html.indexOf('id="profileSavePanel"') >= 0);
  assert.ok(html.indexOf('id="profileSelect"') < html.indexOf('id="profileSavePanel"'));
});

test('connection modal uses Saved tab instead of top profile action buttons', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');

  assert.ok(html.includes('data-mode="saved"'));
  assert.ok(!html.includes('data-mode="local"'));
  assert.ok(!html.includes('id="saveProfileBtn"'));
  assert.ok(html.indexOf('id="deleteProfileBtn"') > html.indexOf('id="profileSelect"'));
});

test('renders saved profiles with a placeholder and host context', () => {
  const select = createSelect();

  renderProfileOptions(select, [
    { id: 'profile_1', name: 'Prod', host: 'prod.example.com', username: 'deploy' }
  ]);

  assert.equal(select.children.length, 2);
  assert.equal(select.children[0].value, '');
  assert.equal(select.children[0].textContent, '— Saved connections —');
  assert.equal(select.children[1].value, 'profile_1');
  assert.equal(select.children[1].textContent, 'Prod · deploy@prod.example.com');
});

test('applies a selected profile to the connection form', () => {
  const fields = {
    hostInput: createInput(),
    portInput: createInput(),
    usernameInput: createInput(),
    keyIdInput: createInput(),
    passphraseInput: createInput(),
    useTmuxInput: createCheckbox()
  };

  const applied = applyProfileToConnectionForm(
    { host: 'db.example.com', port: 2202, username: 'root', keyId: 'key_prod', passphrase: 'secret', tmux: true },
    fields
  );

  assert.equal(applied, true);
  assert.equal(fields.hostInput.value, 'db.example.com');
  assert.equal(fields.portInput.value, '2202');
  assert.equal(fields.usernameInput.value, 'root');
  assert.equal(fields.keyIdInput.value, 'key_prod');
  assert.equal(fields.passphraseInput.value, 'secret');
  assert.equal(fields.useTmuxInput.checked, true);
});

function createSelect() {
  return {
    innerHTML: '',
    children: [],
    append(child) {
      this.children.push(child);
    }
  };
}

function createInput() {
  return {
    value: '',
    classList: {
      add() {},
      remove() {}
    }
  };
}

function createCheckbox() {
  return {
    checked: false,
    classList: {
      add() {},
      remove() {}
    }
  };
}
