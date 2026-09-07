const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { buildLiquidationEntry } = require('../utils/cashAdvance');
const { recordAudit, diff } = require('../utils/audit');
const logger = require('../utils/logger');

// Compact item snapshot for audit diffs — avoids dumping full nested objects.
const itemSnapshot = (items = []) => items.map(it => ({ description: it.description, amount: Number(it.amount) }));

// Category → GL account code mapping
const CATEGORY_ACCOUNT = {
  TRANSPORTATION:  '6520',
  MEALS:           '6510',
  OFFICE_SUPPLIES: '6320',
  UTILITIES:       '6220',
  REPAIRS:         '6240',
  PROFESSIONAL:    '6400',
  BANK_CHARGES:    '6360',
  ADVERTISING:     '6530',
  EVENTS:          '6160',
  COURIER:         '6330',
  RENT:            '6210',
  TAXES:           '6370',
  MISCELLANEOUS:   '6390',
};

// ─── Expense categories (predefined for quick selection) ─────────
exports.getCategories = (_req, res) => {
  res.json([
    { value: 'TRANSPORTATION',  label: 'Transportation',         sub: 'Gas, toll, parking, taxi/Grab' },
    { value: 'MEALS',           label: 'Meals & Entertainment',  sub: 'Food, drinks, client meals' },
    { value: 'OFFICE_SUPPLIES', label: 'Office Supplies',        sub: 'Stationery, printer ink, etc.' },
    { value: 'UTILITIES',       label: 'Utilities',              sub: 'Electricity, water, internet, phone' },
    { value: 'REPAIRS',         label: 'Repairs & Maintenance',  sub: 'Equipment, vehicle, facility' },
    { value: 'PROFESSIONAL',    label: 'Professional Fees',      sub: 'Consultants, lawyers, accountants' },
    { value: 'BANK_CHARGES',    label: 'Bank Charges',           sub: 'Service fees, charges' },
    { value: 'ADVERTISING',     label: 'Advertising & Promo',    sub: 'Marketing materials, digital ads' },
    { value: 'EVENTS',          label: 'Events & Production',    sub: 'Venue, equipment, crew' },
    { value: 'COURIER',         label: 'Courier & Delivery',     sub: 'Shipping, messenger' },
    { value: 'RENT',            label: 'Rent / Lease',           sub: 'Office, warehouse, equipment rent' },
    { value: 'TAXES',           label: 'Taxes & Licenses',       sub: 'BIR payments, permits, licenses' },
    { value: 'MISCELLANEOUS',   label: 'Miscellaneous',          sub: 'Other company expenses' },
  ]);
};

// ─── Sequential voucher number ────────────────────────────────────
async function nextVoucherNo() {
  const last = await prisma.expenseVoucher.findFirst({
    orderBy: { id: 'desc' },
    select: { voucherNo: true },
  });
  if (!last) return 'EV-000001';
  const n = parseInt(last.voucherNo.replace('EV-', ''), 10);
  return `EV-${String(n + 1).padStart(6, '0')}`;
}

// ─── Summary ──────────────────────────────────────────────────────
exports.getSummary = async (req, res, next) => {
  try {
    const today = new Date();
    const yr    = today.getFullYear();
    const mo    = today.getMonth();

    const [all, paidYTD, thisMonth] = await Promise.all([
      prisma.expenseVoucher.groupBy({
        by: ['status'],
        where: { businessId: req.businessId },
        _count: { id: true },
        _sum:   { totalAmount: true },
      }),
      prisma.expenseVoucher.aggregate({
        where: { businessId: req.businessId, status: 'PAID', paidDate: { gte: new Date(yr, 0, 1) } },
        _sum: { totalAmount: true },
      }),
      prisma.expenseVoucher.aggregate({
        where: {
          businessId: req.businessId,
          status: { in: ['APPROVED', 'PAID'] },
          date:   { gte: new Date(yr, mo, 1), lt: new Date(yr, mo + 1, 1) },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    const byStatus = Object.fromEntries(all.map(r => [r.status, { count: r._count.id, amount: Number(r._sum.totalAmount || 0) }]));
    res.json({
      draft:      byStatus.DRAFT      || { count: 0, amount: 0 },
      submitted:  byStatus.SUBMITTED  || { count: 0, amount: 0 },
      approved:   byStatus.APPROVED   || { count: 0, amount: 0 },
      paid:       byStatus.PAID       || { count: 0, amount: 0 },
      rejected:   byStatus.REJECTED   || { count: 0, amount: 0 },
      paidYTD:    Number(paidYTD._sum.totalAmount || 0),
      thisMonth:  Number(thisMonth._sum.totalAmount || 0),
    });
  } catch (err) { next(err); }
};

// ─── List ─────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { type, status, from, to, search, page = 1, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (type)   where.type   = type;
    if (status) where.status = status;
    if (search) where.OR = [
      { voucherNo:  { contains: search } },
      { payee:      { contains: search } },
      { purpose:    { contains: search } },
      { requestedBy:{ contains: search } },
    ];
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.date.lte = new Date(to   + 'T23:59:59.999Z');
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const [rows, total] = await Promise.all([
      prisma.expenseVoucher.findMany({
        where,
        include: { items: { include: { account: { select: { accountCode: true, accountName: true } } } } },
        orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }],
        skip, take: Number(limit),
      }),
      prisma.expenseVoucher.count({ where }),
    ]);

    res.json({ data: rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get One ──────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: { include: { account: { select: { id: true, accountCode: true, accountName: true } } } } },
    });
    if (!row) throw createError('Expense voucher not found', 404);
    res.json(row);
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { type, date, payee, category, purpose, receiptNo, requestedBy, notes, items = [] } = req.body;

    const totalAmount = items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const voucherNo   = await nextVoucherNo();

    const record = await prisma.expenseVoucher.create({
      data: {
        businessId: req.businessId,
        voucherNo, type, date: new Date(date + 'T00:00:00.000Z'),
        payee, category, purpose,
        totalAmount, receiptNo, requestedBy, notes,
        items: {
          create: items.map(it => ({
            description: it.description,
            accountId:   it.accountId || null,
            amount:      Number(it.amount || 0),
            receiptNo:   it.receiptNo  || null,
          })),
        },
      },
      include: { items: true },
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'ExpenseVoucher', entityId: record.id,
      summary: `Created ${type} voucher ${voucherNo} for ${payee}`,
    });

    res.status(201).json(record);
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseVoucher.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw createError('Not found', 404);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw createError('Only DRAFT or REJECTED vouchers can be edited', 400);

    const { type, date, payee, category, purpose, receiptNo, requestedBy, notes, items } = req.body;
    const totalAmount = Array.isArray(items) ? items.reduce((s, it) => s + Number(it.amount || 0), 0) : Number(existing.totalAmount);

    await prisma.expenseVoucher.update({
      where: { id },
      data: {
        type, payee, category, purpose, receiptNo, requestedBy, notes, totalAmount,
        date:   date ? new Date(date + 'T00:00:00.000Z') : undefined,
        status: existing.status === 'REJECTED' ? 'DRAFT' : undefined,
      },
    });

    if (Array.isArray(items)) {
      await prisma.expenseVoucherItem.deleteMany({ where: { voucherId: id } });
      if (items.length) {
        await prisma.expenseVoucherItem.createMany({
          data: items.map(it => ({
            voucherId:   id,
            description: it.description,
            accountId:   it.accountId || null,
            amount:      Number(it.amount || 0),
            receiptNo:   it.receiptNo  || null,
          })),
        });
      }
    }

    const updated = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: { include: { account: { select: { id: true, accountCode: true, accountName: true } } } } },
    });

    await recordAudit({
      req, action: 'UPDATE', entity: 'ExpenseVoucher', entityId: id,
      summary: `Updated voucher ${updated.voucherNo}`,
      changes: diff(
        { type: existing.type, payee: existing.payee, category: existing.category, purpose: existing.purpose,
          receiptNo: existing.receiptNo, notes: existing.notes, totalAmount: Number(existing.totalAmount),
          items: itemSnapshot(existing.items) },
        { type: updated.type, payee: updated.payee, category: updated.category, purpose: updated.purpose,
          receiptNo: updated.receiptNo, notes: updated.notes, totalAmount: Number(updated.totalAmount),
          items: itemSnapshot(updated.items) },
      ),
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Submit ───────────────────────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { requestedBy } = req.body;

    const existing = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!existing) throw createError('Expense voucher not found', 404);
    if (existing.status === 'VOID') throw createError('A voided voucher cannot be reopened', 400);

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'SUBMITTED', requestedBy: requestedBy || undefined },
    });

    await recordAudit({
      req, action: 'SUBMIT', entity: 'ExpenseVoucher', entityId: id,
      summary: `Submitted ${updated.voucherNo} for approval`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Approve ──────────────────────────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { approvedBy, items } = req.body;

    const existing = await prisma.expenseVoucher.findUnique({ where: { id }, include: { items: true } });
    if (!existing) throw createError('Expense voucher not found', 404);
    if (existing.status === 'VOID') throw createError('A voided voucher cannot be reopened', 400);

    if (Array.isArray(items)) {
      await prisma.expenseVoucherItem.deleteMany({ where: { voucherId: id } });
      if (items.length) {
        await prisma.expenseVoucherItem.createMany({
          data: items.map(it => ({
            voucherId:   id,
            description: it.description,
            accountId:   it.accountId || null,
            amount:      Number(it.amount || 0),
            receiptNo:   it.receiptNo  || null,
          })),
        });
      }
    }

    const totalAmount = Array.isArray(items)
      ? items.reduce((s, it) => s + Number(it.amount || 0), 0)
      : undefined;

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: approvedBy || undefined, totalAmount },
      include: { items: { include: { account: { select: { id: true, accountCode: true, accountName: true } } } } },
    });

    const itemsChanged = Array.isArray(items) && Number(existing.totalAmount) !== Number(updated.totalAmount);
    await recordAudit({
      req, action: 'APPROVE', entity: 'ExpenseVoucher', entityId: id,
      summary: `Approved ${updated.voucherNo}${itemsChanged ? ' — items adjusted' : ''}`,
      changes: Array.isArray(items)
        ? diff({ items: itemSnapshot(existing.items), totalAmount: Number(existing.totalAmount) },
                { items: itemSnapshot(updated.items),  totalAmount: Number(updated.totalAmount) })
        : undefined,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Mark Paid ────────────────────────────────────────────────────
exports.pay = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paidBy, paidDate, paymentAccountCode } = req.body;

    // Fetch voucher with items before updating
    const voucher = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!voucher) throw createError('Expense voucher not found', 404);
    if (voucher.status !== 'APPROVED') throw createError('Voucher must be APPROVED before marking paid', 400);

    // A liquidation settles against the cash account its cash request was
    // released from — fetched up front so the stored code matches the GL.
    let linkedRequest = null;
    if (voucher.type === 'LIQUIDATION' && voucher.cashRequestId) {
      linkedRequest = await prisma.cashRequest.findFirst({
        where: { id: voucher.cashRequestId, businessId: voucher.businessId },
        select: { requestNo: true, releasedAmount: true, cashAccountCode: true },
      });
      if (!linkedRequest) throw createError('Linked cash request not found', 404);
    }

    // Use explicitly chosen payment account; fall back to type-based default.
    // Resolved before the update so it can be persisted — reports split
    // petty-cash vs collections on this, not on the voucher `type`.
    const cashCode = linkedRequest?.cashAccountCode
                  || paymentAccountCode
                  || (voucher.type === 'PETTY_CASH' ? '1011' : '1020');
    const totalAmt = Number(voucher.totalAmount);

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: {
        status:   'PAID',
        paidBy:   paidBy  || undefined,
        paidDate: paidDate ? new Date(paidDate + 'T00:00:00.000Z') : new Date(),
        paymentAccountCode: cashCode,
      },
    });

    // Build DR lines: use item accountId if set, else fall back to category mapping
    const drLines = [];
    if (voucher.items.length > 0) {
      for (const item of voucher.items) {
        if (item.accountId) {
          drLines.push({ accountId: item.accountId, debit: Number(item.amount), description: item.description });
        } else {
          const code = CATEGORY_ACCOUNT[voucher.category] || '6390';
          drLines.push({ accountCode: code, debit: Number(item.amount), description: item.description });
        }
      }
    } else {
      // No items — post total to category account
      const code = CATEGORY_ACCOUNT[voucher.category] || '6390';
      drLines.push({ accountCode: code, debit: totalAmt, description: `${voucher.payee} — ${voucher.purpose.slice(0, 80)}` });
    }

    if (linkedRequest) {
      const request = linkedRequest;
      const { lines } = buildLiquidationEntry({
        requestNo:       request.requestNo,
        releasedAmount:  Number(request.releasedAmount),
        lines:           voucher.items.map((i) => ({
          description: i.description,
          amount:      Number(i.amount),
          accountId:   i.accountId,
        })),
        cashAccountCode: request.cashAccountCode,
      });

      await glPost.safePost({
        entryDate:   paidDate || new Date().toISOString().slice(0, 10),
        description: `Liquidation — ${request.requestNo} (${voucher.payee})`,
        reference:   request.requestNo,
        lines,
        userId:      req.user?.id || 1,
        businessId:  req.businessId,
      });
    } else {
      await glPost.safePost({
        entryDate:   paidDate || new Date().toISOString().slice(0, 10),
        description: `Expense Voucher — ${voucher.voucherNo} (${voucher.payee})`,
        reference:   voucher.voucherNo,
        lines: [
          ...drLines,
          { accountCode: cashCode, credit: totalAmt, description: `Cash paid — ${voucher.voucherNo}` },
        ],
        userId:     req.user?.id || 1,
        businessId: req.businessId,
      });
    }

    await recordAudit({
      req, action: 'PAY', entity: 'ExpenseVoucher', entityId: id,
      summary: `Marked ${voucher.voucherNo} as paid via ${cashCode}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Reject ───────────────────────────────────────────────────────
exports.reject = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rejectedReason } = req.body;

    const existing = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!existing) throw createError('Expense voucher not found', 404);
    if (existing.status === 'VOID') throw createError('A voided voucher cannot be reopened', 400);

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'REJECTED', rejectedReason },
    });

    await recordAudit({
      req, action: 'REJECT', entity: 'ExpenseVoucher', entityId: id,
      summary: `Rejected ${updated.voucherNo}${rejectedReason ? `: ${rejectedReason}` : ''}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Void ─────────────────────────────────────────────────────────
// A LIQUIDATION voucher's GL entry is posted under its linked cash
// request's requestNo, not the voucher's own voucherNo — see pay()'s
// linkedRequest branch and cashRequestController.liquidate. The GL
// lookup below must match whichever reference was actually posted.
exports.void = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const voucher = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!voucher) throw createError('Expense voucher not found', 404);
    if (!['SUBMITTED', 'APPROVED', 'PAID'].includes(voucher.status)) {
      throw createError('Only SUBMITTED, APPROVED, or PAID vouchers can be voided', 400);
    }

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
    });

    if (voucher.status === 'PAID') {
      let entryWhere = { businessId: voucher.businessId, reference: voucher.voucherNo, status: 'POSTED' };

      if (voucher.type === 'LIQUIDATION' && voucher.cashRequestId) {
        const cashRequest = await prisma.cashRequest.findUnique({
          where: { id: voucher.cashRequestId },
          select: { requestNo: true },
        });
        if (cashRequest) {
          // The cash request's release entry shares this same reference —
          // disambiguate to the liquidation entry itself (both pay()'s
          // linkedRequest branch and cashRequestController.liquidate post
          // the liquidation entry's description starting with "Liquidation").
          entryWhere = {
            businessId:  voucher.businessId,
            reference:   cashRequest.requestNo,
            status:      'POSTED',
            description: { startsWith: 'Liquidation' },
          };
        }
      }

      const entry = await prisma.journalEntry.findFirst({ where: entryWhere });
      if (entry) {
        try {
          await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
        } catch (err) {
          logger.error(`[EXPENSE VOID — GL VOID FAILED] voucherNo=${voucher.voucherNo} biz=${voucher.businessId} — ${err.message}`);
          try {
            await recordAudit({
              action:     'GL_POST_FAILED',
              entity:     'JournalEntry',
              entityId:   String(entry.id),
              summary:    `Failed to void GL entry for voided expense voucher ${voucher.voucherNo} — ${err.message}`,
              user:       req.user?.id ? { id: req.user.id } : undefined,
              businessId: voucher.businessId,
            });
          } catch { /* auditing must never break anything either */ }
        }
      }
    }

    await recordAudit({
      req, action: 'VOID', entity: 'ExpenseVoucher', entityId: id,
      summary: `Voided ${voucher.voucherNo}: ${reason}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft/rejected only) ────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!existing) throw createError('Not found', 404);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw createError('Only DRAFT or REJECTED vouchers can be deleted', 400);
    await prisma.expenseVoucher.delete({ where: { id } });

    await recordAudit({
      req, action: 'DELETE', entity: 'ExpenseVoucher', entityId: id,
      summary: `Deleted voucher ${existing.voucherNo}`,
    });

    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};
