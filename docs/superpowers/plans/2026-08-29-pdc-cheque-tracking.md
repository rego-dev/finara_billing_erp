# Post-Dated Cheque Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner visibility into every post-dated cheque issued to vendors — an aging view (0-7 / 8-14 / 15-30 / 30+ days until the cheque's own maturity date, plus a "Past Due" flag), the ability to mark one Cleared/Bounced/Cancelled, correct GL treatment (cash isn't touched until a cheque actually clears), and print/Excel export.

**Architecture:** Two new nullable columns + one new enum on the existing `PaymentAP` model (no new top-level entity). A new liability holding account `2015 Post-Dated Checks Payable` sits between AP and Cash for the lifetime of an outstanding cheque. `recordPayment`/`editPayment` gain a conditional branch: when the payment's `paymentMethod === 'Check'`, they credit `2015` instead of `1020` and stamp `checkDate`/`clearingStatus: 'OUTSTANDING'`. Three new endpoints (`clear`/`bounce`/`cancel`) transition a cheque out of `OUTSTANDING` — `clear` posts a second GL entry moving `2015 → 1020`; `bounce`/`cancel` void the original issue entry and revert the bill's `paidAmount`/status, reusing the exact recompute arithmetic `editPayment` already established. A new `GET /payable/cheques` endpoint feeds a new **Payables → Cheques** page (Outstanding tab with aging buckets, History tab, print/Excel export matching the existing AP Aging page's pattern).

**Tech Stack:** Express, Prisma, express-validator, Jest (backend). No frontend component tests exist in this repo — frontend tasks are verified by manual code inspection plus a live browser check against the user's already-running dev server, per `CLAUDE.md`.

## Global Constraints

- Every `'Check'`-method payment goes through this workflow, not just future-dated ones — there is no "immediate" fast path for a same-day check. Every other payment method is completely unaffected.
- AP only — no AR/customer-cheque changes.
- New endpoints `clear`/`bounce`/`cancel` are `authorize('ADMIN','MANAGER')`-gated (same risk tier as `editPayment`/`voidBill` — each changes historical money state). `GET /payable/cheques` (a read) is **not** role-gated, matching every other GET in this controller (`listBills`, `agingReport`, `getBill` all have no `authorize()`) — this is a deliberate, documented correction of the design spec's blanket "all ADMIN/MANAGER-only" wording, which conflated a read with the three mutating actions.
- `editPayment` is blocked (400) once a cheque's `clearingStatus` is no longer `OUTSTANDING` — a cleared/bounced/cancelled cheque has GL state the generic single-entry edit path can't safely correct.
- The `Clear` action always credits `1020 Cash in Bank — BDO Checking` — matches the pre-existing simplification that every payment method already posts through the same hardcoded cash account regardless of method. Multi-bank-account routing is out of scope.
- `bounce`/`cancel` require a non-empty `reason` in the request body — this feature exists specifically so the owner can look back and know why.
- Full design reference: `docs/superpowers/specs/2026-08-29-pdc-cheque-tracking-design.md`.

---

### Task 1: Database — schema, migration, seed

**Files:**
- Modify: `prisma/schema.prisma` (add `ChequeStatus` enum, add fields + index to `PaymentAP`)
- Modify: `prisma/seed.js` (add account `2015`)
- Create: a new Prisma migration (via `prisma migrate dev`)

**Interfaces:**
- Produces: `PaymentAP.checkDate: DateTime?`, `PaymentAP.clearingStatus: ChequeStatus?` (`OUTSTANDING | CLEARED | BOUNCED | CANCELLED`), and Chart-of-Accounts row `{ accountCode: '2015', accountName: 'Post-Dated Checks Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT' }` under `parentCode: '2000'` — every later task depends on these existing in the dev database.

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, find:
```prisma
model PaymentAP {
  id            Int       @id @default(autoincrement())
  paymentNo     String    @unique @db.VarChar(30)
  billId        Int
  bill          Bill      @relation(fields: [billId], references: [id])
  paymentDate   DateTime  @db.Date
  amount        Decimal   @db.Decimal(15, 2)
  paymentMethod String    @db.VarChar(50)
  reference     String?   @db.VarChar(100)
  notes         String?   @db.Text
  createdAt     DateTime  @default(now())

  @@index([billId])
  @@map("payments_ap")
}
```
Replace with:
```prisma
model PaymentAP {
  id            Int       @id @default(autoincrement())
  paymentNo     String    @unique @db.VarChar(30)
  billId        Int
  bill          Bill      @relation(fields: [billId], references: [id])
  paymentDate   DateTime  @db.Date
  amount        Decimal   @db.Decimal(15, 2)
  paymentMethod String    @db.VarChar(50)
  reference     String?   @db.VarChar(100)
  notes         String?   @db.Text
  createdAt     DateTime  @default(now())

  checkDate      DateTime?     @db.Date
  clearingStatus ChequeStatus?

  @@index([billId])
  @@index([clearingStatus])
  @@map("payments_ap")
}

enum ChequeStatus {
  OUTSTANDING
  CLEARED
  BOUNCED
  CANCELLED
}
```
(The new enum is placed immediately after the model it's used by — matching where `BillStatus` already sits immediately after `model Bill` a few dozen lines above.)

- [ ] **Step 2: Add the new account to the seed data**

In `prisma/seed.js`, find:
```javascript
    { accountCode:'2010', accountName:'Accounts Payable — Trade',            accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2011', accountName:'Accounts Payable — Media Suppliers',  accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2012', accountName:'Accounts Payable — Production',       accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
```
Replace with:
```javascript
    { accountCode:'2010', accountName:'Accounts Payable — Trade',            accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2011', accountName:'Accounts Payable — Media Suppliers',  accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2012', accountName:'Accounts Payable — Production',       accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
    { accountCode:'2015', accountName:'Post-Dated Checks Payable',           accountType:'LIABILITY', normalBalance:'CREDIT', parentCode:'2000' },
```

- [ ] **Step 3: Check whether the dev server is running before migrating**

Prisma's Windows client generation can EPERM-fail if `nodemon` (the dev server, `npm run dev`) has the previous generated client DLL open. Run:
```bash
netstat -ano | findstr :5000
```
If a `LISTENING` line appears, **STOP** — do not attempt to kill or restart the dev server yourself (it belongs to the user, running it themselves; never touch it without being asked). Report status `BLOCKED` with this exact finding: "Dev server appears to be running on :5000 — needs to be paused before `prisma migrate dev` can safely regenerate the client. Please ask the user to stop it, then re-dispatch this task." If nothing is listening on :5000, proceed to Step 4.

- [ ] **Step 4: Run the migration**

```bash
npx prisma migrate dev --name add_pdc_cheque_tracking
```
Expected: a new folder under `prisma/migrations/` (timestamp-prefixed `add_pdc_cheque_tracking`) containing the generated SQL, and "Your database is now in sync with your schema" (or equivalent success message). If this fails with an EPERM/file-lock error despite Step 3 finding no listener, report `BLOCKED` with the exact error — do not retry blindly, do not delete `node_modules/.prisma` or any generated-client directory to force it.

- [ ] **Step 5: Run the seed to insert the new account**

```bash
npm run db:seed
```
Expected: output including `"✅ <N> accounts seeded (1 new)"` (or similar — the exact count depends on how many rows total; the important part is exactly **one** new row, since this is an idempotent upsert and nothing else in the seed data changed). If it reports 0 new rows, the account already exists (re-run is safe either way) — investigate only if it errors.

- [ ] **Step 6: Verify against the database directly**

```bash
"C:\Program Files\MySQL\MySQL Server 9.4\bin\mysql.exe" -u root -e "SELECT accountCode, accountName, accountType, normalBalance FROM finara.accounts WHERE accountCode = '2015';"
```
(Adjust the database name/credentials to match this project's `.env` if `finara` isn't correct — check `DATABASE_URL` in `.env` first.) Expected: one row, `2015 | Post-Dated Checks Payable | LIABILITY | CREDIT`.

- [ ] **Step 7: Regenerate the Prisma client (if not already done by migrate)**

`prisma migrate dev` regenerates the client automatically, but confirm:
```bash
npm run db:generate
```
Expected: success, no errors. This makes `checkDate`/`clearingStatus` available on `prisma.paymentAP` calls for every later task.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/seed.js prisma/migrations
git commit -m "$(cat <<'EOF'
feat(payable): add PDC cheque tracking schema — PaymentAP fields + Post-Dated Checks Payable account

Adds checkDate/clearingStatus to PaymentAP and a new ChequeStatus
enum, plus the 2015 Post-Dated Checks Payable liability account,
laying the groundwork for tracking outstanding post-dated cheques
issued to vendors separately from cash-in-bank.
EOF
)"
```

---

### Task 2: Backend — `recordPayment`/`editPayment` cheque-aware branching

**Files:**
- Modify: `server/controllers/payableController.js` (`recordPayment` at line 201, `editPayment` at line 308)
- Modify: `server/routes/payable.js` (both payment routes' validators)
- Test: `tests/payableControllerRecordPayment.test.js` (new — no test file exists for `recordPayment` today)
- Test: `tests/payableControllerEditPayment.test.js` (extend with cheque-specific coverage)

**Interfaces:**
- Consumes: everything from Task 1 (`PaymentAP.checkDate`/`clearingStatus`, account `2015`).
- Produces: `recordPayment`/`editPayment` now accept an optional `checkDate` field in the request body, required exactly when `paymentMethod === 'Check'`. Later tasks (3, 4) read `clearingStatus`/`checkDate` off `PaymentAP` rows this task starts writing.

- [ ] **Step 1: Write the failing tests for `recordPayment`**

Create `tests/payableControllerRecordPayment.test.js` (no existing test file for this function — this establishes baseline coverage while adding the new behavior):

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  vendor: {
    findUnique: jest.fn(),
  },
  paymentAP: {
    create: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
  prisma.vendor.findUnique.mockResolvedValue({ name: 'Triplekenn Supply' });
  prisma.paymentAP.create.mockResolvedValue({ id: 1 });
  prisma.bill.update.mockResolvedValue({});
  glPost.safePost.mockResolvedValue({ id: 99 });
});

const baseBill = { id: 7, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 1000 };

describe('recordPayment — eligibility', () => {
  test('404s when the bill does not exist', async () => {
    prisma.bill.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects paying a VOID bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'VOID' });
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('recordPayment — non-cheque payments (existing behavior)', () => {
  test('posts DR AP / CR Cash (1020) and does not touch checkDate/clearingStatus', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    let createArgs;
    prisma.paymentAP.create.mockImplementation((args) => { createArgs = args; return Promise.resolve({ id: 1 }); });

    await run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Cash' } });

    expect(createArgs.data.checkDate).toBeNull();
    expect(createArgs.data.clearingStatus).toBeNull();
    const call = glPost.safePost.mock.calls[0][0];
    const cashLine = call.lines.find((l) => l.accountCode === '1020');
    expect(cashLine.credit).toBeCloseTo(500, 2);
    expect(call.lines.find((l) => l.accountCode === '2015')).toBeUndefined();
  });
});

describe('recordPayment — Check payments (new behavior)', () => {
  test('rejects a Check payment with no checkDate', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    await expect(run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Check' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.create).not.toHaveBeenCalled();
  });

  test('stores checkDate and clearingStatus OUTSTANDING, posts DR AP / CR Post-Dated Checks Payable (2015), not Cash', async () => {
    prisma.bill.findUnique.mockResolvedValue(baseBill);
    let createArgs;
    prisma.paymentAP.create.mockImplementation((args) => { createArgs = args; return Promise.resolve({ id: 1 }); });

    await run(ctrl.recordPayment, { params: { id: '7' }, body: { paymentDate: '2026-08-20', amount: 500, paymentMethod: 'Check', checkDate: '2026-09-10', reference: 'CHK-0001' } });

    expect(createArgs.data.checkDate).toEqual(new Date('2026-09-10'));
    expect(createArgs.data.clearingStatus).toBe('OUTSTANDING');
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.lines.find((l) => l.accountCode === '1020')).toBeUndefined();
    const pdcLine = call.lines.find((l) => l.accountCode === '2015');
    expect(pdcLine.credit).toBeCloseTo(500, 2);
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.debit).toBeCloseTo(500, 2);
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails as expected**

Run: `npx jest tests/payableControllerRecordPayment.test.js`
Expected: the "Check payments" tests FAIL (no `checkDate` handling exists yet — `createArgs.data.checkDate` is `undefined`, not `null`/a `Date`, and the GL line targets `1020` unconditionally). The "eligibility" and "non-cheque" tests should already PASS against today's code (they exercise existing behavior) — that's fine, they establish the regression baseline this task must not break.

- [ ] **Step 3: Implement the `recordPayment` change**

In `server/controllers/payableController.js`, find:
```javascript
exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot pay a voided bill', 400);

    const paymentNo = await genPayNo();
    const newPaid = Number(bill.paidAmount) + Number(amount);
    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAP.create({ data: { paymentNo, billId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes } }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: `AP Payment — ${vendor?.name} (${bill.billNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        { accountCode: '1020', credit: Number(amount), description: `Cash out — ${paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment recorded', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};
```
Replace with:
```javascript
exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes, checkDate } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot pay a voided bill', 400);
    if (paymentMethod === 'Check' && !checkDate) throw createError('Check date is required for a Check payment.', 400);
    const isCheque = paymentMethod === 'Check';

    const paymentNo = await genPayNo();
    const newPaid = Number(bill.paidAmount) + Number(amount);
    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAP.create({
        data: {
          paymentNo, billId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes,
          checkDate: isCheque ? new Date(checkDate) : null,
          clearingStatus: isCheque ? 'OUTSTANDING' : null,
        },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: isCheque
        ? `AP Payment (Check — Outstanding) — ${vendor?.name} (${bill.billNo})`
        : `AP Payment — ${vendor?.name} (${bill.billNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        isCheque
          ? { accountCode: '2015', credit: Number(amount), description: `Post-dated check issued — ${paymentNo}` }
          : { accountCode: '1020', credit: Number(amount), description: `Cash out — ${paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment recorded', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the test file again to verify it passes**

Run: `npx jest tests/payableControllerRecordPayment.test.js`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Write the failing tests for `editPayment`'s new behavior**

Append to `tests/payableControllerEditPayment.test.js` (after its final `describe` block, i.e. at the end of the file — do not touch any existing test in this file, they establish the regression baseline):

```javascript

describe('editPayment — cheque-aware branching (new)', () => {
  test('rejects switching a payment to Check with no checkDate', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, paymentMethod: 'Check' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('blocks editing a payment whose clearingStatus is no longer OUTSTANDING', async () => {
    prisma.bill.findFirst.mockResolvedValue({
      ...baseBill, status: 'PAID',
      payments: [{ ...basePayment, clearingStatus: 'CLEARED' }],
    });
    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('allows editing a payment whose clearingStatus is OUTSTANDING', async () => {
    prisma.bill.findFirst.mockResolvedValue({
      ...baseBill, status: 'PAID',
      payments: [{ ...basePayment, clearingStatus: 'OUTSTANDING', checkDate: new Date('2026-09-01') }],
    });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(prisma.bill.update).toHaveBeenCalled();
  });

  test('editing to Check stores checkDate/OUTSTANDING and posts to 2015, not 1020', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({ ...basePayment, ...args.data }); });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, paymentMethod: 'Check', checkDate: '2026-09-15' } });

    expect(paymentUpdateArgs.data.checkDate).toEqual(new Date('2026-09-15'));
    expect(paymentUpdateArgs.data.clearingStatus).toBe('OUTSTANDING');
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.lines.find((l) => l.accountCode === '1020')).toBeUndefined();
    expect(call.lines.find((l) => l.accountCode === '2015').credit).toBeCloseTo(200, 2);
  });

  test('editing away from Check to Cash clears checkDate/clearingStatus and posts back to 1020', async () => {
    prisma.bill.findFirst.mockResolvedValue({
      ...baseBill, status: 'PAID',
      payments: [{ ...basePayment, clearingStatus: 'OUTSTANDING', checkDate: new Date('2026-09-01') }],
    });
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({ ...basePayment, ...args.data }); });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, paymentMethod: 'Cash' } });

    expect(paymentUpdateArgs.data.checkDate).toBeNull();
    expect(paymentUpdateArgs.data.clearingStatus).toBeNull();
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.lines.find((l) => l.accountCode === '2015')).toBeUndefined();
    expect(call.lines.find((l) => l.accountCode === '1020').credit).toBeCloseTo(200, 2);
  });
});
```

- [ ] **Step 6: Run the extended test file to verify the new tests fail as expected**

Run: `npx jest tests/payableControllerEditPayment.test.js`
Expected: the 5 new tests in the `cheque-aware branching (new)` block FAIL; all pre-existing tests in the file still PASS (they don't touch `clearingStatus`/`checkDate` at all, so nothing about them should change yet).

- [ ] **Step 7: Implement the `editPayment` change**

In `server/controllers/payableController.js`, find:
```javascript
    const payment = bill.payments.find((p) => p.id === paymentId);
    if (!payment) throw createError('Payment not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot edit a payment on a voided bill.', 400);

    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const newPaid = otherPaid + Number(amount);
```
Replace with:
```javascript
    const payment = bill.payments.find((p) => p.id === paymentId);
    if (!payment) throw createError('Payment not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot edit a payment on a voided bill.', 400);
    if (payment.clearingStatus && payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This payment has already been ${payment.clearingStatus.toLowerCase()} and can no longer be edited here.`, 400);
    }

    const { paymentDate, amount, paymentMethod, reference, notes, checkDate } = req.body;
    if (paymentMethod === 'Check' && !checkDate) throw createError('Check date is required for a Check payment.', 400);
    const isCheque = paymentMethod === 'Check';
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const newPaid = otherPaid + Number(amount);
```

Then find:
```javascript
    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: { paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);
```
Replace with:
```javascript
    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: {
          paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes,
          checkDate: isCheque ? new Date(checkDate) : null,
          clearingStatus: isCheque ? 'OUTSTANDING' : null,
        },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);
```

Then find:
```javascript
    const glResult = await glPost.safePost({
      entryDate:   paymentDate,
      description: `AP Payment (Edited) — ${vendor?.name} (${bill.billNo})`,
      reference:   payment.paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        { accountCode: '1020', credit: Number(amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
```
Replace with:
```javascript
    const glResult = await glPost.safePost({
      entryDate:   paymentDate,
      description: isCheque
        ? `AP Payment (Edited, Check — Outstanding) — ${vendor?.name} (${bill.billNo})`
        : `AP Payment (Edited) — ${vendor?.name} (${bill.billNo})`,
      reference:   payment.paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        isCheque
          ? { accountCode: '2015', credit: Number(amount), description: `Post-dated check issued — ${payment.paymentNo}` }
          : { accountCode: '1020', credit: Number(amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
```

- [ ] **Step 8: Run the extended test file to verify it passes**

Run: `npx jest tests/payableControllerEditPayment.test.js`
Expected: PASS — all tests, old and new (19 pre-existing + 5 new = 24; count them precisely from the file rather than assuming — the point is zero failures and zero skipped).

- [ ] **Step 9: Add `checkDate` validators to both routes**

In `server/routes/payable.js`, find:
```javascript
router.post('/:id/payment',
  [
    param('id').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, ctrl.recordPayment);
```
Replace with:
```javascript
router.post('/:id/payment',
  [
    param('id').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
    body('checkDate').optional().isISO8601(),
  ],
  validate, ctrl.recordPayment);
```
Then find:
```javascript
router.put('/:id/payment/:paymentId',
  authorize('ADMIN','MANAGER'),
  [
    param('id').isInt(),
    param('paymentId').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, ctrl.editPayment);
```
Replace with:
```javascript
router.put('/:id/payment/:paymentId',
  authorize('ADMIN','MANAGER'),
  [
    param('id').isInt(),
    param('paymentId').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0 }),
    body('paymentMethod').notEmpty(),
    body('checkDate').optional().isISO8601(),
  ],
  validate, ctrl.editPayment);
```
(`.optional()` because the requiredness is conditional on `paymentMethod`, which express-validator's declarative chain can't express as cleanly as the plain `if` already added inside each controller — format validation stays here, business-rule validation stays in the controller, consistent with how this file already handles every other cross-field rule.)

- [ ] **Step 10: Run the full payable suite to check for regressions**

Run: `npx jest tests/payableController`
Expected: PASS, zero failures, including the new `payableControllerRecordPayment.test.js`.

- [ ] **Step 11: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerRecordPayment.test.js tests/payableControllerEditPayment.test.js
git commit -m "$(cat <<'EOF'
feat(payable): route Check payments through Post-Dated Checks Payable, not Cash

recordPayment/editPayment now branch on paymentMethod === 'Check':
require a checkDate, stamp clearingStatus OUTSTANDING, and credit
the new 2015 Post-Dated Checks Payable account instead of Cash —
cash isn't touched until a cheque is confirmed cleared (Task 4).
editPayment also now blocks editing a payment once its cheque is no
longer OUTSTANDING, since a settled cheque has two linked GL entries
the single-entry edit path can't safely correct.
EOF
)"
```

---

### Task 3: Backend — `listCheques` endpoint + aging

**Files:**
- Modify: `server/controllers/payableController.js` (add `chequeAgingBucket` helper + `exports.listCheques`)
- Modify: `server/routes/payable.js` (add `GET /cheques`, positioned before `GET /:id`)
- Test: `tests/payableControllerCheques.test.js` (new — shared with Task 4)

**Interfaces:**
- Consumes: `PaymentAP.checkDate`/`clearingStatus` from Task 1/2.
- Produces: `GET /api/payable/cheques` (optional `?status=OUTSTANDING|CLEARED|BOUNCED|CANCELLED`), returning an array of `{ id, paymentNo, billId, billNo, vendorName, amount, checkNo, checkDate, paymentDate, clearingStatus, notes, bucket }` — `bucket` is `null` for any non-`OUTSTANDING` row. `chequeAgingBucket(checkDate)` returns one of `'Past Due' | '0-7 days' | '8-14 days' | '15-30 days' | '30+ days'` — Task 6's frontend groups by these exact strings.

- [ ] **Step 1: Write the failing tests**

Create `tests/payableControllerCheques.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  paymentAP: {
    findMany: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const mkPayment = (overrides) => ({
  id: 1, paymentNo: 'PAP-000001', billId: 7, amount: 500, reference: 'CHK-001',
  paymentDate: new Date('2026-08-20'), checkDate: new Date('2026-09-05'),
  clearingStatus: 'OUTSTANDING', notes: null,
  bill: { billNo: 'BILL-000007', vendor: { name: 'Triplekenn Supply' } },
  ...overrides,
});

describe('listCheques', () => {
  test('scopes the query to the current business and paymentMethod Check', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, {});
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentMethod: 'Check', bill: { businessId: 1 } }),
      })
    );
  });

  test('applies an optional status filter from the query string', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, { query: { status: 'CLEARED' } });
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clearingStatus: 'CLEARED' }),
      })
    );
  });

  test('maps each row to the flat shape the frontend expects', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    const result = await run(ctrl.listCheques, {});
    expect(result[0]).toMatchObject({
      id: 1, paymentNo: 'PAP-000001', billNo: 'BILL-000007', vendorName: 'Triplekenn Supply',
      amount: 500, checkNo: 'CHK-001', clearingStatus: 'OUTSTANDING',
    });
  });

  test('computes a bucket for an OUTSTANDING cheque, null for a settled one', async () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const cleared = mkPayment({ id: 2, clearingStatus: 'CLEARED', checkDate: soon });
    const outstanding = mkPayment({ id: 1, clearingStatus: 'OUTSTANDING', checkDate: soon });
    prisma.paymentAP.findMany.mockResolvedValue([outstanding, cleared]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('0-7 days');
    expect(result.find((r) => r.id === 2).bucket).toBeNull();
  });

  test('buckets an OUTSTANDING cheque whose checkDate has already passed as Past Due', async () => {
    const past = new Date(); past.setDate(past.getDate() - 5);
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({ checkDate: past })]);

    const result = await run(ctrl.listCheques, {});

    expect(result[0].bucket).toBe('Past Due');
  });

  test('buckets at the 8-14, 15-30, and 30+ day boundaries', async () => {
    const at = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
    prisma.paymentAP.findMany.mockResolvedValue([
      mkPayment({ id: 1, checkDate: at(10) }),
      mkPayment({ id: 2, checkDate: at(20) }),
      mkPayment({ id: 3, checkDate: at(45) }),
    ]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('8-14 days');
    expect(result.find((r) => r.id === 2).bucket).toBe('15-30 days');
    expect(result.find((r) => r.id === 3).bucket).toBe('30+ days');
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx jest tests/payableControllerCheques.test.js`
Expected: FAIL — `ctrl.listCheques is not a function`.

- [ ] **Step 3: Implement `chequeAgingBucket` and `listCheques`**

In `server/controllers/payableController.js`, add after `exports.voidBill` (at the end of the file — check the current end of the file first; append after the last `};` closing the last export):

```javascript
// Bucketed on checkDate (the cheque's own maturity date), not paymentDate —
// only meaningful for an OUTSTANDING cheque; a settled one has no "days
// until due" story left to tell.
function chequeAgingBucket(checkDate) {
  const days = Math.floor((new Date(checkDate) - new Date()) / 86400000);
  if (days < 0)   return 'Past Due';
  if (days <= 7)  return '0-7 days';
  if (days <= 14) return '8-14 days';
  if (days <= 30) return '15-30 days';
  return '30+ days';
}

exports.listCheques = async (req, res, next) => {
  try {
    const { status } = req.query;
    const payments = await prisma.paymentAP.findMany({
      where: {
        paymentMethod: 'Check',
        bill: { businessId: req.businessId },
        ...(status ? { clearingStatus: status } : {}),
      },
      include: { bill: { select: { billNo: true, vendor: { select: { name: true } } } } },
      orderBy: { checkDate: 'asc' },
    });

    const result = payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      billId: p.billId,
      billNo: p.bill.billNo,
      vendorName: p.bill.vendor?.name,
      amount: p.amount,
      checkNo: p.reference,
      checkDate: p.checkDate,
      paymentDate: p.paymentDate,
      clearingStatus: p.clearingStatus,
      notes: p.notes,
      bucket: p.clearingStatus === 'OUTSTANDING' ? chequeAgingBucket(p.checkDate) : null,
    }));

    res.json(result);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx jest tests/payableControllerCheques.test.js`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Add the route — before `GET /:id`, matching where `/aging` already sits**

In `server/routes/payable.js`, find:
```javascript
router.get('/', ctrl.listBills);
router.get('/aging', ctrl.agingReport);
router.get('/:id', param('id').isInt(), validate, ctrl.getBill);
```
Replace with:
```javascript
router.get('/', ctrl.listBills);
router.get('/aging', ctrl.agingReport);
router.get('/cheques', ctrl.listCheques);
router.get('/:id', param('id').isInt(), validate, ctrl.getBill);
```
This ordering is load-bearing: `GET /:id` would otherwise greedily match `GET /payable/cheques` as `id='cheques'` (exactly why `/aging` is already placed here, ahead of `/:id`) and fail with a 400 from `param('id').isInt()` before ever reaching `listCheques`.

- [ ] **Step 6: Run the full payable suite to check for regressions**

Run: `npx jest tests/payableController`
Expected: PASS, zero failures.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerCheques.test.js
git commit -m "$(cat <<'EOF'
feat(payable): add GET /payable/cheques listing with aging buckets

Lists every Check-method payment (optionally filtered by
clearingStatus), joined with its bill/vendor, bucketed by days
until checkDate (0-7 / 8-14 / 15-30 / 30+ / Past Due) for
OUTSTANDING rows — feeds the new Cheques page (Task 6).
EOF
)"
```

---

### Task 4: Backend — `clearCheque`/`bounceCheque`/`cancelCheque`

**Files:**
- Modify: `server/controllers/payableController.js` (add a shared `revertOutstandingCheque` helper, `exports.clearCheque`, `exports.bounceCheque`, `exports.cancelCheque`)
- Modify: `server/routes/payable.js` (add the three POST routes)
- Test: `tests/payableControllerCheques.test.js` (extend — same file Task 3 created)

**Interfaces:**
- Consumes: `voidPostedEntriesByReference(businessId, reference, req, contextLabel)` (already defined in `payableController.js`, shared with `updateBill`/`voidBill`/`editPayment`). `createError`, `recordAudit`, `glPost.safePost` as used throughout this file.
- Produces: `POST /api/payable/cheques/:paymentId/clear` (body `{ clearDate }`), `POST /api/payable/cheques/:paymentId/bounce` (body `{ reason }`), `POST /api/payable/cheques/:paymentId/cancel` (body `{ reason }`) — all three respond `200 { message }` on success, all ADMIN/MANAGER-only, all 404 if the cheque doesn't exist (scoped through `bill.businessId`) or isn't `Check`-method, all 400 if `clearingStatus !== 'OUTSTANDING'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payableControllerCheques.test.js` — first extend the top-of-file mock (find the `jest.mock('../server/config/database', ...)` block from Task 3 and replace it, since `clear`/`bounce`/`cancel` need more of the client mocked):

Find:
```javascript
jest.mock('../server/config/database', () => ({
  paymentAP: {
    findMany: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');
```
Replace with:
```javascript
jest.mock('../server/config/database', () => ({
  paymentAP: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  bill: {
    update: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/payableController');
```

Then find `beforeEach(() => jest.clearAllMocks());` and replace with:
```javascript
beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
});
```

Then append this new `describe` block at the end of the file:

```javascript

const mkOutstandingPayment = (overrides) => ({
  id: 1, paymentNo: 'PAP-000001', billId: 7, amount: 500,
  clearingStatus: 'OUTSTANDING', notes: null,
  bill: { id: 7, billNo: 'BILL-000007', businessId: 1, paidAmount: 500, totalAmount: 1000, vendor: { name: 'Triplekenn Supply' } },
  ...overrides,
});

describe('clearCheque', () => {
  test('404s when the payment does not exist (or is outside the business)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(null);
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('400s when clearDate is missing', async () => {
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.findFirst).not.toHaveBeenCalled();
  });

  test('400s when the cheque is already settled', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({ clearingStatus: 'BOUNCED' }));
    await expect(run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('marks CLEARED and posts DR 2015 / CR 1020 without touching the bill', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.clearCheque, { params: { paymentId: '1' }, body: { clearDate: '2026-09-10' } });

    expect(prisma.paymentAP.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ clearingStatus: 'CLEARED' }),
    }));
    expect(prisma.bill.update).not.toHaveBeenCalled();
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('PAP-000001-CLR');
    expect(call.entryDate).toBe('2026-09-10');
    expect(call.lines.find((l) => l.accountCode === '2015').debit).toBeCloseTo(500, 2);
    expect(call.lines.find((l) => l.accountCode === '1020').credit).toBeCloseTo(500, 2);
  });
});

describe('bounceCheque / cancelCheque', () => {
  test('400s when reason is missing', async () => {
    await expect(run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.paymentAP.findFirst).not.toHaveBeenCalled();
  });

  test('400s when the cheque is already settled', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({ clearingStatus: 'CLEARED' }));
    await expect(run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('bounce reverts the bill paidAmount/status and voids the issue GL entry', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    let billUpdateArgs;
    prisma.bill.update.mockImplementation((args) => { billUpdateArgs = args; return Promise.resolve({}); });
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 200, entryNo: 'JE-1-000200' }]);
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    // baseline: bill.paidAmount 500, this payment's amount 500 → reverted paidAmount 0, status OPEN
    expect(billUpdateArgs.data.paidAmount).toBe(0);
    expect(billUpdateArgs.data.status).toBe('OPEN');
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'PAP-000001', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 200 }, data: { status: 'VOIDED' } }));
  });

  test('bounce sets clearingStatus BOUNCED and appends the reason to notes', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({}); });
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    expect(paymentUpdateArgs.data.clearingStatus).toBe('BOUNCED');
    expect(paymentUpdateArgs.data.notes).toContain('Insufficient funds');
  });

  test('cancel sets clearingStatus CANCELLED (same revert arithmetic as bounce)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => { paymentUpdateArgs = args; return Promise.resolve({}); });
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.cancelCheque, { params: { paymentId: '1' }, body: { reason: 'Stop payment requested' } });

    expect(paymentUpdateArgs.data.clearingStatus).toBe('CANCELLED');
  });

  test('does not post any new GL entry (only voids the issue entry)', async () => {
    prisma.paymentAP.findFirst.mockResolvedValue(mkOutstandingPayment({}));
    prisma.paymentAP.update.mockResolvedValue({});
    prisma.bill.update.mockResolvedValue({});
    prisma.journalEntry.findMany.mockResolvedValue([]);

    await run(ctrl.bounceCheque, { params: { paymentId: '1' }, body: { reason: 'Insufficient funds' } });

    expect(glPost.safePost).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run: `npx jest tests/payableControllerCheques.test.js`
Expected: the Task 3 tests still PASS; every new `clearCheque`/`bounceCheque`/`cancelCheque` test FAILS (`ctrl.clearCheque is not a function`, etc.).

- [ ] **Step 3: Implement the three actions**

In `server/controllers/payableController.js`, add after `exports.listCheques` (from Task 3):

```javascript
async function revertOutstandingCheque(req, res, next, targetStatus, contextLabel) {
  try {
    const paymentId = Number(req.params.paymentId);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A reason is required.', 400);

    const payment = await prisma.paymentAP.findFirst({
      where: { id: paymentId, bill: { businessId: req.businessId } },
      include: { bill: true },
    });
    if (!payment) throw createError('Cheque not found', 404);
    if (payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This cheque is already ${payment.clearingStatus?.toLowerCase()}.`, 400);
    }

    const bill = payment.bill;
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const remaining = Number(bill.totalAmount) - otherPaid;
    const status = remaining <= 0.01 ? 'PAID' : (otherPaid > 0.01 ? 'PARTIAL' : 'OPEN');

    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: {
          clearingStatus: targetStatus,
          notes: `${payment.notes ? payment.notes + ' ' : ''}[${targetStatus}: ${reason.trim()}]`,
        },
      }),
      prisma.bill.update({ where: { id: bill.id }, data: { paidAmount: otherPaid, status } }),
    ]);

    await recordAudit({
      req,
      action:   'UPDATE',
      entity:   'PaymentAP',
      entityId: payment.paymentNo,
      summary:  `Cheque ${payment.paymentNo} on bill ${bill.billNo} marked ${targetStatus}: ${reason.trim()}`,
    });

    await voidPostedEntriesByReference(bill.businessId, payment.paymentNo, req, contextLabel);

    res.json({ message: `Cheque marked ${targetStatus.toLowerCase()}` });
  } catch (err) { next(err); }
}

exports.bounceCheque = (req, res, next) => revertOutstandingCheque(req, res, next, 'BOUNCED', 'CHEQUE BOUNCED');
exports.cancelCheque = (req, res, next) => revertOutstandingCheque(req, res, next, 'CANCELLED', 'CHEQUE CANCELLED');

exports.clearCheque = async (req, res, next) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const { clearDate } = req.body;
    if (!clearDate) throw createError('Clear date is required.', 400);

    const payment = await prisma.paymentAP.findFirst({
      where: { id: paymentId, bill: { businessId: req.businessId } },
      include: { bill: { include: { vendor: { select: { name: true } } } } },
    });
    if (!payment) throw createError('Cheque not found', 404);
    if (payment.clearingStatus !== 'OUTSTANDING') {
      throw createError(`This cheque is already ${payment.clearingStatus?.toLowerCase()}.`, 400);
    }

    await prisma.paymentAP.update({ where: { id: paymentId }, data: { clearingStatus: 'CLEARED' } });

    await recordAudit({
      req,
      action:   'UPDATE',
      entity:   'PaymentAP',
      entityId: payment.paymentNo,
      summary:  `Cheque ${payment.paymentNo} on bill ${payment.bill.billNo} marked cleared`,
    });

    const glResult = await glPost.safePost({
      entryDate:   clearDate,
      description: `Cheque Cleared — ${payment.bill.vendor?.name} (${payment.bill.billNo})`,
      reference:   `${payment.paymentNo}-CLR`,
      lines: [
        { accountCode: '2015', debit:  Number(payment.amount), description: `Cheque cleared — ${payment.paymentNo}` },
        { accountCode: '1020', credit: Number(payment.amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!glResult || glResult.skipped) {
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   `${payment.paymentNo}-CLR`,
          summary:    `Cheque ${payment.paymentNo} was cleared but its GL entry did not post (${glResult?.skipped ? `skipped: ${glResult.skipped}` : 'failed'}) — its cash impact may be missing from the ledger.`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId: req.businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }

    res.json({ message: 'Cheque marked cleared' });
  } catch (err) { next(err); }
};
```

Note `revertOutstandingCheque` is declared as a plain (non-exported) `async function` — matching how `voidPostedEntriesByReference` is already declared in this same file — and is defined *before* `bounceCheque`/`cancelCheque` reference it, so no hoisting concerns.

- [ ] **Step 4: Run the test file to verify it passes**

Run: `npx jest tests/payableControllerCheques.test.js`
Expected: PASS, all tests (6 from Task 3 + the new `clearCheque`/`bounceCheque`/`cancelCheque` tests).

- [ ] **Step 5: Add the three routes**

In `server/routes/payable.js`, find:
```javascript
router.post('/:id/void', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.voidBill);

module.exports = router;
```
Replace with:
```javascript
router.post('/:id/void', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, ctrl.voidBill);

// Cheques
router.post('/cheques/:paymentId/clear',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('clearDate').isISO8601()],
  validate, ctrl.clearCheque);
router.post('/cheques/:paymentId/bounce',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('reason').notEmpty()],
  validate, ctrl.bounceCheque);
router.post('/cheques/:paymentId/cancel',
  authorize('ADMIN','MANAGER'),
  [param('paymentId').isInt(), body('reason').notEmpty()],
  validate, ctrl.cancelCheque);

module.exports = router;
```
(No ordering hazard here, unlike `GET /cheques` — these three have a literal 3rd segment (`clear`/`bounce`/`cancel`) that never collides with the existing `/:id/payment/:paymentId` pattern's literal 2nd segment `payment`.)

- [ ] **Step 6: Run the full payable suite to check for regressions**

Run: `npx jest tests/payableController`
Expected: PASS, zero failures.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerCheques.test.js
git commit -m "$(cat <<'EOF'
feat(payable): add clear/bounce/cancel actions for outstanding cheques

clearCheque posts DR Post-Dated Checks Payable / CR Cash, moving a
confirmed cheque's value into the bank without touching the bill
(already relieved at issue time). bounceCheque/cancelCheque share a
revert helper that voids the original issue GL entry and reverts the
bill's paidAmount/status — reusing editPayment's exact recompute
arithmetic — since a bounced/cancelled cheque was never real money.
EOF
)"
```

---

### Task 5: Frontend — Check Date field, edit-icon guard, status badge

**Files:**
- Modify: `lib/api.js` (add `payable.cheques` group)
- Modify: `app/(dashboard)/payable/page.jsx` (`PaymentModal`, `EditPaymentModal`, `BillDetailModal`'s Payment History block)

**Interfaces:**
- Consumes: `pApi.bills.payment`/`editPayment` (existing), the new `checkDate` field they now accept; `p.clearingStatus`/`p.checkDate` on each `bill.payments[]` row (already returned by `getBill`/`listBills` — no backend change needed here, `PaymentAP` is already fully serialized).
- Produces: `pApi.cheques.{list,clear,bounce,cancel}` — consumed by Task 6's new page.

- [ ] **Step 1: Add the API helpers**

In `lib/api.js`, inside the `payable` object, find:
```javascript
  bills: {
    list: (params) => api.get('/payable', { params }),
    get: (id) => api.get(`/payable/${id}`),
    create: (data) => api.post('/payable', data),
    update: (id, data) => api.put(`/payable/${id}`, data),
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    editPayment: (id, paymentId, data) => api.put(`/payable/${id}/payment/${paymentId}`, data),
    void: (id) => api.post(`/payable/${id}/void`),
    aging: () => api.get('/payable/aging'),
  },
};
```
Replace with:
```javascript
  bills: {
    list: (params) => api.get('/payable', { params }),
    get: (id) => api.get(`/payable/${id}`),
    create: (data) => api.post('/payable', data),
    update: (id, data) => api.put(`/payable/${id}`, data),
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    editPayment: (id, paymentId, data) => api.put(`/payable/${id}/payment/${paymentId}`, data),
    void: (id) => api.post(`/payable/${id}/void`),
    aging: () => api.get('/payable/aging'),
  },
  cheques: {
    list: (params) => api.get('/payable/cheques', { params }),
    clear: (paymentId, data) => api.post(`/payable/cheques/${paymentId}/clear`, data),
    bounce: (paymentId, data) => api.post(`/payable/cheques/${paymentId}/bounce`, data),
    cancel: (paymentId, data) => api.post(`/payable/cheques/${paymentId}/cancel`, data),
  },
};
```
(Verify the exact current text first — if `lib/api.js` has changed since this plan was written, locate the `bills: { ... }` block by its literal content, not a line number, and add the new `cheques` sibling key after it, still inside `export const payable = { ... }`.)

- [ ] **Step 2: Add the conditional Check Date field to `PaymentModal`**

In `app/(dashboard)/payable/page.jsx`, inside `PaymentModal`, find:
```javascript
  const [form, setForm] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: balance.toFixed(2),
    paymentMethod: 'Bank Transfer',
    reference: '',
    notes: '',
  });
```
Replace with:
```javascript
  const [form, setForm] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: balance.toFixed(2),
    paymentMethod: 'Bank Transfer',
    reference: '',
    notes: '',
    checkDate: '',
  });
```
Then find:
```javascript
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.payment(bill.id, { ...form, amount: Number(form.amount) });
```
Replace with:
```javascript
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    if (form.paymentMethod === 'Check' && !form.checkDate) {
      toast.error('Check date is required for a Check payment');
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.payment(bill.id, { ...form, amount: Number(form.amount) });
```
Then find (inside `PaymentModal`'s JSX, the Payment Method field):
```javascript
            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>
```
Replace with:
```javascript
            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            {form.paymentMethod === 'Check' && (
              <div className="form-group">
                <label className="label">Check Date *</label>
                <input type="date" className="input" required value={form.checkDate} onChange={set('checkDate')} />
                <p className="text-xs text-gray-400 mt-1">The date printed on the cheque — tracked separately on the new Cheques page until it clears.</p>
              </div>
            )}

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>
```

There are exactly two occurrences of this Payment Method + Reference No. block in the file — one in `PaymentModal`, one in `EditPaymentModal` — so this replacement is not unique on its own; apply it only within `PaymentModal`'s function body (between `function PaymentModal(` and the `EditPaymentModal` heading comment). Step 3 makes the equivalent change to `EditPaymentModal` separately, with its own pre-filled value.

- [ ] **Step 3: Add the same field to `EditPaymentModal`, pre-filled**

In `app/(dashboard)/payable/page.jsx`, inside `EditPaymentModal`, find:
```javascript
  const [form, setForm] = useState({
    paymentDate: payment.paymentDate.slice(0, 10),
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod,
    reference: payment.reference || '',
    notes: payment.notes || '',
  });
```
Replace with:
```javascript
  const [form, setForm] = useState({
    paymentDate: payment.paymentDate.slice(0, 10),
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod,
    reference: payment.reference || '',
    notes: payment.notes || '',
    checkDate: payment.checkDate ? payment.checkDate.slice(0, 10) : '',
  });
```
Then find (inside `EditPaymentModal`'s `handleSubmit`):
```javascript
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.editPayment(bill.id, payment.id, { ...form, amount: Number(form.amount) });
```
Replace with:
```javascript
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    if (form.paymentMethod === 'Check' && !form.checkDate) {
      toast.error('Check date is required for a Check payment');
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.editPayment(bill.id, payment.id, { ...form, amount: Number(form.amount) });
```
Then, inside `EditPaymentModal`'s own JSX (this block is textually identical to `PaymentModal`'s copy — find the occurrence inside `EditPaymentModal`'s function body, i.e. after the `function EditPaymentModal(` heading, not the one already edited in Step 2 inside `PaymentModal`), find:
```javascript
            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>
```
Replace with:
```javascript
            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            {form.paymentMethod === 'Check' && (
              <div className="form-group">
                <label className="label">Check Date *</label>
                <input type="date" className="input" required value={form.checkDate} onChange={set('checkDate')} />
                <p className="text-xs text-gray-400 mt-1">The date printed on the cheque — tracked separately on the new Cheques page until it clears.</p>
              </div>
            )}

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>
```

- [ ] **Step 4: Hide the Edit-Payment icon for a settled cheque, add a status badge**

In `app/(dashboard)/payable/page.jsx`, inside `BillDetailModal`, find:
```javascript
                {bill.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{formatCurrency(p.amount)}</span>
                      <span className="text-gray-500 ml-2">via {p.paymentMethod}</span>
                      {p.reference && <span className="text-gray-400 ml-2 text-xs">Ref: {p.reference}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">{formatDate(p.paymentDate)}</span>
                      {bill.status !== 'VOID' && (
                        <button onClick={() => onEditPayment(p)} className="text-gray-400 hover:text-blue-600" title="Edit payment">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
```
Replace with:
```javascript
                {bill.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{formatCurrency(p.amount)}</span>
                      <span className="text-gray-500 ml-2">via {p.paymentMethod}</span>
                      {p.reference && <span className="text-gray-400 ml-2 text-xs">Ref: {p.reference}</span>}
                      {p.clearingStatus && (
                        <span className={`badge ml-2 ${
                          p.clearingStatus === 'OUTSTANDING' ? 'badge-yellow' :
                          p.clearingStatus === 'CLEARED'     ? 'badge-green'  : 'badge-red'
                        }`}>
                          {p.clearingStatus}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">{formatDate(p.paymentDate)}</span>
                      {bill.status !== 'VOID' && (!p.clearingStatus || p.clearingStatus === 'OUTSTANDING') && (
                        <button onClick={() => onEditPayment(p)} className="text-gray-400 hover:text-blue-600" title="Edit payment">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
```

- [ ] **Step 5: Self-check — no automated frontend tests exist in this repo**

Re-read the full diff of `app/(dashboard)/payable/page.jsx` after Steps 2-4: confirm the Check Date block was added to *both* `PaymentModal` and `EditPaymentModal` (two separate insertions, not one shared component), confirm `PaymentModal`'s form still submits correctly for every non-Check method (the new `checkDate: ''` field is harmless — the backend ignores it unless `paymentMethod === 'Check'`), and confirm braces/JSX tags balance. This mirrors how the Edit Payment feature's own frontend task was self-verified (no test framework, careful re-read + prop/anchor matching).

- [ ] **Step 6: Commit**

```bash
git add lib/api.js "app/(dashboard)/payable/page.jsx"
git commit -m "$(cat <<'EOF'
feat(payable): add Check Date field, cheque status badge, and edit lock

PaymentModal/EditPaymentModal now show a required Check Date field
when paying by Check. Payment History shows each cheque's
Outstanding/Cleared/Bounced/Cancelled status, and hides the Edit
icon once a cheque is no longer Outstanding, matching the backend
guard added in Task 2. Also adds the lib/api.js client for the new
/payable/cheques endpoints, consumed by the Cheques page (Task 6).
EOF
)"
```

---

### Task 6: Frontend — Cheques page + navigation

**Files:**
- Create: `app/(dashboard)/payable/cheques/page.jsx`
- Modify: `components/layout/Sidebar.jsx` (add nav entry)

**Interfaces:**
- Consumes: `pApi.cheques.list()`, `.clear(paymentId, { clearDate })`, `.bounce(paymentId, { reason })`, `.cancel(paymentId, { reason })` (Task 5); each list row shape `{ id, paymentNo, billNo, vendorName, amount, checkNo, checkDate, paymentDate, clearingStatus, notes, bucket }` (Task 3). `printDocument`/`phpFmt`/`dateFmt` from `@/lib/print`, `exportToExcel` from `@/lib/export`, `formatCurrency`/`formatDate` from `@/lib/auth` — all pre-existing, same imports the AP Aging page already uses.

- [ ] **Step 1: Write the page**

Create `app/(dashboard)/payable/cheques/page.jsx`:

```javascript
'use client';
import { useState, useEffect, useCallback } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Clock, AlertCircle, CheckCircle2, Ban, XCircle, Printer,
  FileSpreadsheet, RefreshCw, History,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel } from '@/lib/export';

const BUCKET_ORDER = ['Past Due', '0-7 days', '8-14 days', '15-30 days', '30+ days'];
const BUCKET_BADGE = {
  'Past Due':   'badge-red',
  '0-7 days':   'badge-yellow',
  '8-14 days':  'badge-yellow',
  '15-30 days': 'badge-blue',
  '30+ days':   'badge-gray',
};
const STATUS_BADGE = {
  OUTSTANDING: 'badge-yellow',
  CLEARED:     'badge-green',
  BOUNCED:     'badge-red',
  CANCELLED:   'badge-gray',
};

// ─── Action confirm dialog — Clear (needs a date) or Bounce/Cancel (needs a reason) ───
function ActionDialog({ cheque, action, onClose, onDone }) {
  const [clearDate, setClearDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const title = action === 'clear' ? 'Mark Cheque Cleared' : action === 'bounce' ? 'Mark Cheque Bounced' : 'Cancel Cheque';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (action !== 'clear' && !reason.trim()) {
      toast.error('A reason is required');
      return;
    }
    setSaving(true);
    try {
      if (action === 'clear') await pApi.cheques.clear(cheque.id, { clearDate });
      else if (action === 'bounce') await pApi.cheques.bounce(cheque.id, { reason });
      else await pApi.cheques.cancel(cheque.id, { reason });
      toast.success(`Cheque ${action === 'clear' ? 'cleared' : action === 'bounce' ? 'marked bounced' : 'cancelled'}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Vendor</span><span className="font-medium">{cheque.vendorName}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Bill</span><span>{cheque.billNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Cheque No.</span><span>{cheque.checkNo || '—'}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1"><span>Amount</span><span>{formatCurrency(cheque.amount)}</span></div>
            </div>

            {action === 'clear' ? (
              <div className="form-group">
                <label className="label">Clear Date *</label>
                <input type="date" className="input" required value={clearDate} onChange={(e) => setClearDate(e.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label className="label">Reason *</label>
                <textarea className="input resize-none" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={action === 'bounce' ? 'e.g. Insufficient funds' : 'e.g. Stop payment requested by vendor'} />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className={action === 'clear' ? 'btn-success' : 'btn-danger'}>
              {saving ? 'Saving...' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChequesPage() {
  const [cheques, setCheques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('outstanding'); // 'outstanding' | 'history'
  const [dialog, setDialog] = useState(null); // { cheque, action }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await pApi.cheques.list();
      setCheques(data);
    } catch {
      toast.error('Failed to load cheques');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
      <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p>Loading cheques...</p>
    </div>
  );

  const outstanding = cheques.filter((c) => c.clearingStatus === 'OUTSTANDING');
  const history = cheques.filter((c) => c.clearingStatus !== 'OUTSTANDING');
  const totalOutstanding = outstanding.reduce((s, c) => s + Number(c.amount), 0);
  const pastDueCount = outstanding.filter((c) => c.bucket === 'Past Due').length;

  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: outstanding.filter((c) => c.bucket === bucket).sort((a, b) => new Date(a.checkDate) - new Date(b.checkDate)),
  })).filter((g) => g.items.length > 0);

  const handlePrint = () => {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = grouped.map((g) => `
      <div class="section-title">${esc(g.bucket)} (${g.items.length})</div>
      <table>
        <thead><tr><th>Vendor</th><th>Bill #</th><th>Cheque No.</th><th>Check Date</th><th class="right">Amount</th></tr></thead>
        <tbody>${g.items.map((c) => `
          <tr>
            <td>${esc(c.vendorName)}</td>
            <td class="mono">${esc(c.billNo)}</td>
            <td class="mono small">${esc(c.checkNo)}</td>
            <td>${dateFmt(c.checkDate)}</td>
            <td class="right mono bold">${phpFmt(c.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`).join('');
    const body = `
      <div class="totals-block" style="max-width:320px;margin-bottom:16px;">
        <div class="totals-row totals-total"><span>Total Outstanding</span><span class="mono">${phpFmt(totalOutstanding)}</span></div>
      </div>
      ${sections}
      <p class="small gray" style="margin-top:10px;">Outstanding post-dated cheques only, grouped by days until check date, as of the print date above.</p>`;
    printDocument('Outstanding Cheques', `${outstanding.length} cheque${outstanding.length !== 1 ? 's' : ''} · ${phpFmt(totalOutstanding)}`, body);
  };

  const handleExcel = () => {
    const rows = outstanding.map((c) => ({
      bucket: c.bucket, vendorName: c.vendorName, billNo: c.billNo, checkNo: c.checkNo,
      checkDate: c.checkDate, amount: Number(c.amount),
    }));
    exportToExcel(
      rows,
      [
        { key: 'bucket', label: 'Aging' },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'billNo', label: 'Bill #' },
        { key: 'checkNo', label: 'Cheque No.' },
        { key: 'checkDate', label: 'Check Date', format: (v) => dateFmt(v) },
        { key: 'amount', label: 'Amount', format: (v) => phpFmt(v) },
      ],
      'Outstanding-Cheques'
    );
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cheques</h1>
          <p className="page-subtitle">
            {outstanding.length} outstanding · {formatCurrency(totalOutstanding)}
            {pastDueCount > 0 && <span className="ml-2 text-red-600 font-medium">· {pastDueCount} past due</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={handlePrint} className="btn-secondary" disabled={outstanding.length === 0}><Printer className="w-4 h-4" /> Print</button>
          <button onClick={handleExcel} className="btn-secondary" disabled={outstanding.length === 0}><FileSpreadsheet className="w-4 h-4" /> Excel</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab('outstanding')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'outstanding' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
        >
          <Clock className="w-4 h-4 inline mr-1" /> Outstanding ({outstanding.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
        >
          <History className="w-4 h-4 inline mr-1" /> History ({history.length})
        </button>
      </div>

      {tab === 'outstanding' && (
        <div className="space-y-4">
          {grouped.length === 0 && (
            <div className="card"><div className="card-body text-center py-10 text-gray-400">No outstanding cheques.</div></div>
          )}
          {grouped.map((g) => (
            <div key={g.bucket} className="card">
              <div className="card-body pt-4 pb-2">
                <span className={`badge ${BUCKET_BADGE[g.bucket]}`}>{g.bucket}</span>
                <span className="text-gray-400 text-sm ml-2">{g.items.length} cheque{g.items.length !== 1 ? 's' : ''} · {formatCurrency(g.items.reduce((s, c) => s + Number(c.amount), 0))}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-t border-gray-100">
                  <tr>
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Bill #</th>
                    <th className="px-4 py-2">Cheque No.</th>
                    <th className="px-4 py-2">Check Date</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">{c.vendorName}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.billNo}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.checkNo || '—'}</td>
                      <td className="px-4 py-2">{formatDate(c.checkDate)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setDialog({ cheque: c, action: 'clear' })} className="text-green-600 hover:text-green-700" title="Mark cleared">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDialog({ cheque: c, action: 'bounce' })} className="text-red-600 hover:text-red-700" title="Mark bounced">
                            <AlertCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDialog({ cheque: c, action: 'cancel' })} className="text-gray-400 hover:text-gray-600" title="Cancel cheque">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Bill #</th>
                <th className="px-4 py-2">Cheque No.</th>
                <th className="px-4 py-2">Check Date</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">No settled cheques yet.</td></tr>
              )}
              {history.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{c.vendorName}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.billNo}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.checkNo || '—'}</td>
                  <td className="px-4 py-2">{formatDate(c.checkDate)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.amount)}</td>
                  <td className="px-4 py-2"><span className={`badge ${STATUS_BADGE[c.clearingStatus]}`}>{c.clearingStatus}</span></td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{c.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <ActionDialog
          cheque={dialog.cheque}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the nav entry**

In `components/layout/Sidebar.jsx`, find:
```javascript
        label: 'Accounts Payable', icon: CreditCard,
        children: [
          { label: 'Bills',    href: '/payable' },
          { label: 'Vendors',  href: '/payable/vendors' },
          { label: 'AP Aging', href: '/payable/aging' },
        ],
```
Replace with:
```javascript
        label: 'Accounts Payable', icon: CreditCard,
        children: [
          { label: 'Bills',    href: '/payable' },
          { label: 'Vendors',  href: '/payable/vendors' },
          { label: 'AP Aging', href: '/payable/aging' },
          { label: 'Cheques',  href: '/payable/cheques' },
        ],
```

- [ ] **Step 3: Manual verification in the browser**

The user runs their own dev server — do not start a competing instance; check `netstat -ano | findstr :3000` and only proceed if something is already listening (ask the controller if not). With it up:

1. Navigate to Payables → Cheques (new sidebar link). Confirm the page loads with "0 outstanding" (no Check payments exist yet) and both tabs render without error.
2. Go to Payables → Bills, open a bill, Record Payment, choose "Check" as the method — confirm the Check Date field appears and is required (try submitting without it).
3. Submit with a check date a few days out. Confirm the bill's Payment History shows an `OUTSTANDING` badge and the pencil (edit) icon is still visible.
4. Return to Payables → Cheques — confirm the new cheque appears in the correct aging bucket under the Outstanding tab, with working Print and Excel buttons.
5. Click the green check-circle action, submit a clear date — confirm it moves to the History tab as `CLEARED`, and disappears from Outstanding.
6. Repeat steps 2-3 with a second bill/cheque, then use the red alert-circle action to mark it Bounced with a reason — confirm the bill's balance/status reverts (check the bill detail), the cheque moves to History as `BOUNCED`, and the Edit-payment pencil icon is now hidden on that row in the bill's Payment History.
7. Check the General Ledger page for the journal entries: one `DR AP / CR 2015` per issued cheque, one `DR 2015 / CR 1020` for the cleared one, and confirm the bounced cheque's original entry shows `VOIDED`.

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/payable/cheques/page.jsx" components/layout/Sidebar.jsx
git commit -m "$(cat <<'EOF'
feat(payable): add Cheques page — aging, clear/bounce/cancel, print/Excel

New Payables > Cheques page: an Outstanding tab grouped by aging
bucket (Past Due / 0-7 / 8-14 / 15-30 / 30+ days) with Clear/Bounce/
Cancel actions per row, a History tab for settled cheques, and
print/Excel export matching the existing AP Aging page's pattern.
EOF
)"
```
