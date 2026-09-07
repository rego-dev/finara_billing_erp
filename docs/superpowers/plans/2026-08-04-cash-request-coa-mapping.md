# Cash Request — Automatic COA Mapping, Wiring & Printable Form

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive each cash-request line's GL account automatically from its description, carry the request's items into the liquidation, and print a signable Cash Request Form that shows where every line lands in the chart of accounts.

**Architecture:** A pure keyword→account module (`server/utils/accountMap.js`) is the single source of truth. It is served to the browser once per page load for instant as-you-type matching, and re-applied server-side at liquidation so a line can never silently fall to Miscellaneous just because the UI didn't run. The print form is a module-level function mirroring `printPO` in the purchase-orders page.

**Tech Stack:** Next.js 14 (App Router) · Express · MySQL 8 · Prisma 5 · jest · Tailwind · lucide-react · react-hot-toast

Source spec: `docs/superpowers/specs/2026-08-04-cash-request-coa-mapping-design.md`

## Global Constraints

- **Branch:** `feat/cash-request` (already checked out).
- **Run tests with `npx jest`** — the `test` script is `jest`, and there is no babel/jest transform configured. Only CommonJS under `server/` and `tests/` is testable; `lib/` is ESM and cannot be unit-tested.
- **PowerShell, not bash.** Heredocs (`<<'EOF'`) and `$(date)` do not work. For multi-line commit messages write a temp file and use `git commit -F <file>`.
- **Do not run `next build` while `npm run dev` is running** — both write to `.next/` and the dev server then 404s on `main-app.js`.
- **Stop the dev server before any `prisma generate` or migration** (Windows locks the engine DLL → `EPERM`). This plan requires **no schema change and no migration**.
- **`glPost` throws** `GL: No account "<code>" in COA for businessId <n>` when a code is missing from that business's COA. Every code in the map must exist in all three businesses (ids 1, 2, 3).
- **Fallback account is `6390`** (Miscellaneous Expense) and must stay the last resort.
- The dev server is normally already running on ports 3000 (web) and 5000 (api).

---

### Task 1: Keyword → account engine

**Files:**
- Create: `server/utils/accountMap.js`
- Test: `tests/accountMap.test.js`

**Interfaces:**
- Consumes: nothing. Pure module — no Prisma, no I/O.
- Produces:
  - `matchAccountCode(description) -> string` — always returns a code; `'6390'` when nothing matches.
  - `matchAccount(description) -> { accountCode: string, matched: boolean }`
  - `KEYWORD_RULES -> [{ accountCode: string, keywords: string[] }]` — ordered, first match wins.
  - `FALLBACK_ACCOUNT -> '6390'`

- [ ] **Step 1: Write the failing test**

Create `tests/accountMap.test.js`:

```js
const {
  matchAccountCode,
  matchAccount,
  KEYWORD_RULES,
  FALLBACK_ACCOUNT,
} = require('../server/utils/accountMap');

describe('matchAccountCode', () => {
  test('maps build materials to Advertising Materials Cost', () => {
    expect(matchAccountCode('Plywood 3/4 - 4 pcs')).toBe('5021');
    expect(matchAccountCode('Nails and screws assorted')).toBe('5021');
    expect(matchAccountCode('Paint 2 gal')).toBe('5021');
  });

  test('maps printing work to Printing & Reproduction', () => {
    expect(matchAccountCode('Tarpaulin printing 3x5')).toBe('5029');
    expect(matchAccountCode('Sticker decal for booth')).toBe('5029');
  });

  test('maps fares and fuel to Transportation & Travel', () => {
    expect(matchAccountCode('Grab to venue')).toBe('6520');
    expect(matchAccountCode('Gasoline for delivery van')).toBe('6520');
    expect(matchAccountCode('Parking fee')).toBe('6520');
  });

  test('maps food to Representation & Entertainment', () => {
    expect(matchAccountCode('Snacks for crew')).toBe('6510');
    expect(matchAccountCode('Merienda')).toBe('6510');
  });

  test('is case-insensitive', () => {
    expect(matchAccountCode('PLYWOOD SHEETS')).toBe('5021');
    expect(matchAccountCode('plywood sheets')).toBe('5021');
    expect(matchAccountCode('PlYwOoD sheets')).toBe('5021');
  });

  test('matches on word boundaries, not substrings', () => {
    // "penalty" contains "pen" but is not office supplies
    expect(matchAccountCode('Penalty for late filing')).not.toBe('6320');
    // "gastos" contains "gas" but is not transportation
    expect(matchAccountCode('Gastos sa opisina')).not.toBe('6520');
  });

  test('falls back to 6390 when nothing matches', () => {
    expect(matchAccountCode('Something entirely unrecognised')).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode('')).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode(null)).toBe(FALLBACK_ACCOUNT);
    expect(matchAccountCode(undefined)).toBe(FALLBACK_ACCOUNT);
  });

  test('respects rule order — printing wins over materials for tarpaulin printing', () => {
    // "tarpaulin printing" contains both a printing keyword and a materials keyword.
    // 5029 is declared before 5021, so printing wins. This is deliberate.
    const printingIdx  = KEYWORD_RULES.findIndex((r) => r.accountCode === '5029');
    const materialsIdx = KEYWORD_RULES.findIndex((r) => r.accountCode === '5021');
    expect(printingIdx).toBeLessThan(materialsIdx);
    expect(matchAccountCode('Tarpaulin printing')).toBe('5029');
  });
});

describe('matchAccount', () => {
  test('reports matched true with the code', () => {
    expect(matchAccount('Plywood 3/4')).toEqual({ accountCode: '5021', matched: true });
  });

  test('reports matched false on the fallback', () => {
    expect(matchAccount('zzzz nothing')).toEqual({ accountCode: '6390', matched: false });
  });
});

describe('KEYWORD_RULES', () => {
  test('every rule has a code and at least one keyword', () => {
    expect(KEYWORD_RULES.length).toBeGreaterThan(0);
    for (const rule of KEYWORD_RULES) {
      expect(rule.accountCode).toMatch(/^\d{4}$/);
      expect(Array.isArray(rule.keywords)).toBe(true);
      expect(rule.keywords.length).toBeGreaterThan(0);
    }
  });

  test('no rule uses the fallback account as its own code', () => {
    expect(KEYWORD_RULES.some((r) => r.accountCode === FALLBACK_ACCOUNT)).toBe(false);
  });

  test('keywords are lowercase so matching is predictable', () => {
    for (const rule of KEYWORD_RULES) {
      for (const kw of rule.keywords) {
        expect(kw).toBe(kw.toLowerCase());
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/accountMap.test.js`
Expected: FAIL — `Cannot find module '../server/utils/accountMap'`

- [ ] **Step 3: Write the implementation**

Create `server/utils/accountMap.js`:

```js
/**
 * Keyword → GL account mapping for cash request and liquidation lines.
 *
 * Pure module: no Prisma, no I/O, no business context. Returns COA *codes*;
 * the caller resolves a code to an account id within its own business.
 *
 * Ordering matters — the first rule with a keyword hit wins. More specific
 * work (printing) is declared before the raw materials it is made from, so
 * "tarpaulin printing" books as printing rather than as materials.
 *
 * Accounting policy (confirmed with the business owner, 2026-08-04): build
 * materials and printing map to Cost of Sales (50xx) because the spend is
 * consumed producing work billed to clients, so the cost matches that job's
 * revenue. The COA reinforces this — 6530 is named "Marketing & Promotions
 * (Internal)" precisely to hold the company's own promo spend instead.
 *
 * Spend on the company's own booths still belongs in 6530; that is what the
 * per-line override in the UI is for. Do not flip these defaults without
 * revisiting the decision.
 */

const FALLBACK_ACCOUNT = '6390'; // Miscellaneous Expense

const KEYWORD_RULES = [
  { accountCode: '5029', keywords: ['print', 'printing', 'tarpaulin', 'tarp', 'sticker', 'decal', 'photocopy', 'xerox', 'reproduction'] },
  { accountCode: '5028', keywords: ['photography', 'videography', 'photo', 'video', 'shoot', 'drone'] },
  { accountCode: '5027', keywords: ['studio'] },
  { accountCode: '5026', keywords: ['rental', 'generator', 'genset', 'sound system', 'lights rental'] },
  { accountCode: '5025', keywords: ['talent', 'model', 'host', 'emcee', 'voice over'] },
  { accountCode: '5024', keywords: ['subcon', 'subcontractor', 'freelance', 'freelancer'] },
  { accountCode: '5021', keywords: ['plywood', 'paint', 'nails', 'screws', 'lumber', 'vinyl', 'sintra', 'acrylic', 'foam', 'glue', 'tape', 'wood', 'steel'] },
  { accountCode: '6520', keywords: ['grab', 'taxi', 'fare', 'gas', 'gasoline', 'diesel', 'toll', 'parking', 'fuel', 'jeep', 'tricycle', 'habal'] },
  { accountCode: '6510', keywords: ['meal', 'meals', 'food', 'snack', 'snacks', 'merienda', 'lunch', 'dinner', 'breakfast', 'catering', 'drinks', 'water'] },
  { accountCode: '6320', keywords: ['bond paper', 'ink', 'ballpen', 'pen', 'folder', 'stapler', 'office supplies', 'envelope', 'notebook'] },
  { accountCode: '6330', keywords: ['courier', 'lbc', 'jrs', 'delivery', 'freight', 'padala'] },
  { accountCode: '6370', keywords: ['permit', 'license', 'clearance', 'registration', 'barangay', 'mayor', 'bir'] },
  { accountCode: '6240', keywords: ['repair', 'maintenance', 'fix'] },
  { accountCode: '6310', keywords: ['internet', 'wifi', 'load', 'data plan', 'sim'] },
  { accountCode: '6360', keywords: ['bank charge', 'transfer fee', 'service fee', 'remittance fee'] },
];

// Escape regex metacharacters so a keyword is always treated literally.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary match so "gas" does not fire on "gastos" and "pen" not on "penalty".
const hasKeyword = (haystack, keyword) =>
  new RegExp(`\\b${escapeRe(keyword)}\\b`, 'i').test(haystack);

function matchAccount(description) {
  const text = String(description || '').trim();
  if (!text) return { accountCode: FALLBACK_ACCOUNT, matched: false };

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => hasKeyword(text, kw))) {
      return { accountCode: rule.accountCode, matched: true };
    }
  }
  return { accountCode: FALLBACK_ACCOUNT, matched: false };
}

function matchAccountCode(description) {
  return matchAccount(description).accountCode;
}

module.exports = { matchAccount, matchAccountCode, KEYWORD_RULES, FALLBACK_ACCOUNT };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/accountMap.test.js`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole suite for regressions**

Run: `npx jest`
Expected: all suites pass (15 suites after this task).

- [ ] **Step 6: Commit**

```bash
git add server/utils/accountMap.js tests/accountMap.test.js
git commit -m "feat(cash-request): add keyword to GL account mapping engine"
```

---

### Task 2: Serve the map, re-match server-side, verify the COA

**Files:**
- Modify: `server/controllers/cashRequestController.js`
- Modify: `server/routes/cashRequests.js`

**Interfaces:**
- Consumes: `matchAccountCode`, `KEYWORD_RULES`, `FALLBACK_ACCOUNT` from Task 1.
- Produces:
  - Controller export `accountMap` — `GET /api/cash-requests/account-map` returning `{ rules, fallback }`.
  - Internal helper `resolveLineAccounts(lines, businessId) -> Promise<lines>` which fills `accountId` on any line lacking one. Task 5 relies on the endpoint's response shape.

- [ ] **Step 1: Add the import**

At the top of `server/controllers/cashRequestController.js`, next to the existing requires:

```js
const { matchAccountCode, KEYWORD_RULES, FALLBACK_ACCOUNT } = require('../utils/accountMap');
```

- [ ] **Step 2: Add the map endpoint handler**

Append to `server/controllers/cashRequestController.js`:

```js
// Serves the keyword rules to the browser so the UI can match as the user
// types without a round-trip per keystroke. The server re-applies the same
// rules at liquidation, so this is a convenience, not the authority.
exports.accountMap = (_req, res) => {
  res.json({ rules: KEYWORD_RULES, fallback: FALLBACK_ACCOUNT });
};
```

- [ ] **Step 3: Add the account-resolution helper**

In `server/controllers/cashRequestController.js`, add this above `exports.liquidate`:

```js
// Fill in accountId for any line that arrived without one, using the same
// keyword rules the browser used. Batched: one query for all needed codes.
const resolveLineAccounts = async (lines, businessId) => {
  const needing = lines.filter((l) => !l.accountId);
  if (!needing.length) return lines;

  const wanted = new Map(); // description -> code
  for (const l of needing) wanted.set(l.description, matchAccountCode(l.description));

  const codes = [...new Set(wanted.values())];
  const accts = await prisma.account.findMany({
    where: { accountCode: { in: codes }, businessId },
    select: { id: true, accountCode: true },
  });
  const byCode = new Map(accts.map((a) => [a.accountCode, a.id]));

  return lines.map((l) =>
    l.accountId ? l : { ...l, accountId: byCode.get(wanted.get(l.description)) ?? null }
  );
};
```

- [ ] **Step 4: Call the helper inside `liquidate`**

In `server/controllers/cashRequestController.js`, find this block (currently around line 257):

```js
    const spent = (lines || [])
      .filter((l) => l.description && Number(l.amount) > 0)
      .map((l) => ({
        description: l.description,
        amount:      Number(l.amount),
        accountId:   l.accountId ? Number(l.accountId) : null,
        receiptNo:   l.receiptNo || null,
      }));
    if (!spent.length) throw createError('Add at least one liquidation line', 400);
```

Replace it with:

```js
    const rawSpent = (lines || [])
      .filter((l) => l.description && Number(l.amount) > 0)
      .map((l) => ({
        description: l.description,
        amount:      Number(l.amount),
        accountId:   l.accountId ? Number(l.accountId) : null,
        receiptNo:   l.receiptNo || null,
      }));
    if (!rawSpent.length) throw createError('Add at least one liquidation line', 400);

    // Any line without an account gets one from the keyword rules, so nothing
    // silently lands in Miscellaneous just because the UI did not match it.
    const spent = await resolveLineAccounts(rawSpent, req.businessId);
```

Everything below stays as it is — `buildLiquidationEntry` already honours per-line `accountId`.

- [ ] **Step 5: Add the route ABOVE the `/:id` route**

Express matches in order, so `/account-map` must be declared before `/:id` or it will be swallowed. In `server/routes/cashRequests.js`, put it next to the other literal GET routes:

```js
router.get('/account-map',  ctrl.accountMap);
```

The GET block should then read:

```js
router.get('/',    ctrl.list);
router.get('/summary',      ctrl.summary);
router.get('/unliquidated', ctrl.unliquidated);
router.get('/account-map',  ctrl.accountMap);
router.get('/:id', ctrl.getOne);
```

- [ ] **Step 6: Verify the modules still load**

Run: `node -e "require('./server/controllers/cashRequestController'); require('./server/routes/cashRequests'); console.log('modules load OK');"`
Expected: `modules load OK`

- [ ] **Step 7: Verify the route is mounted and ordered correctly**

With the dev server running:

```powershell
try { Invoke-WebRequest -Uri "http://localhost:5000/api/cash-requests/account-map" -UseBasicParsing -TimeoutSec 30 | Out-Null } catch { "account-map: $([int]$_.Exception.Response.StatusCode)" }
```

Expected: `account-map: 401` — the route exists and demands auth. A `500` means `/:id` swallowed it and `Number('account-map')` produced `NaN`.

- [ ] **Step 8: Verify every mapped code exists in every business COA**

`glPost` throws if a code is missing from a business's COA, which would break posting for that business. Write this to the scratchpad as `verify-coa.js` and run it:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const { KEYWORD_RULES, FALLBACK_ACCOUNT } = require(ROOT + '\\server\\utils\\accountMap');
const p = new PrismaClient();

(async () => {
  const codes = [...new Set([...KEYWORD_RULES.map((r) => r.accountCode), FALLBACK_ACCOUNT])];
  const businesses = await p.business.findMany({ select: { id: true, name: true } });
  let bad = 0;

  for (const b of businesses) {
    const found = await p.account.findMany({
      where: { accountCode: { in: codes }, businessId: b.id },
      select: { accountCode: true },
    });
    const have = new Set(found.map((a) => a.accountCode));
    const missing = codes.filter((c) => !have.has(c));
    console.log(`biz${b.id} ${b.name}: ${missing.length ? 'MISSING ' + missing.join(', ') : 'all ' + codes.length + ' codes present'}`);
    bad += missing.length;
  }
  console.log(bad ? 'FAILED — add the missing accounts before shipping' : 'OK — every mapped code resolves in every business');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
```

Expected: `OK — every mapped code resolves in every business`, exit code 0.

- [ ] **Step 9: Run the full suite**

Run: `npx jest`
Expected: all suites pass.

- [ ] **Step 10: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js
git commit -m "feat(cash-request): serve keyword map and resolve line accounts server-side"
```

---

### Task 3: Include liquidation item accounts in `getOne`

The print form in Task 6 shows an Account column for liquidation lines, but
`getOne` currently includes liquidation items without their account relation, so
that column would render empty. Fix the include first so later tasks have data.

**Files:**
- Modify: `server/controllers/cashRequestController.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `GET /api/cash-requests/:id` response where `liquidation.items[].account` is `{ accountCode, accountName }` or `null`. Task 6 renders it.

- [ ] **Step 1: Widen the include**

In `server/controllers/cashRequestController.js`, in `exports.getOne`, find:

```js
        liquidation: { include: { items: true } },
```

Replace with:

```js
        liquidation: {
          include: {
            items: { include: { account: { select: { accountCode: true, accountName: true } } } },
          },
        },
```

- [ ] **Step 2: Verify the shape**

Write this to the scratchpad as `check-include.js` and run it. It mirrors the
controller's include and asserts the account relation is reachable:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();

(async () => {
  const cr = await p.cashRequest.findFirst({
    where: { status: 'LIQUIDATED' },
    include: {
      items: { include: { account: { select: { accountCode: true, accountName: true } } } },
      liquidation: {
        include: {
          items: { include: { account: { select: { accountCode: true, accountName: true } } } },
        },
      },
    },
  });
  if (!cr) return console.log('no liquidated request to check');
  console.log('request:', cr.requestNo);
  console.log('request items :', cr.items.map((i) => `${i.description} -> ${i.account?.accountCode || 'none'}`));
  console.log('liq items     :', cr.liquidation.items.map((i) => `${i.description} -> ${i.account?.accountCode || 'none'}`));
  console.log('account relation reachable on liquidation items: OK');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => p.$disconnect());
```

Expected: prints both item lists and `account relation reachable on liquidation items: OK`. Existing rows may show `none` — that is fine, they predate the mapping.

- [ ] **Step 3: Commit**

```bash
git add server/controllers/cashRequestController.js
git commit -m "feat(cash-request): include liquidation item accounts in the detail payload"
```

---

### Task 4: Auto-select the account as the user types (Request modal)

**Files:**
- Modify: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `GET /api/cash-requests/account-map` from Task 2; `accounts` state already loaded on the page via `acctApi.list`.
- Produces: page-level `matchCodeFor(description, rules, fallback)` and an `accountMap` state object `{ rules, fallback }` shared with Task 5's Liquidate modal.

- [ ] **Step 1: Add the API helper**

In `lib/api.js`, inside the existing `cashRequests` export, add one line after `unliquidated`:

```js
  accountMap:   ()         => api.get('/cash-requests/account-map'),
```

- [ ] **Step 2: Add the matcher next to the other page-level helpers**

In `app/(dashboard)/cash-requests/page.jsx`, below `const emptyItem = ...`, add:

```jsx
// Mirrors server/utils/accountMap.js — word-boundary, case-insensitive,
// first rule wins. The rules themselves come from the server so the two
// never drift apart.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchCodeFor(description, rules = [], fallback = '6390') {
  const text = String(description || '').trim();
  if (!text) return { accountCode: fallback, matched: false };
  for (const rule of rules) {
    if (rule.keywords.some((kw) => new RegExp(`\\b${escapeRe(kw)}\\b`, 'i').test(text))) {
      return { accountCode: rule.accountCode, matched: true };
    }
  }
  return { accountCode: fallback, matched: false };
}

// Resolve a matched code to an account id within the loaded COA.
const accountIdForCode = (accounts, code) =>
  accounts.find((a) => a.accountCode === code)?.id || '';
```

- [ ] **Step 3: Load the map on the page and pass it down**

In `CashRequestsPage`, add the state next to the other `useState` calls:

```jsx
  const [accountMap, setAccountMap] = useState({ rules: [], fallback: '6390' });
```

Add the fetch next to the existing accounts fetch effect:

```jsx
  useEffect(() => {
    crApi.accountMap()
      .then((r) => setAccountMap(r.data))
      .catch(() => setAccountMap({ rules: [], fallback: '6390' }));
  }, []);
```

Pass it to the new-request modal — change the `modal?.type === 'new'` render to:

```jsx
      {modal?.type === 'new' && (
        <RequestModal accounts={accounts} names={names} accountMap={accountMap}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }} />
      )}
```

- [ ] **Step 4: Auto-select inside `RequestModal`**

Change the `RequestModal` signature to accept the map:

```jsx
function RequestModal({ request, accounts, names, accountMap, onClose, onSaved }) {
```

`emptyItem` gains a stickiness flag so a hand-picked account is never overwritten. Replace the existing `emptyItem` definition with:

```jsx
const emptyItem = () => ({ description: '', quantity: '1', estimatedCost: '', accountId: '', accountTouched: false });
```

An account already saved on an existing request counts as a deliberate choice —
without this, editing that item's description would silently overwrite it. In
`RequestModal`'s edit branch, replace the item mapping:

```jsx
          items: request.items?.length
            ? request.items.map((i) => ({
                description: i.description,
                quantity: i.quantity != null ? String(i.quantity) : '',
                estimatedCost: String(i.estimatedCost),
                accountId: i.accountId ? String(i.accountId) : '',
              }))
            : [emptyItem()],
```

with:

```jsx
          items: request.items?.length
            ? request.items.map((i) => ({
                description: i.description,
                quantity: i.quantity != null ? String(i.quantity) : '',
                estimatedCost: String(i.estimatedCost),
                accountId: i.accountId ? String(i.accountId) : '',
                accountTouched: !!i.accountId,
              }))
            : [emptyItem()],
```

Replace the existing `setItem` in `RequestModal` with:

```jsx
  const setItem = (i, k, v) =>
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) => {
        if (idx !== i) return it;
        const next = { ...it, [k]: v };
        // A manual account choice is sticky.
        if (k === 'accountId') next.accountTouched = true;
        // Typing a description re-runs the match until the user overrides it.
        if (k === 'description' && !next.accountTouched) {
          const { accountCode } = matchCodeFor(v, accountMap.rules, accountMap.fallback);
          next.accountId = accountIdForCode(accounts, accountCode);
        }
        return next;
      }),
    }));
```

- [ ] **Step 5: Flag unmatched lines in the items table**

In `RequestModal`'s items table, replace the `AccountSelect` cell with:

```jsx
                        <td>
                          <AccountSelect
                            value={it.accountId}
                            onChange={(v) => setItem(i, 'accountId', v)}
                            accounts={accounts}
                            placeholder="— optional —"
                          />
                          {it.description && !it.accountTouched && (
                            <p className={`text-[10px] mt-0.5 ${
                              matchCodeFor(it.description, accountMap.rules, accountMap.fallback).matched
                                ? 'text-gray-400' : 'text-amber-600'
                            }`}>
                              {matchCodeFor(it.description, accountMap.rules, accountMap.fallback).matched
                                ? 'auto · click to change'
                                : 'no match — review this account'}
                            </p>
                          )}
                        </td>
```

- [ ] **Step 6: Strip the UI-only flag before saving**

`accountTouched` must not be sent to the API. In `RequestModal`'s `submit`, replace:

```jsx
      const payload = { ...form, items };
```

with:

```jsx
      const payload = {
        ...form,
        items: items.map(({ accountTouched, ...rest }) => rest),
      };
```

- [ ] **Step 7: Verify in the browser**

The dev server rebuilds automatically. Log in, open **New Cash Request**, and type into a description:

- `Plywood 3/4 - 4 pcs` → account auto-selects **5021 Advertising Materials Cost**, caption reads `auto · click to change`
- `Tarpaulin printing` → **5029 Printing & Reproduction Costs**
- `Grab to venue` → **6520 Transportation & Travel**
- `Snacks for crew` → **6510 Representation & Entertainment**
- `Something unrecognisable` → **6390 Miscellaneous**, caption reads `no match — review this account` in amber
- Pick an account by hand, then keep typing in that same description → the hand-picked account must **not** change

- [ ] **Step 8: Commit**

```bash
git add lib/api.js "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-request): auto-select the GL account as the description is typed"
```

---

### Task 5: Prefill liquidation lines from the request items

**Files:**
- Modify: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `crApi.get` (full request with items), `accountMap` state and `matchCodeFor`/`accountIdForCode` from Task 4.
- Produces: nothing new for later tasks.

The row data in the table comes from `crApi.list`, which already includes `items`,
so the modal can prefill without another fetch.

- [ ] **Step 1: Accept the map and prefill the lines**

In `app/(dashboard)/cash-requests/page.jsx`, change the `LiquidateModal` signature:

```jsx
function LiquidateModal({ request, accounts, accountMap, onClose, onDone }) {
```

Replace the existing `lines` state initialiser:

```jsx
  const [lines, setLines] = useState([{ description: '', amount: '', accountId: '', receiptNo: '' }]);
```

with a prefill from the request's items, falling back to one blank line:

```jsx
  // Start from what was requested — description, account and estimated amount.
  // The user corrects the amounts against the receipts and adds anything extra.
  const [lines, setLines] = useState(() => {
    const fromRequest = (request.items || []).map((i) => ({
      description:    i.description,
      amount:         String(i.estimatedCost),
      accountId:      i.accountId ? String(i.accountId) : '',
      receiptNo:      '',
      accountTouched: !!i.accountId,
    }));
    return fromRequest.length
      ? fromRequest
      : [{ description: '', amount: '', accountId: '', receiptNo: '', accountTouched: false }];
  });
```

- [ ] **Step 2: Auto-match on typing here too**

Replace `LiquidateModal`'s `setLine` and `addLine` with:

```jsx
  const setLine = (i, k, v) =>
    setLines((p) => p.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, [k]: v };
      if (k === 'accountId') next.accountTouched = true;
      if (k === 'description' && !next.accountTouched) {
        const { accountCode } = matchCodeFor(v, accountMap.rules, accountMap.fallback);
        next.accountId = accountIdForCode(accounts, accountCode);
      }
      return next;
    }));

  const addLine = () =>
    setLines((p) => [...p, { description: '', amount: '', accountId: '', receiptNo: '', accountTouched: false }]);
```

- [ ] **Step 3: Strip the UI-only flag before posting**

In `LiquidateModal`'s `submit`, replace:

```jsx
      await crApi.liquidate(request.id, { lines: valid, receiptNo, liquidationDate: date });
```

with:

```jsx
      const payload = valid.map(({ accountTouched, ...rest }) => rest);
      await crApi.liquidate(request.id, { lines: payload, receiptNo, liquidationDate: date });
```

- [ ] **Step 4: Pass the map in**

Update the render at the bottom of the page:

```jsx
      {modal?.type === 'liquidate' && (
        <LiquidateModal request={modal.request} accounts={accounts} accountMap={accountMap}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
```

- [ ] **Step 5: Verify end-to-end in the browser**

Create a request with two items (`Plywood 3/4 - 4 pcs` ₱3,000 and `Tarpaulin printing` ₱1,500), submit it, approve it, release ₱4,500 from `1010`, then open **Liquidate**:

- both lines are prefilled with descriptions, accounts (5021 and 5029) and amounts
- change one amount to ₱1,200 and confirm the variance block updates to **Sukli to return ₱300.00**
- record the liquidation, then confirm the posted entry hit the mapped accounts:

Write to the scratchpad as `check-entry.js` and run:

```js
const ROOT = 'D:\\Accounting System ERP';
const { PrismaClient } = require(ROOT + '\\node_modules\\@prisma\\client');
const p = new PrismaClient();
p.journalEntry.findFirst({
  where: { reference: { startsWith: 'CR-' } },
  orderBy: { id: 'desc' },
  include: { lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
}).then((e) => {
  if (!e) return console.log('no CR journal entry yet');
  console.log(e.entryNo, e.description);
  e.lines.forEach((l) => console.log(' ', l.account.accountCode, l.account.accountName, 'DR', String(l.debit), 'CR', String(l.credit)));
}).catch((err) => console.error('ERR', err.message)).finally(() => p.$disconnect());
```

Expected: debits against **5021** and **5029** (not 6390), a credit clearing **1104** for the full released amount, and a debit to **1010** for the returned change.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-request): prefill liquidation lines from the request items"
```

---

### Task 6: Printable Cash Request Form

Replaces the summary print with a signable form. The current `handlePrint`
inside `DetailModal` is removed and its call site points at a new module-level
function.

**Files:**
- Modify: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `printDocument`, `phpFmt`, `dateFmt`, `badge` from `lib/print` (already imported); `liquidation.items[].account` from Task 3.
- Produces: `printCashRequestForm(cr)`.

- [ ] **Step 1: Add the form builder above `// ─── Detail Modal ───`**

```jsx
// ─── Printable Cash Request Form ──────────────────────────────
// Rows written before the actorName fix hold the literal string
// "undefined undefined"; treat that as no name rather than printing it
// onto a document someone signs.
const signatory = (name) => {
  const n = String(name || '').trim();
  return !n || n === 'undefined undefined' ? '' : n;
};

const sigColumn = (label, name) => `
  <div style="flex:1;">
    <p style="font-weight:700;color:#111827;margin:0 0 30px;font-size:10px;">${label}:</p>
    <p style="margin:0 0 2px;font-size:11px;font-weight:600;color:#111;min-height:13px;">${signatory(name)}</p>
    <div style="border-top:1px solid #374151;padding-top:3px;color:#6b7280;font-size:8px;">Signature over printed name / Date</div>
  </div>`;

async function printCashRequestForm(cr) {
  const released = Number(cr.releasedAmount);
  const spent    = Number(cr.liquidation?.totalAmount || 0);
  const variance = cr.liquidation ? Number((spent - released).toFixed(2)) : null;
  const requestedTotal = (cr.items || []).reduce((s, i) => s + Number(i.estimatedCost || 0), 0);

  const itemsHTML = (cr.items || []).map((i) => `
    <tr>
      <td>${i.description}</td>
      <td class="mono small">${i.account ? `${i.account.accountCode} ${i.account.accountName}` : '—'}</td>
      <td class="right">${i.quantity != null ? Number(i.quantity).toLocaleString() : '—'}</td>
      <td class="right mono">${phpFmt(i.estimatedCost)}</td>
    </tr>`).join('');

  const releasedHTML = released > 0 ? `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Amount Released</div><div class="info-val mono">${phpFmt(released)}</div></div>
      <div class="info-box"><div class="info-lbl">Cash Source</div><div class="info-val mono">${cr.cashAccountCode || '—'}</div></div>
      <div class="info-box"><div class="info-lbl">Date Released</div><div class="info-val">${cr.releasedDate ? dateFmt(cr.releasedDate) : '—'}</div></div>
    </div>` : '';

  const liqHTML = cr.liquidation ? `
    <div class="section-title">Liquidation — ${cr.liquidation.voucherNo}</div>
    <table>
      <thead><tr><th>Description</th><th>Account</th><th>Receipt #</th><th class="right">Amount</th></tr></thead>
      <tbody>${(cr.liquidation.items || []).map((l) => `
        <tr>
          <td>${l.description}</td>
          <td class="mono small">${l.account ? `${l.account.accountCode} ${l.account.accountName}` : '—'}</td>
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
      <div class="info-box"><div class="info-lbl">Prepared By</div><div class="info-val">${signatory(cr.requestedBy) || '—'}</div></div>
    </div>

    <div class="desc-box"><strong>Purpose:</strong> ${cr.purpose}</div>

    <div class="section-title">Requested Items (estimate)</div>
    <table>
      <thead><tr><th>Description</th><th>Account</th><th class="right">Qty</th><th class="right">Est. Cost</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
      <tfoot>
        <tr><td colspan="3" class="right">TOTAL REQUESTED</td><td class="right mono">${phpFmt(requestedTotal)}</td></tr>
      </tfoot>
    </table>

    ${releasedHTML}
    ${liqHTML}

    <div style="margin-top:34px;padding-top:16px;border-top:1px solid #e5e7eb;display:flex;gap:24px;">
      ${sigColumn('Requested by', cr.requestedBy)}
      ${sigColumn('Approved by', cr.approvedBy)}
      ${sigColumn('Released by', cr.releasedBy)}
    </div>

    <div style="margin-top:22px;padding:10px 14px;border:1px solid #d1daf0;border-radius:6px;background:#f8faff;">
      <p style="margin:0 0 26px;font-size:10px;color:#374151;">
        Received the sum of <strong class="mono">${released > 0 ? phpFmt(released) : '₱ ______________'}</strong>
        as cash advance for the purpose stated above.
      </p>
      <div style="max-width:280px;">
        <div style="border-top:1px solid #374151;padding-top:3px;color:#6b7280;font-size:8px;">
          Signature over printed name / Date
        </div>
      </div>
    </div>`;

  await printDocument(
    `Cash Request Form — ${cr.requestNo}`,
    `${cr.requestedFor} · ${dateFmt(cr.requestDate)}`,
    body
  );
}
```

- [ ] **Step 2: Point the modal's Print button at it**

In `DetailModal`, delete the whole `const handlePrint = () => { ... };` block
(from `const handlePrint` down to its closing `};`, including the `itemsHTML`,
`liqHTML` and `body` consts inside it), and change the footer button:

```jsx
          <button onClick={() => printCashRequestForm(cr)} className="btn-secondary">Print</button>
```

- [ ] **Step 3: Verify the form in the browser**

Open the detail modal on a **LIQUIDATED** request and click **Print**. Confirm:

- the document title reads `Cash Request Form — CR-00000N`
- the items table has an **Account** column and a **TOTAL REQUESTED** footer row
- the released block shows amount, cash source and date
- the liquidation table shows Account and Receipt # per line, with the correct
  Sukli Returned / Reimbursed / Exact label
- three signature columns print with `Signature over printed name / Date`
- the acknowledgement block shows `Received the sum of ₱X`
- rows carrying `"undefined undefined"` print a **blank** name line, never that string

Then open an **APPROVED but not yet released** request and confirm the
acknowledgement shows a blank `₱ ______________` rule and no liquidation section.

- [ ] **Step 4: Confirm nothing else regressed**

Run: `npx jest`
Expected: all suites pass.

Then reload `/cash-requests` and confirm the page still returns 200 with no
compile errors:

```powershell
$r = Invoke-WebRequest -Uri "http://localhost:3000/cash-requests" -UseBasicParsing -TimeoutSec 90
"page: $($r.StatusCode)"
if ($r.Content -match 'Failed to compile|Module not found|SyntaxError') { "COMPILE ERROR" } else { "compiles clean" }
```

Expected: `page: 200` and `compiles clean`.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-request): print a signable Cash Request Form with COA mapping"
```

---

## Done

After Task 6: every line's GL account is derived from what the user types and
shown before it posts, the liquidation starts from the request instead of a
blank slate, and the printed form carries both the signatures and the account
each peso falls under.

**Deliberately excluded** (from the spec's non-goals): partial liquidations,
salary deduction for unliquidated advances, receipt attachments, converting a
request into a PO or bill, and a user-editable mapping table in Settings.

**Open item, not covered by any task:** five existing rows still hold the literal
`"undefined undefined"` in `requestedBy` / `approvedBy` / `releasedBy`. Task 6's
`signatory()` guard stops it printing, but the data is still wrong. Cleaning it
is a one-off `UPDATE` awaiting the user's go-ahead.
