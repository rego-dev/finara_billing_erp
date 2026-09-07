const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const glPost = require('../utils/glPost');

const OPENING_EQUITY = '3070';
const OPENING_REFERENCE = 'OPENING-BALANCE';

// The accounts the subledgers actually post to. 2000 is the "Current
// Liabilities" header, NOT payables — payableController credits 2010.
const AR_ACCOUNT = '1100'; // Accounts Receivable — Trade
const AP_ACCOUNT = '2010'; // Accounts Payable — Trade

exports.get = async (req, res, next) => {
  try {
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    const entry = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: OPENING_REFERENCE },
      include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });
    res.json({ booksStartDate: biz?.booksStartDate || null, entry });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { lines } = req.body;

    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    if (!biz?.booksStartDate) {
      throw createError("Set this business's books start date before entering opening balances", 400);
    }

    const existing = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: OPENING_REFERENCE },
      select: { id: true, entryNo: true },
    });
    if (existing) {
      throw createError(`Opening balances already posted as ${existing.entryNo}. Reverse that entry before posting again.`, 400);
    }

    const rows = (lines || [])
      .filter((l) => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        accountCode: String(l.accountCode),
        debit:  Number(l.debit  || 0),
        credit: Number(l.credit || 0),
        description: 'Opening balance',
      }));
    if (!rows.length) throw createError('Enter at least one opening balance line', 400);

    // Balance the entry against Opening Balance Equity so the user only has to
    // enter the real-world figures they can actually verify.
    const totalDebit  = rows.reduce((s, l) => s + l.debit,  0);
    const totalCredit = rows.reduce((s, l) => s + l.credit, 0);
    const diff = Number((totalDebit - totalCredit).toFixed(2));
    if (diff > 0)      rows.push({ accountCode: OPENING_EQUITY, credit: diff,  description: 'Opening balance equity' });
    else if (diff < 0) rows.push({ accountCode: OPENING_EQUITY, debit: -diff, description: 'Opening balance equity' });

    // isOpeningEntry bypasses the cutover guard — this entry is dated ON the
    // cutover date and would otherwise skip itself, leaving an empty balance sheet.
    const entry = await glPost.post({
      entryDate:   biz.booksStartDate,
      description: 'Opening balances',
      reference:   OPENING_REFERENCE,
      lines:       rows,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
      isOpeningEntry: true,
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'JournalEntry', entityId: entry.id,
      summary: `Posted opening balances ${entry.entryNo}`,
    });

    res.status(201).json(entry);
  } catch (err) { next(err); }
};

// The migration is only trustworthy if the documents agree with the opening
// figures. Sum what is still unpaid on pre-cutover documents and compare.
exports.reconcile = async (req, res, next) => {
  try {
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    if (!biz?.booksStartDate) throw createError('No books start date is set for this business', 400);

    const cutoff = biz.booksStartDate;

    const [invoices, bills, entry] = await Promise.all([
      prisma.invoice.findMany({
        where: { businessId: req.businessId, invoiceDate: { lt: cutoff }, status: { not: 'VOID' } },
        select: { totalAmount: true, paidAmount: true },
      }),
      prisma.bill.findMany({
        where: { businessId: req.businessId, billDate: { lt: cutoff }, status: { not: 'VOID' } },
        select: { totalAmount: true, paidAmount: true },
      }),
      prisma.journalEntry.findFirst({
        where: { businessId: req.businessId, reference: OPENING_REFERENCE },
        include: { lines: { include: { account: { select: { accountCode: true } } } } },
      }),
    ]);

    const openOf = (rows) =>
      Number(rows.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount || 0)), 0).toFixed(2));

    const openingFor = (code, side) => {
      if (!entry) return 0;
      return Number(entry.lines
        .filter((l) => l.account.accountCode === code)
        .reduce((s, l) => s + Number(l[side]), 0)
        .toFixed(2));
    };

    const build = (subledger, opening) => {
      const difference = Number((subledger - opening).toFixed(2));
      return { subledger, opening, difference, ok: Math.abs(difference) < 0.01 };
    };

    res.json({
      booksStartDate: cutoff,
      posted: !!entry,
      ar: build(openOf(invoices), openingFor(AR_ACCOUNT, 'debit')),
      ap: build(openOf(bills),    openingFor(AP_ACCOUNT, 'credit')),
    });
  } catch (err) { next(err); }
};
