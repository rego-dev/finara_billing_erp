-- CreateTable
CREATE TABLE `attachments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entity` VARCHAR(60) NOT NULL,
    `entityId` INTEGER NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `originalName` VARCHAR(255) NOT NULL,
    `mimeType` VARCHAR(120) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploadedBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attachments_entity_entityId_idx`(`entity`, `entityId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poNumber` VARCHAR(30) NOT NULL,
    `vendorId` INTEGER NOT NULL,
    `orderDate` DATE NOT NULL,
    `expectedDate` DATE NULL,
    `status` ENUM('DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'BILLED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `taxAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `billId` INTEGER NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `purchase_orders_poNumber_key`(`poNumber`),
    INDEX `purchase_orders_vendorId_idx`(`vendorId`),
    INDEX `purchase_orders_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `purchase_order_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(15, 2) NOT NULL,
    `unitPrice` DECIMAL(15, 2) NOT NULL,
    `receivedQty` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL,
    `accountId` INTEGER NULL,
    `lineOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `purchase_order_lines_poId_idx`(`poId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fixed_assets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetCode` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `category` VARCHAR(80) NULL,
    `acquisitionDate` DATE NOT NULL,
    `cost` DECIMAL(15, 2) NOT NULL,
    `salvageValue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `usefulLifeMonths` INTEGER NOT NULL,
    `method` ENUM('STRAIGHT_LINE', 'DECLINING_BALANCE') NOT NULL DEFAULT 'STRAIGHT_LINE',
    `decliningRate` DECIMAL(7, 4) NULL,
    `accumulatedDepreciation` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `bookValue` DECIMAL(15, 2) NOT NULL,
    `status` ENUM('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED') NOT NULL DEFAULT 'ACTIVE',
    `assetAccountId` INTEGER NULL,
    `depreciationExpenseAccountId` INTEGER NULL,
    `accumulatedDepreciationAccountId` INTEGER NULL,
    `disposalDate` DATE NULL,
    `disposalAmount` DECIMAL(15, 2) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `fixed_assets_assetCode_key`(`assetCode`),
    INDEX `fixed_assets_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `depreciation_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `assetId` INTEGER NOT NULL,
    `periodDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `bookValueAfter` DECIMAL(15, 2) NOT NULL,
    `journalEntryId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `depreciation_entries_assetId_periodDate_key`(`assetId`, `periodDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `bankName` VARCHAR(120) NULL,
    `accountNumber` VARCHAR(60) NULL,
    `glAccountId` INTEGER NULL,
    `currentBalance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_reconciliations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bankAccountId` INTEGER NOT NULL,
    `statementDate` DATE NOT NULL,
    `statementBalance` DECIMAL(15, 2) NOT NULL,
    `reconciledBalance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `notes` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `bank_reconciliations_bankAccountId_idx`(`bankAccountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bank_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `bankAccountId` INTEGER NOT NULL,
    `reconciliationId` INTEGER NULL,
    `txnDate` DATE NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `reference` VARCHAR(80) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `type` VARCHAR(12) NOT NULL,
    `isReconciled` BOOLEAN NOT NULL DEFAULT false,
    `journalEntryId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `bank_transactions_bankAccountId_idx`(`bankAccountId`),
    INDEX `bank_transactions_reconciliationId_idx`(`reconciliationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budgets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `fiscalYear` INTEGER NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    `notes` TEXT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `budgets_name_fiscalYear_key`(`name`, `fiscalYear`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `budgetId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `annualAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    UNIQUE INDEX `budget_lines_budgetId_accountId_key`(`budgetId`, `accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recurring_templates` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `type` VARCHAR(20) NOT NULL DEFAULT 'JOURNAL',
    `frequency` ENUM('WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY') NOT NULL DEFAULT 'MONTHLY',
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `nextRunDate` DATE NOT NULL,
    `lastRunDate` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` VARCHAR(255) NULL,
    `reference` VARCHAR(80) NULL,
    `payload` JSON NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `recurring_templates_isActive_nextRunDate_idx`(`isActive`, `nextRunDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchase_order_lines` ADD CONSTRAINT `purchase_order_lines_poId_fkey` FOREIGN KEY (`poId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `depreciation_entries` ADD CONSTRAINT `depreciation_entries_assetId_fkey` FOREIGN KEY (`assetId`) REFERENCES `fixed_assets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_reconciliations` ADD CONSTRAINT `bank_reconciliations_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `bank_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bank_transactions` ADD CONSTRAINT `bank_transactions_reconciliationId_fkey` FOREIGN KEY (`reconciliationId`) REFERENCES `bank_reconciliations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_lines` ADD CONSTRAINT `budget_lines_budgetId_fkey` FOREIGN KEY (`budgetId`) REFERENCES `budgets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
