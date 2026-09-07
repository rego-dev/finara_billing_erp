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

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
});

// Regression: a voucher's `paymentAccountCode` column can drift from the
// ledger — e.g. EV-000021 stored '1020' but its own posted journal entry
// (reference = voucherNo) actually credited 1011. When that happens the
// stored field must lose to the GL: the 1011 credit is the peso that
// actually left the petty cash fund, and pettyCashOut (aggregated straight
// off 1011) already counts it there. Classifying by the stale field instead
// double-books it — once for real under pettyCashOut, once again as a
// "Cash Paid Out" disbursement that never happened.
describe('daily remittance classifies vouchers by the GL, not the stale field', () => {
  test('a voucher whose stored paymentAccountCode disagrees with its own GL credit is classified by the GL', async () => {
    prisma.expenseVoucher.findMany.mockResolvedValue([
      { voucherNo: 'EV-000021', type: 'DIRECT_PAYMENT', status: 'PAID', totalAmount: 80, payee: 'DRIVER', purpose: 'Fare to BIR', category: 'TRANSPORTATION', requestedBy: 'A', paymentAccountCode: '1020' },
      { voucherNo: 'EV-000022', type: 'DIRECT_PAYMENT', status: 'PAID', totalAmount: 70, payee: 'R.A Vendor', purpose: 'Snack', category: 'SUPPLIES',       requestedBy: 'A', paymentAccountCode: '1011' },
    ]);
    prisma.journalLine.aggregate
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 150 } }) // 1011
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } })   // 1012
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } });  // 1010
    prisma.journalLine.findMany.mockResolvedValue([
      { entry: { reference: 'EV-000021' }, account: { accountCode: '1011' } },
      { entry: { reference: 'EV-000022' }, account: { accountCode: '1011' } },
    ]);

    const r = await run('2026-08-06');

    expect(r.pettyCashOut).toBe(150);
    expect(r.pettyCashTotal).toBe(150); // now reconciles with pettyCashOut instead of undercounting
    expect(r.cashDisbursed).toBe(0);    // neither voucher actually left a non-petty-cash account
    expect(r.counts.pettyCash).toBe(2);
    expect(r.items.filter(i => i.category === 'PETTY_CASH')).toHaveLength(2);
    expect(r.items.filter(i => i.category === 'DISBURSEMENT')).toHaveLength(0);
  });

  test('a voucher with no matching GL line falls back to the stored paymentAccountCode', async () => {
    prisma.expenseVoucher.findMany.mockResolvedValue([
      { voucherNo: 'EV-000099', type: 'REIMBURSEMENT', status: 'PAID', totalAmount: 500, payee: 'Vendor X', purpose: 'Office supplies', category: 'OFFICE_SUPPLIES', requestedBy: 'A', paymentAccountCode: '1020' },
    ]);
    prisma.journalLine.aggregate
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } })
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } })
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } });
    prisma.journalLine.findMany.mockResolvedValue([]); // no GL line found for this reference

    const r = await run('2026-08-06');

    expect(r.cashDisbursed).toBe(500);
    expect(r.counts.pettyCash).toBe(0);
  });
});
