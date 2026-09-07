/**
 * backupController.js
 * Module-level selective backup & restore for Finara ERP.
 *
 * Export  → GET  /api/backup/export?modules=payable,receivable
 * Import  → POST /api/backup/import  (multipart: file + modules + reset)
 */

const prisma = require('../config/database');
const multer = require('multer');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');

// ─── Multer (in-memory, max 50 MB) ──────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
exports.uploadMiddleware = upload.single('file');

// ─── Module definitions ──────────────────────────────────────
//
//  exportFilter   : { modelKey → fn(biz) → prisma findMany where }
//                   Used by GET /export — findMany supports nested relation filters.
//
//  insertOrder    : modelKeys in safe INSERT order (parents first)
//
//  deleteSequence : steps executed in order for reset/restore-with-reset.
//    Each step is one of:
//      { model }                      → deleteMany({ where: { businessId: biz } })
//      { model, parentModel, fk }     → fetch parent IDs first, then
//                                       deleteMany({ where: { [fk]: { in: parentIds } } })
//
//  All deletes run inside a single interactive Prisma transaction so that
//  SET FOREIGN_KEY_CHECKS=0 applies to every query on the same connection.
// ─────────────────────────────────────────────────────────────
const MODULE_DEFS = {
  coa: {
    label: 'Chart of Accounts',
    exportFilter: {
      account: (biz) => ({ businessId: biz }),
    },
    insertOrder:    ['account'],
    deleteSequence: [
      { model: 'account' },
    ],
  },

  journal: {
    label: 'General Ledger',
    exportFilter: {
      journalEntry: (biz) => ({ businessId: biz }),
      journalLine:  (biz) => ({ entry: { businessId: biz } }),
    },
    insertOrder:    ['journalEntry', 'journalLine'],
    deleteSequence: [
      { model: 'journalLine',  parentModel: 'journalEntry', fk: 'entryId' },
      { model: 'journalEntry' },
    ],
  },

  payable: {
    label: 'Accounts Payable',
    exportFilter: {
      vendor:    (biz) => ({ businessId: biz }),
      bill:      (biz) => ({ businessId: biz }),
      billLine:  (biz) => ({ bill: { businessId: biz } }),
      paymentAP: (biz) => ({ bill: { businessId: biz } }),
    },
    insertOrder:    ['vendor', 'bill', 'billLine', 'paymentAP'],
    deleteSequence: [
      { model: 'paymentAP', parentModel: 'bill', fk: 'billId' },
      { model: 'billLine',  parentModel: 'bill', fk: 'billId' },
      { model: 'bill' },
      { model: 'vendor' },
    ],
  },

  receivable: {
    label: 'Accounts Receivable',
    exportFilter: {
      customer:    (biz) => ({ businessId: biz }),
      invoice:     (biz) => ({ businessId: biz }),
      invoiceLine: (biz) => ({ invoice: { businessId: biz } }),
      paymentAR:   (biz) => ({ invoice: { businessId: biz } }),
    },
    insertOrder:    ['customer', 'invoice', 'invoiceLine', 'paymentAR'],
    deleteSequence: [
      { model: 'paymentAR',   parentModel: 'invoice', fk: 'invoiceId' },
      { model: 'invoiceLine', parentModel: 'invoice', fk: 'invoiceId' },
      { model: 'invoice' },
      { model: 'customer' },
    ],
  },

  payroll: {
    label: 'Payroll',
    exportFilter: {
      employee:      (biz) => ({ businessId: biz }),
      payrollPeriod: (biz) => ({ businessId: biz }),
      payrollItem:   (biz) => ({ period: { businessId: biz } }),
    },
    insertOrder:    ['employee', 'payrollPeriod', 'payrollItem'],
    deleteSequence: [
      { model: 'payrollItem', parentModel: 'payrollPeriod', fk: 'periodId' },
      { model: 'payrollPeriod' },
      { model: 'employee' },
    ],
  },

  remittance: {
    label: "Gov't Remittances",
    exportFilter: {
      remittancePeriod: (biz) => ({ businessId: biz }),
      remittanceDetail: (biz) => ({ remittancePeriod: { businessId: biz } }),
    },
    insertOrder:    ['remittancePeriod', 'remittanceDetail'],
    deleteSequence: [
      { model: 'remittanceDetail', parentModel: 'remittancePeriod', fk: 'remittancePeriodId' },
      { model: 'remittancePeriod' },
    ],
  },

  inventory: {
    label: 'Inventory',
    exportFilter: {
      inventoryCategory:    (biz) => ({ businessId: biz }),
      inventoryItem:        (biz) => ({ businessId: biz }),
      inventoryTransaction: (biz) => ({ businessId: biz }),
    },
    insertOrder:    ['inventoryCategory', 'inventoryItem', 'inventoryTransaction'],
    deleteSequence: [
      { model: 'inventoryTransaction' },
      { model: 'inventoryItem' },
      { model: 'inventoryCategory' },
    ],
  },

  expenses: {
    label: 'Expense Vouchers',
    exportFilter: {
      expenseVoucher:     (biz) => ({ businessId: biz }),
      expenseVoucherItem: (biz) => ({ expenseVoucher: { businessId: biz } }),
    },
    insertOrder:    ['expenseVoucher', 'expenseVoucherItem'],
    deleteSequence: [
      { model: 'expenseVoucherItem', parentModel: 'expenseVoucher', fk: 'voucherId' },
      { model: 'expenseVoucher' },
    ],
  },

  daily: {
    label: 'Daily Remittance',
    exportFilter: {
      dailyRemittance:     (biz) => ({ businessId: biz }),
      dailyRemittanceItem: (biz) => ({ dailyRemittance: { businessId: biz } }),
    },
    insertOrder:    ['dailyRemittance', 'dailyRemittanceItem'],
    deleteSequence: [
      { model: 'dailyRemittanceItem', parentModel: 'dailyRemittance', fk: 'dailyRemittanceId' },
      { model: 'dailyRemittance' },
    ],
  },

  bank: {
    label: 'Bank & Reconciliation',
    exportFilter: {
      bankAccount:        (biz) => ({ businessId: biz }),
      bankReconciliation: (biz) => ({ bankAccount: { businessId: biz } }),
      bankTransaction:    (biz) => ({ bankAccount: { businessId: biz } }),
    },
    insertOrder:    ['bankAccount', 'bankReconciliation', 'bankTransaction'],
    deleteSequence: [
      { model: 'bankTransaction',    parentModel: 'bankAccount', fk: 'bankAccountId' },
      { model: 'bankReconciliation', parentModel: 'bankAccount', fk: 'bankAccountId' },
      { model: 'bankAccount' },
    ],
  },

  purchase: {
    label: 'Purchase Orders',
    exportFilter: {
      purchaseOrder:     (biz) => ({ businessId: biz }),
      purchaseOrderLine: (biz) => ({ purchaseOrder: { businessId: biz } }),
    },
    insertOrder:    ['purchaseOrder', 'purchaseOrderLine'],
    deleteSequence: [
      { model: 'purchaseOrderLine', parentModel: 'purchaseOrder', fk: 'poId' },
      { model: 'purchaseOrder' },
    ],
  },

  assets: {
    label: 'Fixed Assets',
    exportFilter: {
      fixedAsset:        (biz) => ({ businessId: biz }),
      depreciationEntry: (biz) => ({ asset: { businessId: biz } }),
    },
    insertOrder:    ['fixedAsset', 'depreciationEntry'],
    deleteSequence: [
      { model: 'depreciationEntry', parentModel: 'fixedAsset', fk: 'assetId' },
      { model: 'fixedAsset' },
    ],
  },
};

// ─── Helpers ─────────────────────────────────────────────────

/** Serialize Prisma rows to plain JSON (handles Decimal → string, Date → ISO) */
function serializeRows(rows) {
  return JSON.parse(JSON.stringify(rows, (_, v) =>
    typeof v === 'object' && v !== null && typeof v.toFixed === 'function'
      ? v.toFixed(2)   // Prisma Decimal
      : v
  ));
}

/** Count total rows across all exported models */
function countRows(data) {
  return Object.values(data).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
}

/**
 * Delete all data for the given modules within a single Prisma transaction.
 * Uses SET FOREIGN_KEY_CHECKS=0 so delete order only needs to be FK-safe
 * within a single module; cross-module FK edges (e.g. vendor ↔ purchaseOrder)
 * won't block the delete.
 *
 * Each deleteSequence step:
 *   { model }                   → deleteMany({ where: { businessId: biz } })
 *   { model, parentModel, fk }  → fetch parent IDs first, then deleteMany by FK
 */
async function deleteModules(mods, biz) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');

      // Cache parent IDs within this transaction so we don't re-query
      const idCache = {};

      for (const mod of mods) {
        const def = MODULE_DEFS[mod];
        for (const step of def.deleteSequence) {
          if (step.parentModel) {
            // Two-step: fetch parent IDs (use businessId direct filter), then delete children
            const cacheKey = `${mod}:${step.parentModel}`;
            if (!idCache[cacheKey]) {
              const rows = await tx[step.parentModel].findMany({
                where: { businessId: biz },
                select: { id: true },
              });
              idCache[cacheKey] = rows.map((r) => r.id);
            }
            const ids = idCache[cacheKey];
            if (ids.length > 0) {
              await tx[step.model].deleteMany({
                where: { [step.fk]: { in: ids } },
              });
            }
          } else {
            // Direct businessId delete
            await tx[step.model].deleteMany({ where: { businessId: biz } });
          }
        }
      }

      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
    },
    { timeout: 60000 }  // 60 s for large datasets
  );
}

// ─── Export ──────────────────────────────────────────────────
exports.exportData = async (req, res, next) => {
  try {
    const requestedMods = (req.query.modules || '').split(',').map((m) => m.trim()).filter(Boolean);
    if (!requestedMods.length) throw createError('No modules specified', 400);

    const invalidMods = requestedMods.filter((m) => !MODULE_DEFS[m]);
    if (invalidMods.length) throw createError(`Unknown modules: ${invalidMods.join(', ')}`, 400);

    const biz = req.businessId;
    const data = {};

    for (const mod of requestedMods) {
      const def = MODULE_DEFS[mod];
      for (const [modelKey, filterFn] of Object.entries(def.exportFilter)) {
        const rows = await prisma[modelKey].findMany({ where: filterFn(biz) });
        data[modelKey] = serializeRows(rows);
      }
    }

    const payload = {
      version:    'finara-1.0',
      exportedAt: new Date().toISOString(),
      businessId: biz,
      modules:    requestedMods,
      rowCount:   countRows(data),
      data,
    };

    const stamp = new Date().toISOString().slice(0, 10);
    const slug  = requestedMods.join('-');

    await recordAudit({
      req,
      action:   'EXPORT',
      entity:   'Backup',
      entityId: slug,
      summary:  `Exported modules: ${requestedMods.join(', ')} (${payload.rowCount} rows)`,
    });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="finara-backup-${slug}-${stamp}.json"`);
    res.json(payload);
  } catch (err) { next(err); }
};

// ─── Import ──────────────────────────────────────────────────
exports.importData = async (req, res, next) => {
  try {
    if (!req.file) throw createError('No backup file uploaded', 400);

    let payload;
    try {
      payload = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      throw createError('Invalid JSON file', 400);
    }

    if (!payload.version?.startsWith('finara')) {
      throw createError('Not a valid Finara backup file', 400);
    }

    const requestedMods = (req.body.modules || '').split(',').map((m) => m.trim()).filter(Boolean);
    if (!requestedMods.length) throw createError('No modules selected for restore', 400);

    const missing = requestedMods.filter((m) => !payload.modules.includes(m));
    if (missing.length) throw createError(`Modules not in backup file: ${missing.join(', ')}`, 400);

    const doReset = req.body.reset === 'true';
    const biz     = req.businessId;
    let   restored = 0;

    // Delete existing records if reset mode, then insert
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0');

        if (doReset) {
          const idCache = {};
          for (const mod of requestedMods) {
            const def = MODULE_DEFS[mod];
            for (const step of def.deleteSequence) {
              if (step.parentModel) {
                const cacheKey = `${mod}:${step.parentModel}`;
                if (!idCache[cacheKey]) {
                  const rows = await tx[step.parentModel].findMany({
                    where: { businessId: biz },
                    select: { id: true },
                  });
                  idCache[cacheKey] = rows.map((r) => r.id);
                }
                const ids = idCache[cacheKey];
                if (ids.length > 0) {
                  await tx[step.model].deleteMany({ where: { [step.fk]: { in: ids } } });
                }
              } else {
                await tx[step.model].deleteMany({ where: { businessId: biz } });
              }
            }
          }
        }

        // Insert
        for (const mod of requestedMods) {
          const def = MODULE_DEFS[mod];
          for (const modelKey of def.insertOrder) {
            const rows = payload.data[modelKey];
            if (!rows?.length) continue;
            const result = await tx[modelKey].createMany({ data: rows, skipDuplicates: true });
            restored += result.count;
          }
        }

        await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1');
      },
      { timeout: 120000 }
    );

    await recordAudit({
      req,
      action:   'IMPORT',
      entity:   'Backup',
      entityId: requestedMods.join('-'),
      summary:  `Restored modules: ${requestedMods.join(', ')} (${restored} rows, reset=${doReset})`,
    });

    res.json({
      message:  `Restore complete — ${restored} records imported`,
      modules:  requestedMods,
      restored,
      reset:    doReset,
    });
  } catch (err) { next(err); }
};

// ─── Module Reset ────────────────────────────────────────────
exports.resetModules = async (req, res, next) => {
  try {
    const { modules: moduleStr, confirmPhrase } = req.body;
    const requestedMods = (moduleStr || '').split(',').map((m) => m.trim()).filter(Boolean);
    if (!requestedMods.length) throw createError('No modules specified', 400);
    if (confirmPhrase !== 'RESET') throw createError('Type RESET to confirm', 400);

    const invalidMods = requestedMods.filter((m) => !MODULE_DEFS[m]);
    if (invalidMods.length) throw createError(`Unknown modules: ${invalidMods.join(', ')}`, 400);

    await deleteModules(requestedMods, req.businessId);

    await recordAudit({
      req,
      action:   'RESET',
      entity:   'Backup',
      entityId: requestedMods.join('-'),
      summary:  `Reset modules: ${requestedMods.join(', ')} for businessId ${req.businessId}`,
    });

    res.json({
      message: `Reset complete — modules cleared: ${requestedMods.join(', ')}`,
      modules: requestedMods,
    });
  } catch (err) { next(err); }
};

// ─── Module list (for frontend) ──────────────────────────────
exports.listModules = (req, res) => {
  res.json(
    Object.entries(MODULE_DEFS).map(([key, def]) => ({
      key,
      label:  def.label,
      models: Object.keys(def.exportFilter),
    }))
  );
};
