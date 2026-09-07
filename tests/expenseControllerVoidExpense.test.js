jest.mock('../server/config/database', () => ({
  expenseVoucher: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  expenseVoucherItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
  },
  cashRequest: {
    findUnique: jest.fn(),
  },
  journalEntry: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn(), diff: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/expenseController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseVoucher = {
  id: 12, businessId: 1, voucherNo: 'EV-000012', type: 'PETTY_CASH',
  status: 'SUBMITTED', totalAmount: 1500, cashRequestId: null,
};

describe('voidExpense', () => {
  test('rejects when no reason is given', async () => {
    await expect(run(ctrl.void, { params: { id: '12' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('404s when the voucher does not exist', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.void, { params: { id: '999' }, body: { reason: 'x' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects voiding a DRAFT voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'DRAFT' });
    await expect(run(ctrl.void, { params: { id: '12' }, body: { reason: 'test' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('rejects voiding an already-VOID voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    await expect(run(ctrl.void, { params: { id: '12' }, body: { reason: 'test' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('voids a SUBMITTED voucher without touching the GL', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'SUBMITTED' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID', voidedReason: 'duplicate entry' });

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'duplicate entry' } });

    expect(prisma.expenseVoucher.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { status: 'VOID', voidedReason: 'duplicate entry', voidedAt: expect.any(Date) },
    });
    expect(prisma.journalEntry.findFirst).not.toHaveBeenCalled();
  });

  test('voids the POSTED journal entry (by voucherNo) for a PAID non-liquidation voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 55 });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { businessId: 1, reference: 'EV-000012', status: 'POSTED' },
    });
    expect(prisma.journalEntry.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { status: 'VOIDED' } });
    expect(prisma.cashRequest.findUnique).not.toHaveBeenCalled();
  });

  test('voids the POSTED journal entry by the linked cash request\'s requestNo for a PAID liquidation voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID', type: 'LIQUIDATION', cashRequestId: 9 });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.cashRequest.findUnique.mockResolvedValue({ requestNo: 'CR-000009' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 77 });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'wrong liquidation' } });

    expect(prisma.cashRequest.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { requestNo: true } });
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { businessId: 1, reference: 'CR-000009', status: 'POSTED', description: { startsWith: 'Liquidation' } },
    });
    expect(prisma.journalEntry.update).toHaveBeenCalledWith({ where: { id: 77 }, data: { status: 'VOIDED' } });
  });

  test('does not take the liquidation branch when cashRequestId is set but type is not LIQUIDATION', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID', type: 'PETTY_CASH', cashRequestId: 9 });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 55 });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(prisma.cashRequest.findUnique).not.toHaveBeenCalled();
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { businessId: 1, reference: 'EV-000012', status: 'POSTED' },
    });
  });

  test('a GL-void failure does not block the voucher status change', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 55 });
    prisma.journalEntry.update.mockRejectedValue(new Error('db hiccup'));

    const result = await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(result.status).toBe('VOID');
  });

  test('proceeds without error when no prior POSTED entry is found', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue(null);

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });
});

describe('VOID is terminal — submit/approve/reject cannot reopen it', () => {
  test('submit rejects an already-VOID voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'VOID' });

    await expect(run(ctrl.submit, { params: { id: '12' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('approve rejects an already-VOID voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'VOID' });

    await expect(run(ctrl.approve, { params: { id: '12' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('reject rejects an already-VOID voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'VOID' });

    await expect(run(ctrl.reject, { params: { id: '12' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });
});
