const PREFIX = 'draft:';

function saveDraft(storage, key, data) {
  try { storage.setItem(PREFIX + key, JSON.stringify(data)); } catch {}
}

function loadDraft(storage, key) {
  try {
    const raw = storage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearDraft(storage, key) {
  try { storage.removeItem(PREFIX + key); } catch {}
}

function listDraftKeys(storage, modulePrefix) {
  const full = PREFIX + modulePrefix;
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.indexOf(full) === 0) out.push(k.slice(PREFIX.length));
    }
  } catch {}
  return out;
}

module.exports = { saveDraft, loadDraft, clearDraft, listDraftKeys };
