jest.mock('../server/config/database', () => ({
  invoice:               { findMany: jest.fn() },
  paymentAR:             { findMany: jest.fn() },
  bill:                  { findMany: jest.fn() },
  paymentAP:             { findMany: jest.fn() },
  inventoryTransaction:  { findMany: jest.fn() },
  expenseVoucher:        { findMany: jest.fn() },
  cashSale:              { findMany: jest.fn() },
  journalLine:           { aggregate: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/dailyRemittanceController');

const run = (date) => new Promise((resolve, reject) => {
  ctrl.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
});

// The three journalLine.aggregate calls resolve in declaration order:
// 1011 petty cash, 1012 GCash, 1010 cash on hand.
const mockCash = ({ pc = [0, 0], gcash = [0, 0], coh = [0, 0] }) => {
  prisma.journalLine.aggregate
    .mockResolvedValueOnce({ _sum: { debit: pc[0],    credit: pc[1] } })
    .mockResolvedValueOnce({ _sum: { debit: gcash[0], credit: gcash[1] } })
    .mockResolvedValueOnce({ _sum: { debit: coh[0],   credit: coh[1] } });
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
});

describe('daily cash movement', () => {
  test('reports the day\'s outflow per fund', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    expect(r.pettyCashOut).toBe(7890);
    expect(r.cashOnHandOut).toBe(7830);
  });

  // The reported bug: a day with no cash activity must read zero, with nothing
  // carried in from the previous day.
  test('a day with no cash activity is zero, not a carried-over balance', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: null, credit: null } });
    const r = await run('2026-08-06');
    expect(r.pettyCashOut).toBe(0);
    expect(r.cashOnHandOut).toBe(0);
  });

  // 1012 is optional. `null` means "this business has no GCash fund" and hides
  // the card; 0 would render a phantom zero card, which is the bug being fixed.
  test('an unused GCash fund reports null so the card stays hidden', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    expect(r.pettyCashGcashOut).toBeNull();
  });

  test('a GCash fund with activity reports its outflow', async () => {
    mockCash({ pc: [0, 0], gcash: [500, 200], coh: [0, 0] });
    const r = await run('2026-08-05');
    expect(r.pettyCashGcashOut).toBe(200);
  });

  test('no cumulative balance fields leak onto the daily report', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    for (const k of ['pettyCashBalance', 'pettyCashFunded', 'pettyCashUsed',
                     'pettyCashGcashBalance', 'pettyCashGcashFunded', 'pettyCashGcashUsed',
                     'cashOnHandBalance']) {
      expect(r).not.toHaveProperty(k);
    }
  });

  test('queries a single day, not everything up to that day', async () => {
    mockCash({});
    await run('2026-08-05');
    const where = prisma.journalLine.aggregate.mock.calls[0][0].where;
    expect(where.entry.entryDate.gte).toEqual(new Date('2026-08-05T00:00:00.000Z'));
    expect(where.entry.entryDate.lte).toEqual(new Date('2026-08-05T23:59:59.999Z'));
    expect(where.entry.status).toBe('POSTED');
  });
});

describe('date validation', () => {
  // '2026-02-30' has valid YYYY-MM-DD shape but JS silently rolls it over to
  // March 2 — without a round-trip check this would return HTTP 200 built
  // from the wrong day's GL data instead of rejecting the request.
  // No mockCash() here: validation must reject before any Prisma call is
  // made, so queuing aggregate results would only leak unconsumed
  // mockResolvedValueOnce values into a later test.
  test('rejects a silently rolled-over date such as 2026-02-30', async () => {
    await expect(run('2026-02-30')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a malformed date such as not-a-date with a 400, not a 500', async () => {
    await expect(run('not-a-date')).rejects.toMatchObject({ statusCode: 400 });
  });

  test('a valid date still succeeds', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    expect(r.pettyCashOut).toBe(7890);
    expect(r.cashOnHandOut).toBe(7830);
  });
});
