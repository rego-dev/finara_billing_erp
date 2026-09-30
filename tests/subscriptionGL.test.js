jest.mock('../server/config/database', () => ({
  business: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const { postSubscriptionPayment, getFinaraOpsBusinessId, FINARA_OPS_CODE } = require('../server/utils/subscriptionGL');

const order = { id: 9, orderNo: 'ORD-AAAAAA', amount: 1105 };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.findFirst.mockResolvedValue({ id: 99 });
  glPost.safePost.mockResolvedValue({ id: 1 });
});

// This must be the FIRST test in the file: getFinaraOpsBusinessId caches its
// result in a module-level variable inside subscriptionGL.js — shared state
// across every test in this file, since Jest requires the module once for
// the whole file — so asserting "exactly one query" only means something
// before any other test has already populated that cache.
test('getFinaraOpsBusinessId resolves by code once, then caches it', async () => {
  const first = await getFinaraOpsBusinessId();
  const second = await getFinaraOpsBusinessId();
  expect(first).toBe(99);
  expect(second).toBe(99);
  expect(prisma.business.findFirst).toHaveBeenCalledTimes(1);
  expect(prisma.business.findFirst).toHaveBeenCalledWith({ where: { code: FINARA_OPS_CODE }, select: { id: true } });
});

describe('postSubscriptionPayment', () => {
  test('posts a balanced two-line entry for a new-business approval', async () => {
    await postSubscriptionPayment({ order, companyName: 'Acme', kind: 'NEW', userId: 1 });

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Subscription — New: Acme (ORD-AAAAAA)',
      reference: 'ORD-AAAAAA',
      businessId: 99,
      userId: 1,
      lines: [
        { accountCode: '1010', debit: 1105, description: 'Payment received — ORD-AAAAAA' },
        { accountCode: '4000', credit: 1105, description: 'Subscription revenue — Acme' },
      ],
    }));
  });

  test('labels the description "Renewal" for a renewal approval', async () => {
    await postSubscriptionPayment({ order, companyName: 'Acme', kind: 'RENEWAL', userId: 1 });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Subscription — Renewal: Acme (ORD-AAAAAA)',
    }));
  });

  test('does not throw when the Finara Operations business cannot be found — logs, records a GL_POST_FAILED audit entry, and returns null instead, like safePost', async () => {
    jest.resetModules();
    jest.doMock('../server/config/database', () => ({ business: { findFirst: jest.fn().mockResolvedValue(null) } }));
    jest.doMock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
    jest.doMock('../server/utils/logger', () => ({ error: jest.fn() }));
    jest.doMock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
    const freshLogger = require('../server/utils/logger');
    const freshAudit = require('../server/utils/audit');
    const { postSubscriptionPayment: freshPost } = require('../server/utils/subscriptionGL');

    const result = await freshPost({ order, companyName: 'Acme', kind: 'NEW', userId: 1 });

    expect(result).toBeNull();
    expect(freshLogger.error).toHaveBeenCalledWith(expect.stringContaining('ORD-AAAAAA'));
    expect(freshAudit.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'GL_POST_FAILED',
      entity: 'JournalEntry',
      entityId: 'ORD-AAAAAA',
    }));
  });
});
