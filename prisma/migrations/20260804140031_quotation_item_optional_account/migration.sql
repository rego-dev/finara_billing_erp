-- DropForeignKey
ALTER TABLE `quotation_lines` DROP FOREIGN KEY `quotation_lines_accountId_fkey`;

-- AlterTable
ALTER TABLE `quotation_lines` ADD COLUMN `itemId` INTEGER NULL,
    ADD COLUMN `itemName` VARCHAR(150) NULL,
    MODIFY `accountId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `quotation_lines_itemId_idx` ON `quotation_lines`(`itemId`);

-- AddForeignKey
ALTER TABLE `quotation_lines` ADD CONSTRAINT `quotation_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_lines` ADD CONSTRAINT `quotation_lines_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

