jest.mock('../server/config/database', () => ({
  bill:   { findMany: jest.fn() },
  vendor: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-03T00:00:00')); // Monday
});

afterEach(() => jest.useRealTimers());

describe('agingReport — due-date buckets', () => {
  test('classifies not-yet-due bills into Due Today / This Week / Next Week / This Month / Later', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-A', vendorId: 1, dueDate: new Date('2026-08-03'), totalAmount: 100, paidAmount: 0 }, // Due Today
      { billNo: 'BILL-B', vendorId: 1, dueDate: new Date('2026-08-09'), totalAmount: 200, paidAmount: 0 }, // This Week
      { billNo: 'BILL-C', vendorId: 1, dueDate: new Date('2026-08-16'), totalAmount: 300, paidAmount: 0 }, // Next Week
      { billNo: 'BILL-D', vendorId: 1, dueDate: new Date('2026-08-31'), totalAmount: 400, paidAmount: 0 }, // This Month
      { billNo: 'BILL-E', vendorId: 1, dueDate: new Date('2026-09-15'), totalAmount: 500, paidAmount: 0 }, // Later
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items.map((i) => i.bucket)).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
    ]);
    expect(result.summary['Due Today']).toBe(100);
    expect(result.summary['Later']).toBe(500);
  });

  test('overdue bills still bucket by days overdue, unaffected by the due-date buckets', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-F', vendorId: 1, dueDate: new Date('2026-07-01'), totalAmount: 1000, paidAmount: 0 }, // 33 days overdue
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items[0].bucket).toBe('31-60 days');
  });

  test('summary has all 9 bucket keys even with no bills', async () => {
    prisma.bill.findMany.mockResolvedValue([]);
    prisma.vendor.findMany.mockResolvedValue([]);

    const result = await run(ctrl.agingReport, {});

    expect(Object.keys(result.summary)).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
      '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
    ]);
  });

  test('a bill due late the previous local day is overdue, not "This Week" — regression for daysOverdue/classifyUpcomingBucket calendar-day mismatch', async () => {
    jest.setSystemTime(new Date(2026, 7, 27, 1, 0, 0)); // Aug 27, 1:00 AM local
    prisma.bill.findMany.mockResolvedValue([
      // Due late the previous local day — only 2 real hours before "now", but a
      // different calendar day. A raw millisecond diff of <24h would wrongly
      // report daysOverdue === 0, but this bill is 1 calendar day overdue.
      { billNo: 'BILL-G', vendorId: 1, dueDate: new Date(2026, 7, 26, 23, 0, 0), totalAmount: 750, paidAmount: 0 },
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items[0].daysOverdue).toBe(1);
    expect(result.items[0].bucket).toBe('1-30 days');
  });

  test('summary values sum to total across a mix of upcoming and overdue bills', async () => {
    jest.setSystemTime(new Date('2026-08-03T00:00:00')); // Monday, matches other tests
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-H', vendorId: 1, dueDate: new Date('2026-08-03'), totalAmount: 100, paidAmount: 0 },  // Due Today
      { billNo: 'BILL-I', vendorId: 1, dueDate: new Date('2026-09-15'), totalAmount: 250, paidAmount: 0 },  // Later
      { billNo: 'BILL-J', vendorId: 1, dueDate: new Date('2026-07-01'), totalAmount: 400, paidAmount: 0 },  // overdue, 31-60 days
      { billNo: 'BILL-K', vendorId: 1, dueDate: new Date('2026-05-01'), totalAmount: 900, paidAmount: 0 },  // overdue, Over 90 days
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    const summedSummary = Object.values(result.summary).reduce((sum, v) => sum + v, 0);
    expect(summedSummary).toBe(result.total);
    expect(result.total).toBe(100 + 250 + 400 + 900);
  });

  test('includes vendorId and notes on every item', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-L', vendorId: 7, dueDate: new Date('2026-08-03'), totalAmount: 500, paidAmount: 0, notes: 'Rush order' },
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 7, name: 'Acme Supply' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items[0]).toMatchObject({ vendorId: 7, notes: 'Rush order' });
  });
});
