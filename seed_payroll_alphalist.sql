-- ============================================================
-- Seed: Payroll Period + Items for existing employees
-- Fixes: Alphalist showing 0 employees
-- Run: mysql -u root -p ph_erp_db < seed_payroll_alphalist.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── Create payroll period (Jun 1–15 2026, APPROVED) ──────────
INSERT IGNORE INTO `payroll_periods`
  (`periodName`, `startDate`, `endDate`, `payDate`, `status`, `createdAt`, `updatedAt`)
VALUES
  ('June 2026 — 1st Half', '2026-06-01', '2026-06-15', '2026-06-15', 'APPROVED', NOW(), NOW());

-- ── Insert payroll items — all math done in one nested SELECT ─
INSERT INTO `payroll_items`
  (`periodId`, `employeeId`,
   `basicPay`, `allowances`, `overtimePay`, `grossPay`,
   `sssEmployee`, `sssEmployer`,
   `philhealthEe`, `philhealthEr`,
   `pagibigEe`, `pagibigEr`,
   `withholdingTax`, `totalDeductions`, `netPay`,
   `createdAt`)

SELECT
  p.id                        AS periodId,
  c3.employeeId,
  c3.basicPayPerPeriod        AS basicPay,
  0.00                        AS allowances,
  0.00                        AS overtimePay,
  c3.basicPayPerPeriod        AS grossPay,

  ROUND(c3.sssEeMonthly  / c3.periodsPerMonth, 2) AS sssEmployee,
  ROUND(c3.sssErMonthly  / c3.periodsPerMonth, 2) AS sssEmployer,
  ROUND(c3.phEeMonthly   / c3.periodsPerMonth, 2) AS philhealthEe,
  ROUND(c3.phErMonthly   / c3.periodsPerMonth, 2) AS philhealthEr,
  ROUND(c3.piEeMonthly   / c3.periodsPerMonth, 2) AS pagibigEe,
  ROUND(c3.piErMonthly   / c3.periodsPerMonth, 2) AS pagibigEr,

  -- Withholding tax per period
  ROUND(
    CASE
      WHEN c3.annualTaxable <=   250000 THEN 0
      WHEN c3.annualTaxable <=   400000 THEN (c3.annualTaxable -  250000) * 0.15
      WHEN c3.annualTaxable <=   800000 THEN  22500 + (c3.annualTaxable -  400000) * 0.20
      WHEN c3.annualTaxable <=  2000000 THEN 102500 + (c3.annualTaxable -  800000) * 0.25
      WHEN c3.annualTaxable <=  8000000 THEN 402500 + (c3.annualTaxable - 2000000) * 0.30
      ELSE                                   2202500+ (c3.annualTaxable - 8000000) * 0.35
    END / c3.frequency
  , 2)                        AS withholdingTax,

  -- Total deductions (EE side)
  ROUND(
    (c3.sssEeMonthly / c3.periodsPerMonth) +
    (c3.phEeMonthly  / c3.periodsPerMonth) +
    (c3.piEeMonthly  / c3.periodsPerMonth) +
    (
      CASE
        WHEN c3.annualTaxable <=   250000 THEN 0
        WHEN c3.annualTaxable <=   400000 THEN (c3.annualTaxable -  250000) * 0.15
        WHEN c3.annualTaxable <=   800000 THEN  22500 + (c3.annualTaxable -  400000) * 0.20
        WHEN c3.annualTaxable <=  2000000 THEN 102500 + (c3.annualTaxable -  800000) * 0.25
        WHEN c3.annualTaxable <=  8000000 THEN 402500 + (c3.annualTaxable - 2000000) * 0.30
        ELSE                                   2202500+ (c3.annualTaxable - 8000000) * 0.35
      END / c3.frequency
    )
  , 2)                        AS totalDeductions,

  -- Net pay
  ROUND(
    c3.basicPayPerPeriod -
    (c3.sssEeMonthly / c3.periodsPerMonth) -
    (c3.phEeMonthly  / c3.periodsPerMonth) -
    (c3.piEeMonthly  / c3.periodsPerMonth) -
    (
      CASE
        WHEN c3.annualTaxable <=   250000 THEN 0
        WHEN c3.annualTaxable <=   400000 THEN (c3.annualTaxable -  250000) * 0.15
        WHEN c3.annualTaxable <=   800000 THEN  22500 + (c3.annualTaxable -  400000) * 0.20
        WHEN c3.annualTaxable <=  2000000 THEN 102500 + (c3.annualTaxable -  800000) * 0.25
        WHEN c3.annualTaxable <=  8000000 THEN 402500 + (c3.annualTaxable - 2000000) * 0.30
        ELSE                                   2202500+ (c3.annualTaxable - 8000000) * 0.35
      END / c3.frequency
    )
  , 2)                        AS netPay,

  NOW()

-- ── Level 3: compute annualTaxable ───────────────────────────
FROM (
  SELECT
    c2.*,
    GREATEST(0,
      (c2.basicSalary - c2.sssEeMonthly - c2.phEeMonthly - c2.piEeMonthly) * 12
    ) AS annualTaxable
  FROM (

    -- ── Level 2: compute all contributions ───────────────────
    SELECT
      c1.*,

      -- SSS Employee share (2024 bracket table)
      CASE
        WHEN c1.basicSalary <  4250 THEN 180.00
        WHEN c1.basicSalary <  4750 THEN 202.50
        WHEN c1.basicSalary <  5250 THEN 225.00
        WHEN c1.basicSalary <  5750 THEN 247.50
        WHEN c1.basicSalary <  6250 THEN 270.00
        WHEN c1.basicSalary <  6750 THEN 292.50
        WHEN c1.basicSalary <  7250 THEN 315.00
        WHEN c1.basicSalary <  7750 THEN 337.50
        WHEN c1.basicSalary <  8250 THEN 360.00
        WHEN c1.basicSalary <  8750 THEN 382.50
        WHEN c1.basicSalary <  9250 THEN 405.00
        WHEN c1.basicSalary <  9750 THEN 427.50
        WHEN c1.basicSalary < 10250 THEN 450.00
        WHEN c1.basicSalary < 10750 THEN 472.50
        WHEN c1.basicSalary < 11250 THEN 495.00
        WHEN c1.basicSalary < 11750 THEN 517.50
        WHEN c1.basicSalary < 12250 THEN 540.00
        WHEN c1.basicSalary < 12750 THEN 562.50
        WHEN c1.basicSalary < 13250 THEN 585.00
        WHEN c1.basicSalary < 13750 THEN 607.50
        WHEN c1.basicSalary < 14250 THEN 630.00
        WHEN c1.basicSalary < 14750 THEN 652.50
        WHEN c1.basicSalary < 15250 THEN 675.00
        WHEN c1.basicSalary < 15750 THEN 697.50
        WHEN c1.basicSalary < 16250 THEN 720.00
        WHEN c1.basicSalary < 16750 THEN 742.50
        WHEN c1.basicSalary < 17250 THEN 765.00
        WHEN c1.basicSalary < 17750 THEN 787.50
        WHEN c1.basicSalary < 18250 THEN 810.00
        WHEN c1.basicSalary < 18750 THEN 832.50
        WHEN c1.basicSalary < 19250 THEN 855.00
        WHEN c1.basicSalary < 19750 THEN 877.50
        ELSE                              900.00
      END AS sssEeMonthly,

      -- SSS Employer share
      CASE
        WHEN c1.basicSalary <  4250 THEN 380.00
        WHEN c1.basicSalary <  4750 THEN 427.50
        WHEN c1.basicSalary <  5250 THEN 475.00
        WHEN c1.basicSalary <  5750 THEN 522.50
        WHEN c1.basicSalary <  6250 THEN 570.00
        WHEN c1.basicSalary <  6750 THEN 617.50
        WHEN c1.basicSalary <  7250 THEN 665.00
        WHEN c1.basicSalary <  7750 THEN 712.50
        WHEN c1.basicSalary <  8250 THEN 760.00
        WHEN c1.basicSalary <  8750 THEN 807.50
        WHEN c1.basicSalary <  9250 THEN 855.00
        WHEN c1.basicSalary <  9750 THEN 902.50
        WHEN c1.basicSalary < 10250 THEN 950.00
        WHEN c1.basicSalary < 10750 THEN 997.50
        WHEN c1.basicSalary < 11250 THEN 1045.00
        WHEN c1.basicSalary < 11750 THEN 1092.50
        WHEN c1.basicSalary < 12250 THEN 1140.00
        WHEN c1.basicSalary < 12750 THEN 1187.50
        WHEN c1.basicSalary < 13250 THEN 1235.00
        WHEN c1.basicSalary < 13750 THEN 1282.50
        WHEN c1.basicSalary < 14250 THEN 1330.00
        WHEN c1.basicSalary < 14750 THEN 1377.50
        WHEN c1.basicSalary < 15250 THEN 1425.00
        WHEN c1.basicSalary < 15750 THEN 1472.50
        WHEN c1.basicSalary < 16250 THEN 1520.00
        WHEN c1.basicSalary < 16750 THEN 1567.50
        WHEN c1.basicSalary < 17250 THEN 1615.00
        WHEN c1.basicSalary < 17750 THEN 1662.50
        WHEN c1.basicSalary < 18250 THEN 1710.00
        WHEN c1.basicSalary < 18750 THEN 1757.50
        WHEN c1.basicSalary < 19250 THEN 1805.00
        WHEN c1.basicSalary < 19750 THEN 1852.50
        ELSE                              1900.00
      END AS sssErMonthly,

      -- PhilHealth: 5%, floor ₱10K, ceiling ₱100K, split equally
      ROUND(LEAST(GREATEST(c1.basicSalary, 10000), 100000) * 0.05 / 2, 2) AS phEeMonthly,
      ROUND(LEAST(GREATEST(c1.basicSalary, 10000), 100000) * 0.05 / 2, 2) AS phErMonthly,

      -- Pag-IBIG: 1% if salary ≤ ₱1,500 else 2%, max ₱100 EE & ER
      ROUND(LEAST(LEAST(c1.basicSalary, 5000) *
        CASE WHEN c1.basicSalary <= 1500 THEN 0.01 ELSE 0.02 END, 100), 2) AS piEeMonthly,
      ROUND(LEAST(LEAST(c1.basicSalary, 5000) * 0.02, 100), 2)             AS piErMonthly

    FROM (
      -- ── Level 1: base employee fields ──────────────────────
      SELECT
        e.id        AS employeeId,
        e.basicSalary,
        e.payFrequency,
        CASE e.payFrequency
          WHEN 'MONTHLY'      THEN 1
          WHEN 'SEMI_MONTHLY' THEN 2
          WHEN 'WEEKLY'       THEN 4
          ELSE 2
        END AS periodsPerMonth,
        CASE e.payFrequency
          WHEN 'MONTHLY'      THEN 12
          WHEN 'SEMI_MONTHLY' THEN 24
          WHEN 'WEEKLY'       THEN 52
          ELSE 24
        END AS frequency,
        ROUND(e.basicSalary /
          CASE e.payFrequency
            WHEN 'MONTHLY'      THEN 1
            WHEN 'SEMI_MONTHLY' THEN 2
            WHEN 'WEEKLY'       THEN 4
            ELSE 2
          END, 2) AS basicPayPerPeriod
      FROM employees e
      WHERE e.isActive = 1
    ) c1

  ) c2
) c3

-- cross join to get period id
JOIN payroll_periods p ON p.periodName = 'June 2026 — 1st Half'

ON DUPLICATE KEY UPDATE
  `basicPay`        = VALUES(`basicPay`),
  `grossPay`        = VALUES(`grossPay`),
  `sssEmployee`     = VALUES(`sssEmployee`),
  `sssEmployer`     = VALUES(`sssEmployer`),
  `philhealthEe`    = VALUES(`philhealthEe`),
  `philhealthEr`    = VALUES(`philhealthEr`),
  `pagibigEe`       = VALUES(`pagibigEe`),
  `pagibigEr`       = VALUES(`pagibigEr`),
  `withholdingTax`  = VALUES(`withholdingTax`),
  `totalDeductions` = VALUES(`totalDeductions`),
  `netPay`          = VALUES(`netPay`);

SET FOREIGN_KEY_CHECKS = 1;

-- ── Verify ────────────────────────────────────────────────────
SELECT
  e.employeeNo,
  CONCAT(e.firstName, ' ', e.lastName) AS name,
  e.basicSalary,
  p.periodName,
  p.status,
  pi.basicPay,
  pi.sssEmployee,
  pi.philhealthEe,
  pi.pagibigEe,
  pi.withholdingTax,
  pi.totalDeductions,
  pi.netPay
FROM payroll_items  pi
JOIN payroll_periods p ON p.id = pi.periodId
JOIN employees       e ON e.id = pi.employeeId
WHERE p.periodName = 'June 2026 — 1st Half';
