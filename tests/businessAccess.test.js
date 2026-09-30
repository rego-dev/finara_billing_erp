jest.mock('../server/config/database', () => ({
  userBusiness: { findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const { assertBusinessAccess } = require('../server/utils/businessAccess');

beforeEach(() => jest.clearAllMocks());

describe('assertBusinessAccess', () => {
  test('ADMIN bypasses the grant check', async () => {
    await expect(assertBusinessAccess({ id: 1, role: 'ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN bypasses the grant check', async () => {
    await expect(assertBusinessAccess({ id: 1, role: 'SUPER_ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('a non-admin with a matching grant passes', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 7, businessId: 5 });
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: 7, businessId: 5 } },
    });
  });

  test('a non-admin with no grant is denied', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).rejects.toMatchObject({ statusCode: 403 });
  });
});
