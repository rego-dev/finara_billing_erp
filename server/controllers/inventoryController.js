const prisma = require('../config/database');
const glPost = require('../utils/glPost');

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(n, len = 6) { return String(n).padStart(len, '0'); }

// Next sequential SKU (SKU-0001, SKU-0002, …) per business
async function nextSku(businessId) {
  const rows = await prisma.inventoryItem.findMany({
    where: { businessId, sku: { startsWith: 'SKU-' } },
    select: { sku: true },
  });
  let max = 0;
  for (const { sku } of rows) {
    const m = /^SKU-(\d+)$/.exec(sku);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'SKU-' + pad(max + 1, 4);
}

async function nextTxnNo() {
  const last = await prisma.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
  const seq  = last ? last.id + 1 : 1;
  return `INV-TXN-${pad(seq)}`;
}
exports.nextTxnNo = nextTxnNo;

// ── Categories ────────────────────────────────────────────────────────────────
exports.listCategories = async (req, res, next) => {
  try {
    const cats = await prisma.inventoryCategory.findMany({
      where: { businessId: req.businessId, isActive: true },
      include: { _count: { select: { items: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(cats);
  } catch (e) { next(e); }
};

exports.createCategory = async (req, res, next) => {
  const { name, type = 'PRODUCT', description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const cat = await prisma.inventoryCategory.create({ data: { businessId: req.businessId, name, type, description } });
    res.status(201).json(cat);
  } catch (e) { next(e); }
};

exports.updateCategory = async (req, res, next) => {
  const { id } = req.params;
  const { name, type, description, isActive } = req.body;
  try {
    const cat = await prisma.inventoryCategory.update({
      where: { id: Number(id) },
      data: { name, type, description, ...(isActive !== undefined && { isActive }) },
    });
    res.json(cat);
  } catch (e) { next(e); }
};

exports.deleteCategory = async (req, res, next) => {
  const { id } = req.params;
  try {
    await prisma.inventoryCategory.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });
    res.json({ message: 'Category deactivated' });
  } catch (e) { next(e); }
};

// ── Items ─────────────────────────────────────────────────────────────────────
exports.listItems = async (req, res, next) => {
  const { search, categoryId, type, lowStock, isActive } = req.query;
  try {
    const where = { businessId: req.businessId };
    if (isActive !== 'all') where.isActive = isActive === 'false' ? false : true;
    if (search) where.OR = [
      { name:        { contains: search } },
      { sku:         { contains: search } },
      { description: { contains: search } },
    ];
    if (categoryId) where.categoryId = Number(categoryId);
    if (type) where.category = { type };
    if (lowStock === 'true') {
      where.AND = [
        { currentStock: { lte: prisma.inventoryItem.fields.reorderLevel } },
      ];
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        category:          { select: { id: true, name: true, type: true } },
        inventoryAccount:  { select: { id: true, accountCode: true, accountName: true } },
        cogsAccount:       { select: { id: true, accountCode: true, accountName: true } },
        revenueAccount:    { select: { id: true, accountCode: true, accountName: true } },
        _count:            { select: { transactions: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Compute derived fields
    const enriched = items.map((i) => ({
      ...i,
      stockValue: Number(i.currentStock) * Number(i.costPrice),
      isLowStock: Number(i.currentStock) <= Number(i.reorderLevel),
      isOutOfStock: Number(i.currentStock) <= 0,
    }));

    res.json(enriched);
  } catch (e) { next(e); }
};

exports.getItem = async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findUniqueOrThrow({
      where: { id: Number(req.params.id) },
      include: {
        category:         { select: { id: true, name: true, type: true } },
        inventoryAccount: { select: { id: true, accountCode: true, accountName: true } },
        cogsAccount:      { select: { id: true, accountCode: true, accountName: true } },
        revenueAccount:   { select: { id: true, accountCode: true, accountName: true } },
        transactions:     { orderBy: { txnDate: 'desc' }, take: 20 },
      },
    });
    res.json({
      ...item,
      stockValue:   Number(item.currentStock) * Number(item.costPrice),
      isLowStock:   Number(item.currentStock) <= Number(item.reorderLevel),
      isOutOfStock: Number(item.currentStock) <= 0,
    });
  } catch (e) { next(e); }
};

exports.createItem = async (req, res, next) => {
  const {
    sku, name, description, categoryId,
    unit = 'pcs', costPrice = 0, sellingPrice = 0,
    reorderLevel = 0, warehouseLocation,
    inventoryAccountId, cogsAccountId, revenueAccountId,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const finalSku = (sku && sku.trim()) ? sku.trim() : await nextSku(req.businessId);
    const item = await prisma.inventoryItem.create({
      data: {
        businessId: req.businessId,
        sku: finalSku, name, description, unit,
        costPrice:    Number(costPrice),
        sellingPrice: Number(sellingPrice),
        reorderLevel: Number(reorderLevel),
        warehouseLocation,
        categoryId:         categoryId        ? Number(categoryId)        : null,
        inventoryAccountId: inventoryAccountId ? Number(inventoryAccountId) : null,
        cogsAccountId:      cogsAccountId      ? Number(cogsAccountId)      : null,
        revenueAccountId:   revenueAccountId   ? Number(revenueAccountId)   : null,
      },
      include: {
        category:         true,
        inventoryAccount: true,
        cogsAccount:      true,
        revenueAccount:   true,
      },
    });
    res.status(201).json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ error: 'SKU already exists' });
    next(e);
  }
};

exports.updateItem = async (req, res, next) => {
  const { id } = req.params;
  const {
    sku, name, description, categoryId,
    unit, costPrice, sellingPrice, reorderLevel, warehouseLocation,
    inventoryAccountId, cogsAccountId, revenueAccountId, isActive,
  } = req.body;
  try {
    const item = await prisma.inventoryItem.update({
      where: { id: Number(id) },
      data: {
        ...(sku             !== undefined && { sku }),
        ...(name            !== undefined && { name }),
        ...(description     !== undefined && { description }),
        ...(unit            !== undefined && { unit }),
        ...(costPrice       !== undefined && { costPrice:    Number(costPrice) }),
        ...(sellingPrice    !== undefined && { sellingPrice: Number(sellingPrice) }),
        ...(reorderLevel    !== undefined && { reorderLevel: Number(reorderLevel) }),
        ...(warehouseLocation !== undefined && { warehouseLocation }),
        ...(isActive        !== undefined && { isActive }),
        categoryId:         categoryId        !== undefined ? (categoryId        ? Number(categoryId)        : null) : undefined,
        inventoryAccountId: inventoryAccountId !== undefined ? (inventoryAccountId ? Number(inventoryAccountId) : null) : undefined,
        cogsAccountId:      cogsAccountId      !== undefined ? (cogsAccountId      ? Number(cogsAccountId)      : null) : undefined,
        revenueAccountId:   revenueAccountId   !== undefined ? (revenueAccountId   ? Number(revenueAccountId)   : null) : undefined,
      },
      include: {
        category:         true,
        inventoryAccount: true,
        cogsAccount:      true,
        revenueAccount:   true,
      },
    });
    res.json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ error: 'SKU already exists' });
    next(e);
  }
};

exports.deleteItem = async (req, res, next) => {
  const { id } = req.params;
  try {
    await prisma.inventoryItem.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });
    res.json({ message: 'Item deactivated' });
  } catch (e) { next(e); }
};

// ── Transactions ──────────────────────────────────────────────────────────────
exports.listTransactions = async (req, res, next) => {
  const { itemId, type, from, to, search, limit = 100, offset = 0 } = req.query;
  try {
    const where = {};
    if (itemId) where.itemId = Number(itemId);
    if (type)   where.type   = type;
    if (from || to) {
      where.txnDate = {};
      if (from) where.txnDate.gte = new Date(from);
      if (to)   where.txnDate.lte = new Date(to);
    }
    if (search) where.OR = [
      { txnNo:    { contains: search } },
      { reference:{ contains: search } },
      { notes:    { contains: search } },
    ];

    const [txns, total] = await prisma.$transaction([
      prisma.inventoryTransaction.findMany({
        where,
        include: { item: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        take:  Number(limit),
        skip:  Number(offset),
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    res.json({ data: txns, total });
  } catch (e) { next(e); }
};

exports.createTransaction = async (req, res, next) => {
  const {
    itemId, type, quantity, unitCost = 0,
    reference, notes, txnDate,
  } = req.body;

  if (!itemId || !type || !quantity)
    return res.status(400).json({ error: 'itemId, type, and quantity are required' });

  const validTypes = ['IN', 'OUT', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT'];
  if (!validTypes.includes(type))
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });

  const qty = Number(quantity);
  if (qty === 0) return res.status(400).json({ error: 'Quantity cannot be zero' });

  try {
    const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: Number(itemId) } });

    // Determine stock delta
    let delta = qty;
    if (['OUT', 'RETURN_OUT'].includes(type)) delta = -qty;
    if (type === 'ADJUSTMENT') delta = qty - Number(item.currentStock); // absolute target

    const newStock   = Number(item.currentStock) + delta;
    const cost       = Number(unitCost);
    const totalCost  = Math.abs(delta) * cost;
    const txnNo      = await nextTxnNo();
    const date       = txnDate ? new Date(txnDate) : new Date();

    const [txn] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          txnNo,
          itemId: Number(itemId),
          type,
          quantity: qty,
          unitCost: cost,
          totalCost,
          runningStock: newStock,
          reference,
          notes,
          txnDate: date,
          createdBy: req.user?.firstName ? `${req.user.firstName} ${req.user.lastName}` : 'System',
        },
        include: { item: { select: { id: true, sku: true, name: true, unit: true } } },
      }),
      prisma.inventoryItem.update({
        where: { id: Number(itemId) },
        data: {
          currentStock: newStock,
          ...(type === 'IN' && cost > 0 && { costPrice: cost }),
        },
      }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    // Only post when there's a cost value (free adjustments with no cost skip GL)
    if (totalCost > 0) {
      if (['IN', 'RETURN_IN'].includes(type)) {
        // Stock received: DR Inventory, CR AP Trade (assume on account) or Cash
        await glPost.safePost({
          entryDate:   date,
          description: `Inventory IN — ${item.name} (${txn.txnNo})`,
          reference:   txn.txnNo,
          lines: [
            { accountCode: '1210', debit:  totalCost, description: `Stock in — ${item.sku} ×${Math.abs(delta)}` },
            { accountCode: '2010', credit: totalCost, description: `Inventory payable — ${item.name}` },
          ],
          userId:     req.user?.id || 1,
          businessId: req.businessId,
        });
      } else if (['OUT', 'RETURN_OUT'].includes(type)) {
        // Stock out / sold: DR COGS, CR Inventory
        await glPost.safePost({
          entryDate:   date,
          description: `Inventory OUT — ${item.name} (${txn.txnNo})`,
          reference:   txn.txnNo,
          lines: [
            { accountCode: '5010', debit:  totalCost, description: `COGS — ${item.sku} ×${Math.abs(delta)}` },
            { accountCode: '1210', credit: totalCost, description: `Inventory out — ${item.name}` },
          ],
          userId:     req.user?.id || 1,
          businessId: req.businessId,
        });
      }
      // ADJUSTMENT type: no GL post (manual balance correction; accountant handles separately)
    }

    res.status(201).json(txn);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    next(e);
  }
};

// ── Reports ───────────────────────────────────────────────────────────────────
exports.stockOnHand = async (req, res, next) => {
  const { categoryId, type } = req.query;
  try {
    const where = { isActive: true };
    if (categoryId) where.categoryId = Number(categoryId);
    if (type) where.category = { type };

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { id: true, name: true, type: true } } },
      orderBy: { name: 'asc' },
    });

    const enriched = items.map((i) => ({
      id:        i.id,
      sku:       i.sku,
      name:      i.name,
      unit:      i.unit,
      category:  i.category,
      costPrice: Number(i.costPrice),
      sellingPrice: Number(i.sellingPrice),
      currentStock: Number(i.currentStock),
      reorderLevel: Number(i.reorderLevel),
      stockValue:   Number(i.currentStock) * Number(i.costPrice),
      isLowStock:   Number(i.currentStock) <= Number(i.reorderLevel),
      isOutOfStock: Number(i.currentStock) <= 0,
    }));

    const summary = {
      totalItems:   enriched.length,
      totalValue:   enriched.reduce((s, i) => s + i.stockValue, 0),
      lowStock:     enriched.filter((i) => i.isLowStock && !i.isOutOfStock).length,
      outOfStock:   enriched.filter((i) => i.isOutOfStock).length,
    };

    res.json({ summary, items: enriched });
  } catch (e) { next(e); }
};

exports.valuationReport = async (req, res, next) => {
  const { categoryId } = req.query;
  try {
    const where = { isActive: true };
    if (categoryId) where.categoryId = Number(categoryId);

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { name: true, type: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });

    // Group by category
    const groups = {};
    for (const i of items) {
      const cat = i.category?.name || 'Uncategorized';
      if (!groups[cat]) groups[cat] = { category: cat, type: i.category?.type, items: [], subtotal: 0 };
      const val = Number(i.currentStock) * Number(i.costPrice);
      groups[cat].items.push({
        sku: i.sku, name: i.name, unit: i.unit,
        qty: Number(i.currentStock), costPrice: Number(i.costPrice), value: val,
      });
      groups[cat].subtotal += val;
    }

    const grandTotal = Object.values(groups).reduce((s, g) => s + g.subtotal, 0);
    res.json({ groups: Object.values(groups), grandTotal });
  } catch (e) { next(e); }
};

exports.lowStockReport = async (req, res, next) => {
  try {
    const items = await prisma.$queryRaw`
      SELECT i.id, i.sku, i.name, i.unit,
             CAST(i.currentStock AS DECIMAL(12,3)) AS currentStock,
             CAST(i.reorderLevel AS DECIMAL(12,3)) AS reorderLevel,
             CAST(i.costPrice    AS DECIMAL(15,2)) AS costPrice,
             c.name AS categoryName, c.type AS categoryType
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.categoryId
      WHERE i.isActive = 1
        AND i.currentStock <= i.reorderLevel
      ORDER BY (i.reorderLevel - i.currentStock) DESC
    `;
    res.json(items);
  } catch (e) { next(e); }
};

exports.movementSummary = async (req, res, next) => {
  const { from, to } = req.query;
  try {
    const where = {};
    if (from || to) {
      where.txnDate = {};
      if (from) where.txnDate.gte = new Date(from);
      if (to)   where.txnDate.lte = new Date(to);
    }

    const txns = await prisma.inventoryTransaction.findMany({
      where,
      include: { item: { select: { sku: true, name: true, unit: true } } },
    });

    // Aggregate per item
    const map = {};
    for (const t of txns) {
      const key = t.itemId;
      if (!map[key]) map[key] = {
        itemId: t.itemId, sku: t.item.sku, name: t.item.name, unit: t.item.unit,
        totalIn: 0, totalOut: 0, totalAdj: 0, totalCostIn: 0, totalCostOut: 0, txnCount: 0,
      };
      const qty = Number(t.quantity);
      const cost = Number(t.totalCost);
      map[key].txnCount++;
      if (['IN', 'RETURN_IN'].includes(t.type))  { map[key].totalIn  += qty; map[key].totalCostIn  += cost; }
      if (['OUT', 'RETURN_OUT'].includes(t.type)) { map[key].totalOut += qty; map[key].totalCostOut += cost; }
      if (t.type === 'ADJUSTMENT') map[key].totalAdj += qty;
    }

    res.json(Object.values(map).sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e) { next(e); }
};
