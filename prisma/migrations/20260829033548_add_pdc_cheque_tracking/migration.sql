-- AlterTable
ALTER TABLE `payments_ap` ADD COLUMN `checkDate` DATE NULL,
    ADD COLUMN `clearingStatus` ENUM('OUTSTANDING', 'CLEARED', 'BOUNCED', 'CANCELLED') NULL;

-- CreateIndex
CREATE INDEX `payments_ap_clearingStatus_idx` ON `payments_ap`(`clearingStatus`);
