export function renderProfileOptions(profileSelect, profiles) {
  if (!profileSelect) return;

  profileSelect.innerHTML = '';
  if (Array.isArray(profileSelect.children)) {
    profileSelect.children.length = 0;
  }

  const placeholder = createOption('', profiles.length ? '— Saved hosts —' : '— No saved hosts —');
  profileSelect.append(placeholder);

  for (const profile of profiles) {
    const host = profile.host ? ` · ${profile.username ? profile.username + '@' : ''}${profile.host}` : '';
    profileSelect.append(createOption(profile.id, profile.name + host));
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

function createOption(value, textContent) {
  if (typeof document !== 'undefined') {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = textContent;
    return option;
  }

  return { value, textContent };
}

function flashFields(fields) {
  for (const field of fields) {
    field.classList?.add?.('field-flash');
    if (typeof setTimeout === 'function') {
      setTimeout(() => field.classList?.remove?.('field-flash'), 600);
    }
  }
}
