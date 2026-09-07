-- CreateTable
CREATE TABLE `remittance_periods` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_1601C') NOT NULL,
    `periodMonth` INTEGER NOT NULL,
    `periodYear` INTEGER NOT NULL,
    `dueDate` DATE NOT NULL,
    `totalEmployeeShare` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalEmployerShare` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalAmount` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `status` ENUM('DRAFT', 'FILED', 'PAID', 'OVERDUE') NOT NULL DEFAULT 'DRAFT',
    `referenceNo` VARCHAR(100) NULL,
    `filedDate` DATE NULL,
    `paidDate` DATE NULL,
    `paidAmount` DECIMAL(15, 2) NULL,
    `penalty` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `isManual` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `remittance_periods_type_periodMonth_periodYear_key`(`type`, `periodMonth`, `periodYear`),
    INDEX `remittance_periods_status_idx`(`status`),
    INDEX `remittance_periods_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `remittance_details` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `remittancePeriodId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `employeeShare` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `employerShare` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalContribution` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `grossCompensation` DECIMAL(15, 2) NULL,

    UNIQUE INDEX `remittance_details_remittancePeriodId_employeeId_key`(`remittancePeriodId`, `employeeId`),
    INDEX `remittance_details_remittancePeriodId_idx`(`remittancePeriodId`),
    INDEX `remittance_details_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `remittance_details` ADD CONSTRAINT `remittance_details_remittancePeriodId_fkey` FOREIGN KEY (`remittancePeriodId`) REFERENCES `remittance_periods`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `remittance_details` ADD CONSTRAINT `remittance_details_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
