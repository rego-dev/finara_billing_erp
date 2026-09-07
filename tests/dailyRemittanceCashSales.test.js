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

const cashSale = (saleNo, totalAmount, vatAmount, paymentMethod, status = 'ACTIVE') => ({
  saleNo, totalAmount, vatAmount, paymentMethod, status, buyerName: 'Walk-in',
  subtotal: totalAmount - vatAmount,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

describe('daily remittance includes cash sales', () => {
  test('an active cash sale adds to totalSales, vatCollected, and cashReceived', async () => {
    prisma.cashSale.findMany.mockResolvedValue([
      cashSale('CS-000001', 560, 60, 'Cash'),
    ]);

    const r = await run('2026-08-10');

    expect(r.totalSales).toBe(560);
    expect(r.vatCollected).toBe(60);
    expect(r.cashReceived).toBe(560);
    expect(r.collectionsByMethod).toEqual({ Cash: 560 });
    expect(r.counts.cashSales).toBe(1);
  });

  test('cash sales and invoice collections both contribute to the same totals', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { invoiceNo: 'INV-001', totalAmount: 1000, vatAmount: 0, subtotal: 1000, status: 'OPEN', customer: { name: 'ABC Corp' } },
    ]);
    prisma.paymentAR.findMany.mockResolvedValue([
      { paymentNo: 'PAY-001', amount: 1000, paymentMethod: 'Bank Transfer', invoice: { invoiceNo: 'INV-001', customer: { name: 'ABC Corp' } } },
    ]);
    prisma.cashSale.findMany.mockResolvedValue([
      cashSale('CS-000001', 300, 0, 'GCash'),
    ]);

    const r = await run('2026-08-10');

    expect(r.totalSales).toBe(1300);
    expect(r.cashReceived).toBe(1300);
    expect(r.collectionsByMethod).toEqual({ 'Bank Transfer': 1000, GCash: 300 });
  });

  test('a VOID cash sale is excluded entirely', async () => {
    prisma.cashSale.findMany.mockResolvedValue([]); // the query itself filters status: 'ACTIVE' — VOID rows never come back

    const r = await run('2026-08-10');

    expect(prisma.cashSale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) })
    );
    expect(r.totalSales).toBe(0);
    expect(r.counts.cashSales).toBe(0);
  });

  test('cash sale rows appear in items with category SALES and the sale number as reference', async () => {
    prisma.cashSale.findMany.mockResolvedValue([cashSale('CS-000042', 112, 12, 'Maya')]);

    const r = await run('2026-08-10');

    const row = r.items.find((i) => i.reference === 'CS-000042');
    expect(row).toBeDefined();
    expect(row.category).toBe('SALES');
    expect(row.amount).toBe(112);
  });

  test('a VOID invoice is excluded entirely', async () => {
    prisma.invoice.findMany.mockResolvedValue([]); // the query itself filters status: { not: 'VOID' } — VOID rows never come back

    const r = await run('2026-08-10');

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: { not: 'VOID' } }) })
    );
    expect(r.totalSales).toBe(0);
    expect(r.counts.invoices).toBe(0);
  });
});
