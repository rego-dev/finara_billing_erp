# Cash Sale POS-Style Item Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the New Cash Sale modal into a POS-style item picker backed by Inventory — search/browse items in a tile grid, tap one, adjust quantity — while keeping `CashSale` a single description/amount record, and wire the selected item to real stock deduction + COGS posting.

**Architecture:** `cashSaleController.create` gains optional `itemId`/`quantity` body fields; when present it atomically deducts stock and records an `InventoryTransaction` (`type: 'OUT'`, `reference: saleNo`), then best-effort-posts a second COGS/Inventory GL entry alongside the existing Cash/Revenue/VAT entry. `voidSale` looks up that `InventoryTransaction` by `reference` and reverses it. The frontend `NewSaleModal` splits into a "Pick Item" tab (search + category chips + tile grid + qty stepper) and a "Custom" tab (today's free-text form).

**Tech Stack:** Next.js 14 (App Router, client component), Express controller (Prisma 5), Jest for backend tests.

## Global Constraints

- `CashSale` stays a single description + single amount per record — no new table, no Prisma migration (per `docs/superpowers/specs/2026-08-11-cash-sale-pos-picker-design.md`).
- Inventory linkage rides on `InventoryTransaction.reference = saleNo` — never add an `itemId`/`quantity` column to `CashSale`.
- All new GL posting goes through the existing `glPost.safePost()` — never throws, never blocks the sale/void, failures land in the Audit Trail (`GL_POST_FAILED`).
- Stock deduction on create is atomic with the `CashSale` row itself (one `prisma.$transaction`); GL posting happens after, outside that transaction, best-effort.
- Follow the existing single-file-per-page convention — no new component files; new UI pieces are local functions inside `app/(dashboard)/receivable/cash-sales/page.jsx`, same as `NewSaleModal` already is.
- Dev server is already running and owned by the user — never start a competing `npm run dev` instance; reuse the running one for manual verification.

---

### Task 1: Backend — `create` deducts stock and books COGS when `itemId` is given

**Files:**
- Modify: `server/controllers/cashSaleController.js:1-122` (add a local `nextTxnNo` helper and extend `exports.create`)
- Test: `tests/cashSaleController.test.js` (extend the top-level `jest.mock('../server/config/database', ...)` factory and add a new `describe` block)

**Interfaces:**
- Consumes: `prisma.inventoryItem.findFirst/update`, `prisma.inventoryTransaction.findFirst/create` (Prisma models already defined in `prisma/schema.prisma:577,609`), `glPost.safePost` (`server/utils/glPost.js:159`), `createError` (`server/middleware/errorHandler.js`), `round2` (`server/utils/phCompliance.js`).
- Produces: `POST /api/cash-sales` now accepts optional `itemId` (number) and `quantity` (number) in the body. When both are present and valid, the response is unchanged in shape (`{ ...sale, journalEntryId, posted }`) but the sale is now linked to an `InventoryTransaction` via `reference = sale.saleNo`. Later tasks (Task 2's `voidSale`, Task 3's frontend) rely on: (a) that `reference` linkage, (b) a 400 error when `quantity` exceeds `item.currentStock`.

- [ ] **Step 1: Write the failing tests**

Replace the top of `tests/cashSaleController.test.js` (the `jest.mock` factory) and append a new `describe` block at the end of the file.

Replace lines 1–13 (the `jest.mock` factory) with:

```js
jest.mock('../server/config/database', () => ({
  cashSale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  account: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn() },
  journalEntry: { update: jest.fn() },
  $transaction: jest.fn(),
}));
```

Append at the end of the file:

```js
describe('cash sale item picker — stock deduction on create', () => {
  test('create with itemId deducts stock and links an OUT inventory transaction via saleNo reference', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, businessId: 1, isActive: true, name: 'Widget', sku: 'SKU-0001', unit: 'pcs',
      currentStock: 10, costPrice: 50, sellingPrice: 100, cogsAccountId: null, inventoryAccountId: null,
    });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // nextTxnNo: no prior txn
    let savedSale, savedItemUpdate, savedTxn;
    prisma.cashSale.create.mockImplementation(({ data }) => {
      savedSale = { id: 1, saleDate: new Date('2026-08-11'), ...data };
      return Promise.resolve(savedSale);
    });
    prisma.inventoryItem.update.mockImplementation(({ data }) => { savedItemUpdate = data; return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { savedTxn = data; return Promise.resolve({ id: 1, ...data }); });
    prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: {
        saleDate: '2026-08-11', description: 'Widget x2', accountId: 1, vatCode: 'VAT',
        amount: 224, paymentMethod: 'Cash', itemId: 9, quantity: 2,
      },
    });

    expect(savedItemUpdate.currentStock).toBe(8); // 10 - 2
    expect(savedTxn).toMatchObject({ itemId: 9, type: 'OUT', quantity: 2, reference: savedSale.saleNo });
    expect(glPost.safePost).toHaveBeenCalledTimes(2); // cash-sale entry + COGS entry

    const cogsCall = glPost.safePost.mock.calls.find((c) => c[0].description.includes('Inventory OUT'));
    expect(cogsCall).toBeTruthy();
    const lines = cogsCall[0].lines;
    expect(lines.find((l) => l.accountCode === '5010').debit).toBeCloseTo(100, 2);  // 2 * costPrice 50
    expect(lines.find((l) => l.accountCode === '1210').credit).toBeCloseTo(100, 2);
  });

  test('create rejects when quantity exceeds current stock, without creating anything', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, isActive: true, currentStock: 1, unit: 'pcs', name: 'Widget', sku: 'SKU-0001', costPrice: 50, sellingPrice: 100,
    });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-11', description: 'Widget x5', accountId: 1, amount: 560, paymentMethod: 'Cash', itemId: 9, quantity: 5 },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create without itemId does not touch inventory at all', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null);
    prisma.cashSale.create.mockResolvedValue({ id: 1, saleDate: new Date('2026-08-11'), saleNo: 'CS-000001' });
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-11', description: 'Service fee', accountId: 1, amount: 100, paymentMethod: 'Cash' },
    });

    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest tests/cashSaleController.test.js -t "stock deduction on create"`
Expected: FAIL — `prisma.inventoryItem.findFirst` etc. are called 0 times / stock math assertions fail, since `create` doesn't read `itemId` yet.

- [ ] **Step 3: Implement stock deduction + COGS posting in `create`**

In `server/controllers/cashSaleController.js`, add a local txn-number helper right after `genSaleNo` (after line 14):

```js
async function nextTxnNo() {
  const last = await prisma.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
  const seq = last ? last.id + 1 : 1;
  return `INV-TXN-${String(seq).padStart(6, '0')}`;
}
```

Replace the body of `exports.create` (lines 56–122) with:

```js
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, description, accountId, vatCode = 'VAT', amount, paymentMethod, notes, itemId, quantity } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!description) throw createError('description is required', 400);
    if (!Number(amount) || Number(amount) <= 0) throw createError('amount must be greater than 0', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    let item = null;
    let qty = 0;
    if (itemId) {
      qty = Number(quantity);
      if (!qty || qty <= 0) throw createError('quantity must be greater than 0', 400);
      item = await prisma.inventoryItem.findFirst({
        where: { id: Number(itemId), businessId: req.businessId, isActive: true },
      });
      if (!item) throw createError('Inventory item not found', 404);
      if (Number(item.currentStock) < qty) {
        throw createError(`Insufficient stock — only ${item.currentStock} ${item.unit} available`, 400);
      }
    }

    const cleanAmount = round2(Number(amount));
    // Compute vat first (backed out of the VAT-inclusive total) and derive
    // base as total - vat, so base + vat === total by construction. Using
    // computeVAT()'s independently-rounded base + remainder vat can be off
    // by a centavo (e.g. ₱24.50 → base 21.88 + vat 2.63 = 24.51 ≠ 24.50),
    // which misbalances the GL entry built from these figures. Do not swap
    // this back to computeVAT(cleanAmount, true) — see cash sale VAT rounding
    // regression test in tests/cashSaleController.test.js.
    const v = vatCode === 'VAT'
      ? (() => {
          const vat = round2(cleanAmount - cleanAmount / 1.12);
          return { base: round2(cleanAmount - vat), vat, total: cleanAmount };
        })()
      : { base: cleanAmount, vat: 0, total: cleanAmount };
    const saleNo = await genSaleNo();

    const saleData = {
      businessId: req.businessId,
      saleNo,
      saleDate: new Date(saleDate),
      buyerName: buyerName || null,
      description,
      accountId: Number(accountId),
      vatCode,
      subtotal: v.base,
      vatAmount: v.vat,
      totalAmount: v.total,
      paymentMethod,
      notes: notes || null,
      createdBy: req.user?.id || null,
    };

    let sale, totalCost = 0;
    if (item) {
      const newStock = round2(Number(item.currentStock) - qty);
      const unitCost = Number(item.costPrice);
      totalCost = round2(qty * unitCost);
      const txnNo = await nextTxnNo();

      const [saleRow] = await prisma.$transaction([
        prisma.cashSale.create({ data: saleData }),
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
        prisma.inventoryTransaction.create({
          data: {
            txnNo,
            itemId: item.id,
            type: 'OUT',
            quantity: qty,
            unitCost,
            totalCost,
            runningStock: newStock,
            reference: saleNo,
            notes: `Cash sale — ${saleNo}`,
            txnDate: new Date(saleDate),
          },
        }),
      ]);
      sale = saleRow;
    } else {
      sale = await prisma.cashSale.create({ data: saleData });
    }

    const { lines } = buildCashSaleEntry({
      saleNo, accountId: Number(accountId),
      subtotal: v.base, vatAmount: v.vat, totalAmount: v.total, paymentMethod,
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

    if (item && totalCost > 0) {
      const cogsLine = item.cogsAccountId
        ? { accountId: item.cogsAccountId, debit: totalCost, description: `COGS — ${item.sku} ×${qty}` }
        : { accountCode: '5010', debit: totalCost, description: `COGS — ${item.sku} ×${qty}` };
      const invLine = item.inventoryAccountId
        ? { accountId: item.inventoryAccountId, credit: totalCost, description: `Inventory out — ${item.name}` }
        : { accountCode: '1210', credit: totalCost, description: `Inventory out — ${item.name}` };
      await glPost.safePost({
        entryDate: sale.saleDate,
        description: `Inventory OUT — ${item.name} (${saleNo})`,
        reference: saleNo,
        lines: [cogsLine, invLine],
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
Expected: PASS — all existing tests (tenant isolation, VAT rounding) plus the three new ones.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashSaleController.js tests/cashSaleController.test.js
git commit -m "feat(cash-sales): deduct inventory stock and post COGS when a sale is linked to an item"
```

---

### Task 2: Backend — `voidSale` reverses the linked inventory deduction

**Files:**
- Modify: `server/controllers/cashSaleController.js` (`exports.voidSale`, added in Task 1's line numbers so re-locate by function name, not line number)
- Test: `tests/cashSaleController.test.js`

**Interfaces:**
- Consumes: `prisma.inventoryTransaction.findFirst({ where: { reference, type: 'OUT' } })` — the linkage Task 1 created; `nextTxnNo()` from Task 1.
- Produces: voiding a sale that was created with `itemId` now restocks the item and records a `RETURN_IN` `InventoryTransaction` with the same `reference`. Voiding a Custom-tab sale (no matching `OUT` transaction) is unchanged. No new response fields — Task 3's frontend doesn't need to branch on this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/cashSaleController.test.js`:

```js
describe('cash sale item picker — void reverses stock', () => {
  test('voidSale restocks the item and posts a reversing GL entry when linked to an OUT inventory transaction', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: 40, saleNo: 'CS-000005' });
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.journalEntry.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockImplementation((ops) => Promise.all(ops));
    prisma.inventoryTransaction.findFirst.mockResolvedValue({
      id: 1, itemId: 9, quantity: 2, unitCost: 50, totalCost: 100, type: 'OUT', reference: 'CS-000005',
    });
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, currentStock: 8, name: 'Widget', sku: 'SKU-0001', cogsAccountId: null, inventoryAccountId: null,
    });
    let restockedTo, reversalTxn;
    prisma.inventoryItem.update.mockImplementation(({ data }) => { restockedTo = data.currentStock; return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { reversalTxn = data; return Promise.resolve({ id: 2, ...data }); });
    glPost.safePost.mockResolvedValue({ id: 100 });

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(restockedTo).toBe(10); // 8 + 2
    expect(reversalTxn).toMatchObject({ itemId: 9, type: 'RETURN_IN', quantity: 2, reference: 'CS-000005' });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: expect.arrayContaining([
        expect.objectContaining({ accountCode: '1210', debit: 100 }),
        expect.objectContaining({ accountCode: '5010', credit: 100 }),
      ]),
    }));
  });

  test('voidSale does not touch inventory when the sale has no linked OUT transaction', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 6, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000006' });
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockResolvedValue([{}]);
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null);

    await run(ctrl.voidSale, { params: { id: '6' }, body: { reason: 'test reason' } });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest tests/cashSaleController.test.js -t "void reverses stock"`
Expected: FAIL — `prisma.inventoryTransaction.findFirst` is never called by the current `voidSale`, so `restockedTo`/`reversalTxn` stay `undefined`.

- [ ] **Step 3: Implement the reversal in `voidSale`**

Replace `exports.voidSale` (currently lines 125–147, may have shifted after Task 1's edit — locate by `exports.voidSale = async`) with:

```js
exports.voidSale = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const sale = await prisma.cashSale.findFirst({ where: { id, businessId: req.businessId } });
    if (!sale) throw createError('Cash sale not found', 404);
    if (sale.status === 'VOID') throw createError('Cash sale is already voided', 400);

    await prisma.$transaction([
      prisma.cashSale.update({
        where: { id },
        data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
      }),
      ...(sale.journalEntryId
        ? [prisma.journalEntry.update({ where: { id: sale.journalEntryId }, data: { status: 'VOIDED' } })]
        : []),
    ]);

    const outTxn = await prisma.inventoryTransaction.findFirst({
      where: { reference: sale.saleNo, type: 'OUT' },
    });
    if (outTxn) {
      const item = await prisma.inventoryItem.findFirst({ where: { id: outTxn.itemId } });
      if (item) {
        const newStock = round2(Number(item.currentStock) + Number(outTxn.quantity));
        const txnNo = await nextTxnNo();
        await prisma.$transaction([
          prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
          prisma.inventoryTransaction.create({
            data: {
              txnNo,
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
          }),
        ]);

        const totalCost = Number(outTxn.totalCost);
        if (totalCost > 0) {
          const invLine = item.inventoryAccountId
            ? { accountId: item.inventoryAccountId, debit: totalCost, description: `Inventory in — ${item.name} (void)` }
            : { accountCode: '1210', debit: totalCost, description: `Inventory in — ${item.name} (void)` };
          const cogsLine = item.cogsAccountId
            ? { accountId: item.cogsAccountId, credit: totalCost, description: `COGS reversal — ${item.sku} (void)` }
            : { accountCode: '5010', credit: totalCost, description: `COGS reversal — ${item.sku} (void)` };
          await glPost.safePost({
            entryDate: new Date(),
            description: `Cash sale void — ${item.name} (${sale.saleNo})`,
            reference: sale.saleNo,
            lines: [invLine, cogsLine],
            userId: req.user?.id || 1,
            businessId: req.businessId,
          });
        }
      }
    }

    res.json({ message: `Cash sale ${sale.saleNo} voided` });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cashSaleController.test.js`
Expected: PASS — all tests in the file, including the original tenant-isolation and VAT-rounding suites.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashSaleController.js tests/cashSaleController.test.js
git commit -m "feat(cash-sales): restock and reverse COGS when a POS-linked cash sale is voided"
```

---

### Task 3: Frontend — Pick Item / Custom tabbed modal

**Files:**
- Modify: `app/(dashboard)/receivable/cash-sales/page.jsx:23-150` (the `NewSaleModal` component and its imports)

**Interfaces:**
- Consumes: `invApi.items.list({ limit: 500 })` (already wired at `page.jsx:192`) — each item has `id, name, sku, unit, sellingPrice, currentStock, isLowStock, isOutOfStock, category: { name }, revenueAccountId` (per `inventoryController.listItems`, `server/controllers/inventoryController.js:90-111`). `csApi.create(payload)` (`lib/api.js:251`) — payload now conditionally includes `itemId`, `quantity`, consumed by Task 1's backend changes.
- Produces: nothing new consumed elsewhere — this is a leaf UI change.

- [ ] **Step 1: Replace the `NewSaleModal` component**

In `app/(dashboard)/receivable/cash-sales/page.jsx`, replace everything from the `// ─── New Cash Sale Modal ────` comment through the closing `}` of `NewSaleModal` (currently lines 23–150) with:

```jsx
// ─── New Cash Sale Modal ────────────────────────────────────────
const CATEGORY_ALL = 'All';

function StockBadge({ item }) {
  if (item.isOutOfStock) return <span className="badge badge-gray text-xs">Out of stock</span>;
  if (item.isLowStock) return <span className="badge badge-yellow text-xs">Low stock</span>;
  return <span className="badge badge-green text-xs">{Number(item.currentStock)} {item.unit}</span>;
}

function ItemTile({ item, selected, onSelect }) {
  const disabled = item.isOutOfStock;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(item)}
      className={`text-left rounded-xl border p-3 transition ${
        disabled ? 'opacity-50 cursor-not-allowed bg-gray-50'
        : selected ? 'border-green-500 ring-2 ring-green-200 bg-green-50'
        : 'border-gray-200 hover:border-green-400'
      }`}
    >
      <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
      <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-semibold text-green-700">{formatCurrency(item.sellingPrice)}</span>
        <StockBadge item={item} />
      </div>
    </button>
  );
}

function applyItemAmount(item, quantity, vatCode) {
  const price = Number(item.sellingPrice) || 0;
  const raw = price * quantity;
  return String(Math.round((vatCode === 'VAT' ? raw * 1.12 : raw) * 100) / 100);
}

function NewSaleModal({ accounts, items, onClose, onSaved }) {
  const [tab, setTab] = useState('pick'); // 'pick' | 'custom'
  const [form, setForm] = useState(emptyForm());
  const [selectedItem, setSelectedItem] = useState(null);
  const [qty, setQty] = useState(1);
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

  const selectItem = (item) => {
    setSelectedItem(item);
    setQty(1);
    setForm((f) => ({
      ...f,
      description: `${item.name} x1`,
      amount: applyItemAmount(item, 1, f.vatCode),
      accountId: f.accountId || (item.revenueAccountId ? String(item.revenueAccountId) : f.accountId),
    }));
  };

  const changeQty = (next) => {
    if (!selectedItem) return;
    const max = Math.max(1, Math.floor(Number(selectedItem.currentStock)) || 1);
    const clamped = Math.max(1, Math.min(next, max));
    setQty(clamped);
    setForm((f) => ({
      ...f,
      description: `${selectedItem.name} x${clamped}`,
      amount: applyItemAmount(selectedItem, clamped, f.vatCode),
    }));
  };

  const switchTab = (next) => {
    setTab(next);
    if (next === 'custom') {
      setSelectedItem(null);
      setForm((f) => ({ ...f, description: '', amount: '' }));
    }
  };

  const changeVatCode = (e) => {
    const vatCode = e.target.value;
    setForm((f) => ({
      ...f,
      vatCode,
      amount: selectedItem ? applyItemAmount(selectedItem, qty, vatCode) : f.amount,
    }));
  };

  const amt = Number(form.amount) || 0;
  const vat = form.vatCode === 'VAT' ? amt - amt / 1.12 : 0;
  const subtotal = amt - vat;

  const submit = async (e) => {
    e.preventDefault();
    if (tab === 'pick' && !selectedItem) return toast.error('Select an item or switch to Custom');
    if (!form.accountId) return toast.error('Select a revenue account');
    if (amt <= 0) return toast.error('Amount must be greater than 0');
    setSaving(true);
    try {
      const payload = tab === 'pick' && selectedItem
        ? { ...form, itemId: selectedItem.id, quantity: qty }
        : form;
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
      <div className="modal max-w-3xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Cash Sale</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <div className="flex gap-1 px-6 pt-3 border-b border-gray-100">
          <button type="button" onClick={() => switchTab('pick')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'pick' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            Pick Item
          </button>
          <button type="button" onClick={() => switchTab('custom')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'custom' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            Custom
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            {tab === 'pick' ? (
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
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto pr-1">
                  {filteredItems.length === 0 ? (
                    <p className="col-span-full text-center text-sm text-gray-400 py-6">No items match.</p>
                  ) : filteredItems.map((it) => (
                    <ItemTile key={it.id} item={it} selected={selectedItem?.id === it.id} onSelect={selectItem} />
                  ))}
                </div>
                {selectedItem && (
                  <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{selectedItem.name}</p>
                      <p className="text-xs text-gray-500">{formatCurrency(selectedItem.sellingPrice)} / {selectedItem.unit}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                        <button type="button" onClick={() => changeQty(qty - 1)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100">−</button>
                        <span className="px-3 text-sm font-semibold">{qty}</span>
                        <button type="button" onClick={() => changeQty(qty + 1)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100">+</button>
                      </div>
                      <span className="text-sm font-semibold text-green-700">{formatCurrency(amt)}</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="form-group">
                <label className="label">Description *</label>
                <input className="input" required value={form.description} onChange={set('description')} placeholder="What was sold" />
              </div>
            )}

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
                <label className="label">Amount (VAT-inclusive) *</label>
                <NumberInput className="input" value={form.amount} disabled={tab === 'pick' && !!selectedItem}
                  onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              </div>
              <div className="form-group">
                <label className="label">VAT Code</label>
                <select className="input" value={form.vatCode} onChange={changeVatCode}>
                  {VAT_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="input" value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {amt > 0 && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm flex justify-between">
                <span className="text-gray-500">Subtotal: {formatCurrency(subtotal)}</span>
                <span className="text-gray-500">VAT: {formatCurrency(vat)}</span>
                <span className="font-semibold">Total: {formatCurrency(amt)}</span>
              </div>
            )}
            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
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

Note: this also removes the `<datalist id="cs-items">` and its free-text-datalist autofill logic that the prior uncommitted change added — the tile grid replaces that job. If `items.map` for a `<datalist>` still appears anywhere else in the file, remove it too.

- [ ] **Step 2: Manually verify in the browser**

The dev server is already running (owned by the user — do not start a new one). In the running app:

1. Navigate to `/receivable/cash-sales`.
2. Click **New Cash Sale** — modal opens on the **Pick Item** tab.
3. Confirm the tile grid shows Inventory items with price + stock badge; an out-of-stock item's tile is visibly disabled.
4. Search by name/SKU and click a category chip — grid filters correctly.
5. Tap an in-stock tile — the "Selected Item" strip appears, qty defaults to 1, Amount field populates and becomes read-only, Revenue Account autofills if the item has one.
6. Click `+` a few times — Amount and the strip's line total update; verify it stops increasing at the item's current stock.
7. Switch VAT Code between `VAT`/`ZERO` — Amount recomputes.
8. Click the **Custom** tab — selection clears, Description/Amount become free-text again.
9. Switch back to **Pick Item** with nothing selected and submit — toast "Select an item or switch to Custom" appears, no request sent.
10. Pick an item, submit — toast "Cash sale recorded", modal closes, new row appears in the list, Inventory > Items shows the item's stock reduced by the quantity sold (check `/inventory/items`).
11. Void that sale from the list — confirm Inventory stock is restored to its pre-sale value.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/receivable/cash-sales/page.jsx"
git commit -m "feat(cash-sales): POS-style Pick Item / Custom tabs backed by Inventory"
```

---

## Self-Review Notes

- **Spec coverage:** Pick Item tab (search/category/tiles/stock badges/qty stepper) — Task 3. Custom tab fallback — Task 3. Backend stock deduction + COGS posting on create — Task 1. Insufficient-stock 400 — Task 1. Void reversal via `InventoryTransaction.reference` — Task 2. No schema migration — confirmed, no `prisma/schema.prisma` or migration file touched anywhere in this plan.
- **Type consistency:** `itemId`/`quantity` names match between the frontend payload (Task 3), the controller's destructured body (Task 1), and the tests (Task 1/2). `applyItemAmount(item, quantity, vatCode)` signature is used identically in `selectItem`, `changeQty`, and `changeVatCode`.
- **Out of scope, confirmed not touched:** multi-item cart, editing an existing sale's item/quantity, barcode scanning.
