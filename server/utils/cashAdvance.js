/**
 * Cash advance accounting rules.
 *
 * Release makes the holder accountable:  DR 1104 / CR cash.
 * Liquidation clears that accountability against actual receipts, settling any
 * difference in cash. Pure functions — no database, no Prisma.
 *
 * Line shape returned matches what glPost.post() accepts:
 *   { accountId?, accountCode?, debit?, credit?, description }
 */

const ADVANCES_ACCOUNT = '1104'; // Advances to Officers & Employees

function buildReleaseEntry({ requestNo, amount, cashAccountCode }) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Released amount must be greater than zero');
  if (!cashAccountCode) throw new Error('A cash account is required to release cash');

  return {
    lines: [
      { accountCode: ADVANCES_ACCOUNT, debit: amt,  description: `Cash advance — ${requestNo}` },
      { accountCode: cashAccountCode,  credit: amt, description: `Cash released — ${requestNo}` },
    ],
  };
}

function buildLiquidationEntry({
  requestNo, releasedAmount, lines, cashAccountCode, fallbackAccountCode = '6390',
}) {
  const released = Number(releasedAmount);
  if (!(released > 0)) throw new Error('Released amount must be greater than zero');
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Liquidation needs at least one line');
  }

  const spentLines = lines.map((l) => {
    const amt = Number(l.amount);
    if (!(amt > 0)) throw new Error('Every liquidation line must be greater than zero');
    return l.accountId
      ? { accountId: Number(l.accountId), debit: amt, description: l.description }
      : { accountCode: fallbackAccountCode, debit: amt, description: l.description };
  });

  const actualSpent = spentLines.reduce((s, l) => s + l.debit, 0);
  const variance = Number((actualSpent - released).toFixed(2));

  const out = [...spentLines];

  if (variance < 0) {
    // spent less — sukli returned to the company
    if (!cashAccountCode) throw new Error('A cash account is required to record returned cash');
    out.push({ accountCode: cashAccountCode, debit: -variance, description: `Cash returned — ${requestNo}` });
  }

  out.push({ accountCode: ADVANCES_ACCOUNT, credit: released, description: `Clear advance — ${requestNo}` });

  if (variance > 0) {
    // spent more — company reimburses the holder
    if (!cashAccountCode) throw new Error('A cash account is required to record the reimbursement');
    out.push({ accountCode: cashAccountCode, credit: variance, description: `Reimbursement — ${requestNo}` });
  }

  const mode = variance < 0 ? 'RETURN' : variance > 0 ? 'REIMBURSE' : 'EXACT';
  return { lines: out, variance, mode };
}

module.exports = { buildReleaseEntry, buildLiquidationEntry, ADVANCES_ACCOUNT };
