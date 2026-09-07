-- pettyCashGcashOut must distinguish "no GCash fund activity that day" (NULL,
-- hides the card) from "GCash fund had activity but zero net spend" (0.00,
-- e.g. funded but not yet used). A NOT NULL column with DEFAULT 0 could not
-- express that distinction, so a reloaded report with a real-but-empty GCash
-- day was indistinguishable from one with no GCash fund at all, and the card
-- silently vanished on reload where it had been visible on first generation.
ALTER TABLE `daily_remittances`
  MODIFY COLUMN `pettyCashGcashOut` DECIMAL(15,2) NULL DEFAULT NULL;

-- Recompute existing rows: NULL unless account 1012 had POSTED activity
-- (debit or credit) on that date, in which case use the credit sum.
UPDATE `daily_remittances` r
SET `pettyCashGcashOut` = (
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM `journal_lines` l
      JOIN `journal_entries` e ON e.id = l.entryId
      JOIN `accounts` a        ON a.id = l.accountId
      WHERE e.status = 'POSTED' AND e.businessId = r.businessId
        AND DATE(e.entryDate) = r.date AND a.accountCode = '1012'
        AND a.businessId = r.businessId AND (l.debit > 0 OR l.credit > 0)
    )
    THEN (
      SELECT COALESCE(SUM(l.credit), 0) FROM `journal_lines` l
      JOIN `journal_entries` e ON e.id = l.entryId
      JOIN `accounts` a        ON a.id = l.accountId
      WHERE e.status = 'POSTED' AND e.businessId = r.businessId
        AND DATE(e.entryDate) = r.date AND a.accountCode = '1012'
        AND a.businessId = r.businessId
    )
    ELSE NULL END
);
