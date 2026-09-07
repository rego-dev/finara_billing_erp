# Cash Sales (Non-Invoiced) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff record a walk-in/counter cash sale that never gets a formal AR Invoice, so it still shows up in the books — VAT Summary, Daily Remittance, Income Statement — instead of being invisible, which is the gap today (`dailyRemittanceController.calculate()`'s `totalSales` is sourced only from `Invoice`).

**Architecture:** A new, single-line `CashSale` model, direct-posted (no draft/approval step — cash is already in hand). GL posting goes through the existing `glPost.safePost()`. The 2-or-3-line entry construction lives in a pure, unit-tested helper (`server/utils/cashSale.js`), matching the `cashAdvance.js` precedent. Void sets both `CashSale.status` and its linked `JournalEntry.status` to their respective "gone" values, so every report (which only sums `POSTED` journal entries) drops it with no reversing entry needed. `dailyRemittanceController.calculate()` gets a second query merging active cash sales into its existing totals/items.

**Tech Stack:** Next.js 14 (App Router) · Express · MySQL 8 · Prisma 5 · jest · Tailwind · lucide-react · react-hot-toast

Source spec: `docs/superpowers/specs/2026-08-10-cash-sales-design.md`

## Global Constraints

- **MySQL, not PostgreSQL.** Prisma `meta.target` on unique violations is a string, not an array.
- **`npx prisma migrate dev` FAILS here** — it is interactive and this environment is non-interactive. Use the `migrate diff` → write `migration.sql` → `migrate deploy` sequence in Task 1.
- **Stop the dev server before any `prisma generate` or migration.** On Windows the running server locks the Prisma engine DLL and the command fails with `EPERM`. **The dev server belongs to the user, not you** — ask them to stop it (or confirm it's already stopped) before Task 1, and let them know they need to restart it after.
- **Never run `next build` while `npm run dev` is running.** Both write to `.next/` and the production build corrupts the dev server's chunks.
- **Only one `npm run dev` at a time.**
- **Money columns:** `Decimal @db.Decimal(15, 2)`.
- **Numbering:** derive from the last issued number via `nextDocNumber('CS-', lastSaleNo)` from `server/utils/docNumber.js` — never from `count()`.
- **Tests are mocked unit tests, not integration tests.** `tests/*.test.js` in this repo mock `../server/config/database` and call controller exports directly with a fake `req`/`res` — there is no supertest/HTTP layer in the test suite. Follow that pattern exactly.
- **Run tests with `npx jest`** (the `test` script is `jest`).
- **`JournalStatus` enum is `DRAFT` / `POSTED` / `VOIDED`** (`prisma/schema.prisma:190`) — note the "ED", it is not `VOID`. `CashSaleStatus` (this plan's own new enum) is `ACTIVE` / `VOID` — different model, different spelling, don't mix them up.
- **No `lib/permissions.js` change needed.** Its `receivable` module already lists `routes: ['/receivable']` and `canAccess()` matches by prefix (`pathname.startsWith(r + '/')`), so `/receivable/cash-sales` is already covered.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_cash_sales/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `CashSale`, enum `CashSaleStatus`, back-relation fields `Account.cashSales` and `JournalEntry.cashSale`. Later tasks use `prisma.cashSale`.

- [ ] **Step 1: Confirm the dev server is stopped**

Ask the user to stop `npm run dev` (or confirm it's already stopped) before continuing — the Prisma engine DLL is locked while it runs on Windows. Do not proceed to Step 4 until confirmed.

- [ ] **Step 2: Add the enum and model to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
// ─── Cash Sales (non-invoiced) ──────────────────────────────
enum CashSaleStatus {
  ACTIVE
  VOID
}

model CashSale {
  id             Int            @id @default(autoincrement())
  businessId     Int            @default(1)
  saleNo         String         @unique @db.VarChar(30)
  saleDate       DateTime       @db.Date
  buyerName      String?        @db.VarChar(150)
  description    String         @db.Text
  accountId      Int
  account        Account        @relation(fields: [accountId], references: [id])
  vatCode        VatCode        @default(VAT)
  subtotal       Decimal        @default(0) @db.Decimal(15, 2)
  vatAmount      Decimal        @default(0) @db.Decimal(15, 2)
  totalAmount    Decimal        @default(0) @db.Decimal(15, 2)
  paymentMethod  String         @db.VarChar(30)
  status         CashSaleStatus @default(ACTIVE)
  voidedReason   String?        @db.Text
  voidedAt       DateTime?
  notes          String?        @db.Text
  journalEntryId Int?           @unique
  journalEntry   JournalEntry?  @relation(fields: [journalEntryId], references: [id])
  createdBy      Int?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@index([businessId])
  @@index([saleDate])
  @@index([status])
  @@map("cash_sales")
}
```

- [ ] **Step 3: Add the back-relations to `Account` and `JournalEntry`**

In `model Account` (`prisma/schema.prisma:107`), add this line next to `cashRequestItems CashRequestItem[]` (line 130):

```prisma
  cashSales        CashSale[]
```

In `model JournalEntry` (`prisma/schema.prisma:152`), add this line next to `lines JournalLine[]` (line 166):

```prisma
  cashSale    CashSale?
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`. If it fails with `EPERM`, the dev server is still running — go back to Step 1.

- [ ] **Step 5: Generate the migration SQL**

```bash
DIR="prisma/migrations/$(date +%Y%m%d%H%M%S)_add_cash_sales"
mkdir -p "$DIR"
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$DIR/migration.sql"
cat "$DIR/migration.sql"
```

Expected: `CREATE TABLE cash_sales` with columns matching Step 2, plus its
FK constraints to `accounts` and `journal_entries`. If the SQL contains DROP
statements for unrelated tables, STOP — the local DB has drifted from the
schema; resolve that before continuing.

- [ ] **Step 6: Apply the migration**

Run: `npx prisma migrate deploy`
Expected: `The following migration(s) have been applied` listing `_add_cash_sales`.

- [ ] **Step 7: Verify the table exists**

```bash
node -e "
const prisma = require('./server/config/database');
prisma.cashSale.count()
  .then(n => { console.log('cash_sales table OK, rows:', n); process.exit(0); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); })
"
```

Expected: `cash_sales table OK, rows: 0`

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cash-sales): add CashSale schema and migration"
```

---

### Task 2: Accounting core (`server/utils/cashSale.js`)

**Files:**
- Create: `server/utils/cashSale.js`
- Test: `tests/cashSale.test.js`

**Interfaces:**
- Consumes: nothing (pure module — no prisma import).
- Produces:
  - `PAYMENT_ACCOUNT_MAP` — `{ [paymentMethod: string]: string }`, cash-account COA code per method.
  - `cashAccountForMethod(paymentMethod: string) -> string` — looks up `PAYMENT_ACCOUNT_MAP`, falls back to `'1010'`.
  - `buildCashSaleEntry({ saleNo, accountId, subtotal, vatAmount, totalAmount, paymentMethod }) -> { lines }` where each line is `{ accountCode?, accountId?, debit?, credit?, description }` — the shape `glPost.post()` accepts (`server/utils/glPost.js:8`).
  - Later tasks (Task 3) use `buildCashSaleEntry` and `cashAccountForMethod`.

- [ ] **Step 1: Write the failing test**

Create `tests/cashSale.test.js`:

```js
const { buildCashSaleEntry, cashAccountForMethod, PAYMENT_ACCOUNT_MAP } = require('../server/utils/cashSale');
const { isBalanced } = require('../server/utils/finance');

const sum = (lines, side) => lines.reduce((s, l) => s + Number(l[side] || 0), 0);

describe('cashAccountForMethod', () => {
  test('maps known payment methods to their COA code', () => {
    expect(cashAccountForMethod('Cash')).toBe('1010');
    expect(cashAccountForMethod('Bank Transfer')).toBe('1020');
    expect(cashAccountForMethod('Check')).toBe('1020');
    expect(cashAccountForMethod('GCash')).toBe('1024');
    expect(cashAccountForMethod('Maya')).toBe('1024');
  });

  test('unrecognized method falls back to 1010 Cash on Hand', () => {
    expect(cashAccountForMethod('Bitcoin')).toBe('1010');
    expect(cashAccountForMethod(undefined)).toBe('1010');
  });
});

describe('buildCashSaleEntry', () => {
  test('VAT-coded sale: DR cash, CR revenue (subtotal), CR Output VAT, balanced', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000001', accountId: 42,
      subtotal: 500, vatAmount: 60, totalAmount: 560,
      paymentMethod: 'Cash',
    });

    expect(sum(lines, 'debit')).toBeCloseTo(560, 2);
    expect(sum(lines, 'credit')).toBeCloseTo(560, 2);
    expect(isBalanced(lines)).toBe(true);

    const cashLine = lines.find((l) => l.accountCode === '1010');
    expect(cashLine.debit).toBeCloseTo(560, 2);

    const revenueLine = lines.find((l) => l.accountId === 42);
    expect(revenueLine.credit).toBeCloseTo(500, 2);

    const vatLine = lines.find((l) => l.accountCode === '2030');
    expect(vatLine.credit).toBeCloseTo(60, 2);
  });

  test('ZERO/EXEMPT-coded sale (vatAmount 0): no Output VAT line, still balanced', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000002', accountId: 42,
      subtotal: 300, vatAmount: 0, totalAmount: 300,
      paymentMethod: 'GCash',
    });

    expect(lines.find((l) => l.accountCode === '2030')).toBeUndefined();
    expect(sum(lines, 'debit')).toBeCloseTo(300, 2);
    expect(sum(lines, 'credit')).toBeCloseTo(300, 2);
    expect(isBalanced(lines)).toBe(true);

    const cashLine = lines.find((l) => l.accountCode === '1024');
    expect(cashLine.debit).toBeCloseTo(300, 2);
  });

  test('unknown payment method still produces a balanced entry via the 1010 fallback', () => {
    const { lines } = buildCashSaleEntry({
      saleNo: 'CS-000003', accountId: 7,
      subtotal: 100, vatAmount: 12, totalAmount: 112,
      paymentMethod: 'Bitcoin',
    });

    expect(lines.find((l) => l.accountCode === '1010').debit).toBeCloseTo(112, 2);
    expect(isBalanced(lines)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/cashSale.test.js`
Expected: FAIL with `Cannot find module '../server/utils/cashSale'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/cashSale.js`:

```js
/**
 * cashSale.js — pure GL-entry construction for non-invoiced cash sales.
 * No prisma import: every input is a plain value, every output is a plain
 * array of { accountCode|accountId, debit, credit, description } lines in
 * the shape glPost.post() accepts. Kept separate from the controller so the
 * arithmetic is provable without a database, same as cashAdvance.js.
 */

// Same mapping receivableController.recordPayment uses for AR collections —
// duplicated rather than imported so this module stays prisma-free and
// independently testable; if the two ever need to diverge (e.g. a payment
// method only valid for one flow) that's a deliberate choice, not drift.
const PAYMENT_ACCOUNT_MAP = {
  'Cash':          '1010', // Cash on Hand
  'Bank Transfer': '1020', // Cash in Bank — BDO Checking
  'Check':         '1020',
  'GCash':         '1024', // Cash in Bank — UnionBank (GCash)
  'Maya':          '1024',
  'Credit Card':   '1020',
  'Online':        '1020',
};

function cashAccountForMethod(paymentMethod) {
  return PAYMENT_ACCOUNT_MAP[paymentMethod] || '1010';
}

/**
 * @param {Object} opts
 * @param {string} opts.saleNo
 * @param {number} opts.accountId       revenue account id
 * @param {number} opts.subtotal        VAT-exclusive amount
 * @param {number} opts.vatAmount       0 for ZERO/EXEMPT
 * @param {number} opts.totalAmount     subtotal + vatAmount
 * @param {string} opts.paymentMethod
 * @returns {{ lines: Array }}
 */
function buildCashSaleEntry({ saleNo, accountId, subtotal, vatAmount, totalAmount, paymentMethod }) {
  const cashAccountCode = cashAccountForMethod(paymentMethod);

  const lines = [
    {
      accountCode: cashAccountCode,
      debit:       Number(totalAmount),
      description: `Cash sale — ${saleNo} (${paymentMethod})`,
    },
    {
      accountId:   accountId,
      credit:      Number(subtotal),
      description: `Cash sale — ${saleNo}`,
    },
  ];

  if (Number(vatAmount) > 0) {
    lines.push({
      accountCode: '2030',
      credit:      Number(vatAmount),
      description: 'Output VAT',
    });
  }

  return { lines };
}

module.exports = { PAYMENT_ACCOUNT_MAP, cashAccountForMethod, buildCashSaleEntry };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/cashSale.test.js`
Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
git add server/utils/cashSale.js tests/cashSale.test.js
git commit -m "feat(cash-sales): add pure GL-entry builder with tests"
```

---

### Task 3: Backend controller and routes

**Files:**
- Create: `server/controllers/cashSaleController.js`
- Create: `server/routes/cashSales.js`
- Modify: `server/routes/index.js:1-34`
- Modify: `server/index.js` (near line 143, where `/api/cash-requests` is mounted)

**Interfaces:**
- Consumes: `buildCashSaleEntry` from Task 2's `server/utils/cashSale.js`; `computeVAT` from `server/utils/phCompliance.js`; `nextDocNumber` from `server/utils/docNumber.js`; `glPost.safePost` from `server/utils/glPost.js`; `createError` from `server/middleware/errorHandler.js`.
- Produces: `exports.list`, `exports.getOne`, `exports.create`, `exports.voidSale` on `cashSaleController.js`. Task 6 (frontend) calls these via `POST /api/cash-sales`, `GET /api/cash-sales`, `GET /api/cash-sales/:id`, `POST /api/cash-sales/:id/void`.

- [ ] **Step 1: Create the controller**

Create `server/controllers/cashSaleController.js`:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
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
        include: { account: { select: { accountCode: true, accountName: true } } },
        orderBy: { saleDate: 'desc' },
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
    const sale = await prisma.cashSale.findUnique({
      where: { id: Number(req.params.id) },
      include: { account: true, journalEntry: { include: { lines: true } } },
    });
    if (!sale) throw createError('Cash sale not found', 404);
    res.json(sale);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, description, accountId, vatCode = 'VAT', amount, paymentMethod, notes } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!description) throw createError('description is required', 400);
    if (!Number(amount) || Number(amount) <= 0) throw createError('amount must be greater than 0', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    const v = vatCode === 'VAT' ? computeVAT(Number(amount), true) : { base: Number(amount), vat: 0, total: Number(amount) };
    const saleNo = await genSaleNo();

    const sale = await prisma.cashSale.create({
      data: {
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
      },
    });

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

    res.status(201).json({ ...sale, journalEntryId: entry?.id || null });
  } catch (err) { next(err); }
};

// ─── Void ────────────────────────────────────────────────────────
exports.voidSale = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const sale = await prisma.cashSale.findUnique({ where: { id } });
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

    res.json({ message: `Cash sale ${sale.saleNo} voided` });
  } catch (err) { next(err); }
};
```

- [ ] **Step 2: Create the routes**

Create `server/routes/cashSales.js`:

```js
const router = require('express').Router();
const ctrl = require('../controllers/cashSaleController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',    ctrl.list);
router.get('/:id', ctrl.getOne);
router.post('/',   authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.create);
router.post('/:id/void', authorize('ADMIN', 'MANAGER'), ctrl.voidSale);

module.exports = router;
```

- [ ] **Step 3: Register the route**

In `server/routes/index.js`, add this line to the exports object, next to `cashRequests: require('./cashRequests'),`:

```js
  cashSales:     require('./cashSales'),
```

In `server/index.js`, add this line next to `app.use('/api/cash-requests', routes.cashRequests);`:

```js
app.use('/api/cash-sales',     routes.cashSales);
```

- [ ] **Step 4: Manually verify the endpoint responds**

Ask the user to start `npm run dev` if it isn't running, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/api/cash-sales
```

Expected: `401` (authentication required — confirms the route is mounted and not crashing, matching how every other unauthenticated endpoint in this app responds).

- [ ] **Step 5: Commit**

```bash
git add server/controllers/cashSaleController.js server/routes/cashSales.js server/routes/index.js server/index.js
git commit -m "feat(cash-sales): add controller, routes, and API registration"
```

---

### Task 4: Daily Remittance integration

**Files:**
- Modify: `server/controllers/dailyRemittanceController.js:27-254` (the `calculate` function)
- Modify (mock update only, one line each): `tests/cashReportAgreement.test.js`, `tests/dailyCashMovement.test.js`, `tests/dailyRemittanceCashOnHandInOut.test.js`, `tests/dailyRemittanceCollectionsByMethod.test.js`, `tests/dailyRemittancePettyCashClassification.test.js`
- Test: `tests/dailyRemittanceCashSales.test.js`

**Interfaces:**
- Consumes: `prisma.cashSale.findMany` (Task 1's model).
- Produces: `calculate()`'s response gains cash sales merged into `totalSales`, `vatCollected`, `cashReceived`, `collectionsByMethod`, `counts.cashSales`, and `items` (category `'SALES'`, same as invoice rows but `reference` = the cash sale's `saleNo`).

**Why the 5 existing test files need a one-line change first:** they each
`jest.mock('../server/config/database', ...)` with a fixed set of mocked
models, then call `dailyRemittanceController.calculate()` directly. Once
`calculate()` calls `prisma.cashSale.findMany(...)`, any test that doesn't
mock `cashSale` will crash on `Cannot read properties of undefined (reading
'findMany')`. Do this step **before** modifying the controller, so you can
verify each file still passes both before (as a no-op) and after the
controller change.

- [ ] **Step 1: Add `cashSale` to the 5 affected test files' mocks**

In `tests/cashReportAgreement.test.js`, add `cashSale: { findMany: jest.fn() },` to the `jest.mock('../server/config/database', ...)` object (alongside `expenseVoucher: { findMany: jest.fn() },`), and add `'cashSale'` to both `for (const m of [...])` arrays at lines 31 and 62 (which currently read `['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher']`).

In `tests/dailyCashMovement.test.js`, same two changes: add `cashSale: { findMany: jest.fn() },` to the mock object, and add `'cashSale'` to the `for (const m of [...])` array at line 30.

In `tests/dailyRemittanceCashOnHandInOut.test.js`, add `cashSale: { findMany: jest.fn() },` to the mock object, and add `'cashSale'` to the `for (const m of [...])` array at line 27 (currently `['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction']`).

In `tests/dailyRemittanceCollectionsByMethod.test.js`, add `cashSale: { findMany: jest.fn() },` to the mock object, and add `'cashSale'` to the `for (const m of [...])` array in `beforeEach` (currently `['invoice', 'bill', 'expenseVoucher', 'inventoryTransaction']`).

In `tests/dailyRemittancePettyCashClassification.test.js`, add `cashSale: { findMany: jest.fn() },` to the mock object, and add `'cashSale'` to the `for (const m of [...])` array at line 21 (currently `['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction']`).

- [ ] **Step 2: Run the full suite to verify these 5 files still pass (no-op so far)**

Run: `npx jest tests/cashReportAgreement.test.js tests/dailyCashMovement.test.js tests/dailyRemittanceCashOnHandInOut.test.js tests/dailyRemittanceCollectionsByMethod.test.js tests/dailyRemittancePettyCashClassification.test.js`
Expected: all pass, same counts as before this step — `cashSale.findMany` returning `undefined` (unmocked return value) is harmless until the controller actually calls it.

- [ ] **Step 3: Write the failing test for the new behavior**

Create `tests/dailyRemittanceCashSales.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice:              { findMany: jest.fn() },
  paymentAR:            { findMany: jest.fn() },
  bill:                 { findMany: jest.fn() },
  paymentAP:            { findMany: jest.fn() },
  inventoryTransaction: { findMany: jest.fn() },
  expenseVoucher:       { findMany: jest.fn() },
  cashSale:             { findMany: jest.fn() },
  journalLine:          { aggregate: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/dailyRemittanceController');

const run = (date) => new Promise((resolve, reject) => {
  ctrl.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
});

const cashSale = (saleNo, totalAmount, vatAmount, paymentMethod, status = 'ACTIVE') => ({
  saleNo, totalAmount, vatAmount, paymentMethod, status, buyerName: 'Walk-in',
  subtotal: totalAmount - vatAmount,
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher', 'cashSale']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

describe('daily remittance includes cash sales', () => {
  test('an active cash sale adds to totalSales, vatCollected, and cashReceived', async () => {
    prisma.cashSale.findMany.mockResolvedValue([
      cashSale('CS-000001', 560, 60, 'Cash'),
    ]);

    const r = await run('2026-08-10');

    expect(r.totalSales).toBe(560);
    expect(r.vatCollected).toBe(60);
    expect(r.cashReceived).toBe(560);
    expect(r.collectionsByMethod).toEqual({ Cash: 560 });
    expect(r.counts.cashSales).toBe(1);
  });

  test('cash sales and invoice collections both contribute to the same totals', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      { invoiceNo: 'INV-001', totalAmount: 1000, vatAmount: 0, subtotal: 1000, status: 'OPEN', customer: { name: 'ABC Corp' } },
    ]);
    prisma.paymentAR.findMany.mockResolvedValue([
      { paymentNo: 'PAY-001', amount: 1000, paymentMethod: 'Bank Transfer', invoice: { invoiceNo: 'INV-001', customer: { name: 'ABC Corp' } } },
    ]);
    prisma.cashSale.findMany.mockResolvedValue([
      cashSale('CS-000001', 300, 0, 'GCash'),
    ]);

    const r = await run('2026-08-10');

    expect(r.totalSales).toBe(1300);
    expect(r.cashReceived).toBe(1300);
    expect(r.collectionsByMethod).toEqual({ 'Bank Transfer': 1000, GCash: 300 });
  });

  test('a VOID cash sale is excluded entirely', async () => {
    prisma.cashSale.findMany.mockResolvedValue([]); // the query itself filters status: 'ACTIVE' — VOID rows never come back

    const r = await run('2026-08-10');

    expect(r.totalSales).toBe(0);
    expect(r.counts.cashSales).toBe(0);
  });

  test('cash sale rows appear in items with category SALES and the sale number as reference', async () => {
    prisma.cashSale.findMany.mockResolvedValue([cashSale('CS-000042', 112, 12, 'Maya')]);

    const r = await run('2026-08-10');

    const row = r.items.find((i) => i.reference === 'CS-000042');
    expect(row).toBeDefined();
    expect(row.category).toBe('SALES');
    expect(row.amount).toBe(112);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx jest tests/dailyRemittanceCashSales.test.js`
Expected: FAIL — `totalSales` is `0` where `560`/`1300` is expected, since `calculate()` doesn't query `cashSale` yet.

- [ ] **Step 5: Modify `calculate()` in `server/controllers/dailyRemittanceController.js`**

In the `Promise.all([...])` array (starts at line 33), add a new query. Change:

```js
    const [invoices, arPayments, bills, apPayments, invTxns, expVouchers, pettyCashGL, pettyCashGcashGL, cashOnHandGL] = await Promise.all([
      prisma.invoice.findMany({
```

to:

```js
    const [invoices, arPayments, bills, apPayments, invTxns, expVouchers, cashSales, pettyCashGL, pettyCashGcashGL, cashOnHandGL] = await Promise.all([
      prisma.invoice.findMany({
```

and add this query to the array, right after the existing `expVouchers` query (before `// Petty Cash Fund – Cash (1011) movement...`):

```js
      // Cash sales recorded today (non-invoiced), excluding voided ones
      prisma.cashSale.findMany({
        where: { businessId: req.businessId, saleDate: range, status: 'ACTIVE' },
        orderBy: { saleNo: 'asc' },
      }),
```

Then, in the `## Totals` section, change:

```js
    const totalSales     = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
    const vatCollected   = invoices.reduce((s, i) => s + Number(i.vatAmount),   0);
    const cashReceived   = arPayments.reduce((s, p) => s + Number(p.amount),    0);
```

to:

```js
    const totalSales     = invoices.reduce((s, i) => s + Number(i.totalAmount), 0)
                          + cashSales.reduce((s, c) => s + Number(c.totalAmount), 0);
    const vatCollected   = invoices.reduce((s, i) => s + Number(i.vatAmount),   0)
                          + cashSales.reduce((s, c) => s + Number(c.vatAmount),   0);
    const cashReceived   = arPayments.reduce((s, p) => s + Number(p.amount),    0)
                          + cashSales.reduce((s, c) => s + Number(c.totalAmount), 0);
```

Change the `collectionsByMethod` reduce to also fold in cash sales — replace:

```js
    const collectionsByMethod = arPayments.reduce((acc, p) => {
      const method = p.paymentMethod || 'Unspecified';
      acc[method] = (acc[method] || 0) + Number(p.amount);
      return acc;
    }, {});
```

with:

```js
    const collectionsByMethod = [...arPayments, ...cashSales].reduce((acc, p) => {
      const method = p.paymentMethod || 'Unspecified';
      const amt = p.amount != null ? Number(p.amount) : Number(p.totalAmount);
      acc[method] = (acc[method] || 0) + amt;
      return acc;
    }, {});
```

In the `items` array (starts at line 165), add a new spread right after the
`invoices.map(...)` block (before `// AR collections received today`):

```js
      // Non-invoiced cash sales recorded today
      ...cashSales.map(c => ({
        category:    'SALES',
        reference:   c.saleNo,
        description: `Cash Sale — ${c.buyerName || 'Walk-in'}`,
        amount:      Number(c.totalAmount),
        meta:        JSON.stringify({ buyer: c.buyerName || 'Walk-in', subtotal: Number(c.subtotal), vat: Number(c.vatAmount), method: c.paymentMethod }),
      })),
```

Finally, in the `counts` object in the response (starts at line 241), add:

```js
        cashSales:     cashSales.length,
```

right after `invoices: invoices.length,`.

- [ ] **Step 6: Run the new test to verify it passes**

Run: `npx jest tests/dailyRemittanceCashSales.test.js`
Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 7: Run the full daily remittance test suite to confirm nothing regressed**

Run: `npx jest tests/cashReportAgreement.test.js tests/dailyCashMovement.test.js tests/dailyRemittanceCashOnHandInOut.test.js tests/dailyRemittanceCollectionsByMethod.test.js tests/dailyRemittanceGcashRoundtrip.test.js tests/dailyRemittancePettyCashClassification.test.js tests/dailyRemittanceCashSales.test.js tests/pettyCash.test.js`
Expected: all pass.

- [ ] **Step 8: Run the entire test suite**

Run: `npx jest`
Expected: all suites pass (223+ tests, same as the pre-existing baseline plus this task's new tests).

- [ ] **Step 9: Commit**

```bash
git add server/controllers/dailyRemittanceController.js tests/dailyRemittanceCashSales.test.js tests/cashReportAgreement.test.js tests/dailyCashMovement.test.js tests/dailyRemittanceCashOnHandInOut.test.js tests/dailyRemittanceCollectionsByMethod.test.js tests/dailyRemittancePettyCashClassification.test.js
git commit -m "feat(cash-sales): merge cash sales into Daily Remittance totals"
```

---

### Task 5: Frontend API client

**Files:**
- Modify: `lib/api.js:220` (the `receivable` export block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `cashSales.list(params)`, `cashSales.get(id)`, `cashSales.create(data)`, `cashSales.void(id, reason)` — Task 6's page imports these.

- [ ] **Step 1: Add the `cashSales` export**

In `lib/api.js`, add this new export right after the closing `};` of `export const receivable = { ... }` (which starts at line 220):

```js
export const cashSales = {
  list:   (params) => api.get('/cash-sales', { params }),
  get:    (id)     => api.get(`/cash-sales/${id}`),
  create: (data)   => api.post('/cash-sales', data),
  void:   (id, reason) => api.post(`/cash-sales/${id}/void`, { reason }),
};
```

- [ ] **Step 2: Verify the file still parses**

Run: `node --check lib/api.js` — this only checks syntax, not JSX/ESM export
semantics, but catches typos. If it errors with `Unexpected token export`,
that's expected (Node's CommonJS checker doesn't understand ESM `export`) —
instead verify by starting the dev server and confirming no compile error:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/receivable
```

Expected: `200` (confirms `lib/api.js` still compiles under Next.js, which
any page importing from it would otherwise fail to build).

- [ ] **Step 3: Commit**

```bash
git add lib/api.js
git commit -m "feat(cash-sales): add cashSales API client module"
```

---

### Task 6: Frontend page

**Files:**
- Create: `app/(dashboard)/receivable/cash-sales/page.jsx`

**Interfaces:**
- Consumes: `cashSales` from Task 5's `lib/api.js`; `accounts` from the existing `lib/api.js` export (for the revenue `AccountSelect`); `formatCurrency`, `formatDate` from `lib/auth.js`; `AccountSelect` from `components/ui/AccountSelect.jsx`; `NumberInput` from `components/NumberInput.jsx`; `printDocument`, `phpFmt`, `dateFmt` from `lib/print.js`.
- Produces: the `/receivable/cash-sales` route Task 7's nav entry links to.

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/receivable/cash-sales/page.jsx`:

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashSales as csApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Ban, Printer } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Check', 'GCash', 'Maya', 'Credit Card', 'Online'];
const VAT_CODES = ['VAT', 'ZERO', 'EXEMPT'];
const STATUS_BADGE = { ACTIVE: 'badge-green', VOID: 'badge-gray' };

function emptyForm() {
  return {
    saleDate: new Date().toISOString().split('T')[0],
    buyerName: '', description: '', accountId: '',
    vatCode: 'VAT', amount: '', paymentMethod: 'Cash', notes: '',
  };
}

// ─── New Cash Sale Modal ────────────────────────────────────────
function NewSaleModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const amt = Number(form.amount) || 0;
  const vat = form.vatCode === 'VAT' ? amt - amt / 1.12 : 0;
  const subtotal = amt - vat;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.accountId) return toast.error('Select a revenue account');
    if (amt <= 0) return toast.error('Amount must be greater than 0');
    setSaving(true);
    try {
      await csApi.create(form);
      toast.success('Cash sale recorded');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record cash sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-lg">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Cash Sale</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
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
              <label className="label">Description *</label>
              <input className="input" required value={form.description} onChange={set('description')} placeholder="What was sold" />
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
                <NumberInput className="input" value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              </div>
              <div className="form-group">
                <label className="label">VAT Code</label>
                <select className="input" value={form.vatCode} onChange={set('vatCode')}>
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

// ─── Print a cash sale receipt ───────────────────────────────────
async function printCashSale(sale) {
  const body = `
    <div class="info-grid" style="grid-template-columns:repeat(2,1fr);">
      <div class="info-box"><div class="info-lbl">Buyer</div><div class="info-val">${sale.buyerName || 'Walk-in'}</div></div>
      <div class="info-box"><div class="info-lbl">Payment Method</div><div class="info-val">${sale.paymentMethod}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="right">Subtotal</th><th class="right">VAT</th><th class="right">Total</th></tr></thead>
      <tbody><tr>
        <td>${sale.description}</td>
        <td class="right">${phpFmt(sale.subtotal)}</td>
        <td class="right">${phpFmt(sale.vatAmount)}</td>
        <td class="right bold">${phpFmt(sale.totalAmount)}</td>
      </tr></tbody>
    </table>
    <p class="small gray" style="margin-top:10px;">Not a BIR-registered sales invoice — internal record only.</p>`;
  await printDocument('Cash Sale Receipt', sale.saleNo, body);
}

// ─── Main Page ───────────────────────────────────────────────────
export default function CashSalesPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    csApi.list({ search, limit: 100 })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load cash sales'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {}); }, []);

  const handleVoid = async (sale) => {
    const reason = prompt(`Void ${sale.saleNo}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    try {
      await csApi.void(sale.id, reason);
      toast.success('Cash sale voided');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to void cash sale');
    }
  };

  const todayTotal = rows
    .filter((r) => r.status === 'ACTIVE' && r.saleDate?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((s, r) => s + Number(r.totalAmount), 0);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Sales</h1>
          <p className="page-subtitle">{total} record{total !== 1 ? 's' : ''} · Non-invoiced walk-in/counter sales</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> New Cash Sale
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Today's Cash Sales</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(todayTotal)}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Records</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search buyer, description, sale #..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">Sale #</th>
                <th>Date</th>
                <th>Buyer</th>
                <th>Description</th>
                <th>Method</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="w-20 pr-4" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No cash sales recorded yet.</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="pl-4 py-2 font-mono text-sm text-green-700">{s.saleNo}</td>
                  <td className="py-2 text-sm text-gray-600">{formatDate(s.saleDate)}</td>
                  <td className="py-2 text-sm">{s.buyerName || 'Walk-in'}</td>
                  <td className="py-2 text-sm text-gray-600">{s.description}</td>
                  <td className="py-2 text-sm text-gray-500">{s.paymentMethod}</td>
                  <td className="text-right py-2 text-sm font-semibold">{formatCurrency(s.totalAmount)}</td>
                  <td className="py-2">
                    <span className={`badge text-xs ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => printCashSale(s)} className="text-gray-400 hover:text-green-600" title="Print receipt">
                        <Printer className="w-4 h-4" />
                      </button>
                      {s.status === 'ACTIVE' && (
                        <button onClick={() => handleVoid(s)} className="text-gray-400 hover:text-red-600" title="Void">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewSaleModal
          accounts={accounts}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the page compiles**

Ask the user to start `npm run dev` if it isn't running, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/receivable/cash-sales
```

Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/receivable/cash-sales/page.jsx"
git commit -m "feat(cash-sales): add Cash Sales page"
```

---

### Task 7: Navigation entry

**Files:**
- Modify: `components/layout/Sidebar.jsx:36-47`

**Interfaces:**
- Consumes: nothing new.
- Produces: a visible "Cash Sales" nav link under Sidebar → Sales, beside "Accounts Receivable".

- [ ] **Step 1: Add the nav item**

In `components/layout/Sidebar.jsx`, the `Sales` section currently reads
(starting at line 36):

```js
    section: 'Sales',
    items: [
      {
        label: 'Accounts Receivable', icon: PesoReceipt,
        children: [
          { label: 'Invoices',   href: '/receivable' },
          { label: 'Quotations', href: '/receivable/quotations' },
          { label: 'Customers',  href: '/receivable/customers' },
          { label: 'AR Aging',   href: '/receivable/aging' },
        ],
      },
    ],
  },
```

Change it to add a sibling item after the `Accounts Receivable` object,
inside the same `items` array:

```js
    section: 'Sales',
    items: [
      {
        label: 'Accounts Receivable', icon: PesoReceipt,
        children: [
          { label: 'Invoices',   href: '/receivable' },
          { label: 'Quotations', href: '/receivable/quotations' },
          { label: 'Customers',  href: '/receivable/customers' },
          { label: 'AR Aging',   href: '/receivable/aging' },
        ],
      },
      { label: 'Cash Sales', icon: Banknote, href: '/receivable/cash-sales' },
    ],
  },
```

`Banknote` is already imported in this file (used by the Bank Reconciliation
nav item) — no new import needed.

- [ ] **Step 2: Verify it renders**

Ask the user to start `npm run dev` if it isn't running, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/dashboard
```

Expected: `200`. A visual check (the actual sidebar link appearing) needs a
browser — note in the handoff to the user that this wasn't visually
confirmed, since no login credentials are available in this environment.

- [ ] **Step 3: Commit**

```bash
git add components/layout/Sidebar.jsx
git commit -m "feat(cash-sales): add Cash Sales nav entry"
```

---

## Final verification

- [ ] Run `npx jest` one more time — expect all suites green.
- [ ] Confirm `git log --oneline -8` shows the 7 commits from this plan in order.
- [ ] Tell the user: schema/backend/frontend are done and unit-tested, but the actual browser flow (create a cash sale, see it in Daily Remittance, void it) has not been clicked through live — recommend they do that once the dev server is back up, the same caveat every other feature built this session carried.
