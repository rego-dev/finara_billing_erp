/**
 * Philippine Statutory Computations
 * SSS, PhilHealth, Pag-IBIG, BIR Withholding Tax
 * Aligned with current rates (2024-2025)
 */

// ─── SSS Contribution Table (2024) ──────────────────────────
// Monthly salary credit ranges and contributions
const SSS_TABLE = [
  { min: 0,      max: 4249.99,  msc: 4000,  ee: 180,  er: 380  },
  { min: 4250,   max: 4749.99,  msc: 4500,  ee: 202.50, er: 427.50 },
  { min: 4750,   max: 5249.99,  msc: 5000,  ee: 225,  er: 475  },
  { min: 5250,   max: 5749.99,  msc: 5500,  ee: 247.50, er: 522.50 },
  { min: 5750,   max: 6249.99,  msc: 6000,  ee: 270,  er: 570  },
  { min: 6250,   max: 6749.99,  msc: 6500,  ee: 292.50, er: 617.50 },
  { min: 6750,   max: 7249.99,  msc: 7000,  ee: 315,  er: 665  },
  { min: 7250,   max: 7749.99,  msc: 7500,  ee: 337.50, er: 712.50 },
  { min: 7750,   max: 8249.99,  msc: 8000,  ee: 360,  er: 760  },
  { min: 8250,   max: 8749.99,  msc: 8500,  ee: 382.50, er: 807.50 },
  { min: 8750,   max: 9249.99,  msc: 9000,  ee: 405,  er: 855  },
  { min: 9250,   max: 9749.99,  msc: 9500,  ee: 427.50, er: 902.50 },
  { min: 9750,   max: 10249.99, msc: 10000, ee: 450,  er: 950  },
  { min: 10250,  max: 10749.99, msc: 10500, ee: 472.50, er: 997.50 },
  { min: 10750,  max: 11249.99, msc: 11000, ee: 495,  er: 1045 },
  { min: 11250,  max: 11749.99, msc: 11500, ee: 517.50, er: 1092.50 },
  { min: 11750,  max: 12249.99, msc: 12000, ee: 540,  er: 1140 },
  { min: 12250,  max: 12749.99, msc: 12500, ee: 562.50, er: 1187.50 },
  { min: 12750,  max: 13249.99, msc: 13000, ee: 585,  er: 1235 },
  { min: 13250,  max: 13749.99, msc: 13500, ee: 607.50, er: 1282.50 },
  { min: 13750,  max: 14249.99, msc: 14000, ee: 630,  er: 1330 },
  { min: 14250,  max: 14749.99, msc: 14500, ee: 652.50, er: 1377.50 },
  { min: 14750,  max: 15249.99, msc: 15000, ee: 675,  er: 1425 },
  { min: 15250,  max: 15749.99, msc: 15500, ee: 697.50, er: 1472.50 },
  { min: 15750,  max: 16249.99, msc: 16000, ee: 720,  er: 1520 },
  { min: 16250,  max: 16749.99, msc: 16500, ee: 742.50, er: 1567.50 },
  { min: 16750,  max: 17249.99, msc: 17000, ee: 765,  er: 1615 },
  { min: 17250,  max: 17749.99, msc: 17500, ee: 787.50, er: 1662.50 },
  { min: 17750,  max: 18249.99, msc: 18000, ee: 810,  er: 1710 },
  { min: 18250,  max: 18749.99, msc: 18500, ee: 832.50, er: 1757.50 },
  { min: 18750,  max: 19249.99, msc: 19000, ee: 855,  er: 1805 },
  { min: 19250,  max: 19749.99, msc: 19500, ee: 877.50, er: 1852.50 },
  { min: 19750,  max: 20249.99, msc: 20000, ee: 900,  er: 1900 },
  { min: 20250,  max: Infinity, msc: 20000, ee: 900,  er: 1900 }, // capped at 20,000 MSC
];

/**
 * Compute SSS contribution based on monthly salary
 * @param {number} monthlySalary
 * @returns {{ ee: number, er: number, total: number }}
 */
function computeSSS(monthlySalary) {
  const bracket = SSS_TABLE.find(
    (b) => monthlySalary >= b.min && monthlySalary <= b.max
  ) || SSS_TABLE[SSS_TABLE.length - 1];

  return {
    ee: bracket.ee,
    er: bracket.er,
    total: bracket.ee + bracket.er,
    msc: bracket.msc,
  };
}

// ─── PhilHealth ──────────────────────────────────────────────
// 2024: 5% of basic monthly salary, shared equally (2.5% each)
// Floor: ₱10,000 monthly salary → ₱500 total (₱250 each)
// Ceiling: ₱100,000 monthly salary → ₱5,000 total (₱2,500 each)

const PHILHEALTH_RATE = 0.05;
const PHILHEALTH_FLOOR_SALARY = 10000;
const PHILHEALTH_CEILING_SALARY = 100000;

/**
 * Compute PhilHealth contribution
 * @param {number} monthlySalary
 * @returns {{ ee: number, er: number, total: number }}
 */
function computePhilHealth(monthlySalary) {
  const effectiveSalary = Math.max(
    PHILHEALTH_FLOOR_SALARY,
    Math.min(monthlySalary, PHILHEALTH_CEILING_SALARY)
  );
  const total = effectiveSalary * PHILHEALTH_RATE;
  const share = total / 2;
  return { ee: share, er: share, total };
}

// ─── Pag-IBIG ────────────────────────────────────────────────
// Employee: 1% if salary ≤ ₱1,500; 2% if salary > ₱1,500 (max ₱100/month)
// Employer: always 2% of salary up to ₱5,000 (max ₱100)

const PAGIBIG_CEILING = 5000;
const PAGIBIG_MAX_EE = 100;
const PAGIBIG_MAX_ER = 100;

/**
 * Compute Pag-IBIG contribution
 * @param {number} monthlySalary
 * @returns {{ ee: number, er: number, total: number }}
 */
function computePagIBIG(monthlySalary) {
  const eeRate = monthlySalary <= 1500 ? 0.01 : 0.02;
  const base = Math.min(monthlySalary, PAGIBIG_CEILING);
  const ee = Math.min(base * eeRate, PAGIBIG_MAX_EE);
  const er = Math.min(base * 0.02, PAGIBIG_MAX_ER);
  return { ee, er, total: ee + er };
}

// ─── BIR Withholding Tax (TRAIN Law, 2024 onwards) ──────────
// Annual tax brackets
const TAX_BRACKETS = [
  { min: 0,          max: 250000,    base: 0,       rate: 0    },
  { min: 250001,     max: 400000,    base: 0,       rate: 0.15 },
  { min: 400001,     max: 800000,    base: 22500,   rate: 0.20 },
  { min: 800001,     max: 2000000,   base: 102500,  rate: 0.25 },
  { min: 2000001,    max: 8000000,   base: 402500,  rate: 0.30 },
  { min: 8000001,    max: Infinity,  base: 2202500, rate: 0.35 },
];

/**
 * Compute annual income tax
 * @param {number} annualTaxableIncome
 * @returns {number} annual tax
 */
function computeAnnualTax(annualTaxableIncome) {
  if (annualTaxableIncome <= 0) return 0;
  const bracket = TAX_BRACKETS.find(
    (b) => annualTaxableIncome > b.min - 1 && annualTaxableIncome <= b.max
  );
  if (!bracket) return 0;
  return bracket.base + (annualTaxableIncome - (bracket.min - 1)) * bracket.rate;
}

/**
 * Compute monthly withholding tax (semi-monthly pay x 24, or monthly x 12)
 * @param {number} grossMonthlyPay
 * @param {number} monthlyNonTaxableDeductions (SSS+PhilHealth+PagIBIG employee shares)
 * @param {number} frequency - number of pay periods per year (12=monthly, 24=semi-monthly, 26=bi-weekly)
 * @returns {number} withholding tax per period
 */
function computeWithholdingTax(grossMonthlyPay, monthlyNonTaxableDeductions, frequency = 24) {
  const annualGross = grossMonthlyPay * 12;
  const annualDeductions = monthlyNonTaxableDeductions * 12;
  const annualTaxableIncome = Math.max(0, annualGross - annualDeductions);
  const annualTax = computeAnnualTax(annualTaxableIncome);
  return annualTax / frequency;
}

// ─── VAT ──────────────────────────────────────────────────────
const VAT_RATE = 0.12;

function computeVAT(amount, inclusive = false) {
  if (inclusive) {
    const base = amount / (1 + VAT_RATE);
    return { base: round2(base), vat: round2(amount - base), total: round2(amount) };
  }
  const vat = amount * VAT_RATE;
  return { base: round2(amount), vat: round2(vat), total: round2(amount + vat) };
}

// ─── Expanded Withholding Tax (EWT) common rates ────────────
const EWT_RATES = {
  PROFESSIONAL_SERVICES: 0.10,         // 10% on professional fees
  RENTAL:                0.05,         // 5% on rental payments
  GOODS:                 0.01,         // 1% on goods (suspended as of 2022, but often referenced)
  SERVICES:              0.02,         // 2% on services
  CONTRACTOR:            0.02,
  COMMISSION:            0.10,
};

function computeEWT(grossAmount, type = 'SERVICES') {
  const rate = EWT_RATES[type] || 0.02;
  return { gross: round2(grossAmount), rate, ewt: round2(grossAmount * rate) };
}

// ─── Full payroll computation ────────────────────────────────
/**
 * Compute a complete payroll item for one pay period
 * @param {object} params
 * @param {number} params.basicSalary - monthly basic salary
 * @param {number} params.allowances - non-taxable allowances per period
 * @param {number} params.overtimePay - overtime per period
 * @param {string} params.payFrequency - MONTHLY | SEMI_MONTHLY | WEEKLY
 * @returns {object} payroll breakdown
 */
function computePayroll({ basicSalary, allowances = 0, overtimePay = 0, payFrequency = 'SEMI_MONTHLY' }) {
  const frequency = payFrequency === 'MONTHLY' ? 12 : payFrequency === 'SEMI_MONTHLY' ? 24 : 52;
  const periodsPerMonth = 12 / (frequency / 12) > 12 ? 12 : frequency / 12;

  // Monthly figures
  const sss = computeSSS(basicSalary);
  const ph = computePhilHealth(basicSalary);
  const pi = computePagIBIG(basicSalary);

  const monthlyNonTaxableDeductions = sss.ee + ph.ee + pi.ee;

  // Per-period basic pay
  const periodsInMonth = frequency / 12;
  const basicPayPerPeriod = basicSalary / periodsInMonth;

  // Gross pay per period
  const grossPayPerPeriod = basicPayPerPeriod + allowances + overtimePay;

  // Withholding tax per period
  const wtaxPerPeriod = computeWithholdingTax(basicSalary, monthlyNonTaxableDeductions, frequency);

  // Statutory deductions per period
  const sssEePerPeriod   = sss.ee / periodsInMonth;
  const phEePerPeriod    = ph.ee / periodsInMonth;
  const piEePerPeriod    = pi.ee / periodsInMonth;

  const totalDeductionsPerPeriod = sssEePerPeriod + phEePerPeriod + piEePerPeriod + wtaxPerPeriod;
  const netPayPerPeriod = grossPayPerPeriod - totalDeductionsPerPeriod;

  return {
    basicPay:        round2(basicPayPerPeriod),
    allowances:      round2(allowances),
    overtimePay:     round2(overtimePay),
    grossPay:        round2(grossPayPerPeriod),
    sssEmployee:     round2(sssEePerPeriod),
    sssEmployer:     round2(sss.er / periodsInMonth),
    philhealthEe:    round2(phEePerPeriod),
    philhealthEr:    round2(ph.er / periodsInMonth),
    pagibigEe:       round2(piEePerPeriod),
    pagibigEr:       round2(pi.er / periodsInMonth),
    withholdingTax:  round2(wtaxPerPeriod),
    totalDeductions: round2(totalDeductionsPerPeriod),
    netPay:          round2(netPayPerPeriod),
  };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  computeSSS,
  computePhilHealth,
  computePagIBIG,
  computeWithholdingTax,
  computeAnnualTax,
  computeVAT,
  computeEWT,
  computePayroll,
  round2,
  VAT_RATE,
  EWT_RATES,
};
