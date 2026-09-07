jest.mock('../server/config/database', () => ({
  user: { update: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/settingsController');

const run = (body) => new Promise((resolve, reject) => {
  const res = {
    status: (code) => ({ json: (body) => resolve({ statusCode: code, body }) }),
    json:   (body) => resolve({ statusCode: 200, body }),
  };
  ctrl.updateUser({ params: { id: '5' }, body }, res, reject);
});

beforeEach(() => jest.clearAllMocks());

// Regression: updateUser used to write req.body.role straight to the database
// with no whitelist at all. Once SUPER_ADMIN became a valid Role enum value,
// that gap would let a plain ADMIN self-promote (or promote anyone) to
// SUPER_ADMIN via a raw API call — the one role that must never be grantable
// through any UI or endpoint, only by a direct database update.
describe('settingsController.updateUser role whitelist', () => {
  test('rejects SUPER_ADMIN in the request body', async () => {
    const { statusCode, body } = await run({ role: 'SUPER_ADMIN' });

    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/invalid role/i);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test('rejects any other non-whitelisted role value', async () => {
    const { statusCode } = await run({ role: 'GARBAGE' });

    expect(statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  test.each(['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'])('allows the legitimate role %s', async (role) => {
    prisma.user.update.mockResolvedValue({ id: 5, role });

    const { statusCode } = await run({ role });

    expect(statusCode).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role }) })
    );
  });

  test('leaves role untouched when omitted from the request body', async () => {
    prisma.user.update.mockResolvedValue({ id: 5, firstName: 'Rex' });

    const { statusCode } = await run({ firstName: 'Rex' });

    expect(statusCode).toBe(200);
    const call = prisma.user.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('role');
  });
});
