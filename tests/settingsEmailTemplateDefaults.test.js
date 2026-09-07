jest.mock('../server/config/database', () => ({
  systemSetting: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/settingsController');

const run = (req) => new Promise((resolve, reject) => {
  ctrl.getAll({ businessId: 1, ...req }, { json: resolve }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('settingsController — invoice email template defaults', () => {
  test('DEFAULTS exports the 5 invoice email template keys', () => {
    expect(ctrl.DEFAULTS).toMatchObject({
      invoiceEmailSubject: 'Invoice {{invoiceNo}} from {{companyName}}',
      invoiceEmailGreeting: expect.stringContaining('{{customerName}}'),
      invoiceEmailPaymentInstructions: '',
      invoiceEmailTerms: '',
      invoiceEmailSignature: '',
    });
  });

  test('getAll merges the invoice email defaults when nothing is saved yet', async () => {
    prisma.systemSetting.findMany.mockResolvedValue([]);
    const result = await run({});
    expect(result.invoiceEmailSubject).toBe('Invoice {{invoiceNo}} from {{companyName}}');
    expect(result.invoiceEmailPaymentInstructions).toBe('');
  });

  test('getAll lets a saved value override the invoice email default', async () => {
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'invoiceEmailSubject', value: 'Custom subject {{invoiceNo}}' },
    ]);
    const result = await run({});
    expect(result.invoiceEmailSubject).toBe('Custom subject {{invoiceNo}}');
  });
});
