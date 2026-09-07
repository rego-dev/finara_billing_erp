-- Track which cash account an expense voucher was actually paid from.
-- Reports previously inferred the source fund from `type`, which misclassified
-- reimbursements/direct payments that were settled out of the petty cash fund.
ALTER TABLE `expense_vouchers` ADD COLUMN `paymentAccountCode` VARCHAR(10) NULL;

-- Backfill from the GL: the credit line of the voucher's posted journal entry
-- is the account the cash left from.
UPDATE `expense_vouchers` v
JOIN (
  SELECT e.reference, e.businessId, MIN(a.accountCode) AS accountCode
  FROM `journal_entries` e
  JOIN `journal_lines` l ON l.entryId = e.id
  JOIN `accounts` a      ON a.id = l.accountId
  WHERE e.status = 'POSTED'
    AND l.credit > 0
    AND a.accountType = 'ASSET'
    AND a.accountCode LIKE '10%'
  GROUP BY e.reference, e.businessId
  HAVING COUNT(*) = 1
) src ON src.reference = v.voucherNo AND src.businessId = v.businessId
SET v.paymentAccountCode = src.accountCode
WHERE v.status = 'PAID';
