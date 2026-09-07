const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const prisma = require('../config/database');
const logger = require('../utils/logger');
const bcrypt = require('bcryptjs');

// ─── Helpers ──────────────────────────────────────────────────
const DEFAULTS = {
  // Company
  companyLogo:        '',              // base64 data URL or https:// URL
  companyName:        'My Company Inc.',
  companyAddress:     '',
  companyCity:        '',
  companyProvince:    '',
  companyZip:         '',
  companyPhone:       '',
  companyEmail:       '',
  companyWebsite:     '',
  // Tax / BIR
  companyTin:         '',
  rdoCode:            '',
  vatRegistered:      'true',
  vatRegDate:         '',
  birFormType:        '2550M',
  // Fiscal
  fiscalYearStart:    '01',   // month number (01=Jan)
  accountingMethod:   'ACCRUAL',
  currency:           'PHP',
  dateFormat:         'MM/DD/YYYY',
  // Payroll
  payrollCutoff1:     '15',
  payrollCutoff2:     '30',
  sssErRate:          '9.5',
  philhealthRate:     '5',
  pagibigErRate:      '2',
  taxExemptionCode:   'ME',
  // Numbering
  invoicePrefix:      'INV',
  invoiceNextNo:      '1000',
  billPrefix:         'BILL',
  billNextNo:         '1000',
  jePrefix:           'JE',
  jeNextNo:           '1000',
  paymentPrefix:      'PAY',
  // System
  systemTimezone:     'Asia/Manila',
  decimalPlaces:      '2',
  showCentsInReports: 'true',
  sessionTimeout:     '480',   // minutes
  enforceStrongPwd:   'true',
  auditTrail:         'true',
  // Invoice email template
  invoiceEmailSubject:             'Invoice {{invoiceNo}} from {{companyName}}',
  invoiceEmailGreeting:            'Dear {{customerName}},\n\nPlease find your invoice details below. Amount due: {{amountDue}}.',
  invoiceEmailPaymentInstructions: '',
  invoiceEmailTerms:               '',
  invoiceEmailSignature:           '',
};

// Get all settings, merged with defaults
const getAll = async (req, res, next) => {
  try {
    const rows = await prisma.systemSetting.findMany({ where: { businessId: req.businessId } });
    const map  = rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
    const merged = { ...DEFAULTS, ...map };
    res.json(merged);
  } catch (err) { next(err); }
};

// Upsert a batch of settings
const saveAll = async (req, res, next) => {
  try {
    const businessId = req.businessId;
    const updates = Object.entries(req.body);
    await Promise.all(
      updates.map(([key, value]) =>
        prisma.systemSetting.upsert({
          where:  { businessId_key: { businessId, key } },
          update: { value: String(value) },
          create: { businessId, key, value: String(value) },
        })
      )
    );
    logger.info(`[settings] ${updates.length} keys saved by user ${req.user?.id}`);
    res.json({ message: 'Settings saved successfully' });
  } catch (err) { next(err); }
};

// Reset to defaults
const resetDefaults = async (req, res, next) => {
  try {
    await prisma.systemSetting.deleteMany({ where: { businessId: req.businessId } });
    logger.warn(`[settings] All settings reset by user ${req.user?.id}`);
    res.json({ message: 'Settings reset to defaults' });
  } catch (err) { next(err); }
};

// ─── Database Backup ──────────────────────────────────────────
const backupDatabase = async (req, res, next) => {
  try {
    const url  = process.env.DATABASE_URL || '';
    // Parse mysql://user:pass@host:port/dbname
    const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (!match) return res.status(500).json({ error: 'Cannot parse DATABASE_URL for backup' });

    const [, user, pass, host, port, dbname] = match;
    const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `ph-erp-backup-${stamp}.sql`;
    const tmpPath  = path.join(os.tmpdir(), filename);

    // Try mysqldump — may not be available in all environments
    try {
      const cmd = `mysqldump -h ${host} -P ${port} -u ${user} -p${pass} --single-transaction --routines --triggers ${dbname} > "${tmpPath}"`;
      execSync(cmd, { stdio: 'pipe' });
    } catch (dumpErr) {
      logger.warn('[backup] mysqldump failed, falling back to Prisma data export');
      // Fallback: JSON export of all tables
      const [users, accounts, journalEntries, journalLines, vendors, bills, billLines,
             paymentsAP, customers, invoices, invoiceLines, paymentsAR,
             employees, payrollPeriods, payrollItems, settings] = await Promise.all([
        prisma.user.findMany(),
        prisma.account.findMany(),
        prisma.journalEntry.findMany(),
        prisma.journalLine.findMany(),
        prisma.vendor.findMany(),
        prisma.bill.findMany(),
        prisma.billLine.findMany(),
        prisma.paymentAP.findMany(),
        prisma.customer.findMany(),
        prisma.invoice.findMany(),
        prisma.invoiceLine.findMany(),
        prisma.paymentAR.findMany(),
        prisma.employee.findMany(),
        prisma.payrollPeriod.findMany(),
        prisma.payrollItem.findMany(),
        prisma.systemSetting.findMany(),
      ]);

      const backup = {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        tables: {
          users: users.map((u) => ({ ...u, password: '***REDACTED***' })),
          accounts, journalEntries, journalLines,
          vendors, bills, billLines, paymentsAP,
          customers, invoices, invoiceLines, paymentsAR,
          employees, payrollPeriods, payrollItems, settings,
        },
      };

      const jsonFile = tmpPath.replace('.sql', '.json');
      fs.writeFileSync(jsonFile, JSON.stringify(backup, null, 2));

      res.setHeader('Content-Disposition', `attachment; filename="ph-erp-backup-${stamp}.json"`);
      res.setHeader('Content-Type', 'application/json');
      const stream = fs.createReadStream(jsonFile);
      stream.pipe(res);
      stream.on('end', () => { try { fs.unlinkSync(jsonFile); } catch {} });
      logger.info(`[backup] JSON export by user ${req.user?.id}`);
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const stream = fs.createReadStream(tmpPath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(tmpPath); } catch {} });
    logger.info(`[backup] SQL dump by user ${req.user?.id}`);
  } catch (err) { next(err); }
};

// ─── Database Reset (DANGER) ─────────────────────────────────
const resetDatabase = async (req, res, next) => {
  const { confirmPhrase, adminPassword } = req.body;

  if (confirmPhrase !== 'RESET DATABASE') {
    return res.status(400).json({ error: 'Type RESET DATABASE to confirm' });
  }

  // Verify admin password
  const admin = await prisma.user.findUnique({ where: { id: req.user.id } });
  const valid = await bcrypt.compare(adminPassword, admin.password);
  if (!valid) return res.status(401).json({ error: 'Incorrect password' });

  try {
    // Delete in dependency order
    await prisma.$transaction([
      prisma.payrollItem.deleteMany(),
      prisma.payrollPeriod.deleteMany(),
      prisma.paymentAP.deleteMany(),
      prisma.paymentAR.deleteMany(),
      prisma.billLine.deleteMany(),
      prisma.invoiceLine.deleteMany(),
      prisma.bill.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.vendor.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.employee.deleteMany(),
      prisma.journalLine.deleteMany(),
      prisma.journalEntry.deleteMany(),
      prisma.account.deleteMany(),
    ]);
    logger.warn(`[DANGER] Database reset by user ${req.user?.id} (${req.user?.email})`);
    res.json({ message: 'Database reset complete. All transactional data deleted. Users and settings preserved.' });
  } catch (err) { next(err); }
};

// ─── DB Stats ─────────────────────────────────────────────────
const getDbStats = async (req, res, next) => {
  try {
    const [
      userCount, accountCount, jeCount, vendorCount, billCount,
      customerCount, invoiceCount, employeeCount, periodCount,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.account.count(),
      prisma.journalEntry.count(),
      prisma.vendor.count(),
      prisma.bill.count(),
      prisma.customer.count(),
      prisma.invoice.count(),
      prisma.employee.count(),
      prisma.payrollPeriod.count(),
    ]);

    // Attempt DB size query (MySQL-specific)
    let dbSizeMb = null;
    try {
      const url   = process.env.DATABASE_URL || '';
      const match = url.match(/\/([^/?]+)(\?|$)/);
      const dbname = match?.[1];
      if (dbname) {
        const result = await prisma.$queryRaw`
          SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
          FROM information_schema.tables
          WHERE table_schema = ${dbname}
        `;
        dbSizeMb = result[0]?.size_mb ?? null;
      }
    } catch {}

    res.json({
      counts: { userCount, accountCount, jeCount, vendorCount, billCount, customerCount, invoiceCount, employeeCount, periodCount },
      dbSizeMb,
      lastChecked: new Date().toISOString(),
    });
  } catch (err) { next(err); }
};

// ─── User management (ADMIN only) ────────────────────────────
const listUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) { next(err); }
};

const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER'];

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role, isActive, firstName, lastName } = req.body;
    if (role && !ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    const user = await prisma.user.update({
      where: { id: Number(id) },
      data: { ...(role && { role }), ...(isActive !== undefined && { isActive }), ...(firstName && { firstName }), ...(lastName && { lastName }) },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
    });
    res.json(user);
  } catch (err) { next(err); }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (Number(id) === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    await prisma.user.delete({ where: { id: Number(id) } });
    res.json({ message: 'User deleted' });
  } catch (err) { next(err); }
};

const resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: Number(id) }, data: { password: hashed } });
    res.json({ message: 'Password reset successfully' });
  } catch (err) { next(err); }
};

module.exports = { getAll, saveAll, resetDefaults, backupDatabase, resetDatabase, getDbStats, listUsers, updateUser, deleteUser, resetUserPassword, DEFAULTS };
