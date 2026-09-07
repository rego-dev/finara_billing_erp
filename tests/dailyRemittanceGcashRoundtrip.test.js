jest.mock('../server/config/database', () => ({
  dailyRemittance: {
    findFirst:   jest.fn(),
    findUnique:  jest.fn(),
    create:      jest.fn(),
    update:      jest.fn(),
  },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/dailyRemittanceController');

const runCreate = (body) => new Promise((resolve, reject) => {
  const res = { status: () => ({ json: resolve }) };
  ctrl.create({ body, businessId: 1 }, res, reject);
});

const runUpdate = (id, body) => new Promise((resolve, reject) => {
  ctrl.update({ params: { id: String(id) }, body }, { json: resolve }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.dailyRemittance.findFirst.mockResolvedValue(null); // no existing record for the date
  prisma.dailyRemittance.findUnique.mockResolvedValue({ id: 1, status: 'DRAFT' });
  prisma.dailyRemittance.create.mockResolvedValue({ id: 1 });
  prisma.dailyRemittance.update.mockResolvedValue({ id: 1 });
});

// Regression guard: pettyCashGcashOut distinguishes "no GCash fund activity
// that day" (null) from "GCash fund had activity but zero net spend" (0).
// A stray `|| 0` or a copy-paste of the sibling `!= null ? Number(x) :
// undefined` pattern would silently collapse null into 0 (create) or into a
// no-op skip (update) without any test catching it.
describe('dailyRemittance pettyCashGcashOut round-trip', () => {
  describe('create', () => {
    test('an explicit null is stored as null, not coerced to 0', async () => {
      await runCreate({ date: '2026-08-05', pettyCashGcashOut: null });
      const data = prisma.dailyRemittance.create.mock.calls[0][0].data;
      expect(data.pettyCashGcashOut).toBeNull();
    });

    test('a numeric value is stored as that number', async () => {
      await runCreate({ date: '2026-08-05', pettyCashGcashOut: 150.50 });
      const data = prisma.dailyRemittance.create.mock.calls[0][0].data;
      expect(data.pettyCashGcashOut).toBe(150.50);
    });
  });

  describe('update', () => {
    // The case most likely to regress: every sibling fund field
    // (cashOnHandOut, pettyCashOut, totalSales, ...) uses
    // `!= null ? Number(x) : undefined`, where an incoming null maps to
    // undefined (leave alone). pettyCashGcashOut must NOT follow that
    // pattern — an incoming null has to reach Prisma as null.
    test('an explicit null is stored as null, not skipped as undefined', async () => {
      await runUpdate(1, { pettyCashGcashOut: null });
      const data = prisma.dailyRemittance.update.mock.calls[0][0].data;
      expect(data.pettyCashGcashOut).toBeNull();
    });

    test('an omitted field leaves the existing value untouched (Prisma receives undefined)', async () => {
      await runUpdate(1, {});
      const data = prisma.dailyRemittance.update.mock.calls[0][0].data;
      expect(data.pettyCashGcashOut).toBeUndefined();
    });

    test('a numeric value is stored as that number', async () => {
      await runUpdate(1, { pettyCashGcashOut: 275.25 });
      const data = prisma.dailyRemittance.update.mock.calls[0][0].data;
      expect(data.pettyCashGcashOut).toBe(275.25);
    });
  });
});
