const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const glPost = require('../utils/glPost');
const { monthlyDepreciation, endOfMonth, addMonths } = require('../utils/finance');

const genAssetCode = async () => {
  const count = await prisma.fixedAsset.count();
  return `FA-${String(count + 1).padStart(5, '0')}`;
};

exports.list = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [{ name: { contains: search } }, { assetCode: { contains: search } }, { category: { contains: search } }];
    const data = await prisma.fixedAsset.findMany({ where, orderBy: { id: 'desc' } });
    res.json(data);
  } catch (err) { next(err); }
};

exports.summary = async (req, res, next) => {
  try {
    const assets = await prisma.fixedAsset.findMany();
    const totalCost = assets.reduce((s, a) => s + Number(a.cost), 0);
    const totalAccumulated = assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0);
    const totalBookValue = assets.reduce((s, a) => s + Number(a.bookValue), 0);
    res.json({
      count: assets.length,
      active: assets.filter((a) => a.status === 'ACTIVE').length,
      disposed: assets.filter((a) => a.status === 'DISPOSED').length,
      totalCost, totalAccumulated, totalBookValue,
    });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const asset = await prisma.fixedAsset.findUnique({
      where: { id: Number(req.params.id) },
      include: { depreciationEntries: { orderBy: { periodDate: 'asc' } } },
    });
    if (!asset) throw createError('Asset not found', 404);
    res.json(asset);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const b = req.body;
    const assetCode = b.assetCode || (await genAssetCode());
    const asset = await prisma.fixedAsset.create({
      data: {
        businessId: req.businessId,
        assetCode,
        name: b.name,
        category: b.category || null,
        acquisitionDate: new Date(b.acquisitionDate),
        cost: Number(b.cost),
        salvageValue: Number(b.salvageValue || 0),
        usefulLifeMonths: Number(b.usefulLifeMonths),
        method: b.method || 'STRAIGHT_LINE',
        decliningRate: b.decliningRate != null ? Number(b.decliningRate) : null,
        bookValue: Number(b.cost),
        assetAccountId: b.assetAccountId ? Number(b.assetAccountId) : null,
        depreciationExpenseAccountId: b.depreciationExpenseAccountId ? Number(b.depreciationExpenseAccountId) : null,
        accumulatedDepreciationAccountId: b.accumulatedDepreciationAccountId ? Number(b.accumulatedDepreciationAccountId) : null,
        notes: b.notes || null,
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'FixedAsset', entityId: asset.id, summary: `Created asset ${asset.assetCode} — ${asset.name}` });
    res.status(201).json(asset);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const asset = await prisma.fixedAsset.findUnique({ where: { id }, include: { depreciationEntries: true } });
    if (!asset) throw createError('Asset not found', 404);
    if (asset.depreciationEntries.length > 0) {
      // Once depreciation has run, restrict edits to descriptive fields only.
      const { name, category, notes } = req.body;
      const updated = await prisma.fixedAsset.update({ where: { id }, data: { name, category, notes } });
      return res.json(updated);
    }
    const b = req.body;
    const updated = await prisma.fixedAsset.update({
      where: { id },
      data: {
        name: b.name, category: b.category || null,
        acquisitionDate: b.acquisitionDate ? new Date(b.acquisitionDate) : asset.acquisitionDate,
        cost: Number(b.cost), salvageValue: Number(b.salvageValue || 0),
        usefulLifeMonths: Number(b.usefulLifeMonths),
        method: b.method || 'STRAIGHT_LINE',
        decliningRate: b.decliningRate != null ? Number(b.decliningRate) : null,
        bookValue: Number(b.cost),
        assetAccountId: b.assetAccountId ? Number(b.assetAccountId) : null,
        depreciationExpenseAccountId: b.depreciationExpenseAccountId ? Number(b.depreciationExpenseAccountId) : null,
        accumulatedDepreciationAccountId: b.accumulatedDepreciationAccountId ? Number(b.accumulatedDepreciationAccountId) : null,
        notes: b.notes || null,
      },
    });
    await recordAudit({ req, action: 'UPDATE', entity: 'FixedAsset', entityId: id, summary: `Updated asset ${asset.assetCode}` });
    res.json(updated);
  } catch (err) { next(err); }
};

// Projected full depreciation schedule (month by month), marking which periods
// are already posted.
exports.schedule = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const asset = await prisma.fixedAsset.findUnique({ where: { id }, include: { depreciationEntries: true } });
    if (!asset) throw createError('Asset not found', 404);

    const posted = new Set(asset.depreciationEntries.map((e) => endOfMonth(new Date(e.periodDate)).toISOString().slice(0, 10)));
    const rows = [];
    let bookValue = Number(asset.cost);
    const salvage = Number(asset.salvageValue);
    const start = new Date(asset.acquisitionDate);

    for (let i = 0; i < asset.usefulLifeMonths && bookValue > salvage + 0.005; i++) {
      const periodDate = endOfMonth(addMonths(start, i));
      const dep = monthlyDepreciation(asset, bookValue);
      bookValue = Math.max(salvage, bookValue - dep);
      rows.push({
        period: i + 1,
        periodDate,
        depreciation: Number(dep.toFixed(2)),
        accumulated: Number((Number(asset.cost) - bookValue).toFixed(2)),
        bookValue: Number(bookValue.toFixed(2)),
        posted: posted.has(periodDate.toISOString().slice(0, 10)),
      });
    }
    res.json({ asset, schedule: rows });
  } catch (err) { next(err); }
};

// Record depreciation for one period (defaults to the next unrecorded month).
exports.runDepreciation = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const asset = await prisma.fixedAsset.findUnique({ where: { id }, include: { depreciationEntries: { orderBy: { periodDate: 'desc' } } } });
    if (!asset) throw createError('Asset not found', 404);
    if (asset.status !== 'ACTIVE') throw createError('Only active assets can be depreciated', 400);

    const currentBookValue = Number(asset.bookValue);
    const salvage = Number(asset.salvageValue);
    if (currentBookValue <= salvage + 0.005) throw createError('Asset is already fully depreciated', 400);

    // Determine next period: month after the last entry, else acquisition month.
    let periodDate;
    if (req.body.periodDate) {
      periodDate = endOfMonth(new Date(req.body.periodDate));
    } else if (asset.depreciationEntries.length) {
      periodDate = endOfMonth(addMonths(new Date(asset.depreciationEntries[0].periodDate), 1));
    } else {
      periodDate = endOfMonth(new Date(asset.acquisitionDate));
    }

    const dep = Number(monthlyDepreciation(asset, currentBookValue).toFixed(2));
    if (dep <= 0) throw createError('No depreciation to record for this period', 400);

    const newBookValue = Number(Math.max(salvage, currentBookValue - dep).toFixed(2));
    const newAccumulated = Number((Number(asset.accumulatedDepreciation) + dep).toFixed(2));
    const fullyDepreciated = newBookValue <= salvage + 0.005;

    // Optional GL posting
    let journalEntryId = null;
    if (asset.depreciationExpenseAccountId && asset.accumulatedDepreciationAccountId) {
      const je = await glPost.safePost({
        entryDate: periodDate,
        description: `Depreciation — ${asset.assetCode} ${asset.name}`,
        reference: asset.assetCode,
        userId: req.user?.id || 1,
        lines: [
          { accountId: asset.depreciationExpenseAccountId, debit: dep, description: 'Depreciation expense' },
          { accountId: asset.accumulatedDepreciationAccountId, credit: dep, description: 'Accumulated depreciation' },
        ],
      });
      journalEntryId = je?.id || null;
    }

    const entry = await prisma.depreciationEntry.create({
      data: { assetId: id, periodDate, amount: dep, bookValueAfter: newBookValue, journalEntryId },
    });
    const updated = await prisma.fixedAsset.update({
      where: { id },
      data: {
        accumulatedDepreciation: newAccumulated,
        bookValue: newBookValue,
        status: fullyDepreciated ? 'FULLY_DEPRECIATED' : 'ACTIVE',
      },
    });
    await recordAudit({ req, action: 'DEPRECIATE', entity: 'FixedAsset', entityId: id, summary: `Recorded depreciation ${dep} for ${asset.assetCode} (${periodDate.toISOString().slice(0, 7)})` });
    res.json({ entry, asset: updated });
  } catch (err) { next(err); }
};

exports.dispose = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { disposalDate, disposalAmount } = req.body;
    const asset = await prisma.fixedAsset.findUnique({ where: { id } });
    if (!asset) throw createError('Asset not found', 404);
    if (asset.status === 'DISPOSED') throw createError('Asset already disposed', 400);

    const updated = await prisma.fixedAsset.update({
      where: { id },
      data: {
        status: 'DISPOSED',
        disposalDate: disposalDate ? new Date(disposalDate) : new Date(),
        disposalAmount: disposalAmount != null ? Number(disposalAmount) : null,
      },
    });
    const gainLoss = (Number(disposalAmount || 0) - Number(asset.bookValue)).toFixed(2);
    await recordAudit({ req, action: 'DISPOSE', entity: 'FixedAsset', entityId: id, summary: `Disposed ${asset.assetCode} (gain/loss ${gainLoss})` });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const asset = await prisma.fixedAsset.findUnique({ where: { id }, include: { depreciationEntries: true } });
    if (!asset) throw createError('Asset not found', 404);
    if (asset.depreciationEntries.length > 0) throw createError('Cannot delete an asset that has depreciation history. Dispose it instead.', 400);
    await prisma.fixedAsset.delete({ where: { id } });
    await recordAudit({ req, action: 'DELETE', entity: 'FixedAsset', entityId: id, summary: `Deleted asset ${asset.assetCode}` });
    res.json({ message: 'Asset deleted' });
  } catch (err) { next(err); }
};
