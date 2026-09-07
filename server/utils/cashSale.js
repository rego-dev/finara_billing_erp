/**
 * cashSale.js — pure GL-entry construction for non-invoiced cash sales.
 * No prisma import: every input is a plain value, every output is a plain
 * array of { accountCode|accountId, debit, credit, description } lines in
 * the shape glPost.post() accepts. Kept separate from the controller so the
 * arithmetic is provable without a database, same as cashAdvance.js.
 */

// Same mapping receivableController.recordPayment uses for AR collections —
// duplicated rather than imported so this module stays prisma-free and
// independently testable; if the two ever need to diverge (e.g. a payment
// method only valid for one flow) that's a deliberate choice, not drift.
const PAYMENT_ACCOUNT_MAP = {
  'Cash':          '1010', // Cash on Hand
  'Bank Transfer': '1020', // Cash in Bank — BDO Checking
  'Check':         '1020',
  'GCash':         '1024', // Cash in Bank — UnionBank (GCash)
  'Maya':          '1024',
  'Credit Card':   '1020',
  'Online':        '1020',
};

function cashAccountForMethod(paymentMethod) {
  return PAYMENT_ACCOUNT_MAP[paymentMethod] || '1010';
}

/**
 * @param {Object} opts
 * @param {string} opts.saleNo
 * @param {number} opts.accountId       revenue account id
 * @param {number} opts.subtotal        VAT-exclusive amount
 * @param {number} opts.vatAmount       0 for ZERO/EXEMPT
 * @param {number} opts.totalAmount     subtotal + vatAmount
 * @param {string} opts.paymentMethod
 * @returns {{ lines: Array }}
 */
function buildCashSaleEntry({ saleNo, accountId, subtotal, vatAmount, totalAmount, paymentMethod }) {
  const cashAccountCode = cashAccountForMethod(paymentMethod);

  const lines = [
    {
      accountCode: cashAccountCode,
      debit:       Number(totalAmount),
      description: `Cash sale — ${saleNo} (${paymentMethod})`,
    },
    {
      accountId:   accountId,
      credit:      Number(subtotal),
      description: `Cash sale — ${saleNo}`,
    },
  ];

  if (Number(vatAmount) > 0) {
    lines.push({
      accountCode: '2030',
      credit:      Number(vatAmount),
      description: 'Output VAT',
    });
  }

  return { lines };
}

module.exports = { PAYMENT_ACCOUNT_MAP, cashAccountForMethod, buildCashSaleEntry };
