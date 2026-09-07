jest.mock('../server/config/database', () => ({
  invoice: { findUnique: jest.fn() },
  systemSetting: { findMany: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({
  getTransporter: jest.fn(() => true),
  sendInvoiceEmail: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const settingsController = require('../server/controllers/settingsController');
const ctrl = require('../server/controllers/notificationController');

const run = (req) => new Promise((resolve, reject) => {
  ctrl.emailInvoice({ businessId: 1, params: { id: '70' }, ...req }, { json: resolve }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  mailer.getTransporter.mockReturnValue(true);
});

const invoice = {
  id: 70, invoiceNo: 'INV-000070',
  customer: { name: 'PASTORA BOK', email: 'pastora@example.com' },
  lines: [],
};

describe('notificationController.emailInvoice', () => {
  test('400s when SMTP is not configured', async () => {
    mailer.getTransporter.mockReturnValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.findUnique).not.toHaveBeenCalled();
  });

  test('404s when the invoice does not exist', async () => {
    prisma.invoice.findUnique.mockResolvedValue(null);
    await expect(run({})).rejects.toMatchObject({ statusCode: 404 });
  });

  test('400s when the customer has no email on file', async () => {
    prisma.invoice.findUnique.mockResolvedValue({ ...invoice, customer: { name: 'PASTORA BOK', email: null } });
    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
  });

  test('merges saved settings over the defaults and passes them to sendInvoiceEmail', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: 'invoiceEmailSubject', value: 'Custom {{invoiceNo}}' },
      { key: 'companyName', value: 'Acme Corp' },
    ]);
    mailer.sendInvoiceEmail.mockResolvedValue(true);

    await run({});

    expect(mailer.sendInvoiceEmail).toHaveBeenCalledWith(
      invoice,
      invoice.customer,
      expect.objectContaining({
        invoiceEmailSubject: 'Custom {{invoiceNo}}',
        companyName: 'Acme Corp',
        invoiceEmailGreeting: settingsController.DEFAULTS.invoiceEmailGreeting,
      })
    );
  });

  test('400s (not masked as a generic 500) when sendInvoiceEmail reports failure', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([]);
    mailer.sendInvoiceEmail.mockResolvedValue(false);

    await expect(run({})).rejects.toMatchObject({ statusCode: 400 });
  });

  test('scopes the settings lookup to the requesting business', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([]);
    mailer.sendInvoiceEmail.mockResolvedValue(true);

    await run({ businessId: 42 });

    expect(prisma.systemSetting.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 42 }) })
    );
  });

  test('only passes the email-template keys through to sendInvoiceEmail (no unrelated settings leak)', async () => {
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.systemSetting.findMany.mockResolvedValue([]);
    mailer.sendInvoiceEmail.mockResolvedValue(true);

    await run({});

    const passedSettings = mailer.sendInvoiceEmail.mock.calls[0][2];
    expect(Object.keys(passedSettings).sort()).toEqual([
      'companyName', 'invoiceEmailGreeting', 'invoiceEmailPaymentInstructions',
      'invoiceEmailSignature', 'invoiceEmailSubject', 'invoiceEmailTerms',
    ]);
  });
});
