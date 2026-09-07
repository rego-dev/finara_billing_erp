# Cash Sale Multi-Item POS Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the New Cash Sale modal into a real multi-item POS cart — add several items (Inventory-linked or free-text) with Qty/Price/Total per line, one Revenue Account/VAT Code/Payment Method for the whole sale — backed by a new `CashSaleItem` table, per-line stock deduction/COGS, and an itemized receipt.

**Architecture:** A new `CashSaleItem` model (nullable `itemId`, `description`, `quantity`, `unitPrice`, `amount`) hangs off `CashSale`, which keeps its existing `subtotal`/`vatAmount`/`totalAmount`/`accountId`/`vatCode` aggregate columns. `cashSaleController.create` accepts an `items[]` array instead of singular `description/amount/itemId/quantity`, resolves/validates each line, then runs one interactive `prisma.$transaction(async (tx) => ...)` that creates the sale row, the `CashSaleItem` rows, and a stock deduction + `InventoryTransaction` per inventory-linked line. `voidSale` mirrors this by finding *all* linked `InventoryTransaction` rows (not just one) and reversing each. The frontend `NewSaleModal` drops its "Pick Item"/"Custom" tabs for one unified view: the existing tile-grid item picker feeds a cart table, plus an "Add custom line" button for free-text rows.

**Tech Stack:** Next.js 14 (App Router, client component), Express controller (Prisma 5, MySQL), Jest for backend tests.

## Global Constraints

- Per `docs/superpowers/specs/2026-08-22-cash-sale-multi-item-cart-design.md`: one Revenue Account and one VAT Code for the whole sale (never per line). A cart can mix Inventory-linked and free-text lines.
- `unitPrice`/`amount` on `CashSaleItem` are **VAT-exclusive** (matches `InvoiceLine`/`QuotationLine` convention) — VAT is computed once on the summed subtotal via `computeVAT()` from `server/utils/phCompliance.js`, never per line.
- The frontend cart never allows the same Inventory item to appear as two separate rows — tapping an already-added tile increments that row's quantity instead of adding a duplicate. The backend relies on this invariant and validates/deducts each line independently without aggregating by `itemId`.
- All new GL posting goes through the existing `glPost.safePost()` — never throws, never blocks the sale/void, failures land in the Audit Trail (`GL_POST_FAILED`).
- **Windows/Prisma migration hazard:** stop the running `npm run dev` (owned by the user — do not start a replacement instance) before running `npm run db:generate` or `npm run db:migrate`, or the Prisma client DLL will be locked (EPERM). Tell the user to restart their dev server after Task 1's migration completes.
- Follow the existing single-file-per-page convention — no new component files; new UI pieces are local functions inside `app/(dashboard)/receivable/cash-sales/page.jsx`, same as `NewSaleModal` already is.

---

### Task 1: Schema — add `CashSaleItem`

**Files:**
- Modify: `prisma/schema.prisma` (`InventoryItem` model, `CashSale` model, new `CashSaleItem` model)

**Interfaces:**
- Produces: `prisma.cashSaleItem` client methods (`create`, `createMany`, `findMany`, ...) and `CashSale.items` / `InventoryItem.cashSaleItems` relations, consumed by Tasks 2 and 3.

- [ ] **Step 1: Add the back-relation to `InventoryItem`**

In `prisma/schema.prisma`, find the `InventoryItem` model (starts at line 589). Change:

```prisma
  transactions        InventoryTransaction[]
  quotationLines      QuotationLine[]
```

to:

```prisma
  transactions        InventoryTransaction[]
  quotationLines      QuotationLine[]
  cashSaleItems       CashSaleItem[]
```

- [ ] **Step 2: Add the `items` relation to `CashSale` and the new `CashSaleItem` model**

Find the `CashSale` model (starts at line 1174). Change:

```prisma
  createdBy      Int?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@index([businessId])
  @@index([saleDate])
  @@index([status])
  @@map("cash_sales")
}
```

to:

```prisma
  createdBy      Int?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  items          CashSaleItem[]

  @@index([businessId])
  @@index([saleDate])
  @@index([status])
  @@map("cash_sales")
}

model CashSaleItem {
  id          Int            @id @default(autoincrement())
  cashSaleId  Int
  cashSale    CashSale       @relation(fields: [cashSaleId], references: [id])
  itemId      Int?
  item        InventoryItem? @relation(fields: [itemId], references: [id])
  description String         @db.VarChar(255)
  quantity    Decimal        @default(1) @db.Decimal(12, 3)
  unitPrice   Decimal        @default(0) @db.Decimal(15, 2)
  amount      Decimal        @default(0) @db.Decimal(15, 2)

  @@index([cashSaleId])
  @@index([itemId])
  @@map("cash_sale_items")
}
```

- [ ] **Step 3: Stop the dev server, then generate + migrate**

Ask the user to stop their running `npm run dev` first (Windows locks the Prisma client DLL otherwise — do not start a competing dev server yourself). Then run:

```bash
npm run db:generate
npm run db:migrate -- --name add_cash_sale_items
```

Expected: a new folder appears under `prisma/migrations/` (e.g. `20260822HHMMSS_add_cash_sale_items/`) containing a `migration.sql` that creates the `cash_sale_items` table, and the command exits without error. Tell the user they can restart `npm run dev` now.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cash-sales): add CashSaleItem table for multi-item carts"
```

---

### Task 2: Backend — `create` accepts a multi-line `items[]` cart

**Files:**
- Modify: `server/controllers/cashSaleController.js:1-182` (imports and `exports.create`)
- Test: `tests/cashSaleController.test.js` (mock factory + `create`-related describe blocks)

**Interfaces:**
- Consumes: `prisma.cashSaleItem.createMany` (Task 1's model), `computeVAT`/`round2` (`server/utils/phCompliance.js`, already imported), `prisma.inventoryItem.findFirst/update`, `prisma.inventoryTransaction.findFirst/create`, `glPost.safePost`, `createError`.
- Produces: `POST /api/cash-sales` now requires body shape `{ saleDate, buyerName?, accountId, vatCode?, paymentMethod, notes?, items: [{ itemId?, description, quantity, unitPrice }] }` (the old `description`/`amount`/`itemId`/`quantity` top-level fields are gone). Response shape unchanged (`{ ...sale, journalEntryId, posted }`). Task 3's `voidSale` and Task 4's frontend both rely on this `items[]` shape and on `CashSale.description` now being an auto-generated summary (`"{first line} +{N} more"` for 2+ lines, else just the one line's description).

- [ ] **Step 1: Replace the mock factory and the `create`-dependent tests**

In `tests/cashSaleController.test.js`, replace lines 1–14 (the `jest.mock('../server/config/database', ...)` factory) with:

```js
jest.mock('../server/config/database', () => ({
  cashSale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  cashSaleItem: { createMany: jest.fn() },
  account: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn() },
  journalEntry: { update: jest.fn() },
  $transaction: jest.fn(),
}));
```

Replace the `describe('cash sale VAT split always sums back to the total', ...)` block with:

```js
describe('cash sale VAT split always sums back to the total', () => {
  test.each([1.26, 24.50, 101.50, 500.22, 1000.50])('unitPrice %s produces subtotal + vatAmount === totalAmount', async (unitPrice) => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    let created;
    prisma.cashSale.create.mockImplementation(({ data }) => { created = data; return Promise.resolve({ id: 1, ...data }); });
    prisma.cashSaleItem.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-10', accountId: 1, vatCode: 'VAT', paymentMethod: 'Cash', items: [{ description: 'test', quantity: 1, unitPrice }] },
    });

    expect(Number(created.subtotal) + Number(created.vatAmount)).toBeCloseTo(Number(created.totalAmount), 2);
  });
});
```

Replace the `describe('cash sale item picker — stock deduction on create', ...)` block (the one with `test('create with itemId ...')`) with:

```js
describe('cash sale multi-item cart — create', () => {
  test('create with mixed inventory + custom lines deducts stock per line and posts one combined COGS entry', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    prisma.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: 9, businessId: 1, isActive: true, name: 'Widget', sku: 'SKU-0001', unit: 'pcs', currentStock: 10, costPrice: 50, sellingPrice: 100, cogsAccountId: null, inventoryAccountId: null })
      .mockResolvedValueOnce({ id: 11, businessId: 1, isActive: true, name: 'Gadget', sku: 'SKU-0002', unit: 'pcs', currentStock: 5, costPrice: 20, sellingPrice: 60, cogsAccountId: null, inventoryAccountId: null });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // txnSeq starts at 1
    let savedSale, createdItems, stockUpdates = [], txns = [];
    prisma.cashSale.create.mockImplementation(({ data }) => { savedSale = { id: 1, ...data }; return Promise.resolve(savedSale); });
    prisma.cashSaleItem.createMany.mockImplementation(({ data }) => { createdItems = data; return Promise.resolve({ count: data.length }); });
    prisma.inventoryItem.update.mockImplementation(({ where, data }) => { stockUpdates.push({ id: where.id, ...data }); return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { txns.push(data); return Promise.resolve({ id: txns.length, ...data }); });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: {
        saleDate: '2026-08-22', accountId: 1, vatCode: 'VAT', paymentMethod: 'Cash',
        items: [
          { itemId: 9, description: 'Widget', quantity: 2, unitPrice: 100 },
          { itemId: 11, description: 'Gadget', quantity: 1, unitPrice: 60 },
          { description: 'Gift wrap', quantity: 1, unitPrice: 20 },
        ],
      },
    });

    expect(createdItems).toHaveLength(3);
    expect(createdItems[0]).toMatchObject({ cashSaleId: savedSale.id, itemId: 9, quantity: 2, unitPrice: 100, amount: 200 });
    expect(createdItems[2]).toMatchObject({ itemId: null, description: 'Gift wrap', amount: 20 });

    expect(stockUpdates).toEqual(expect.arrayContaining([
      { id: 9, currentStock: 8 },
      { id: 11, currentStock: 4 },
    ]));
    expect(txns).toHaveLength(2);
    expect(txns.map((t) => t.txnNo)).toEqual(['INV-TXN-000001', 'INV-TXN-000002']);

    expect(savedSale.description).toBe('Widget +2 more');
    expect(Number(savedSale.subtotal)).toBeCloseTo(280, 2); // 200 + 60 + 20

    expect(glPost.safePost).toHaveBeenCalledTimes(2); // cash-sale entry + one combined COGS entry
    const cogsCall = glPost.safePost.mock.calls.find((c) => c[0].description.includes('Inventory OUT'));
    expect(cogsCall).toBeTruthy();
    expect(cogsCall[0].lines).toHaveLength(4); // 2 DR/CR pairs, one per inventory-linked line
    const cogsDebits = cogsCall[0].lines.filter((l) => l.accountCode === '5010').reduce((s, l) => s + l.debit, 0);
    expect(cogsDebits).toBeCloseTo(120, 2); // 2*50 + 1*20
  });

  test('create rejects when any line exceeds current stock, without creating anything', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, isActive: true, currentStock: 1, unit: 'pcs', name: 'Widget', sku: 'SKU-0001', costPrice: 50, sellingPrice: 100,
    });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ itemId: 9, description: 'Widget', quantity: 5, unitPrice: 100 }] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create rejects an empty items array', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [] },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create with only custom lines does not touch inventory at all', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null);
    prisma.cashSale.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, saleNo: 'CS-000001', ...data }));
    prisma.cashSaleItem.createMany.mockResolvedValue({ count: 1 });
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-22', accountId: 1, paymentMethod: 'Cash', items: [{ description: 'Service fee', quantity: 1, unitPrice: 100 }] },
    });

    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cashSaleController.test.js`
Expected: FAIL — `create` doesn't read `items` yet, so `prisma.cashSaleItem.createMany` is never called and the old top-level `description`/`amount` validation throws instead.

- [ ] **Step 3: Implement the new `create`**

In `server/controllers/cashSaleController.js`, replace `exports.create` (lines 57–182) with:

```js
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, accountId, vatCode = 'VAT', paymentMethod, notes, items } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);
    if (!Array.isArray(items) || items.length === 0) throw createError('At least one item is required', 400);
    for (const line of items) {
      if (!line.description || !String(line.description).trim()) throw createError('Every line needs a description', 400);
      if (!Number(line.quantity) || Number(line.quantity) <= 0) throw createError('Every line needs a quantity greater than 0', 400);
      if (Number(line.unitPrice) < 0) throw createError('unitPrice cannot be negative', 400);
    }

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    // Resolve each line — fetch and stock-check inventory-linked lines up
    // front, outside the transaction, same as the single-item picker did.
    // Lines sharing an itemId are NOT aggregated: the frontend cart never
    // produces two rows for the same item (tapping an already-added tile
    // increments that row instead), so each line is safe to check/deduct
    // independently. See Global Constraints if that invariant ever changes.
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cashSaleController.test.js`
Expected: PASS — tenant-isolation tests, the VAT-split test, and the three new multi-item `create` tests.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashSaleController.js tests/cashSaleController.test.js
git commit -m "feat(cash-sales): create accepts a multi-item cart with per-line stock deduction"
```

---

### Task 3: Backend — `voidSale` reverses every linked line; `list`/`getOne` return items

**Files:**
- Modify: `server/controllers/cashSaleController.js` (`exports.list`, `exports.getOne`, `exports.voidSale`, and the top imports)
- Test: `tests/cashSaleController.test.js`

**Interfaces:**
- Consumes: `prisma.inventoryTransaction.findMany` (replaces the single-item `findFirst`), `tx.inventoryTransaction.findFirst` (for the local txn-number sequence, same pattern as Task 2's `create`).
- Produces: voiding a sale restocks and reverses COGS for *every* inventory-linked line it has (not just one). `GET /api/cash-sales` and `GET /api/cash-sales/:id` responses gain an `items: CashSaleItem[]` array, consumed by Task 5's receipt.

- [ ] **Step 1: Replace the mock factory's `inventoryTransaction` entry and the void tests**

In `tests/cashSaleController.test.js`, change the mock factory's `inventoryTransaction` line from:

```js
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn() },
```

to:

```js
  inventoryTransaction: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
```

In the `describe('cashSaleController tenant isolation', ...)` block, update the two `voidSale` tests to mock the new `findMany` call (add one line to each, right after the existing `prisma.cashSale.findFirst.mockResolvedValue(...)` line):

```js
  test('voidSale only looks up a sale scoped to the current business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000005' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(prisma.cashSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });

  test('voidSale 404s when the sale belongs to another business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } })).rejects.toMatchObject({ statusCode: 404 });
  });
```

Replace the whole `describe('cash sale item picker — void reverses stock', ...)` block with:

```js
describe('cash sale multi-item cart — void reverses stock', () => {
  test('voidSale restocks every inventory-linked line and posts one combined reversing GL entry', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: 40, saleNo: 'CS-000005' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([
      { id: 1, itemId: 9, quantity: 2, unitCost: 50, totalCost: 100, type: 'OUT', reference: 'CS-000005' },
      { id: 2, itemId: 11, quantity: 1, unitCost: 20, totalCost: 20, type: 'OUT', reference: 'CS-000005' },
    ]);
    prisma.inventoryItem.findFirst
      .mockResolvedValueOnce({ id: 9, currentStock: 8, name: 'Widget', sku: 'SKU-0001', cogsAccountId: null, inventoryAccountId: null })
      .mockResolvedValueOnce({ id: 11, currentStock: 4, name: 'Gadget', sku: 'SKU-0002', cogsAccountId: null, inventoryAccountId: null });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // txnSeq starts at 1 inside the void transaction
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.journalEntry.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));
    let stockUpdates = [], reversalTxns = [];
    prisma.inventoryItem.update.mockImplementation(({ where, data }) => { stockUpdates.push({ id: where.id, ...data }); return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { reversalTxns.push(data); return Promise.resolve({ id: reversalTxns.length, ...data }); });
    glPost.safePost.mockResolvedValue({ id: 100 });

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(stockUpdates).toEqual(expect.arrayContaining([
      { id: 9, currentStock: 10 },
      { id: 11, currentStock: 5 },
    ]));
    expect(reversalTxns).toHaveLength(2);
    expect(reversalTxns.every((t) => t.type === 'RETURN_IN')).toBe(true);
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ accountCode: '1210', debit: 100 }),
        expect.objectContaining({ accountCode: '5010', credit: 100 }),
        expect.objectContaining({ accountCode: '1210', debit: 20 }),
        expect.objectContaining({ accountCode: '5010', credit: 20 }),
      ]),
    }));
  });

  test('voidSale does not touch inventory when the sale has no linked OUT transactions', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 6, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000006' });
    prisma.inventoryTransaction.findMany.mockResolvedValue([]);
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((cb) => cb(prisma));

    await run(ctrl.voidSale, { params: { id: '6' }, body: { reason: 'test reason' } });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cashSaleController.test.js`
Expected: FAIL — `voidSale` still calls `inventoryTransaction.findFirst` (undefined-mocked-away behavior) instead of `findMany`, so the new assertions on multiple restocked items/reversal transactions don't hold.

- [ ] **Step 3: Implement the new `voidSale`, and add `items` to `list`/`getOne`**

In `server/controllers/cashSaleController.js`, remove the now-unused import (its only remaining caller is about to be replaced):

```js
const { nextTxnNo } = require('./inventoryController');
```

Delete that line entirely.

Replace `exports.list`'s `prisma.cashSale.findMany` call's `include` option:

```js
        include: { account: { select: { accountCode: true, accountName: true } } },
```

with:

```js
        include: { account: { select: { accountCode: true, accountName: true } }, items: true },
```

Replace `exports.getOne`'s `include` option:

```js
      include: { account: true, journalEntry: { include: { lines: true } } },
```

with:

```js
      include: { account: true, journalEntry: { include: { lines: true } }, items: true },
```

Replace `exports.voidSale` in full with:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cashSaleController.test.js`
Expected: PASS — every describe block in the file, including tenant isolation, VAT split, multi-item create, and multi-item void.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashSaleController.js tests/cashSaleController.test.js
git commit -m "feat(cash-sales): void reverses every linked inventory line; list/getOne return items"
```

---

### Task 4: Frontend — unified cart `NewSaleModal`

**Files:**
- Modify: `app/(dashboard)/receivable/cash-sales/page.jsx:1-279` (imports, `emptyForm`, and the whole `NewSaleModal` component; `ItemTile`/`StockBadge` are kept as-is)

**Interfaces:**
- Consumes: `invApi.items.list` (already wired), `csApi.create` (Task 2/3's new body shape: `{ saleDate, buyerName, accountId, vatCode, paymentMethod, notes, items: [{ itemId?, description, quantity, unitPrice }] }`).
- Produces: nothing new consumed elsewhere — leaf UI change. Task 5's `printCashSale` reads `sale.items` that this task's `create` payload results in (via the list reload after save).

- [ ] **Step 1: Update imports and `emptyForm`**

In `app/(dashboard)/receivable/cash-sales/page.jsx`, change the lucide-react import line:

```jsx
import { Plus, Search, Ban, Printer } from 'lucide-react';
```

to:

```jsx
import { Plus, Search, Ban, Printer, X } from 'lucide-react';
```

Replace `emptyForm`:

```jsx
function emptyForm() {
  return {
    saleDate: new Date().toISOString().split('T')[0],
    buyerName: '', description: '', accountId: '',
    vatCode: 'VAT', amount: '', paymentMethod: 'Cash', notes: '',
  };
}
```

with:

```jsx
function emptyForm() {
  return {
    saleDate: new Date().toISOString().split('T')[0],
    buyerName: '', accountId: '',
    vatCode: 'VAT', paymentMethod: 'Cash', notes: '',
  };
}
```

- [ ] **Step 2: Replace `NewSaleModal`**

Replace everything from `function applyItemAmount(item, quantity, vatCode) {` through the closing `}` of `NewSaleModal` (the tab-switching component) with:

```jsx
function NewSaleModal({ accounts, items, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [cart, setCart] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const categories = [CATEGORY_ALL, ...new Set(items.map((it) => it.category?.name).filter(Boolean))];

  const filteredItems = items.filter((it) => {
    if (category !== CATEGORY_ALL && it.category?.name !== category) return false;
    if (!itemSearch.trim()) return true;
    const q = itemSearch.toLowerCase();
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q);
  });

  const addItem = (item) => {
    setCart((c) => {
      const existing = c.find((l) => l.itemId === item.id);
      if (existing) {
        const max = Math.max(1, Math.floor(Number(item.currentStock)) || 1);
        return c.map((l) => l.itemId === item.id ? { ...l, quantity: Math.min(l.quantity + 1, max) } : l);
      }
      return [...c, {
        key: `item-${item.id}`, itemId: item.id, description: item.name,
        quantity: 1, unitPrice: Number(item.sellingPrice), stockCap: Number(item.currentStock),
      }];
    });
  };

  const addCustomLine = () => {
    setCart((c) => [...c, {
      key: `custom-${Date.now()}-${c.length}`, itemId: null, description: '',
      quantity: 1, unitPrice: 0, stockCap: Infinity,
    }]);
  };

  const updateLine = (key, patch) => setCart((c) => c.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  const changeQty = (key, next) => {
    setCart((c) => c.map((l) => {
      if (l.key !== key) return l;
      const max = l.stockCap === Infinity ? Infinity : Math.max(1, Math.floor(l.stockCap) || 1);
      return { ...l, quantity: Math.max(1, Math.min(next, max)) };
    }));
  };

  const lineTotal = (l) => Math.round(Number(l.quantity) * Number(l.unitPrice) * 100) / 100;
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const vat = form.vatCode === 'VAT' ? Math.round(subtotal * 0.12 * 100) / 100 : 0;
  const total = Math.round((subtotal + vat) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return toast.error('Add at least one item');
    if (cart.some((l) => !l.description.trim() || Number(l.quantity) <= 0)) {
      return toast.error('Every line needs a description and a quantity greater than 0');
    }
    if (!form.accountId) return toast.error('Select a revenue account');
    setSaving(true);
    try {
      const payload = {
        ...form,
        items: cart.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      };
      const res = await csApi.create(payload);
      if (res.data.posted) {
        toast.success('Cash sale recorded');
      } else {
        toast.error('Recorded, but GL posting failed — check Audit Trail', { duration: 6000 });
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record cash sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Cash Sale</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search item name or SKU..."
                    value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button key={c} type="button" onClick={() => setCategory(c)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${category === c ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredItems.length === 0 ? (
                    <p className="col-span-full text-center text-sm text-gray-400 py-6">No items match.</p>
                  ) : filteredItems.map((it) => (
                    <ItemTile key={it.id} item={it} selected={cart.some((l) => l.itemId === it.id)} onSelect={addItem} />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Sale Date *</label>
                    <input type="date" className="input" required value={form.saleDate} onChange={set('saleDate')} />
                  </div>
                  <div className="form-group">
                    <label className="label">Buyer Name</label>
                    <input className="input" value={form.buyerName} onChange={set('buyerName')} placeholder="Walk-in" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Revenue Account *</label>
                  <AccountSelect
                    value={form.accountId}
                    onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
                    accounts={accounts.filter((a) => a.accountType === 'REVENUE')}
                    placeholder="-- select revenue account --"
                  />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">VAT Code</label>
                    <select className="input" value={form.vatCode} onChange={set('vatCode')}>
                      {VAT_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Payment Method *</label>
                    <select className="input" value={form.paymentMethod} onChange={set('paymentMethod')}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Notes</label>
                  <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Items</label>
                <button type="button" onClick={addCustomLine} className="text-xs font-medium text-green-700 hover:text-green-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add custom line
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Item / Description</th>
                      <th className="text-center px-3 py-2 w-32">Qty</th>
                      <th className="text-right px-3 py-2 w-28">Price</th>
                      <th className="text-right px-3 py-2 w-28">Total</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-400">No items yet — tap a tile above or add a custom line.</td></tr>
                    ) : cart.map((l) => (
                      <tr key={l.key} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          {l.itemId ? (
                            <span className="font-medium text-gray-900">{l.description}</span>
                          ) : (
                            <input className="input" placeholder="Description" value={l.description}
                              onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center border border-gray-300 rounded-lg overflow-hidden w-fit mx-auto">
                            <button type="button" onClick={() => changeQty(l.key, l.quantity - 1)} className="px-2 py-1 text-gray-600 hover:bg-gray-100">−</button>
                            <span className="px-2 text-sm font-semibold">{l.quantity}</span>
                            <button type="button" onClick={() => changeQty(l.key, l.quantity + 1)} className="px-2 py-1 text-gray-600 hover:bg-gray-100">+</button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput className="input text-right" value={String(l.unitPrice)}
                            onChange={(v) => updateLine(l.key, { unitPrice: Number(v) || 0 })} />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(lineTotal(l))}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => removeLine(l.key)} className="text-gray-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cart.length > 0 && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm flex justify-end gap-6 mt-2">
                  <span className="text-gray-500">Subtotal: {formatCurrency(subtotal)}</span>
                  <span className="text-gray-500">VAT: {formatCurrency(vat)}</span>
                  <span className="font-semibold">Total: {formatCurrency(total)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Record Sale'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

Note: this removes the tab bar (`Pick Item`/`Custom` buttons) and the `tab`/`selectedItem`/`qty` state entirely, along with `applyItemAmount` — none of those are referenced anywhere else in the file.

- [ ] **Step 3: Manually verify in the browser**

The dev server should already be back up from Task 1 (owned by the user — do not start a competing one). In the running app:

1. Navigate to `/receivable/cash-sales`, click **New Cash Sale** — modal opens directly on the cart view (no tabs).
2. Tap two different Inventory tiles — two rows appear in the cart table with the item's name, qty 1, its selling price, and a computed line total.
3. Tap the same tile again — that row's qty increments to 2 instead of adding a duplicate row; the tile stays visually highlighted.
4. Use the row's `+`/`−` steppers — qty and Total update; confirm `+` stops increasing once qty reaches that item's current stock.
5. Click **Add custom line** — a blank row appears with an editable Description input; type a description, set a Price via the row's Price field.
6. Remove one row with the `×` button — it disappears and totals recompute.
7. Confirm the Subtotal/VAT/Total summary strip below the table updates live as rows change, and switching VAT Code between `VAT`/`ZERO` recomputes it.
8. Submit with an empty cart — toast "Add at least one item", no request sent.
9. Fill in Revenue Account, submit with a mixed cart (one Inventory item + one custom line) — toast "Cash sale recorded", modal closes, new row appears in the list; check `/inventory/items` shows that item's stock reduced by the quantity sold.
10. Void that sale from the list — confirm the Inventory item's stock is restored.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/receivable/cash-sales/page.jsx"
git commit -m "feat(cash-sales): unified multi-item cart replaces Pick Item/Custom tabs"
```

---

### Task 5: Frontend — itemized receipt

**Files:**
- Modify: `app/(dashboard)/receivable/cash-sales/page.jsx` (`printCashSale`)

**Interfaces:**
- Consumes: `sale.items` (Task 3's `list` now includes this), `phpFmt` (`lib/print.js`, already imported).
- Produces: nothing consumed elsewhere — leaf change.

- [ ] **Step 1: Replace `printCashSale`**

Replace the existing `printCashSale` function with:

```jsx
async function printCashSale(sale) {
  const hasItems = Array.isArray(sale.items) && sale.items.length > 0;
  const rows = hasItems
    ? sale.items.map((it) => `
        <tr>
          <td>${it.description}</td>
          <td class="right">${Number(it.quantity)}</td>
          <td class="right">${phpFmt(it.unitPrice)}</td>
          <td class="right bold">${phpFmt(it.amount)}</td>
        </tr>`).join('')
    : `
        <tr>
          <td>${sale.description}</td>
          <td class="right">1</td>
          <td class="right">${phpFmt(sale.subtotal)}</td>
          <td class="right bold">${phpFmt(sale.subtotal)}</td>
        </tr>`;

  const body = `
    <div class="info-grid" style="grid-template-columns:repeat(2,1fr);">
      <div class="info-box"><div class="info-lbl">Buyer</div><div class="info-val">${sale.buyerName || 'Walk-in'}</div></div>
      <div class="info-box"><div class="info-lbl">Payment Method</div><div class="info-val">${sale.paymentMethod}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:right;margin-top:8px;">
      <p class="small">Subtotal: ${phpFmt(sale.subtotal)}</p>
      <p class="small">VAT: ${phpFmt(sale.vatAmount)}</p>
      <p class="bold">Total: ${phpFmt(sale.totalAmount)}</p>
    </div>
    <p class="small gray" style="margin-top:10px;">Not a BIR-registered sales invoice — internal record only.</p>`;
  await printDocument('Cash Sale Receipt', sale.saleNo, body);
}
```

This keeps the old single-row layout (falling back to `sale.description`/`sale.subtotal`) for any pre-existing sale recorded before this change, which has no `CashSaleItem` rows.

- [ ] **Step 2: Manually verify in the browser**

1. In `/receivable/cash-sales`, click the print icon on the multi-item sale created in Task 4 — the receipt shows one row per item with its qty/price/total, plus a Subtotal/VAT/Total block below.
2. If any pre-existing cash sale from before this change is in the list, print it too — confirm it still renders its old single description/subtotal row without errors.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/receivable/cash-sales/page.jsx"
git commit -m "feat(cash-sales): itemized receipt for multi-item sales"
```

---

## Self-Review Notes

- **Spec coverage:** `CashSaleItem` table (Task 1) · mixed inventory/custom lines, one account/one VAT for the whole sale, VAT-exclusive line pricing via `computeVAT` (Task 2) · per-line stock deduction + combined COGS entry on create (Task 2) · insufficient-stock 400 (Task 2) · void reverses every linked line with one combined reversing entry (Task 3) · auto-generated `description` summary (Task 2) · unified cart UI replacing tabs, tap-to-increment invariant (Task 4) · itemized receipt with old-record fallback (Task 5). Out-of-scope items (per-line VAT/account, fractional qty UI, editing an existing sale, barcode scanning, backfilling old rows) are confirmed untouched by every task above.
- **Type consistency:** `items: [{ itemId?, description, quantity, unitPrice }]` request shape is identical across Task 2's controller, Task 2's tests, and Task 4's frontend payload. `CashSaleItem` field names (`cashSaleId`, `itemId`, `description`, `quantity`, `unitPrice`, `amount`) match between Task 1's schema, Task 2's `createMany` call and its test assertions, and Task 5's `sale.items` receipt rendering.
- **Transaction pattern:** Task 2 and Task 3 both switch from the old array-form `prisma.$transaction([...])` to the interactive `prisma.$transaction(async (tx) => ...)` form (matching the existing pattern already used in `purchaseOrderController.js`/`cashRequestController.js`), because `CashSaleItem.cashSaleId` needs the sale's real DB-generated `id`, which the array form can't reference mid-array. Both tasks' tests mock this via `prisma.$transaction.mockImplementation((cb) => cb(prisma))`.
