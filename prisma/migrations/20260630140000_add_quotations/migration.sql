-- CreateTable
CREATE TABLE `quotations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `quotationNo` VARCHAR(30) NOT NULL,
    `customerId` INTEGER NOT NULL,
    `quotationDate` DATE NOT NULL,
    `validUntil` DATE NOT NULL,
    `description` TEXT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED') NOT NULL DEFAULT 'DRAFT',
    `convertedInvoiceId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `quotations_quotationNo_key`(`quotationNo`),
    INDEX `quotations_businessId_idx`(`businessId`),
    INDEX `quotations_customerId_idx`(`customerId`),
    INDEX `quotations_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quotation_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1,
    `unitPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'VAT',

    INDEX `quotation_lines_quotationId_idx`(`quotationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `quotations` ADD CONSTRAINT `quotations_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_lines` ADD CONSTRAINT `quotation_lines_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `quotations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotation_lines` ADD CONSTRAINT `quotation_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

