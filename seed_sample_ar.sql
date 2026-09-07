-- ============================================================
-- Sample AR Data — XYZ Corporation / INV-000001
-- Matches the customer drawer screenshot exactly
-- Run: mysql -u root -p ph_erp_db < seed_sample_ar.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ── 1. Chart of Accounts (insert if missing) ─────────────────
INSERT IGNORE INTO `accounts`
  (`accountCode`, `accountName`, `accountType`, `normalBalance`, `isActive`, `description`, `createdAt`, `updatedAt`)
VALUES
  ('1001', 'Cash on Hand',        'ASSET',     'DEBIT',  1, 'Cash receipts from collections',      NOW(), NOW()),
  ('1101', 'Accounts Receivable', 'ASSET',     'DEBIT',  1, 'Trade receivables from customers',    NOW(), NOW()),
  ('2201', 'Output VAT',          'LIABILITY', 'CREDIT', 1, 'VAT collected on sales',              NOW(), NOW()),
  ('4001', 'Service Revenue',     'REVENUE',   'CREDIT', 1, 'Revenue from professional services',  NOW(), NOW());

-- ── 2. Customer: XYZ Corporation ─────────────────────────────
INSERT INTO `customers`
  (`customerCode`, `name`, `tin`, `address`, `contactName`, `email`, `phone`, `isActive`, `createdAt`, `updatedAt`)
VALUES
  ('CUS-001', 'XYZ Corporation', '987-654-321-000',
   'BGC, Taguig, Metro Manila',
   'Maria Santos', 'xyz@client.com', '02-9876-5432',
   1, NOW(), NOW())
ON DUPLICATE KEY UPDATE
  `name`        = VALUES(`name`),
  `tin`         = VALUES(`tin`),
  `address`     = VALUES(`address`),
  `contactName` = VALUES(`contactName`),
  `email`       = VALUES(`email`),
  `phone`       = VALUES(`phone`),
  `updatedAt`   = NOW();

-- ── 3. Invoice: INV-000001 ────────────────────────────────────
-- Total shown in UI: ₱49,000 (₱43,750 net + ₱5,250 VAT @ 12%)
-- Status: PAID · Date: Jun 23 2026 · Due: Jul 23 2026
INSERT INTO `invoices`
  (`invoiceNo`, `customerId`, `invoiceDate`, `dueDate`,
   `description`, `subtotal`, `vatAmount`, `totalAmount`, `paidAmount`,
   `status`, `createdAt`, `updatedAt`)
SELECT
  'INV-000001',
  c.id,
  '2026-06-23',
  '2026-07-23',
  'Professional services rendered — June 2026',
  43750.00,
  5250.00,
  49000.00,
  49000.00,
  'PAID',
  '2026-06-23 08:00:00',
  NOW()
FROM `customers` c
WHERE c.customerCode = 'CUS-001'
ON DUPLICATE KEY UPDATE
  `paidAmount` = 49000.00,
  `status`     = 'PAID',
  `updatedAt`  = NOW();

-- ── 4. Invoice Line ───────────────────────────────────────────
INSERT INTO `invoice_lines`
  (`invoiceId`, `accountId`, `description`, `quantity`, `unitPrice`, `amount`, `vatCode`)
SELECT
  i.id,
  a.id,
  'Professional Services — June 2026',
  1.000,
  43750.00,
  43750.00,
  'VAT'
FROM `invoices`  i
JOIN `accounts`  a ON a.accountCode = '4001'
WHERE i.invoiceNo = 'INV-000001'
  AND NOT EXISTS (
    SELECT 1 FROM `invoice_lines` il WHERE il.invoiceId = i.id
  );

-- ── 5. Payment receipt ────────────────────────────────────────
INSERT INTO `payments_ar`
  (`paymentNo`, `invoiceId`, `paymentDate`, `amount`,
   `paymentMethod`, `reference`, `notes`, `createdAt`)
SELECT
  'PAY-AR-000001',
  i.id,
  '2026-06-23',
  49000.00,
  'Bank Transfer',
  'REF-XYZ-06232026',
  'Full payment received from XYZ Corporation',
  '2026-06-23 10:00:00'
FROM `invoices` i
WHERE i.invoiceNo = 'INV-000001'
  AND NOT EXISTS (
    SELECT 1 FROM `payments_ar` p WHERE p.paymentNo = 'PAY-AR-000001'
  );

-- ── 6a. Journal Entry — Sales (DR AR / CR Revenue + Output VAT) ──
INSERT INTO `journal_entries`
  (`entryNo`, `entryDate`, `reference`, `description`,
   `status`, `createdBy`, `postedAt`, `createdAt`, `updatedAt`)
VALUES
  ('JE-000001', '2026-06-23', 'INV-000001',
   'Sales invoice — XYZ Corporation professional services',
   'POSTED', 1, '2026-06-23 08:05:00', '2026-06-23 08:05:00', NOW())
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

INSERT INTO `journal_lines`
  (`entryId`, `accountId`, `debit`, `credit`, `description`, `lineOrder`)
SELECT
  je.id,
  a.id,
  CASE a.accountCode
    WHEN '1101' THEN 49000.00   -- DR Accounts Receivable (gross)
    ELSE 0.00
  END,
  CASE a.accountCode
    WHEN '4001' THEN 43750.00   -- CR Service Revenue (net)
    WHEN '2201' THEN 5250.00    -- CR Output VAT (12%)
    ELSE 0.00
  END,
  CASE a.accountCode
    WHEN '1101' THEN 'AR — XYZ Corporation / INV-000001'
    WHEN '4001' THEN 'Service Revenue — INV-000001'
    WHEN '2201' THEN 'Output VAT 12% — INV-000001'
  END,
  CASE a.accountCode
    WHEN '1101' THEN 0
    WHEN '4001' THEN 1
    WHEN '2201' THEN 2
  END
FROM `journal_entries` je
JOIN `accounts` a ON a.accountCode IN ('1101', '4001', '2201')
WHERE je.entryNo = 'JE-000001'
  AND NOT EXISTS (
    SELECT 1 FROM `journal_lines` jl WHERE jl.entryId = je.id
  );

-- ── 6b. Journal Entry — Collection (DR Cash / CR AR) ─────────
INSERT INTO `journal_entries`
  (`entryNo`, `entryDate`, `reference`, `description`,
   `status`, `createdBy`, `postedAt`, `createdAt`, `updatedAt`)
VALUES
  ('JE-000002', '2026-06-23', 'PAY-AR-000001',
   'Collection received — XYZ Corporation INV-000001',
   'POSTED', 1, '2026-06-23 10:05:00', '2026-06-23 10:05:00', NOW())
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

INSERT INTO `journal_lines`
  (`entryId`, `accountId`, `debit`, `credit`, `description`, `lineOrder`)
SELECT
  je.id,
  a.id,
  CASE a.accountCode
    WHEN '1001' THEN 49000.00   -- DR Cash on Hand
    ELSE 0.00
  END,
  CASE a.accountCode
    WHEN '1101' THEN 49000.00   -- CR Accounts Receivable (cleared)
    ELSE 0.00
  END,
  CASE a.accountCode
    WHEN '1001' THEN 'Cash collected — XYZ Corporation'
    WHEN '1101' THEN 'AR cleared — INV-000001'
  END,
  CASE a.accountCode
    WHEN '1001' THEN 0
    WHEN '1101' THEN 1
  END
FROM `journal_entries` je
JOIN `accounts` a ON a.accountCode IN ('1001', '1101')
WHERE je.entryNo = 'JE-000002'
  AND NOT EXISTS (
    SELECT 1 FROM `journal_lines` jl WHERE jl.entryId = je.id
  );

SET FOREIGN_KEY_CHECKS = 1;

-- ── Verify results ────────────────────────────────────────────
SELECT
  i.invoiceNo,
  c.name          AS customer,
  c.tin,
  c.contactName,
  i.invoiceDate,
  i.dueDate,
  i.subtotal,
  i.vatAmount,
  i.totalAmount,
  i.paidAmount,
  i.status
FROM `invoices`  i
JOIN `customers` c ON c.id = i.customerId
WHERE i.invoiceNo = 'INV-000001';

SELECT 'Journal entries posted:' AS info, COUNT(*) AS count
FROM `journal_entries`
WHERE entryNo IN ('JE-000001', 'JE-000002');
