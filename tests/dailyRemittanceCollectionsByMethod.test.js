jest.mock('../server/config/database', () => ({
  invoice:              { findMany: jest.fn() },
  paymentAR:            { findMany: jest.fn() },
  bill:                 { findMany: jest.fn() },
  paymentAP:            { findMany: jest.fn() },
  inventoryTransaction: { findMany: jest.fn() },
  expenseVoucher:       { findMany: jest.fn() },
  cashSale:             { findMany: jest.fn() },
  journalLine:          { aggregate: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/dailyRemittanceController');

const run = (date) => new Promise((resolve, reject) => {
  ctrl.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
});

const payment = (paymentNo, amount, paymentMethod, invoiceNo, customerName) => ({
  paymentNo, amount, paymentMethod,
  invoice: { invoiceNo, customer: { name: customerName } },
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'bill', 'expenseVoucher', 'inventoryTransaction', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  prisma.paymentAP.findMany.mockResolvedValue([]);
  prisma.journalLine.aggregate
    .mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

// Regression: the Daily Remittance's "Cash Received (Collections)" figure used to
// be a single lump sum with no visibility into how customers actually paid. This
// splits it by paymentMethod so the report (and its printed SUMMARY table) can show
// a per-method breakdown alongside the total.
describe('daily remittance collections split by payment method', () => {
  test('groups AR collections by paymentMethod and the totals still sum to cashReceived', async () => {
    prisma.paymentAR.findMany.mockResolvedValue([
      payment('PAY-001', 500, 'Cash',          'INV-001', 'Walk-in'),
      payment('PAY-002', 250, 'Cash',          'INV-002', 'Queena'),
      payment('PAY-003', 500, 'Bank Transfer', 'INV-003', 'Ethan\'s'),
    ]);

    const r = await run('2026-08-03');

    expect(r.cashReceived).toBe(1250);
    expect(r.collectionsByMethod).toEqual({ Cash: 750, 'Bank Transfer': 500 });
  });

  test('a payment with no paymentMethod on file is grouped as Unspecified', async () => {
    prisma.paymentAR.findMany.mockResolvedValue([
      payment('PAY-010', 300, null, 'INV-010', 'Legacy Corp'),
    ]);

    const r = await run('2026-08-03');

    expect(r.collectionsByMethod).toEqual({ Unspecified: 300 });
  });

  test('no collections that day produces an empty breakdown', async () => {
    prisma.paymentAR.findMany.mockResolvedValue([]);

    const r = await run('2026-08-03');

    expect(r.collectionsByMethod).toEqual({});
  });
});
