# Daily Cash Movement & Cash Position Report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Daily Remittance Report show only the chosen day's cash outflow (₱0.00 when nothing moved), and add a separate Cash Position report showing running balances per day across a date range.

**Architecture:** Everything derives from `journal_lines` on demand — no materialised balance tables. The running-balance logic lives in one pure function (`server/utils/cashbook.js`) that is unit-tested without a database; controllers only feed it. The Daily Remittance Report additionally persists its three outflow figures so an approved report cannot drift when someone later backdates or voids an entry.

**Tech Stack:** Next.js 14 App Router, Express, Prisma 5, MySQL 8, Jest, Lucide React, `react-hot-toast`.

**Spec:** `docs/superpowers/specs/2026-08-06-cash-position-design.md`

## Global Constraints

- Money is `Decimal(15, 2)` in Prisma and `Number` in JS. Round every accumulated total to 2 decimals with the shared `round2` helper to avoid float drift.
- Only `status: 'POSTED'` journal entries count. DRAFT and VOIDED are excluded everywhere.
- Every query filters by `businessId` (`req.businessId`, set by the `resolveBusiness` middleware).
- Dates crossing the API are `'YYYY-MM-DD'` strings. Build `Date` objects with an explicit `Z` suffix (`new Date(\`${d}T00:00:00.000Z\`)`) so MySQL reads them the same regardless of server timezone. This matches the existing `dayRange` helper.
- Cash accounts are: active, `accountType === 'ASSET'`, `accountCode` starts `'10'`, **and have no child accounts**. The leaf test excludes `1000 Current Assets`, which is a header.
- Petty cash fund codes are `'1011'` (cash) and `'1012'` (GCash). Cash on hand is `'1010'`.
- Follow the page pattern in `CLAUDE.md`: `page-header` → filter `card` → data `card`. Reuse `card`, `card-body`, `btn-primary`, `btn-secondary`, `input`, `label`, `badge-*`.
- Printing goes through `printDocument(title, subtitle, bodyHTML)` from `@/lib/print`, using `phpFmt()` / `dateFmt()` inside the HTML string.
- **Windows/Prisma:** stop the dev server before `npx prisma generate` or it fails with `EPERM ... query_engine-windows.dll.node`. Write migration SQL with the Write tool, never PowerShell `Out-File` — a BOM makes MySQL reject it with error 1064.
- Run the full suite with `npx jest`. It must stay green — 143 tests passing at plan time.

---

### Task 1: Freeze the day's cash outflow onto DailyRemittance

Adds the three columns the Daily Remittance Report needs so an approved report keeps the figures it was approved with, and backfills existing saved reports from the GL.

**Files:**
- Modify: `prisma/schema.prisma:770-793` (model `DailyRemittance`)
- Create: `prisma/migrations/20260806000002_add_daily_cash_outflow/migration.sql`
- Modify: `server/controllers/dailyRemittanceController.js` (`create`, `update`)

**Interfaces:**
- Consumes: nothing.
- Produces: `DailyRemittance.cashOnHandOut`, `.pettyCashOut`, `.pettyCashGcashOut` — all `Decimal(15,2)`, default `0`, non-null. `create` and `update` accept them in the request body under the same names.

- [ ] **Step 1: Add the columns to the Prisma schema**

In `prisma/schema.prisma`, inside `model DailyRemittance`, add these three lines immediately after `vatCollected`:

```prisma
  vatCollected  Decimal               @default(0) @db.Decimal(15, 2)
  // Cash that left each fund on this date. Persisted rather than recomputed:
  // an approved remittance is a signed document and must not change when an
  // entry is later backdated or voided.
  cashOnHandOut     Decimal           @default(0) @db.Decimal(15, 2)
  pettyCashOut      Decimal           @default(0) @db.Decimal(15, 2)
  pettyCashGcashOut Decimal           @default(0) @db.Decimal(15, 2)
  status        DailyRemitStatus      @default(DRAFT)
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260806000002_add_daily_cash_outflow/migration.sql` **with the Write tool** (a PowerShell BOM breaks it):

```sql
-- Freeze each day's cash outflow onto the remittance record. Previously the
-- Daily Remittance Report recomputed cash figures live, so an approved report
-- silently changed whenever an entry was backdated or voided.
ALTER TABLE `daily_remittances`
  ADD COLUMN `cashOnHandOut`     DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `pettyCashOut`      DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `pettyCashGcashOut` DECIMAL(15,2) NOT NULL DEFAULT 0.00;

-- Backfill saved reports from the GL: total credited to each fund on that date.
UPDATE `daily_remittances` r
SET
  `cashOnHandOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1010'
      AND a.businessId = r.businessId
  ), 0),
  `pettyCashOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1011'
      AND a.businessId = r.businessId
  ), 0),
  `pettyCashGcashOut` = COALESCE((
    SELECT SUM(l.credit) FROM `journal_lines` l
    JOIN `journal_entries` e ON e.id = l.entryId
    JOIN `accounts` a        ON a.id = l.accountId
    WHERE e.status = 'POSTED' AND e.businessId = r.businessId
      AND DATE(e.entryDate) = r.date AND a.accountCode = '1012'
      AND a.businessId = r.businessId
  ), 0);
```

- [ ] **Step 3: Verify the file has no BOM**

Run: `head -c 6 "prisma/migrations/20260806000002_add_daily_cash_outflow/migration.sql" | od -c`
Expected: starts with `-   -       F   r` — **not** `357 273 277`.

- [ ] **Step 4: Apply the migration**

Run: `npx prisma migrate deploy`
Expected: `The following migration(s) have been applied:` listing `20260806000002_add_daily_cash_outflow`.

- [ ] **Step 5: Regenerate the Prisma client**

Stop the dev server first (find the `npm run dev` PID via `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`, then `taskkill //PID <pid> //T //F`).

Run: `npx prisma generate`
Expected: `Generated Prisma Client`, no `EPERM`.

- [ ] **Step 6: Verify the backfill landed**

Run:
```bash
"C:/Program Files/MySQL/MySQL Server 9.4/bin/mysql.exe" -uroot -p123700 ph_erp_db -e \
  "SELECT date, cashOnHandOut, pettyCashOut, pettyCashGcashOut FROM daily_remittances WHERE businessId=1 ORDER BY date;"
```
Expected: exactly one row exists — the DRAFT report for **2026-08-03** — and it must read `cashOnHandOut = 264.00`, `pettyCashOut = 30.00`, `pettyCashGcashOut = 0.00`. (No report has been saved for Aug 5, so the 7,830 / 7,890 figures will not appear here.)

- [ ] **Step 7: Persist the fields on create**

In `server/controllers/dailyRemittanceController.js`, in `exports.create`, extend the destructure and the `data` block:

```js
    const {
      date, totalSales, vatCollected, cashReceived,
      totalExpenses, cashDisbursed, netCash,
      cashOnHandOut, pettyCashOut, pettyCashGcashOut,
      preparedBy, notes, items = [],
    } = req.body;
```

and inside `prisma.dailyRemittance.create({ data: { ... } })`, after `netCash:`:

```js
        netCash:      Number(netCash      || 0),
        cashOnHandOut:     Number(cashOnHandOut     || 0),
        pettyCashOut:      Number(pettyCashOut      || 0),
        pettyCashGcashOut: Number(pettyCashGcashOut || 0),
```

- [ ] **Step 8: Persist the fields on update**

In `exports.update`, extend the destructure and the `data` block:

```js
    const {
      totalSales, vatCollected, cashReceived,
      totalExpenses, cashDisbursed, netCash,
      cashOnHandOut, pettyCashOut, pettyCashGcashOut,
      preparedBy, notes, items,
    } = req.body;
```

```js
        netCash:       netCash       != null ? Number(netCash)       : undefined,
        cashOnHandOut:     cashOnHandOut     != null ? Number(cashOnHandOut)     : undefined,
        pettyCashOut:      pettyCashOut      != null ? Number(pettyCashOut)      : undefined,
        pettyCashGcashOut: pettyCashGcashOut != null ? Number(pettyCashGcashOut) : undefined,
```

- [ ] **Step 9: Confirm the suite is still green**

Run: `npx jest`
Expected: `Tests: 143 passed`.

- [ ] **Step 10: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260806000002_add_daily_cash_outflow server/controllers/dailyRemittanceController.js
git commit -m "feat(remittance): persist each day's cash outflow on the record"
```

---

### Task 2: Daily Remittance calculate returns movement, not balances

Swaps the cumulative as-of-date cash aggregates for same-day ones, so nothing from another day can appear on the report.

**Files:**
- Modify: `server/controllers/dailyRemittanceController.js` (`dayRange`/`asOfEndOf` helpers, `calculate`)
- Create: `tests/dailyCashMovement.test.js`

**Interfaces:**
- Consumes: `paidFromPettyCash(voucher)` from Task 0 (already in the file).
- Produces: `GET /api/remittance/daily/calculate?date=` response now contains `cashOnHandOut`, `pettyCashOut`, `pettyCashGcashOut` (all `Number`), and **no longer** contains `pettyCashBalance`, `pettyCashFunded`, `pettyCashUsed`, `pettyCashGcashBalance`, `pettyCashGcashFunded`, `pettyCashGcashUsed`, `cashOnHandBalance`. `counts.pettyCash` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/dailyCashMovement.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice:               { findMany: jest.fn() },
  paymentAR:             { findMany: jest.fn() },
  bill:                  { findMany: jest.fn() },
  paymentAP:             { findMany: jest.fn() },
  inventoryTransaction:  { findMany: jest.fn() },
  expenseVoucher:        { findMany: jest.fn() },
  journalLine:           { aggregate: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/dailyRemittanceController');

const run = (date) => new Promise((resolve, reject) => {
  ctrl.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
});

// The three journalLine.aggregate calls resolve in declaration order:
// 1011 petty cash, 1012 GCash, 1010 cash on hand.
const mockCash = ({ pc = [0, 0], gcash = [0, 0], coh = [0, 0] }) => {
  prisma.journalLine.aggregate
    .mockResolvedValueOnce({ _sum: { debit: pc[0],    credit: pc[1] } })
    .mockResolvedValueOnce({ _sum: { debit: gcash[0], credit: gcash[1] } })
    .mockResolvedValueOnce({ _sum: { debit: coh[0],   credit: coh[1] } });
};

beforeEach(() => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
});

describe('daily cash movement', () => {
  test('reports the day\'s outflow per fund', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    expect(r.pettyCashOut).toBe(7890);
    expect(r.cashOnHandOut).toBe(7830);
  });

  // The reported bug: a day with no cash activity must read zero, with nothing
  // carried in from the previous day.
  test('a day with no cash activity is zero, not a carried-over balance', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: null, credit: null } });
    const r = await run('2026-08-06');
    expect(r.pettyCashOut).toBe(0);
    expect(r.cashOnHandOut).toBe(0);
  });

  // 1012 is optional. `null` means "this business has no GCash fund" and hides
  // the card; 0 would render a phantom zero card, which is the bug being fixed.
  test('an unused GCash fund reports null so the card stays hidden', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    expect(r.pettyCashGcashOut).toBeNull();
  });

  test('a GCash fund with activity reports its outflow', async () => {
    mockCash({ pc: [0, 0], gcash: [500, 200], coh: [0, 0] });
    const r = await run('2026-08-05');
    expect(r.pettyCashGcashOut).toBe(200);
  });

  test('no cumulative balance fields leak onto the daily report', async () => {
    mockCash({ pc: [7830, 7890], coh: [0, 7830] });
    const r = await run('2026-08-05');
    for (const k of ['pettyCashBalance', 'pettyCashFunded', 'pettyCashUsed',
                     'pettyCashGcashBalance', 'pettyCashGcashFunded', 'pettyCashGcashUsed',
                     'cashOnHandBalance']) {
      expect(r).not.toHaveProperty(k);
    }
  });

  test('queries a single day, not everything up to that day', async () => {
    mockCash({});
    await run('2026-08-05');
    const where = prisma.journalLine.aggregate.mock.calls[0][0].where;
    expect(where.entry.entryDate.gte).toEqual(new Date('2026-08-05T00:00:00.000Z'));
    expect(where.entry.entryDate.lte).toEqual(new Date('2026-08-05T23:59:59.999Z'));
    expect(where.entry.status).toBe('POSTED');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/dailyCashMovement.test.js`
Expected: FAIL — `expect(received).toBe(expected)` on `r.pettyCashOut` being `undefined`, and the leak test failing on `pettyCashBalance`.

- [ ] **Step 3: Delete the `asOfEndOf` helper**

In `server/controllers/dailyRemittanceController.js`, delete lines 13-18 entirely:

```js
// Cutoff for an "as of end of this date" running balance. Cash balances are
// cumulative — every POSTED entry up to and including the chosen day — so they
// answer "how much should be in the drawer at close of business that day?"
function asOfEndOf(dateStr) {
  return { lte: new Date(`${dateStr}T23:59:59.999Z`) };
}
```

- [ ] **Step 4: Scope the three cash aggregates to the day**

In `exports.calculate`, delete the `asOfEnd` line:

```js
    const range   = dayRange(date);
    const asOfEnd = asOfEndOf(date);   // cash balances are cumulative to end of day
```

becomes:

```js
    const range = dayRange(date);
```

Then in each of the three `prisma.journalLine.aggregate` calls, replace `entryDate: asOfEnd` with `entryDate: range`, and update the comments:

```js
      // Petty Cash Fund – Cash (1011) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1011', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
      // Petty Cash Fund – GCash (1012) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1012', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
      // Cash on Hand (1010) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1010', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
```

- [ ] **Step 5: Replace the balance computation with outflow only**

Replace this block:

```js
    // Petty Cash Fund – Cash (1011) balance as of end of the selected date
    const pcDebits         = Number(pettyCashGL._sum.debit  || 0);
    const pcCredits        = Number(pettyCashGL._sum.credit || 0);
    const pettyCashBalance = pcDebits - pcCredits;
    // Petty Cash Fund – GCash (1012) balance as of end of the selected date.
    // 1012 is optional — businesses that never set it up have no rows at all, so
    // report null (card hidden) rather than a phantom zero balance.
    const pcGcashDebits   = Number(pettyCashGcashGL._sum.debit  || 0);
    const pcGcashCredits  = Number(pettyCashGcashGL._sum.credit || 0);
    const hasGcashFund    = pcGcashDebits > 0 || pcGcashCredits > 0;
    const pettyCashGcashBalance = hasGcashFund ? pcGcashDebits - pcGcashCredits : null;
    // Cash on Hand (1010) balance as of end of the selected date
    const cohDebits         = Number(cashOnHandGL._sum.debit  || 0);
    const cohCredits        = Number(cashOnHandGL._sum.credit || 0);
    const cashOnHandBalance = cohDebits - cohCredits;
```

with:

```js
    // Cash that LEFT each fund on the selected date. This report is a one-day
    // operational document — it never shows a balance, so nothing from an
    // adjacent day can appear on it. Running balances live in the Cash Position
    // report instead.
    const pettyCashOut      = Number(pettyCashGL._sum.credit      || 0);
    const pettyCashGcashOut = Number(pettyCashGcashGL._sum.credit || 0);
    const cashOnHandOut     = Number(cashOnHandGL._sum.credit     || 0);
    // 1012 is optional — hide the GCash card entirely for businesses that never
    // set the fund up rather than showing a phantom zero.
    const hasGcashFund = Number(pettyCashGcashGL._sum.debit || 0) > 0 || pettyCashGcashOut > 0;
```

- [ ] **Step 6: Update the response payload**

Replace:

```js
      totalExpenses, pettyCashTotal,
      pettyCashBalance, pettyCashFunded: pcDebits, pettyCashUsed: pcCredits,
      pettyCashGcashBalance,
      pettyCashGcashFunded: hasGcashFund ? pcGcashDebits  : null,
      pettyCashGcashUsed:   hasGcashFund ? pcGcashCredits : null,
      cashOnHandBalance, cashDisbursed, netCash,
```

with:

```js
      totalExpenses, pettyCashTotal,
      pettyCashOut,
      pettyCashGcashOut: hasGcashFund ? pettyCashGcashOut : null,
      cashOnHandOut, cashDisbursed, netCash,
```

- [ ] **Step 7: Run the test to confirm it passes**

Run: `npx jest tests/dailyCashMovement.test.js`
Expected: `Tests: 6 passed`.

- [ ] **Step 8: Confirm the whole suite is green**

Run: `npx jest`
Expected: `Tests: 149 passed`.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/dailyRemittanceController.js tests/dailyCashMovement.test.js
git commit -m "feat(remittance): daily report shows the day's cash outflow, not a running balance"
```

---

### Task 3: Daily Remittance cards show outflow only

Rewrites the two cash cards and the save/load round trip so an approved report reloads with the figures it was approved with.

**Files:**
- Modify: `app/(dashboard)/remittance/daily/page.jsx` — `loadSaved` (~L141-167), `save` payload (~L185-200), print summary (~L309), cards (~L500-564)

**Interfaces:**
- Consumes: `cashOnHandOut`, `pettyCashOut`, `pettyCashGcashOut` from `GET /remittance/daily/calculate` (Task 2) and from the saved record (Task 1).
- Produces: no new exports.

- [ ] **Step 1: Restore the outflow fields when loading a saved report**

In `loadSaved`, inside `setCalcData({ ... })`, replace:

```js
          pettyCashTotal:Number(full.data.pettyCashTotal || 0),
```

with:

```js
          pettyCashTotal:    Number(full.data.pettyCashTotal    || 0),
          cashOnHandOut:     Number(full.data.cashOnHandOut     || 0),
          pettyCashOut:      Number(full.data.pettyCashOut      || 0),
          // null (not 0) keeps the GCash card hidden for businesses with no
          // 1012 fund, matching what `calculate` returns for a live report.
          pettyCashGcashOut: Number(full.data.pettyCashGcashOut || 0) > 0
            ? Number(full.data.pettyCashGcashOut)
            : null,
```

This fixes the existing bug where reloading an approved report showed blank cash figures.

- [ ] **Step 2: Send the outflow fields when saving**

In the `save` function, add to the payload object after `netCash:`:

```js
          netCash:       calcData.netCash,
          cashOnHandOut:     calcData.cashOnHandOut     || 0,
          pettyCashOut:      calcData.pettyCashOut      || 0,
          pettyCashGcashOut: calcData.pettyCashGcashOut || 0,
```

- [ ] **Step 3: Replace the Cash on Hand card**

Replace the whole `{/* Cash on Hand balance */}` card block:

```jsx
            {/* Cash on Hand — money that left account 1010 today */}
            <div className="card p-4 border-blue-200 bg-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <Banknote className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-gray-500 font-medium">Cash on Hand</span>
              </div>
              <div className="text-xl font-bold text-blue-700">
                {fmt(calcData.cashOnHandOut || 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Cash out today · Account 1010</div>
            </div>
```

Note the label is **"Cash out today"**, not "spent" — this figure includes transfers into petty cash, which left the drawer without being an expense.

- [ ] **Step 4: Replace the Petty Cash – Cash card**

Replace the whole `{/* Petty Cash Fund – Cash (1011) */}` block — the progress bar goes away, since it rendered a percentage of *lifetime* funding:

```jsx
            {/* Petty Cash – Cash (1011) — spent today */}
            <div className="card p-4 border-yellow-200 bg-yellow-50">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-yellow-600" />
                <span className="text-xs text-gray-500 font-medium">Petty Cash – Cash</span>
              </div>
              <div className="text-xl font-bold text-yellow-700">
                {fmt(calcData.pettyCashOut || 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Spent today · {calcData.counts?.pettyCash ?? 0} voucher{(calcData.counts?.pettyCash ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
```

- [ ] **Step 5: Replace the Petty Cash – GCash card**

Replace the whole `{calcData.pettyCashGcashBalance != null && ( ... )}` block:

```jsx
            {calcData.pettyCashGcashOut != null && (
              <div className="card p-4 border-blue-200 bg-blue-50">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-blue-600" />
                  <span className="text-xs text-gray-500 font-medium">Petty Cash – GCash</span>
                </div>
                <div className="text-xl font-bold text-blue-700">
                  {fmt(calcData.pettyCashGcashOut)}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Spent today · Account 1012</div>
              </div>
            )}
```

- [ ] **Step 6: Clarify the Cash Paid Out subtitle**

`cashDisbursed` and the new Cash on Hand figure overlap without being equal, and both are correct — one is document-driven, the other account-driven. The existing `AP Payments` subtitle is now misleading, since the figure also includes non-petty-cash vouchers.

In the `{/* Disbursements */}` card, replace the subtitle:

```jsx
              <div className="text-xs text-gray-400 mt-0.5">AP payments + vouchers</div>
```

- [ ] **Step 7: Update the print summary rows**

At the print-HTML summary (~L309), replace the petty cash / cash on hand rows with:

```js
            ${summaryRow('Cash on Hand — cash out (1010)', d.cashOnHandOut || 0)}
            ${summaryRow('Petty Cash — spent (1011)', d.pettyCashOut || 0)}
            ${d.pettyCashGcashOut != null ? summaryRow('Petty Cash — spent (GCash 1012)', d.pettyCashGcashOut) : ''}
```

- [ ] **Step 8: Verify in the running app**

Start the dev server (`npm run dev`), open `http://localhost:3000/remittance/daily`.

- Set the date to **2026-08-05**, click **Generate**. Expected: Cash on Hand `₱7,830.00`, Petty Cash – Cash `₱7,890.00` with `8 vouchers`, no GCash card, no progress bar, no negative red figure.
- Set the date to **2026-08-06**. Expected: both cards read **`₱0.00`**.
- Save the Aug 5 report as a draft, reload the page, reselect Aug 5. Expected: the same `₱7,830.00` / `₱7,890.00`, not blanks.

- [ ] **Step 9: Confirm the suite is green**

Run: `npx jest`
Expected: `Tests: 149 passed`.

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/remittance/daily/page.jsx"
git commit -m "feat(remittance): cash cards show the day's outflow only"
```

---

### Task 4: The cashbook function

The pure running-balance engine. No database, no Express — this is where the report's correctness lives and where the tests point.

**Files:**
- Create: `server/utils/cashbook.js`
- Create: `tests/cashbook.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `round2(n: number) → number`
  - `buildCashbook(opening: number, movements: Array<{date: string, in: number, out: number}>) → { rows: Array<{date: string, begin: number, in: number, out: number, ending: number}>, totalIn: number, totalOut: number, opening: number, closing: number }`
  - `CASH_CODE_PREFIX = '10'`

- [ ] **Step 1: Write the failing test**

Create `tests/cashbook.test.js`:

```js
const { buildCashbook, round2 } = require('../server/utils/cashbook');

describe('round2', () => {
  test('rounds to two decimals', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(7920.005)).toBe(7920.01);
  });
});

describe('buildCashbook', () => {
  // Live data: 1011 opens at 0, spends 30 on Aug 3, is funded 7,830 and spends
  // 7,890 on Aug 5, and closes at -90.
  const PETTY_CASH = [
    { date: '2026-08-03', in: 0,    out: 30 },
    { date: '2026-08-05', in: 7830, out: 7890 },
  ];

  test('chains the running balance across days', () => {
    const { rows } = buildCashbook(0, PETTY_CASH);
    expect(rows).toEqual([
      { date: '2026-08-03', begin: 0,   in: 0,    out: 30,   ending: -30 },
      { date: '2026-08-05', begin: -30, in: 7830, out: 7890, ending: -90 },
    ]);
  });

  test("each row's begin equals the previous row's ending", () => {
    const { rows } = buildCashbook(1000, [
      { date: '2026-08-01', in: 500, out: 200 },
      { date: '2026-08-02', in: 0,   out: 100 },
      { date: '2026-08-04', in: 50,  out: 0 },
    ]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].begin).toBe(rows[i - 1].ending);
    }
  });

  test('reports a negative ending rather than clamping at zero', () => {
    const { closing } = buildCashbook(0, PETTY_CASH);
    expect(closing).toBe(-90);
  });

  test('emits no row for a day with no movement', () => {
    const { rows } = buildCashbook(0, PETTY_CASH);
    expect(rows.map(r => r.date)).not.toContain('2026-08-04');
    expect(rows).toHaveLength(2);
  });

  test('an empty range opens and closes at the same figure', () => {
    const r = buildCashbook(45076, []);
    expect(r.rows).toEqual([]);
    expect(r.opening).toBe(45076);
    expect(r.closing).toBe(45076);
    expect(r.totalIn).toBe(0);
    expect(r.totalOut).toBe(0);
  });

  test('sorts unordered movements by date', () => {
    const { rows } = buildCashbook(0, [
      { date: '2026-08-05', in: 7830, out: 7890 },
      { date: '2026-08-03', in: 0,    out: 30 },
    ]);
    expect(rows.map(r => r.date)).toEqual(['2026-08-03', '2026-08-05']);
  });

  test('totals the range', () => {
    const { totalIn, totalOut } = buildCashbook(0, PETTY_CASH);
    expect(totalIn).toBe(7830);
    expect(totalOut).toBe(7920);
  });

  // The invariant tying this report to the Daily Remittance Report.
  test('opening + sum(in - out) === closing', () => {
    const cases = [
      { opening: 0,     movements: PETTY_CASH },
      { opening: 45076, movements: [] },
      { opening: -90,   movements: [{ date: '2026-09-01', in: 1000, out: 0 }] },
      { opening: 10.05, movements: [{ date: '2026-09-01', in: 0.1, out: 0.2 }] },
    ];
    for (const { opening, movements } of cases) {
      const r = buildCashbook(opening, movements);
      const net = movements.reduce((s, m) => s + m.in - m.out, 0);
      expect(r.closing).toBe(round2(opening + net));
    }
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/cashbook.test.js`
Expected: FAIL — `Cannot find module '../server/utils/cashbook'`.

- [ ] **Step 3: Write the implementation**

Create `server/utils/cashbook.js`:

```js
// Pure running-balance engine for the Cash Position report.
// No database, no Express — the report's correctness lives here.

// Money arrives as JS numbers converted from Prisma Decimals. Rounding every
// accumulation keeps 0.1 + 0.2 from becoming 0.30000000000000004 in a ledger.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Cash accounts are the leaf ASSET accounts whose code starts here.
const CASH_CODE_PREFIX = '10';

/**
 * Walk a set of daily movements, carrying the running balance.
 *
 * Rows are emitted only for days that actually moved — a quiet month must not
 * produce thirty identical rows, and the running balance already states the
 * figure for any date in between.
 *
 * @param {number} opening  balance before the first day of the range
 * @param {Array<{date: string, in: number, out: number}>} movements
 * @returns {{rows: Array<{date: string, begin: number, in: number, out: number, ending: number}>,
 *            opening: number, closing: number, totalIn: number, totalOut: number}}
 */
function buildCashbook(opening, movements = []) {
  const start = round2(Number(opening) || 0);
  const sorted = [...movements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let running = start;
  let totalIn = 0;
  let totalOut = 0;

  const rows = sorted.map((m) => {
    const moneyIn  = round2(Number(m.in)  || 0);
    const moneyOut = round2(Number(m.out) || 0);
    const begin    = running;
    running  = round2(begin + moneyIn - moneyOut);
    totalIn  = round2(totalIn  + moneyIn);
    totalOut = round2(totalOut + moneyOut);
    return { date: m.date, begin, in: moneyIn, out: moneyOut, ending: running };
  });

  return { rows, opening: start, closing: running, totalIn, totalOut };
}

module.exports = { buildCashbook, round2, CASH_CODE_PREFIX };
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest tests/cashbook.test.js`
Expected: `Tests: 9 passed`.

- [ ] **Step 5: Commit**

```bash
git add server/utils/cashbook.js tests/cashbook.test.js
git commit -m "feat(reports): add the cashbook running-balance engine"
```

---

### Task 5: Cash Position endpoints

Wires the cashbook to the GL and exposes it over HTTP, including the lazy per-day drill-down.

**Files:**
- Create: `server/controllers/cashPositionController.js`
- Create: `server/routes/cashPosition.js`
- Modify: `server/routes/index.js:33` (add the export)
- Modify: `server/index.js:144` (mount the router)
- Create: `tests/cashPosition.test.js`

**Interfaces:**
- Consumes: `buildCashbook`, `round2`, `CASH_CODE_PREFIX` from `server/utils/cashbook.js` (Task 4).
- Produces:
  - `resolveCashAccounts(businessId, accountCode?) → Promise<Array<{id, accountCode, accountName}>>` — exported for testing
  - `GET /api/reports/cash-position?from&to[&accountCode]` → `{ from, to, accounts: [{ accountCode, accountName, opening, closing, totalIn, totalOut, rows }] }`
  - `GET /api/reports/cash-position/day?date&accountCode` → `{ date, accountCode, lines: [{ entryNo, reference, description, in, out }] }`

- [ ] **Step 1: Write the failing test**

Create `tests/cashPosition.test.js`:

```js
jest.mock('../server/config/database', () => ({
  account:     { findMany: jest.fn() },
  journalLine: { aggregate: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/cashPositionController');

const call = (query) => new Promise((resolve, reject) => {
  ctrl.report({ query, businessId: 1 }, { json: resolve }, (err) => reject(err));
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([
    { id: 3, accountCode: '1011', accountName: 'Petty Cash Fund', children: [] },
  ]);
  prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: null, credit: null } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

// A GL line as the controller selects it.
const line = (date, debit, credit) => ({
  debit, credit, entry: { entryDate: new Date(`${date}T00:00:00.000Z`) },
});

describe('GET /reports/cash-position', () => {
  test('rejects a missing date range', async () => {
    await expect(call({ from: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects from later than to', async () => {
    await expect(call({ from: '2026-08-09', to: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a range wider than 366 days', async () => {
    await expect(call({ from: '2025-01-01', to: '2026-06-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('excludes header accounts such as 1000 Current Assets', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountType).toBe('ASSET');
    expect(where.accountCode.startsWith).toBe('10');
    expect(where.children).toEqual({ none: {} });
  });

  test('a non-cash asset account cannot be requested', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await expect(call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1104' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('the 10xx prefix still applies when a code is requested', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1011' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountCode).toEqual({ startsWith: '10', equals: '1011' });
  });

  test('counts only POSTED entries', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(prisma.journalLine.aggregate.mock.calls[0][0].where.entry.status).toBe('POSTED');
  });

  test('builds a chained cashbook from GL movement', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
    // Aug 5 arrives as several lines and must collapse into one day bucket.
    prisma.journalLine.findMany.mockResolvedValue([
      line('2026-08-03', 0,    30),
      line('2026-08-05', 7830, 0),
      line('2026-08-05', 0,    7890),
    ]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    const acct = r.accounts[0];
    expect(acct.accountCode).toBe('1011');
    expect(acct.opening).toBe(0);
    expect(acct.closing).toBe(-90);
    expect(acct.totalIn).toBe(7830);
    expect(acct.totalOut).toBe(7920);
    expect(acct.rows).toHaveLength(2);
    expect(acct.rows[1].begin).toBe(-30);
  });

  test('returns an empty accounts array when the business has no cash accounts', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts).toEqual([]);
  });

  test('a range with no movement opens and closes the same', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 100, credit: 40 } });
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts[0].opening).toBe(60);
    expect(r.accounts[0].closing).toBe(60);
    expect(r.accounts[0].rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest tests/cashPosition.test.js`
Expected: FAIL — `Cannot find module '../server/controllers/cashPositionController'`.

- [ ] **Step 3: Write the controller**

Create `server/controllers/cashPositionController.js`:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { buildCashbook, round2, CASH_CODE_PREFIX } = require('../utils/cashbook');

const MAX_RANGE_DAYS = 366;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const startOf = (d) => new Date(`${d}T00:00:00.000Z`);
const endOf   = (d) => new Date(`${d}T23:59:59.999Z`);
const dateKey = (d) => new Date(d).toISOString().slice(0, 10);

// Validate and normalise the ?from & ?to range shared by both endpoints.
function parseRange(query) {
  const { from, to } = query;
  if (!from || !to)                       throw createError('from and to query params are required (YYYY-MM-DD)', 400);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw createError('from and to must be YYYY-MM-DD', 400);
  if (from > to)                          throw createError('from must not be later than to', 400);

  const days = Math.round((startOf(to) - startOf(from)) / 86400000) + 1;
  if (days > MAX_RANGE_DAYS) throw createError(`Range must be ${MAX_RANGE_DAYS} days or fewer`, 400);

  return { from, to };
}

// Cash accounts are the LEAF asset accounts under the 10xx range. The leaf test
// matters: `1000 Current Assets` is an ASSET whose code starts '10' but is the
// parent header of every cash account and holds no postings.
async function resolveCashAccounts(businessId, accountCode) {
  return prisma.account.findMany({
    where: {
      businessId,
      isActive:    true,
      accountType: 'ASSET',
      // The prefix always applies, even when a specific code is requested —
      // otherwise `?accountCode=1104` (Advances to Officers) would resolve, since
      // it is also an active leaf ASSET account.
      accountCode: {
        startsWith: CASH_CODE_PREFIX,
        ...(accountCode ? { equals: accountCode } : {}),
      },
      children:    { none: {} },
    },
    select: { id: true, accountCode: true, accountName: true },
    orderBy: { accountCode: 'asc' },
  });
}

exports.resolveCashAccounts = resolveCashAccounts;

// ─── GET /api/reports/cash-position ───────────────────────────────
exports.report = async (req, res, next) => {
  try {
    const { from, to } = parseRange(req.query);
    const { accountCode } = req.query;

    if (accountCode && !/^10\d*$/.test(accountCode)) {
      throw createError(`${accountCode} is not a cash account`, 400);
    }

    const accounts = await resolveCashAccounts(req.businessId, accountCode);
    if (accountCode && accounts.length === 0) {
      throw createError(`${accountCode} is not a postable cash account`, 400);
    }

    const built = await Promise.all(accounts.map(async (acct) => {
      // Opening: everything POSTED strictly before the range starts.
      const before = await prisma.journalLine.aggregate({
        where: {
          accountId: acct.id,
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: { lt: startOf(from) } },
        },
        _sum: { debit: true, credit: true },
      });
      const opening = round2(Number(before._sum.debit || 0) - Number(before._sum.credit || 0));

      // Movement: one bucket per day inside the range.
      //
      // Grouped in JS, not with prisma.journalLine.groupBy: `entryDate` lives on
      // JournalEntry, not JournalLine, and Prisma can only group by a model's
      // own scalar fields. The whole GL is 126 lines (42 of them cash), so the
      // in-memory pass is not a performance concern.
      const lines = await prisma.journalLine.findMany({
        where: {
          accountId: acct.id,
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOf(from), lte: endOf(to) } },
        },
        select: { debit: true, credit: true, entry: { select: { entryDate: true } } },
      });

      const byDay = new Map();
      for (const l of lines) {
        const key = dateKey(l.entry.entryDate);
        const acc = byDay.get(key) || { date: key, in: 0, out: 0 };
        acc.in  = round2(acc.in  + Number(l.debit  || 0));
        acc.out = round2(acc.out + Number(l.credit || 0));
        byDay.set(key, acc);
      }
      const movements = [...byDay.values()];

      return {
        accountCode: acct.accountCode,
        accountName: acct.accountName,
        ...buildCashbook(opening, movements),
      };
    }));

    res.json({ from, to, accounts: built });
  } catch (err) { next(err); }
};

// ─── GET /api/reports/cash-position/day ───────────────────────────
exports.day = async (req, res, next) => {
  try {
    const { date, accountCode } = req.query;
    if (!date || !DATE_RE.test(date)) throw createError('date query param required (YYYY-MM-DD)', 400);
    if (!accountCode)                 throw createError('accountCode query param required', 400);

    const [account] = await resolveCashAccounts(req.businessId, accountCode);
    if (!account) throw createError(`${accountCode} is not a postable cash account`, 400);

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: account.id,
        entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOf(date), lte: endOf(date) } },
      },
      include: { entry: { select: { entryNo: true, reference: true, description: true } } },
      orderBy: { id: 'asc' },
    });

    res.json({
      date,
      accountCode,
      lines: lines.map((l) => ({
        entryNo:     l.entry.entryNo,
        reference:   l.entry.reference || null,
        description: l.description || l.entry.description,
        in:          Number(l.debit  || 0),
        out:         Number(l.credit || 0),
      })),
    });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Create the route file**

Create `server/routes/cashPosition.js`:

```js
const router = require('express').Router();
const ctrl   = require('../controllers/cashPositionController');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

// Static path first so it is not swallowed by a future `/:id`
router.get('/cash-position/day', ctrl.day);
router.get('/cash-position',     ctrl.report);

module.exports = router;
```

- [ ] **Step 5: Register the router**

In `server/routes/index.js`, add after `openingBalances`:

```js
  openingBalances: require('./openingBalances'),
  cashPosition:  require('./cashPosition'),
};
```

In `server/index.js`, add after the `opening-balances` mount (line 144):

```js
app.use('/api/opening-balances', routes.openingBalances);
app.use('/api/reports',          routes.cashPosition);
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `npx jest tests/cashPosition.test.js`
Expected: `Tests: 10 passed`.

- [ ] **Step 7: Verify against live data**

Run:
```bash
node -e "
const ctrl = require('./server/controllers/cashPositionController');
ctrl.report(
  { query: { from: '2026-08-01', to: '2026-08-06', accountCode: '1011' }, businessId: 1 },
  { json: (r) => { console.log(JSON.stringify(r.accounts[0], null, 2)); process.exit(0); } },
  (e) => { console.error(e); process.exit(1); }
);"
```
Expected: `opening: 0`, `closing: -90`, `totalIn: 7830`, `totalOut: 7920`, and two rows (Aug 3 and Aug 5). Aug 4 and Aug 6 must **not** appear.

- [ ] **Step 8: Confirm the whole suite is green**

Run: `npx jest`
Expected: `Tests: 168 passed`.

- [ ] **Step 9: Commit**

```bash
git add server/controllers/cashPositionController.js server/routes/cashPosition.js server/routes/index.js server/index.js tests/cashPosition.test.js
git commit -m "feat(reports): add the cash position endpoints"
```

---

### Task 6: Cash Position page

**Files:**
- Create: `app/(dashboard)/reports/cash-position/page.jsx`
- Modify: `lib/api.js:195` (after the `journal` export's `balanceSheet` line)
- Modify: `components/layout/Sidebar.jsx:124-128` (Reports children)

**Interfaces:**
- Consumes: the two endpoints from Task 5.
- Produces: `reports.cashPosition.report(params)` and `reports.cashPosition.day(params)` in `lib/api.js`.

- [ ] **Step 1: Add the API helpers**

In `lib/api.js`, after the `journal` export block (which ends at `balanceSheet`), add a new export:

```js
export const reports = {
  cashPosition: {
    report: (params) => api.get('/reports/cash-position', { params }),
    day:    (params) => api.get('/reports/cash-position/day', { params }),
  },
};
```

- [ ] **Step 2: Add the nav entry**

In `components/layout/Sidebar.jsx`, add to the Reports `children` array after `Balance Sheet`:

```jsx
          { label: 'Trial Balance',    href: '/reports/trial-balance' },
          { label: 'Income Statement', href: '/reports/income-statement' },
          { label: 'Balance Sheet',    href: '/reports/balance-sheet' },
          { label: 'Cash Position',    href: '/reports/cash-position' },
          { label: 'Custom Reports',   href: '/reports/custom' },
```

- [ ] **Step 3: Create the page**

Create `app/(dashboard)/reports/cash-position/page.jsx`:

```jsx
'use client';
import { useState, useCallback } from 'react';
import { reports } from '@/lib/api';
import toast from 'react-hot-toast';
import { Wallet, RefreshCw, Printer, ChevronRight, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const fmt = (n) => formatCurrency(Number(n || 0));
const signed = (n) => (Number(n) < 0 ? 'text-red-600' : 'text-gray-900');

// One account's cashbook table, with lazily-loaded per-day drill-down.
function AccountCashbook({ account, from, to }) {
  const [openDate, setOpenDate] = useState(null);
  const [detail,   setDetail]   = useState({});   // date → lines[]
  const [loading,  setLoading]  = useState(null);

  const toggle = async (date) => {
    if (openDate === date) { setOpenDate(null); return; }
    setOpenDate(date);
    if (detail[date]) return;
    setLoading(date);
    try {
      const res = await reports.cashPosition.day({ date, accountCode: account.accountCode });
      setDetail((d) => ({ ...d, [date]: res.data.lines }));
    } catch {
      toast.error('Could not load that day');
      setOpenDate(null);
    } finally { setLoading(null); }
  };

  return (
    <div className="card mb-4">
      <div className="card-body">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold text-gray-800">
            <span className="font-mono text-xs text-gray-400 mr-2">{account.accountCode}</span>
            {account.accountName}
          </h3>
          <span className={`text-lg font-bold ${signed(account.closing)}`}>{fmt(account.closing)}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="text-left">Date</th>
                <th className="text-right">Beginning</th>
                <th className="text-right">In</th>
                <th className="text-right">Out</th>
                <th className="text-right">Ending</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-sm text-gray-500 italic">
                <td>Opening balance</td>
                <td colSpan={3}></td>
                <td className={`text-right font-mono ${signed(account.opening)}`}>{fmt(account.opening)}</td>
              </tr>

              {account.rows.length === 0 && (
                <tr><td colSpan={5} className="text-center text-gray-400 py-6">No cash movement in this range</td></tr>
              )}

              {account.rows.map((r) => (
                <>
                  <tr key={r.date} onClick={() => toggle(r.date)} className="hover:bg-gray-50/50 cursor-pointer text-sm">
                    <td className="flex items-center gap-1">
                      {openDate === r.date ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                      {dateFmt(r.date)}
                    </td>
                    <td className={`text-right font-mono ${signed(r.begin)}`}>{fmt(r.begin)}</td>
                    <td className="text-right font-mono text-green-700">{r.in ? fmt(r.in) : <span className="text-gray-200">—</span>}</td>
                    <td className="text-right font-mono text-red-700">{r.out ? fmt(r.out) : <span className="text-gray-200">—</span>}</td>
                    <td className={`text-right font-mono font-medium ${signed(r.ending)}`}>{fmt(r.ending)}</td>
                  </tr>

                  {openDate === r.date && (
                    <tr key={`${r.date}-detail`}>
                      <td colSpan={5} className="bg-gray-50 p-0">
                        {loading === r.date ? (
                          <div className="p-4 text-center text-gray-400 text-sm">Loading…</div>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {(detail[r.date] || []).map((l, i) => (
                                <tr key={i}>
                                  <td className="pl-8 font-mono text-gray-400">{l.entryNo}</td>
                                  <td className="text-gray-600">{l.reference || '—'}</td>
                                  <td className="text-gray-700">{l.description}</td>
                                  <td className="text-right font-mono text-green-700">{l.in ? fmt(l.in) : ''}</td>
                                  <td className="text-right font-mono text-red-700 pr-4">{l.out ? fmt(l.out) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}

              <tr className="font-semibold border-t text-sm">
                <td>Total</td>
                <td></td>
                <td className="text-right font-mono text-green-700">{fmt(account.totalIn)}</td>
                <td className="text-right font-mono text-red-700">{fmt(account.totalOut)}</td>
                <td className={`text-right font-mono ${signed(account.closing)}`}>{fmt(account.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CashPositionPage() {
  const [from, setFrom]   = useState(monthStart());
  const [to,   setTo]     = useState(today());
  const [data, setData]   = useState(null);
  const [busy, setBusy]   = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const res = await reports.cashPosition.report({ from, to });
      setData(res.data);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not generate the report');
    } finally { setBusy(false); }
  }, [from, to]);

  const print = () => {
    if (!data) return;
    const body = data.accounts.map((a) => `
      <h3>${a.accountCode} — ${a.accountName}</h3>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">
        <tr><th>Date</th><th>Beginning</th><th>In</th><th>Out</th><th>Ending</th></tr>
        <tr><td colspan="4">Opening balance</td><td align="right">${phpFmt(a.opening)}</td></tr>
        ${a.rows.map((r) => `<tr>
          <td>${dateFmt(r.date)}</td>
          <td align="right">${phpFmt(r.begin)}</td>
          <td align="right">${phpFmt(r.in)}</td>
          <td align="right">${phpFmt(r.out)}</td>
          <td align="right">${phpFmt(r.ending)}</td>
        </tr>`).join('')}
        <tr><td><b>Total</b></td><td></td>
          <td align="right"><b>${phpFmt(a.totalIn)}</b></td>
          <td align="right"><b>${phpFmt(a.totalOut)}</b></td>
          <td align="right"><b>${phpFmt(a.closing)}</b></td></tr>
      </table>`).join('');
    printDocument('Cash Position Report', `${dateFmt(data.from)} — ${dateFmt(data.to)}`, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Position</h1>
          <p className="page-subtitle">Running balance per day for every cash account</p>
        </div>
        {data && (
          <button className="btn-secondary" onClick={print}>
            <Printer className="w-4 h-4" /> Print
          </button>
        )}
      </div>

      <div className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {!data && (
        <div className="card">
          <div className="p-16 text-center">
            <Wallet className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Pick a date range and click <strong>Generate</strong>.</p>
          </div>
        </div>
      )}

      {data?.accounts.length === 0 && (
        <div className="card"><div className="p-16 text-center text-gray-500">No cash accounts found.</div></div>
      )}

      {data?.accounts.map((a) => (
        <AccountCashbook key={a.accountCode} account={a} from={data.from} to={data.to} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verify in the running app**

Start the dev server and open `http://localhost:3000/reports/cash-position`.

- Set From `2026-08-01`, To `2026-08-06`, click **Generate**.
- Expected: a table per cash account. `1011 Petty Cash Fund` opens at `₱0.00`, shows rows for Aug 3 and Aug 5 only, and closes at **`-₱90.00`** in red. `1010 Cash on Hand` closes at `₱45,076.00`.
- Click the Aug 5 row on 1011. Expected: it expands to show the ₱7,830 replenishment plus the eight voucher payments.
- Click **Print**. Expected: a letterheaded A4 window with the same figures.

- [ ] **Step 5: Confirm the suite is green**

Run: `npx jest`
Expected: `Tests: 168 passed`.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/reports/cash-position/page.jsx" lib/api.js components/layout/Sidebar.jsx
git commit -m "feat(reports): add the Cash Position page"
```

---

### Task 7: Cross-report agreement test

The invariant that keeps the two reports honest. Both read the same GL, so a divergence is a bug — this is what catches it.

**Files:**
- Create: `tests/cashReportAgreement.test.js`

**Interfaces:**
- Consumes: `buildCashbook` from `server/utils/cashbook.js` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Write the test**

Create `tests/cashReportAgreement.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice:              { findMany: jest.fn() },
  paymentAR:            { findMany: jest.fn() },
  bill:                 { findMany: jest.fn() },
  paymentAP:            { findMany: jest.fn() },
  inventoryTransaction: { findMany: jest.fn() },
  expenseVoucher:       { findMany: jest.fn() },
  journalLine:          { aggregate: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const daily  = require('../server/controllers/dailyRemittanceController');
const { buildCashbook, round2 } = require('../server/utils/cashbook');

// One shared GL fixture for account 1011, keyed by date. BOTH reports are
// driven from this — that is what makes the comparison meaningful rather than
// a literal checked against another literal.
const GL_1011 = {
  '2026-08-03': { in: 0,    out: 30 },
  '2026-08-04': { in: 0,    out: 0 },
  '2026-08-05': { in: 7830, out: 7890 },
  '2026-08-06': { in: 0,    out: 0 },
};

// Run the real daily remittance controller for one date against the fixture.
const runDaily = (date) => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  const day = GL_1011[date];
  prisma.journalLine.aggregate
    .mockResolvedValueOnce({ _sum: { debit: day.in, credit: day.out } })  // 1011
    .mockResolvedValueOnce({ _sum: { debit: 0,      credit: 0 } })        // 1012
    .mockResolvedValueOnce({ _sum: { debit: 0,      credit: 0 } });       // 1010
  return new Promise((resolve, reject) => {
    daily.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
  });
};

// The same fixture, in the shape the Cash Position report consumes.
const cashbook = buildCashbook(0, Object.entries(GL_1011)
  .filter(([, m]) => m.in || m.out)
  .map(([date, m]) => ({ date, ...m })));
const byDate = Object.fromEntries(cashbook.rows.map((r) => [r.date, r]));

describe('the two cash reports agree', () => {
  test.each(Object.keys(GL_1011))(
    'the daily report and the cashbook report the same outflow for %s',
    async (date) => {
      const r = await runDaily(date);
      expect(r.pettyCashOut).toBe(byDate[date]?.out ?? 0);
    },
  );

  test('the daily figures sum to the cashbook total', async () => {
    let summed = 0;
    for (const date of Object.keys(GL_1011)) {
      summed = round2(summed + (await runDaily(date)).pettyCashOut);
    }
    expect(summed).toBe(cashbook.totalOut);
  });

  test('opening plus net movement equals closing', () => {
    const net = Object.values(GL_1011).reduce((s, m) => s + m.in - m.out, 0);
    expect(cashbook.closing).toBe(round2(cashbook.opening + net));
  });

  test('a day the daily report calls zero produces no cashbook row', async () => {
    expect((await runDaily('2026-08-04')).pettyCashOut).toBe(0);
    expect(byDate['2026-08-04']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/cashReportAgreement.test.js`
Expected: `Tests: 7 passed`. It should pass immediately — everything it asserts was built in Tasks 2-5. A failure here means those tasks diverged.

- [ ] **Step 3: Run the whole suite**

Run: `npx jest`
Expected: `Tests: 175 passed`, 21 suites, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add tests/cashReportAgreement.test.js
git commit -m "test(reports): assert the daily and cash position reports agree"
```

---

## Verification checklist

Run before calling the feature done:

- [ ] `npx jest` — all suites green
- [ ] `/remittance/daily` on **2026-08-06** shows **₱0.00** on both cash cards
- [ ] `/remittance/daily` on **2026-08-05** shows `₱7,830.00` cash out and `₱7,890.00` spent / 8 vouchers
- [ ] Saving a daily report, reloading, and reselecting the date shows the same figures — not blanks
- [ ] `/reports/cash-position` for Aug 1-6 closes 1011 at **-₱90.00** and 1010 at **₱45,076.00**
- [ ] No row appears for Aug 4 or Aug 6 in the cashbook
- [ ] `1000 Current Assets` does **not** appear as an account in the report
- [ ] Expanding the Aug 5 row on 1011 lists the replenishment plus eight voucher payments
- [ ] Print works on both reports
