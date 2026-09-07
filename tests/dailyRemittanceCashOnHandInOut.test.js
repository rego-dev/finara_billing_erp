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

const voucher = (voucherNo, amount, paymentAccountCode) => ({
  voucherNo, type: 'DIRECT_PAYMENT', status: 'PAID', totalAmount: amount,
  payee: 'Payee', purpose: 'Purpose', category: 'MISC', requestedBy: 'A', paidBy: 'A',
  paymentAccountCode,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
});

// The Cash on Hand card mirrors the Petty Cash card: a headline for cash put
// INTO 1010 that day (debit side — cash sales, liquidation returns, etc.) and
// a subtitle for cash spent + voucher count, GL-verified the same way the
// petty cash classification is (see dailyRemittancePettyCashClassification).
describe('daily remittance Cash on Hand — put in vs. spent', () => {
  test('cashOnHandIn reads the debit side of 1010, independent of cashOnHandOut', async () => {
    prisma.expenseVoucher.findMany.mockResolvedValue([]);
    prisma.journalLine.aggregate
      .mockResolvedValueOnce({ _sum: { debit: 0,   credit: 0 } })    // 1011
      .mockResolvedValueOnce({ _sum: { debit: 0,   credit: 0 } })    // 1012
      .mockResolvedValueOnce({ _sum: { debit: 900, credit: 200 } }); // 1010
    prisma.journalLine.findMany.mockResolvedValue([]);

    const r = await run('2026-08-06');

    expect(r.cashOnHandIn).toBe(900);
    expect(r.cashOnHandOut).toBe(200);
  });

  test('a voucher GL-verified as paid from 1010 counts toward counts.cashOnHand, not counts.pettyCash', async () => {
    prisma.expenseVoucher.findMany.mockResolvedValue([
      voucher('EV-100', 1000, '1010'),
    ]);
    prisma.journalLine.aggregate
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } })    // 1011
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 0 } })    // 1012
      .mockResolvedValueOnce({ _sum: { debit: 0, credit: 1000 } }); // 1010
    prisma.journalLine.findMany.mockResolvedValue([
      { entry: { reference: 'EV-100' }, account: { accountCode: '1010' } },
    ]);

    const r = await run('2026-08-06');

    expect(r.counts.cashOnHand).toBe(1);
    expect(r.counts.pettyCash).toBe(0);
    expect(r.cashDisbursed).toBe(1000);
    const disbursement = r.items.find(i => i.category === 'DISBURSEMENT');
    expect(JSON.parse(disbursement.meta).accountCode).toBe('1010');
  });

  test('a voucher paid from the bank (1020) is not counted as Cash on Hand', async () => {
    prisma.expenseVoucher.findMany.mockResolvedValue([
      voucher('EV-200', 500, '1020'),
    ]);
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
    prisma.journalLine.findMany.mockResolvedValue([
      { entry: { reference: 'EV-200' }, account: { accountCode: '1020' } },
    ]);

    const r = await run('2026-08-06');

    expect(r.counts.cashOnHand).toBe(0);
  });
});
