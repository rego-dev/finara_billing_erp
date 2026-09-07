jest.mock('../server/config/database', () => ({
  invoiceLine: { findMany: jest.fn() },
  billLine:    { findMany: jest.fn() },
  invoice:     { findMany: jest.fn() },
  bill:        { findMany: jest.fn() },
  cashSale:    { findMany: jest.fn() },
  business:    { findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/birController');

const run = (fn, query) => new Promise((resolve, reject) => {
  fn({ businessId: 1, query }, { json: resolve }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoiceLine.findMany.mockResolvedValue([]);
  prisma.billLine.findMany.mockResolvedValue([]);
  prisma.invoice.findMany.mockResolvedValue([]);
  prisma.bill.findMany.mockResolvedValue([]);
  prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
});

describe('BIR reports include cash sales', () => {
  test('vatSummary: a VAT-coded cash sale contributes to vatableSales and outputVat', async () => {
    prisma.cashSale.findMany.mockResolvedValue([
      { saleNo: 'CS-000001', saleDate: '2026-08-10', buyerName: 'Walk-in', vatCode: 'VAT', subtotal: 500, vatAmount: 60, totalAmount: 560, status: 'ACTIVE' },
    ]);

    const r = await run(ctrl.vatSummary, { month: '8', year: '2026' });

    expect(r.vatableSales).toBe(500);
    expect(r.outputVat).toBeCloseTo(60, 2);
  });

  test('reliefExport: a cash sale appears in sales[] with the sale number as invoiceNo and blank tin', async () => {
    prisma.cashSale.findMany.mockResolvedValue([
      { saleNo: 'CS-000042', saleDate: '2026-08-10', buyerName: 'Walk-in', vatCode: 'VAT', subtotal: 500, vatAmount: 60, totalAmount: 560, status: 'ACTIVE' },
    ]);

    const r = await run(ctrl.reliefExport, { month: '8', year: '2026' });

    const row = r.sales.find((s) => s.invoiceNo === 'CS-000042');
    expect(row).toBeDefined();
    expect(row.tin).toBe('');
    expect(row.vatableSales).toBe(500);
    expect(row.outputTax).toBe(60);
    expect(r.summary.totalVatableSales).toBe(500);
    expect(r.summary.totalOutputTax).toBe(60);
  });
});
