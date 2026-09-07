const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ─── GL Diagnostic: all POSTED lines for a given account code ─
exports.glDiag = async (req, res, next) => {
  try {
    const code = req.query.code || '1011';
    const acct = await prisma.account.findFirst({
      where: { accountCode: code, businessId: req.businessId },
    });
    if (!acct) return res.json({ error: `Account ${code} not found`, lines: [], totalDr: 0, totalCr: 0, balance: 0 });

    const lines = await prisma.journalLine.findMany({
      where: { accountId: acct.id, entry: { status: 'POSTED', businessId: req.businessId } },
      include: {
        entry: { select: { id: true, entryNo: true, entryDate: true, description: true, reference: true, status: true } },
      },
      orderBy: { id: 'asc' },
    });

    let totalDr = 0, totalCr = 0;
    const rows = lines.map((l) => {
      totalDr += Number(l.debit || 0);
      totalCr += Number(l.credit || 0);
      return {
        lineId:      l.id,
        entryId:     l.entry.id,
        entryNo:     l.entry.entryNo,
        entryDate:   l.entry.entryDate,
        description: l.entry.description,
        reference:   l.entry.reference,
        debit:       Number(l.debit || 0),
        credit:      Number(l.credit || 0),
      };
    });

    res.json({
      account:  { code, name: acct.accountName, id: acct.id },
      lines:    rows,
      totalDr,
      totalCr,
      balance:  totalDr - totalCr,
    });
  } catch (err) { next(err); }
};

// ─── List journal entries (all statuses) ─────────────────────
exports.listEntries = async (req, res, next) => {
  try {
    const { search, status, limit = 50, offset = 0 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { entryNo:     { contains: search } },
        { description: { contains: search } },
        { reference:   { contains: search } },
      ];
    }
    const [rows, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take:    Number(limit),
        skip:    Number(offset),
        include: {
          lines: {
            include: { account: { select: { accountCode: true, accountName: true } } },
          },
        },
      }),
      prisma.journalEntry.count({ where }),
    ]);
    res.json({ total, data: rows });
  } catch (err) { next(err); }
};

// ─── Unpost a journal entry (POSTED → DRAFT) ─────────────────
exports.unpostEntry = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entry = await prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw createError('Entry not found', 404);
    if (entry.status !== 'POSTED') throw createError('Entry is not posted', 400);
    const updated = await prisma.journalEntry.update({
      where: { id },
      data:  { status: 'DRAFT' },
      include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });
    res.json({ message: 'Entry unposted — now editable as DRAFT', entry: updated });
  } catch (err) { next(err); }
};

// ─── Force delete a journal entry ────────────────────────────
exports.forceDeleteEntry = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const entry = await prisma.journalEntry.findUnique({ where: { id } });
    if (!entry) throw createError('Entry not found', 404);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      await tx.journalEntry.delete({ where: { id } });
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }, { timeout: 30000 });
    res.json({ message: `Journal entry ${entry.entryNo} permanently deleted` });
  } catch (err) { next(err); }
};

// ─── List bills ───────────────────────────────────────────────
exports.listBills = async (req, res, next) => {
  try {
    const { search, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (search) {
      where.OR = [
        { billNo:          { contains: search } },
        { vendor:          { name: { contains: search } } },
        { referenceNumber: { contains: search } },
      ];
    }
    const rows = await prisma.bill.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      include: {
        vendor: { select: { name: true, vendorCode: true } },
        lines:  true,
        payments: { select: { id: true, amount: true, paymentNo: true } },
      },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
};

// ─── Unpost a bill (PAID/PARTIAL → UNPAID, removes payments) ─
exports.unpostBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'UNPAID') throw createError('Bill is already UNPAID', 400);

    await prisma.$transaction(async (tx) => {
      // Remove all AP payments on this bill
      if (bill.payments.length > 0) {
        await tx.paymentAP.deleteMany({ where: { billId: id } });
      }
      // Reset bill to UNPAID
      await tx.bill.update({
        where: { id },
        data:  { status: 'UNPAID', amountPaid: 0 },
      });
    });

    res.json({ message: `Bill ${bill.billNo} reverted to UNPAID — payments removed. Delete the related GL entry separately if already posted.` });
  } catch (err) { next(err); }
};

// ─── Force delete a bill (and its lines + payments) ──────────
exports.forceDeleteBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
      await tx.paymentAP.deleteMany({ where: { billId: id } });
      await tx.billLine.deleteMany({ where: { billId: id } });
      await tx.bill.delete({ where: { id } });
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }, { timeout: 30000 });
    res.json({ message: `Bill ${bill.billNo} and all related records permanently deleted` });
  } catch (err) { next(err); }
};

// ─── List invoices ────────────────────────────────────────────
exports.listInvoices = async (req, res, next) => {
  try {
    const { search, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (search) {
      where.OR = [
        { invoiceNo:       { contains: search } },
        { customer:        { name: { contains: search } } },
        { referenceNumber: { contains: search } },
      ];
    }
    const rows = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      include: {
        customer: { select: { name: true, customerCode: true } },
        lines:    true,
        payments: { select: { id: true, amount: true, paymentNo: true } },
      },
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
};

// ─── Force delete an invoice ──────────────────────────────────
exports.forceDeleteInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw createError('Invoice not found', 404);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');
      await tx.paymentAR.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    }, { timeout: 30000 });
    res.json({ message: `Invoice ${inv.invoiceNo} and all related records permanently deleted` });
  } catch (err) { next(err); }
};
