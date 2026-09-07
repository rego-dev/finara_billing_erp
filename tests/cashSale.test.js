const { buildCashSaleEntry, cashAccountForMethod, PAYMENT_ACCOUNT_MAP } = require('../server/utils/cashSale');
const { isBalanced } = require('../server/utils/finance');

const sum = (lines, side) => lines.reduce((s, l) => s + Number(l[side] || 0), 0);

describe('cashAccountForMethod', () => {
  test('maps known payment methods to their COA code', () => {
    expect(cashAccountForMethod('Cash')).toBe('1010');
    expect(cashAccountForMethod('Bank Transfer')).toBe('1020');
    expect(cashAccountForMethod('Check')).toBe('1020');
    expect(cashAccountForMethod('GCash')).toBe('1024');
    expect(cashAccountForMethod('Maya')).toBe('1024');
  });

  test('unrecognized method falls back to 1010 Cash on Hand', () => {
    expect(cashAccountForMethod('Bitcoin')).toBe('1010');
    expect(cashAccountForMethod(undefined)).toBe('1010');
  });
});

describe('buildCashSaleEntry', () => {
  test('VAT-coded sale: DR cash, CR revenue (subtotal), CR Output VAT, balanced', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000001', accountId: 42,
      subtotal: 500, vatAmount: 60, totalAmount: 560,
      paymentMethod: 'Cash',
    });

    expect(sum(lines, 'debit')).toBeCloseTo(560, 2);
    expect(sum(lines, 'credit')).toBeCloseTo(560, 2);
    expect(isBalanced(lines)).toBe(true);

    const cashLine = lines.find((l) => l.accountCode === '1010');
    expect(cashLine.debit).toBeCloseTo(560, 2);

    const revenueLine = lines.find((l) => l.accountId === 42);
    expect(revenueLine.credit).toBeCloseTo(500, 2);

    const vatLine = lines.find((l) => l.accountCode === '2030');
    expect(vatLine.credit).toBeCloseTo(60, 2);
  });

  test('ZERO/EXEMPT-coded sale (vatAmount 0): no Output VAT line, still balanced', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000002', accountId: 42,
      subtotal: 300, vatAmount: 0, totalAmount: 300,
      paymentMethod: 'GCash',
    });

    expect(lines.find((l) => l.accountCode === '2030')).toBeUndefined();
    expect(sum(lines, 'debit')).toBeCloseTo(300, 2);
    expect(sum(lines, 'credit')).toBeCloseTo(300, 2);
    expect(isBalanced(lines)).toBe(true);

    const cashLine = lines.find((l) => l.accountCode === '1024');
    expect(cashLine.debit).toBeCloseTo(300, 2);
  });

  test('unknown payment method still produces a balanced entry via the 1010 fallback', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000003', accountId: 7,
      subtotal: 100, vatAmount: 12, totalAmount: 112,
      paymentMethod: 'Bitcoin',
    });

    expect(lines.find((l) => l.accountCode === '1010').debit).toBeCloseTo(112, 2);
    expect(isBalanced(lines)).toBe(true);
  });
});
