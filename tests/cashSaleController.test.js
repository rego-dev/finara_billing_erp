jest.mock('../server/config/database', () => ({
  cashSale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  cashSaleItem: { createMany: jest.fn() },
  account: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  journalEntry: { update: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/cashSaleController');
const glPost = require('../server/utils/glPost');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('cashSaleController tenant isolation', () => {
  test('getOne only looks up a sale scoped to the current business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, saleNo: 'CS-000005' });

    await run(ctrl.getOne, { params: { id: '5' } });

    expect(prisma.cashSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });

  test('getOne 404s (not a leaked existence signal) when the sale belongs to another business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue(null); // findFirst scoped to businessId:1 finds nothing for a Business-2-owned id

    await expect(run(ctrl.getOne, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('voidSale only looks up a sale scoped to the current business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000005' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(prisma.cashSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });

  test('voidSale 404s when the sale belongs to another business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('cash sale VAT split always sums back to the total', () => {
  test.each([1.26, 24.50, 101.50, 500.22, 1000.50])('unitPrice %s produces subtotal + vatAmount === totalAmount', async (unitPrice) => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    let created;
    prisma.cashSale.create.mockImplementation(({ data }) => { created = data; return Promise.resolve({ id: 1, ...data }); });
    prisma.cashSaleItem.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-10', accountId: 1, vatCode: 'VAT', paymentMethod: 'Cash', items: [{ description: 'test', quantity: 1, unitPrice }] },
    });

    expect(Number(created.subtotal) + Number(created.vatAmount)).toBeCloseTo(Number(created.totalAmount), 2);
  });
});

describe('cash sale multi-item cart — create', () => {
  test('create with mixed inventory + custom lines deducts stock per line and posts one combined COGS entry', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    prisma.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: 9, businessId: 1, isActive: true, name: 'Widget', sku: 'SKU-0001', unit: 'pcs', currentStock: 10, costPrice: 50, sellingPrice: 100, cogsAccountId: null, inventoryAccountId: null })
      .mockResolvedValueOnce({ id: 11, businessId: 1, isActive: true, name: 'Gadget', sku: 'SKU-0002', unit: 'pcs', currentStock: 5, costPrice: 20, sellingPrice: 60, cogsAccountId: null, inventoryAccountId: null });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // txnSeq starts at 1
    let savedSale, createdItems, stockUpdates = [], txns = [];
    prisma.cashSale.create.mockImplementation(({ data }) => { savedSale = { id: 1, ...data }; return Promise.resolve(savedSale); });
    prisma.cashSaleItem.createMany.mockImplementation(({ data }) => { createdItems = data; return Promise.resolve({ count: data.length }); });
    prisma.inventoryItem.update.mockImplementation(({ where, data }) => { stockUpdates.push({ id: where.id, ...data }); return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { txns.push(data); return Promise.resolve({ id: txns.length, ...data }); });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: {
        saleDate: '2026-08-22', accountId: 1, vatCode: 'VAT', paymentMethod: 'Cash',
        items: [
          { itemId: 9, description: 'Widget', quantity: 2, unitPrice: 100 },
          { itemId: 11, description: 'Gadget', quantity: 1, unitPrice: 60 },
          { description: 'Gift wrap', quantity: 1, unitPrice: 20 },
        ],
      },
    });

    expect(createdItems).toHaveLength(3);
    expect(createdItems[0]).toMatchObject({ cashSaleId: savedSale.id, itemId: 9, quantity: 2, unitPrice: 100, amount: 200 });
    expect(createdItems[2]).toMatchObject({ itemId: null, description: 'Gift wrap', amount: 20 });

    expect(stockUpdates).toEqual(expect.arrayContaining([
      { id: 9, currentStock: 8 },
      { id: 11, currentStock: 4 },
    ]));
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => t.txnNo)).toEqual(['INV-TXN-000001', 'INV-TXN-000002']);

    expect(savedSale.description).toBe('Widget +2 more');
    expect(Number(savedSale.subtotal)).toBeCloseTo(280, 2); // 200 + 60 + 20

    expect(glPost.safePost).toHaveBeenCalledTimes(2); // cash-sale entry + one combined COGS entry
    const cogsCall = glPost.safePost.mock.calls.find((c) => c[0].description.includes('Inventory OUT'));
    expect(cogsCall).toBeTruthy();
    expect(cogsCall[0].lines).toHaveLength(4); // 2 DR/CR pairs, one per inventory-linked line
    const cogsDebits = cogsCall[0].lines.filter((l) => l.accountCode === '5010').reduce((s, l) => s + l.debit, 0);
    expect(cogsDebits).toBeCloseTo(120, 2); // 2*50 + 1*20
  });

  test('create rejects when any line exceeds current stock, without creating anything', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, isActive: true, currentStock: 1, unit: 'pcs', name: 'Widget', sku: 'SKU-0001', costPrice: 50, sellingPrice: 100,
    });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ itemId: 9, description: 'Widget', quantity: 5, unitPrice: 100 }] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create rejects an empty items array', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create rejects a line with a missing or non-numeric unitPrice, without creating anything', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ description: 'Widget', quantity: 1 }] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create with only custom lines does not touch inventory at all', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null);
    prisma.cashSale.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, saleNo: 'CS-000001', ...data }));
    prisma.cashSaleItem.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ description: 'Service fee', quantity: 1, unitPrice: 100 }] },
    });

    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });

  test('create rejects a cart with two lines referencing the same itemId', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });

    await expect(run(ctrl.create, {
      body: {
        saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash',
        items: [
          { itemId: 9, description: 'Widget', quantity: 1, unitPrice: 100 },
          { itemId: 9, description: 'Widget', quantity: 1, unitPrice: 100 },
        ],
      },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
  });

  test('create rejects a cart whose total is zero', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ description: 'Free sample', quantity: 1, unitPrice: 0 }] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });
});

describe('cash sale multi-item cart — void reverses stock', () => {
  test('voidSale restocks every inventory-linked line and posts one combined reversing GL entry', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: 40, saleNo: 'CS-000005' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      { id: 1, itemId: 9, quantity: 2, unitCost: 50, totalCost: 100, type: 'OUT', reference: 'CS-000005' },
      { id: 2, itemId: 11, quantity: 1, unitCost: 20, totalCost: 20, type: 'OUT', reference: 'CS-000005' },
    ]);
    prisma.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: 9, currentStock: 8, name: 'Widget', sku: 'SKU-0001', cogsAccountId: null, inventoryAccountId: null })
      .mockResolvedValueOnce({ id: 11, currentStock: 4, name: 'Gadget', sku: 'SKU-0002', cogsAccountId: null, inventoryAccountId: null });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // txnSeq starts at 1 inside the void transaction
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.journalEntry.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));
    let stockUpdates = [], reversalTxns = [];
    prisma.inventoryItem.update.mockImplementation(({ where, data }) => { stockUpdates.push({ id: where.id, ...data }); return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { reversalTxns.push(data); return Promise.resolve({ id: reversalTxns.length, ...data }); });
    glPost.safePost.mockResolvedValue({ id: 100 });

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(stockUpdates).toEqual(expect.arrayContaining([
      { id: 9, currentStock: 10 },
      { id: 11, currentStock: 5 },
    ]));
    expect(reversalTxns).toHaveLength(2);
    expect(reversalTxns.every((t) => t.type === 'RETURN_IN')).toBe(true);
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ accountCode: '1210', debit: 100 }),
        expect.objectContaining({ accountCode: '5010', credit: 100 }),
        expect.objectContaining({ accountCode: '1210', debit: 20 }),
        expect.objectContaining({ accountCode: '5010', credit: 20 }),
      ]),
    }));
  });

  test('voidSale does not touch inventory when the sale has no linked OUT transactions', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 6, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000006' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));

    await run(ctrl.voidSale, { params: { id: '6' }, body: { reason: 'test reason' } });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });

  test('voidSale rejects rather than silently corrupting stock when two OUT transactions share the same itemId', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 7, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000007' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      { id: 1, itemId: 9, quantity: 1, unitCost: 50, totalCost: 50, type: 'OUT', reference: 'CS-000007' },
      { id: 2, itemId: 9, quantity: 1, unitCost: 50, totalCost: 50, type: 'OUT', reference: 'CS-000007' },
    ]);
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 9, currentStock: 8, name: 'Widget', sku: 'SKU-0001', cogsAccountId: null, inventoryAccountId: null });

    await expect(run(ctrl.voidSale, { params: { id: '7' }, body: { reason: 'test reason' } })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });
});
