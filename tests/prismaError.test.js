const { uniqueFieldLabel } = require('../server/utils/prismaError');

describe('uniqueFieldLabel', () => {
  // The bug: errorHandler did `err.meta.target[0]`. On PostgreSQL target is an
  // array of field names, but on MySQL (this project) it is a STRING, so [0]
  // returned the first CHARACTER — "poNumber" rendered as "p".
  test('MySQL: bare field name string', () => {
    expect(uniqueFieldLabel('poNumber')).toBe('poNumber');
  });

  test('MySQL: index name string', () => {
    expect(uniqueFieldLabel('purchase_orders_poNumber_key')).toBe('poNumber');
    expect(uniqueFieldLabel('invoices_invoiceNo_key')).toBe('invoiceNo');
  });

  test('PostgreSQL: array of field names', () => {
    expect(uniqueFieldLabel(['poNumber'])).toBe('poNumber');
    expect(uniqueFieldLabel(['businessId', 'employeeNo'])).toBe('businessId, employeeNo');
  });

  test('primary key constraint reads as ID', () => {
    expect(uniqueFieldLabel('PRIMARY')).toBe('ID');
  });

  test('missing target falls back to a generic label', () => {
    expect(uniqueFieldLabel(undefined)).toBe('value');
    expect(uniqueFieldLabel(null)).toBe('value');
    expect(uniqueFieldLabel('')).toBe('value');
  });

  test('never returns a single stray character', () => {
    for (const t of ['poNumber', 'purchase_orders_poNumber_key', ['poNumber'], 'PRIMARY']) {
      expect(uniqueFieldLabel(t).length).toBeGreaterThan(1);
    }
  });
});
