jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn() },
  userBusiness: { findUnique: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/businessController');

const run = (user, id) => new Promise((resolve, reject) => {
  ctrl.get({ params: { id: String(id) }, user }, { json: resolve }, reject);
});

beforeEach(() => jest.clearAllMocks());

// Regression: get() used to fetch any business by id with no grant check at all,
// letting any authenticated user read another business's profile (name, TIN,
// address, contact info) by guessing ids — a real leak on a multi-tenant deployment
// where a locked-down (non-ADMIN) demo/limited account must never see other
// businesses' data even via a direct API call, not just via hidden UI.
describe('businessController.get access control', () => {
  test('a non-admin with no UserBusiness grant is denied', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);

    await expect(run({ id: 5, role: 'MANAGER' }, 1)).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  test('a non-admin with a matching grant can fetch that business', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 1 });
    prisma.business.findUnique.mockResolvedValue({ id: 1, name: 'Demo Trading Co.' });

    const biz = await run({ id: 5, role: 'MANAGER' }, 1);

    expect(biz).toEqual({ id: 1, name: 'Demo Trading Co.' });
    expect(prisma.userBusiness.findUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: 5, businessId: 1 } },
    });
  });

  test('a non-admin cannot fetch a business they are not granted, even a different id', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);

    await expect(run({ id: 5, role: 'MANAGER' }, 2)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('ADMIN bypasses the grant check entirely', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 2, name: 'Beulah IT' });

    const biz = await run({ id: 1, role: 'ADMIN' }, 2);

    expect(biz).toEqual({ id: 2, name: 'Beulah IT' });
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN bypasses the grant check entirely too', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 2, name: 'Beulah IT' });

    const biz = await run({ id: 1, role: 'SUPER_ADMIN' }, 2);

    expect(biz).toEqual({ id: 2, name: 'Beulah IT' });
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('a nonexistent business still 404s (not swallowed by the grant check)', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 99 });
    prisma.business.findUnique.mockResolvedValue(null);

    await expect(run({ id: 5, role: 'MANAGER' }, 99)).rejects.toMatchObject({ statusCode: 404 });
  });
});
