const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ─── CRUD ──────────────────────────────────────────────────────

exports.list = async (req, res, next) => {
  try {
    const reports = await prisma.customReport.findMany({
      where: { businessId: req.businessId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, description: true, reportType: true, createdBy: true, createdAt: true, updatedAt: true },
    });
    res.json(reports);
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const report = await prisma.customReport.findUnique({ where: { id: Number(req.params.id) } });
    if (!report) throw createError('Custom report not found', 404);
    res.json(report);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, description, reportType, config } = req.body;
    if (!name?.trim()) throw createError('Report name is required', 400);
    if (!reportType)   throw createError('Report type is required', 400);
    if (!config)       throw createError('Report configuration is required', 400);

    const report = await prisma.customReport.create({
      data: {
        businessId: req.businessId, name: name.trim(), description: description?.trim() || null, reportType, config, createdBy: req.user.id },
    });
    res.status(201).json(report);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const { name, description, reportType, config } = req.body;
    const existing = await prisma.customReport.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw createError('Custom report not found', 404);

    const report = await prisma.customReport.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(name       && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(reportType && { reportType }),
        ...(config     && { config }),
      },
    });
    res.json(report);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const existing = await prisma.customReport.findUnique({ where: { id: Number(req.params.id) } });
    if (!existing) throw createError('Custom report not found', 404);
    await prisma.customReport.delete({ where: { id: Number(req.params.id) } });
    res.json({ message: 'Report deleted' });
  } catch (err) { next(err); }
};

// ─── Run a custom report ────────────────────────────────────────
exports.run = async (req, res, next) => {
  try {
    const report = await prisma.customReport.findUnique({ where: { id: Number(req.params.id) } });
    if (!report) throw createError('Custom report not found', 404);

    const config = typeof report.config === 'string' ? JSON.parse(report.config) : report.config;
    const result = await executeReport(report.reportType, config);
    res.json({ report, result });
  } catch (err) { next(err); }
};

// Run ad-hoc (preview before saving)
exports.preview = async (req, res, next) => {
  try {
    const { reportType, config } = req.body;
    if (!reportType || !config) throw createError('reportType and config are required', 400);
    const result = await executeReport(reportType, config);
    res.json(result);
  } catch (err) { next(err); }
};

// ─── Report execution engine ────────────────────────────────────
async function executeReport(reportType, config) {
  switch (reportType) {
    case 'account_balance':   return runAccountBalance(config);
    case 'period_comparison': return runPeriodComparison(config);
    case 'account_movement':  return runAccountMovement(config);
    case 'profit_loss':       return runProfitLoss(config);
    default: throw createError(`Unknown report type: ${reportType}`, 400);
  }
}

// ── Account Balance: balances per account as of a date ──────────
async function runAccountBalance(config) {
  const { asOf, accountTypes = [], accountIds = [], showZeroBalances = false } = config;

  const where = { isActive: true };
  if (accountTypes.length) where.accountType = { in: accountTypes };
  if (accountIds.length)   where.id = { in: accountIds.map(Number) };

  const accounts = await prisma.account.findMany({
    where,
    include: {
      journalLines: {
        where: {
          entry: {
            status: 'POSTED',
            ...(asOf && { entryDate: { lte: new Date(asOf) } }),
          },
        },
        select: { debit: true, credit: true },
      },
    },
    orderBy: [{ accountType: 'asc' }, { accountCode: 'asc' }],
  });

  const rows = accounts.map((a) => {
    const totalDebit  = a.journalLines.reduce((s, l) => s + Number(l.debit),  0);
    const totalCredit = a.journalLines.reduce((s, l) => s + Number(l.credit), 0);
    const balance = a.normalBalance === 'DEBIT' ? totalDebit - totalCredit : totalCredit - totalDebit;
    return { id: a.id, code: a.accountCode, name: a.accountName, type: a.accountType, normalBalance: a.normalBalance, debit: totalDebit, credit: totalCredit, balance };
  }).filter((r) => showZeroBalances || r.debit !== 0 || r.credit !== 0);

  const totals = rows.reduce((s, r) => ({ debit: s.debit + r.debit, credit: s.credit + r.credit, balance: s.balance + r.balance }), { debit: 0, credit: 0, balance: 0 });
  return { rows, totals, asOf, rowCount: rows.length };
}

// ── Period Comparison: two date ranges side by side ─────────────
async function runPeriodComparison(config) {
  const { period1From, period1To, period2From, period2To, accountTypes = [], accountIds = [], label1 = 'Period 1', label2 = 'Period 2' } = config;

  const where = { isActive: true };
  if (accountTypes.length) where.accountType = { in: accountTypes };
  if (accountIds.length)   where.id = { in: accountIds.map(Number) };

  const accounts = await prisma.account.findMany({ where, orderBy: [{ accountType: 'asc' }, { accountCode: 'asc' }] });

  const sumLines = async (from, to) => {
    if (!from || !to) return {};
    const lines = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: { status: 'POSTED', entryDate: { gte: new Date(from), lte: new Date(to) } },
        ...(accountIds.length ? { accountId: { in: accountIds.map(Number) } } : {}),
      },
      _sum: { debit: true, credit: true },
    });
    return Object.fromEntries(lines.map((l) => [l.accountId, { debit: Number(l._sum.debit || 0), credit: Number(l._sum.credit || 0) }]));
  };

  const [p1, p2] = await Promise.all([sumLines(period1From, period1To), sumLines(period2From, period2To)]);

  const rows = accounts.map((a) => {
    const d1 = p1[a.id] || { debit: 0, credit: 0 };
    const d2 = p2[a.id] || { debit: 0, credit: 0 };
    const bal1 = a.normalBalance === 'DEBIT' ? d1.debit - d1.credit : d1.credit - d1.debit;
    const bal2 = a.normalBalance === 'DEBIT' ? d2.debit - d2.credit : d2.credit - d2.debit;
    return { id: a.id, code: a.accountCode, name: a.accountName, type: a.accountType, bal1, bal2, variance: bal2 - bal1, variancePct: bal1 !== 0 ? ((bal2 - bal1) / Math.abs(bal1)) * 100 : null };
  }).filter((r) => r.bal1 !== 0 || r.bal2 !== 0);

  return { rows, label1, label2, period1: { from: period1From, to: period1To }, period2: { from: period2From, to: period2To }, rowCount: rows.length };
}

// ── Account Movement: activity within a date range ──────────────
async function runAccountMovement(config) {
  const { from, to, accountTypes = [], accountIds = [] } = config;
  if (!from || !to) throw createError('from and to dates are required for account movement', 400);

  const where = { isActive: true };
  if (accountTypes.length) where.accountType = { in: accountTypes };
  if (accountIds.length)   where.id = { in: accountIds.map(Number) };

  const accounts = await prisma.account.findMany({
    where,
    include: {
      journalLines: {
        where: { entry: { status: 'POSTED', entryDate: { gte: new Date(from), lte: new Date(to) } } },
        include: { entry: { select: { entryNo: true, entryDate: true, description: true } } },
        orderBy: { entry: { entryDate: 'asc' } },
      },
    },
    orderBy: [{ accountType: 'asc' }, { accountCode: 'asc' }],
  });

  const rows = accounts
    .filter((a) => a.journalLines.length > 0)
    .map((a) => ({
      id: a.id, code: a.accountCode, name: a.accountName, type: a.accountType,
      lines: a.journalLines.map((l) => ({
        entryNo: l.entry.entryNo, date: l.entry.entryDate, description: l.entry.description,
        debit: Number(l.debit), credit: Number(l.credit),
      })),
      totalDebit:  a.journalLines.reduce((s, l) => s + Number(l.debit),  0),
      totalCredit: a.journalLines.reduce((s, l) => s + Number(l.credit), 0),
    }));

  return { rows, from, to, rowCount: rows.length };
}

// ── Profit & Loss: revenue vs expense for a period ──────────────
async function runProfitLoss(config) {
  const { from, to, groupBy = 'type' } = config;
  if (!from || !to) throw createError('from and to dates are required for profit & loss', 400);

  const lines = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { entry: { status: 'POSTED', entryDate: { gte: new Date(from), lte: new Date(to) } } },
    _sum: { debit: true, credit: true },
  });

  const accountIds = lines.map((l) => l.accountId);
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds }, accountType: { in: ['REVENUE', 'EXPENSE'] } },
    orderBy: [{ accountType: 'asc' }, { accountCode: 'asc' }],
  });

  const lineMap = Object.fromEntries(lines.map((l) => [l.accountId, { debit: Number(l._sum.debit || 0), credit: Number(l._sum.credit || 0) }]));

  const rows = accounts.map((a) => {
    const d = lineMap[a.id] || { debit: 0, credit: 0 };
    const amount = a.accountType === 'REVENUE' ? d.credit - d.debit : d.debit - d.credit;
    return { id: a.id, code: a.accountCode, name: a.accountName, type: a.accountType, amount };
  });

  const revenue  = rows.filter((r) => r.type === 'REVENUE').reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter((r) => r.type === 'EXPENSE').reduce((s, r) => s + r.amount, 0);

  return { rows, revenue, expenses, netIncome: revenue - expenses, from, to, rowCount: rows.length };
}
