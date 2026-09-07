const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

exports.list = async (req, res, next) => {
  try {
    const budgets = await prisma.budget.findMany({
      where: { businessId: req.businessId },
      include: { _count: { select: { lines: true } } },
      orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }],
    });
    res.json(budgets);
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const budget = await prisma.budget.findUnique({
      where: { id: Number(req.params.id) },
      include: { lines: true },
    });
    if (!budget) throw createError('Budget not found', 404);

    // Attach account info to each line
    const accountIds = budget.lines.map((l) => l.accountId);
    const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } } });
    const map = Object.fromEntries(accounts.map((a) => [a.id, a]));
    budget.lines = budget.lines.map((l) => ({
      ...l,
      account: map[l.accountId] ? { accountCode: map[l.accountId].accountCode, accountName: map[l.accountId].accountName, accountType: map[l.accountId].accountType } : null,
    }));
    res.json(budget);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, fiscalYear, notes, lines = [] } = req.body;
    const budget = await prisma.budget.create({
      data: {
        businessId: req.businessId,
        name, fiscalYear: Number(fiscalYear), notes,
        createdBy: req.user?.id ?? null,
        lines: {
          create: lines.filter((l) => l.accountId).map((l) => ({
            accountId: Number(l.accountId),
            annualAmount: Number(l.annualAmount || 0),
          })),
        },
      },
      include: { lines: true },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'Budget', entityId: budget.id, summary: `Created budget "${budget.name}" FY${budget.fiscalYear}` });
    res.status(201).json(budget);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const budget = await prisma.budget.findUnique({ where: { id } });
    if (!budget) throw createError('Budget not found', 404);
    const { name, fiscalYear, notes, status, lines } = req.body;

    const updated = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.budgetLine.deleteMany({ where: { budgetId: id } });
        await tx.budgetLine.createMany({
          data: lines.filter((l) => l.accountId).map((l) => ({
            budgetId: id, accountId: Number(l.accountId), annualAmount: Number(l.annualAmount || 0),
          })),
        });
      }
      return tx.budget.update({
        where: { id },
        data: {
          ...(name && { name }),
          ...(fiscalYear && { fiscalYear: Number(fiscalYear) }),
          ...(notes != null && { notes }),
          ...(status && { status }),
        },
        include: { lines: true },
      });
    });
    await recordAudit({ req, action: 'UPDATE', entity: 'Budget', entityId: id, summary: `Updated budget "${updated.name}"` });
    res.json(updated);
  } catch (err) { next(err); }
};

// Budget vs Actual report for the budget's fiscal year (posted entries only).
exports.vsActual = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const budget = await prisma.budget.findUnique({ where: { id }, include: { lines: true } });
    if (!budget) throw createError('Budget not found', 404);

    const yearStart = new Date(Date.UTC(budget.fiscalYear, 0, 1));
    const yearEnd = new Date(Date.UTC(budget.fiscalYear, 11, 31, 23, 59, 59));

    const accountIds = budget.lines.map((l) => l.accountId);
    const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } } });
    const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

    // Actuals: sum posted journal lines for these accounts within the year
    const grouped = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accountIds },
        entry: { status: 'POSTED', entryDate: { gte: yearStart, lte: yearEnd } },
      },
      _sum: { debit: true, credit: true },
    });
    const actualMap = Object.fromEntries(grouped.map((g) => [g.accountId, g]));

    const rows = budget.lines.map((l) => {
      const acc = acctMap[l.accountId];
      const sums = actualMap[l.accountId] || { _sum: { debit: 0, credit: 0 } };
      const debit = Number(sums._sum.debit || 0);
      const credit = Number(sums._sum.credit || 0);
      // Revenue is naturally credit; expenses/others debit.
      const actual = acc?.accountType === 'REVENUE' ? credit - debit : debit - credit;
      const budgeted = Number(l.annualAmount);
      const variance = budgeted - actual;
      return {
        accountId: l.accountId,
        accountCode: acc?.accountCode,
        accountName: acc?.accountName,
        accountType: acc?.accountType,
        budgeted,
        actual: Number(actual.toFixed(2)),
        variance: Number(variance.toFixed(2)),
        utilization: budgeted ? Number(((actual / budgeted) * 100).toFixed(1)) : null,
      };
    }).sort((a, b) => (a.accountCode || '').localeCompare(b.accountCode || ''));

    res.json({
      budget: { id: budget.id, name: budget.name, fiscalYear: budget.fiscalYear, status: budget.status },
      rows,
      totals: {
        budgeted: rows.reduce((s, r) => s + r.budgeted, 0),
        actual: rows.reduce((s, r) => s + r.actual, 0),
        variance: rows.reduce((s, r) => s + r.variance, 0),
      },
    });
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.budget.delete({ where: { id } });
    await recordAudit({ req, action: 'DELETE', entity: 'Budget', entityId: id, summary: 'Deleted budget' });
    res.json({ message: 'Budget deleted' });
  } catch (err) { next(err); }
};
