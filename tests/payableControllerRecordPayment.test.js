jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  vendor: {
    findUnique: jest.fn(),
  },
  paymentAP: {
    create: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
  prisma.vendor.findUnique.mockResolvedValue({ name: 'Triplekenn Supply' });
  prisma.paymentAP.count.mockResolvedValue(0);
  prisma.paymentAP.create.mockResolvedValue({ id: 1 });
  prisma.bill.update.mockResolvedValue({});
  glPost.safePost.mockResolvedValue({ id: 99 });
});

const baseBill = { id: 7, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 1000 };

describe('recordPayment — eligibility', () => {
  test('404s when the bill does not exist', async () => {
    prisma.bill.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects paying a VOID bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'VOID' });
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('recordPayment — non-cheque payments (existing behavior)', () => {
  test('posts DR AP / CR Cash (1020) and does not touch checkDate/clearingStatus', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    let createArgs;
    prisma.paymentAP.create.mockImplementation((args) => { createArgs = args; return Promise.resolve({ id: 1 }); });

    await run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } });

    expect(createArgs.data.checkDate).toBeNull();
    expect(createArgs.data.clearingStatus).toBeNull();
    const call = glPost.safePost.mock.calls[0][0];
    const cashLine = call.lines.find((l) => l.accountCode === '1020');
    expect(cashLine.credit).toBeCloseTo(500, 2);
    expect(call.lines.find((l) => l.accountCode === '2015')).toBeUndefined();
  });
});

describe('recordPayment — Check payments (new behavior)', () => {
  test('rejects a Check payment with no checkDate', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Check' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.create).not.toHaveBeenCalled();
  });

  test('stores checkDate and clearingStatus OUTSTANDING, posts DR AP / CR Post-Dated Checks Payable (2015), not Cash', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    let createArgs;
    prisma.paymentAP.create.mockImplementation((args) => { createArgs = args; return Promise.resolve({ id: 1 }); });

    await run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Check', checkDate: '2026-09-10', reference: 'CHK-0001' } });

    expect(createArgs.data.checkDate).toEqual(new Date('2026-09-10'));
    expect(createArgs.data.clearingStatus).toBe('OUTSTANDING');
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.lines.find((l) => l.accountCode === '1020')).toBeUndefined();
    const pdcLine = call.lines.find((l) => l.accountCode === '2015');
    expect(pdcLine.credit).toBeCloseTo(500, 2);
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.debit).toBeCloseTo(500, 2);
  });
});
