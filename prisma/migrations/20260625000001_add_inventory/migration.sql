-- CreateTable
CREATE TABLE `inventory_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('PRODUCT', 'MATERIAL', 'SUPPLY', 'ASSET') NOT NULL DEFAULT 'PRODUCT',
    `description` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sku` VARCHAR(50) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `categoryId` INTEGER NULL,
    `unit` VARCHAR(20) NOT NULL DEFAULT 'pcs',
    `costPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `sellingPrice` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `currentStock` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `reorderLevel` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `warehouseLocation` VARCHAR(100) NULL,
    `inventoryAccountId` INTEGER NULL,
    `cogsAccountId` INTEGER NULL,
    `revenueAccountId` INTEGER NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `inventory_items_sku_key`(`sku`),
    INDEX `inventory_items_sku_idx`(`sku`),
    INDEX `inventory_items_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inventory_transactions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `txnNo` VARCHAR(30) NOT NULL,
    `itemId` INTEGER NOT NULL,
    `type` ENUM('IN', 'OUT', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT') NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `unitCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `totalCost` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `runningStock` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `reference` VARCHAR(100) NULL,
    `notes` TEXT NULL,
    `txnDate` DATE NOT NULL,
    `createdBy` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `inventory_transactions_txnNo_key`(`txnNo`),
    INDEX `inventory_transactions_itemId_idx`(`itemId`),
    INDEX `inventory_transactions_txnDate_idx`(`txnDate`),
    INDEX `inventory_transactions_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `inventory_categories`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_inventoryAccountId_fkey` FOREIGN KEY (`inventoryAccountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_cogsAccountId_fkey` FOREIGN KEY (`cogsAccountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_items` ADD CONSTRAINT `inventory_items_revenueAccountId_fkey` FOREIGN KEY (`revenueAccountId`) REFERENCES `accounts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inventory_transactions` ADD CONSTRAINT `inventory_transactions_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `inventory_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
