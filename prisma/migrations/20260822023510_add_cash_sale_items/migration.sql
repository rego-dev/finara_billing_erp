-- CreateTable
CREATE TABLE `cash_sale_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cashSaleId` INTEGER NOT NULL,
    `itemId` INTEGER NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 1,
    `unitPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `amount` DECIMAL(15, 2) NOT NULL DEFAULT 0,

    INDEX `cash_sale_items_cashSaleId_idx`(`cashSaleId`),
    INDEX `cash_sale_items_itemId_idx`(`itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `cash_sale_items` ADD CONSTRAINT `cash_sale_items_cashSaleId_fkey` FOREIGN KEY (`cashSaleId`) REFERENCES `cash_sales`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_sale_items` ADD CONSTRAINT `cash_sale_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
