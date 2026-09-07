const { computeVAT, computePhilHealth, computePagIBIG, VAT_RATE } = require('../server/utils/phCompliance');

describe('computeVAT', () => {
  test('exclusive: adds 12% on top', () => {
    const r = computeVAT(1000);
    expect(r.base).toBeCloseTo(1000, 2);
    expect(r.vat).toBeCloseTo(120, 2);
    expect(r.total).toBeCloseTo(1120, 2);
  });

  test('inclusive: extracts VAT from gross', () => {
    const r = computeVAT(1120, true);
    expect(r.base).toBeCloseTo(1000, 2);
    expect(r.vat).toBeCloseTo(120, 2);
    expect(r.total).toBeCloseTo(1120, 2);
  });

  test('VAT_RATE is 12%', () => {
    expect(VAT_RATE).toBe(0.12);
  });
});

describe('computePhilHealth', () => {
  test('5% split evenly (mid salary)', () => {
    const r = computePhilHealth(20000);
    expect(r.ee).toBeCloseTo(500, 2); // 20000 * 5% / 2
    expect(r.er).toBeCloseTo(500, 2);
  });

  test('applies salary floor of 10,000', () => {
    const r = computePhilHealth(8000);
    expect(r.ee).toBeCloseTo(250, 2); // floor 10000 * 5% / 2
  });

  test('applies salary ceiling of 100,000', () => {
    const r = computePhilHealth(150000);
    expect(r.ee).toBeCloseTo(2500, 2); // ceiling 100000 * 5% / 2
  });
});

describe('computePagIBIG', () => {
  test('caps employee share at 100', () => {
    const r = computePagIBIG(50000);
    expect(r.ee).toBeLessThanOrEqual(100);
  });

  test('1% rate below 1,500 salary', () => {
    const r = computePagIBIG(1000);
    expect(r.ee).toBeCloseTo(10, 2); // 1000 * 1%
  });
});
