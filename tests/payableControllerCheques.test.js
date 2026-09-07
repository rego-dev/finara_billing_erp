jest.mock('../server/config/database', () => ({
  paymentAP: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  vendor: {
    findMany: jest.fn(),
  },
  bill: {
    update: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vendor.findMany.mockResolvedValue([{ id: 3, name: 'Triplekenn Supply' }]);
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
});

const mkPayment = (overrides) => ({
  id: 1, paymentNo: 'PAP-000001', billId: 7, amount: 500, reference: 'CHK-001',
  paymentDate: new Date('2026-08-20'), checkDate: new Date('2026-09-05'),
  clearingStatus: 'OUTSTANDING', notes: null,
  bill: { billNo: 'BILL-000007', vendorId: 3 },
  ...overrides,
});

describe('listCheques', () => {
  test('scopes the query to the current business and paymentMethod Check', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, {});
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentMethod: 'Check', bill: { businessId: 1 } }),
      })
    );
  });

  test('applies an optional status filter from the query string', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, { query: { status: 'CLEARED' } });
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clearingStatus: 'CLEARED' }),
      })
    );
  });

  test('fetches vendor names via a separate query, not via include on the bill relation', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    await run(ctrl.listCheques, {});
    const findManyArgs = prisma.paymentAP.findMany.mock.calls[0][0];
    expect(findManyArgs.include.bill.select.vendor).toBeUndefined();
    expect(findManyArgs.include.bill.select.vendorId).toBe(true);
    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [3] } } })
    );
  });

  test('maps each row to the flat shape the frontend expects', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    const result = await run(ctrl.listCheques, {});
    expect(result[0]).toMatchObject({
      id: 1, paymentNo: 'PAP-000001', billNo: 'BILL-000007', vendorName: 'Triplekenn Supply',
      amount: 500, checkNo: 'CHK-001', clearingStatus: 'OUTSTANDING',
    });
  });

  test('computes a bucket for an OUTSTANDING cheque, null for a settled one', async () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const cleared = mkPayment({ id: 2, clearingStatus: 'CLEARED', checkDate: soon });
    const outstanding = mkPayment({ id: 1, clearingStatus: 'OUTSTANDING', checkDate: soon });
    prisma.paymentAP.findMany.mockResolvedValue([outstanding, cleared]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('0-7 days');
    expect(result.find((r) => r.id === 2).bucket).toBeNull();
  });

  test('buckets an OUTSTANDING cheque whose checkDate has already passed as Past Due', async () => {
    const past = new Date(); past.setDate(past.getDate() - 5);
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({ checkDate: past })]);

    const result = await run(ctrl.listCheques, {});

    expect(result[0].bucket).toBe('Past Due');
  });

  test('buckets at the 8-14, 15-30, and 30+ day boundaries', async () => {
    const at = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
    prisma.paymentAP.findMany.mockResolvedValue([
      mkPayment({ id: 1, checkDate: at(10) }),
      mkPayment({ id: 2, checkDate: at(20) }),
      mkPayment({ id: 3, checkDate: at(45) }),
    ]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('8-14 days');
    expect(result.find((r) => r.id === 2).bucket).toBe('15-30 days');
    expect(result.find((r) => r.id === 3).bucket).toBe('30+ days');
  });

  test('does not crash when the bill\'s vendor has been deleted (orphaned vendor)', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    prisma.vendor.findMany.mockResolvedValue([]); // vendor deleted — no matching row

    const result = await run(ctrl.listCheques, {});

    expect(result[0].vendorName).toBeUndefined();
  });
});

const mkOutstandingPayment = (overrides) => ({
  id: 1, paymentNo: 'PAP-000001', billId: 7, amount: 500,
  clearingStatus: 'OUTSTANDING', notes: null,
  bill: { id: 7, billNo: 'BILL-000007', businessId: 1, paidAmount: 500, totalAmount: 1000, vendor: { name: 'Triplekenn Supply' } },
  ...overrides,
});

describe('clearCheque', () => {
  test('404s when the payment does not exist (or is outside the business)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(null);
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('400s when clearDate is missing', async () => {
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.findFirst).not.toHaveBeenCalled();
  });

  test('400s when the cheque is already settled', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({ clearingStatus: 'BOUNCED' }));
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('marks CLEARED and posts DR 2015 / CR 1020 without touching the bill', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } });

    expect(prisma.paymentAP.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ clearingStatus: 'CLEARED' }),
    }));
    expect(prisma.bill.update).not.toHaveBeenCalled();
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('PAP-000001-CLR');
    expect(call.entryDate).toBe('2026-09-10');
    expect(call.lines.find((l) => l.accountCode === '2015').debit).toBeCloseTo(500, 2);
    expect(call.lines.find((l) => l.accountCode === '1020').credit).toBeCloseTo(500, 2);
  });
});

describe('bounceCheque / cancelCheque', () => {
  test('400s when reason is missing', async () => {
    await expect(run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.findFirst).not.toHaveBeenCalled();
  });

  test('400s when the cheque is already settled', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({ clearingStatus: 'CLEARED' }));
    await expect(run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('bounce reverts the bill paidAmount/status and voids the issue GL entry', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    let billUpdateArgs;
    prisma.bill.update.mockImplementation((args) => { billUpdateArgs = args; return Promise.resolve({}); });
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 200, entryNo: 'JE-1-000200' }]);
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    // baseline: bill.paidAmount 500, this payment's amount 500 → reverted paidAmount 0, status OPEN
    expect(billUpdateArgs.data.paidAmount).toBe(0);
    expect(billUpdateArgs.data.status).toBe('OPEN');
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'PAP-000001', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 200 }, data: { status: 'VOIDED' } }));
  });

  test('bounce sets clearingStatus BOUNCED and appends the reason to notes', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({}); });
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    expect(paymentUpdateArgs.data.clearingStatus).toBe('BOUNCED');
    expect(paymentUpdateArgs.data.notes).toContain('Insufficient funds');
  });

  test('cancel sets clearingStatus CANCELLED (same revert arithmetic as bounce)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({}); });
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.cancelCheque, { params: { paymentId: '1' }, body: { reason: 'Stop payment requested' } });

    expect(paymentUpdateArgs.data.clearingStatus).toBe('CANCELLED');
  });

  test('does not post any new GL entry (only voids the issue entry)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    expect(glPost.safePost).not.toHaveBeenCalled();
  });
});
