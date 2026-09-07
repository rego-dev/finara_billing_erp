jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 5000,
};

describe('voidBill — GL correction', () => {
  test('rejects voiding a bill with payments', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 1000 });

    await expect(run(ctrl.voidBill, { params: { id: '7' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('voids every POSTED journal entry sharing the bill\'s reference (scoped to businessId)', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 88, entryNo: 'JE-1-000088' },
      { id: 91, entryNo: 'JE-1-000091' },
    ]);
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'BILL-000007', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 88 }, data: { status: 'VOIDED' } })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 91 }, data: { status: 'VOIDED' } })
    );
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });

  test('one entry failing to void does not stop the others', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 88, entryNo: 'JE-1-000088' },
      { id: 91, entryNo: 'JE-1-000091' },
    ]);
    prisma.journalEntry.update
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({});

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
  });
});
