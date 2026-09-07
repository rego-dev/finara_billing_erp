jest.mock('../server/config/database', () => ({
  account:     { findMany: jest.fn() },
  journalLine: { aggregate: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/cashPositionController');

const call = (query) => new Promise((resolve, reject) => {
  ctrl.report({ query, businessId: 1 }, { json: resolve }, (err) => reject(err));
});

const callDay = (query) => new Promise((resolve, reject) => {
  ctrl.day({ query, businessId: 1 }, { json: resolve }, (err) => reject(err));
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([
    { id: 3, accountCode: '1011', accountName: 'Petty Cash Fund', children: [] },
  ]);
  prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: null, credit: null } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

// A GL line as the controller selects it.
const line = (date, debit, credit) => ({
  debit, credit, entry: { entryDate: new Date(`${date}T00:00:00.000Z`) },
});

// A GL line as `ctrl.day` selects it, via `include: { entry: { select: ... } }`.
const dayLine = (debit, credit, { entryNo = 1, reference = null, entryDescription = null, lineDescription = null } = {}) => ({
  debit, credit, description: lineDescription,
  entry: { entryNo, reference, description: entryDescription },
});

describe('GET /reports/cash-position', () => {
  test('rejects a missing date range', async () => {
    await expect(call({ from: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects from later than to', async () => {
    await expect(call({ from: '2026-08-09', to: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a range wider than 366 days', async () => {
    await expect(call({ from: '2025-01-01', to: '2026-06-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a calendar-invalid date such as 2026-13-40 instead of reaching Prisma', async () => {
    await expect(call({ from: '2026-13-40', to: '2026-08-06' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('rejects a silently rolled-over date such as 2026-02-30 (which silently becomes March 2)', async () => {
    await expect(call({ from: '2026-02-30', to: '2026-08-06' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('rejects 2026-04-31 (April has only 30 days)', async () => {
    await expect(call({ from: '2026-04-31', to: '2026-08-06' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('rejects 2026-02-29 (2026 is not a leap year)', async () => {
    await expect(call({ from: '2026-02-29', to: '2026-08-06' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('accepts 2024-02-29 (2024 is a leap year)', async () => {
    await call({ from: '2024-02-29', to: '2024-02-29' });
    expect(prisma.account.findMany).toHaveBeenCalled();
  });

  test('excludes header accounts such as 1000 Current Assets', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountType).toBe('ASSET');
    expect(where.accountCode.startsWith).toBe('10');
    expect(where.children).toEqual({ none: {} });
  });

  test('an accountCode failing the 10xx pre-check is rejected without ever querying accounts', async () => {
    // '1104' (Advances to Officers) fails the /^10\d*$/ pre-check outright, so
    // resolveCashAccounts (and its mocked account.findMany) is never consulted.
    await expect(call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1104' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('an accountCode passing the 10xx pre-check but resolving to no leaf account is rejected', async () => {
    // '1000' (Current Assets) passes /^10\d*$/ but is a parent header with no
    // postings, so the `children: { none: {} }` leaf test excludes it — this is
    // the resolution-level guard, distinct from the regex pre-check above.
    prisma.account.findMany.mockResolvedValue([]);
    await expect(call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1000' }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.account.findMany.mock.calls[0][0].where.accountCode).toEqual({ startsWith: '10', equals: '1000' });
  });

  test('the 10xx prefix still applies when a code is requested', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1011' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountCode).toEqual({ startsWith: '10', equals: '1011' });
  });

  test('counts only POSTED entries', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(prisma.journalLine.aggregate.mock.calls[0][0].where.entry.status).toBe('POSTED');
  });

  test('builds a chained cashbook from GL movement', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
    // Aug 5 arrives as several lines and must collapse into one day bucket.
    prisma.journalLine.findMany.mockResolvedValue([
      line('2026-08-03', 0,    30),
      line('2026-08-05', 7830, 0),
      line('2026-08-05', 0,    7890),
    ]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    const acct = r.accounts[0];
    expect(acct.accountCode).toBe('1011');
    expect(acct.opening).toBe(0);
    expect(acct.closing).toBe(-90);
    expect(acct.totalIn).toBe(7830);
    expect(acct.totalOut).toBe(7920);
    expect(acct.rows).toHaveLength(2);
    expect(acct.rows[1].begin).toBe(-30);
  });

  test('returns an empty accounts array when the business has no cash accounts', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts).toEqual([]);
  });

  test('a range with no movement opens and closes the same', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 100, credit: 40 } });
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts[0].opening).toBe(60);
    expect(r.accounts[0].closing).toBe(60);
    expect(r.accounts[0].rows).toEqual([]);
  });

  test('a movement dated exactly on `from` is a row, not folded into opening', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
    prisma.journalLine.findMany.mockResolvedValue([
      line('2026-08-01', 500, 0),
    ]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    const acct = r.accounts[0];
    expect(acct.opening).toBe(0);
    expect(acct.rows).toHaveLength(1);
    expect(acct.rows[0].date).toBe('2026-08-01');
    expect(acct.rows[0].in).toBe(500);

    // Guard the boundary itself: opening excludes `from` (strictly-before), the
    // movement window includes it (>=). An off-by-one on either side would fold
    // the first day's movement into the opening balance instead.
    const aggEntryDate  = prisma.journalLine.aggregate.mock.calls[0][0].where.entry.entryDate;
    const findEntryDate = prisma.journalLine.findMany.mock.calls[0][0].where.entry.entryDate;
    expect(aggEntryDate).toEqual({ lt: new Date('2026-08-01T00:00:00.000Z') });
    expect(findEntryDate.gte).toEqual(new Date('2026-08-01T00:00:00.000Z'));
  });
});

describe('GET /reports/cash-position/day', () => {
  test('rejects a missing date', async () => {
    await expect(callDay({ accountCode: '1011' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a malformed date', async () => {
    await expect(callDay({ date: 'not-a-date', accountCode: '1011' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a calendar-invalid date such as 2026-13-40 instead of reaching Prisma', async () => {
    await expect(callDay({ date: '2026-13-40', accountCode: '1011' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('rejects a silently rolled-over date such as 2026-02-30 on the date param', async () => {
    await expect(callDay({ date: '2026-02-30', accountCode: '1011' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.account.findMany).not.toHaveBeenCalled();
  });

  test('accepts 2024-02-29 (a valid leap day)', async () => {
    await callDay({ date: '2024-02-29', accountCode: '1011' });
    expect(prisma.account.findMany).toHaveBeenCalled();
  });

  test('rejects a missing accountCode', async () => {
    await expect(callDay({ date: '2026-08-05' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an accountCode that resolves to no cash account', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await expect(callDay({ date: '2026-08-05', accountCode: '1104' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('returns the GL lines behind one day, shaped for the drill-down', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      dayLine(7830, 0,   { entryNo: 42, reference: 'OR-001', entryDescription: 'Cash sale', lineDescription: 'Petty cash in' }),
      dayLine(0,    120, { entryNo: 43, reference: null,     entryDescription: 'Office supplies', lineDescription: null }),
    ]);
    const r = await callDay({ date: '2026-08-05', accountCode: '1011' });

    expect(r.date).toBe('2026-08-05');
    expect(r.accountCode).toBe('1011');
    expect(r.lines).toEqual([
      { entryNo: 42, reference: 'OR-001', description: 'Petty cash in', in: 7830, out: 0 },
      { entryNo: 43, reference: null,     description: 'Office supplies', in: 0, out: 120 },
    ]);
  });

  test('falls back to the parent entry description when the line has none', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      dayLine(500, 0, { entryNo: 1, entryDescription: 'Parent entry description', lineDescription: null }),
    ]);
    const r = await callDay({ date: '2026-08-05', accountCode: '1011' });
    expect(r.lines[0].description).toBe('Parent entry description');
  });

  test('scopes the query by businessId and POSTED status', async () => {
    await callDay({ date: '2026-08-05', accountCode: '1011' });
    const where = prisma.journalLine.findMany.mock.calls[0][0].where;
    expect(where.entry.businessId).toBe(1);
    expect(where.entry.status).toBe('POSTED');
  });
});
