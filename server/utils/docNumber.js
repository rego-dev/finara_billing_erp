/**
 * Sequential document numbering (PO-000001, BILL-000042, EV-000007, ...).
 *
 * Derive the next number from the LAST issued number — never from a row count.
 * A count is wrong the moment a row is deleted: with 5 POs created and one
 * deleted, count()+1 yields PO-000005, which already exists, and the unique
 * constraint rejects every subsequent create (P2002 -> 409) forever.
 *
 * @param {string}      prefix  e.g. 'PO-'
 * @param {string|null} lastNo  the most recently issued number, or null/undefined if none
 * @param {number}      [pad=6] zero-padding width
 * @returns {string}
 */
function nextDocNumber(prefix, lastNo, pad = 6) {
  const match = lastNo ? String(lastNo).match(/(\d+)$/) : null;
  const n = match ? parseInt(match[1], 10) : 0;
  return `${prefix}${String(n + 1).padStart(pad, '0')}`;
}

module.exports = { nextDocNumber };
