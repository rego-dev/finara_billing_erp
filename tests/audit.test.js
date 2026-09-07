const { diff } = require('../server/utils/audit');

describe('audit.diff', () => {
  test('captures only changed fields', () => {
    const result = diff({ name: 'A', amount: 100, status: 'OPEN' }, { name: 'A', amount: 150, status: 'OPEN' });
    expect(result).toEqual({ before: { amount: 100 }, after: { amount: 150 } });
  });

  test('detects added and removed keys', () => {
    const result = diff({ a: 1 }, { a: 1, b: 2 });
    expect(result.after).toHaveProperty('b', 2);
    expect(result.before).toHaveProperty('b', undefined);
  });

  test('no changes yields empty diff', () => {
    expect(diff({ x: 1 }, { x: 1 })).toEqual({ before: {}, after: {} });
  });
});
