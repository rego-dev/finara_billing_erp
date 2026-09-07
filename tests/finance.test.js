const { monthlyDepreciation, advanceDate, endOfMonth, isBalanced } = require('../server/utils/finance');

describe('monthlyDepreciation', () => {
  test('straight-line: (cost - salvage) / life', () => {
    const asset = { method: 'STRAIGHT_LINE', cost: 120000, salvageValue: 0, usefulLifeMonths: 24 };
    expect(monthlyDepreciation(asset, 120000)).toBeCloseTo(5000, 2);
  });

  test('straight-line respects salvage value', () => {
    const asset = { method: 'STRAIGHT_LINE', cost: 100000, salvageValue: 10000, usefulLifeMonths: 18 };
    expect(monthlyDepreciation(asset, 100000)).toBeCloseTo(5000, 2);
  });

  test('never depreciates below salvage', () => {
    const asset = { method: 'STRAIGHT_LINE', cost: 100000, salvageValue: 10000, usefulLifeMonths: 18 };
    // book value only 2000 above salvage -> can only take 2000
    expect(monthlyDepreciation(asset, 12000)).toBeCloseTo(2000, 2);
  });

  test('declining-balance: bookValue * rate / 12', () => {
    const asset = { method: 'DECLINING_BALANCE', cost: 100000, salvageValue: 0, usefulLifeMonths: 60, decliningRate: 24 };
    expect(monthlyDepreciation(asset, 100000)).toBeCloseTo(2000, 2); // 100000 * 0.24 / 12
  });

  test('declining-balance shrinks with book value', () => {
    const asset = { method: 'DECLINING_BALANCE', cost: 100000, salvageValue: 0, usefulLifeMonths: 60, decliningRate: 24 };
    expect(monthlyDepreciation(asset, 50000)).toBeCloseTo(1000, 2);
  });
});

describe('advanceDate', () => {
  test('monthly', () => {
    expect(advanceDate('2026-01-15', 'MONTHLY').toISOString().slice(0, 10)).toBe('2026-02-15');
  });
  test('weekly', () => {
    expect(advanceDate('2026-01-01', 'WEEKLY').toISOString().slice(0, 10)).toBe('2026-01-08');
  });
  test('quarterly', () => {
    expect(advanceDate('2026-01-15', 'QUARTERLY').getMonth()).toBe(3); // April (0-indexed)
  });
  test('annually', () => {
    expect(advanceDate('2026-06-01', 'ANNUALLY').getFullYear()).toBe(2027);
  });
});

describe('endOfMonth', () => {
  test('February 2026 (non-leap) ends on the 28th', () => {
    expect(endOfMonth(new Date('2026-02-10')).getDate()).toBe(28);
  });
  test('January ends on the 31st', () => {
    expect(endOfMonth(new Date('2026-01-05')).getDate()).toBe(31);
  });
});

describe('isBalanced', () => {
  test('balanced lines', () => {
    expect(isBalanced([{ debit: 100 }, { credit: 100 }])).toBe(true);
  });
  test('unbalanced lines', () => {
    expect(isBalanced([{ debit: 100 }, { credit: 90 }])).toBe(false);
  });
  test('within tolerance', () => {
    expect(isBalanced([{ debit: 100 }, { credit: 99.995 }])).toBe(true);
  });
});
