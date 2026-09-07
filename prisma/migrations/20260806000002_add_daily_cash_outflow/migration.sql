-- Freeze each day's cash outflow onto the remittance record. Previously the
-- Daily Remittance Report recomputed cash figures live, so an approved report
-- silently changed whenever an entry was backdated or voided.
ALTER TABLE `daily_remittances`
  ADD COLUMN `cashOnHandOut`     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `pettyCashOut`      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `pettyCashGcashOut` DECIMAL(15,2) NOT NULL DEFAULT 0.00;

-- Backfill saved reports from the GL: total credited to each fund on that date.
UPDATE `daily_remittances` r
SET
  `cashOnHandOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1010'
      AND a.businessId = r.businessId
  ), 0),
  `pettyCashOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1011'
      AND a.businessId = r.businessId
  ), 0),
  `pettyCashGcashOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1012'
      AND a.businessId = r.businessId
  ), 0);
