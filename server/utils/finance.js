/**
 * finance.js — Pure, side-effect-free financial helpers.
 * Kept separate from controllers so the maths can be unit-tested in isolation.
 */

/**
 * Monthly depreciation for an asset given its current book value.
 * @param {{method:string, cost:number|string, salvageValue:number|string, usefulLifeMonths:number, decliningRate?:number|string}} asset
 * @param {number} currentBookValue
 * @returns {number} depreciation for one month (never drops book value below salvage)
 */
function monthlyDepreciation(asset, currentBookValue) {
  const cost = Number(asset.cost);
  const salvage = Number(asset.salvageValue || 0);
  let monthly;
  if (asset.method === 'DECLINING_BALANCE') {
    const annualRate = Number(asset.decliningRate || 0) / 100;
    monthly = (currentBookValue * annualRate) / 12;
  } else {
    // STRAIGHT_LINE
    monthly = (cost - salvage) / Number(asset.usefulLifeMonths);
  }
  return Math.max(0, Math.min(monthly, currentBookValue - salvage));
}

/** Advance a date by one period of the given frequency. Returns a new Date. */
function advanceDate(date, frequency) {
  const d = new Date(date);
  switch (frequency) {
    case 'WEEKLY': d.setDate(d.getDate() + 7); break;
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3); break;
    case 'ANNUALLY': d.setFullYear(d.getFullYear() + 1); break;
    case 'MONTHLY':
    default: d.setMonth(d.getMonth() + 1); break;
  }
  return d;
}

/** Last calendar day of the month containing `d`. */
function endOfMonth(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth() + 1, 0);
}

/** Add `n` months to `d`. */
function addMonths(d, n) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth() + n, x.getDate());
}

/** Validate that a set of journal lines balances (debits == credits). */
function isBalanced(lines, tolerance = 0.01) {
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  return Math.abs(dr - cr) <= tolerance;
}

module.exports = { monthlyDepreciation, advanceDate, endOfMonth, addMonths, isBalanced };
