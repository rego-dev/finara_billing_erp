# Subscription Payment GL Posting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin approves a business order (new business or renewal), post the payment Finara collected as a journal entry in a dedicated internal "Finara Operations" business — never in the paying customer's own books.

**Architecture:** A Prisma migration seeds a new `Business` (code `FINARA-OPS`) with a minimal 2-account COA. A new `server/utils/subscriptionGL.js` resolves that business's id by its code (cached) and posts a balanced two-line entry through the existing `glPost.safePost()` utility. `orderAdminController.approve` calls it once per branch (new-business / renewal), after the business side of approval has already succeeded.

**Tech Stack:** Express.js + Prisma 5 + MySQL, Jest for tests.

## Global Constraints
- Money posts to the new `FINARA-OPS` business's own COA — never to the customer's `Business`. (Spec: "Decisions")
- Minimal COA: exactly two accounts, `1010` (Cash, ASSET/DEBIT) and `4000` (Subscription Revenue, REVENUE/CREDIT) — not the full ~52-account default clone. (Spec: "Decisions")
- No VAT line; `FINARA-OPS`'s `taxType` stays `NULL`. (Spec: "Decisions")
- Both new-business and renewal approvals post to the same `4000` account, distinguished only by the journal entry's description. (Spec: "Decisions")
- Use the existing `glPost.safePost()` utility (never `glPost.post()` directly) so a GL failure can never block an approval — this is the same utility every other module in this codebase already uses for exactly this reason. (Spec: "Backend")
- No retroactive backfill for orders already approved before this ships. (Spec: "Decisions")
- No new UI — the existing multi-business switcher + Reports pages already cover viewing `FINARA-OPS`'s books once it exists. (Spec: "Out of scope")

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/migrations/20260930120000_add_finara_ops_business/migration.sql` | Seeds the `FINARA-OPS` business + its 2-account COA (create) |
| `server/utils/subscriptionGL.js` | Resolves `FINARA-OPS`'s id (cached) and posts the GL entry (create) |
| `tests/subscriptionGL.test.js` | Unit tests for the above (create) |
| `server/controllers/orderAdminController.js` | `approve` calls `postSubscriptionPayment` in both branches (modify) |
| `tests/orderAdminController.test.js` | Tests asserting the call happens with the right `kind`/args (modify) |

---

## Task 1: Migration + `subscriptionGL.js`

**Files:**
- Create: `prisma/migrations/20260930120000_add_finara_ops_business/migration.sql`
- Create: `server/utils/subscriptionGL.js`
- Test: `tests/subscriptionGL.test.js`

**Interfaces:**
- Produces: `async function getFinaraOpsBusinessId()` — resolves and caches the `FINARA-OPS` business's numeric id. `async function postSubscriptionPayment({ order, companyName, kind, userId })` — `order` is a `BusinessOrder`-shaped object with at least `{ orderNo, amount }`, `kind` is `'NEW' | 'RENEWAL'`. Posts via `glPost.safePost(...)` and returns whatever it returns (a created `JournalEntry`, or `null` on failure — `safePost` never throws). Exported as `{ postSubscriptionPayment, getFinaraOpsBusinessId, FINARA_OPS_CODE }` from `server/utils/subscriptionGL.js`. Task 2's `orderAdminController.approve` imports `postSubscriptionPayment` from this module.

- [ ] **Step 1: Write the migration**

Create `prisma/migrations/20260930120000_add_finara_ops_business/migration.sql`:

```sql
-- ═══════════════════════════════════════════════════════════════
-- Migration: Finara Operations business (internal SaaS revenue book)
-- Subscription/renewal payments Finara collects from customers post here,
-- via server/utils/subscriptionGL.js — never into a customer's own business.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO `businesses` (`code`, `name`, `industry`, `isActive`, `createdAt`, `updatedAt`)
VALUES ('FINARA-OPS', 'Finara Operations', 'Internal', TRUE, NOW(), NOW());

SET @finara_ops_id = LAST_INSERT_ID();

INSERT INTO `accounts` (`businessId`, `accountCode`, `accountName`, `accountType`, `normalBalance`, `isActive`, `createdAt`, `updatedAt`)
VALUES
  (@finara_ops_id, '1010', 'Cash — Subscription Collections', 'ASSET',   'DEBIT',  TRUE, NOW(), NOW()),
  (@finara_ops_id, '4000', 'Subscription Revenue',            'REVENUE', 'CREDIT', TRUE, NOW(), NOW());
```

- [ ] **Step 2: Write the failing tests**

Create `tests/subscriptionGL.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  business: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const { postSubscriptionPayment, getFinaraOpsBusinessId, FINARA_OPS_CODE } = require('../server/utils/subscriptionGL');

const order = { id: 9, orderNo: 'ORD-AAAAAA', amount: 1105 };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.findFirst.mockResolvedValue({ id: 99 });
  glPost.safePost.mockResolvedValue({ id: 1 });
});

// This must be the FIRST test in the file: getFinaraOpsBusinessId caches its
// result in a module-level variable inside subscriptionGL.js — shared state
// across every test in this file, since Jest requires the module once for
// the whole file — so asserting "exactly one query" only means something
// before any other test has already populated that cache.
test('getFinaraOpsBusinessId resolves by code once, then caches it', async () => {
  const first = await getFinaraOpsBusinessId();
  const second = await getFinaraOpsBusinessId();
  expect(first).toBe(99);
  expect(second).toBe(99);
  expect(prisma.business.findFirst).toHaveBeenCalledTimes(1);
  expect(prisma.business.findFirst).toHaveBeenCalledWith({ where: { code: FINARA_OPS_CODE }, select: { id: true } });
});

describe('postSubscriptionPayment', () => {
  test('posts a balanced two-line entry for a new-business approval', async () => {
    await postSubscriptionPayment({ order, companyName: 'Acme', kind: 'NEW', userId: 1 });

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Subscription — New: Acme (ORD-AAAAAA)',
      reference: 'ORD-AAAAAA',
      businessId: 99,
      userId: 1,
      lines: [
        { accountCode: '1010', debit: 1105, description: 'Payment received — ORD-AAAAAA' },
        { accountCode: '4000', credit: 1105, description: 'Subscription revenue — Acme' },
      ],
    }));
  });

  test('labels the description "Renewal" for a renewal approval', async () => {
    await postSubscriptionPayment({ order, companyName: 'Acme', kind: 'RENEWAL', userId: 1 });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Subscription — Renewal: Acme (ORD-AAAAAA)',
    }));
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -- tests/subscriptionGL.test.js`
Expected: FAIL — `Cannot find module '../server/utils/subscriptionGL'`.

- [ ] **Step 4: Implement `subscriptionGL.js`**

Create `server/utils/subscriptionGL.js`:

```javascript
// Posts Finara's own subscription/renewal payment as a journal entry in a
// dedicated internal business's books ("Finara Operations") — never in the
// paying customer's own business, which never sees this income; it's
// Finara's, not theirs. See
// docs/superpowers/specs/2026-09-30-subscription-gl-posting-design.md.
const prisma = require('../config/database');
const glPost = require('./glPost');

const FINARA_OPS_CODE = 'FINARA-OPS';
const CASH_ACCOUNT_CODE = '1010';
const REVENUE_ACCOUNT_CODE = '4000';

// Cached like glPost.js's own _bizCache — resolved once per process, not
// hardcoded, since the id differs across environments/seed order.
let _finaraOpsBusinessId = null;

async function getFinaraOpsBusinessId() {
  if (_finaraOpsBusinessId) return _finaraOpsBusinessId;
  const biz = await prisma.business.findFirst({ where: { code: FINARA_OPS_CODE }, select: { id: true } });
  if (!biz) throw new Error(`GL: "${FINARA_OPS_CODE}" business not found — subscription revenue cannot be posted`);
  _finaraOpsBusinessId = biz.id;
  return _finaraOpsBusinessId;
}

// kind: 'NEW' | 'RENEWAL'
async function postSubscriptionPayment({ order, companyName, kind, userId }) {
  const businessId = await getFinaraOpsBusinessId();
  const label = kind === 'RENEWAL' ? 'Renewal' : 'New';
  return glPost.safePost({
    entryDate: new Date(),
    description: `Subscription — ${label}: ${companyName} (${order.orderNo})`,
    reference: order.orderNo,
    lines: [
      { accountCode: CASH_ACCOUNT_CODE, debit: Number(order.amount), description: `Payment received — ${order.orderNo}` },
      { accountCode: REVENUE_ACCOUNT_CODE, credit: Number(order.amount), description: `Subscription revenue — ${companyName}` },
    ],
    userId,
    businessId,
  });
}

module.exports = { postSubscriptionPayment, getFinaraOpsBusinessId, FINARA_OPS_CODE };
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npm test -- tests/subscriptionGL.test.js`
Expected: PASS — all 3 tests green.

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations/20260930120000_add_finara_ops_business/migration.sql server/utils/subscriptionGL.js tests/subscriptionGL.test.js
git commit -m "feat(gl): add Finara Operations business + subscriptionGL posting util

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Wire GL posting into `approve()`

**Files:**
- Modify: `server/controllers/orderAdminController.js`
- Test: `tests/orderAdminController.test.js`

**Interfaces:**
- Consumes: `postSubscriptionPayment({ order, companyName, kind, userId })` from `../utils/subscriptionGL` (Task 1).
- Produces: no change to `approve`'s existing response shape or external behavior beyond the new GL side-effect — since `postSubscriptionPayment` uses `safePost` internally (never throws), no new error handling is needed at the call site.

- [ ] **Step 1: Write the failing tests**

In `tests/orderAdminController.test.js`, add a mock for the new module near the top of the file, alongside the existing mocks:

```javascript
jest.mock('../server/utils/subscriptionGL', () => ({ postSubscriptionPayment: jest.fn() }));
```

Add the import alongside the existing ones:

```javascript
const { postSubscriptionPayment } = require('../server/utils/subscriptionGL');
```

Then add a new test inside the existing `describe('approve', ...)` block (the new-business tests), after the first ('claims only a PROOF_SUBMITTED order...') test:

```javascript
  test('posts a NEW subscription GL entry after successfully creating the business', async () => {
    await call(ctrl.approve, { params: { id: '9' } });
    expect(postSubscriptionPayment).toHaveBeenCalledWith({
      order: expect.objectContaining({ id: 9, orderNo: 'ORD-AAAAAA' }),
      companyName: 'Acme',
      kind: 'NEW',
      userId: 1,
    });
  });
```

And add a new test inside the existing `describe('approve (renewal orders)', ...)` block, after its existing tests:

```javascript
  test('posts a RENEWAL subscription GL entry after extending paidUntil', async () => {
    prisma.businessOrder.findUnique.mockResolvedValue(renewalOrder);
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'Acme', paidUntil: null });

    await call(ctrl.approve, { params: { id: '9' } });

    expect(postSubscriptionPayment).toHaveBeenCalledWith({
      order: expect.objectContaining({ id: 9, orderNo: 'ORD-BBBBBB', businessId: 3 }),
      companyName: 'Acme',
      kind: 'RENEWAL',
      userId: 1,
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: FAIL — `postSubscriptionPayment` was not called (the controller doesn't call it yet).

- [ ] **Step 3: Wire the call into `approve`**

In `server/controllers/orderAdminController.js`, add the import alongside the existing ones at the top:

```javascript
const { postSubscriptionPayment } = require('../utils/subscriptionGL');
```

Replace the renewal branch's early return:

```javascript
    if (order.businessId) {
      await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: order.businessId, summary: `Approved ${order.orderNo}; extended "${biz.name}" to ${newPaidUntil.toISOString().slice(0, 10)}` });
      return res.json({ message: `Approved — extended to ${newPaidUntil.toISOString().slice(0, 10)}`, businessId: order.businessId });
    }
```

with:

```javascript
    if (order.businessId) {
      await postSubscriptionPayment({ order, companyName: biz.name, kind: 'RENEWAL', userId: req.user.id });
      await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: order.businessId, summary: `Approved ${order.orderNo}; extended "${biz.name}" to ${newPaidUntil.toISOString().slice(0, 10)}` });
      return res.json({ message: `Approved — extended to ${newPaidUntil.toISOString().slice(0, 10)}`, businessId: order.businessId });
    }
```

Replace the new-business branch's tail:

```javascript
    try {
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
    } catch (linkErr) {
      logger.error(`Business order ${order.orderNo} (id ${id}) is APPROVED but linking business ${biz.id} failed: ${linkErr.message}`);
    }
    await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: biz.id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
    res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
```

with:

```javascript
    try {
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
    } catch (linkErr) {
      logger.error(`Business order ${order.orderNo} (id ${id}) is APPROVED but linking business ${biz.id} failed: ${linkErr.message}`);
    }
    await postSubscriptionPayment({ order, companyName: biz.name, kind: 'NEW', userId: req.user.id });
    await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: biz.id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
    res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: PASS — both new tests green, plus every pre-existing test in the file (including all `describe('approve', ...)` and `describe('approve (renewal orders)', ...)` tests) still passing unchanged.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/orderAdminController.js tests/orderAdminController.test.js
git commit -m "feat(gl): post subscription payment to GL on order approval

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** dedicated `FINARA-OPS` business + minimal 2-account COA via migration (Task 1) ✓; no VAT line (Task 1, no VAT account/line anywhere) ✓; both order types post to the same `4000` account, distinguished by description only (Task 1's `postSubscriptionPayment` label logic; Task 2 passes `kind` for both branches) ✓; `safePost` used, never `post` (Task 1) ✓; no retroactive backfill (Task 2 only touches the approval path going forward, no data migration for existing orders) ✓; no new UI (no frontend files touched) ✓.
- **Type/name consistency:** `postSubscriptionPayment`'s signature (`{ order, companyName, kind, userId }`, Task 1) matches exactly how Task 2 calls it in both branches; `FINARA_OPS_CODE` matches the migration's `code` value (`'FINARA-OPS'`) exactly; account codes `1010`/`4000` match between the migration (Task 1, Step 1) and `subscriptionGL.js` (Task 1, Step 4).
- **Task 2 preserves existing behavior exactly:** the replacement blocks in `approve()` are the existing code plus exactly one new line each (`await postSubscriptionPayment(...)`) — no other logic changed, so every pre-existing test in both `describe` blocks keeps passing unchanged (verified by Task 2's Step 4 explicitly requiring it).
