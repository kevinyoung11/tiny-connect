import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyProfileToConnectionForm, renderProfileMenu } from '../public/profile-ui.js';

test('connection modal puts saved host picker inside the host row', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');

  assert.ok(html.indexOf('class="host-combo"') >= 0);
  assert.ok(html.indexOf('id="host"') >= 0);
  assert.ok(html.indexOf('id="profileToggle"') >= 0);
  assert.ok(html.indexOf('id="profileMenu"') >= 0);
  assert.ok(html.indexOf('id="profileSavePanel"') >= 0);
  assert.ok(!html.includes('id="profileSelect"'));
  assert.ok(!html.includes('id="deleteProfileBtn"'));
  assert.ok(html.indexOf('id="profileToggle"') > html.indexOf('id="host"'));
  assert.ok(html.indexOf('id="profileMenu"') < html.indexOf('id="port"'));
});

test('connection modal removes the separate Saved tab', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');

  assert.ok(!html.includes('data-mode="saved"'));
  assert.ok(!html.includes('data-mode="local"'));
  assert.ok(!html.includes('id="saveProfileBtn"'));
  assert.ok(!html.includes('id="deleteProfileBtn"'));
});

test('terminal shell exposes recovery status, debug, snippets, and copy scopes', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');

  assert.ok(html.includes('id="hudState"'));
  assert.ok(!html.includes('id="debugBtn"'));
  assert.ok(html.includes('id="settingsDebugBtn"'));
  assert.ok(html.includes('id="debugSheet"'));
  assert.ok(html.includes('id="fontFamilyInput"'));
  assert.ok(html.includes('id="themeInput"'));
  assert.ok(html.includes('id="fontPreviewMeta"'));
  assert.ok(html.includes('<optgroup label="Dark">'));
  assert.ok(html.includes('<optgroup label="Light">'));
  assert.ok(html.includes('value="tokyo-night"'));
  assert.ok(html.includes('value="dracula"'));
  assert.ok(html.includes('value="github-light"'));
  assert.ok(html.includes('value="catppuccin-latte"'));
  assert.ok(html.includes('data-draft="git status"'));
  assert.ok(html.includes('data-copy-scope="screen"'));
  assert.ok(html.includes('data-copy-scope="all"'));
  assert.ok(html.includes('data-copy-scope="tail"'));
});

test('renders saved hosts as menu items with inline delete buttons', () => {
  const menu = createMenu();

  renderProfileMenu(menu, [
    { id: 'profile_1', name: 'Prod', host: 'prod.example.com', username: 'deploy' }
  ]);

  assert.equal(menu.children.length, 1);
  assert.equal(menu.children[0].dataset.profileId, 'profile_1');
  assert.equal(menu.children[0].children[0].textContent, 'Prod');
  assert.equal(menu.children[0].children[1].textContent, 'deploy@prod.example.com');
  assert.equal(menu.children[0].children[2].dataset.deleteProfileId, 'profile_1');
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

function createMenu() {
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
