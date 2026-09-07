jest.mock('../server/config/database', () => ({
  bill: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'DEBIT' }]);
});

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN',
  paidAmount: 0, totalAmount: 1120, subtotal: 1000, vatAmount: 120,
};

const editBody = {
  vendorId: 2, billDate: '2026-08-11', dueDate: '2026-09-10',
  description: 'Edited', notes: '',
  lines: [{ accountId: 10, description: 'Item A', quantity: 2, unitPrice: 500, vatCode: 'VAT' }],
};

describe('updateBill — eligibility', () => {
  test('rejects editing a PAID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120 });

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects editing a VOID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects when the edited total would drop below the amount already paid', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 900 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] };

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: smallBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('404s when the bill belongs to another business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the bill scoped to the current business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.bill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7, businessId: 1 }) })
    );
  });
});

describe('updateBill — recompute and status transitions', () => {
  test('recomputes subtotal/vatAmount/totalAmount from submitted lines and replaces lines via deleteMany+create', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({
        id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
        totalAmount: 1120, vatAmount: 120,
        vendor: { name: 'Triplekenn Supply' },
        lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
      });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(updateArgs.data.subtotal).toBeCloseTo(1000, 2);
    expect(updateArgs.data.vatAmount).toBeCloseTo(120, 2);
    expect(updateArgs.data.totalAmount).toBeCloseTo(1120, 2);
    expect(updateArgs.data.lines.deleteMany).toEqual({});
    expect(updateArgs.data.lines.create).toHaveLength(1);
    expect(updateArgs.data.lines.create[0]).toMatchObject({ accountId: 10, description: 'Item A' });
  });

  test('flips a PARTIAL bill to PAID when the edited total exactly matches paidAmount', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 112 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'VAT' }] }; // totals to 112
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 112, vatAmount: 12, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: smallBody });

    expect(updateArgs.data.status).toBe('PAID');
  });

  test('keeps status PARTIAL when a payment exists and remaining balance is still positive', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 100 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody }); // totals to 1120, paid 100, remaining 1020

    expect(updateArgs.data.status).toBe('PARTIAL');
  });

  test('keeps status OPEN unchanged when there are no payments', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(updateArgs.data.status).toBe('OPEN');
  });
});

describe('updateBill — GL correction', () => {
  test('voids every existing POSTED journal entry (scoped to businessId) and posts one fresh entry', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({
      id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120,
      vendor: { name: 'Triplekenn Supply' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 42, entryNo: 'JE-1-000042' },
      { id: 43, entryNo: 'JE-1-000043' },
    ]);
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'BILL-000007', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 }, data: { status: 'VOIDED' } }));
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 43 }, data: { status: 'VOIDED' } }));

    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('BILL-000007');
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.credit).toBeCloseTo(1120, 2);
    const vatLine = call.lines.find((l) => l.accountCode === '1330');
    expect(vatLine.debit).toBeCloseTo(120, 2);
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({
      id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });

  test('records a GL_POST_FAILED audit entry when the GL correction is skipped rather than posted', async () => {
    const { recordAudit } = require('../server/utils/audit');
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({
      id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120, vendor: { name: 'Triplekenn Supply' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ skipped: 'PRE_CUTOVER' });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'GL_POST_FAILED',
      entity: 'JournalEntry',
      entityId: 'BILL-000007',
    }));
  });
});
