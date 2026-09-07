const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const mailer = require('../utils/mailer');
const settingsController = require('./settingsController');

const EMAIL_TEMPLATE_KEYS = [
  'invoiceEmailSubject', 'invoiceEmailGreeting', 'invoiceEmailPaymentInstructions',
  'invoiceEmailTerms', 'invoiceEmailSignature', 'companyName',
];

const TEMPLATE_DEFAULTS = Object.fromEntries(
  EMAIL_TEMPLATE_KEYS.map((k) => [k, settingsController.DEFAULTS[k]])
);

exports.status = (req, res) => {
  res.json({ emailEnabled: !!mailer.getTransporter() });
};

// In-app notification feed — recent activity (from the audit trail) for the
// current business. Each item carries: title, module, action, and which user.
exports.feed = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 50);
    const rows = await prisma.auditLog.findMany({
      where: {
        businessId: req.businessId,
        action: { notIn: ['LOGIN', 'LOGIN_FAILED'] }, // skip auth noise
      },
      orderBy: { id: 'desc' },
      take: limit,
      include: { user: { select: { firstName: true, lastName: true } } },
    });

    const data = rows.map((r) => {
      const name = r.user
        ? `${r.user.firstName || ''} ${r.user.lastName || ''}`.trim()
        : '';
      return {
        id:        r.id,
        title:     r.summary || `${r.action} ${r.entity}`,
        module:    r.entity,
        action:    r.action,
        user:      name || r.userEmail || 'System',
        entityId:  r.entityId,
        createdAt: r.createdAt,
      };
    });
    res.json({ data });
  } catch (err) { next(err); }
};

// Email a single invoice to its customer
exports.emailInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!mailer.getTransporter()) throw createError('Email is not configured (SMTP env vars missing)', 400);

    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true, lines: true } });
    if (!invoice) throw createError('Invoice not found', 404);
    if (!invoice.customer?.email) throw createError('Customer has no email address on file', 400);

    const rows = await prisma.systemSetting.findMany({
      where: { businessId: req.businessId, key: { in: EMAIL_TEMPLATE_KEYS } },
    });
    const settings = {
      ...TEMPLATE_DEFAULTS,
      ...Object.fromEntries(rows.map((r) => [r.key, r.value])),
    };

    const sent = await mailer.sendInvoiceEmail(invoice, invoice.customer, settings);
    if (!sent) throw createError('Email could not be sent. Check SMTP configuration.', 400);

    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', entityId: id, summary: `Emailed invoice ${invoice.invoiceNo} to ${invoice.customer.email}` });
    res.json({ message: `Invoice emailed to ${invoice.customer.email}` });
  } catch (err) { next(err); }
};

// Send reminder emails for all overdue, unpaid invoices
exports.sendOverdueReminders = async (req, res, next) => {
  try {
    if (!mailer.getTransporter()) throw createError('Email is not configured (SMTP env vars missing)', 400);
    const today = new Date();
    const overdue = await prisma.invoice.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: today } },
      include: { customer: true },
    });

    let sent = 0, skipped = 0;
    for (const inv of overdue) {
      if (!inv.customer?.email) { skipped++; continue; }
      const ok = await mailer.sendOverdueReminder(inv, inv.customer);
      ok ? sent++ : skipped++;
    }
    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', summary: `Sent ${sent} overdue reminder(s)` });
    res.json({ overdue: overdue.length, sent, skipped });
  } catch (err) { next(err); }
};
