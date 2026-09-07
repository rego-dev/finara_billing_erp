const REDIRECT_KEY = 'postLoginRedirect';
const IDLE_FLAG_KEY = 'idleLogoutFlag';

function setPendingRedirect(storage, pathname) {
  try { storage.setItem(REDIRECT_KEY, pathname); } catch {}
}

function consumePendingRedirect(storage) {
  try {
    const v = storage.getItem(REDIRECT_KEY);
    if (v) storage.removeItem(REDIRECT_KEY);
    return v || null;
  } catch {
    return null;
  }
}

function setIdleLogoutFlag(storage) {
  try { storage.setItem(IDLE_FLAG_KEY, '1'); } catch {}
}

function consumeIdleLogoutFlag(storage) {
  try {
    const v = storage.getItem(IDLE_FLAG_KEY);
    if (v) storage.removeItem(IDLE_FLAG_KEY);
    return !!v;
  } catch {
    return false;
  }
}

module.exports = { setPendingRedirect, consumePendingRedirect, setIdleLogoutFlag, consumeIdleLogoutFlag };
