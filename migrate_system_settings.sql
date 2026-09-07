-- Run this script to create the system_settings table
-- From terminal: mysql -u root -p ph_erp_db < migrate_system_settings.sql
-- Or paste into MySQL Workbench / phpMyAdmin

CREATE TABLE IF NOT EXISTS `system_settings` (
  `id`        INT          NOT NULL AUTO_INCREMENT,
  `key`       VARCHAR(100) NOT NULL,
  `value`     TEXT         NOT NULL,
  `updatedAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `system_settings_key_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed with default settings (optional — app will seed on first save)
INSERT IGNORE INTO `system_settings` (`key`, `value`) VALUES
  ('companyName',        'My Company'),
  ('companyTin',         ''),
  ('rdoCode',            ''),
  ('vatRegistered',      'true'),
  ('fiscalYearStart',    '01-01'),
  ('accountingMethod',   'ACCRUAL'),
  ('currency',           'PHP'),
  ('dateFormat',         'MM/DD/YYYY'),
  ('payrollCutoff1',     '15'),
  ('payrollCutoff2',     '30'),
  ('sssErRate',          '0.095'),
  ('philhealthRate',     '0.05'),
  ('pagibigErRate',      '0.02'),
  ('taxExemptionCode',   'S0'),
  ('invoicePrefix',      'INV-'),
  ('invoiceNextNo',      '1'),
  ('billPrefix',         'BILL-'),
  ('billNextNo',         '1'),
  ('jePrefix',           'JE-'),
  ('jeNextNo',           '1'),
  ('paymentPrefix',      'PAY-'),
  ('systemTimezone',     'Asia/Manila'),
  ('decimalPlaces',      '2'),
  ('showCentsInReports', 'true'),
  ('sessionTimeout',     '480'),
  ('enforceStrongPwd',   'true'),
  ('auditTrail',         'true');

SELECT 'system_settings table created and seeded successfully.' AS result;
