-- CreateTable
CREATE TABLE `daily_remittances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATE NOT NULL,
    `totalSales` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `cashReceived` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalExpenses` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `cashDisbursed` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `netCash` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCollected` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
    `preparedBy` VARCHAR(100) NULL,
    `approvedBy` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_remittances_date_key`(`date`),
    INDEX `daily_remittances_status_idx`(`status`),
    INDEX `daily_remittances_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_remittance_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dailyRemittanceId` INTEGER NOT NULL,
    `category` VARCHAR(30) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `description` VARCHAR(255) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `meta` TEXT NULL,

    INDEX `daily_remittance_items_dailyRemittanceId_idx`(`dailyRemittanceId`),
    INDEX `daily_remittance_items_category_idx`(`category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `daily_remittance_items` ADD CONSTRAINT `daily_remittance_items_dailyRemittanceId_fkey` FOREIGN KEY (`dailyRemittanceId`) REFERENCES `daily_remittances`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
