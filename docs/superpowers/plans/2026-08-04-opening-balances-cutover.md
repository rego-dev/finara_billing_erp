# Opening Balances & Books Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business enter historical documents without corrupting current revenue, Output VAT and cash, then establish a correct day-one balance sheet and prove it reconciles.

**Architecture:** A nullable `Business.booksStartDate` drives a guard inside `glPost.post()` — the single choke point all 15 `safePost` call sites share — which skips writing a journal entry for any document dated before cutover. Day-one balances are then established by one deliberate entry offset to a new `3070 Opening Balance Equity` account, which bypasses that guard via an explicit flag.

**Tech Stack:** Next.js 14 (App Router) · Express · MySQL 8 · Prisma 5 · jest · Tailwind · lucide-react · react-hot-toast

Source spec: `docs/superpowers/specs/2026-08-04-opening-balances-cutover-design.md`

## Global Constraints

- **PowerShell, not bash.** Heredocs (`<<'EOF'`) and `$(date)` are parse errors. For multi-line commit messages write a temp file and use `git commit -F <file>`.
- **`npx prisma migrate dev` FAILS here** — it is interactive. Use `migrate diff` → write `migration.sql` → `migrate deploy` (Task 1).
- **Stop the dev server before `prisma generate` or any migration** — Windows locks the Prisma engine DLL and the command fails with `EPERM`.
- **Never run `next build` while `npm run dev` is running** — both write to `.next/` and the dev server then 404s on `main-app.js`.
- **Run tests with `npx jest`.** No babel transform is configured, so only CommonJS under `server/` and `tests/` is testable; `lib/` is ESM and cannot be unit-tested.
- **Mock Prisma the way `tests/leadsExport.test.js:1` does** — `jest.mock('../server/config/database', () => ({ ... }))`.
- **Date comparison must be date-only and timezone-safe.** `booksStartDate` is `@db.Date` and comes back as a Date at UTC midnight; `entryDate` arrives as either a `'YYYY-MM-DD'` string or a `Date`. Compare normalised `YYYY-MM-DD` strings, never raw Date objects.
- **An entry dated exactly ON the cutover date MUST post.** The cutover is the first day the books are live.
- **`booksStartDate` is nullable and null means "no cutover configured"** — the guard stays inert so existing installs behave exactly as today.
- The dev server normally runs on ports 3000 (web) and 5000 (api).

---

# Phase 1 — Cutover guard

Independently shippable. Stops pre-cutover documents polluting revenue, VAT and cash.

---

### Task 1: `booksStartDate` schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_books_start_date/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `Business.booksStartDate DateTime? @db.Date`. Tasks 2, 3 and 8 read it.

- [ ] **Step 1: Stop any running dev server**

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3000,5000 -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
```

Expected: no output, ports 3000/5000 free.

- [ ] **Step 2: Add the field**

In `prisma/schema.prisma`, in `model Business`, add after the `industry` line:

```prisma
  booksStartDate DateTime? @db.Date
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `npx prisma generate`
Expected: `✔ Generated Prisma Client`. An `EPERM` failure means the dev server is still running — repeat Step 1.

- [ ] **Step 4: Generate the migration SQL**

**Do not use `Out-File -Encoding utf8`** — PowerShell 5.1 writes a UTF-8 BOM and
MySQL rejects the file with `error 1064 ... near '﻿-- AlterTable'`. Write the
file with .NET instead, which emits no BOM:

```powershell
$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$dir = "prisma/migrations/${stamp}_add_books_start_date"
New-Item -ItemType Directory -Force $dir | Out-Null
$sql = npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script | Out-String
[System.IO.File]::WriteAllText("$PWD/$dir/migration.sql", $sql, (New-Object System.Text.UTF8Encoding($false)))
Get-Content "$dir/migration.sql"
```

Verify no BOM before deploying:

```powershell
$b = [System.IO.File]::ReadAllBytes("$PWD/$dir/migration.sql")
if ($b[0] -eq 0xEF) { "BOM PRESENT — rewrite the file" } else { "no BOM" }
```

If a migration does fail this way, Prisma records it and blocks further deploys
with `P3009`. Confirm the change did not partially apply, then
`npx prisma migrate resolve --rolled-back <migration_name>` and deploy again.

Expected: `ALTER TABLE \`businesses\` ADD COLUMN \`booksStartDate\` DATE NULL;`
If the SQL contains DROP statements for unrelated tables, STOP — the local DB has drifted; resolve that first.

- [ ] **Step 5: Apply it**

Run: `npx prisma migrate deploy`
Expected: `The following migration(s) have been applied` listing `_add_books_start_date`.

- [ ] **Step 6: Verify the column exists**

Write to the scratchpad as `check-col.js` and run it:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();
p.business.findMany({ select: { id: true, name: true, booksStartDate: true } })
  .then((r) => { r.forEach((b) => console.log(b.id, b.name, '| booksStartDate:', b.booksStartDate)); console.log('column OK'); })
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
```

Expected: all three businesses listed with `booksStartDate: null`, then `column OK`.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cutover): add Business.booksStartDate"
```

---

### Task 2: The cutover guard in `glPost`

**Files:**
- Modify: `server/utils/glPost.js`
- Test: `tests/glCutover.test.js`

**Interfaces:**
- Consumes: `Business.booksStartDate` from Task 1.
- Produces:
  - `post()` accepts `isOpeningEntry = false` and returns `{ skipped: 'PRE_CUTOVER', entryDate, businessId }` instead of writing when the guard fires.
  - `clearBusinessCache(businessId?)` — clears one business, or all when called with no argument. Task 3 calls it.
  - `dateKey(d) -> 'YYYY-MM-DD'` exported for testing.

- [ ] **Step 1: Write the failing test**

Create `tests/glCutover.test.js`:

```js
jest.mock('../server/config/database', () => ({
  business:      { findUnique: jest.fn() },
  account:       { findFirst:  jest.fn() },
  journalEntry:  { findFirst:  jest.fn(), create: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { post, clearBusinessCache, dateKey } = require('../server/utils/glPost');

const LINES = [
  { accountId: 1, debit: 100, description: 'dr' },
  { accountId: 2, credit: 100, description: 'cr' },
];

beforeEach(() => {
  jest.clearAllMocks();
  clearBusinessCache();
  prisma.journalEntry.findFirst.mockResolvedValue(null);
  prisma.journalEntry.create.mockResolvedValue({ id: 99, entryNo: 'JE-1-000001', lines: [] });
});

describe('dateKey', () => {
  test('normalises a YYYY-MM-DD string', () => {
    expect(dateKey('2026-08-01')).toBe('2026-08-01');
  });

  test('normalises an ISO datetime string to its date part', () => {
    expect(dateKey('2026-08-01T15:30:00.000Z')).toBe('2026-08-01');
  });

  test('normalises a Date using UTC parts', () => {
    expect(dateKey(new Date('2026-08-01T00:00:00.000Z'))).toBe('2026-08-01');
  });
});

describe('cutover guard', () => {
  test('skips an entry dated before the cutover', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    const result = await post({
      entryDate: '2026-05-14', description: 'Historical invoice',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(result).toEqual({ skipped: 'PRE_CUTOVER', entryDate: '2026-05-14', businessId: 2 });
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  test('POSTS an entry dated exactly ON the cutover date', async () => {
    // The cutover is the first live day — an off-by-one here silently drops a real day.
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-08-01', description: 'First live entry',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('posts an entry dated after the cutover', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-09-20', description: 'Normal entry',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('is inert when the business has no cutover configured', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });

    await post({
      entryDate: '1999-01-01', description: 'Ancient but allowed',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('accepts a Date object for entryDate', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    const result = await post({
      entryDate: new Date('2026-05-14T00:00:00.000Z'), description: 'Historical',
      lines: LINES, businessId: 2, userId: 1,
    });

    expect(result.skipped).toBe('PRE_CUTOVER');
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  test('isOpeningEntry bypasses the guard', async () => {
    // The opening entry is dated ON/BEFORE the cutover by definition. Without
    // this bypass it would skip itself and leave an empty balance sheet.
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({
      entryDate: '2026-07-31', description: 'Opening balances',
      lines: LINES, businessId: 2, userId: 1, isOpeningEntry: true,
    });

    expect(prisma.journalEntry.create).toHaveBeenCalled();
  });

  test('caches the cutover date — one lookup for repeated posts', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-08-01T00:00:00.000Z') });

    await post({ entryDate: '2026-09-01', description: 'a', lines: LINES, businessId: 2 });
    await post({ entryDate: '2026-09-02', description: 'b', lines: LINES, businessId: 2 });

    expect(prisma.business.findUnique).toHaveBeenCalledTimes(1);
  });

  test('clearBusinessCache forces a fresh lookup', async () => {
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
    await post({ entryDate: '2026-09-01', description: 'a', lines: LINES, businessId: 2 });

    clearBusinessCache(2);
    prisma.business.findUnique.mockResolvedValue({ booksStartDate: new Date('2026-10-01T00:00:00.000Z') });
    const result = await post({ entryDate: '2026-09-05', description: 'b', lines: LINES, businessId: 2 });

    expect(prisma.business.findUnique).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe('PRE_CUTOVER');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/glCutover.test.js`
Expected: FAIL — `clearBusinessCache is not a function`.

- [ ] **Step 3: Add the date helper and business cache**

In `server/utils/glPost.js`, immediately after the existing `const _cache = {};` line, add:

```js
// ── Business cutover cache — key: businessId ─────────────────────────────────
const _bizCache = {};

/**
 * Normalise any accepted date form to a 'YYYY-MM-DD' key.
 *
 * booksStartDate is @db.Date and comes back as a Date at UTC midnight, while
 * entryDate arrives as either 'YYYY-MM-DD' or a Date. Comparing normalised
 * strings sidesteps every timezone trap that comparing Date objects invites.
 */
function dateKey(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const dt = d instanceof Date ? d : new Date(d);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

async function getBusinessCutover(businessId) {
  if (Object.prototype.hasOwnProperty.call(_bizCache, businessId)) return _bizCache[businessId];
  const biz = await prisma.business.findUnique({
    where:  { id: Number(businessId) },
    select: { booksStartDate: true },
  });
  _bizCache[businessId] = biz?.booksStartDate || null;
  return _bizCache[businessId];
}

// Call whenever a business's booksStartDate changes, or posting keeps
// honouring the stale date until the process restarts.
function clearBusinessCache(businessId) {
  if (businessId == null) {
    for (const k of Object.keys(_bizCache)) delete _bizCache[k];
  } else {
    delete _bizCache[businessId];
    delete _bizCache[Number(businessId)];
  }
}
```

- [ ] **Step 4: Add the guard to `post()`**

In `server/utils/glPost.js`, change the `post` signature and add the guard as its first action. Replace:

```js
async function post({ entryDate, description, reference, notes, lines, userId = 1, businessId = 1 }) {
  const resolved = await Promise.all(
```

with:

```js
async function post({ entryDate, description, reference, notes, lines, userId = 1, businessId = 1, isOpeningEntry = false }) {
  // Anything dated before the books start is already inside the opening
  // balances — posting it again double-counts revenue, VAT and cash.
  // The opening entry itself is dated on/before the cutover, so it must
  // be able to bypass this or it would skip itself.
  if (!isOpeningEntry) {
    const cutover = await getBusinessCutover(businessId);
    const cutoverKey = dateKey(cutover);
    const entryKey   = dateKey(entryDate);
    if (cutoverKey && entryKey && entryKey < cutoverKey) {
      logger.info(`[GL SKIP PRE-CUTOVER] biz=${businessId} entry=${entryKey} cutover=${cutoverKey} ref=${reference || '—'}`);
      return { skipped: 'PRE_CUTOVER', entryDate, businessId };
    }
  }

  const resolved = await Promise.all(
```

- [ ] **Step 5: Export the new functions**

Change the last line of `server/utils/glPost.js` from:

```js
module.exports = { post, safePost, getAccountByCode };
```

to:

```js
module.exports = { post, safePost, getAccountByCode, clearBusinessCache, dateKey };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/glCutover.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 7: Run the whole suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 8: Confirm existing callers tolerate the skip marker**

Only one call site uses the return value: `server/controllers/assetController.js:183` reads `je?.id || null`, which yields `null` for a skip marker — already safe. Verify no other call site dereferences it:

```powershell
Select-String -Path "server/controllers/*.js" -Pattern "=\s*await glPost\.(safePost|post)"
```

Expected: exactly one hit, `assetController.js`. If more appear, each must handle a return without `.id`.

- [ ] **Step 9: Commit**

```bash
git add server/utils/glPost.js tests/glCutover.test.js
git commit -m "feat(cutover): skip GL posting for pre-cutover entries"
```

---

### Task 3: Books start date in business settings

**Files:**
- Modify: `server/controllers/businessController.js`
- Modify: `app/(dashboard)/settings/businesses/page.jsx`
- Modify: `lib/api.js`

**Interfaces:**
- Consumes: `clearBusinessCache` from Task 2.
- Produces: `booksStartDate` accepted on business create and update; cache cleared on change.

- [ ] **Step 1: Add the import**

At the top of `server/controllers/businessController.js`, alongside the existing requires:

```js
const { clearBusinessCache } = require('../utils/glPost');
```

- [ ] **Step 2: Accept the field on create**

In `server/controllers/businessController.js`, find the create handler's destructure (around line 36):

```js
    const { code, name, tin, address, phone, email, industry } = req.body;
```

Replace with:

```js
    const { code, name, tin, address, phone, email, industry, booksStartDate } = req.body;
```

Then find the create data (around line 40):

```js
      data: { code: code.toUpperCase(), name, tin, address, phone, email, industry },
```

Replace with:

```js
      data: {
        code: code.toUpperCase(), name, tin, address, phone, email, industry,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      },
```

- [ ] **Step 3: Accept the field on update and clear the cache**

In `server/controllers/businessController.js`, find the update handler's destructure (around line 102):

```js
    const { name, tin, address, phone, email, industry, isActive } = req.body;
```

Replace with:

```js
    const { name, tin, address, phone, email, industry, isActive, booksStartDate } = req.body;
```

Then find the update data (around line 105):

```js
      data: { name, tin, address, phone, email, industry, isActive },
```

Replace with:

```js
      data: {
        name, tin, address, phone, email, industry, isActive,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
      },
```

Immediately after the `prisma.business.update(...)` call completes and before the response is sent, add:

```js
    // Posting caches the cutover date — without this it honours the old one
    // until the process restarts.
    clearBusinessCache(Number(req.params.id));
```

- [ ] **Step 4: Surface the field in the UI**

In `app/(dashboard)/settings/businesses/page.jsx:35`, replace the form state initialiser:

```jsx
  const [form,       setForm]       = useState({ code:'', name:'', tin:'', address:'', phone:'', email:'' });
```

with:

```jsx
  const [form,       setForm]       = useState({ code:'', name:'', tin:'', address:'', phone:'', email:'', booksStartDate:'' });
```

Then render this input in the same grid as the other business fields:

```jsx
              <div className="form-group">
                <label className="label">Books Start Date</label>
                <input
                  type="date"
                  className="input"
                  value={form.booksStartDate || ''}
                  onChange={(e) => setForm((f) => ({ ...f, booksStartDate: e.target.value }))}
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  The first day this business keeps its books in Finara. Documents dated
                  before this are recorded for history only and never post to the general
                  ledger — leave blank if you have no cutover.
                </p>
              </div>
```

When loading an existing business into the form, map the value with
`business.booksStartDate?.split('T')[0] || ''` so the date input accepts it.

- [ ] **Step 5: Verify the round trip**

Start the dev server, open Settings → Businesses, set BEULAH I.T's books start date to `2026-08-01`, save, then confirm it persisted:

```powershell
node "<scratchpad>/check-col.js"
```

Expected: BEULAH I.T shows `booksStartDate: 2026-08-01T00:00:00.000Z`.

- [ ] **Step 6: Verify the guard actually fires end-to-end**

With the cutover set to `2026-08-01`, create an AR invoice dated `2026-05-14` through the UI, then confirm no journal entry was written for it. Write to the scratchpad as `check-skip.js` and run:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();
(async () => {
  const inv = await p.invoice.findFirst({ orderBy: { id: 'desc' }, select: { id: true, invoiceNo: true, invoiceDate: true, businessId: true } });
  console.log('latest invoice:', inv.invoiceNo, dateOnly(inv.invoiceDate));
  const je = await p.journalEntry.findFirst({ where: { reference: inv.invoiceNo, businessId: inv.businessId } });
  console.log(je ? `POSTED ${je.entryNo} — guard did NOT fire` : 'no journal entry — guard fired correctly');
  function dateOnly(d) { return new Date(d).toISOString().slice(0, 10); }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
```

Expected: `no journal entry — guard fired correctly`.

Then create a second invoice dated today and confirm the same script reports `POSTED`.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/businessController.js "app/(dashboard)/settings/businesses/page.jsx" lib/api.js
git commit -m "feat(cutover): configure books start date per business"
```

---

### Task 4: "Opening entry" badge on pre-cutover documents

Without this, an encoder sees a document with no journal entry and cannot tell
whether the cutover suppressed it deliberately or a post failed.

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx` (note: the directory is **singular**)
- Modify: `lib/businessContext.js`

**Interfaces:**
- Consumes: `useBusiness()` from `lib/businessContext.js`, which returns
  `{ businesses, activeBusiness, activeBusinessId, setActive, loading }`
  (`lib/businessContext.js:69`). `activeBusiness` is the full business record, so
  `activeBusiness?.booksStartDate` is available once Task 1 adds the column.
- Produces: `isPreCutover(docDate, booksStartDate) -> boolean` exported from `lib/businessContext.js`.

- [ ] **Step 1: Add the helper**

In `lib/businessContext.js`, add and export:

```js
// Mirrors the server-side guard in server/utils/glPost.js — compare
// 'YYYY-MM-DD' strings, never Date objects, so timezones cannot shift the day.
export function isPreCutover(docDate, booksStartDate) {
  if (!docDate || !booksStartDate) return false;
  return String(docDate).slice(0, 10) < String(booksStartDate).slice(0, 10);
}
```

- [ ] **Step 2: Render the badge**

In `app/(dashboard)/receivable/page.jsx`, add the imports:

```jsx
import { useBusiness, isPreCutover } from '@/lib/businessContext';
```

Inside the page component, read the active business:

```jsx
  const { activeBusiness } = useBusiness();
  const booksStartDate = activeBusiness?.booksStartDate || null;
```

Then render beside the invoice number in the table row:

```jsx
{isPreCutover(inv.invoiceDate, booksStartDate) && (
  <span className="badge badge-gray ml-2" title="Dated before this business's books start date — recorded for history only, not posted to the general ledger">
    Opening entry
  </span>
)}
```

- [ ] **Step 3: Verify**

With BEULAH I.T's cutover at `2026-08-01`, the May invoice from Task 3 shows the
grey **Opening entry** badge; the invoice dated today does not.

- [ ] **Step 4: Commit**

```bash
git add lib/businessContext.js "app/(dashboard)/receivables/page.jsx"
git commit -m "feat(cutover): badge pre-cutover documents as opening entries"
```

**Phase 1 is complete and shippable here.** Historical documents no longer touch
revenue, VAT or cash, and the suppression is visible.

---

# Phase 2 — Opening balances

---

### Task 5: `3070 Opening Balance Equity` account

**Files:**
- Modify: `prisma/seed.js`

**Interfaces:**
- Produces: account code `3070` in every business's COA. Tasks 6 and 8 post to and read it.

- [ ] **Step 1: Add it to the seed**

In `prisma/seed.js`, immediately after the `3060 Treasury Stock` line (around line 152):

```js
    { accountCode:'3070', accountName:'Opening Balance Equity',              accountType:'EQUITY',    normalBalance:'CREDIT', parentCode:'3000' },
```

- [ ] **Step 2: Backfill the three existing businesses**

The seed only covers new businesses. Write to the scratchpad as `add-3070.js` and run it:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();

(async () => {
  const businesses = await p.business.findMany({ select: { id: true, name: true } });
  for (const b of businesses) {
    const exists = await p.account.findFirst({ where: { accountCode: '3070', businessId: b.id } });
    if (exists) { console.log(`biz${b.id} ${b.name}: 3070 already present`); continue; }
    const parent = await p.account.findFirst({ where: { accountCode: '3000', businessId: b.id }, select: { id: true } });
    await p.account.create({
      data: {
        businessId: b.id, accountCode: '3070', accountName: 'Opening Balance Equity',
        accountType: 'EQUITY', normalBalance: 'CREDIT', parentId: parent?.id || null,
      },
    });
    console.log(`biz${b.id} ${b.name}: created 3070`);
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); }).finally(() => p.$disconnect());
```

Expected: `created 3070` for each of the three businesses.

If `parentId` is not the field name used for the COA hierarchy, check `model Account` in `prisma/schema.prisma` and use the actual field; `parentCode` in the seed is resolved to an id during seeding.

- [ ] **Step 3: Verify it resolves for every business**

```powershell
node "<scratchpad>/verify-3070.js"
```

using:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();
p.account.findMany({ where: { accountCode: '3070' }, select: { businessId: true, accountName: true } })
  .then((r) => { r.forEach((a) => console.log('biz' + a.businessId, a.accountName)); console.log(r.length === 3 ? 'OK — present in all 3' : 'MISSING in some businesses'); })
  .catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
```

Expected: three rows, then `OK — present in all 3`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.js
git commit -m "feat(cutover): add 3070 Opening Balance Equity to the chart of accounts"
```

---

### Task 6: Opening balance endpoint

**Files:**
- Create: `server/controllers/openingBalanceController.js`
- Create: `server/routes/openingBalances.js`
- Modify: `server/routes/index.js`
- Modify: `server/index.js`
- Modify: `lib/api.js`

**Interfaces:**
- Consumes: `post` with `isOpeningEntry` from Task 2; account `3070` from Task 5.
- Produces:
  - `GET /api/opening-balances` → `{ booksStartDate, entry }` where `entry` is the existing opening journal entry or `null`.
  - `POST /api/opening-balances` with `{ lines: [{ accountCode, debit, credit }] }` → the created journal entry.
  - Task 7 consumes both.

- [ ] **Step 1: Write the controller**

Create `server/controllers/openingBalanceController.js`:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const glPost = require('../utils/glPost');

const OPENING_EQUITY = '3070';
const OPENING_REFERENCE = 'OPENING-BALANCE';

exports.get = async (req, res, next) => {
  try {
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    const entry = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: OPENING_REFERENCE },
      include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });
    res.json({ booksStartDate: biz?.booksStartDate || null, entry });
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { lines } = req.body;

    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    if (!biz?.booksStartDate) {
      throw createError('Set this business\'s books start date before entering opening balances', 400);
    }

    const existing = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: OPENING_REFERENCE },
      select: { id: true, entryNo: true },
    });
    if (existing) {
      throw createError(`Opening balances already posted as ${existing.entryNo}. Reverse that entry before posting again.`, 400);
    }

    const rows = (lines || [])
      .filter((l) => l.accountCode && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({
        accountCode: String(l.accountCode),
        debit:  Number(l.debit  || 0),
        credit: Number(l.credit || 0),
        description: 'Opening balance',
      }));
    if (!rows.length) throw createError('Enter at least one opening balance line', 400);

    // Balance the entry against Opening Balance Equity so the user only has to
    // enter the real-world figures they can actually verify.
    const totalDebit  = rows.reduce((s, l) => s + l.debit,  0);
    const totalCredit = rows.reduce((s, l) => s + l.credit, 0);
    const diff = Number((totalDebit - totalCredit).toFixed(2));
    if (diff > 0)      rows.push({ accountCode: OPENING_EQUITY, credit: diff,  description: 'Opening balance equity' });
    else if (diff < 0) rows.push({ accountCode: OPENING_EQUITY, debit: -diff, description: 'Opening balance equity' });

    // isOpeningEntry bypasses the cutover guard — this entry is dated ON the
    // cutover date and would otherwise skip itself, leaving an empty balance sheet.
    const entry = await glPost.post({
      entryDate:   biz.booksStartDate,
      description: 'Opening balances',
      reference:   OPENING_REFERENCE,
      lines:       rows,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
      isOpeningEntry: true,
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'JournalEntry', entityId: entry.id,
      summary: `Posted opening balances ${entry.entryNo}`,
    });

    res.status(201).json(entry);
  } catch (err) { next(err); }
};
```

- [ ] **Step 2: Write the route file**

Create `server/routes/openingBalances.js`:

```js
const router = require('express').Router();
const ctrl = require('../controllers/openingBalanceController');
const { authenticate, authorize, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/',  ctrl.get);
router.post('/', authorize('ADMIN', 'MANAGER'), ctrl.create);

module.exports = router;
```

- [ ] **Step 3: Register it**

In `server/routes/index.js`, add to the exported object:

```js
  openingBalances: require('./openingBalances'),
```

In `server/index.js`, next to the other mounts:

```js
app.use('/api/opening-balances', routes.openingBalances);
```

- [ ] **Step 4: Add the API client**

In `lib/api.js`, after the `cashRequests` export:

```js
export const openingBalances = {
  get:    ()      => api.get('/opening-balances'),
  create: (data)  => api.post('/opening-balances', data),
};
```

- [ ] **Step 5: Verify modules load and the route is mounted**

```powershell
node -e "require('./server/controllers/openingBalanceController'); require('./server/routes/openingBalances'); console.log('modules load OK');"
try { Invoke-WebRequest -Uri "http://localhost:5000/api/opening-balances" -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { "opening-balances: $([int]$_.Exception.Response.StatusCode)" }
```

Expected: `modules load OK` and `opening-balances: 401`.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/openingBalanceController.js server/routes/openingBalances.js server/routes/index.js server/index.js lib/api.js
git commit -m "feat(cutover): add opening balance endpoint offset to 3070"
```

---

### Task 7: Opening Balances screen

**Files:**
- Create: `app/(dashboard)/settings/opening-balances/page.jsx`
- Modify: `components/layout/Sidebar.jsx`

**Interfaces:**
- Consumes: `openingBalances` from Task 6; `AccountSelect` from `components/ui/AccountSelect`; `NumberInput` from `components/NumberInput`; `formatCurrency` from `lib/auth`.
- Produces: route `/settings/opening-balances`.

- [ ] **Step 1: Create the page**

Create `app/(dashboard)/settings/opening-balances/page.jsx`:

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { openingBalances as obApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, X, Scale } from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

const emptyRow = () => ({ accountId: '', debit: '', credit: '' });

export default function OpeningBalancesPage() {
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows]         = useState([emptyRow()]);
  const [state, setState]       = useState({ booksStartDate: null, entry: null });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ob, acc] = await Promise.all([obApi.get(), acctApi.list({ limit: 500 })]);
      setState(ob.data);
      setAccounts(acc.data.data || acc.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load opening balances');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setRow = (i, k, v) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((p) => [...p, emptyRow()]);
  const rmRow  = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  const totalDebit  = rows.reduce((s, r) => s + (Number(r.debit)  || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const equity      = Number((totalDebit - totalCredit).toFixed(2));

  const codeOf = (id) => accounts.find((a) => a.id === Number(id))?.accountCode;

  const submit = async () => {
    const lines = rows
      .filter((r) => r.accountId && (Number(r.debit) > 0 || Number(r.credit) > 0))
      .map((r) => ({ accountCode: codeOf(r.accountId), debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
    if (!lines.length) { toast.error('Enter at least one opening balance line'); return; }

    setSaving(true);
    try {
      await obApi.create({ lines });
      toast.success('Opening balances posted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post opening balances');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="card card-body text-center py-16 text-gray-400">Loading…</div>;

  if (!state.booksStartDate) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-subtitle">Your day-one position when the books went live</p>
          </div>
        </div>
        <div className="card card-body">
          <p className="text-sm text-gray-600">
            Set this business&apos;s <strong>Books Start Date</strong> in Settings → Businesses first.
            Opening balances are posted on that date.
          </p>
        </div>
      </div>
    );
  }

  if (state.entry) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-subtitle">Posted as {state.entry.entryNo} on {formatDate(state.entry.entryDate)}</p>
          </div>
        </div>
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr>
              </thead>
              <tbody>
                {state.entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td><span className="font-mono text-xs text-gray-500 mr-2">{l.account.accountCode}</span>{l.account.accountName}</td>
                    <td className="text-right">{Number(l.debit)  > 0 ? formatCurrency(l.debit)  : '—'}</td>
                    <td className="text-right">{Number(l.credit) > 0 ? formatCurrency(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Opening balances are posted once. To correct them, reverse {state.entry.entryNo} in the General Ledger first.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Opening Balances</h1>
          <p className="page-subtitle">
            Your position on {formatDate(state.booksStartDate)} — enter only what was still open
          </p>
        </div>
        <button onClick={submit} disabled={saving} className="btn-primary">
          <Scale className="w-4 h-4" /> {saving ? 'Posting…' : 'Post Opening Balances'}
        </button>
      </div>

      <div className="card card-body mb-4 text-sm text-gray-600">
        Enter receivables customers <strong>still owe</strong> you, payables you <strong>still owe</strong>,
        and your actual cash and bank balances on that date. Invoices already settled before the cutover
        belong to the old books — leave them out. The difference is balanced automatically against
        <span className="font-mono"> 3070 Opening Balance Equity</span>.
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="w-44 text-right">Debit (₱)</th>
                <th className="w-44 text-right">Credit (₱)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <AccountSelect value={r.accountId} onChange={(v) => setRow(i, 'accountId', v)}
                      accounts={accounts} placeholder="— select account —" />
                  </td>
                  <td><NumberInput className="input text-right" placeholder="0.00" value={r.debit}
                    onChange={(v) => setRow(i, 'debit', v)} /></td>
                  <td><NumberInput className="input text-right" placeholder="0.00" value={r.credit}
                    onChange={(v) => setRow(i, 'credit', v)} /></td>
                  <td>
                    {rows.length > 1 && (
                      <button onClick={() => rmRow(i)} className="p-1 text-gray-300 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body flex items-center justify-between">
          <button onClick={addRow} className="btn-secondary btn-sm"><Plus className="w-3 h-3" /> Add Line</button>
          <div className="w-96 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Total Debit</span><span>{formatCurrency(totalDebit)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Total Credit</span><span>{formatCurrency(totalCredit)}</span></div>
            <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
              <span>3070 Opening Balance Equity</span>
              <span>{equity >= 0 ? formatCurrency(equity) + ' CR' : formatCurrency(-equity) + ' DR'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the navigation entry**

In `components/layout/Sidebar.jsx`, add `Scale` to the `lucide-react` import list and add this entry next to the other Settings links:

```jsx
      { label: 'Opening Balances', icon: Scale, href: '/settings/opening-balances' },
```

- [ ] **Step 3: Verify the full flow**

With BEULAH I.T's books start date at `2026-08-01`, open the page and enter:

| Account | Debit | Credit |
|---|---|---|
| 1100 Accounts Receivable | 500000 | |
| 1010 Cash on Hand | 25000 | |
| 1020 Cash in Bank | 310000 | |
| 2010 Accounts Payable — Trade | | 180000 |

The footer must show **3070 Opening Balance Equity ₱655,000.00 CR**. Post it, then verify:

```powershell
node "<scratchpad>/check-opening.js"
```

using:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();
p.journalEntry.findFirst({
  where: { reference: 'OPENING-BALANCE' },
  include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
}).then((e) => {
  if (!e) return console.log('no opening entry — did isOpeningEntry bypass fail?');
  console.log(e.entryNo, '|', e.description, '|', new Date(e.entryDate).toISOString().slice(0, 10));
  e.lines.forEach((l) => console.log(' ', l.account.accountCode, l.account.accountName.padEnd(32), 'DR', String(l.debit).padStart(10), 'CR', String(l.credit).padStart(10)));
  const dr = e.lines.reduce((s, l) => s + Number(l.debit), 0);
  const cr = e.lines.reduce((s, l) => s + Number(l.credit), 0);
  console.log(`  DR ${dr} / CR ${cr} — ${dr === cr ? 'BALANCED' : 'OUT OF BALANCE'}`);
}).catch((err) => console.error('ERR', err.message)).finally(() => p.$disconnect());
```

Expected: the entry dated `2026-08-01`, a `3070` credit of `655000`, and `BALANCED`.
`no opening entry` means the `isOpeningEntry` bypass is not working — revisit Task 2 Step 4.

- [ ] **Step 4: Confirm posting twice is refused**

Post again from the same screen.
Expected: the page now shows the read-only posted view instead of the form. Calling the endpoint directly returns `400` with `Opening balances already posted as JE-…`.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/settings/opening-balances/page.jsx" components/layout/Sidebar.jsx
git commit -m "feat(cutover): add the Opening Balances screen"
```

---

# Phase 3 — Reconciliation and BIR safety

---

### Task 8: Reconciliation check

**Files:**
- Modify: `server/controllers/openingBalanceController.js`
- Modify: `server/routes/openingBalances.js`
- Modify: `app/(dashboard)/settings/opening-balances/page.jsx`
- Modify: `lib/api.js`

**Interfaces:**
- Consumes: the opening entry from Task 6.
- Produces: `GET /api/opening-balances/reconcile` → `{ ar: { subledger, opening, difference, ok }, ap: { … } }`.

- [ ] **Step 1: Add the handler**

Append to `server/controllers/openingBalanceController.js`:

```js
// The migration is only trustworthy if the documents agree with the opening
// figures. Sum what is still unpaid on pre-cutover documents and compare.
exports.reconcile = async (req, res, next) => {
  try {
    const biz = await prisma.business.findUnique({
      where: { id: req.businessId }, select: { booksStartDate: true },
    });
    if (!biz?.booksStartDate) throw createError('No books start date is set for this business', 400);

    const cutoff = biz.booksStartDate;

    const [invoices, bills, entry] = await Promise.all([
      prisma.invoice.findMany({
        where: { businessId: req.businessId, invoiceDate: { lt: cutoff }, status: { not: 'VOID' } },
        select: { totalAmount: true, paidAmount: true },
      }),
      prisma.bill.findMany({
        where: { businessId: req.businessId, billDate: { lt: cutoff }, status: { not: 'VOID' } },
        select: { totalAmount: true, paidAmount: true },
      }),
      prisma.journalEntry.findFirst({
        where: { businessId: req.businessId, reference: OPENING_REFERENCE },
        include: { lines: { include: { account: { select: { accountCode: true } } } } },
      }),
    ]);

    const openOf = (rows) =>
      Number(rows.reduce((s, r) => s + (Number(r.totalAmount) - Number(r.paidAmount || 0)), 0).toFixed(2));

    const openingFor = (code, side) => {
      if (!entry) return 0;
      return Number(entry.lines
        .filter((l) => l.account.accountCode === code)
        .reduce((s, l) => s + Number(l[side]), 0)
        .toFixed(2));
    };

    const build = (subledger, opening) => {
      const difference = Number((subledger - opening).toFixed(2));
      return { subledger, opening, difference, ok: Math.abs(difference) < 0.01 };
    };

    res.json({
      booksStartDate: cutoff,
      posted: !!entry,
      ar: build(openOf(invoices), openingFor('1100', 'debit')),
      ap: build(openOf(bills),    openingFor('2000', 'credit')),
    });
  } catch (err) { next(err); }
};
```

- [ ] **Step 2: Add the route ABOVE nothing problematic, but keep it literal**

In `server/routes/openingBalances.js`, add:

```js
router.get('/reconcile', ctrl.reconcile);
```

so the file reads:

```js
router.get('/',          ctrl.get);
router.get('/reconcile', ctrl.reconcile);
router.post('/',         authorize('ADMIN', 'MANAGER'), ctrl.create);
```

- [ ] **Step 3: Add the API client method**

In `lib/api.js`, inside the `openingBalances` export:

```js
  reconcile: () => api.get('/opening-balances/reconcile'),
```

- [ ] **Step 4: Show it on the page**

In `app/(dashboard)/settings/opening-balances/page.jsx`, add `recon` state, fetch it inside `load()` with `obApi.reconcile().then((r) => setRecon(r.data)).catch(() => setRecon(null))`, and render above the table:

```jsx
      {recon?.posted && (
        <div className="card card-body mb-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Reconciliation</h4>
          {[['Accounts Receivable', recon.ar], ['Accounts Payable', recon.ap]].map(([label, r]) => (
            <div key={label} className="flex justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
              <span className="text-gray-600">{label}</span>
              <span className="flex gap-6">
                <span className="text-gray-500">documents {formatCurrency(r.subledger)}</span>
                <span className="text-gray-500">opening {formatCurrency(r.opening)}</span>
                <span className={r.ok ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                  {r.ok ? 'matches' : `off by ${formatCurrency(Math.abs(r.difference))}`}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Verify it detects a real mismatch**

With the ₱500,000 AR opening figure posted, the check compares it against the
sum of unpaid pre-cutover invoices. Unless those happen to total exactly
₱500,000, it must report **off by …** in red. Then enter pre-cutover invoices
until the two agree and confirm it flips to green **matches**.

A checker that reports `matches` before any pre-cutover invoices exist is broken —
₱0 of documents cannot match a ₱500,000 opening figure.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/openingBalanceController.js server/routes/openingBalances.js lib/api.js "app/(dashboard)/settings/opening-balances/page.jsx"
git commit -m "feat(cutover): reconcile pre-cutover documents against opening balances"
```

---

### Task 9: Keep pre-cutover documents out of BIR reports

`birController` reads the `invoice` and `bill` tables directly, not the GL, so
Phase 1's guard does not protect VAT returns. A historical invoice dated May 2026
would still appear in a May 2026 SLSP or 2550 run and re-declare VAT already filed.

**Files:**
- Modify: `server/controllers/birController.js`

**Interfaces:**
- Consumes: `Business.booksStartDate`.
- Produces: BIR report responses gain `{ cutoverWarning: string | null }`; pre-cutover documents are excluded from their queries.

- [ ] **Step 1: Add a shared cutoff helper**

At the top of `server/controllers/birController.js`, after the existing requires:

```js
// BIR reports read the source documents rather than the GL, so the cutover
// guard in glPost does not protect them. Pre-cutover documents were already
// declared under the previous books and must never re-enter a return.
async function cutoverFilter(businessId, rangeStart) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId }, select: { booksStartDate: true },
  });
  const start = biz?.booksStartDate || null;
  if (!start) return { gte: undefined, warning: null };

  const startKey = new Date(start).toISOString().slice(0, 10);
  const warning = rangeStart && new Date(rangeStart) < new Date(start)
    ? `This period begins before the books start date (${startKey}). Documents dated earlier are excluded — they were declared under your previous books.`
    : null;

  return { gte: start, warning };
}
```

- [ ] **Step 2: Apply it to the sales/purchases listing**

In `birController.js`, in the handler that builds `dateRange` for
`prisma.invoiceLine.findMany` and `prisma.billLine.findMany` (around line 32),
resolve the filter first and intersect it with the requested range:

```js
  const { gte: cutoverGte, warning: cutoverWarning } = await cutoverFilter(biz, req.query.from);
  const effectiveRange = cutoverGte
    ? { ...dateRange, gte: dateRange.gte && new Date(dateRange.gte) > new Date(cutoverGte) ? dateRange.gte : cutoverGte }
    : dateRange;
```

Use `effectiveRange` in place of `dateRange` in both `findMany` calls, and add
`cutoverWarning` to the JSON response object.

- [ ] **Step 3: Apply it to the VAT return handler**

In the handler around line 212, before the `Promise.all` that queries
`prisma.bill.findMany` and `prisma.invoice.findMany`, insert:

```js
  const { gte: cutoverGte, warning: cutoverWarning } = await cutoverFilter(biz, req.query.from);
  const effectiveRange = cutoverGte
    ? { ...dateRange, gte: dateRange.gte && new Date(dateRange.gte) > new Date(cutoverGte) ? dateRange.gte : cutoverGte }
    : dateRange;
```

Then change the two `where` clauses from `billDate: dateRange` and
`invoiceDate: dateRange` to `billDate: effectiveRange` and
`invoiceDate: effectiveRange` respectively.

Finally, add `cutoverWarning` to the object passed to `res.json(...)` in that
handler, so the UI can surface it:

```js
    res.json({ ...existingPayload, cutoverWarning });
```

Replace `...existingPayload` with whatever that handler already returns — do not
change the existing keys, only add `cutoverWarning` alongside them.

- [ ] **Step 4: Verify a historical invoice cannot re-enter a return**

With BEULAH I.T's cutover at `2026-08-01` and the May 2026 historical invoice
from Task 3 in place, request the VAT return for May 2026 and confirm the
historical invoice is absent and `cutoverWarning` is populated. Then request a
period after the cutover and confirm normal invoices appear with
`cutoverWarning: null`.

- [ ] **Step 5: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/birController.js
git commit -m "fix(bir): exclude pre-cutover documents from VAT reports"
```

---

## Done

Historical documents can be entered for history without touching current
revenue, Output VAT or cash; the day-one balance sheet is established against
`3070 Opening Balance Equity`; the migration is proven arithmetically; and old
invoices cannot re-declare VAT already filed.

**Deliberately excluded** (spec non-goals): spreadsheet import, prior-period
restatement, and multi-currency opening balances.
