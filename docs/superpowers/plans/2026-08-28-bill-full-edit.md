# Bill Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff fully edit a Bill (vendor, dates, description, notes, and every line item — add/edit/remove) whenever it isn't `PAID` or `VOID`, matching how Sales Invoices are already edited. This replaces the narrower "Add Items" feature shipped earlier this session.

**Architecture:** A new `PUT /payable/:id` endpoint (`updateBill`) recomputes the bill's totals from a fully-resubmitted line-items array (delete-all-then-recreate), guards against dropping the total below what's already paid, and does a GL void-then-repost correction. Two small computation/GL-building helpers are extracted and shared with `createBill` (fixing a contra-expense sign bug along the way), and a third "void every posted entry for a reference" helper is extracted and shared with `voidBill`. `addBillItems` (`POST /payable/:id/lines`) and its UI panel are deleted outright — `updateBill` supersedes it. The frontend reuses `CreateBillModal` in an optional edit mode, exactly like `CreateInvoiceModal` already does for invoices.

**Tech Stack:** Next.js 14 (App Router), Express.js, MySQL 8, Prisma ORM 5, Jest (backend unit tests only — no frontend test suite in this repo).

## Global Constraints

- Windows dev environment: **stop `npm run dev` before running `prisma generate` or `prisma migrate dev`** — the generated Prisma client DLL gets locked by the running dev server on Windows and the command fails with `EPERM`. Never start a competing background dev server — the user runs their own and owns it.
- No `@testing-library`/frontend test runner exists in this repo — verify frontend changes manually against the running dev server, not with a Jest test.
- Backend controller tests mock `../server/config/database`, and `../server/utils/glPost`/`../server/utils/audit` where relevant, following the exact pattern already used across this codebase's test suite: a local `run(fn, req)` promise-wrapper harness, `beforeEach(() => jest.clearAllMocks())`.
- Money math: VAT lines use `computeVAT(amount)` from `server/utils/phCompliance.js` (`VAT_RATE = 0.12`, values rounded to 2dp via its internal `round2`). Contra-account sign handling mirrors `computeInvoiceTotals` (`server/controllers/receivableController.js:21-38`) exactly, with the sign condition flipped: revenue's contra accounts carry `normalBalance: DEBIT`, expense's contra accounts carry `normalBalance: CREDIT` — so `computeBillTotals` checks `=== 'CREDIT'` where `computeInvoiceTotals` checks `=== 'DEBIT'`. Never introduce a third rounding/sign scheme.
- GL entries built by `buildBillGLLines` must stay balanced (total debits === total credits) on every code path, including when a contra-expense line makes a line's `amount` negative.

---

### Task 1: Schema — drop `Bill.lastEditedAt`

**Files:**
- Modify: `prisma/schema.prisma` (the `Bill` model)

**Interfaces:**
- Produces: `Bill` records no longer carry a `lastEditedAt` column. Task 5 (frontend) depends on this being gone before it removes the UI that displayed it — order doesn't strictly matter for that task, but do this one first since it's the simplest and isolates any migration friction.

- [ ] **Step 1: Confirm no dev server is holding the Prisma client DLL**

Run: `netstat -ano | findstr :5000`
Expected: no output (nothing listening) — safe to proceed. If a PID is listed, **stop and ask the user to stop `npm run dev` first** (see Global Constraints). Do not kill it yourself.

- [ ] **Step 2: Remove the field from the schema**

In `prisma/schema.prisma`, inside `model Bill { ... }`, remove this line (it currently sits directly after `updatedAt`):

```prisma
  lastEditedAt DateTime? @db.DateTime(0)
```

The `Bill` model's timestamp fields should read exactly:

```prisma
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  lines       BillLine[]
```

- [ ] **Step 3: Generate the Prisma client**

Run: `npm run db:generate`
Expected: `✔ Generated Prisma Client` with no `EPERM` error. If it fails with `EPERM`, the dev server is still running — stop and get the user to close it, then retry.

- [ ] **Step 4: Create and apply the migration**

Run: `npm run db:migrate -- --name drop_bill_last_edited_at`
Expected: a new folder under `prisma/migrations/` named `<timestamp>_drop_bill_last_edited_at` containing a `migration.sql` with `ALTER TABLE bills DROP COLUMN lastEditedAt;` (exact casing/syntax may vary slightly — the key checks are: it targets the `bills` table and drops the `lastEditedAt` column only).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "chore(payable): drop Bill.lastEditedAt, superseded by full bill editing"
```

---

### Task 2: Backend — `computeBillTotals`/`buildBillGLLines` helpers, `createBill` refactor

**Files:**
- Modify: `server/controllers/payableController.js`
- Create: `tests/payableControllerCreateBill.test.js`

**Interfaces:**
- Produces: `computeBillTotals(lines)` — `async (lines: Array<{accountId, description, quantity, unitPrice, vatCode}>) => { subtotal: number, vatAmount: number, totalAmount: number, processedLines: Array<{...line, amount: number}> }`. `buildBillGLLines(bill)` — `(bill: { lines: Array<{accountId, amount, description}>, vatAmount, totalAmount, vendor: {name}, billNo }) => Array<{accountId|accountCode, debit|credit, description}>`. Both are module-private (not `exports.`) functions in `payableController.js`. Task 4 (`updateBill`) consumes both directly.

- [ ] **Step 1: Write the failing tests**

Create `tests/payableControllerCreateBill.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    count: jest.fn(),
    create: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
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

describe('createBill — contra-expense sign handling', () => {
  test('a normal (DEBIT) expense line adds to the bill total', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [{ accountId: 1, amount: args.data.subtotal, description: 'Item A' }] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.subtotal).toBeCloseTo(1000, 2);
    expect(created.totalAmount).toBeCloseTo(1000, 2);
  });

  test('a contra-expense (CREDIT normalBalance) line subtracts from the bill total instead of adding', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, normalBalance: 'DEBIT' },
      { id: 2, normalBalance: 'CREDIT' }, // e.g. Purchase Discounts
    ]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [
          { accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' },
          { accountId: 2, description: 'Purchase Discount', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' },
        ],
      },
    });

    expect(created.subtotal).toBeCloseTo(900, 2); // 1000 - 100, not 1100
    expect(created.totalAmount).toBeCloseTo(900, 2);
  });

  test('GL lines stay balanced (total debits === total credits) when a contra-expense line is present', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, normalBalance: 'DEBIT' },
      { id: 2, normalBalance: 'CREDIT' },
    ]);
    prisma.bill.count.mockResolvedValue(0);
    prisma.bill.create.mockImplementation((args) => Promise.resolve({
      id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data,
      lines: args.data.lines.create.map((l) => ({ ...l })),
    }));
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [
          { accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'VAT' },
          { accountId: 2, description: 'Purchase Discount', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' },
        ],
      },
    });

    const glLines = glPost.safePost.mock.calls[0][0].lines;
    const totalDebit = glLines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = glLines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payableControllerCreateBill.test.js`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'findMany')` (the current inline `createBill` never calls `prisma.account.findMany`, so the mocked account list is never consulted and the sign bug is unfixed — the "subtracts" test in particular will show `created.subtotal` as `1100`, not `900`).

- [ ] **Step 3: Add the two helpers**

In `server/controllers/payableController.js`, insert these two functions directly after `nextVendorCode` (which currently ends at line 31, `}`) and before `exports.listVendors`:

```javascript
// Shared by createBill/updateBill: recompute per-line VAT + running totals.
// Contra-expense accounts (e.g. Purchase Discounts, Purchase Returns &
// Allowances — EXPENSE type but normalBalance CREDIT) reduce the subtotal
// instead of adding to it, so their line amount is negated before VAT is
// applied.
async function computeBillTotals(lines) {
  const accountIds = [...new Set(lines.map((l) => Number(l.accountId)))];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, normalBalance: true },
  });
  const normalBalanceById = new Map(accounts.map((a) => [a.id, a.normalBalance]));

  let subtotal = 0, vatAmount = 0;
  const processedLines = lines.map((l) => {
    const sign = normalBalanceById.get(Number(l.accountId)) === 'CREDIT' ? -1 : 1;
    const amt = sign * Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, totalAmount: subtotal + vatAmount, processedLines };
}

// Shared by createBill/updateBill: DR each expense/cost line (or CR for a
// contra-expense line, since l.amount is already negative for those,
// matching their CREDIT normal balance) / DR Input VAT / CR Accounts
// Payable — Trade.
function buildBillGLLines(bill) {
  return [
    ...bill.lines.map((l) => {
      const amt = Number(l.amount);
      return amt < 0
        ? { accountId: l.accountId, credit: -amt, description: l.description }
        : { accountId: l.accountId, debit: amt, description: l.description };
    }),
    ...(Number(bill.vatAmount) > 0 ? [{
      accountCode: '1330', debit: Number(bill.vatAmount), description: 'Input VAT',
    }] : []),
    {
      accountCode: '2010', credit: Number(bill.totalAmount),
      description: `AP — ${bill.vendor.name} (${bill.billNo})`,
    },
  ];
}
```

- [ ] **Step 4: Refactor `createBill` to use them**

Replace the current `exports.createBill` body (lines 109-169) with:

```javascript
exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    const billNo = await genBillNo();
    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo, vendorId: Number(vendorId),
        billDate: new Date(billDate), dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    await glPost.safePost({
      entryDate:   bill.billDate,
      description: `AP Bill — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       buildBillGLLines(bill),
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(bill);
  } catch (err) { next(err); }
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/payableControllerCreateBill.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full backend test suite**

Run: `npx jest`
Expected: `tests/payableControllerAddItems.test.js` and every other existing suite still passes (this task doesn't touch `addBillItems`, `voidBill`, or the route file — that's Tasks 3/4). `tests/receivableController.test.js` still shows its known 7 pre-existing failures (fixed separately in Task 6 of this plan) — confirm no NEW failures beyond that.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/payableController.js tests/payableControllerCreateBill.test.js
git commit -m "fix(payable): share sign-aware VAT/GL math between createBill and the coming updateBill"
```

---

### Task 3: Backend — extract `voidPostedEntriesByReference`, refactor `voidBill`

**Files:**
- Modify: `server/controllers/payableController.js`

**Interfaces:**
- Consumes: nothing new — same `prisma.journalEntry`, `logger`, `recordAudit` already imported.
- Produces: `voidPostedEntriesByReference(businessId, reference, req, contextLabel)` — `async (number, string, ExpressRequest, string) => void`. Module-private. Task 4 (`updateBill`) consumes this directly.

- [ ] **Step 1: Add the helper and refactor `voidBill`**

In `server/controllers/payableController.js`, insert this helper directly before `exports.voidBill`:

```javascript
// Shared by voidBill/updateBill: void every POSTED journal entry sharing a
// reference — a bill can carry more than one after being edited before (or
// from the retired add-items flow, on older data), so this can't stop at
// the first match. Continues past any single entry's failure.
async function voidPostedEntriesByReference(businessId, reference, req, contextLabel) {
  const entries = await prisma.journalEntry.findMany({
    where: { businessId, reference, status: 'POSTED' },
  });
  for (const entry of entries) {
    try {
      await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
    } catch (err) {
      logger.error(`[${contextLabel} — GL VOID FAILED] reference=${reference} biz=${businessId} entryId=${entry.id} — ${err.message}`);
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   String(entry.id),
          summary:    `Failed to void GL entry for ${contextLabel.toLowerCase()} ${reference} — ${err.message}`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }
  }
}
```

Then replace `exports.voidBill`'s body (currently lines 272-307) with:

```javascript
exports.voidBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.paidAmount > 0) throw createError('Cannot void a bill with payments. Reverse payments first.', 400);
    const updated = await prisma.bill.update({ where: { id }, data: { status: 'VOID' } });

    await voidPostedEntriesByReference(bill.businessId, bill.billNo, req, 'BILL VOID');

    res.json(updated);
  } catch (err) { next(err); }
};
```

This is a pure refactor — the extracted helper's `prisma.journalEntry.findMany`/`.update` call shapes are unchanged from what `voidBill` already did inline, so `tests/payableControllerVoidBill.test.js` needs no edits.

- [ ] **Step 2: Run the existing voidBill tests to confirm no regression**

Run: `npx jest tests/payableControllerVoidBill.test.js`
Expected: PASS (4 tests, unchanged from before this refactor).

- [ ] **Step 3: Run the full backend test suite**

Run: `npx jest`
Expected: no new failures beyond the known pre-existing `tests/receivableController.test.js` ones (fixed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add server/controllers/payableController.js
git commit -m "refactor(payable): extract voidPostedEntriesByReference, shared by voidBill and the coming updateBill"
```

---

### Task 4: Backend — `updateBill`, route, retire `addBillItems`

**Files:**
- Modify: `server/controllers/payableController.js` (add `exports.updateBill`, delete `exports.addBillItems`)
- Modify: `server/routes/payable.js` (add `PUT /:id`, delete `POST /:id/lines`)
- Create: `tests/payableControllerUpdateBill.test.js`
- Delete: `tests/payableControllerAddItems.test.js`

**Interfaces:**
- Consumes: `computeBillTotals`, `buildBillGLLines` (Task 2), `voidPostedEntriesByReference` (Task 3) — all module-private functions already in `payableController.js` by this point.
- Produces: `exports.updateBill` — Express handler `(req, res, next)`, reads `req.params.id`, `req.body.vendorId/billDate/dueDate/description/notes/lines`; responds `200` with the updated bill (`{ ...bill, vendor, lines, payments }`) on success, or calls `next(err)` where `err.statusCode` is `400` (paid/void bill, or total below paid) or `404` (missing/cross-tenant bill). Mounted at `PUT /payable/:id`. Task 5 (frontend) calls this via `pApi.bills.update(id, payload)` (added in that same task).

- [ ] **Step 1: Write the failing tests**

Create `tests/payableControllerUpdateBill.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'DEBIT' }]);
});

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN',
  paidAmount: 0, totalAmount: 1120, subtotal: 1000, vatAmount: 120,
};

const editBody = {
  vendorId: 2, billDate: '2026-08-11', dueDate: '2026-09-10',
  description: 'Edited', notes: '',
  lines: [{ accountId: 10, description: 'Item A', quantity: 2, unitPrice: 500, vatCode: 'VAT' }],
};

describe('updateBill — eligibility', () => {
  test('rejects editing a PAID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120 });

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects editing a VOID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects when the edited total would drop below the amount already paid', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 900 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] };

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: smallBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('404s when the bill belongs to another business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the bill scoped to the current business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateBill, { params: { id: '7' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.bill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7, businessId: 1 }) })
    );
  });
});

describe('updateBill — recompute and status transitions', () => {
  test('recomputes subtotal/vatAmount/totalAmount from submitted lines and replaces lines via deleteMany+create', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({
        id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
        totalAmount: 1120, vatAmount: 120,
        vendor: { name: 'Triplekenn Supply' },
        lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
      });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(updateArgs.data.subtotal).toBeCloseTo(1000, 2);
    expect(updateArgs.data.vatAmount).toBeCloseTo(120, 2);
    expect(updateArgs.data.totalAmount).toBeCloseTo(1120, 2);
    expect(updateArgs.data.lines.deleteMany).toEqual({});
    expect(updateArgs.data.lines.create).toHaveLength(1);
    expect(updateArgs.data.lines.create[0]).toMatchObject({ accountId: 10, description: 'Item A' });
  });

  test('flips a PARTIAL bill to PAID when the edited total exactly matches paidAmount', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 112 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'VAT' }] }; // totals to 112
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 112, vatAmount: 12, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: smallBody });

    expect(updateArgs.data.status).toBe('PAID');
  });

  test('keeps status PARTIAL when a payment exists and remaining balance is still positive', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 100 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody }); // totals to 1120, paid 100, remaining 1020

    expect(updateArgs.data.status).toBe('PARTIAL');
  });

  test('keeps status OPEN unchanged when there are no payments', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.bill.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 7, billNo: 'BILL-000007', billDate: new Date(), totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(updateArgs.data.status).toBe('OPEN');
  });
});

describe('updateBill — GL correction', () => {
  test('voids every existing POSTED journal entry (scoped to businessId) and posts one fresh entry', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({
      id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120,
      vendor: { name: 'Triplekenn Supply' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findMany.mockResolvedValue([
      { id: 42, entryNo: 'JE-1-000042' },
      { id: 43, entryNo: 'JE-1-000043' },
    ]);
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'BILL-000007', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledTimes(2);
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42 }, data: { status: 'VOIDED' } }));
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 43 }, data: { status: 'VOIDED' } }));

    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('BILL-000007');
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.credit).toBeCloseTo(1120, 2);
    const vatLine = call.lines.find((l) => l.accountCode === '1330');
    expect(vatLine.debit).toBeCloseTo(120, 2);
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'OPEN', paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({
      id: 7, billNo: 'BILL-000007', billDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120, vendor: { name: 'Acme' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateBill, { params: { id: '7' }, body: editBody });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payableControllerUpdateBill.test.js`
Expected: FAIL — `TypeError: ctrl.updateBill is not a function` (it doesn't exist yet).

- [ ] **Step 3: Delete `addBillItems`, add `updateBill`**

In `server/controllers/payableController.js`, delete the entire `exports.addBillItems = async (req, res, next) => { ... };` block (currently lines 207-270, right after `exports.recordPayment` and before the `voidPostedEntriesByReference` helper added in Task 3). In its place, insert:

```javascript
exports.updateBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findFirst({ where: { id, businessId: req.businessId } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'PAID') throw createError('Cannot edit a fully paid bill.', 400);
    if (bill.status === 'VOID') throw createError('Cannot edit a voided bill.', 400);

    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    if (totalAmount < Number(bill.paidAmount) - 0.01) {
      throw createError(
        `New total (₱${totalAmount.toFixed(2)}) is less than the amount already paid (₱${Number(bill.paidAmount).toFixed(2)}). Adjust line items so the total covers what's been paid.`,
        400
      );
    }

    const remaining = totalAmount - Number(bill.paidAmount);
    const status = remaining <= 0.01 ? 'PAID' : (Number(bill.paidAmount) > 0 ? 'PARTIAL' : bill.status);

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        vendorId: Number(vendorId),
        billDate: new Date(billDate),
        dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount, status,
        lines: {
          deleteMany: {},
          create: processedLines.map((l) => ({
            accountId: Number(l.accountId), description: l.description,
            quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
          })),
        },
      },
      include: { vendor: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } }, payments: true },
    });

    // ── GL correction: void every prior posted entry, post a fresh one ───────
    await voidPostedEntriesByReference(bill.businessId, bill.billNo, req, 'BILL EDIT');
    await glPost.safePost({
      entryDate:   updated.billDate,
      description: `AP Bill (Edited) — ${updated.vendor.name} (${updated.billNo})`,
      reference:   updated.billNo,
      lines:       buildBillGLLines(updated),
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};
```

`updateBill` is placed before the `voidPostedEntriesByReference` helper (Task 3) in the file, so it must be defined as a function declaration (not a `const ... = async () => {}` arrow assigned before use) if you place it before that helper's declaration — but since `voidPostedEntriesByReference` is declared with `async function voidPostedEntriesByReference(...)` (a hoisted function declaration, not a `const`), it's safe to call from anywhere in the module regardless of source order. No special ordering is required; just replace `addBillItems` in place.

- [ ] **Step 4: Delete the retired test file**

```bash
git rm tests/payableControllerAddItems.test.js
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/payableControllerUpdateBill.test.js`
Expected: PASS (9 tests).

- [ ] **Step 6: Update the route file**

In `server/routes/payable.js`, delete the entire `router.post('/:id/lines', ...)` block (currently lines 40-51). In its place, insert:

```javascript
router.put('/:id',
  [
    param('id').isInt(),
    body('vendorId').isInt(),
    body('billDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.updateBill);
```

- [ ] **Step 7: Run the full backend test suite**

Run: `npx jest`
Expected: no failures beyond the known pre-existing `tests/receivableController.test.js` ones (fixed in Task 6 of this plan). `tests/payableControllerAddItems.test.js` should no longer appear at all (deleted).

- [ ] **Step 8: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerUpdateBill.test.js
git commit -m "feat(payable): add updateBill (PUT /payable/:id), retire addBillItems"
```

---

### Task 5: Frontend — `CreateBillModal` edit mode, `BillDetailModal`/`BillsPage` wiring, `lib/api.js`

**Files:**
- Modify: `lib/api.js` (`payable.bills`)
- Modify: `app/(dashboard)/payable/page.jsx` (`BillDetailModal`, `CreateBillModal`, `BillsPage`)

**Interfaces:**
- Consumes: `pApi.bills.update` (added in this task), `pApi.bills.get` (existing).
- Produces: no new exports — this is a leaf UI change. `CreateBillModal` gains an optional `bill` prop; `BillDetailModal` gains an `onEdit` prop and loses `accounts`/`onItemsAdded`.

- [ ] **Step 1: `lib/api.js` — add `update`, remove `addItems`**

Replace the `bills` object inside `export const payable` (`lib/api.js:210-218`):

```javascript
  bills: {
    list: (params) => api.get('/payable', { params }),
    get: (id) => api.get(`/payable/${id}`),
    create: (data) => api.post('/payable', data),
    update: (id, data) => api.put(`/payable/${id}`, data),
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    void: (id) => api.post(`/payable/${id}/void`),
    aging: () => api.get('/payable/aging'),
  },
```

- [ ] **Step 2: Add the `Pencil` icon import**

In `app/(dashboard)/payable/page.jsx`, the `lucide-react` import currently reads:

```javascript
import {
  Plus, Search, Eye, CreditCard, Ban, ChevronDown, ChevronUp,
  Filter, X, Check, AlertCircle, Clock, CheckCircle2, FileText,
  Printer, Download
} from 'lucide-react';
```

Add `Pencil` to the list:

```javascript
import {
  Plus, Search, Eye, CreditCard, Ban, ChevronDown, ChevronUp,
  Filter, X, Check, AlertCircle, Clock, CheckCircle2, FileText,
  Printer, Download, Pencil
} from 'lucide-react';
```

- [ ] **Step 3: `BillDetailModal` — remove the "Add Items" panel, add `onEdit`**

Read the current file first — Tasks 1-4 don't touch this file, so its content should match what's described below, but confirm by searching for the anchor text rather than trusting line numbers blindly.

Replace the function's opening (currently `function BillDetailModal({ bill, accounts, onClose, onPayment, onVoid, onItemsAdded }) {` through the end of `handleSaveItems`, i.e. everything from the signature down to the line right before `const handlePrint = () => {`) with:

```javascript
function BillDetailModal({ bill, onClose, onPayment, onVoid, onEdit }) {
  const balance = Number(bill.totalAmount) - Number(bill.paidAmount);
  const pct = bill.totalAmount > 0 ? (Number(bill.paidAmount) / Number(bill.totalAmount)) * 100 : 0;

  const handlePrint = () => {
```

Remove the "Last edited" block, which currently sits directly after the header-info `<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">...</div>` and before `{bill.description && (`:

```jsx
          {bill.lastEditedAt && (
            <p className="text-xs text-gray-400">Last edited: {formatDate(bill.lastEditedAt)}</p>
          )}
```

Delete that block entirely (keep the blank line and surrounding structure otherwise unchanged).

Remove the entire "Add Items" panel — the block that starts with `{(bill.status === 'OPEN' || bill.status === 'PARTIAL') && (` (directly after the closing `</div>` of the Line Items block) and ends with the matching `)}` right before the `{/* Totals */}` comment. Delete that whole conditional block; nothing replaces it.

In the modal footer, add an Edit button between the Void button and the Record Payment button:

```jsx
        <div className="modal-footer">
          {bill.status === 'VOID' ? (
            <span className="text-gray-400 text-sm">This bill has been voided.</span>
          ) : (
            <>
              {bill.paidAmount === 0 && (
                <button onClick={onVoid} className="btn-danger btn-sm mr-auto">
                  <Ban className="w-4 h-4" /> Void Bill
                </button>
              )}
              {bill.status !== 'PAID' && (
                <button onClick={onEdit} className="btn-secondary">
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              )}
              {bill.status !== 'PAID' && (
                <button onClick={onPayment} className="btn-success">
                  <CreditCard className="w-4 h-4" /> Record Payment
                </button>
              )}
            </>
          )}
          <button onClick={handlePrint} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
```

- [ ] **Step 4: `CreateBillModal` — accept an optional `bill` prop for edit mode**

Replace the function's opening (`function CreateBillModal({ vendors, accounts, onClose, onSaved, onVendorAdded }) {` through the `useState({...})` call that initializes `form`) with:

```javascript
function CreateBillModal({ vendors, accounts, bill, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(() => bill ? {
    vendorId:    String(bill.vendorId),
    billDate:    bill.billDate.slice(0, 10),
    dueDate:     bill.dueDate.slice(0, 10),
    description: bill.description || '',
    notes:       bill.notes || '',
    lines: bill.lines.map((l) => ({
      accountId: String(l.accountId), description: l.description,
      quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
    })),
  } : {
    vendorId: '',
    billDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    description: '',
    notes: '',
    lines: [
      { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
    ],
  });
```

Leave everything else in the component (`saving` state, `set`, `setLine`, `addLine`, `removeLine`, the due-date auto-fill `useEffect`, `expenseAccounts`, `totals`) unchanged.

Replace `handleSubmit`:

```javascript
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vendorId) { toast.error('Select or add a vendor'); return; }
    const validLines = form.lines.filter((l) => l.accountId && l.description && l.unitPrice);
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    validLines.forEach((l) => rememberDescription(l.description));
    setSaving(true);
    try {
      const payload = {
        ...form,
        vendorId: Number(form.vendorId),
        lines: validLines.map((l) => ({
          accountId: Number(l.accountId),
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          vatCode: l.vatCode,
        })),
      };
      if (bill) {
        await pApi.bills.update(bill.id, payload);
        toast.success('Bill updated successfully');
      } else {
        await pApi.bills.create(payload);
        toast.success('Bill created successfully');
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${bill ? 'update' : 'create'} bill`);
    } finally {
      setSaving(false);
    }
  };
```

Change the modal header title:

```jsx
          <h3 className="text-lg font-semibold">{bill ? 'Edit Bill' : 'New Bill / Purchase Invoice'}</h3>
```

Change the submit button:

```jsx
            <button type="submit" disabled={saving} className="btn-primary">
              <FileText className="w-4 h-4" />
              {saving ? (bill ? 'Saving...' : 'Creating Bill...') : (bill ? 'Save Changes' : 'Create Bill')}
            </button>
```

- [ ] **Step 5: `BillsPage` — add the Edit icon button to list rows**

In the row actions cell, between the "View details" (`Eye`) button and the "Record payment" (`CreditCard`) button, insert:

```jsx
                        {bill.status !== 'PAID' && bill.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await pApi.bills.get(bill.id);
                              setModal({ type: 'edit', bill: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit bill"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
```

- [ ] **Step 6: `BillsPage` — wire the `edit` modal type, update the `detail` modal's props**

Replace the modals render block:

```jsx
      {modal?.type === 'create' && (
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onVendorAdded={(v) => setVendors((prev) => [v, ...prev])}
        />
      )}
      {modal?.type === 'edit' && (
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          bill={modal.bill}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onVendorAdded={(v) => setVendors((prev) => [v, ...prev])}
        />
      )}
      {modal?.type === 'detail' && (
        <BillDetailModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPayment={() => setModal({ type: 'payment', bill: modal.bill })}
          onVoid={() => { handleVoid(modal.bill); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', bill: modal.bill })}
        />
      )}
      {modal?.type === 'payment' && (
        <PaymentModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPaid={() => { setModal(null); load(); }}
        />
      )}
```

- [ ] **Step 7: Sanity-check by inspection (no automated frontend test suite in this repo)**

Re-read the full modified `BillDetailModal` and `CreateBillModal` functions and the `BillsPage` modal-render block. Confirm: no leftover references to `accounts` inside `BillDetailModal` (its prop was removed), no leftover references to `onItemsAdded`, `addingItems`, `editDate`, `newLines`, `savingItems`, `handleSaveItems`, `setNewLine`, `addNewLine`, `removeNewLine`, or `newItemsTotal` anywhere in the file (all deleted with the panel), balanced JSX tags, and that `Pencil` is used in exactly two places (list row, detail modal footer).

- [ ] **Step 8: Manual verification against the running dev server**

The dev server is already running (owned by the user — do not start a competing instance; see Global Constraints). Ask the user to check, or use the `run` skill, to walk through:

1. Open Accounts Payable → Bills, click into an `OPEN` bill. Confirm the "Add Items" panel is gone and an "Edit" button appears in the footer next to "Record Payment".
2. Click Edit — confirm it opens a modal titled "Edit Bill", pre-filled with the bill's vendor, dates, description, and every existing line item.
3. Change the vendor, edit one line's price, add a new line, remove another line, save. Confirm: the bill list and detail view reflect the new vendor/total/lines, and the Trial Balance / Income Statement reflect the corrected amounts (old GL entry voided, one fresh entry posted).
4. Confirm the row-level Edit pencil icon behaves the same way from the list.
5. Confirm a `PAID` bill shows no Edit button (list row or detail modal), and attempting to edit a `PARTIAL` bill down below its `paidAmount` is rejected with a clear error.
6. Void an `OPEN` bill that was previously edited (no payments recorded) and confirm the void still succeeds and clears the GL correctly (exercises `voidPostedEntriesByReference` against a bill with a single current entry — the multi-entry case was already exercised in Task 4's automated tests).

- [ ] **Step 9: Commit**

```bash
git add lib/api.js "app/(dashboard)/payable/page.jsx"
git commit -m "feat(payable): replace Add Items panel with full Bill editing (Edit button, PUT /payable/:id)"
```

---

### Task 6: Bonus fix — `tests/receivableController.test.js`'s pre-existing `prisma.account.findMany` gap

**Files:**
- Modify: `tests/receivableController.test.js`

**Interfaces:** none — test-only change, no production code touched.

This fixes the unrelated pre-existing failure this plan's own tests kept having to disclose around (`computeInvoiceTotals` on the AR side calls `prisma.account.findMany`, which this test file's mock never provided, so all 7 `updateInvoice` tests that reach it have been failing with `TypeError: Cannot read properties of undefined (reading 'findMany')` since before this session started). Same root-cause class as what Task 2 just fixed for AP — the user approved doing this cleanup in the same session.

- [ ] **Step 1: Confirm the current failure**

Run: `npx jest tests/receivableController.test.js`
Expected: FAIL — `Tests: 7 failed, 12 passed, 19 total`, all 7 failures showing `TypeError: Cannot read properties of undefined (reading 'findMany')` at `receivableController.js:23` (inside `computeInvoiceTotals`).

- [ ] **Step 2: Add the missing mock**

In `tests/receivableController.test.js`, replace the top of the file (the `jest.mock('../server/config/database', ...)` block through the `beforeEach` call) with:

```javascript
jest.mock('../server/config/database', () => ({
  invoice: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  account: {
    findMany: jest.fn(),
  },
  journalEntry: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');
const glPost = require('../server/utils/glPost');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'CREDIT' }]);
});
```

The rest of the file (everything from `const baseInvoice = {` onward) is unchanged — `accountId: 10` is the account every test's `editBody`/`smallBody` already uses, and `normalBalance: 'CREDIT'` gives it a normal (non-contra) sign for a revenue account, so none of the existing dollar-amount assertions change.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx jest tests/receivableController.test.js`
Expected: PASS — `Tests: 19 passed, 19 total`.

- [ ] **Step 4: Run the full backend test suite**

Run: `npx jest`
Expected: PASS, zero failures anywhere (this was the last known pre-existing failure).

- [ ] **Step 5: Commit**

```bash
git add tests/receivableController.test.js
git commit -m "fix(receivable): mock prisma.account.findMany so updateInvoice tests exercise the real contra-account math"
```

---

## Plan Self-Review Notes

- **Spec coverage:** schema drop (Task 1), shared `computeBillTotals`/`buildBillGLLines` + `createBill` sign fix (Task 2), `voidPostedEntriesByReference` extraction + `voidBill` refactor (Task 3), `updateBill` + route + `addBillItems` retirement (Task 4), full frontend edit-mode wiring (Task 5) — every section of `docs/superpowers/specs/2026-08-28-bill-full-edit-design.md` is covered. The user-approved bonus (Task 6) is scoped separately and doesn't touch any file the Bill-editing feature itself depends on.
- **Type/name consistency checked:** `updateBill` (controller) ↔ `ctrl.updateBill` (route) ↔ `pApi.bills.update` (client) ↔ `onEdit`/`modal.type === 'edit'` (UI) all line up; `computeBillTotals`/`buildBillGLLines`/`voidPostedEntriesByReference` are referenced with identical names and signatures everywhere they're consumed across Tasks 2-4.
- **Out-of-scope items intentionally not implemented anywhere in this plan:** editing a `PAID` bill, reversing/editing `PaymentAP` records, an edit-history log, and retrofitting `voidBill`'s own unscoped `findUnique` to be businessId-scoped (noted as pre-existing and explicitly out of scope in the design doc).
