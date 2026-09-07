# Cash Request (Advance & Liquidation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff file a cash request form for money needed before a purchase, route it through approval and release, and settle it against receipts — with the outstanding amount visible in account `1104 Advances to Officers & Employees` until liquidated.

**Architecture:** Hybrid. A new `CashRequest` model owns request → approval → release. The liquidation reuses the existing `ExpenseVoucher` (`type = LIQUIDATION`), linked by a unique FK. All GL posting goes through the existing `glPost.safePost()`. The accounting rules live in a pure, unit-tested module (`server/utils/cashAdvance.js`) so the arithmetic is provable without a database.

**Tech Stack:** Next.js 14 (App Router) · Express · MySQL 8 · Prisma 5 · jest + supertest · Tailwind · lucide-react · react-hot-toast

Source spec: `docs/superpowers/specs/2026-08-03-cash-request-design.md`

## Global Constraints

- **Branch:** work on `feat/cash-request` (already created, off `docs/cash-request-spec`).
- **MySQL, not PostgreSQL.** Prisma `meta.target` on unique violations is a string, not an array.
- **`npx prisma migrate dev` FAILS here** — it is interactive and this environment is non-interactive. Use the `migrate diff` → write `migration.sql` → `migrate deploy` sequence given in Task 1.
- **Stop the dev server before any `prisma generate` or migration.** On Windows the running server locks the Prisma engine DLL and the command fails with `EPERM`.
- **Never run `next build` while `npm run dev` is running.** Both write to `.next/` and the production build corrupts the dev server's chunks — the dev server then 404s on `main-app.js` while `next build` still prints "✓ Compiled successfully". Recovery: stop every instance → delete `.next` → start one.
- **Only one `npm run dev` at a time.** Two instances compile into the same `.next` and clobber each other.
- **Money columns:** `Decimal @db.Decimal(15, 2)`. Quantities: `Decimal @db.Decimal(15, 3)`.
- **Numbering:** derive from the last issued number, never from `count()`. Use `nextDocNumber` from `server/utils/docNumber.js` (introduced on branch `fix/po-number-collision`; if that branch is not merged yet, Task 3 Step 3 includes the fallback).
- **Accountability subject is a free-text `VarChar(100)` name** (`requestedFor`). No FK to `Employee` or `User`. Per-person aging groups by string.
- **One liquidation per request** — enforced by `@unique` on `ExpenseVoucher.cashRequestId`. Partial liquidations are out of scope.
- **Run tests with `npx jest`** (the `test` script is `jest`).

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_cash_requests/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `CashRequest`, `CashRequestItem`, enum `CashRequestStatus`, and field `ExpenseVoucher.cashRequestId Int?`. Later tasks use `prisma.cashRequest` and `prisma.cashRequestItem`.

- [ ] **Step 1: Stop any running dev server**

```bash
# PowerShell — the Prisma engine DLL is locked while the server runs
Get-NetTCPConnection -State Listen -LocalPort 3000,5000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

Expected: no output, and ports 3000/5000 free.

- [ ] **Step 2: Add the enum and models to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
// ─── Cash Requests (advance & liquidation) ─────────────────
enum CashRequestStatus {
  DRAFT
  SUBMITTED
  APPROVED
  RELEASED
  LIQUIDATED
  REJECTED
  CANCELLED
}

model CashRequest {
  id              Int       @id @default(autoincrement())
  businessId      Int       @default(1)
  requestNo       String    @unique @db.VarChar(30)
  requestDate     DateTime  @db.Date
  neededDate      DateTime? @db.Date
  requestedFor    String    @db.VarChar(100)
  purpose         String    @db.Text
  requestedAmount Decimal   @default(0) @db.Decimal(15, 2)
  releasedAmount  Decimal   @default(0) @db.Decimal(15, 2)
  cashAccountCode String?   @db.VarChar(10)
  status          CashRequestStatus @default(DRAFT)
  requestedBy     String?   @db.VarChar(100)
  approvedBy      String?   @db.VarChar(100)
  releasedBy      String?   @db.VarChar(100)
  releasedDate    DateTime? @db.Date
  rejectedReason  String?   @db.Text
  notes           String?   @db.Text
  items           CashRequestItem[]
  liquidation     ExpenseVoucher?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([businessId])
  @@index([status])
  @@index([requestDate])
  @@map("cash_requests")
}

model CashRequestItem {
  id            Int         @id @default(autoincrement())
  requestId     Int
  request       CashRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  description   String      @db.VarChar(255)
  quantity      Decimal?    @db.Decimal(15, 3)
  estimatedCost Decimal     @db.Decimal(15, 2)
  accountId     Int?
  account       Account?    @relation(fields: [accountId], references: [id])

  @@index([requestId])
  @@map("cash_request_items")
}
```

- [ ] **Step 3: Add the back-relations to the two existing models**

In `model ExpenseVoucher`, add these two lines next to the other scalar fields:

```prisma
  cashRequestId  Int?         @unique
  cashRequest    CashRequest? @relation(fields: [cashRequestId], references: [id])
```

In `model Account`, add this line alongside its other back-relations:

```prisma
  cashRequestItems CashRequestItem[]
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client (v5.22.0)`. If it fails with `EPERM`, the dev server is still running — repeat Step 1.

- [ ] **Step 5: Generate the migration SQL**

`prisma migrate dev` is interactive and will fail here. Do this instead:

```bash
DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_add_cash_requests"
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"
cat "$DIR/migration.sql"
```

Expected: `CREATE TABLE cash_requests`, `CREATE TABLE cash_request_items`, and
`ALTER TABLE expense_vouchers ADD COLUMN cashRequestId INTEGER NULL`.
If the SQL contains DROP statements for unrelated tables, STOP — the local DB has drifted from the schema; resolve that before continuing.

- [ ] **Step 6: Apply the migration**

Run: `npx prisma migrate deploy`
Expected: `The following migration(s) have been applied` listing `_add_cash_requests`.

- [ ] **Step 7: Verify the tables exist**

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.cashRequest.count()
  .then(n => console.log('cash_requests table OK, rows:', n))
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => p.\$disconnect());
"
```

Expected: `cash_requests table OK, rows: 0`

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cash-request): add CashRequest schema and migration"
```

---

### Task 2: Accounting core (`cashAdvance.js`)

**Files:**
- Create: `server/utils/cashAdvance.js`
- Test: `tests/cashAdvance.test.js`

**Interfaces:**
- Consumes: `isBalanced` from `server/utils/finance.js`.
- Produces:
  - `buildReleaseEntry({ requestNo, amount, cashAccountCode }) -> { lines }`
  - `buildLiquidationEntry({ requestNo, releasedAmount, lines, cashAccountCode }) -> { lines, variance, mode }` where `mode` is `'RETURN' | 'REIMBURSE' | 'EXACT'`.
  - Each returned line is `{ accountId?, accountCode?, debit?, credit?, description }` — the shape `glPost.post()` accepts.

- [ ] **Step 1: Write the failing test**

Create `tests/cashAdvance.test.js`:

```js
const { buildReleaseEntry, buildLiquidationEntry } = require('../server/utils/cashAdvance');
const { isBalanced } = require('../server/utils/finance');

const sum = (lines, side) => lines.reduce((s, l) => s + Number(l[side] || 0), 0);

describe('buildReleaseEntry', () => {
  test('debits 1104 and credits the chosen cash account', () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000001', amount: 5000, cashAccountCode: '1010' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 5000 });
    expect(lines[1]).toMatchObject({ accountCode: '1010', credit: 5000 });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });

  test('rejects a non-positive amount', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 0, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: -1, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a missing cash account', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 100 }))
      .toThrow(/cash account/i);
  });
});

describe('buildLiquidationEntry', () => {
  const spent = [
    { accountId: 41, amount: 2400, description: 'Plywood 3/4 — 4 pcs' },
    { accountId: 42, amount: 1800, description: 'Paint — 2 gal' },
  ]; // 4,200 total

  test('RETURN: spent less than released, sukli comes back', () => {
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: spent, cashAccountCode: '1010' });
    expect(r.mode).toBe('RETURN');
    expect(r.variance).toBeCloseTo(-800, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', debit: 800 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('REIMBURSE: spent more than released, company pays the difference', () => {
    const over = [{ accountId: 41, amount: 5300, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: over, cashAccountCode: '1010' });
    expect(r.mode).toBe('REIMBURSE');
    expect(r.variance).toBeCloseTo(300, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', credit: 300 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('EXACT: no cash line at all', () => {
    const exact = [{ accountId: 41, amount: 5000, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: exact, cashAccountCode: '1010' });
    expect(r.mode).toBe('EXACT');
    expect(r.variance).toBeCloseTo(0, 2);
    expect(r.lines.filter(l => l.accountCode === '1010')).toHaveLength(0);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('honours per-line accountId and falls back to a code when absent', () => {
    const mixed = [
      { accountId: 41, amount: 1000, description: 'With account' },
      { amount: 500, description: 'No account' },
    ];
    const r = buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 1500, lines: mixed, cashAccountCode: '1010', fallbackAccountCode: '6390' });
    expect(r.lines).toContainEqual(expect.objectContaining({ accountId: 41, debit: 1000 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '6390', debit: 500 }));
  });

  test('rejects an empty or zero-amount line set', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [], cashAccountCode: '1010' }))
      .toThrow(/at least one/i);
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [{ amount: 0, description: 'x' }], cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a non-positive released amount', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 0, lines: spent, cashAccountCode: '1010' }))
      .toThrow(/released/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/cashAdvance.test.js`
Expected: FAIL — `Cannot find module '../server/utils/cashAdvance'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/cashAdvance.js`:

```js
/**
 * Cash advance accounting rules.
 *
 * Release makes the holder accountable:  DR 1104 / CR cash.
 * Liquidation clears that accountability against actual receipts, settling any
 * difference in cash. Pure functions — no database, no Prisma.
 *
 * Line shape returned matches what glPost.post() accepts:
 *   { accountId?, accountCode?, debit?, credit?, description }
 */

const ADVANCES_ACCOUNT = '1104'; // Advances to Officers & Employees

function buildReleaseEntry({ requestNo, amount, cashAccountCode }) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Released amount must be greater than zero');
  if (!cashAccountCode) throw new Error('A cash account is required to release cash');

  return {
    lines: [
      { accountCode: ADVANCES_ACCOUNT, debit: amt,  description: `Cash advance — ${requestNo}` },
      { accountCode: cashAccountCode,  credit: amt, description: `Cash released — ${requestNo}` },
    ],
  };
}

function buildLiquidationEntry({
  requestNo, releasedAmount, lines, cashAccountCode, fallbackAccountCode = '6390',
}) {
  const released = Number(releasedAmount);
  if (!(released > 0)) throw new Error('Released amount must be greater than zero');
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Liquidation needs at least one line');
  }

  const spentLines = lines.map((l) => {
    const amt = Number(l.amount);
    if (!(amt > 0)) throw new Error('Every liquidation line must be greater than zero');
    return l.accountId
      ? { accountId: Number(l.accountId), debit: amt, description: l.description }
      : { accountCode: fallbackAccountCode, debit: amt, description: l.description };
  });

  const actualSpent = spentLines.reduce((s, l) => s + l.debit, 0);
  const variance = Number((actualSpent - released).toFixed(2));

  const out = [...spentLines];

  if (variance < 0) {
    // spent less — sukli returned to the company
    if (!cashAccountCode) throw new Error('A cash account is required to record returned cash');
    out.push({ accountCode: cashAccountCode, debit: -variance, description: `Cash returned — ${requestNo}` });
  }

  out.push({ accountCode: ADVANCES_ACCOUNT, credit: released, description: `Clear advance — ${requestNo}` });

  if (variance > 0) {
    // spent more — company reimburses the holder
    if (!cashAccountCode) throw new Error('A cash account is required to record the reimbursement');
    out.push({ accountCode: cashAccountCode, credit: variance, description: `Reimbursement — ${requestNo}` });
  }

  const mode = variance < 0 ? 'RETURN' : variance > 0 ? 'REIMBURSE' : 'EXACT';
  return { lines: out, variance, mode };
}

module.exports = { buildReleaseEntry, buildLiquidationEntry, ADVANCES_ACCOUNT };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cashAdvance.test.js`
Expected: PASS, 9 tests.

If `isBalanced` is not exported from `server/utils/finance.js`, check its export list — `tests/finance.test.js` imports it, so it exists.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add server/utils/cashAdvance.js tests/cashAdvance.test.js
git commit -m "feat(cash-request): add cash advance release and liquidation entry builders"
```

---

### Task 3: Controller and routes — request lifecycle

No GL posting in this task. Create, read, edit, and move a request through
`DRAFT → SUBMITTED → APPROVED / REJECTED / CANCELLED`.

**Files:**
- Create: `server/controllers/cashRequestController.js`
- Create: `server/routes/cashRequests.js`
- Modify: `server/routes/index.js`
- Modify: `server/index.js`

**Interfaces:**
- Consumes: `nextDocNumber` from `server/utils/docNumber.js`; `createError` from `server/middleware/errorHandler`; `recordAudit` from `server/utils/audit`.
- Produces: controller exports `list`, `getOne`, `create`, `update`, `submit`, `approve`, `reject`, `cancel`. Mounted at `/api/cash-requests`.

- [ ] **Step 1: Ensure the numbering helper exists**

Check for `server/utils/docNumber.js`. If it is missing (branch `fix/po-number-collision` not merged), create it:

```js
function nextDocNumber(prefix, lastNo, pad = 6) {
  const match = lastNo ? String(lastNo).match(/(\d+)$/) : null;
  const n = match ? parseInt(match[1], 10) : 0;
  return `${prefix}${String(n + 1).padStart(pad, '0')}`;
}

module.exports = { nextDocNumber };
```

- [ ] **Step 2: Write the controller**

Create `server/controllers/cashRequestController.js`:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { nextDocNumber } = require('../utils/docNumber');

const genRequestNo = async () => {
  const last = await prisma.cashRequest.findFirst({
    orderBy: { id: 'desc' },
    select: { requestNo: true },
  });
  return nextDocNumber('CR-', last?.requestNo);
};

const sumItems = (items = []) =>
  items.reduce((s, i) => s + Number(i.estimatedCost || 0), 0);

const mapItems = (items = []) =>
  items
    .filter((i) => i.description && Number(i.estimatedCost) > 0)
    .map((i) => ({
      description:   i.description,
      quantity:      i.quantity != null && i.quantity !== '' ? Number(i.quantity) : null,
      estimatedCost: Number(i.estimatedCost),
      accountId:     i.accountId ? Number(i.accountId) : null,
    }));

exports.list = async (req, res, next) => {
  try {
    const { status, search, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [
      { requestNo:    { contains: search } },
      { requestedFor: { contains: search } },
      { purpose:      { contains: search } },
    ];
    if (from || to) where.requestDate = {
      ...(from && { gte: new Date(from) }),
      ...(to   && { lte: new Date(to) }),
    };

    const [data, total] = await Promise.all([
      prisma.cashRequest.findMany({
        where,
        include: { items: true, liquidation: { select: { id: true, voucherNo: true, totalAmount: true } } },
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.cashRequest.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const cr = await prisma.cashRequest.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: {
        items: { include: { account: { select: { accountCode: true, accountName: true } } } },
        liquidation: { include: { items: true } },
      },
    });
    if (!cr) throw createError('Cash request not found', 404);
    res.json(cr);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    if (!requestedFor?.trim()) throw createError('Requested for (name) is required', 400);
    if (!purpose?.trim())      throw createError('Purpose is required', 400);

    const rows = mapItems(items);
    if (!rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const requestNo = await genRequestNo();
    const cr = await prisma.cashRequest.create({
      data: {
        businessId:      req.businessId,
        requestNo,
        requestDate:     requestDate ? new Date(requestDate) : new Date(),
        neededDate:      neededDate ? new Date(neededDate) : null,
        requestedFor:    requestedFor.trim(),
        purpose:         purpose.trim(),
        requestedAmount: sumItems(rows),
        notes:           notes || null,
        requestedBy:     req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : null,
        items:           { create: rows },
      },
      include: { items: true },
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'CashRequest', entityId: cr.id,
      summary: `Created cash request ${cr.requestNo} for ${cr.requestedFor}`,
    });
    res.status(201).json(cr);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!['DRAFT', 'SUBMITTED'].includes(cr.status)) {
      throw createError('Only DRAFT or SUBMITTED requests can be edited', 400);
    }

    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    const rows = items ? mapItems(items) : null;
    if (items && !rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const updated = await prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.cashRequestItem.deleteMany({ where: { requestId: id } });
        await tx.cashRequestItem.createMany({ data: rows.map((r) => ({ ...r, requestId: id })) });
      }
      return tx.cashRequest.update({
        where: { id },
        data: {
          ...(requestDate  && { requestDate: new Date(requestDate) }),
          neededDate:   neededDate ? new Date(neededDate) : null,
          ...(requestedFor && { requestedFor: requestedFor.trim() }),
          ...(purpose      && { purpose: purpose.trim() }),
          notes: notes ?? null,
          ...(rows && { requestedAmount: sumItems(rows) }),
        },
        include: { items: true },
      });
    });

    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Updated cash request ${cr.requestNo}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// Shared status transition helper
const transition = (from, to, verb, extraData = () => ({})) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!from.includes(cr.status)) {
      throw createError(`Only ${from.join(' or ')} requests can be ${verb}`, 400);
    }
    const updated = await prisma.cashRequest.update({
      where: { id },
      data: { status: to, ...extraData(req) },
      include: { items: true },
    });
    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Cash request ${cr.requestNo} ${verb}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.submit = transition(['DRAFT'], 'SUBMITTED', 'submitted');

exports.approve = transition(['SUBMITTED'], 'APPROVED', 'approved', (req) => ({
  approvedBy: req.body.approvedBy
    || (req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : null),
}));

exports.reject = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) throw createError('A reason is required to reject a request', 400);
    return transition(['SUBMITTED', 'APPROVED'], 'REJECTED', 'rejected', () => ({
      rejectedReason: reason.trim(),
    }))(req, res, next);
  } catch (err) { next(err); }
};

exports.cancel = transition(
  ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED', 'cancelled',
);
```

- [ ] **Step 3: Write the route file**

Create `server/routes/cashRequests.js`:

```js
const router = require('express').Router();
const ctrl = require('../controllers/cashRequestController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',    ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/',   authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.put('/:id', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.update);

router.post('/:id/submit',  authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.submit);
router.post('/:id/approve', authorize('ADMIN', 'MANAGER'),               ctrl.approve);
router.post('/:id/reject',  authorize('ADMIN', 'MANAGER'),               ctrl.reject);
router.post('/:id/cancel',  authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.cancel);

module.exports = router;
```

- [ ] **Step 4: Register the route**

In `server/routes/index.js`, add to the exported object (keep the existing style):

```js
  cashRequests:  require('./cashRequests'),
```

In `server/index.js`, next to the other `app.use` mounts (near line 131):

```js
app.use('/api/cash-requests', routes.cashRequests);
```

- [ ] **Step 5: Verify the server boots and the route responds**

```bash
node -e "require('./server/controllers/cashRequestController'); require('./server/routes/cashRequests'); console.log('modules load OK');"
```

Expected: `modules load OK`

Then start the dev server (`npm run dev`) and:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/cash-requests
```

Expected: `401` — the route exists and correctly demands authentication. A `404` means the mount is wrong.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js server/routes/index.js server/index.js server/utils/docNumber.js
git commit -m "feat(cash-request): add request lifecycle controller and routes"
```

---

### Task 4: Release endpoint and GL posting

**Files:**
- Modify: `server/controllers/cashRequestController.js`
- Modify: `server/routes/cashRequests.js`

**Interfaces:**
- Consumes: `buildReleaseEntry` from Task 2; `glPost.safePost` from `server/utils/glPost`.
- Produces: controller export `release`; route `POST /api/cash-requests/:id/release`.

- [ ] **Step 1: Add the imports**

At the top of `server/controllers/cashRequestController.js`, alongside the existing requires:

```js
const glPost = require('../utils/glPost');
const { buildReleaseEntry } = require('../utils/cashAdvance');
```

- [ ] **Step 2: Add the release handler**

Append to `server/controllers/cashRequestController.js`:

```js
// Hand over the cash. Creates the accountability in 1104.
exports.release = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { releasedAmount, cashAccountCode, releasedBy, releasedDate } = req.body;

    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (cr.status !== 'APPROVED') throw createError('Only APPROVED requests can be released', 400);

    const amount = Number(releasedAmount);
    if (!(amount > 0)) throw createError('Released amount must be greater than zero', 400);
    if (!cashAccountCode) throw createError('Select the cash account the money comes from', 400);

    const cashAccount = await prisma.account.findFirst({
      where: { accountCode: String(cashAccountCode), businessId: req.businessId },
      select: { id: true },
    });
    if (!cashAccount) throw createError(`Cash account ${cashAccountCode} does not exist`, 400);

    // Throws on bad input before anything is written
    const { lines } = buildReleaseEntry({ requestNo: cr.requestNo, amount, cashAccountCode });

    const updated = await prisma.cashRequest.update({
      where: { id },
      data: {
        status:          'RELEASED',
        releasedAmount:  amount,
        cashAccountCode: String(cashAccountCode),
        releasedBy:      releasedBy
          || (req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : null),
        releasedDate:    releasedDate ? new Date(releasedDate) : new Date(),
      },
      include: { items: true },
    });

    await glPost.safePost({
      entryDate:   releasedDate || new Date().toISOString().slice(0, 10),
      description: `Cash Advance — ${cr.requestNo} (${cr.requestedFor})`,
      reference:   cr.requestNo,
      lines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await recordAudit({
      req, action: 'RELEASE', entity: 'CashRequest', entityId: id,
      summary: `Released ₱${amount.toLocaleString()} on ${cr.requestNo} to ${cr.requestedFor}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};
```

- [ ] **Step 3: Add the route**

In `server/routes/cashRequests.js`, after the `cancel` route:

```js
router.post('/:id/release', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.release);
```

- [ ] **Step 4: Verify the entry posts correctly**

With the dev server running and a released request created through the UI or curl, check the generated journal entry:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.journalEntry.findFirst({
  where: { reference: { startsWith: 'CR-' } },
  orderBy: { id: 'desc' },
  include: { lines: { include: { account: { select: { accountCode: true } } } } },
}).then(e => {
  if (!e) return console.log('no CR journal entry yet');
  console.log(e.entryNo, e.description);
  e.lines.forEach(l => console.log(' ', l.account.accountCode, 'DR', String(l.debit), 'CR', String(l.credit)));
}).finally(() => p.\$disconnect());
"
```

Expected: two lines — `1104 DR <amount>` and the chosen cash account `CR <amount>`.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js
git commit -m "feat(cash-request): release cash and post DR 1104 / CR cash"
```

---

### Task 5: Liquidation endpoint, voucher link, and the ExpenseVoucher fix

**Files:**
- Modify: `server/controllers/cashRequestController.js`
- Modify: `server/routes/cashRequests.js`
- Modify: `server/controllers/expenseController.js`
- Modify: `app/(dashboard)/expenses/page.jsx:23`

**Interfaces:**
- Consumes: `buildLiquidationEntry` from Task 2.
- Produces: controller export `liquidate`; route `POST /api/cash-requests/:id/liquidate`. Creates an `ExpenseVoucher` with `type: 'LIQUIDATION'`, `status: 'PAID'`, `cashRequestId` set.

- [ ] **Step 1: Add the import**

In `server/controllers/cashRequestController.js`, extend the existing cashAdvance require:

```js
const { buildReleaseEntry, buildLiquidationEntry } = require('../utils/cashAdvance');
```

- [ ] **Step 2: Add the liquidate handler**

Append to `server/controllers/cashRequestController.js`:

```js
// Settle the advance against receipts. Clears 1104 and books the real expense.
exports.liquidate = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { lines, receiptNo, liquidationDate, notes } = req.body;

    const cr = await prisma.cashRequest.findFirst({
      where: { id, businessId: req.businessId },
      include: { liquidation: { select: { id: true } } },
    });
    if (!cr) throw createError('Cash request not found', 404);
    if (cr.status !== 'RELEASED') throw createError('Only RELEASED requests can be liquidated', 400);
    if (cr.liquidation) throw createError('This request has already been liquidated', 400);

    const spent = (lines || [])
      .filter((l) => l.description && Number(l.amount) > 0)
      .map((l) => ({
        description: l.description,
        amount:      Number(l.amount),
        accountId:   l.accountId ? Number(l.accountId) : null,
        receiptNo:   l.receiptNo || null,
      }));
    if (!spent.length) throw createError('Add at least one liquidation line', 400);

    // Throws on bad input before anything is written
    const { lines: glLines, variance, mode } = buildLiquidationEntry({
      requestNo:       cr.requestNo,
      releasedAmount:  Number(cr.releasedAmount),
      lines:           spent,
      cashAccountCode: cr.cashAccountCode,
    });

    const actualSpent = spent.reduce((s, l) => s + l.amount, 0);
    const dateStr = liquidationDate || new Date().toISOString().slice(0, 10);

    const voucherNo = await (async () => {
      const last = await prisma.expenseVoucher.findFirst({
        orderBy: { id: 'desc' }, select: { voucherNo: true },
      });
      return nextDocNumber('EV-', last?.voucherNo);
    })();

    const result = await prisma.$transaction(async (tx) => {
      const voucher = await tx.expenseVoucher.create({
        data: {
          businessId:  req.businessId,
          voucherNo,
          type:        'LIQUIDATION',
          date:        new Date(dateStr),
          payee:       cr.requestedFor,
          category:    'MISCELLANEOUS',
          purpose:     `Liquidation of ${cr.requestNo} — ${cr.purpose}`,
          totalAmount: actualSpent,
          receiptNo:   receiptNo || null,
          status:      'PAID',
          requestedBy: cr.requestedFor,
          approvedBy:  cr.approvedBy,
          paidDate:    new Date(dateStr),
          notes:       notes || null,
          cashRequestId: cr.id,
          items: { create: spent.map((l) => ({
            description: l.description,
            accountId:   l.accountId,
            amount:      l.amount,
            receiptNo:   l.receiptNo,
          })) },
        },
        include: { items: true },
      });

      const updated = await tx.cashRequest.update({
        where: { id },
        data: { status: 'LIQUIDATED' },
        include: { items: true, liquidation: { include: { items: true } } },
      });

      return { voucher, updated };
    });

    await glPost.safePost({
      entryDate:   dateStr,
      description: `Liquidation — ${cr.requestNo} (${cr.requestedFor})`,
      reference:   cr.requestNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await recordAudit({
      req, action: 'LIQUIDATE', entity: 'CashRequest', entityId: id,
      summary: `Liquidated ${cr.requestNo} — spent ₱${actualSpent.toLocaleString()} of ₱${Number(cr.releasedAmount).toLocaleString()} (${mode})`,
    });

    res.json({ ...result.updated, variance, mode });
  } catch (err) { next(err); }
};
```

- [ ] **Step 3: Add the route**

In `server/routes/cashRequests.js`:

```js
router.post('/:id/liquidate', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.liquidate);
```

- [ ] **Step 4: Make `markPaid` post liquidations against 1104, not cash**

`expenseController.markPaid` posts `DR expense / CR cash` for every voucher type.
For a liquidation that is wrong — the credit must clear `1104`, not cash.

This is a defensive branch, not the normal path: the cash request `/liquidate`
endpoint creates its voucher already `PAID` and already posted, and `markPaid`'s
existing `if (voucher.status !== 'APPROVED')` guard rejects an already-`PAID`
voucher. The branch matters only if a `LIQUIDATION` voucher ever reaches
`APPROVED` by another route, and it guarantees such a voucher can never post the
wrong entry.

In `server/controllers/expenseController.js`, add the import at the top:

```js
const { buildLiquidationEntry } = require('../utils/cashAdvance');
```

Then in `markPaid`, replace the single `glPost.safePost({...})` call with this
branch. Keep the existing `drLines` and `cashCode` construction above it
untouched:

```js
    if (voucher.type === 'LIQUIDATION' && voucher.cashRequestId) {
      const request = await prisma.cashRequest.findUnique({
        where: { id: voucher.cashRequestId },
        select: { requestNo: true, releasedAmount: true, cashAccountCode: true },
      });
      if (!request) throw createError('Linked cash request not found', 404);

      const { lines } = buildLiquidationEntry({
        requestNo:       request.requestNo,
        releasedAmount:  Number(request.releasedAmount),
        lines:           voucher.items.map((i) => ({
          description: i.description,
          amount:      Number(i.amount),
          accountId:   i.accountId,
        })),
        cashAccountCode: request.cashAccountCode,
      });

      await glPost.safePost({
        entryDate:   paidDate || new Date().toISOString().slice(0, 10),
        description: `Liquidation — ${request.requestNo} (${voucher.payee})`,
        reference:   request.requestNo,
        lines,
        userId:      req.user?.id || 1,
        businessId:  req.businessId,
      });
    } else {
      await glPost.safePost({
        entryDate:   paidDate || new Date().toISOString().slice(0, 10),
        description: `Expense Voucher — ${voucher.voucherNo} (${voucher.payee})`,
        reference:   voucher.voucherNo,
        lines: [
          ...drLines,
          { accountCode: cashCode, credit: totalAmt, description: `Cash paid — ${voucher.voucherNo}` },
        ],
        userId:     req.user?.id || 1,
        businessId: req.businessId,
      });
    }
```

A `LIQUIDATION` voucher must never post `CR cash` for the full amount — that
would leave `1104` uncleared and double-count the cash outflow.

- [ ] **Step 5: Remove CASH_ADVANCE from the Expense Voucher type picker**

In `app/(dashboard)/expenses/page.jsx`, delete this line (line 23):

```jsx
  { value: 'CASH_ADVANCE',   label: 'Cash Advance',    sub: 'Advance given before the expense',      color: 'orange' },
```

Cash advances now live in the Cash Request module. Leave the `CASH_ADVANCE` enum
value in the schema so existing rows still read.

- [ ] **Step 6: Verify all three liquidation cases post balanced entries**

```bash
node -e "
const { buildLiquidationEntry } = require('./server/utils/cashAdvance');
const { isBalanced } = require('./server/utils/finance');
const cases = [
  ['RETURN',    5000, [{ accountId: 1, amount: 4200, description: 'x' }]],
  ['REIMBURSE', 5000, [{ accountId: 1, amount: 5300, description: 'x' }]],
  ['EXACT',     5000, [{ accountId: 1, amount: 5000, description: 'x' }]],
];
for (const [label, released, lines] of cases) {
  const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: released, lines, cashAccountCode: '1010' });
  console.log(label, '-> mode', r.mode, '| variance', r.variance, '| balanced', isBalanced(r.lines));
}
"
```

Expected:
```
RETURN -> mode RETURN | variance -800 | balanced true
REIMBURSE -> mode REIMBURSE | variance 300 | balanced true
EXACT -> mode EXACT | variance 0 | balanced true
```

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js server/controllers/expenseController.js "app/(dashboard)/expenses/page.jsx"
git commit -m "feat(cash-request): liquidate against receipts, clear 1104, link the voucher"
```

---

### Task 6: Summary and unliquidated aging endpoints

**Files:**
- Modify: `server/controllers/cashRequestController.js`
- Modify: `server/routes/cashRequests.js`

**Interfaces:**
- Produces: controller exports `summary`, `unliquidated`; routes `GET /api/cash-requests/summary` and `GET /api/cash-requests/unliquidated`.
- `summary` returns `{ pendingApproval, awaitingRelease, releasedCount, outstandingAmount }`.
- `unliquidated` returns an array of `{ requestedFor, count, amount, oldestDays }`, largest amount first.

- [ ] **Step 1: Add both handlers**

Append to `server/controllers/cashRequestController.js`:

```js
exports.summary = async (req, res, next) => {
  try {
    const where = { businessId: req.businessId };
    const [pendingApproval, awaitingRelease, released] = await Promise.all([
      prisma.cashRequest.count({ where: { ...where, status: 'SUBMITTED' } }),
      prisma.cashRequest.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.cashRequest.findMany({
        where: { ...where, status: 'RELEASED' },
        select: { releasedAmount: true },
      }),
    ]);

    res.json({
      pendingApproval,
      awaitingRelease,
      releasedCount:     released.length,
      outstandingAmount: released.reduce((s, r) => s + Number(r.releasedAmount), 0),
    });
  } catch (err) { next(err); }
};

// Outstanding advances grouped by holder. Groups by the free-text name, so
// spelling variants of the same person appear as separate rows.
exports.unliquidated = async (req, res, next) => {
  try {
    const rows = await prisma.cashRequest.findMany({
      where: { businessId: req.businessId, status: 'RELEASED' },
      select: { requestNo: true, requestedFor: true, releasedAmount: true, releasedDate: true },
      orderBy: { releasedDate: 'asc' },
    });

    const now = Date.now();
    const byPerson = new Map();
    for (const r of rows) {
      const key = r.requestedFor;
      const days = r.releasedDate
        ? Math.floor((now - new Date(r.releasedDate).getTime()) / 86400000)
        : 0;
      const cur = byPerson.get(key) || { requestedFor: key, count: 0, amount: 0, oldestDays: 0 };
      cur.count  += 1;
      cur.amount += Number(r.releasedAmount);
      cur.oldestDays = Math.max(cur.oldestDays, days);
      byPerson.set(key, cur);
    }

    res.json([...byPerson.values()].sort((a, b) => b.amount - a.amount));
  } catch (err) { next(err); }
};
```

- [ ] **Step 2: Add the routes ABOVE the `/:id` route**

Express matches in order — `/summary` would otherwise be captured by `/:id`.
In `server/routes/cashRequests.js`, place these immediately after `router.get('/', ctrl.list);`:

```js
router.get('/summary',      ctrl.summary);
router.get('/unliquidated', ctrl.unliquidated);
```

- [ ] **Step 3: Verify the ordering is correct**

With the dev server running and a valid token, or simply check the 401 vs 404 shape:

```bash
curl -s -o /dev/null -w "summary:%{http_code}\n"      http://localhost:5000/api/cash-requests/summary
curl -s -o /dev/null -w "unliquidated:%{http_code}\n" http://localhost:5000/api/cash-requests/unliquidated
```

Expected: both `401` (route exists, auth required). A `500` means `/:id` swallowed the path and `Number('summary')` produced `NaN`.

- [ ] **Step 4: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js
git commit -m "feat(cash-request): add summary and unliquidated aging endpoints"
```

---

### Task 7: Frontend wiring — API client, permissions, navigation

**Files:**
- Modify: `lib/api.js`
- Modify: `lib/permissions.js`
- Modify: `components/layout/Sidebar.jsx`

**Interfaces:**
- Produces: named export `cashRequests` from `lib/api.js` with methods `list`, `summary`, `unliquidated`, `get`, `create`, `update`, `submit`, `approve`, `reject`, `cancel`, `release`, `liquidate`. Task 8 consumes these.

- [ ] **Step 1: Add the API module**

In `lib/api.js`, after the `purchaseOrders` export (around line 94):

```js
export const cashRequests = {
  list:         (params)   => api.get('/cash-requests', { params }),
  summary:      ()         => api.get('/cash-requests/summary'),
  unliquidated: ()         => api.get('/cash-requests/unliquidated'),
  get:          (id)       => api.get(`/cash-requests/${id}`),
  create:       (data)     => api.post('/cash-requests', data),
  update:       (id, data) => api.put(`/cash-requests/${id}`, data),
  submit:       (id)       => api.post(`/cash-requests/${id}/submit`),
  approve:      (id, data) => api.post(`/cash-requests/${id}/approve`, data),
  reject:       (id, data) => api.post(`/cash-requests/${id}/reject`, data),
  cancel:       (id)       => api.post(`/cash-requests/${id}/cancel`),
  release:      (id, data) => api.post(`/cash-requests/${id}/release`, data),
  liquidate:    (id, data) => api.post(`/cash-requests/${id}/liquidate`, data),
};
```

- [ ] **Step 2: Grant route access**

In `lib/permissions.js`, extend the `payable` module's `routes` array — it already owns `/expenses`:

```js
  { key: 'payable',    label: 'Purchases (Payables)', routes: ['/payable', '/purchase-orders', '/expenses', '/cash-requests'] },
```

- [ ] **Step 3: Add the navigation entry**

In `components/layout/Sidebar.jsx`, inside the `Purchases` section's `items` array, after the Expense Vouchers entry:

```jsx
      { label: 'Cash Requests',    icon: HandCoins,    href: '/cash-requests' },
```

Add `HandCoins` to the `lucide-react` import list at the top of the file.
`HandCoins` draws coins in an open palm — verified to contain no dollar-sign glyph, unlike `Receipt`.

- [ ] **Step 4: Verify the nav renders and the route is permitted**

Start the dev server, log in, and confirm "Cash Requests" appears under Purchases.
Navigating to `/cash-requests` should render a 404 page (the page does not exist
yet) rather than redirecting to the dashboard — a redirect means the permissions
entry did not take.

- [ ] **Step 5: Commit**

```bash
git add lib/api.js lib/permissions.js components/layout/Sidebar.jsx
git commit -m "feat(cash-request): wire API client, permissions and navigation"
```

---

### Task 8: Cash Requests page and modals

**Files:**
- Create: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `cashRequests` from `lib/api.js` (Task 7); `AccountSelect` from `components/ui/AccountSelect`; `NumberInput` from `components/NumberInput`; `formatCurrency`/`formatDate` from `lib/auth`.
- Produces: the route `/cash-requests`.

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/cash-requests/page.jsx`:

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashRequests as crApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, Check, X, Send, HandCoins, AlertCircle, Clock, CheckCircle2, Ban,
} from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'RELEASED', 'LIQUIDATED', 'REJECTED', 'CANCELLED'];

const STATUS_BADGE = {
  DRAFT:      'badge-gray',
  SUBMITTED:  'badge-yellow',
  APPROVED:   'badge-blue',
  RELEASED:   'badge-yellow',
  LIQUIDATED: 'badge-green',
  REJECTED:   'badge-red',
  CANCELLED:  'badge-gray',
};

const CASH_ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on Hand' },
  { code: '1011', label: '1011 — Petty Cash Fund' },
  { code: '1012', label: '1012 — Cash — GCash' },
  { code: '1020', label: '1020 — Cash in Bank (BDO Checking)' },
];

const todayStr = () => new Date().toISOString().split('T')[0];
const emptyItem = () => ({ description: '', quantity: '1', estimatedCost: '', accountId: '' });

// ─── New / Edit Request Modal ─────────────────────────────────
function RequestModal({ request, accounts, names, onClose, onSaved }) {
  const isEdit = !!request?.id;
  const [form, setForm] = useState(
    isEdit
      ? {
          requestDate:  request.requestDate?.split('T')[0] || todayStr(),
          neededDate:   request.neededDate?.split('T')[0] || '',
          requestedFor: request.requestedFor || '',
          purpose:      request.purpose || '',
          notes:        request.notes || '',
          items: request.items?.length
            ? request.items.map((i) => ({
                description: i.description,
                quantity: i.quantity != null ? String(i.quantity) : '',
                estimatedCost: String(i.estimatedCost),
                accountId: i.accountId ? String(i.accountId) : '',
              }))
            : [emptyItem()],
        }
      : { requestDate: todayStr(), neededDate: '', requestedFor: '', purpose: '', notes: '', items: [emptyItem()] }
  );
  const [saving, setSaving] = useState(false);

  const setItem = (i, k, v) =>
    setForm((f) => ({ ...f, items: f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setForm((f) => ({ ...f, items: [...f.items, emptyItem()] }));
  const rmItem  = (i) => setForm((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const total = form.items.reduce((s, i) => s + (Number(i.estimatedCost) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.requestedFor.trim()) { toast.error('Enter who will receive the cash'); return; }
    if (!form.purpose.trim())      { toast.error('Enter the purpose'); return; }
    const items = form.items.filter((i) => i.description && Number(i.estimatedCost) > 0);
    if (!items.length) { toast.error('Add at least one item with an estimated cost'); return; }

    setSaving(true);
    try {
      const payload = { ...form, items };
      if (isEdit) await crApi.update(request.id, payload);
      else        await crApi.create(payload);
      toast.success(isEdit ? 'Cash request updated' : 'Cash request created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? `Edit ${request.requestNo}` : 'New Cash Request'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Requested For (name) *</label>
                <input
                  className="input" list="cr-names" required
                  value={form.requestedFor}
                  onChange={(e) => setForm((f) => ({ ...f, requestedFor: e.target.value }))}
                  placeholder="e.g. Juan Dela Cruz"
                />
                <datalist id="cr-names">
                  {names.map((n) => <option key={n} value={n} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="label">Purpose *</label>
                <input
                  className="input" required value={form.purpose}
                  onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
                  placeholder="e.g. Materials para sa booth build"
                />
              </div>
              <div className="form-group">
                <label className="label">Request Date *</label>
                <input type="date" className="input" required value={form.requestDate}
                  onChange={(e) => setForm((f) => ({ ...f, requestDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Needed By</label>
                <input type="date" className="input" value={form.neededDate}
                  onChange={(e) => setForm((f) => ({ ...f, neededDate: e.target.value }))} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Items to Buy (estimate)</h4>
                <button type="button" onClick={addItem} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Item
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-28 text-right">Qty</th>
                      <th className="w-56">Intended Account</th>
                      <th className="w-40 text-right">Est. Cost (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i}>
                        <td>
                          <input className="input text-xs" value={it.description}
                            onChange={(e) => setItem(i, 'description', e.target.value)}
                            placeholder="e.g. Plywood 3/4 — 4 pcs" />
                        </td>
                        <td>
                          <NumberInput decimals={3} className="input text-xs text-right"
                            value={it.quantity} onChange={(v) => setItem(i, 'quantity', v)} />
                        </td>
                        <td>
                          <AccountSelect
                            value={it.accountId}
                            onChange={(v) => setItem(i, 'accountId', v)}
                            accounts={accounts}
                            placeholder="— optional —"
                          />
                        </td>
                        <td>
                          <NumberInput className="input text-xs text-right" placeholder="0.00"
                            value={it.estimatedCost} onChange={(v) => setItem(i, 'estimatedCost', v)} />
                        </td>
                        <td>
                          {form.items.length > 1 && (
                            <button type="button" onClick={() => rmItem(i)}
                              className="p-1 text-gray-300 hover:text-red-500">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end mt-3">
                <div className="bg-gray-50 rounded-xl p-4 w-72 flex justify-between text-sm font-bold">
                  <span>Total Requested</span>
                  <span className="text-blue-700">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Optional remarks…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <HandCoins className="w-4 h-4" />
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Release Modal ────────────────────────────────────────────
function ReleaseModal({ request, onClose, onDone }) {
  const [form, setForm] = useState({
    releasedAmount:  String(request.requestedAmount),
    cashAccountCode: '1010',
    releasedDate:    todayStr(),
    releasedBy:      '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(form.releasedAmount) > 0)) { toast.error('Enter an amount greater than zero'); return; }
    setSaving(true);
    try {
      await crApi.release(request.id, form);
      toast.success('Cash released');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Release failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Release Cash</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-600">Request</span><span className="font-mono">{request.requestNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">For</span><span className="font-medium">{request.requestedFor}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1.5">
                <span>Requested</span><span>{formatCurrency(request.requestedAmount)}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Amount to Release (₱) *</label>
              <NumberInput className="input" required placeholder="0.00"
                value={form.releasedAmount}
                onChange={(v) => setForm((f) => ({ ...f, releasedAmount: v }))} />
            </div>

            <div className="form-group">
              <label className="label">Cash Source *</label>
              <select className="select" required value={form.cashAccountCode}
                onChange={(e) => setForm((f) => ({ ...f, cashAccountCode: e.target.value }))}>
                {CASH_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Release Date *</label>
              <input type="date" className="input" required value={form.releasedDate}
                onChange={(e) => setForm((f) => ({ ...f, releasedDate: e.target.value }))} />
            </div>

            <p className="text-xs text-gray-500">
              Posts <strong>DR 1104 Advances</strong> / <strong>CR {form.cashAccountCode}</strong>.
              The amount stays outstanding until liquidated.
            </p>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Releasing…' : 'Release Cash'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Liquidate Modal ──────────────────────────────────────────
function LiquidateModal({ request, accounts, onClose, onDone }) {
  const [lines, setLines] = useState([{ description: '', amount: '', accountId: '', receiptNo: '' }]);
  const [receiptNo, setReceiptNo] = useState('');
  const [date, setDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);

  const released = Number(request.releasedAmount);
  const spent    = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const variance = Number((spent - released).toFixed(2));

  const setLine = (i, k, v) =>
    setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addLine = () => setLines((p) => [...p, { description: '', amount: '', accountId: '', receiptNo: '' }]);
  const rmLine  = (i) => setLines((p) => p.filter((_, idx) => idx !== i));

  const submit = async (e) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.description && Number(l.amount) > 0);
    if (!valid.length) { toast.error('Add at least one line with an amount'); return; }
    setSaving(true);
    try {
      await crApi.liquidate(request.id, { lines: valid, receiptNo, liquidationDate: date });
      toast.success('Liquidation recorded');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Liquidation failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">Liquidate {request.requestNo}</h3>
            <p className="text-xs text-gray-400">{request.requestedFor} · released {formatCurrency(released)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Liquidation Date *</label>
                <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">Overall Receipt / OR No.</label>
                <input className="input" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Actual Spend (with receipts)</h4>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Line
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-56">Account *</th>
                      <th className="w-32">Receipt #</th>
                      <th className="w-40 text-right">Amount (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <td>
                          <input className="input text-xs" value={l.description}
                            onChange={(e) => setLine(i, 'description', e.target.value)}
                            placeholder="e.g. Plywood 3/4 — 4 pcs" />
                        </td>
                        <td>
                          <AccountSelect value={l.accountId} onChange={(v) => setLine(i, 'accountId', v)}
                            accounts={accounts} placeholder="— select —" />
                        </td>
                        <td>
                          <input className="input text-xs" value={l.receiptNo}
                            onChange={(e) => setLine(i, 'receiptNo', e.target.value)} placeholder="OR #" />
                        </td>
                        <td>
                          <NumberInput className="input text-xs text-right" placeholder="0.00"
                            value={l.amount} onChange={(v) => setLine(i, 'amount', v)} />
                        </td>
                        <td>
                          {lines.length > 1 && (
                            <button type="button" onClick={() => rmLine(i)} className="p-1 text-gray-300 hover:text-red-500">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <div className="bg-gray-50 rounded-xl p-4 w-80 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-600">Released</span><span>{formatCurrency(released)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">Actual Spent</span><span>{formatCurrency(spent)}</span></div>
                <div className={`flex justify-between font-bold text-base border-t border-gray-200 pt-2 ${
                  variance < 0 ? 'text-green-600' : variance > 0 ? 'text-red-600' : 'text-gray-700'
                }`}>
                  <span>{variance < 0 ? 'Sukli to return' : variance > 0 ? 'Reimburse' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Record Liquidation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function CashRequestsPage() {
  const [rows, setRows]       = useState([]);
  const [summary, setSummary] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus]   = useState('');
  const [search, setSearch]   = useState('');
  const [modal, setModal]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        crApi.list({ status: status || undefined, search: search || undefined, limit: 100 }),
        crApi.summary(),
      ]);
      setRows(list.data.data);
      setSummary(sum.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load cash requests');
    } finally { setLoading(false); }
  }, [status, search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    acctApi.list({ limit: 500 })
      .then((r) => setAccounts(r.data.data || r.data))
      .catch(() => setAccounts([]));
  }, []);

  const names = [...new Set(rows.map((r) => r.requestedFor))];

  const act = async (fn, msg) => {
    try { await fn(); toast.success(msg); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  };

  const reject = async (r) => {
    const reason = window.prompt(`Reason for rejecting ${r.requestNo}?`);
    if (!reason?.trim()) return;
    act(() => crApi.reject(r.id, { reason }), 'Request rejected');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Requests</h1>
          <p className="page-subtitle">Cash advances for purchases — request, approve, release, liquidate</p>
        </div>
        <button onClick={() => setModal({ type: 'new' })} className="btn-primary">
          <Plus className="w-4 h-4" /> New Cash Request
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Pending Approval</p>
            <p className="text-2xl font-bold text-yellow-600">{summary.pendingApproval}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Awaiting Release</p>
            <p className="text-2xl font-bold text-blue-600">{summary.awaitingRelease}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Unliquidated</p>
            <p className="text-2xl font-bold text-gray-800">{summary.releasedCount}</p>
          </div>
          <div className="card card-body">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Outstanding (1104)</p>
            <p className="text-2xl font-bold text-red-600">{formatCurrency(summary.outstandingAmount)}</p>
          </div>
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search request no., name, or purpose…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select sm:w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Request No.</th>
                <th>Requested For</th>
                <th>Purpose</th>
                <th>Date</th>
                <th className="text-right">Requested</th>
                <th className="text-right">Released</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400">No cash requests yet</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs text-blue-700">{r.requestNo}</td>
                  <td className="font-medium">{r.requestedFor}</td>
                  <td className="text-sm text-gray-600 max-w-xs truncate">{r.purpose}</td>
                  <td className="text-sm">{formatDate(r.requestDate)}</td>
                  <td className="text-right">{formatCurrency(r.requestedAmount)}</td>
                  <td className="text-right font-medium">
                    {Number(r.releasedAmount) > 0 ? formatCurrency(r.releasedAmount) : '—'}
                  </td>
                  <td><span className={STATUS_BADGE[r.status]}>{r.status}</span></td>
                  <td className="text-right whitespace-nowrap">
                    {r.status === 'DRAFT' && (
                      <button onClick={() => act(() => crApi.submit(r.id), 'Submitted for approval')}
                        className="btn-secondary btn-sm" title="Submit">
                        <Send className="w-3 h-3" />
                      </button>
                    )}
                    {r.status === 'SUBMITTED' && (
                      <>
                        <button onClick={() => act(() => crApi.approve(r.id, {}), 'Approved')}
                          className="btn-success btn-sm" title="Approve">
                          <Check className="w-3 h-3" />
                        </button>
                        <button onClick={() => reject(r)} className="btn-danger btn-sm ml-1" title="Reject">
                          <Ban className="w-3 h-3" />
                        </button>
                      </>
                    )}
                    {r.status === 'APPROVED' && (
                      <button onClick={() => setModal({ type: 'release', request: r })}
                        className="btn-primary btn-sm" title="Release cash">
                        <HandCoins className="w-3 h-3" /> Release
                      </button>
                    )}
                    {r.status === 'RELEASED' && (
                      <button onClick={() => setModal({ type: 'liquidate', request: r })}
                        className="btn-primary btn-sm" title="Liquidate">
                        <CheckCircle2 className="w-3 h-3" /> Liquidate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modal?.type === 'new' && (
        <RequestModal accounts={accounts} names={names}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'release' && (
        <ReleaseModal request={modal.request}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'liquidate' && (
        <LiquidateModal request={modal.request} accounts={accounts}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the full cycle in the browser**

With the dev server running and logged in, walk the whole flow and check each stage:

1. **New Cash Request** — name, purpose, two items with estimated costs → Create.
   Row appears as `DRAFT`, requested amount equals the sum of the items.
2. **Submit** → status `SUBMITTED`.
3. **Approve** → status `APPROVED`.
4. **Release** ₱5,000 from `1010` → status `RELEASED`; the "Outstanding (1104)" tile increases by 5,000.
5. **Liquidate** with lines totalling ₱4,200 → the variance strip reads
   **"Sukli to return ₱800"** before you submit → status `LIQUIDATED`.

Then confirm both journal entries exist and balance:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.journalEntry.findMany({
  where: { reference: { startsWith: 'CR-' } },
  orderBy: { id: 'asc' },
  include: { lines: { include: { account: { select: { accountCode: true } } } } },
}).then(es => es.forEach(e => {
  const dr = e.lines.reduce((s,l)=>s+Number(l.debit),0);
  const cr = e.lines.reduce((s,l)=>s+Number(l.credit),0);
  console.log(e.entryNo, e.description, '| DR', dr, 'CR', cr, dr===cr ? 'BALANCED' : 'UNBALANCED');
  e.lines.forEach(l => console.log('   ', l.account.accountCode, String(l.debit), String(l.credit)));
})).finally(() => p.\$disconnect());
"
```

Expected: two entries, both `BALANCED`. The first has `1104` on the debit side;
the second has `1104` on the credit side for the full released amount.

Finally confirm `1104` nets to zero for that request — that is the whole point of
the accountability account.

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-request): add Cash Requests page with release and liquidate modals"
```

---

---

### Task 9: Detail modal with workflow timeline and print

**Files:**
- Modify: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `crApi.get` from Task 7; `printDocument`, `phpFmt`, `dateFmt`, `badge` from `lib/print`.
- Produces: a `DetailModal` component and an eye-icon action on every row.

- [ ] **Step 1: Extend the imports**

At the top of `app/(dashboard)/cash-requests/page.jsx`:

```jsx
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
```

`Eye` is already imported from `lucide-react` in Task 8's import list.

- [ ] **Step 2: Add the DetailModal component**

Insert above the `// ─── Main Page ───` comment:

```jsx
// ─── Detail Modal ─────────────────────────────────────────────
function DetailModal({ requestId, onClose }) {
  const [cr, setCr] = useState(null);

  useEffect(() => {
    crApi.get(requestId)
      .then((r) => setCr(r.data))
      .catch(() => toast.error('Failed to load the request'));
  }, [requestId]);

  if (!cr) {
    return (
      <div className="modal-overlay">
        <div className="modal max-w-3xl">
          <div className="modal-body text-center py-16 text-gray-400">Loading…</div>
        </div>
      </div>
    );
  }

  const released = Number(cr.releasedAmount);
  const spent    = Number(cr.liquidation?.totalAmount || 0);
  const variance = cr.liquidation ? Number((spent - released).toFixed(2)) : null;

  const TIMELINE = [
    { label: 'Requested', who: cr.requestedBy, when: cr.requestDate,   done: true },
    { label: 'Approved',  who: cr.approvedBy,  when: null,             done: ['APPROVED','RELEASED','LIQUIDATED'].includes(cr.status) },
    { label: 'Released',  who: cr.releasedBy,  when: cr.releasedDate,  done: ['RELEASED','LIQUIDATED'].includes(cr.status) },
    { label: 'Liquidated',who: null,           when: cr.liquidation?.paidDate, done: cr.status === 'LIQUIDATED' },
  ];

  const handlePrint = () => {
    const itemsHTML = (cr.items || []).map((i) => `
      <tr>
        <td>${i.description}</td>
        <td class="right">${i.quantity != null ? Number(i.quantity).toLocaleString() : '—'}</td>
        <td class="right mono">${phpFmt(i.estimatedCost)}</td>
      </tr>`).join('');

    const liqHTML = cr.liquidation ? `
      <div class="section-title">Liquidation — ${cr.liquidation.voucherNo}</div>
      <table>
        <thead><tr><th>Description</th><th>Receipt #</th><th class="right">Amount</th></tr></thead>
        <tbody>${(cr.liquidation.items || []).map((l) => `
          <tr>
            <td>${l.description}</td>
            <td class="mono small">${l.receiptNo || '—'}</td>
            <td class="right mono">${phpFmt(l.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
      <div class="totals-block" style="max-width:320px;margin-left:auto;margin-top:12px;">
        <div class="totals-row"><span class="gray">Released</span><span class="mono">${phpFmt(released)}</span></div>
        <div class="totals-row"><span class="gray">Actual Spent</span><span class="mono">${phpFmt(spent)}</span></div>
        <div class="totals-divider"></div>
        <div class="totals-row totals-total">
          <span>${variance < 0 ? 'Sukli Returned' : variance > 0 ? 'Reimbursed' : 'Exact'}</span>
          <span class="mono">${phpFmt(Math.abs(variance))}</span>
        </div>
      </div>` : '';

    const body = `
      <div class="info-grid">
        <div class="info-box"><div class="info-lbl">Request No.</div><div class="info-val mono">${cr.requestNo}</div></div>
        <div class="info-box"><div class="info-lbl">Requested For</div><div class="info-val">${cr.requestedFor}</div></div>
        <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${badge(cr.status)}</div></div>
        <div class="info-box"><div class="info-lbl">Request Date</div><div class="info-val">${dateFmt(cr.requestDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Needed By</div><div class="info-val">${cr.neededDate ? dateFmt(cr.neededDate) : '—'}</div></div>
        <div class="info-box"><div class="info-lbl">Cash Source</div><div class="info-val mono">${cr.cashAccountCode || '—'}</div></div>
      </div>
      <div class="desc-box">${cr.purpose}</div>
      <div class="section-title">Requested Items (estimate)</div>
      <table>
        <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Est. Cost</th></tr></thead>
        <tbody>${itemsHTML}</tbody>
      </table>
      ${liqHTML}`;

    printDocument(`Cash Request — ${cr.requestNo}`, `${cr.requestedFor} · ${dateFmt(cr.requestDate)}`, body);
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{cr.requestNo}</h3>
            <p className="text-sm text-gray-500">{cr.requestedFor}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={STATUS_BADGE[cr.status]}>{cr.status}</span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-gray-700">{cr.purpose}</div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Progress</h4>
            <div className="flex items-center gap-2">
              {TIMELINE.map((t, i) => (
                <div key={t.label} className="flex items-center gap-2 flex-1">
                  <div className={`flex-1 rounded-lg px-3 py-2 text-center text-xs ${
                    t.done ? 'bg-green-50 text-green-700 border border-green-200'
                           : 'bg-gray-50 text-gray-400 border border-gray-200'
                  }`}>
                    <p className="font-semibold">{t.label}</p>
                    {t.who && <p className="text-[10px] opacity-70">{t.who}</p>}
                    {t.when && <p className="text-[10px] opacity-70">{formatDate(t.when)}</p>}
                  </div>
                  {i < TIMELINE.length - 1 && <span className="text-gray-300">→</span>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Requested Items (estimate)</h4>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Est. Cost</th></tr>
                </thead>
                <tbody>
                  {cr.items?.map((i) => (
                    <tr key={i.id}>
                      <td>{i.description}</td>
                      <td className="text-right">{i.quantity != null ? Number(i.quantity).toLocaleString() : '—'}</td>
                      <td className="text-right">{formatCurrency(i.estimatedCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Requested</span><span>{formatCurrency(cr.requestedAmount)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Released</span><span>{released > 0 ? formatCurrency(released) : '—'}</span></div>
            {cr.liquidation && (
              <>
                <div className="flex justify-between"><span className="text-gray-600">Actual Spent</span><span>{formatCurrency(spent)}</span></div>
                <div className={`flex justify-between font-bold text-base border-t border-gray-200 pt-2 ${
                  variance < 0 ? 'text-green-600' : variance > 0 ? 'text-red-600' : 'text-gray-700'
                }`}>
                  <span>{variance < 0 ? 'Sukli returned' : variance > 0 ? 'Reimbursed' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
              </>
            )}
            {cr.status === 'RELEASED' && (
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 text-red-600">
                <span>Outstanding in 1104</span><span>{formatCurrency(released)}</span>
              </div>
            )}
          </div>

          {cr.rejectedReason && (
            <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-red-700">
              <strong>Rejected:</strong> {cr.rejectedReason}
            </div>
          )}

          {cr.liquidation && (
            <p className="text-xs text-gray-500">
              Liquidation voucher: <span className="font-mono text-blue-600">{cr.liquidation.voucherNo}</span>
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={handlePrint} className="btn-secondary">Print</button>
          <button onClick={onClose} className="btn-primary">Close</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the row action and render the modal**

In the actions cell of the table, before the status-specific buttons:

```jsx
                    <button onClick={() => setModal({ type: 'detail', id: r.id })}
                      className="btn-secondary btn-sm mr-1" title="View">
                      <Eye className="w-3 h-3" />
                    </button>
```

And alongside the other modal renders at the bottom of the page:

```jsx
      {modal?.type === 'detail' && (
        <DetailModal requestId={modal.id} onClose={() => setModal(null)} />
      )}
```

- [ ] **Step 4: Verify**

Open a `LIQUIDATED` request's detail modal and confirm:
- all four timeline stages show green
- the totals block shows Requested, Released, Actual Spent and the correct
  Sukli/Reimbursed/Exact label
- the liquidation voucher number appears
- **Print** opens the letterhead window with both the requested items and the
  liquidation lines

Then open a `RELEASED` (not yet liquidated) request and confirm it shows
**"Outstanding in 1104"** with the released amount.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-request): add detail modal with timeline and print"
```

---

## Done

After Task 9, the module is complete: request → submit → approve → release → liquidate,
with `1104 Advances to Officers & Employees` carrying every outstanding advance and
clearing on liquidation.

**Follow-ups deliberately excluded** (from the spec's Out of Scope):
partial liquidations, salary deduction for unliquidated advances, receipt
attachments, and converting a request into a PO or bill.
