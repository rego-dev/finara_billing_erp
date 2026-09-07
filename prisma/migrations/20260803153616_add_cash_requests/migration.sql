-- AlterTable
ALTER TABLE `expense_vouchers` ADD COLUMN `cashRequestId` INTEGER NULL;

-- CreateTable
CREATE TABLE `cash_requests` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `requestNo` VARCHAR(30) NOT NULL,
    `requestDate` DATE NOT NULL,
    `neededDate` DATE NULL,
    `requestedFor` VARCHAR(100) NOT NULL,
    `purpose` TEXT NOT NULL,
    `requestedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `releasedAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `cashAccountCode` VARCHAR(10) NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'LIQUIDATED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `requestedBy` VARCHAR(100) NULL,
    `approvedBy` VARCHAR(100) NULL,
    `releasedBy` VARCHAR(100) NULL,
    `releasedDate` DATE NULL,
    `rejectedReason` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_requests_requestNo_key`(`requestNo`),
    INDEX `cash_requests_businessId_idx`(`businessId`),
    INDEX `cash_requests_status_idx`(`status`),
    INDEX `cash_requests_requestDate_idx`(`requestDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cash_request_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(15, 3) NULL,
    `estimatedCost` DECIMAL(15, 2) NOT NULL,
    `accountId` INTEGER NULL,

    INDEX `cash_request_items_requestId_idx`(`requestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `expense_vouchers_cashRequestId_key` ON `expense_vouchers`(`cashRequestId`);

-- AddForeignKey
ALTER TABLE `expense_vouchers` ADD CONSTRAINT `expense_vouchers_cashRequestId_fkey` FOREIGN KEY (`cashRequestId`) REFERENCES `cash_requests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_request_items` ADD CONSTRAINT `cash_request_items_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `cash_requests`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_request_items` ADD CONSTRAINT `cash_request_items_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

