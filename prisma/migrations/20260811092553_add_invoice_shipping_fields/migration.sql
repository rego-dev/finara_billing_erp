-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `courier` VARCHAR(100) NULL,
    ADD COLUMN `deliveryStatus` ENUM('PENDING', 'SHIPPED') NOT NULL DEFAULT 'PENDING',
    ADD COLUMN `shippedDate` DATE NULL,
    ADD COLUMN `shippingAddress` TEXT NULL,
    ADD COLUMN `trackingNumber` VARCHAR(100) NULL;
