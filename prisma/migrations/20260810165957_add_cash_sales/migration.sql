-- CreateTable
CREATE TABLE `cash_sales` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `saleNo` VARCHAR(30) NOT NULL,
    `saleDate` DATE NOT NULL,
    `buyerName` VARCHAR(150) NULL,
    `description` TEXT NOT NULL,
    `accountId` INTEGER NOT NULL,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'VAT',
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paymentMethod` VARCHAR(30) NOT NULL,
    `status` ENUM('ACTIVE', 'VOID') NOT NULL DEFAULT 'ACTIVE',
    `voidedReason` TEXT NULL,
    `voidedAt` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `journalEntryId` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_sales_saleNo_key`(`saleNo`),
    UNIQUE INDEX `cash_sales_journalEntryId_key`(`journalEntryId`),
    INDEX `cash_sales_businessId_idx`(`businessId`),
    INDEX `cash_sales_saleDate_idx`(`saleDate`),
    INDEX `cash_sales_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_sales` ADD CONSTRAINT `cash_sales_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_sales` ADD CONSTRAINT `cash_sales_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
