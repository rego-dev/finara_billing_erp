const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');
const logger = require('../utils/logger');
const { recordAudit } = require('../utils/audit');
const { AGING_BUCKETS, classifyUpcomingBucket } = require('../utils/apAgingBuckets');
const { differenceInCalendarDays } = require('date-fns');

const genBillNo = async () => {
  const count = await prisma.bill.count();
  return `BILL-${String(count + 1).padStart(6, '0')}`;
};
const genPayNo = async () => {
  const count = await prisma.paymentAP.count();
  return `PAP-${String(count + 1).padStart(6, '0')}`;
};

// Next sequential vendor code (VEN-001, VEN-002, …) per business
async function nextVendorCode(businessId) {
  const rows = await prisma.vendor.findMany({
    where: { businessId, vendorCode: { startsWith: 'VEN-' } },
    select: { vendorCode: true },
  });
  let max = 0;
  for (const { vendorCode } of rows) {
    const m = /^VEN-(\d+)$/.exec(vendorCode);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'VEN-' + String(max + 1).padStart(3, '0');
}

// Shared by createBill/updateBill: recompute per-line VAT + running totals.
// Contra-expense accounts (e.g. Purchase Discounts, Purchase Returns &
// Allowances — EXPENSE type but normalBalance CREDIT) reduce the subtotal
// instead of adding to it, so their line amount is negated before VAT is
// applied.
async function computeBillTotals(lines) {
  const accountIds = [...new Set(lines.map((l) => Number(l.accountId)))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, normalBalance: true },
  });
  const normalBalanceById = new Map(accounts.map((a) => [a.id, a.normalBalance]));

  let subtotal = 0, vatAmount = 0;
  const processedLines = lines.map((l) => {
    const sign = normalBalanceById.get(Number(l.accountId)) === 'CREDIT' ? -1 : 1;
    const amt = sign * Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, totalAmount: subtotal + vatAmount, processedLines };
}

// Shared by createBill/updateBill: DR each expense/cost line (or CR for a
// contra-expense line, since l.amount is already negative for those,
// matching their CREDIT normal balance) / DR Input VAT / CR Accounts
// Payable — Trade.
function buildBillGLLines(bill) {
  return [
    ...bill.lines.map((l) => {
      const amt = Number(l.amount);
      return amt < 0
        ? { accountId: l.accountId, credit: -amt, description: l.description }
        : { accountId: l.accountId, debit: amt, description: l.description };
    }),
    ...(Number(bill.vatAmount) > 0 ? [{
      accountCode: '1330', debit: Number(bill.vatAmount), description: 'Input VAT',
    }] : []),
    {
      accountCode: '2010', credit: Number(bill.totalAmount),
      description: `AP — ${bill.vendor.name} (${bill.billNo})`,
    },
  ];
}

exports.listVendors = async (req, res, next) => {
  try {
    const { search, active } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [{ name: { contains: search } }, { vendorCode: { contains: search } }];
    res.json(await prisma.vendor.findMany({ where, orderBy: { name: 'asc' } }));
  } catch (err) { next(err); }
};

exports.createVendor = async (req, res, next) => {
  try {
    const { vendorCode, name, tin, address, contactName, email, phone } = req.body;
    const base = { businessId: req.businessId, name, tin, address, contactName, email, phone };

    if (vendorCode && vendorCode.trim()) {
      const vendor = await prisma.vendor.create({ data: { ...base, vendorCode: vendorCode.trim() } });
      return res.status(201).json(vendor);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = await nextVendorCode(req.businessId);
        const vendor = await prisma.vendor.create({ data: { ...base, vendorCode: code } });
        return res.status(201).json(vendor);
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
  } catch (err) { next(err); }
};

exports.updateVendor = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, contactName, email, phone, isActive } = req.body;
    res.json(await prisma.vendor.update({ where: { id }, data: { name, tin, address, contactName, email, phone, isActive } }));
  } catch (err) { next(err); }
};

exports.listBills = async (req, res, next) => {
  try {
    const { status, vendorId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (vendorId) where.vendorId = Number(vendorId);
    if (from || to) where.billDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        include: { lines: true, payments: { orderBy: { paymentDate: 'asc' } } },
        orderBy: { billDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.bill.count({ where }),
    ]);

    // Fetch vendors separately (not via `include`) so a bill whose vendor was
    // deleted out from under it (orphaned FK) can't crash the whole list —
    // Prisma throws on `include` when a required relation resolves to null.
    const vendorIds = [...new Set(bills.map((b) => b.vendorId))];
    const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true, vendorCode: true } });
    const vendorById = Object.fromEntries(vendors.map((v) => [v.id, v]));
    const billsWithVendor = bills.map((b) => ({ ...b, vendor: vendorById[b.vendorId] || null }));

    res.json({ data: billsWithVendor, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch (err) { next(err); }
};

exports.getBill = async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        lines: { include: { account: { select: { accountCode: true, accountName: true } } } },
        payments: true,
      },
    });
    if (!bill) throw createError('Bill not found', 404);

    // Fetch vendor separately — same orphaned-FK protection as listBills, so
    // a bill whose vendor was deleted is still viewable/voidable/editable.
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId } });
    res.json({ ...bill, vendor });
  } catch (err) { next(err); }
};

exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    const billNo = await genBillNo();
    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo, vendorId: Number(vendorId),
        billDate: new Date(billDate), dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    await glPost.safePost({
      entryDate:   bill.billDate,
      description: `AP Bill — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       buildBillGLLines(bill),
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(bill);
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes, checkDate } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot pay a voided bill', 400);
    if (paymentMethod === 'Check' && !checkDate) throw createError('Check date is required for a Check payment.', 400);
    const isCheque = paymentMethod === 'Check';

    const paymentNo = await genPayNo();
    const newPaid = Number(bill.paidAmount) + Number(amount);
    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAP.create({
        data: {
          paymentNo, billId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes,
          checkDate: isCheque ? new Date(checkDate) : null,
          clearingStatus: isCheque ? 'OUTSTANDING' : null,
        },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: isCheque
        ? `AP Payment (Check — Outstanding) — ${vendor?.name} (${bill.billNo})`
        : `AP Payment — ${vendor?.name} (${bill.billNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        isCheque
          ? { accountCode: '2015', credit: Number(amount), description: `Post-dated check issued — ${paymentNo}` }
          : { accountCode: '1020', credit: Number(amount), description: `Cash out — ${paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment recorded', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};

exports.updateBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findFirst({ where: { id, businessId: req.businessId } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'PAID') throw createError('Cannot edit a fully paid bill.', 400);
    if (bill.status === 'VOID') throw createError('Cannot edit a voided bill.', 400);

    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    if (totalAmount < Number(bill.paidAmount) - 0.01) {
      throw createError(
        `New total (₱${totalAmount.toFixed(2)}) is less than the amount already paid (₱${Number(bill.paidAmount).toFixed(2)}). Adjust line items so the total covers what's been paid.`,
        400
      );
    }

    const remaining = totalAmount - Number(bill.paidAmount);
    const status = remaining <= 0.01 ? 'PAID' : (Number(bill.paidAmount) > 0 ? 'PARTIAL' : bill.status);

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        vendorId: Number(vendorId),
        billDate: new Date(billDate),
        dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount, status,
        lines: {
          deleteMany: {},
          create: processedLines.map((l) => ({
            accountId: Number(l.accountId), description: l.description,
            quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
          })),
        },
      },
      include: { vendor: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } }, payments: true },
    });

    // ── GL correction: void every prior posted entry, post a fresh one ───────
    await voidPostedEntriesByReference(bill.businessId, bill.billNo, req, 'BILL EDIT');
    const glResult = await glPost.safePost({
      entryDate:   updated.billDate,
      description: `AP Bill (Edited) — ${updated.vendor.name} (${updated.billNo})`,
      reference:   updated.billNo,
      lines:       buildBillGLLines(updated),
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });
    // safePost never throws — a null result means it already caught and
    // audited a real failure, but a `.skipped` result (e.g. pre-cutover)
    // posts nothing AND audits nothing on its own. Either way the prior
    // entry is already voided, so staying silent here would drop the
    // bill's GL impact from the ledger with no way to find it again.
    if (!glResult || glResult.skipped) {
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   updated.billNo,
          summary:    `Bill ${updated.billNo} was edited but its corrected GL entry did not post (${glResult?.skipped ? `skipped: ${glResult.skipped}` : 'failed'}) — its expense/AP impact may be missing from the ledger.`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId: req.businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }

    res.json(updated);
  } catch (err) { next(err); }
};

exports.editPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    const bill = await prisma.bill.findFirst({
      where: { id, businessId: req.businessId },
      include: { payments: true },
    });
    if (!bill) throw createError('Bill not found', 404);

    const payment = bill.payments.find((p) => p.id === paymentId);
    if (!payment) throw createError('Payment not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot edit a payment on a voided bill.', 400);
    if (payment.clearingStatus && payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This payment has already been ${payment.clearingStatus.toLowerCase()} and can no longer be edited here.`, 400);
    }

    const { paymentDate, amount, paymentMethod, reference, notes, checkDate } = req.body;
    if (paymentMethod === 'Check' && !checkDate) throw createError('Check date is required for a Check payment.', 400);
    const isCheque = paymentMethod === 'Check';
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const newPaid = otherPaid + Number(amount);

    if (newPaid > Number(bill.totalAmount) + 0.01) {
      throw createError(
        `Amount exceeds bill total. Balance available for this payment: ₱${(Number(bill.totalAmount) - otherPaid).toFixed(2)}.`,
        400
      );
    }

    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : (newPaid > 0.01 ? 'PARTIAL' : 'OPEN');

    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: {
          paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes,
          checkDate: isCheque ? new Date(checkDate) : null,
          clearingStatus: isCheque ? 'OUTSTANDING' : null,
        },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    await recordAudit({
      req,
      action:   'UPDATE',
      entity:   'PaymentAP',
      entityId: payment.paymentNo,
      summary:  `Edited payment ${payment.paymentNo} on bill ${bill.billNo}`,
      changes: {
        before: { amount: Number(payment.amount), paymentDate: payment.paymentDate, paymentMethod: payment.paymentMethod, reference: payment.reference, notes: payment.notes },
        after:  { amount: Number(amount), paymentDate, paymentMethod, reference, notes },
      },
    });

    // ── GL correction: void the payment's own prior entry, post a fresh one ──
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId }, select: { name: true } });
    await voidPostedEntriesByReference(bill.businessId, payment.paymentNo, req, 'PAYMENT EDIT');
    const glResult = await glPost.safePost({
      entryDate:   paymentDate,
      description: isCheque
        ? `AP Payment (Edited, Check — Outstanding) — ${vendor?.name} (${bill.billNo})`
        : `AP Payment (Edited) — ${vendor?.name} (${bill.billNo})`,
      reference:   payment.paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        isCheque
          ? { accountCode: '2015', credit: Number(amount), description: `Post-dated check issued — ${payment.paymentNo}` }
          : { accountCode: '1020', credit: Number(amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!glResult || glResult.skipped) {
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   payment.paymentNo,
          summary:    `Payment ${payment.paymentNo} was edited but its corrected GL entry did not post (${glResult?.skipped ? `skipped: ${glResult.skipped}` : 'failed'}) — its AP/cash impact may be missing from the ledger.`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId: req.businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }

    res.json({ message: 'Payment updated', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};

// Shared by voidBill/updateBill: void every POSTED journal entry sharing a
// reference — a bill can carry more than one after being edited before (or
// from the retired add-items flow, on older data), so this can't stop at
// the first match. Continues past any single entry's failure.
async function voidPostedEntriesByReference(businessId, reference, req, contextLabel) {
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, reference, status: 'POSTED' },
  });
  for (const entry of entries) {
    try {
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
    } catch (err) {
      logger.error(`[${contextLabel} — GL VOID FAILED] reference=${reference} biz=${businessId} entryId=${entry.id} — ${err.message}`);
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   String(entry.id),
          summary:    `Failed to void GL entry for ${contextLabel.toLowerCase()} ${reference} — ${err.message}`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }
  }
}

exports.voidBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.paidAmount > 0) throw createError('Cannot void a bill with payments. Reverse payments first.', 400);
    const updated = await prisma.bill.update({ where: { id }, data: { status: 'VOID' } });

    await voidPostedEntriesByReference(bill.businessId, bill.billNo, req, 'BILL VOID');

    res.json(updated);
  } catch (err) { next(err); }
};

exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const bills = await prisma.bill.findMany({
      where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
    });

    // Fetch vendor names separately (not via `include`) so a bill whose vendor
    // was deleted out from under it (orphaned FK) can't crash the whole report —
    // Prisma throws on `include` when a required relation resolves to null.
    const vendorIds = [...new Set(bills.map((b) => b.vendorId))];
    const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } });
    const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, differenceInCalendarDays(today, due));
      const outstanding = Number(b.totalAmount) - Number(b.paidAmount);
      return {
        billNo: b.billNo, vendor: vendorNames[b.vendorId] || 'Unknown vendor', vendorId: b.vendorId,
        dueDate: b.dueDate, outstanding, daysOverdue, notes: b.notes,
        bucket: daysOverdue === 0 ? classifyUpcomingBucket(due, today)
          : daysOverdue <= 30  ? '1-30 days'
          : daysOverdue <= 60  ? '31-60 days'
          : daysOverdue <= 90  ? '61-90 days'
          : 'Over 90 days',
      };
    });

    const buckets = AGING_BUCKETS;
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};

// Bucketed on checkDate (the cheque's own maturity date), not paymentDate —
// only meaningful for an OUTSTANDING cheque; a settled one has no "days
// until due" story left to tell.
function chequeAgingBucket(checkDate) {
  const days = Math.floor((new Date(checkDate) - new Date()) / 86400000);
  if (days < 0)   return 'Past Due';
  if (days <= 7)  return '0-7 days';
  if (days <= 14) return '8-14 days';
  if (days <= 30) return '15-30 days';
  return '30+ days';
}

exports.listCheques = async (req, res, next) => {
  try {
    const { status } = req.query;
    const payments = await prisma.paymentAP.findMany({
      where: {
        paymentMethod: 'Check',
        bill: { businessId: req.businessId },
        ...(status ? { clearingStatus: status } : {}),
      },
      include: { bill: { select: { billNo: true, vendorId: true } } },
      orderBy: { checkDate: 'asc' },
    });

    // Fetch vendors separately (not via `include`) so a bill whose vendor was
    // deleted out from under it (orphaned FK) can't crash this list — Prisma
    // throws on `include` when a required relation resolves to null. Same
    // protection as listBills/getBill.
    const vendorIds = [...new Set(payments.map((p) => p.bill.vendorId))];
    const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } });
    const vendorNameById = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

    const result = payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      billId: p.billId,
      billNo: p.bill.billNo,
      vendorName: vendorNameById[p.bill.vendorId],
      amount: p.amount,
      checkNo: p.reference,
      checkDate: p.checkDate,
      paymentDate: p.paymentDate,
      clearingStatus: p.clearingStatus,
      notes: p.notes,
      bucket: p.clearingStatus === 'OUTSTANDING' ? chequeAgingBucket(p.checkDate) : null,
    }));

    res.json(result);
  } catch (err) { next(err); }
};

async function revertOutstandingCheque(req, res, next, targetStatus, contextLabel) {
  try {
    const paymentId = Number(req.params.paymentId);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A reason is required.', 400);

    const payment = await prisma.paymentAP.findFirst({
      where: { id: paymentId, bill: { businessId: req.businessId } },
      include: { bill: true },
    });
    if (!payment) throw createError('Cheque not found', 404);
    if (payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This cheque is already ${payment.clearingStatus?.toLowerCase()}.`, 400);
    }

    const bill = payment.bill;
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const remaining = Number(bill.totalAmount) - otherPaid;
    const status = remaining <= 0.01 ? 'PAID' : (otherPaid > 0.01 ? 'PARTIAL' : 'OPEN');

    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: {
          clearingStatus: targetStatus,
          notes: `${payment.notes ? payment.notes + ' ' : ''}[${targetStatus}: ${reason.trim()}]`,
        },
      }),
      prisma.bill.update({ where: { id: bill.id }, data: { paidAmount: otherPaid, status } }),
    ]);

    await recordAudit({
      req,
      action:   'UPDATE',
      entity:   'PaymentAP',
      entityId: payment.paymentNo,
      summary:  `Cheque ${payment.paymentNo} on bill ${bill.billNo} marked ${targetStatus}: ${reason.trim()}`,
    });

    await voidPostedEntriesByReference(bill.businessId, payment.paymentNo, req, contextLabel);

    res.json({ message: `Cheque marked ${targetStatus.toLowerCase()}` });
  } catch (err) { next(err); }
}

exports.bounceCheque = (req, res, next) => revertOutstandingCheque(req, res, next, 'BOUNCED', 'CHEQUE BOUNCED');
exports.cancelCheque = (req, res, next) => revertOutstandingCheque(req, res, next, 'CANCELLED', 'CHEQUE CANCELLED');

exports.clearCheque = async (req, res, next) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const { clearDate } = req.body;
    if (!clearDate) throw createError('Clear date is required.', 400);

    const payment = await prisma.paymentAP.findFirst({
      where: { id: paymentId, bill: { businessId: req.businessId } },
      include: { bill: { include: { vendor: { select: { name: true } } } } },
    });
    if (!payment) throw createError('Cheque not found', 404);
    if (payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This cheque is already ${payment.clearingStatus?.toLowerCase()}.`, 400);
    }

    await prisma.paymentAP.update({ where: { id: paymentId }, data: { clearingStatus: 'CLEARED' } });

    await recordAudit({
      req,
      action:   'UPDATE',
      entity:   'PaymentAP',
      entityId: payment.paymentNo,
      summary:  `Cheque ${payment.paymentNo} on bill ${payment.bill.billNo} marked cleared`,
    });

    const glResult = await glPost.safePost({
      entryDate:   clearDate,
      description: `Cheque Cleared — ${payment.bill.vendor?.name} (${payment.bill.billNo})`,
      reference:   `${payment.paymentNo}-CLR`,
      lines: [
        { accountCode: '2015', debit:  Number(payment.amount), description: `Cheque cleared — ${payment.paymentNo}` },
        { accountCode: '1020', credit: Number(payment.amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!glResult || glResult.skipped) {
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   `${payment.paymentNo}-CLR`,
          summary:    `Cheque ${payment.paymentNo} was cleared but its GL entry did not post (${glResult?.skipped ? `skipped: ${glResult.skipped}` : 'failed'}) — its cash impact may be missing from the ledger.`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId: req.businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }

    res.json({ message: 'Cheque marked cleared' });
  } catch (err) { next(err); }
};
