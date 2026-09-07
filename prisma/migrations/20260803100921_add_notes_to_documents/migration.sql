-- AlterTable
ALTER TABLE `bills` ADD COLUMN `notes` TEXT NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `notes` TEXT NULL;

-- AlterTable
ALTER TABLE `journal_entries` ADD COLUMN `notes` TEXT NULL;

-- AlterTable
ALTER TABLE `quotations` ADD COLUMN `notes` TEXT NULL;

-- AlterTable
ALTER TABLE `recurring_templates` ADD COLUMN `notes` TEXT NULL;

