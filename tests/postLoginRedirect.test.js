const {
  setPendingRedirect, consumePendingRedirect, setIdleLogoutFlag, consumeIdleLogoutFlag,
} = require('../lib/postLoginRedirect');

function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

describe('postLoginRedirect', () => {
  test('consumePendingRedirect returns the saved path and clears it', () => {
    const storage = createFakeStorage();
    setPendingRedirect(storage, '/payable');
    expect(consumePendingRedirect(storage)).toBe('/payable');
    expect(consumePendingRedirect(storage)).toBeNull();
  });

  test('consumePendingRedirect returns null when nothing was saved', () => {
    const storage = createFakeStorage();
    expect(consumePendingRedirect(storage)).toBeNull();
  });

  test('consumeIdleLogoutFlag returns true once then false', () => {
    const storage = createFakeStorage();
    setIdleLogoutFlag(storage);
    expect(consumeIdleLogoutFlag(storage)).toBe(true);
    expect(consumeIdleLogoutFlag(storage)).toBe(false);
  });

  test('consumeIdleLogoutFlag returns false when never set', () => {
    const storage = createFakeStorage();
    expect(consumeIdleLogoutFlag(storage)).toBe(false);
  });
});
