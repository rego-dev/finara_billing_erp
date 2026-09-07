# Add Line Items to Open/Partial Bills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff add new line items to a Bill that is `OPEN` or `PARTIAL` (not fully paid, not voided), recording the user-entered date of that edit and posting the incremental amount to the GL.

**Architecture:** A new `POST /payable/:id/lines` endpoint appends `BillLine` rows and increments the bill's totals + `lastEditedAt`, then posts a second best-effort GL journal entry (same `reference` as the bill's original entry). Because a bill can now have two posted entries sharing one reference, `voidBill` is changed from voiding the first match to voiding every match. The frontend adds an "Add Items" panel inside the existing Bill Detail modal, reusing the Create Bill form's line-editor UI.

**Tech Stack:** Next.js 14 (App Router), Express.js, MySQL 8, Prisma ORM 5, Jest (backend unit tests only — no frontend test suite in this repo).

## Global Constraints

- Windows dev environment: **stop `npm run dev` before running `prisma generate` or `prisma migrate dev`** — Prisma's generated client DLL gets locked by the running dev server on Windows and the command fails with `EPERM`. Never start a competing background dev server — the user runs their own and owns it.
- No `@testing-library`/frontend test runner exists in this repo (`tests/` only covers `server/`) — verify the `BillDetailModal` UI change manually against the running dev server, not with a Jest test.
- Backend controller tests mock `../server/config/database`, and `../server/utils/glPost` / `../server/utils/audit` where relevant, following the exact pattern already used in `tests/cashSaleController.test.js` and `tests/payableControllerVoidBill.test.js`: a local `run(fn, req)` promise-wrapper harness, `beforeEach(() => jest.clearAllMocks())`.
- Money math: VAT lines use `computeVAT(amount)` from `server/utils/phCompliance.js` (`VAT_RATE = 0.12`, values rounded to 2dp via its internal `round2`) — the exact same call `createBill` already makes; non-VAT lines use `{ base: amt, vat: 0, total: amt }`. Never introduce a second rounding scheme.

---

### Task 1: Schema — add `Bill.lastEditedAt`

**Files:**
- Modify: `prisma/schema.prisma:222-248` (the `Bill` model)

**Interfaces:**
- Produces: `Bill.lastEditedAt` — `DateTime | null` on every Prisma `Bill` record returned by `findUnique`/`findMany`/`update` from this point on (no `select` narrowing anywhere in `payableController.js` excludes it, so it flows through `getBill`/`listBills` automatically). Tasks 2 and 5 depend on this column existing in the database.

- [ ] **Step 1: Confirm no dev server is holding the Prisma client DLL**

Run: `netstat -ano | findstr :5000`
Expected: either no output (nothing listening — safe to proceed) or a PID. If a PID is listed, **stop before continuing** — ask the user to stop `npm run dev` first (see Global Constraints). Do not kill it yourself.

- [ ] **Step 2: Add the column to the schema**

In `prisma/schema.prisma`, inside `model Bill { ... }`, add the new field directly after `updatedAt`:

```prisma
model Bill {
  id          Int        @id @default(autoincrement())
  businessId  Int        @default(1)
  billNo      String     @unique @db.VarChar(30)
  vendorId    Int
  vendor      Vendor     @relation(fields: [vendorId], references: [id])
  billDate    DateTime   @db.Date
  dueDate     DateTime   @db.Date
  description String?    @db.Text
  notes       String?    @db.Text
  subtotal    Decimal    @default(0) @db.Decimal(15, 2)
  vatAmount   Decimal    @default(0) @db.Decimal(15, 2)
  totalAmount Decimal    @default(0) @db.Decimal(15, 2)
  paidAmount  Decimal    @default(0) @db.Decimal(15, 2)
  status      BillStatus @default(OPEN)
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  lastEditedAt DateTime? @db.DateTime(0)

  lines       BillLine[]
  payments    PaymentAP[]

  @@index([businessId])
  @@index([vendorId])
  @@index([status])
  @@index([dueDate])
  @@map("bills")
}
```

- [ ] **Step 3: Generate the Prisma client**

Run: `npm run db:generate`
Expected: `✔ Generated Prisma Client` with no `EPERM` error. If it fails with `EPERM`, the dev server is still running — stop and get the user to close it, then retry.

- [ ] **Step 4: Create and apply the migration**

Run: `npm run db:migrate -- --name add_bill_last_edited_at`
Expected: a new folder under `prisma/migrations/` named `<timestamp>_add_bill_last_edited_at` containing a `migration.sql` with `ALTER TABLE bills ADD COLUMN lastEditedAt DATETIME(0) NULL;` (column order/exact syntax may vary slightly — the key checks are: it targets the `bills` table, adds a nullable `lastEditedAt` datetime column, and the CLI reports the migration as applied).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(payable): add Bill.lastEditedAt column"
```

---

### Task 2: Backend — `addBillItems` controller, route, and tests

**Files:**
- Modify: `server/controllers/payableController.js` (add `exports.addBillItems`, after `exports.recordPayment`, before `exports.voidBill`)
- Modify: `server/routes/payable.js` (add the route)
- Create: `tests/payableControllerAddItems.test.js`

**Interfaces:**
- Consumes: `Bill.lastEditedAt` (Task 1), `computeVAT(amount)` from `server/utils/phCompliance.js` (already imported in `payableController.js` as `computeVAT`), `glPost.safePost(opts)` from `server/utils/glPost.js` (already imported as `glPost`), `createError(message, statusCode)` from `../middleware/errorHandler`.
- Produces: `exports.addBillItems` — Express handler `(req, res, next)`, reads `req.params.id`, `req.body.editDate` (ISO date string), `req.body.lines` (array of `{ accountId, description, quantity, unitPrice, vatCode }`); responds `200` with the updated bill (`{ ...bill, vendor, lines }`) on success, or calls `next(err)` where `err.statusCode` is `400` (paid/void bill) or `404` (missing bill). Mounted at `POST /payable/:id/lines`. Task 5 (frontend) calls this via `pApi.bills.addItems(id, { editDate, lines })` (added in Task 4).

- [ ] **Step 1: Write the failing tests**

Create `tests/payableControllerAddItems.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 5000,
  vendor: { name: 'Triplekenn Supply' },
};

describe('addBillItems', () => {
  test('rejects adding items to a fully paid bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'PAID' });

    await expect(run(ctrl.addBillItems, {
      params: { id: '7' },
      body: { editDate: '2026-08-28', lines: [{ accountId: 1, description: 'Extra item', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects adding items to a voided bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.addBillItems, {
      params: { id: '7' },
      body: { editDate: '2026-08-28', lines: [{ accountId: 1, description: 'Extra item', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('increments bill totals, sets lastEditedAt, and posts an incremental GL entry', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'PARTIAL' });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'PARTIAL', totalAmount: 5560 });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.addBillItems, {
      params: { id: '7' },
      body: {
        editDate: '2026-08-28',
        lines: [{ accountId: 3, description: 'Extra item', quantity: 2, unitPrice: 250, vatCode: 'VAT' }],
      },
    });

    expect(prisma.bill.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
      data: expect.objectContaining({
        subtotal:    { increment: 500 },
        vatAmount:   { increment: 60 },
        totalAmount: { increment: 560 },
        lastEditedAt: new Date('2026-08-28'),
        lines: { create: [expect.objectContaining({ accountId: 3, description: 'Extra item', quantity: 2, unitPrice: 250, amount: 500, vatCode: 'VAT' })] },
      }),
    }));

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      entryDate: '2026-08-28',
      reference: 'BILL-000007',
      lines: [
        { accountId: 3, debit: 500, description: 'Extra item' },
        { accountCode: '1330', debit: 60, description: 'Input VAT' },
        { accountCode: '2010', credit: 560, description: 'AP — Triplekenn Supply (BILL-000007) — item added' },
      ],
    }));
  });

  test('VAT-exempt items post no Input VAT line', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'OPEN' });
    prisma.bill.update.mockResolvedValue({ ...baseBill });
    glPost.safePost.mockResolvedValue({ id: 100 });

    await run(ctrl.addBillItems, {
      params: { id: '7' },
      body: {
        editDate: '2026-08-28',
        lines: [{ accountId: 5, description: 'Exempt item', quantity: 1, unitPrice: 200, vatCode: 'EXEMPT' }],
      },
    });

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { accountId: 5, debit: 200, description: 'Exempt item' },
        { accountCode: '2010', credit: 200, description: 'AP — Triplekenn Supply (BILL-000007) — item added' },
      ],
    }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payableControllerAddItems.test.js`
Expected: FAIL — `TypeError: ctrl.addBillItems is not a function` (it doesn't exist yet).

- [ ] **Step 3: Implement `addBillItems`**

In `server/controllers/payableController.js`, add this new export directly after `exports.recordPayment` (which ends at line 205) and before `exports.voidBill`:

```javascript
exports.addBillItems = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { editDate, lines } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id }, include: { vendor: true } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'PAID') throw createError('Cannot add items to a fully paid bill.', 400);
    if (bill.status === 'VOID') throw createError('Cannot add items to a voided bill.', 400);

    let incSubtotal = 0, incVat = 0;
    const processedLines = lines.map((l) => {
      const amt = Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      incSubtotal += v.base;
      incVat += v.vat;
      return { ...l, amount: v.base };
    });
    const incTotal = incSubtotal + incVat;

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        subtotal: { increment: incSubtotal },
        vatAmount: { increment: incVat },
        totalAmount: { increment: incTotal },
        lastEditedAt: new Date(editDate),
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });

    // ── Auto-post incremental GL entry ────────────────────────────────────────
    const glLines = [
      ...processedLines.map((l) => ({
        accountId:   Number(l.accountId),
        debit:       Number(l.amount),
        description: l.description,
      })),
      ...(incVat > 0 ? [{
        accountCode: '1330',
        debit:       incVat,
        description: 'Input VAT',
      }] : []),
      {
        accountCode: '2010',
        credit:      incTotal,
        description: `AP — ${bill.vendor.name} (${bill.billNo}) — item added`,
      },
    ];
    await glPost.safePost({
      entryDate:   editDate,
      description: `AP Bill Edit — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payableControllerAddItems.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route**

In `server/routes/payable.js`, add this block directly after the `POST /:id/payment` route (currently ending at line 39) and before `POST /:id/void`:

```javascript
router.post('/:id/lines',
  [
    param('id').isInt(),
    body('editDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.addBillItems);
```

- [ ] **Step 6: Run the full backend test suite**

Run: `npx jest`
Expected: PASS — no other suite touches `payableController.js`'s exports list in a way that would break (this only adds a new export).

- [ ] **Step 7: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerAddItems.test.js
git commit -m "feat(payable): add addBillItems endpoint for open/partial bills"
```

---

### Task 3: Backend — fix `voidBill` to void every entry sharing the bill's reference

**Files:**
- Modify: `server/controllers/payableController.js:207-240` (`exports.voidBill`)
- Modify: `tests/payableControllerVoidBill.test.js` (rewrite for `findMany`)

**Interfaces:**
- Consumes: nothing new — same `prisma.journalEntry`, `logger`, `recordAudit` already imported in `payableController.js`.
- Produces: `exports.voidBill` behavior change only (same signature, same response shape) — voids **all** `POSTED` journal entries whose `reference` matches `bill.billNo`, not just the first one found. This is required because Task 2 can leave a bill with two posted entries sharing one reference.

- [ ] **Step 1: Update the test file to expect `findMany`, and add a resilience test**

Replace the full contents of `tests/payableControllerVoidBill.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 5000,
};

describe('voidBill — GL correction', () => {
  test('rejects voiding a bill with payments', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 1000 });

    await expect(run(ctrl.voidBill, { params: { id: '7' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('voids every POSTED journal entry sharing the bill\'s reference (scoped to businessId)', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 88, entryNo: 'JE-1-000088' },
      { id: 91, entryNo: 'JE-1-000091' },
    ]);
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'BILL-000007', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 88 }, data: { status: 'VOIDED' } })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 91 }, data: { status: 'VOIDED' } })
    );
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });

  test('one entry failing to void does not stop the others', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 88, entryNo: 'JE-1-000088' },
      { id: 91, entryNo: 'JE-1-000091' },
    ]);
    prisma.journalEntry.update
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValueOnce({});

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payableControllerVoidBill.test.js`
Expected: FAIL — `prisma.journalEntry.findMany` was never called (current code calls `findFirst`, which is `undefined` on this mock's `prisma.journalEntry` shape... actually it will throw `prisma.journalEntry.findFirst is not a function` since the mock no longer defines `findFirst`).

- [ ] **Step 3: Rewrite `voidBill`'s GL-void block**

In `server/controllers/payableController.js`, replace lines 214-236 (the block from `// Void the bill's GL posting too` through the closing of the `if (entry) { ... }` block) with:

```javascript
    // Void every posted GL entry tied to this bill — a bill with items added
    // after creation (see addBillItems) can have more than one, all sharing
    // the same reference — otherwise a voided bill's expense/AP impact keeps
    // showing up in the Income Statement, Trial Balance, and Balance Sheet.
    const entries = await prisma.journalEntry.findMany({
      where: { businessId: bill.businessId, reference: bill.billNo, status: 'POSTED' },
    });
    for (const entry of entries) {
      try {
        await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
      } catch (err) {
        logger.error(`[BILL VOID — GL VOID FAILED] billNo=${bill.billNo} biz=${bill.businessId} entryId=${entry.id} — ${err.message}`);
        try {
          await recordAudit({
            action:     'GL_POST_FAILED',
            entity:     'JournalEntry',
            entityId:   String(entry.id),
            summary:    `Failed to void GL entry for voided bill ${bill.billNo} — ${err.message}`,
            user:       req.user?.id ? { id: req.user.id } : undefined,
            businessId: bill.businessId,
          });
        } catch { /* auditing must never break anything either */ }
      }
    }
```

The full function should now read:

```javascript
exports.voidBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.paidAmount > 0) throw createError('Cannot void a bill with payments. Reverse payments first.', 400);
    const updated = await prisma.bill.update({ where: { id }, data: { status: 'VOID' } });

    // Void every posted GL entry tied to this bill — a bill with items added
    // after creation (see addBillItems) can have more than one, all sharing
    // the same reference — otherwise a voided bill's expense/AP impact keeps
    // showing up in the Income Statement, Trial Balance, and Balance Sheet.
    const entries = await prisma.journalEntry.findMany({
      where: { businessId: bill.businessId, reference: bill.billNo, status: 'POSTED' },
    });
    for (const entry of entries) {
      try {
        await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
      } catch (err) {
        logger.error(`[BILL VOID — GL VOID FAILED] billNo=${bill.billNo} biz=${bill.businessId} entryId=${entry.id} — ${err.message}`);
        try {
          await recordAudit({
            action:     'GL_POST_FAILED',
            entity:     'JournalEntry',
            entityId:   String(entry.id),
            summary:    `Failed to void GL entry for voided bill ${bill.billNo} — ${err.message}`,
            user:       req.user?.id ? { id: req.user.id } : undefined,
            businessId: bill.businessId,
          });
        } catch { /* auditing must never break anything either */ }
      }
    }

    res.json(updated);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payableControllerVoidBill.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full backend test suite**

Run: `npx jest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payableController.js tests/payableControllerVoidBill.test.js
git commit -m "fix(payable): void every posted GL entry sharing a bill's reference"
```

---

### Task 4: Frontend — `lib/api.js` client method

**Files:**
- Modify: `lib/api.js:210-217` (`payable.bills`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `payable.bills.addItems(id, data)` → `POST /payable/${id}/lines`. Task 5 calls this.

- [ ] **Step 1: Add the method**

In `lib/api.js`, inside the `bills` object of `export const payable`, add `addItems` directly after `payment`:

```javascript
  bills: {
    list: (params) => api.get('/payable', { params }),
    get: (id) => api.get(`/payable/${id}`),
    create: (data) => api.post('/payable', data),
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    addItems: (id, data) => api.post(`/payable/${id}/lines`, data),
    void: (id) => api.post(`/payable/${id}/void`),
    aging: () => api.get('/payable/aging'),
  },
```

- [ ] **Step 2: Commit**

```bash
git add lib/api.js
git commit -m "feat(payable): add addItems client method"
```

---

### Task 5: Frontend — "Add Items" panel in `BillDetailModal`

**Files:**
- Modify: `app/(dashboard)/payable/page.jsx:42-226` (`BillDetailModal`)
- Modify: `app/(dashboard)/payable/page.jsx:921-928` (where `BillDetailModal` is rendered from `BillsPage` — find this block by its `{modal?.type === 'detail' && (` marker rather than trusting the exact line numbers, since Tasks 1-4 don't touch this file but a prior unrelated edit in this session may have shifted lines by a small amount)

**Interfaces:**
- Consumes: `payable.bills.addItems` (Task 4), `payable.bills.get` (existing), `computeVAT`, `VAT_CODES`, `DescriptionInput`, `rememberDescription`, `NumberInput`, `formatCurrency`, `formatDate` — all already imported/defined at module level in this file.
- Produces: no new exports — this is a leaf UI change.

- [ ] **Step 1: Widen `BillDetailModal`'s props and add local state**

In `app/(dashboard)/payable/page.jsx`, change the function signature at line 42:

```javascript
function BillDetailModal({ bill, accounts, onClose, onPayment, onVoid, onItemsAdded }) {
  const balance = Number(bill.totalAmount) - Number(bill.paidAmount);
  const pct = bill.totalAmount > 0 ? (Number(bill.paidAmount) / Number(bill.totalAmount)) * 100 : 0;
  const expenseAccounts = accounts.filter((a) => ['EXPENSE', 'ASSET'].includes(a.accountType));

  const [addingItems, setAddingItems] = useState(false);
  const [editDate, setEditDate] = useState(new Date().toISOString().split('T')[0]);
  const [newLines, setNewLines] = useState([{ accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' }]);
  const [savingItems, setSavingItems] = useState(false);

  const setNewLine = (i, k, v) => setNewLines((ls) => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));
  const addNewLine = () => setNewLines((ls) => [...ls, { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' }]);
  const removeNewLine = (i) => setNewLines((ls) => ls.filter((_, idx) => idx !== i));

  const newItemsTotal = newLines.reduce((s, l) => {
    const amt = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
    return s + computeVAT(amt, l.vatCode).total;
  }, 0);

  const handleSaveItems = async () => {
    const validLines = newLines.filter((l) => l.accountId && l.description && l.unitPrice);
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    if (!editDate) { toast.error('Enter the edit date'); return; }
    validLines.forEach((l) => rememberDescription(l.description));
    setSavingItems(true);
    try {
      await pApi.bills.addItems(bill.id, {
        editDate,
        lines: validLines.map((l) => ({
          accountId: Number(l.accountId),
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          vatCode: l.vatCode,
        })),
      });
      toast.success('Items added to bill');
      setAddingItems(false);
      setNewLines([{ accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' }]);
      await onItemsAdded();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add items');
    } finally {
      setSavingItems(false);
    }
  };
```

(This block replaces the current three-line function opening — `function BillDetailModal({ bill, onClose, onPayment, onVoid }) {` through the `const pct = ...` line — with the version above, which keeps those three lines, adds the `accounts` prop and `onItemsAdded` callback, and adds everything else.)

- [ ] **Step 2: Show the last-edited date**

In the same file, in the header info grid (currently lines 117-125), add a line directly after the closing `</div>` of that grid:

```jsx
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div><span className="text-gray-500 block">Bill Date</span><span className="font-medium">{formatDate(bill.billDate)}</span></div>
            <div><span className="text-gray-500 block">Due Date</span>
              <span className={`font-medium ${new Date(bill.dueDate) < new Date() && bill.status !== 'PAID' ? 'text-red-600' : ''}`}>
                {formatDate(bill.dueDate)}
              </span>
            </div>
            <div><span className="text-gray-500 block">TIN</span><span className="font-mono text-xs">{bill.vendor?.tin || '—'}</span></div>
          </div>
          {bill.lastEditedAt && (
            <p className="text-xs text-gray-400">Last edited: {formatDate(bill.lastEditedAt)}</p>
          )}
```

- [ ] **Step 3: Add the "Add Items" panel below the Line Items table**

In the same file, directly after the closing `</div>` of the Line Items block (currently ending at line 156, right before the `{/* Totals */}` comment on line 158), insert:

```jsx
          {(bill.status === 'OPEN' || bill.status === 'PARTIAL') && (
            <div>
              {!addingItems ? (
                <button type="button" onClick={() => setAddingItems(true)} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Items
                </button>
              ) : (
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-gray-700">Add Items</h4>
                    <button
                      type="button"
                      onClick={() => { setAddingItems(false); setNewLines([{ accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' }]); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="form-group max-w-xs">
                    <label className="label">Edit Date *</label>
                    <input type="date" className="input" required value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th className="w-56">Account (Expense)</th>
                          <th>Description</th>
                          <th className="w-28">VAT</th>
                          <th className="w-32 text-right">Qty</th>
                          <th className="w-40 text-right">Unit Price (₱)</th>
                          <th className="w-44 text-right">Amount (₱)</th>
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {newLines.map((line, i) => {
                          const amt = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                          const v = computeVAT(amt, line.vatCode);
                          return (
                            <tr key={i} className="align-top">
                              <td>
                                <select className="select text-xs" value={line.accountId} onChange={(e) => setNewLine(i, 'accountId', e.target.value)}>
                                  <option value="">Select...</option>
                                  {expenseAccounts.map((a) => (
                                    <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <DescriptionInput
                                  className="input text-xs"
                                  value={line.description}
                                  onChange={(v) => setNewLine(i, 'description', v)}
                                  placeholder="Item description"
                                />
                              </td>
                              <td>
                                <select className="select text-xs" value={line.vatCode} onChange={(e) => setNewLine(i, 'vatCode', e.target.value)}>
                                  {VAT_CODES.map((c) => <option key={c}>{c}</option>)}
                                </select>
                              </td>
                              <td>
                                <NumberInput decimals={3} className="input text-xs text-right" value={line.quantity} onChange={(v) => setNewLine(i, 'quantity', v)} />
                              </td>
                              <td>
                                <NumberInput className="input text-xs text-right" value={line.unitPrice} onChange={(v) => setNewLine(i, 'unitPrice', v)} placeholder="0.00" />
                              </td>
                              <td>
                                <div className="text-right text-sm font-medium text-gray-700 py-1.5">{formatCurrency(v.total)}</div>
                              </td>
                              <td>
                                {newLines.length > 1 && (
                                  <button type="button" onClick={() => removeNewLine(i)} className="p-1 text-gray-300 hover:text-red-500 transition-colors">
                                    <X className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between">
                    <button type="button" onClick={addNewLine} className="btn-secondary btn-sm">
                      <Plus className="w-3 h-3" /> Add Line
                    </button>
                    <div className="text-sm font-semibold text-gray-700">New items total: {formatCurrency(newItemsTotal)}</div>
                  </div>

                  <div className="flex justify-end">
                    <button type="button" disabled={savingItems} onClick={handleSaveItems} className="btn-primary btn-sm">
                      {savingItems ? 'Saving...' : 'Save Items'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
```

- [ ] **Step 4: Pass the new props from `BillsPage`**

In the same file, replace the `BillDetailModal` render block (currently around line 921 — search for `{modal?.type === 'detail' && (`):

```jsx
      {modal?.type === 'detail' && (
        <BillDetailModal
          bill={modal.bill}
          accounts={accounts}
          onClose={() => setModal(null)}
          onPayment={() => setModal({ type: 'payment', bill: modal.bill })}
          onVoid={() => { handleVoid(modal.bill); setModal(null); }}
          onItemsAdded={async () => {
            const { data } = await pApi.bills.get(modal.bill.id);
            setModal({ type: 'detail', bill: data });
            load();
          }}
        />
      )}
```

- [ ] **Step 5: Manual verification (no automated frontend test suite in this repo)**

The dev server is already running (owned by the user — do not start a competing instance; see Global Constraints). Use the `run` skill, or ask the user to check, to walk through:

1. Open Accounts Payable → Bills, click into an `OPEN` or `PARTIAL` bill.
2. Confirm an "Add Items" button appears below the existing Line Items table, and does **not** appear for a `PAID` or `VOID` bill.
3. Click it, set an edit date, add one VAT line and one EXEMPT line, click "Save Items".
4. Confirm: the modal's Line Items table now shows the new lines, the Totals block (Subtotal/VAT/Total/Balance) reflects the increase, "Last edited: {date}" appears near the top, and the underlying Bills list's Total/Balance for that row updated too (no page reload needed).
5. Confirm a `PAID` bill shows no "Add Items" button.
6. Void an `OPEN` bill that had items added to it (no payments recorded) and confirm the void still succeeds (exercises the Task 3 fix against a bill with two GL entries) — check the Trial Balance / Income Statement no longer reflect that bill's amounts.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/payable/page.jsx"
git commit -m "feat(payable): add Add Items panel to Bill Detail modal"
```

---

## Plan Self-Review Notes

- **Spec coverage:** schema field (Task 1), backend endpoint + validators (Task 2), `voidBill` multi-entry fix (Task 3), API client (Task 4), `BillDetailModal` UI incl. last-edited display and OPEN/PARTIAL gating (Task 5) — all sections of `docs/superpowers/specs/2026-08-28-bill-add-items-design.md` are covered. Out-of-scope items (editing/removing existing lines, edit history log, header-field edits, touching `paidAmount`) are deliberately not implemented anywhere in this plan.
- **Type/name consistency checked:** `addBillItems` (controller) ↔ `ctrl.addBillItems` (route) ↔ `pApi.bills.addItems` (client) ↔ `onItemsAdded` (modal prop) all line up; `editDate` is the field name used consistently in body, tests, and UI state.
