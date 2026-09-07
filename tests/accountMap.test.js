const {
  matchAccountCode,
  matchAccount,
  KEYWORD_RULES,
  FALLBACK_ACCOUNT,
} = require('../server/utils/accountMap');

describe('matchAccountCode', () => {
  test('maps build materials to Advertising Materials Cost', () => {
    expect(matchAccountCode('Plywood 3/4 - 4 pcs')).toBe('5021');
    expect(matchAccountCode('Nails and screws assorted')).toBe('5021');
    expect(matchAccountCode('Paint 2 gal')).toBe('5021');
  });

  test('maps printing work to Printing & Reproduction', () => {
    expect(matchAccountCode('Tarpaulin printing 3x5')).toBe('5029');
    expect(matchAccountCode('Sticker decal for booth')).toBe('5029');
  });

  test('maps fares and fuel to Transportation & Travel', () => {
    expect(matchAccountCode('Grab to venue')).toBe('6520');
    expect(matchAccountCode('Gasoline for delivery van')).toBe('6520');
    expect(matchAccountCode('Parking fee')).toBe('6520');
  });

  test('maps food to Representation & Entertainment', () => {
    expect(matchAccountCode('Snacks for crew')).toBe('6510');
    expect(matchAccountCode('Merienda')).toBe('6510');
  });

  test('is case-insensitive', () => {
    expect(matchAccountCode('PLYWOOD SHEETS')).toBe('5021');
    expect(matchAccountCode('plywood sheets')).toBe('5021');
    expect(matchAccountCode('PlYwOoD sheets')).toBe('5021');
  });

  test('matches on word boundaries, not substrings', () => {
    // "penalty" contains "pen" but is not office supplies
    expect(matchAccountCode('Penalty for late filing')).not.toBe('6320');
    // "gastos" contains "gas" but is not transportation
    expect(matchAccountCode('Gastos sa opisina')).not.toBe('6520');
  });

  test('falls back to 6390 when nothing matches', () => {
    expect(matchAccountCode('Something entirely unrecognised')).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode('')).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode(null)).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode(undefined)).toBe(FALLBACK_ACCOUNT);
  });

  test('respects rule order — printing wins over materials for tarpaulin printing', () => {
    // "tarpaulin printing" contains both a printing keyword and a materials keyword.
    // 5029 is declared before 5021, so printing wins. This is deliberate.
    const printingIdx  = KEYWORD_RULES.findIndex((r) => r.accountCode === '5029');
    const materialsIdx = KEYWORD_RULES.findIndex((r) => r.accountCode === '5021');
    expect(printingIdx).toBeLessThan(materialsIdx);
    expect(matchAccountCode('Tarpaulin printing')).toBe('5029');
  });
});

describe('matchAccount', () => {
  test('reports matched true with the code', () => {
    expect(matchAccount('Plywood 3/4')).toEqual({ accountCode: '5021', matched: true });
  });

  test('reports matched false on the fallback', () => {
    expect(matchAccount('zzzz nothing')).toEqual({ accountCode: '6390', matched: false });
  });
});

describe('KEYWORD_RULES', () => {
  test('every rule has a code and at least one keyword', () => {
    expect(KEYWORD_RULES.length).toBeGreaterThan(0);
    for (const rule of KEYWORD_RULES) {
      expect(rule.accountCode).toMatch(/^\d{4}$/);
      expect(Array.isArray(rule.keywords)).toBe(true);
      expect(rule.keywords.length).toBeGreaterThan(0);
    }
  });

  test('no rule uses the fallback account as its own code', () => {
    expect(KEYWORD_RULES.some((r) => r.accountCode === FALLBACK_ACCOUNT)).toBe(false);
  });

  test('keywords are lowercase so matching is predictable', () => {
    for (const rule of KEYWORD_RULES) {
      for (const kw of rule.keywords) {
        expect(kw).toBe(kw.toLowerCase());
      }
    }
  });
});
