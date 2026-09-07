const { nextDocNumber } = require('../server/utils/docNumber');

describe('nextDocNumber', () => {
  test('first document when the table is empty', () => {
    expect(nextDocNumber('PO-', null)).toBe('PO-000001');
    expect(nextDocNumber('PO-', undefined)).toBe('PO-000001');
  });

  test('increments the last number', () => {
    expect(nextDocNumber('PO-', 'PO-000001')).toBe('PO-000002');
    expect(nextDocNumber('PO-', 'PO-000009')).toBe('PO-000010');
    expect(nextDocNumber('PO-', 'PO-000099')).toBe('PO-000100');
  });

  // The bug: genPONumber used count()+1, so a deleted row made the next
  // number collide with an existing one (P2002 -> 409, permanently).
  test('is driven by the last number, not by how many rows exist', () => {
    // 5 POs created, PO-000003 deleted -> 4 rows remain, last is PO-000005.
    // count()+1 would produce PO-000005 and collide. This must not.
    expect(nextDocNumber('PO-', 'PO-000005')).toBe('PO-000006');
  });

  test('keeps padding width as documents grow past it', () => {
    expect(nextDocNumber('PO-', 'PO-999999')).toBe('PO-1000000');
  });

  test('reads the trailing digits, ignoring digits inside the prefix', () => {
    expect(nextDocNumber('BILL-', 'BILL-000042')).toBe('BILL-000043');
    expect(nextDocNumber('EV-', 'EV-000007')).toBe('EV-000008');
  });

  test('falls back to 1 when the last number has no trailing digits', () => {
    expect(nextDocNumber('PO-', 'PO-DRAFT')).toBe('PO-000001');
  });

  test('honours a custom padding width', () => {
    expect(nextDocNumber('CR-', null, 4)).toBe('CR-0001');
    expect(nextDocNumber('CR-', 'CR-0012', 4)).toBe('CR-0013');
  });
});
