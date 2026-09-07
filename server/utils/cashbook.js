// Pure running-balance engine for the Cash Position report.
// No database, no Express — the report's correctness lives here.

// Money arrives as JS numbers converted from Prisma Decimals. Rounding every
// accumulation keeps 0.1 + 0.2 from becoming 0.30000000000000004 in a ledger.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Cash accounts are the leaf ASSET accounts whose code starts here.
const CASH_CODE_PREFIX = '10';

/**
 * Walk a set of daily movements, carrying the running balance.
 *
 * Rows are emitted only for days that actually moved — a quiet month must not
 * produce thirty identical rows, and the running balance already states the
 * figure for any date in between.
 *
 * @param {number} opening  balance before the first day of the range
 * @param {Array<{date: string, in: number, out: number}>} movements
 * @returns {{rows: Array<{date: string, begin: number, in: number, out: number, ending: number}>,
 *            opening: number, closing: number, totalIn: number, totalOut: number}}
 */
function buildCashbook(opening, movements = []) {
  const start = round2(Number(opening) || 0);
  const sorted = [...movements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = start;
  let totalIn = 0;
  let totalOut = 0;

  const rows = sorted.map((m) => {
    const moneyIn  = round2(Number(m.in)  || 0);
    const moneyOut = round2(Number(m.out) || 0);
    const begin    = running;
    running  = round2(begin + moneyIn - moneyOut);
    totalIn  = round2(totalIn  + moneyIn);
    totalOut = round2(totalOut + moneyOut);
    return { date: m.date, begin, in: moneyIn, out: moneyOut, ending: running };
  });

  return { rows, opening: start, closing: running, totalIn, totalOut };
}

module.exports = { buildCashbook, round2, CASH_CODE_PREFIX };
