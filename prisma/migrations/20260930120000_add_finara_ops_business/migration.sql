-- ═══════════════════════════════════════════════════════════════
-- Migration: Finara Operations business (internal SaaS revenue book)
-- Subscription/renewal payments Finara collects from customers post here,
-- via server/utils/subscriptionGL.js — never into a customer's own business.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO `businesses` (`code`, `name`, `industry`, `isActive`, `createdAt`, `updatedAt`)
VALUES ('FINARA-OPS', 'Finara Operations', 'Internal', TRUE, NOW(), NOW());

SET @finara_ops_id = LAST_INSERT_ID();

INSERT INTO `accounts` (`businessId`, `accountCode`, `accountName`, `accountType`, `normalBalance`, `isActive`, `createdAt`, `updatedAt`)
VALUES
  (@finara_ops_id, '1010', 'Cash — Subscription Collections', 'ASSET',   'DEBIT',  TRUE, NOW(), NOW()),
  (@finara_ops_id, '4000', 'Subscription Revenue',            'REVENUE', 'CREDIT', TRUE, NOW(), NOW());
