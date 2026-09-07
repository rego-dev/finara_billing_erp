jest.mock('../server/config/database', () => ({
  invoice: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
  },
  journalEntry: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');
const glPost = require('../server/utils/glPost');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'CREDIT' }]);
});

const baseInvoice = {
  id: 5, businessId: 1, invoiceNo: 'INV-000005', status: 'OPEN',
  paidAmount: 0, totalAmount: 1120, subtotal: 1000, vatAmount: 120,
};

const editBody = {
  customerId: 2, invoiceDate: '2026-08-11', dueDate: '2026-09-10',
  description: 'Edited', notes: '',
  lines: [{ accountId: 10, description: 'Item A', quantity: 2, unitPrice: 500, vatCode: 'VAT' }],
};

describe('updateInvoice — eligibility', () => {
  test('rejects editing a PAID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PAID', paidAmount: 1120 });

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('rejects editing a VOID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'VOID' });

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('rejects when the edited total would drop below the amount already collected', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 900 });
    // editBody totals to 1000 * 1.12 = 1120... use a body that totals below 900
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] };

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: smallBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('404s when the invoice belongs to another business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the invoice scoped to the current business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });
});

describe('updateInvoice — recompute and status transitions', () => {
  test('recomputes subtotal/vatAmount/totalAmount from submitted lines and replaces lines via deleteMany+create', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({
        id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
        totalAmount: 1120, vatAmount: 120,
        customer: { name: 'Acme Corp' },
        lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
      });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(updateArgs.data.subtotal).toBeCloseTo(1000, 2);
    expect(updateArgs.data.vatAmount).toBeCloseTo(120, 2);
    expect(updateArgs.data.totalAmount).toBeCloseTo(1120, 2);
    expect(updateArgs.data.lines.deleteMany).toEqual({});
    expect(updateArgs.data.lines.create).toHaveLength(1);
    expect(updateArgs.data.lines.create[0]).toMatchObject({ accountId: 10, description: 'Item A' });
  });

  test('flips a PARTIAL invoice to PAID when the edited total exactly matches paidAmount', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 112 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'VAT' }] }; // totals to 112
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 112, vatAmount: 12, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: smallBody });

    expect(updateArgs.data.status).toBe('PAID');
  });

  test('keeps status PARTIAL when a collection exists and remaining balance is still positive', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 100 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }); // totals to 1120, paid 100, remaining 1020

    expect(updateArgs.data.status).toBe('PARTIAL');
  });

  test('keeps status OPEN unchanged when there are no collections', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(updateArgs.data.status).toBe('OPEN');
  });
});

describe('updateInvoice — GL correction', () => {
  test('voids the existing POSTED journal entry (scoped to businessId) and posts a fresh one', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({
      id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120,
      customer: { name: 'Acme Corp' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 42, entryNo: 'JE-1-000042' });
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'INV-000005', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 }, data: { status: 'VOIDED' } })
    );
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('INV-000005');
    const arLine = call.lines.find((l) => l.accountCode === '1100');
    expect(arLine.debit).toBeCloseTo(1120, 2);
    const vatLine = call.lines.find((l) => l.accountCode === '2030');
    expect(vatLine.credit).toBeCloseTo(120, 2);
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({
      id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});

describe('voidInvoice — GL correction', () => {
  test('rejects voiding an invoice with collections', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, paidAmount: 500 });

    await expect(run(ctrl.voidInvoice, { params: { id: '5' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('voids the existing POSTED journal entry (scoped to businessId) when voiding an invoice', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({ ...baseInvoice, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 77, entryNo: 'JE-1-000077' });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.voidInvoice, { params: { id: '5' } });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'INV-000005', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 77 }, data: { status: 'VOIDED' } })
    );
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ ...baseInvoice, paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({ ...baseInvoice, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue(null);

    await run(ctrl.voidInvoice, { params: { id: '5' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });
});

describe('markShipped', () => {
  test('marks a PENDING invoice as SHIPPED and stores shipment details', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'OPEN', deliveryStatus: 'PENDING' });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, deliveryStatus: 'SHIPPED', ...args.data });
    });

    await run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '123 Rizal St, Davao', courier: 'LBC', trackingNumber: 'TRK123' },
    });

    expect(updateArgs.data.deliveryStatus).toBe('SHIPPED');
    expect(updateArgs.data.shippingAddress).toBe('123 Rizal St, Davao');
    expect(updateArgs.data.courier).toBe('LBC');
    expect(updateArgs.data.trackingNumber).toBe('TRK123');
    expect(updateArgs.data.shippedDate).toBeInstanceOf(Date);
  });

  test('rejects shipping a VOID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'VOID', deliveryStatus: 'PENDING' });

    await expect(run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '', courier: '', trackingNumber: '' },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('re-shipping an already-SHIPPED invoice updates the details without erroring', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'OPEN', deliveryStatus: 'SHIPPED' });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, deliveryStatus: 'SHIPPED', ...args.data });
    });

    await run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-12', shippingAddress: 'Updated address', courier: 'J&T', trackingNumber: 'TRK999' },
    });

    expect(updateArgs.data.deliveryStatus).toBe('SHIPPED');
    expect(updateArgs.data.trackingNumber).toBe('TRK999');
  });

  test('404s when the invoice belongs to another business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '', courier: '', trackingNumber: '' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the invoice scoped to the current business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.markShipped, { params: { id: '5' }, body: {} })).rejects.toBeDefined();

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });
});
