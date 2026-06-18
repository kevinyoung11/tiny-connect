export function renderProfileMenu(profileMenu, profiles) {
  if (!profileMenu) return;

  profileMenu.innerHTML = '';
  if (Array.isArray(profileMenu.children)) {
    profileMenu.children.length = 0;
  }

  if (!profiles.length) {
    profileMenu.append(createEmptyItem());
    return;
  }

  for (const profile of profiles) {
    profileMenu.append(createProfileItem(profile));
  }
}

export function applyProfileToConnectionForm(profile, fields) {
  if (!profile) return false;

  fields.hostInput.value = profile.host || '';
  fields.portInput.value = String(profile.port || '22');
  fields.usernameInput.value = profile.username || '';

  const keyId = profile.keyId || profile.key_id;
  fields.keyIdInput.value = keyId || '';
  fields.passphraseInput.value = profile.passphrase || '';
  fields.useTmuxInput.checked = Boolean(profile.tmux);

  flashFields([
    fields.hostInput,
    fields.portInput,
    fields.usernameInput,
    fields.keyIdInput,
    fields.passphraseInput
  ]);
  return true;
}

function createProfileItem(profile) {
  const subtitle = profile.host ? `${profile.username ? profile.username + '@' : ''}${profile.host}` : '';

  if (typeof document !== 'undefined') {
    const item = document.createElement('div');
    item.className = 'profile-menu-item';
    item.dataset.profileId = profile.id;
    item.setAttribute('role', 'option');
    item.append(createProfileText(profile.name, 'profile-menu-name'));
    item.append(createProfileText(subtitle, 'profile-menu-sub'));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'profile-menu-delete';
    deleteButton.dataset.deleteProfileId = profile.id;
    deleteButton.setAttribute('aria-label', `Delete ${profile.name}`);
    deleteButton.textContent = 'Delete';
    item.append(deleteButton);
    return item;
  }

  return {
    dataset: { profileId: profile.id },
    children: [
      { textContent: profile.name },
      { textContent: subtitle },
      { dataset: { deleteProfileId: profile.id }, textContent: 'Delete' }
    ]
  };
}

function createEmptyItem() {
  if (typeof document !== 'undefined') {
    const item = document.createElement('div');
    item.className = 'profile-menu-empty';
    item.textContent = 'No saved hosts';
    return item;
  }
  return { textContent: 'No saved hosts' };
}

function createProfileText(textContent, className) {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = textContent;
  return el;
}

function flashFields(fields) {
  for (const field of fields) {
    field.classList?.add?.('field-flash');
    if (typeof setTimeout === 'function') {
      setTimeout(() => field.classList?.remove?.('field-flash'), 600);
    }
  }
}
