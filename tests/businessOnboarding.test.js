jest.mock('../server/config/database', () => ({
  business:      { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  userBusiness:  { findFirst: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
  systemSetting: { upsert: jest.fn(), deleteMany: jest.fn() },
  account:       { deleteMany: jest.fn() },
  feeType:       { deleteMany: jest.fn() },
  gradeLevel:    { deleteMany: jest.fn() },
  paymentScheme: { deleteMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../server/utils/cloneChartOfAccounts', () => ({ cloneChartOfAccounts: jest.fn() }));
jest.mock('../prisma/seedSchool', () => ({ setupSchool: jest.fn() }));
jest.mock('../prisma/seedDemo', () => ({ resetDemoBusiness: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ clearBusinessCache: jest.fn() }));

const prisma = require('../server/config/database');
const { cloneChartOfAccounts } = require('../server/utils/cloneChartOfAccounts');
const { setupSchool } = require('../prisma/seedSchool');
const ctrl = require('../server/controllers/businessController');

const user = { id: 7, email: 'new@example.com', role: 'MANAGER' };
const onboard = (body) => new Promise((resolve, reject) => {
  ctrl.onboard({ user, body }, { status: () => ({ json: resolve }) }, reject);
});
const update = (id, body) => new Promise((resolve, reject) => {
  ctrl.update({ params: { id: String(id) }, body }, { json: resolve }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.userBusiness.findFirst.mockResolvedValue(null);
  prisma.business.create.mockImplementation(async ({ data }) => ({ id: 42, ...data }));
  prisma.business.update.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
});

describe('businessController.onboard', () => {
  const ok = { name: 'Acme', companyType: 'SERVICES', taxType: 'VAT' };

  test.each([
    [{ ...ok, name: '  ' }, 'Company name is required'],
    [{ ...ok, companyType: 'HACK' }, 'Choose a company type'],
    [{ ...ok, companyType: undefined }, 'Choose a company type'],
    [{ ...ok, taxType: 'NOPE' }, 'Choose a tax type (VAT or Non-VAT)'],
    [{ ...ok, taxType: undefined }, 'Choose a tax type (VAT or Non-VAT)'],
  ])('rejects invalid input %#', async (body, message) => {
    await expect(onboard(body)).rejects.toMatchObject({ statusCode: 400, message });
    expect(prisma.business.create).not.toHaveBeenCalled();
  });

  test('refuses a user who already has a company', async () => {
    prisma.userBusiness.findFirst.mockResolvedValue({ id: 1 });
    await expect(onboard(ok)).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.business.create).not.toHaveBeenCalled();
  });

  test('non-school: clones COA, grants ONLY the caller, hides the School module', async () => {
    const biz = await onboard(ok);

    expect(biz).toMatchObject({ id: 42, industry: 'Services / Agency', taxType: 'VAT' });
    expect(cloneChartOfAccounts).toHaveBeenCalledWith(1, 42);
    expect(prisma.userBusiness.create).toHaveBeenCalledWith({ data: { userId: 7, businessId: 42 } });
    expect(setupSchool).not.toHaveBeenCalled();
    expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { businessId: 42, key: 'disabledModules', value: JSON.stringify(['school']) },
    }));
  });

  test('school: runs school setup without touching other tenants', async () => {
    await onboard({ ...ok, companyType: 'SCHOOL' });

    expect(setupSchool).toHaveBeenCalledWith(42, { hideFromOthers: false });
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });

  test('a failed setup rolls the half-built company back', async () => {
    setupSchool.mockRejectedValueOnce(new Error('boom'));
    // Cleanup calls are chained with .catch(), so they must return promises.
    [prisma.userBusiness.deleteMany, prisma.systemSetting.deleteMany, prisma.feeType.deleteMany,
      prisma.gradeLevel.deleteMany, prisma.paymentScheme.deleteMany, prisma.account.deleteMany,
      prisma.business.delete].forEach((f) => f.mockResolvedValue({}));

    await expect(onboard({ ...ok, companyType: 'SCHOOL' })).rejects.toThrow('boom');
    expect(prisma.business.delete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(prisma.account.deleteMany).toHaveBeenCalled();
  });
});

describe('businessController.update', () => {
  test('a partial PUT without booksStartDate does not wipe the cutover date', async () => {
    await update(1, { name: 'X' });
    expect(prisma.business.update.mock.calls[0][0].data).not.toHaveProperty('booksStartDate');
  });

  test('an explicit empty booksStartDate clears it', async () => {
    await update(1, { name: 'X', booksStartDate: '' });
    expect(prisma.business.update.mock.calls[0][0].data.booksStartDate).toBeNull();
  });

  test('a booksStartDate is stored as a Date', async () => {
    await update(1, { name: 'X', booksStartDate: '2026-01-01' });
    expect(prisma.business.update.mock.calls[0][0].data.booksStartDate).toEqual(new Date('2026-01-01'));
  });

  test('taxType: rejects unknown, clears on empty string, ignores when omitted', async () => {
    await expect(update(1, { taxType: 'HACK' })).rejects.toMatchObject({ statusCode: 400 });

    await update(1, { taxType: '' });
    expect(prisma.business.update.mock.calls[0][0].data.taxType).toBeNull();

    await update(1, { name: 'X' });
    expect(prisma.business.update.mock.calls[1][0].data.taxType).toBeUndefined();
  });
});
