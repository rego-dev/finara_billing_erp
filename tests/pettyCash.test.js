jest.mock('../server/config/database', () => ({}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const { validateLines }     = require('../server/controllers/journalController');
const { paidFromPettyCash } = require('../server/controllers/dailyRemittanceController');

// Account ids used by the fixtures: 2 = 1010 Cash on Hand, 3 = 1011 Petty Cash Fund
const CASH_ON_HAND = 2;
const PETTY_CASH   = 3;

describe('validateLines', () => {
  test('accepts a normal two-account entry', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH,   debit:  7830 },
      { accountId: CASH_ON_HAND, credit: 7830 },
    ])).not.toThrow();
  });

  // Regression: JE-1-000051 "Petty Cash From Maam Mitch" debited AND credited
  // 1011 for 7,830. It balanced, so it posted — and inflated the fund's credit
  // total, driving the Petty Cash card to -7,920.00.
  test('rejects an entry that debits and credits the same account', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH, debit:  7830 },
      { accountId: PETTY_CASH, credit: 7830 },
    ])).toThrow(/does not move money between accounts/);
  });

  test('rejects an entry that nets to zero across duplicated account lines', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH,   debit:  500 },
      { accountId: CASH_ON_HAND, debit:  300 },
      { accountId: CASH_ON_HAND, credit: 300 },
      { accountId: PETTY_CASH,   credit: 500 },
    ])).toThrow(/does not move money between accounts/);
  });

  test('accepts duplicated account lines that still net to a real movement', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH,   debit:  500 },
      { accountId: PETTY_CASH,   debit:  200 },
      { accountId: CASH_ON_HAND, credit: 700 },
    ])).not.toThrow();
  });

  test('rejects an unbalanced entry', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH,   debit:  100 },
      { accountId: CASH_ON_HAND, credit:  90 },
    ])).toThrow(/not balanced/);
  });

  test('rejects an all-zero entry', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH,   debit: 0 },
      { accountId: CASH_ON_HAND, credit: 0 },
    ])).toThrow(/no amounts/);
  });

  test('rejects a line with no account', () => {
    expect(() => validateLines([
      { accountId: PETTY_CASH, debit: 100 },
      { credit: 100 },
    ])).toThrow(/must have an account/);
  });

  test('rejects a single-line entry', () => {
    expect(() => validateLines([{ accountId: PETTY_CASH, debit: 100 }])).toThrow(/at least 2 lines/);
  });
});

describe('paidFromPettyCash', () => {
  test('a reimbursement settled out of 1011 counts as petty cash', () => {
    expect(paidFromPettyCash({ type: 'REIMBURSEMENT', paymentAccountCode: '1011' })).toBe(true);
  });

  test('a direct payment settled out of 1011 counts as petty cash', () => {
    expect(paidFromPettyCash({ type: 'DIRECT_PAYMENT', paymentAccountCode: '1011' })).toBe(true);
  });

  test('the GCash fund 1012 counts as petty cash', () => {
    expect(paidFromPettyCash({ type: 'DIRECT_PAYMENT', paymentAccountCode: '1012' })).toBe(true);
  });

  test('a petty cash voucher settled out of the bank is NOT petty cash', () => {
    expect(paidFromPettyCash({ type: 'PETTY_CASH', paymentAccountCode: '1020' })).toBe(false);
  });

  test('a direct payment from cash on hand is not petty cash', () => {
    expect(paidFromPettyCash({ type: 'DIRECT_PAYMENT', paymentAccountCode: '1010' })).toBe(false);
  });

  describe('legacy rows with no paymentAccountCode', () => {
    test('falls back to 1011 for PETTY_CASH', () => {
      expect(paidFromPettyCash({ type: 'PETTY_CASH', paymentAccountCode: null })).toBe(true);
    });

    test('falls back to 1020 for every other type', () => {
      expect(paidFromPettyCash({ type: 'REIMBURSEMENT', paymentAccountCode: null })).toBe(false);
    });
  });
});
