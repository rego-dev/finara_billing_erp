const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { buildCashbook, round2, CASH_CODE_PREFIX } = require('../utils/cashbook');
const { startOf, endOf, dateKey, isValidDateStr } = require('../utils/dates');

const MAX_RANGE_DAYS = 366;

// Validate and normalise the ?from & ?to range shared by both endpoints.
function parseRange(query) {
  const { from, to } = query;
  if (!from || !to)                             throw createError('from and to query params are required (YYYY-MM-DD)', 400);
  if (!isValidDateStr(from) || !isValidDateStr(to)) throw createError('from and to must be YYYY-MM-DD', 400);
  if (from > to)                                throw createError('from must not be later than to', 400);

  const days = Math.round((startOf(to) - startOf(from)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw createError(`Range must be ${MAX_RANGE_DAYS} days or fewer`, 400);

  return { from, to };
}

// Cash accounts are the LEAF asset accounts under the 10xx range. The leaf test
// matters: `1000 Current Assets` is an ASSET whose code starts '10' but is the
// parent header of every cash account and holds no postings.
async function resolveCashAccounts(businessId, accountCode) {
  return prisma.account.findMany({
    where: {
      businessId,
      isActive:    true,
      accountType: 'ASSET',
      // The prefix always applies, even when a specific code is requested —
      // otherwise `?accountCode=1104` (Advances to Officers) would resolve, since
      // it is also an active leaf ASSET account.
      accountCode: {
        startsWith: CASH_CODE_PREFIX,
        ...(accountCode ? { equals: accountCode } : {}),
      },
      children:    { none: {} },
    },
    select: { id: true, accountCode: true, accountName: true },
    orderBy: { accountCode: 'asc' },
  });
}

exports.resolveCashAccounts = resolveCashAccounts;

// ─── GET /api/reports/cash-position ───────────────────────────────
exports.report = async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const { accountCode } = req.query;

    if (accountCode && !/^10\d*$/.test(accountCode)) {
      throw createError(`${accountCode} is not a cash account`, 400);
    }

    const accounts = await resolveCashAccounts(req.businessId, accountCode);
    if (accountCode && accounts.length === 0) {
      throw createError(`${accountCode} is not a postable cash account`, 400);
    }

    const built = await Promise.all(accounts.map(async (acct) => {
      // Opening: everything POSTED strictly before the range starts.
      const before = await prisma.journalLine.aggregate({
        where: {
          accountId: acct.id,
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: { lt: startOf(from) } },
        },
        _sum: { debit: true, credit: true },
      });
      const opening = round2(Number(before._sum.debit || 0) - Number(before._sum.credit || 0));

      // Movement: one bucket per day inside the range.
      //
      // Grouped in JS, not with prisma.journalLine.groupBy: `entryDate` lives on
      // JournalEntry, not JournalLine, and Prisma can only group by a model's
      // own scalar fields. The whole GL is 126 lines (42 of them cash), so the
      // in-memory pass is not a performance concern.
      const lines = await prisma.journalLine.findMany({
        where: {
          accountId: acct.id,
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOf(from), lte: endOf(to) } },
        },
        select: { debit: true, credit: true, entry: { select: { entryDate: true } } },
      });

      const byDay = new Map();
      for (const l of lines) {
        const key = dateKey(l.entry.entryDate);
        const acc = byDay.get(key) || { date: key, in: 0, out: 0 };
        acc.in  = round2(acc.in  + Number(l.debit  || 0));
        acc.out = round2(acc.out + Number(l.credit || 0));
        byDay.set(key, acc);
      }
      const movements = [...byDay.values()];

      return {
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        ...buildCashbook(opening, movements),
      };
    }));

    res.json({ from, to, accounts: built });
  } catch (err) { next(err); }
};

// ─── GET /api/reports/cash-position/day ───────────────────────────
exports.day = async (req, res, next) => {
  try {
    const { date, accountCode } = req.query;
    if (!date || !isValidDateStr(date)) throw createError('date query param required (YYYY-MM-DD)', 400);
    if (!accountCode)                   throw createError('accountCode query param required', 400);

    const [account] = await resolveCashAccounts(req.businessId, accountCode);
    if (!account) throw createError(`${accountCode} is not a postable cash account`, 400);

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: account.id,
        entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOf(date), lte: endOf(date) } },
      },
      include: { entry: { select: { entryNo: true, reference: true, description: true } } },
      orderBy: { id: 'asc' },
    });

    res.json({
      date,
      accountCode,
      lines: lines.map((l) => ({
        entryNo:     l.entry.entryNo,
        reference:   l.entry.reference || null,
        description: l.description || l.entry.description,
        in:          Number(l.debit  || 0),
        out:         Number(l.credit || 0),
      })),
    });
  } catch (err) { next(err); }
};
