-- CreateTable
CREATE TABLE `expense_vouchers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherNo` VARCHAR(30) NOT NULL,
    `type` ENUM('PETTY_CASH', 'REIMBURSEMENT', 'DIRECT_PAYMENT', 'CASH_ADVANCE', 'LIQUIDATION') NOT NULL DEFAULT 'PETTY_CASH',
    `date` DATE NOT NULL,
    `payee` VARCHAR(150) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `purpose` TEXT NOT NULL,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `receiptNo` VARCHAR(100) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `requestedBy` VARCHAR(100) NULL,
    `approvedBy` VARCHAR(100) NULL,
    `paidDate` DATE NULL,
    `paidBy` VARCHAR(100) NULL,
    `rejectedReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `expense_vouchers_voucherNo_key`(`voucherNo`),
    INDEX `expense_vouchers_date_idx`(`date`),
    INDEX `expense_vouchers_status_idx`(`status`),
    INDEX `expense_vouchers_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_voucher_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `accountId` INTEGER NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `receiptNo` VARCHAR(100) NULL,

    INDEX `expense_voucher_items_voucherId_idx`(`voucherId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `expense_voucher_items` ADD CONSTRAINT `expense_voucher_items_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `expense_vouchers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_voucher_items` ADD CONSTRAINT `expense_voucher_items_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
