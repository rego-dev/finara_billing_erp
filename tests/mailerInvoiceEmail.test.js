process.env.SMTP_HOST = 'smtp.test.local';
process.env.SMTP_USER = 'user@test.local';
process.env.SMTP_PASS = 'secret';

jest.mock('nodemailer');

const mailer = require('../server/utils/mailer');
const nodemailer = require('nodemailer');

const sendMailMock = jest.fn().mockResolvedValue({});
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const invoice = {
  invoiceNo: 'INV-000070',
  invoiceDate: '2026-09-04',
  dueDate: '2026-10-04',
  subtotal: 900,
  vatAmount: 0,
  totalAmount: 900,
  paidAmount: 0,
  notes: '',
  lines: [{ description: 'SINTRA BOARD 1.5X3FT', amount: 900 }],
};
const customer = { name: 'PASTORA BOK', email: 'pastora@example.com' };

const baseSettings = {
  invoiceEmailSubject: 'Invoice {{invoiceNo}} from {{companyName}}',
  invoiceEmailGreeting: 'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.',
  invoiceEmailPaymentInstructions: '',
  invoiceEmailTerms: '',
  invoiceEmailSignature: '',
  companyName: 'Finara ERP',
};

beforeEach(() => sendMailMock.mockClear());

describe('mailer.fillTemplate', () => {
  test('substitutes known tokens and drops unknown ones as blank', () => {
    const result = mailer.fillTemplate('Hi {{name}}, total {{total}}, {{missing}}', { name: 'Juan', total: '₱100.00' });
    expect(result).toBe('Hi Juan, total ₱100.00, ');
  });
});

describe('mailer.sendInvoiceEmail', () => {
  test('substitutes the subject template with invoice data', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'pastora@example.com',
      subject: 'Invoice INV-000070 from Finara ERP',
    }));
  });

  test('substitutes the greeting with customer name and amount due', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).toContain('Dear PASTORA BOK');
    expect(html).toContain('Amount due: ₱900.00');
  });

  test('omits the Payment Instructions / Terms / Notes blocks when blank', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, baseSettings);
    const html = sendMailMock.mock.calls[0][0].html;
    expect(html).not.toContain('Payment Instructions');
    expect(html).not.toContain('Terms &amp; Conditions');
    expect(html).not.toContain('Terms & Conditions');
    expect(html).not.toContain('>Notes<');
  });

  test('renders Payment Instructions, Terms, Notes, and Signature blocks when filled', async () => {
    const settings = {
      ...baseSettings,
      invoiceEmailPaymentInstructions: 'Pay via GCash 0917-000-0000',
      invoiceEmailTerms: 'Due within 30 days.',
      invoiceEmailSignature: 'Juan Dela Cruz\nAccounting',
    };
    const invoiceWithNotes = { ...invoice, notes: 'Rush order' };

    await mailer.sendInvoiceEmail(invoiceWithNotes, customer, settings);
    const html = sendMailMock.mock.calls[0][0].html;

    expect(html).toContain('Payment Instructions');
    expect(html).toContain('Pay via GCash 0917-000-0000');
    expect(html).toContain('Terms & Conditions');
    expect(html).toContain('Due within 30 days.');
    expect(html).toContain('>Notes<');
    expect(html).toContain('Rush order');
    expect(html).toContain('Juan Dela Cruz');
  });

  test('falls back to the hardcoded subject when the template resolves blank', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, { ...baseSettings, invoiceEmailSubject: '' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Invoice INV-000070 from Finara ERP',
    }));
  });

  test('falls back to the hardcoded subject when the template is non-empty but substitutes to blank', async () => {
    await mailer.sendInvoiceEmail(invoice, customer, { ...baseSettings, invoiceEmailSubject: '{{unknownToken}}' });
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Invoice INV-000070 from Finara ERP',
    }));
  });

  test('escapes substituted values to prevent HTML injection via customer name or invoice notes', async () => {
    const maliciousCustomer = { name: '<img src=x onerror=alert(1)>', email: 'evil@example.com' };
    const invoiceWithMaliciousNotes = { ...invoice, notes: '<script>alert(1)</script>' };

    await mailer.sendInvoiceEmail(invoiceWithMaliciousNotes, maliciousCustomer, baseSettings);
    const html = sendMailMock.mock.calls[0][0].html;

    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
