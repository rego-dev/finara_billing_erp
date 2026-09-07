const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

exports.list = async (req, res, next) => {
  try {
    const { type, search, active } = req.query;
    const bizId = req.businessId;
    const where = { businessId: bizId };
    if (type) where.accountType = type;
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [
      { accountCode: { contains: search } },
      { accountName: { contains: search } },
    ];

    const accounts = await prisma.account.findMany({
      where,
      include: { parent: { select: { accountCode: true, accountName: true } } },
      orderBy: [{ accountCode: 'asc' }],
    });
    res.json(accounts);
  } catch (err) { next(err); }
};

exports.tree = async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { businessId: req.businessId, isActive: true },
      include: { children: true },
      orderBy: { accountCode: 'asc' },
    });
    const roots = accounts.filter((a) => !a.parentId);
    res.json(roots);
  } catch (err) { next(err); }
};

exports.getTypes = (req, res) => {
  res.json(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']);
};

exports.getOne = async (req, res, next) => {
  try {
    const account = await prisma.account.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: {
        parent: true,
        children: true,
        journalLines: {
          where: { entry: { businessId: req.businessId } },
          include: { entry: true },
          orderBy: { entry: { entryDate: 'desc' } },
          take: 20,
        },
      },
    });
    if (!account) throw createError('Account not found', 404);

    const debits  = account.journalLines.reduce((s, l) => s + Number(l.debit),  0);
    const credits = account.journalLines.reduce((s, l) => s + Number(l.credit), 0);
    res.json({ ...account, balance: debits - credits });
  } catch (err) { next(err); }
};

// Starting digit per account type (Philippine standard CoA: 1xxx assets, 2xxx
// liabilities, 3xxx equity, 4xxx revenue, 5xxx–6xxx expenses)
const TYPE_BASE = { ASSET: 1, LIABILITY: 2, EQUITY: 3, REVENUE: 4, EXPENSE: 5 };

// Next sequential code within the type's range, stepping by 10 (accounting convention)
async function nextAccountCode(businessId, accountType) {
  const base = (TYPE_BASE[accountType] || 9) * 1000;
  const rows = await prisma.account.findMany({
    where: { businessId, accountType },
    select: { accountCode: true },
  });
  let max = 0;
  for (const { accountCode } of rows) {
    if (/^\d+$/.test(accountCode)) max = Math.max(max, parseInt(accountCode, 10));
  }
  return String(max > 0 ? max + 10 : base + 10); // e.g. 1010, 1020, …
}

exports.create = async (req, res, next) => {
  try {
    const { accountCode, accountName, accountType, normalBalance, parentId, description } = req.body;
    const base = {
      businessId: req.businessId,
      accountName, accountType, normalBalance,
      parentId: parentId || null, description,
    };

    if (accountCode && accountCode.trim()) {
      const account = await prisma.account.create({ data: { ...base, accountCode: accountCode.trim() } });
      return res.status(201).json(account);
    }
    if (!accountType) throw createError('Account type is required to auto-generate a code', 400);
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = await nextAccountCode(req.businessId, accountType);
        const account = await prisma.account.create({ data: { ...base, accountCode: code } });
        return res.status(201).json(account);
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { accountName, description, isActive } = req.body;
    const account = await prisma.account.updateMany({
      where: { id, businessId: req.businessId },
      data:  { accountName, description, isActive },
    });
    res.json(account);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const lineCount = await prisma.journalLine.count({ where: { accountId: id } });
    if (lineCount > 0) throw createError('Cannot delete account with existing transactions', 400);
    await prisma.account.deleteMany({ where: { id, businessId: req.businessId } });
    res.json({ message: 'Account deleted' });
  } catch (err) { next(err); }
};
