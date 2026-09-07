jest.mock('../server/config/database', () => ({
  bill: {
    count: jest.fn(),
    create: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
  },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('createBill — contra-expense sign handling', () => {
  test('a normal (DEBIT) expense line adds to the bill total', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [{ accountId: 1, amount: args.data.subtotal, description: 'Item A' }] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.subtotal).toBeCloseTo(1000, 2);
    expect(created.totalAmount).toBeCloseTo(1000, 2);
  });

  test('a contra-expense (CREDIT normalBalance) line subtracts from the bill total instead of adding', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, normalBalance: 'DEBIT' },
      { id: 2, normalBalance: 'CREDIT' }, // e.g. Purchase Discounts
    ]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [
          { accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' },
          { accountId: 2, description: 'Purchase Discount', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' },
        ],
      },
    });

    expect(created.subtotal).toBeCloseTo(900, 2); // 1000 - 100, not 1100
    expect(created.totalAmount).toBeCloseTo(900, 2);
  });

  test('GL lines stay balanced (total debits === total credits) when a contra-expense line is present', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, normalBalance: 'DEBIT' },
      { id: 2, normalBalance: 'CREDIT' },
    ]);
    prisma.bill.count.mockResolvedValue(0);
    prisma.bill.create.mockImplementation((args) => Promise.resolve({
      id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data,
      lines: args.data.lines.create.map((l) => ({ ...l })),
    }));
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [
          { accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'VAT' },
          { accountId: 2, description: 'Purchase Discount', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' },
        ],
      },
    });

    const glLines = glPost.safePost.mock.calls[0][0].lines;
    const totalDebit = glLines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = glLines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });
});
