const { saveDraft, loadDraft, clearDraft, listDraftKeys } = require('../lib/draftStorage');

function createFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
}

describe('draftStorage', () => {
  test('saveDraft then loadDraft returns the same data', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'journal:new', { description: 'Office rent' });
    expect(loadDraft(storage, 'journal:new')).toEqual({ description: 'Office rent' });
  });

  test('loadDraft returns null when nothing was saved', () => {
    const storage = createFakeStorage();
    expect(loadDraft(storage, 'journal:new')).toBeNull();
  });

  test('loadDraft returns null for corrupt JSON instead of throwing', () => {
    const storage = createFakeStorage();
    storage.setItem('draft:journal:new', '{not valid json');
    expect(loadDraft(storage, 'journal:new')).toBeNull();
  });

  test('clearDraft removes the saved draft', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'bill:new', { vendorId: '1' });
    clearDraft(storage, 'bill:new');
    expect(loadDraft(storage, 'bill:new')).toBeNull();
  });

  test('listDraftKeys finds only keys under the given module prefix', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'journal:edit:5', { a: 1 });
    saveDraft(storage, 'journal:edit:9', { a: 2 });
    saveDraft(storage, 'bill:new', { a: 3 });
    expect(listDraftKeys(storage, 'journal:edit:').sort()).toEqual(['journal:edit:5', 'journal:edit:9']);
  });

  test('listDraftKeys returns an empty array when nothing matches', () => {
    const storage = createFakeStorage();
    saveDraft(storage, 'bill:new', { a: 3 });
    expect(listDraftKeys(storage, 'journal:edit:')).toEqual([]);
  });
});
