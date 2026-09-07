const { buildCashbook, round2 } = require('../server/utils/cashbook');

describe('round2', () => {
  test('rounds to two decimals', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(7920.005)).toBe(7920.01);
  });
});

describe('buildCashbook', () => {
  // Live data: 1011 opens at 0, spends 30 on Aug 3, is funded 7,830 and spends
  // 7,890 on Aug 5, and closes at -90.
  const PETTY_CASH = [
    { date: '2026-08-03', in: 0,    out: 30 },
    { date: '2026-08-05', in: 7830, out: 7890 },
  ];

  test('chains the running balance across days', () => {
    const { rows } = buildCashbook(0, PETTY_CASH);
    expect(rows).toEqual([
      { date: '2026-08-03', begin: 0,   in: 0,    out: 30,   ending: -30 },
      { date: '2026-08-05', begin: -30, in: 7830, out: 7890, ending: -90 },
    ]);
  });

  test("each row's begin equals the previous row's ending", () => {
    const { rows } = buildCashbook(1000, [
      { date: '2026-08-01', in: 500, out: 200 },
      { date: '2026-08-02', in: 0,   out: 100 },
      { date: '2026-08-04', in: 50,  out: 0 },
    ]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].begin).toBe(rows[i - 1].ending);
    }
  });

  test('reports a negative ending rather than clamping at zero', () => {
    const { closing } = buildCashbook(0, PETTY_CASH);
    expect(closing).toBe(-90);
  });

  test('emits no row for a day with no movement', () => {
    const { rows } = buildCashbook(0, PETTY_CASH);
    expect(rows.map(r => r.date)).not.toContain('2026-08-04');
    expect(rows).toHaveLength(2);
  });

  test('an empty range opens and closes at the same figure', () => {
    const r = buildCashbook(45076, []);
    expect(r.rows).toEqual([]);
    expect(r.opening).toBe(45076);
    expect(r.closing).toBe(45076);
    expect(r.totalIn).toBe(0);
    expect(r.totalOut).toBe(0);
  });

  test('sorts unordered movements by date', () => {
    const { rows } = buildCashbook(0, [
      { date: '2026-08-05', in: 7830, out: 7890 },
      { date: '2026-08-03', in: 0,    out: 30 },
    ]);
    expect(rows.map(r => r.date)).toEqual(['2026-08-03', '2026-08-05']);
  });

  test('totals the range', () => {
    const { totalIn, totalOut } = buildCashbook(0, PETTY_CASH);
    expect(totalIn).toBe(7830);
    expect(totalOut).toBe(7920);
  });

  // The invariant tying this report to the Daily Remittance Report.
  test('opening + sum(in - out) === closing', () => {
    const cases = [
      { opening: 0,     movements: PETTY_CASH },
      { opening: 45076, movements: [] },
      { opening: -90,   movements: [{ date: '2026-09-01', in: 1000, out: 0 }] },
      { opening: 10.05, movements: [{ date: '2026-09-01', in: 0.1, out: 0.2 }] },
    ];
    for (const { opening, movements } of cases) {
      const r = buildCashbook(opening, movements);
      const net = movements.reduce((s, m) => s + m.in - m.out, 0);
      expect(r.closing).toBe(round2(opening + net));
    }
  });
});
