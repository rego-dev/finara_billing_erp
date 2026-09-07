-- ═══════════════════════════════════════════════════════════════
-- Migration: Multi-Business Support
-- All existing data is assigned to businessId = 1 (default business)
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Create businesses table ───────────────────────────────────
CREATE TABLE `businesses` (
  `id`        INT          NOT NULL AUTO_INCREMENT,
  `code`      VARCHAR(20)  NOT NULL,
  `name`      VARCHAR(150) NOT NULL,
  `tin`       VARCHAR(30)  NULL,
  `address`   TEXT         NULL,
  `phone`     VARCHAR(30)  NULL,
  `email`     VARCHAR(150) NULL,
  `industry`  VARCHAR(80)  NULL,
  `isActive`  BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdAt` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3)  NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `businesses_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Seed the default business (id will be 1)
INSERT INTO `businesses` (`code`, `name`, `isActive`, `createdAt`, `updatedAt`)
VALUES ('BIZ-001', 'My Business', TRUE, NOW(), NOW());

-- ── 2. Create user_businesses junction table ─────────────────────
CREATE TABLE `user_businesses` (
  `id`         INT NOT NULL AUTO_INCREMENT,
  `userId`     INT NOT NULL,
  `businessId` INT NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_businesses_userId_businessId_key` (`userId`, `businessId`),
  KEY `user_businesses_userId_idx` (`userId`),
  KEY `user_businesses_businessId_idx` (`businessId`),
  CONSTRAINT `user_businesses_userId_fkey`     FOREIGN KEY (`userId`)     REFERENCES `users`      (`id`) ON DELETE CASCADE,
  CONSTRAINT `user_businesses_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Grant all existing users access to business 1
INSERT INTO `user_businesses` (`userId`, `businessId`)
SELECT `id`, 1 FROM `users`;

-- ── 3. Add businessId to audit_logs ─────────────────────────────
ALTER TABLE `audit_logs`
  ADD COLUMN `businessId` INT NULL,
  ADD INDEX `audit_logs_businessId_idx` (`businessId`);

-- ── 4. Chart of Accounts ─────────────────────────────────────────
ALTER TABLE `accounts`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `accounts` SET `businessId` = 1;

-- Drop old unique on accountCode, add composite
ALTER TABLE `accounts`
  DROP INDEX `accounts_accountCode_key`,
  ADD UNIQUE KEY `accounts_businessId_accountCode_key` (`businessId`, `accountCode`),
  ADD INDEX `accounts_businessId_idx` (`businessId`);

-- ── 5. Journal Entries ───────────────────────────────────────────
ALTER TABLE `journal_entries`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `journal_entries_businessId_idx` (`businessId`);

UPDATE `journal_entries` SET `businessId` = 1;

-- ── 6. Vendors ───────────────────────────────────────────────────
ALTER TABLE `vendors`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `vendors` SET `businessId` = 1;

ALTER TABLE `vendors`
  DROP INDEX `vendors_vendorCode_key`,
  ADD UNIQUE KEY `vendors_businessId_vendorCode_key` (`businessId`, `vendorCode`),
  ADD INDEX `vendors_businessId_idx` (`businessId`);

-- ── 7. Bills ─────────────────────────────────────────────────────
ALTER TABLE `bills`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `bills_businessId_idx` (`businessId`);

UPDATE `bills` SET `businessId` = 1;

-- ── 8. Customers ─────────────────────────────────────────────────
ALTER TABLE `customers`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `customers` SET `businessId` = 1;

ALTER TABLE `customers`
  DROP INDEX `customers_customerCode_key`,
  ADD UNIQUE KEY `customers_businessId_customerCode_key` (`businessId`, `customerCode`),
  ADD INDEX `customers_businessId_idx` (`businessId`);

-- ── 9. Invoices ──────────────────────────────────────────────────
ALTER TABLE `invoices`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `invoices_businessId_idx` (`businessId`);

UPDATE `invoices` SET `businessId` = 1;

-- ── 10. Employees ────────────────────────────────────────────────
ALTER TABLE `employees`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `employees` SET `businessId` = 1;

ALTER TABLE `employees`
  DROP INDEX `employees_employeeNo_key`,
  ADD UNIQUE KEY `employees_businessId_employeeNo_key` (`businessId`, `employeeNo`),
  ADD INDEX `employees_businessId_idx` (`businessId`);

-- ── 11. Payroll Periods ──────────────────────────────────────────
ALTER TABLE `payroll_periods`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `payroll_periods_businessId_idx` (`businessId`);

UPDATE `payroll_periods` SET `businessId` = 1;

-- ── 12. System Settings ──────────────────────────────────────────
ALTER TABLE `system_settings`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `system_settings` SET `businessId` = 1;

ALTER TABLE `system_settings`
  DROP INDEX `system_settings_key_key`,
  ADD UNIQUE KEY `system_settings_businessId_key_key` (`businessId`, `key`),
  ADD INDEX `system_settings_businessId_idx` (`businessId`);

-- ── 13. Inventory Categories ─────────────────────────────────────
ALTER TABLE `inventory_categories`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `inventory_categories_businessId_idx` (`businessId`);

UPDATE `inventory_categories` SET `businessId` = 1;

-- ── 14. Inventory Items ──────────────────────────────────────────
ALTER TABLE `inventory_items`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `inventory_items` SET `businessId` = 1;

ALTER TABLE `inventory_items`
  DROP INDEX `inventory_items_sku_key`,
  ADD UNIQUE KEY `inventory_items_businessId_sku_key` (`businessId`, `sku`),
  ADD INDEX `inventory_items_businessId_idx` (`businessId`);

-- ── 15. Remittance Periods ───────────────────────────────────────
ALTER TABLE `remittance_periods`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `remittance_periods` SET `businessId` = 1;

ALTER TABLE `remittance_periods`
  DROP INDEX `remittance_periods_type_periodMonth_periodYear_key`,
  ADD UNIQUE KEY `remittance_periods_biz_type_month_year_key` (`businessId`, `type`, `periodMonth`, `periodYear`),
  ADD INDEX `remittance_periods_businessId_idx` (`businessId`);

-- ── 16. Expense Vouchers ─────────────────────────────────────────
ALTER TABLE `expense_vouchers`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `expense_vouchers_businessId_idx` (`businessId`);

UPDATE `expense_vouchers` SET `businessId` = 1;

-- ── 17. Daily Remittances ────────────────────────────────────────
ALTER TABLE `daily_remittances`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `daily_remittances` SET `businessId` = 1;

ALTER TABLE `daily_remittances`
  DROP INDEX `daily_remittances_date_key`,
  ADD UNIQUE KEY `daily_remittances_businessId_date_key` (`businessId`, `date`),
  ADD INDEX `daily_remittances_businessId_idx` (`businessId`);

-- ── 18. Custom Reports ───────────────────────────────────────────
ALTER TABLE `custom_reports`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `custom_reports_businessId_idx` (`businessId`);

UPDATE `custom_reports` SET `businessId` = 1;

-- ── 19. Purchase Orders ──────────────────────────────────────────
ALTER TABLE `purchase_orders`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `purchase_orders_businessId_idx` (`businessId`);

UPDATE `purchase_orders` SET `businessId` = 1;

-- ── 20. Fixed Assets ─────────────────────────────────────────────
ALTER TABLE `fixed_assets`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `fixed_assets_businessId_idx` (`businessId`);

UPDATE `fixed_assets` SET `businessId` = 1;

-- ── 21. Bank Accounts ────────────────────────────────────────────
ALTER TABLE `bank_accounts`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `bank_accounts_businessId_idx` (`businessId`);

UPDATE `bank_accounts` SET `businessId` = 1;

-- ── 22. Budgets ──────────────────────────────────────────────────
ALTER TABLE `budgets`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`;

UPDATE `budgets` SET `businessId` = 1;

ALTER TABLE `budgets`
  DROP INDEX `budgets_name_fiscalYear_key`,
  ADD UNIQUE KEY `budgets_businessId_name_fiscalYear_key` (`businessId`, `name`, `fiscalYear`),
  ADD INDEX `budgets_businessId_idx` (`businessId`);

-- ── 23. Recurring Templates ──────────────────────────────────────
ALTER TABLE `recurring_templates`
  ADD COLUMN `businessId` INT NOT NULL DEFAULT 1 AFTER `id`,
  ADD INDEX `recurring_templates_businessId_idx` (`businessId`);

UPDATE `recurring_templates` SET `businessId` = 1;
