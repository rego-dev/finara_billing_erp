-- DropForeignKey
ALTER TABLE `user_businesses` DROP FOREIGN KEY `user_businesses_businessId_fkey`;

-- DropForeignKey
ALTER TABLE `user_businesses` DROP FOREIGN KEY `user_businesses_userId_fkey`;

-- DropIndex (safe: skip if index does not exist)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'accounts' AND index_name = 'accounts_accountCode_idx');
SET @sql = IF(@idx_exists > 0, 'DROP INDEX `accounts_accountCode_idx` ON `accounts`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- DropIndex (safe: skip if index does not exist)
SET @idx_exists = (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'inventory_items' AND index_name = 'inventory_items_sku_idx');
SET @sql = IF(@idx_exists > 0, 'DROP INDEX `inventory_items_sku_idx` ON `inventory_items`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- AddForeignKey
ALTER TABLE `user_businesses` ADD CONSTRAINT `user_businesses_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_businesses` ADD CONSTRAINT `user_businesses_businessId_fkey` FOREIGN KEY (`businessId`) REFERENCES `businesses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `remittance_periods` RENAME INDEX `remittance_periods_biz_type_month_year_key` TO `remittance_periods_businessId_type_periodMonth_periodYear_key`;
