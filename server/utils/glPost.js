/**
 * glPost.js — Automatic GL Journal Entry Posting Utility
 *
 * Usage:
 *   const glPost = require('./glPost');
 *   await glPost.safePost({ entryDate, description, reference, lines, userId, businessId });
 *
 * Each line: { accountCode?, accountId?, debit?, credit?, description? }
 * Supply EITHER accountCode (looks up by COA code within the business) OR accountId directly.
 */

const prisma = require('../config/database');
const logger = require('./logger');
const { recordAudit } = require('./audit');

// ── In-memory account cache — key: `${businessId}:${accountCode}` ─────────────
const _cache = {};

// ── Business cutover cache — key: businessId ─────────────────────────────────
const _bizCache = {};

/**
 * Normalise any accepted date form to a 'YYYY-MM-DD' key.
 *
 * booksStartDate is @db.Date and comes back as a Date at UTC midnight, while
 * entryDate arrives as either 'YYYY-MM-DD' or a Date. Comparing normalised
 * strings sidesteps every timezone trap that comparing Date objects invites.
 */
function dateKey(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

async function getBusinessCutover(businessId) {
  if (Object.prototype.hasOwnProperty.call(_bizCache, businessId)) return _bizCache[businessId];
  const biz = await prisma.business.findUnique({
    where:  { id: Number(businessId) },
    select: { booksStartDate: true },
  });
  _bizCache[businessId] = biz?.booksStartDate || null;
  return _bizCache[businessId];
}

// Call whenever a business's booksStartDate changes, or posting keeps
// honouring the stale date until the process restarts.
function clearBusinessCache(businessId) {
  if (businessId == null) {
    for (const k of Object.keys(_bizCache)) delete _bizCache[k];
  } else {
    delete _bizCache[businessId];
    delete _bizCache[Number(businessId)];
  }
}

async function getAccountByCode(code, businessId = 1) {
  const key = `${businessId}:${code}`;
  if (_cache[key]) return _cache[key];
  const acc = await prisma.account.findFirst({ where: { accountCode: code, businessId } });
  if (!acc) throw new Error(`GL: No account "${code}" in COA for businessId ${businessId}`);
  _cache[key] = acc;
  return acc;
}

// ── Sequential entry number ────────────────────────────────────────────────────
async function nextEntryNo(businessId = 1) {
  // Look at ALL entries (any business) to avoid collisions — entryNo is globally unique
  const last = await prisma.journalEntry.findFirst({
    orderBy: { id: 'desc' },
    select:  { entryNo: true },
  });
  if (!last) return `JE-${businessId}-000001`;
  const match = last.entryNo.match(/(\d+)$/);
  const n = match ? parseInt(match[1], 10) : 0;
  return `JE-${businessId}-${String(n + 1).padStart(6, '0')}`;
}

// ── Main post function ─────────────────────────────────────────────────────────
/**
 * @param {Object} opts
 * @param {Date|string} opts.entryDate
 * @param {string}      opts.description
 * @param {string}      [opts.reference]
 * @param {string}      [opts.notes]
 * @param {number}      [opts.userId=1]
 * @param {number}      [opts.businessId=1]
 * @param {Array}       opts.lines  — [{accountCode|accountId, debit, credit, description}]
 */
async function post({ entryDate, description, reference, notes, lines, userId = 1, businessId = 1, isOpeningEntry = false }) {
  // Anything dated before the books start is already inside the opening
  // balances — posting it again double-counts revenue, VAT and cash.
  // The opening entry itself is dated on/before the cutover, so it must
  // be able to bypass this or it would skip itself.
  if (!isOpeningEntry) {
    const cutover = await getBusinessCutover(businessId);
    const cutoverKey = dateKey(cutover);
    const entryKey   = dateKey(entryDate);
    if (cutoverKey && entryKey && entryKey < cutoverKey) {
      logger.info(`[GL SKIP PRE-CUTOVER] biz=${businessId} entry=${entryKey} cutover=${cutoverKey} ref=${reference || '—'}`);
      return { skipped: 'PRE_CUTOVER', entryDate, businessId };
    }
  }

  const resolved = await Promise.all(
    lines.map(async (l, i) => {
      let accountId;
      if (l.accountId) {
        accountId = l.accountId;
      } else if (l.accountCode) {
        const acc = await getAccountByCode(l.accountCode, businessId);
        accountId = acc.id;
      } else {
        throw new Error(`GL line[${i}] must have accountId or accountCode`);
      }
      return {
        accountId,
        debit:       Number(l.debit  || 0),
        credit:      Number(l.credit || 0),
        description: l.description || null,
        lineOrder:   i + 1,
      };
    })
  );

  // Validate balance
  const totalDebit  = resolved.reduce((s, l) => s + l.debit,  0);
  const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(`GL: Entry not balanced — DR ${totalDebit.toFixed(2)}, CR ${totalCredit.toFixed(2)}`);
  }

  const entryNo = await nextEntryNo(businessId);

  return prisma.journalEntry.create({
    data: {
      businessId,
      entryNo,
      entryDate:   entryDate instanceof Date ? entryDate : new Date(entryDate),
      reference:   reference || null,
      description,
      notes:       notes || null,
      status:      'POSTED',
      createdBy:   Number(userId),
      postedAt:    new Date(),
      lines: { create: resolved },
    },
    include: { lines: true },
  });
}

// ── Post without throwing — but make any failure VISIBLE ──────────────────────
// Auto-posting must not break the underlying transaction, so we never throw.
// But a swallowed failure means a transaction exists with no GL entry (a silent
// discrepancy), so we log it AND record a GL_POST_FAILED audit entry — which
// surfaces in the notification bell and the Audit Trail for follow-up.
async function safePost(opts) {
  try {
    return await post(opts);
  } catch (err) {
    logger.error(`[GL AUTO-POST FAILED] ref=${opts.reference} biz=${opts.businessId} — ${err.message}`);
    try {
      await recordAudit({
        action:     'GL_POST_FAILED',
        entity:     'JournalEntry',
        entityId:   opts.reference,
        summary:    `GL auto-post FAILED for ${opts.reference || 'entry'} — ${err.message}`,
        user:       opts.userId ? { id: opts.userId } : undefined,
        businessId: opts.businessId,
      });
    } catch { /* auditing must never break anything either */ }
    return null;
  }
}

module.exports = { post, safePost, getAccountByCode, clearBusinessCache, dateKey };
