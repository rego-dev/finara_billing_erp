const { buildReleaseEntry, buildLiquidationEntry } = require('../server/utils/cashAdvance');
const { isBalanced } = require('../server/utils/finance');

const sum = (lines, side) => lines.reduce((s, l) => s + Number(l[side] || 0), 0);

describe('buildReleaseEntry', () => {
  test('debits 1104 and credits the chosen cash account', () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000001', amount: 5000, cashAccountCode: '1010' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 5000 });
    expect(lines[1]).toMatchObject({ accountCode: '1010', credit: 5000 });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });

  test('rejects a non-positive amount', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 0, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: -1, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a missing cash account', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 100 }))
      .toThrow(/cash account/i);
  });
});

describe('buildLiquidationEntry', () => {
  const spent = [
    { accountId: 41, amount: 2400, description: 'Plywood 3/4 — 4 pcs' },
    { accountId: 42, amount: 1800, description: 'Paint — 2 gal' },
  ]; // 4,200 total

  test('RETURN: spent less than released, sukli comes back', () => {
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: spent, cashAccountCode: '1010' });
    expect(r.mode).toBe('RETURN');
    expect(r.variance).toBeCloseTo(-800, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', debit: 800 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('REIMBURSE: spent more than released, company pays the difference', () => {
    const over = [{ accountId: 41, amount: 5300, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: over, cashAccountCode: '1010' });
    expect(r.mode).toBe('REIMBURSE');
    expect(r.variance).toBeCloseTo(300, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', credit: 300 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('EXACT: no cash line at all', () => {
    const exact = [{ accountId: 41, amount: 5000, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: exact, cashAccountCode: '1010' });
    expect(r.mode).toBe('EXACT');
    expect(r.variance).toBeCloseTo(0, 2);
    expect(r.lines.filter(l => l.accountCode === '1010')).toHaveLength(0);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('honours per-line accountId and falls back to a code when absent', () => {
    const mixed = [
      { accountId: 41, amount: 1000, description: 'With account' },
      { amount: 500, description: 'No account' },
    ];
    const r = buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 1500, lines: mixed, cashAccountCode: '1010', fallbackAccountCode: '6390' });
    expect(r.lines).toContainEqual(expect.objectContaining({ accountId: 41, debit: 1000 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '6390', debit: 500 }));
  });

  test('rejects an empty or zero-amount line set', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [], cashAccountCode: '1010' }))
      .toThrow(/at least one/i);
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [{ amount: 0, description: 'x' }], cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a non-positive released amount', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 0, lines: spent, cashAccountCode: '1010' }))
      .toThrow(/released/i);
  });
});
