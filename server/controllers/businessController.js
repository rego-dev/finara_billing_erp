const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { clearBusinessCache } = require('../utils/glPost');
const { cloneChartOfAccounts } = require('../utils/cloneChartOfAccounts');
const { resetDemoBusiness } = require('../../prisma/seedDemo');

// ─── List all businesses the current user can access ─────────────
exports.list = async (req, res, next) => {
  try {
    let businesses;
    if (['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      businesses = await prisma.business.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } else {
      const ubs = await prisma.userBusiness.findMany({
        where: { userId: req.user.id },
        include: { business: true },
      });
      businesses = ubs.map((ub) => ub.business).filter((b) => b.isActive);
    }
    res.json(businesses);
  } catch (err) { next(err); }
};

// ─── Get one ─────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // Non-admins may only fetch a business they've been granted access to —
    // same restriction list() already applies. Without this, any authenticated
    // user could read another business's profile (name, TIN, address, contact
    // info) just by guessing its id.
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      const ub = await prisma.userBusiness.findUnique({
        where: { userId_businessId: { userId: req.user.id, businessId: id } },
      });
      if (!ub) throw createError('Access denied to this business', 403);
    }

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    res.json(biz);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { code, name, tin, address, phone, email, industry, booksStartDate } = req.body;
    if (!code || !name) throw createError('code and name are required', 400);

    const biz = await prisma.business.create({
      data: {
        code: code.toUpperCase(), name, tin, address, phone, email, industry,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      },
    });

    // Auto-clone the default COA from business 1 into the new business
    await cloneChartOfAccounts(1, biz.id);

    // Grant all ADMIN users access to the new business
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.userBusiness.createMany({
      data: admins.map((u) => ({ userId: u.id, businessId: biz.id })),
      skipDuplicates: true,
    });

    res.status(201).json(biz);
  } catch (err) { next(err); }
};

// ─── Update ──────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, phone, email, industry, isActive, booksStartDate } = req.body;
    const biz = await prisma.business.update({
      where: { id },
      data: {
        name, tin, address, phone, email, industry, isActive,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      },
    });

    // Posting caches the cutover date — without this it honours the old one
    // until the process restarts.
    clearBusinessCache(id);

    res.json(biz);
  } catch (err) { next(err); }
};

// ─── Reset the demo account only ──────────────────────────────────
// Always resolves the target by the fixed DEMO business code — never by a
// client-supplied id — so this can never be pointed at a real business.
// Wipes all demo transactional data and rebuilds a clean baseline: Chart of
// Accounts, demo login, and sample customers/vendors/employees. AR/AP are
// left empty on purpose so a live demo starts from a blank slate.
exports.resetDemo = async (req, res, next) => {
  try {
    const { business } = await resetDemoBusiness({ withTransactions: false });
    res.json({
      message: `Demo account reset. "${business.name}" now has a fresh Chart of Accounts and sample customers/vendors/employees — no invoices or bills.`,
      business,
    });
  } catch (err) { next(err); }
};

// ─── User access management ──────────────────────────────────────
exports.listUsers = async (req, res, next) => {
  try {
    const bizId = Number(req.params.id);
    const ubs = await prisma.userBusiness.findMany({
      where: { businessId: bizId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
    });
    res.json(ubs.map((ub) => ub.user));
  } catch (err) { next(err); }
};

exports.grantUser = async (req, res, next) => {
  try {
    const bizId  = Number(req.params.id);
    const userId = Number(req.body.userId);
    await prisma.userBusiness.upsert({
      where:  { userId_businessId: { userId, businessId: bizId } },
      create: { userId, businessId: bizId },
      update: {},
    });
    res.json({ message: 'Access granted' });
  } catch (err) { next(err); }
};

exports.revokeUser = async (req, res, next) => {
  try {
    const bizId  = Number(req.params.id);
    const userId = Number(req.params.userId);
    await prisma.userBusiness.deleteMany({ where: { userId, businessId: bizId } });
    res.json({ message: 'Access revoked' });
  } catch (err) { next(err); }
};
