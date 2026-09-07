-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(150) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `role` ENUM('ADMIN', 'MANAGER', 'ACCOUNTANT', 'VIEWER') NOT NULL DEFAULT 'ACCOUNTANT',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountCode` VARCHAR(20) NOT NULL,
    `accountName` VARCHAR(150) NOT NULL,
    `accountType` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
    `normalBalance` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `parentId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_accountCode_key`(`accountCode`),
    INDEX `accounts_accountCode_idx`(`accountCode`),
    INDEX `accounts_accountType_idx`(`accountType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryNo` VARCHAR(30) NOT NULL,
    `entryDate` DATE NOT NULL,
    `reference` VARCHAR(100) NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'POSTED', 'VOIDED') NOT NULL DEFAULT 'DRAFT',
    `createdBy` INTEGER NOT NULL,
    `postedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `journal_entries_entryNo_key`(`entryNo`),
    INDEX `journal_entries_entryDate_idx`(`entryDate`),
    INDEX `journal_entries_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `entryId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `debit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `credit` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `description` VARCHAR(255) NULL,
    `lineOrder` INTEGER NOT NULL DEFAULT 0,

    INDEX `journal_lines_entryId_idx`(`entryId`),
    INDEX `journal_lines_accountId_idx`(`accountId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `vendors` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `vendorCode` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `tin` VARCHAR(20) NULL,
    `address` TEXT NULL,
    `contactName` VARCHAR(100) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `vendors_vendorCode_key`(`vendorCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bills` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billNo` VARCHAR(30) NOT NULL,
    `vendorId` INTEGER NOT NULL,
    `billDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `description` TEXT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `bills_billNo_key`(`billNo`),
    INDEX `bills_vendorId_idx`(`vendorId`),
    INDEX `bills_status_idx`(`status`),
    INDEX `bills_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bill_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1,
    `unitPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'VAT',

    INDEX `bill_lines_billId_idx`(`billId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments_ap` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentNo` VARCHAR(30) NOT NULL,
    `billId` INTEGER NOT NULL,
    `paymentDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paymentMethod` VARCHAR(50) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_ap_paymentNo_key`(`paymentNo`),
    INDEX `payments_ap_billId_idx`(`billId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerCode` VARCHAR(20) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `tin` VARCHAR(20) NULL,
    `address` TEXT NULL,
    `contactName` VARCHAR(100) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `customers_customerCode_key`(`customerCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceNo` VARCHAR(30) NOT NULL,
    `customerId` INTEGER NOT NULL,
    `invoiceDate` DATE NOT NULL,
    `dueDate` DATE NOT NULL,
    `description` TEXT NULL,
    `subtotal` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `paidAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invoices_invoiceNo_key`(`invoiceNo`),
    INDEX `invoices_customerId_idx`(`customerId`),
    INDEX `invoices_status_idx`(`status`),
    INDEX `invoices_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoice_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `accountId` INTEGER NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL DEFAULT 1,
    `unitPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `vatCode` ENUM('VAT', 'EXEMPT', 'ZERO') NOT NULL DEFAULT 'VAT',

    INDEX `invoice_lines_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payments_ar` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentNo` VARCHAR(30) NOT NULL,
    `invoiceId` INTEGER NOT NULL,
    `paymentDate` DATE NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `paymentMethod` VARCHAR(50) NOT NULL,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payments_ar_paymentNo_key`(`paymentNo`),
    INDEX `payments_ar_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `employeeNo` VARCHAR(20) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `middleName` VARCHAR(80) NULL,
    `position` VARCHAR(100) NULL,
    `department` VARCHAR(100) NULL,
    `tin` VARCHAR(20) NULL,
    `sssNo` VARCHAR(20) NULL,
    `philhealthNo` VARCHAR(20) NULL,
    `pagibigNo` VARCHAR(20) NULL,
    `hireDate` DATE NOT NULL,
    `employmentType` ENUM('REGULAR', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME') NOT NULL DEFAULT 'REGULAR',
    `payFrequency` ENUM('WEEKLY', 'SEMI_MONTHLY', 'MONTHLY') NOT NULL DEFAULT 'SEMI_MONTHLY',
    `basicSalary` DECIMAL(15, 2) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_employeeNo_key`(`employeeNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_periods` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `periodName` VARCHAR(80) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `payDate` DATE NOT NULL,
    `status` ENUM('OPEN', 'COMPUTED', 'APPROVED', 'PAID') NOT NULL DEFAULT 'OPEN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payroll_periods_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `periodId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `basicPay` DECIMAL(15, 2) NOT NULL,
    `allowances` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `overtimePay` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grossPay` DECIMAL(15, 2) NOT NULL,
    `sssEmployee` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `sssEmployer` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `philhealthEe` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `philhealthEr` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `pagibigEe` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `pagibigEr` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `withholdingTax` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalDeductions` DECIMAL(15, 2) NOT NULL,
    `netPay` DECIMAL(15, 2) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `payroll_items_periodId_idx`(`periodId`),
    INDEX `payroll_items_employeeId_idx`(`employeeId`),
    UNIQUE INDEX `payroll_items_periodId_employeeId_key`(`periodId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `journal_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bills` ADD CONSTRAINT `bills_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_lines` ADD CONSTRAINT `bill_lines_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `bills`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bill_lines` ADD CONSTRAINT `bill_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments_ap` ADD CONSTRAINT `payments_ap_billId_fkey` FOREIGN KEY (`billId`) REFERENCES `bills`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payments_ar` ADD CONSTRAINT `payments_ar_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_periodId_fkey` FOREIGN KEY (`periodId`) REFERENCES `payroll_periods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_items` ADD CONSTRAINT `payroll_items_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
