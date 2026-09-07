const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT, round2 } = require('../utils/phCompliance');
const { nextDocNumber } = require('../utils/docNumber');
const { buildCashSaleEntry } = require('../utils/cashSale');
const glPost = require('../utils/glPost');

const genSaleNo = async () => {
  const last = await prisma.cashSale.findFirst({
    orderBy: { id: 'desc' },
    select: { saleNo: true },
  });
  return nextDocNumber('CS-', last?.saleNo);
};

// ─── List ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, search, from, to, page = 1, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [
      { saleNo:      { contains: search } },
      { buyerName:   { contains: search } },
      { description: { contains: search } },
    ];
    if (from || to) where.saleDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [rows, total] = await Promise.all([
      prisma.cashSale.findMany({
        where,
        include: { account: { select: { accountCode: true, accountName: true } }, items: true },
        orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.cashSale.count({ where }),
    ]);
    res.json({ data: rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get one ─────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const sale = await prisma.cashSale.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: { account: true, journalEntry: { include: { lines: true } }, items: true },
    });
    if (!sale) throw createError('Cash sale not found', 404);
    res.json(sale);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, accountId, vatCode = 'VAT', paymentMethod, notes, items } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);
    if (!Array.isArray(items) || items.length === 0) throw createError('At least one item is required', 400);
    for (const line of items) {
      if (!line.description || !String(line.description).trim()) throw createError('Every line needs a description', 400);
      if (!Number(line.quantity) || Number(line.quantity) <= 0) throw createError('Every line needs a quantity greater than 0', 400);
      if (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) throw createError('Every line needs a valid unitPrice', 400);
    }

    const seenItemIds = new Set();
    for (const line of items) {
      if (!line.itemId) continue;
      const id = Number(line.itemId);
      if (seenItemIds.has(id)) throw createError('The same inventory item cannot appear on two lines', 400);
      seenItemIds.add(id);
    }

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    // Resolve each line — fetch and stock-check inventory-linked lines up
    // front, outside the transaction, same as the single-item picker did.
    // Lines are NOT aggregated by itemId: the duplicate-itemId guard above
    // already rejects a cart with two lines for the same item, so every
    // line reaching this point is safe to check/deduct independently.
    const resolvedLines = [];
    for (const line of items) {
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      if (line.itemId) {
        const invItem = await prisma.inventoryItem.findFirst({
          where: { id: Number(line.itemId), businessId: req.businessId, isActive: true },
        });
        if (!invItem) throw createError(`Inventory item not found for line "${line.description}"`, 404);
        if (Number(invItem.currentStock) < quantity) {
          throw createError(`Insufficient stock — only ${invItem.currentStock} ${invItem.unit} available for ${invItem.name}`, 400);
        }
        resolvedLines.push({ description: line.description, quantity, unitPrice, item: invItem });
      } else {
        resolvedLines.push({ description: line.description, quantity, unitPrice, item: null });
      }
    }

    const lineAmounts = resolvedLines.map((l) => round2(l.quantity * l.unitPrice));
    const subtotalRaw = round2(lineAmounts.reduce((s, a) => s + a, 0));
    const v = vatCode === 'VAT' ? computeVAT(subtotalRaw) : { base: subtotalRaw, vat: 0 };
    // totalAmount is derived from the two already-rounded parts (not
    // computeVAT's own `total`) so subtotal + vatAmount === totalAmount is
    // guaranteed by construction — same pattern receivableController.js's
    // computeInvoiceTotals uses for invoices.
    const subtotal = v.base;
    const vatAmount = v.vat;
    const totalAmount = round2(subtotal + vatAmount);
    if (totalAmount <= 0) throw createError('Sale total must be greater than 0', 400);
    const saleNo = await genSaleNo();

    const description = resolvedLines.length === 1
      ? resolvedLines[0].description
      : `${resolvedLines[0].description} +${resolvedLines.length - 1} more`;

    const saleData = {
      businessId: req.businessId,
      saleNo,
      saleDate: new Date(saleDate),
      buyerName: buyerName || null,
      description,
      accountId: Number(accountId),
      vatCode,
      subtotal,
      vatAmount,
      totalAmount,
      paymentMethod,
      notes: notes || null,
      createdBy: req.user?.id || null,
    };

    const sale = await prisma.$transaction(async (tx) => {
      const createdSale = await tx.cashSale.create({ data: saleData });

      await tx.cashSaleItem.createMany({
        data: resolvedLines.map((l, i) => ({
          cashSaleId: createdSale.id,
          itemId: l.item?.id || null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          amount: lineAmounts[i],
        })),
      });

      const inventoryLines = resolvedLines.filter((l) => l.item);
      if (inventoryLines.length > 0) {
        const lastTxn = await tx.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
        let txnSeq = lastTxn ? lastTxn.id + 1 : 1;
        for (const l of inventoryLines) {
          const newStock = round2(Number(l.item.currentStock) - l.quantity);
          const unitCost = Number(l.item.costPrice);
          const totalCost = round2(l.quantity * unitCost);
          await tx.inventoryItem.update({ where: { id: l.item.id }, data: { currentStock: newStock } });
          await tx.inventoryTransaction.create({
            data: {
              txnNo: `INV-TXN-${String(txnSeq++).padStart(6, '0')}`,
              itemId: l.item.id,
              type: 'OUT',
              quantity: l.quantity,
              unitCost,
              totalCost,
              runningStock: newStock,
              reference: createdSale.saleNo,
              notes: `Cash sale — ${createdSale.saleNo}`,
              txnDate: new Date(saleDate),
            },
          });
          l.totalCost = totalCost; // stashed on the same object for the post-commit COGS entry below
        }
      }

      return createdSale;
    });

    const { lines } = buildCashSaleEntry({
      saleNo, accountId: Number(accountId),
      subtotal, vatAmount, totalAmount, paymentMethod,
    });
    const entry = await glPost.safePost({
      entryDate: sale.saleDate,
      description: `Cash Sale — ${buyerName || 'Walk-in'} (${saleNo})`,
      reference: saleNo,
      lines,
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    if (entry) {
      await prisma.cashSale.update({ where: { id: sale.id }, data: { journalEntryId: entry.id } });
    }

    const inventoryLines = resolvedLines.filter((l) => l.item && l.totalCost > 0);
    if (inventoryLines.length > 0) {
      const cogsLines = inventoryLines.flatMap((l) => ([
        l.item.cogsAccountId
          ? { accountId: l.item.cogsAccountId, debit: l.totalCost, description: `COGS — ${l.item.sku} ×${l.quantity}` }
          : { accountCode: '5010', debit: l.totalCost, description: `COGS — ${l.item.sku} ×${l.quantity}` },
        l.item.inventoryAccountId
          ? { accountId: l.item.inventoryAccountId, credit: l.totalCost, description: `Inventory out — ${l.item.name}` }
          : { accountCode: '1210', credit: l.totalCost, description: `Inventory out — ${l.item.name}` },
      ]));
      await glPost.safePost({
        entryDate: sale.saleDate,
        description: `Inventory OUT — ${saleNo}`,
        reference: saleNo,
        lines: cogsLines,
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });
    }

    res.status(201).json({ ...sale, journalEntryId: entry?.id || null, posted: !!entry?.id });
  } catch (err) { next(err); }
};

// ─── Void ────────────────────────────────────────────────────────
exports.voidSale = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const sale = await prisma.cashSale.findFirst({ where: { id, businessId: req.businessId } });
    if (!sale) throw createError('Cash sale not found', 404);
    if (sale.status === 'VOID') throw createError('Cash sale is already voided', 400);

    const outTxns = await prisma.inventoryTransaction.findMany({
      where: { reference: sale.saleNo, type: 'OUT', item: { businessId: req.businessId } },
    });
    const reversals = [];
    for (const outTxn of outTxns) {
      const item = await prisma.inventoryItem.findFirst({ where: { id: outTxn.itemId, businessId: req.businessId } });
      if (item) reversals.push({ outTxn, item });
    }

    const dupeCheck = new Set();
    for (const { item } of reversals) {
      if (dupeCheck.has(item.id)) throw createError('Cannot void: this sale has more than one inventory movement for the same item — investigate manually', 400);
      dupeCheck.add(item.id);
    }

    await prisma.$transaction(async (tx) => {
      await tx.cashSale.update({
        where: { id },
        data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
      });
      if (sale.journalEntryId) {
        await tx.journalEntry.update({ where: { id: sale.journalEntryId }, data: { status: 'VOIDED' } });
      }
      if (reversals.length > 0) {
        const lastTxn = await tx.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
        let txnSeq = lastTxn ? lastTxn.id + 1 : 1;
        for (const { outTxn, item } of reversals) {
          const newStock = round2(Number(item.currentStock) + Number(outTxn.quantity));
          await tx.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } });
          await tx.inventoryTransaction.create({
            data: {
              txnNo: `INV-TXN-${String(txnSeq++).padStart(6, '0')}`,
              itemId: item.id,
              type: 'RETURN_IN',
              quantity: outTxn.quantity,
              unitCost: outTxn.unitCost,
              totalCost: outTxn.totalCost,
              runningStock: newStock,
              reference: sale.saleNo,
              notes: `Void reversal — ${sale.saleNo}`,
              txnDate: new Date(),
            },
          });
        }
      }
    });

    if (reversals.length > 0) {
      const cogsLines = reversals.flatMap(({ outTxn, item }) => {
        const totalCost = Number(outTxn.totalCost);
        if (totalCost <= 0) return [];
        return [
          item.inventoryAccountId
            ? { accountId: item.inventoryAccountId, debit: totalCost, description: `Inventory in — ${item.name} (void)` }
            : { accountCode: '1210', debit: totalCost, description: `Inventory in — ${item.name} (void)` },
          item.cogsAccountId
            ? { accountId: item.cogsAccountId, credit: totalCost, description: `COGS reversal — ${item.sku} (void)` }
            : { accountCode: '5010', credit: totalCost, description: `COGS reversal — ${item.sku} (void)` },
        ];
      });
      if (cogsLines.length > 0) {
        await glPost.safePost({
          entryDate: new Date(),
          description: `Cash sale void — ${sale.saleNo}`,
          reference: sale.saleNo,
          lines: cogsLines,
          userId: req.user?.id || 1,
          businessId: req.businessId,
        });
      }
    }

    res.json({ message: `Cash sale ${sale.saleNo} voided` });
  } catch (err) { next(err); }
};
