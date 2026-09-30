# Business Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a business's own users (or `ADMIN`/`SUPER_ADMIN`, for any business) pay to extend that business's `paidUntil` from the My Businesses page, reusing the same manual payment-proof review flow as a new-business order.

**Architecture:** Two new user-facing routes (`GET`/`POST /orders/renew/:businessId`) create and quote a `BusinessOrder` that is pre-linked to an existing business (`businessId` set at creation, not just approval, unlike a new-business order). `orderAdminController.approve` gains one branch: if the approved order already has `businessId` set, extend that business's `paidUntil` instead of provisioning a new one. A new shared `assertBusinessAccess` helper (extracted from `businessController.get`) gates all of it. The frontend adds a "Renew" button and a new modal, reusing the existing payment-step pattern.

**Tech Stack:** Next.js 14 (App Router) + Express.js + Prisma 5, Jest for backend tests, lucide-react icons, react-hot-toast.

## Global Constraints
- `ADMIN`/`SUPER_ADMIN` can renew *any* business, not just ones they're granted to — reuse the exact same access rule the rest of the app already uses (`businessController.get`'s check), do not special-case renewal to be stricter. (Spec: "Decisions")
- Company type for pricing always comes from the business's own order history (`BusinessOrder.companyType`), never re-typed or trusted from the client. (Spec: "Decisions", "Backend")
- A renewal order's company snapshot fields (`companyName`, `tin`, `address`, `phone`, `taxType`) come from the **current** `Business` row, not the original creating order. (Spec: "Decisions")
- One open renewal order per business at a time — 409 on a second one while one is `PENDING_PAYMENT`/`PROOF_SUBMITTED`. (Spec: "Decisions")
- Extension stacks from the business's current `paidUntil` if still in the future, else from today — via the existing `computePaidUntil(from, period)` helper. (Spec: "Decisions")
- No Prisma schema changes. (Spec: "Backend")
- No frontend automated test suite exists in this repo — frontend tasks are verified via `npm run build:prod` (never plain `npm run build` while `npm run dev` may be running — see this repo's memory note on the dev/build cache collision).

---

## File Structure

| File | Responsibility |
|---|---|
| `server/utils/businessAccess.js` | New shared `assertBusinessAccess(user, businessId)` helper (create) |
| `server/controllers/businessController.js` | `get` delegates to the new helper instead of its inline check (modify) |
| `tests/businessAccess.test.js` | Unit tests for the new helper (create) |
| `server/controllers/orderController.js` | Add `renewQuote` and `renew` (modify) |
| `server/routes/orders.js` | Register the two new routes (modify) |
| `tests/orderController.test.js` | Tests for `renewQuote`/`renew` (modify) |
| `server/controllers/orderAdminController.js` | `approve` branches on `order.businessId` (modify) |
| `tests/orderAdminController.test.js` | Tests for the renewal branch (modify) |
| `lib/api.js` | Add `orders.renewQuote`/`orders.renew` (modify) |
| `components/orders/RenewBusinessModal.jsx` | New renewal modal (create) |
| `app/(dashboard)/my-businesses/page.jsx` | Combined "Actions" column with Renew (+ existing View); wire the modal (modify) |

---

## Task 1: Shared business-access helper

**Files:**
- Create: `server/utils/businessAccess.js`
- Modify: `server/controllers/businessController.js`
- Test: `tests/businessAccess.test.js`

**Interfaces:**
- Produces: `async function assertBusinessAccess(user, businessId)` — resolves (returns `undefined`) if `user.role` is `ADMIN`/`SUPER_ADMIN`, or if a `UserBusiness` row exists for `{ userId: user.id, businessId }`; otherwise throws `createError('Access denied to this business', 403)`. Exported as `{ assertBusinessAccess }` from `server/utils/businessAccess.js`. Task 2 and Task 3's consumers (`orderController.renewQuote`/`renew`) import this from `../utils/businessAccess`.

- [ ] **Step 1: Write the failing test**

Create `tests/businessAccess.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  userBusiness: { findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const { assertBusinessAccess } = require('../server/utils/businessAccess');

beforeEach(() => jest.clearAllMocks());

describe('assertBusinessAccess', () => {
  test('ADMIN bypasses the grant check', async () => {
    await expect(assertBusinessAccess({ id: 1, role: 'ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('SUPER_ADMIN bypasses the grant check', async () => {
    await expect(assertBusinessAccess({ id: 1, role: 'SUPER_ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('a non-admin with a matching grant passes', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 7, businessId: 5 });
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: 7, businessId: 5 } },
    });
  });

  test('a non-admin with no grant is denied', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).rejects.toMatchObject({ statusCode: 403 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- tests/businessAccess.test.js`
Expected: FAIL — `Cannot find module '../server/utils/businessAccess'`.

- [ ] **Step 3: Create the helper**

Create `server/utils/businessAccess.js`:

```javascript
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// Shared by every endpoint that reads or acts on a single business by id.
// ADMIN/SUPER_ADMIN can act on any business; anyone else needs an explicit
// UserBusiness grant. Extracted from businessController.get, which had this
// check duplicated inline.
async function assertBusinessAccess(user, businessId) {
  if (['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return;
  const ub = await prisma.userBusiness.findUnique({
    where: { userId_businessId: { userId: user.id, businessId } },
  });
  if (!ub) throw createError('Access denied to this business', 403);
}

module.exports = { assertBusinessAccess };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- tests/businessAccess.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Point `businessController.get` at the new helper**

In `server/controllers/businessController.js`, add the import alongside the existing ones at the top of the file:

```javascript
const { assertBusinessAccess } = require('../utils/businessAccess');
```

Replace the `get` export's inline check:

```javascript
// ─── Get one ─────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);

    // Non-admins may only fetch a business they've been granted access to —
    // same restriction list() already applies. Without this, any authenticated
    // user could read another business's profile (name, TIN, address, contact
    // info) just by guessing its id.
    if (!['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
      const ub = await prisma.userBusiness.findUnique({
        where: { userId_businessId: { userId: req.user.id, businessId: id } },
      });
      if (!ub) throw createError('Access denied to this business', 403);
    }

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    res.json(biz);
  } catch (err) { next(err); }
};
```

with:

```javascript
// ─── Get one ─────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await assertBusinessAccess(req.user, id);
    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    res.json(biz);
  } catch (err) { next(err); }
};
```

- [ ] **Step 6: Run the existing regression suite for `get`, plus the full suite**

Run: `npm test -- tests/businessGetAccessControl.test.js`
Expected: PASS — all 5 pre-existing tests still green, unchanged (they exercise the same `prisma.userBusiness.findUnique`/`prisma.business.findUnique` calls that now happen inside the helper).

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 7: Commit**

```bash
git add server/utils/businessAccess.js server/controllers/businessController.js tests/businessAccess.test.js
git commit -m "refactor(orders): extract shared assertBusinessAccess helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Renewal quote + create endpoints

**Files:**
- Modify: `server/controllers/orderController.js`
- Modify: `server/routes/orders.js`
- Test: `tests/orderController.test.js`

**Interfaces:**
- Consumes: `assertBusinessAccess(user, businessId)` from Task 1 (`../utils/businessAccess`); `PERIODS` from `../utils/orderPricing` (already imported in this file); `COMPANY_TYPES`/`TAX_TYPES` (already imported, unused by the new code — company type/tax type are never re-validated here since they come from existing, already-valid records, not user input).
- Produces: `exports.renewQuote(req, res, next)` — `req.params.businessId` (numeric, validated by the route guard), responds `{ companyType, prices, instructions }`. `exports.renew(req, res, next)` — `req.params.businessId`, `req.body.period`, responds `201` with the created order (same shape as `create`'s response: `{ id, orderNo, userId, businessId, companyName, tin, address, phone, companyType, taxType, booksStartDate, period, amount, status, ... }`). Task 4's `lib/api.js` calls these via `GET /orders/renew/:businessId` and `POST /orders/renew/:businessId`.

- [ ] **Step 1: Write the failing tests**

First extend the top-of-file prisma mock in `tests/orderController.test.js` to add `business` and `userBusiness` (needed because `assertBusinessAccess` is exercised through these controller calls too):

```javascript
jest.mock('../server/config/database', () => ({
  planPrice:          { findMany: jest.fn(), findUnique: jest.fn() },
  paymentInstruction: { findUnique: jest.fn() },
  businessOrder:      { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  business:           { findUnique: jest.fn() },
  userBusiness:       { findUnique: jest.fn() },
}));
```

Then add these two `describe` blocks at the end of the file (after `orderController.downloadProof`):

```javascript
describe('orderController.renewQuote', () => {
  beforeEach(() => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 7, businessId: 3 });
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'Acme' });
  });

  test('403s via the shared access check', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.renewQuote, { params: { businessId: '3' } })).rejects.toMatchObject({ statusCode: 403 });
  });

  test('ADMIN bypasses the grant check', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ companyType: 'SERVICES', status: 'APPROVED' });
    prisma.planPrice.findMany.mockResolvedValue([]);
    prisma.paymentInstruction.findUnique.mockResolvedValue(null);
    await call(ctrl.renewQuote, { user: { id: 1, role: 'ADMIN' }, params: { businessId: '3' } });
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
  });

  test('404s for an unknown business', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.renewQuote, { params: { businessId: '3' } })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('409s when the business has no order on record', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(null);
    await expect(call(ctrl.renewQuote, { params: { businessId: '3' } })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('resolves companyType from the latest order and returns its active prices', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ id: 9, companyType: 'SERVICES', status: 'APPROVED' });
    prisma.planPrice.findMany.mockResolvedValue([{ companyType: 'SERVICES', period: 'MONTHLY', amount: 1000 }]);
    prisma.paymentInstruction.findUnique.mockResolvedValue({ text: 'GCash', qrFileName: 'q.png' });

    const out = await call(ctrl.renewQuote, { params: { businessId: '3' } });

    expect(prisma.businessOrder.findFirst).toHaveBeenCalledWith({ where: { businessId: 3 }, orderBy: { createdAt: 'desc' } });
    expect(prisma.planPrice.findMany).toHaveBeenCalledWith({ where: { companyType: 'SERVICES', isActive: true } });
    expect(out).toEqual({
      companyType: 'SERVICES',
      prices: [{ companyType: 'SERVICES', period: 'MONTHLY', amount: 1000 }],
      instructions: { text: 'GCash', hasQr: true },
    });
  });
});

describe('orderController.renew', () => {
  const biz = { id: 3, name: 'Acme', tin: '123', address: 'Davao', phone: '0900', taxType: 'VAT' };

  beforeEach(() => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 7, businessId: 3 });
    prisma.business.findUnique.mockResolvedValue(biz);
  });

  test('403s via the shared access check', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('404s for an unknown business', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects an invalid period', async () => {
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'WEEKLY' } }))
      .rejects.toMatchObject({ statusCode: 400, message: 'Choose a billing period' });
    expect(prisma.businessOrder.create).not.toHaveBeenCalled();
  });

  test('409s when the business has no order on record', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue(null);
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  test('409s when a renewal is already open for this business', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ companyType: 'SERVICES', status: 'PROOF_SUBMITTED' });
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.businessOrder.create).not.toHaveBeenCalled();
  });

  test('400s when no active price exists for the resolved type and period', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ companyType: 'SERVICES', status: 'APPROVED' });
    prisma.planPrice.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('creates a PENDING_PAYMENT order pre-linked to the business, snapshotting current business fields', async () => {
    prisma.businessOrder.findFirst.mockResolvedValue({ companyType: 'SERVICES', status: 'APPROVED' });
    prisma.planPrice.findUnique.mockResolvedValue({ amount: 1000, isActive: true });

    const order = await call(ctrl.renew, { params: { businessId: '3' }, body: { period: 'MONTHLY' } });

    expect(prisma.planPrice.findUnique).toHaveBeenCalledWith({
      where: { companyType_period: { companyType: 'SERVICES', period: 'MONTHLY' } },
    });
    expect(order).toMatchObject({
      userId: 7, businessId: 3, companyName: 'Acme', tin: '123', address: 'Davao', phone: '0900',
      companyType: 'SERVICES', taxType: 'VAT', period: 'MONTHLY', amount: 1000, status: 'PENDING_PAYMENT',
    });
    expect(order.orderNo).toMatch(/^ORD-[0-9A-F]{6}$/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/orderController.test.js`
Expected: FAIL — `ctrl.renewQuote is not a function` / `ctrl.renew is not a function`.

- [ ] **Step 3: Implement `renewQuote` and `renew`**

Add to `server/controllers/orderController.js`. First add the import alongside the existing ones at the top of the file:

```javascript
const { assertBusinessAccess } = require('../utils/businessAccess');
```

Then add these two exports at the end of the file (after `downloadProof`):

```javascript
// ─── Renewal ─────────────────────────────────────────────────────
// Business.industry only stores the display label ("School"), never the
// plan-pricing key (e.g. "SERVICES") — but every business that has ever been
// approved through the order flow has a BusinessOrder with that exact key on
// it. Reusing the most recent one also doubles as the "is a renewal already
// open?" check: the one-open-renewal-at-a-time rule (enforced in `renew`
// below) guarantees that if an open order exists for this business, it IS
// the most recent one.
exports.renewQuote = async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    await assertBusinessAccess(req.user, businessId);
    const biz = await prisma.business.findUnique({ where: { id: businessId } });
    if (!biz) throw createError('Business not found', 404);

    const last = await prisma.businessOrder.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) throw createError('This business has no order on record; it cannot be renewed here', 409);

    const [prices, ins] = await Promise.all([
      prisma.planPrice.findMany({ where: { companyType: last.companyType, isActive: true } }),
      prisma.paymentInstruction.findUnique({ where: { id: 1 } }),
    ]);
    res.json({ companyType: last.companyType, prices, instructions: { text: ins?.text || '', hasQr: !!ins?.qrFileName } });
  } catch (err) { next(err); }
};

exports.renew = async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    await assertBusinessAccess(req.user, businessId);
    const biz = await prisma.business.findUnique({ where: { id: businessId } });
    if (!biz) throw createError('Business not found', 404);

    const { period } = req.body;
    if (!PERIODS.includes(period)) throw createError('Choose a billing period', 400);

    const last = await prisma.businessOrder.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) throw createError('This business has no order on record; it cannot be renewed here', 409);
    if (OPEN.includes(last.status)) throw createError('This business already has a renewal payment awaiting review', 409);

    const price = await prisma.planPrice.findUnique({
      where: { companyType_period: { companyType: last.companyType, period } },
    });
    if (!price || !price.isActive) {
      throw createError('This plan is not available yet. Please contact the administrator.', 400);
    }

    const order = await prisma.businessOrder.create({
      data: {
        orderNo: `ORD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        userId: req.user.id,
        businessId,
        companyName: biz.name, tin: biz.tin, address: biz.address, phone: biz.phone,
        companyType: last.companyType, taxType: biz.taxType,
        period, amount: price.amount,
        status: 'PENDING_PAYMENT',
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'BusinessOrder', entityId: order.id, businessId, summary: `Renewal order for "${biz.name}" (${order.orderNo})` });
    res.status(201).json(order);
  } catch (err) { next(err); }
};
```

Note: `OPEN` is already defined near the top of this file (`const OPEN = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];`) — reuse it, don't redefine it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/orderController.test.js`
Expected: PASS — all new tests green, plus every pre-existing test in the file still passing.

- [ ] **Step 5: Register the two routes**

In `server/routes/orders.js`, add the two new user-facing routes among the existing non-admin ones (the `businessId` param guard already exists from a prior plan — reuse it, don't redefine it):

```javascript
router.get('/plans',            user.plans);
router.get('/payment-qr',       user.paymentQr);
router.get('/',                 user.list);
router.post('/',                user.create);
router.get('/renew/:businessId',  user.renewQuote);
router.post('/renew/:businessId', user.renew);
router.post('/:id/proof',       uploadMiddleware, user.submitProof);
router.post('/:id/cancel',      user.cancel);
router.get('/:id/proof',        user.downloadProof);
```

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/orderController.js server/routes/orders.js tests/orderController.test.js
git commit -m "feat(orders): add business renewal quote and create endpoints

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Approval branches for renewal orders

**Files:**
- Modify: `server/controllers/orderAdminController.js`
- Test: `tests/orderAdminController.test.js`

**Interfaces:**
- Consumes: `computePaidUntil` from `../utils/orderPricing` (already imported in this file). No new imports needed.
- Produces: `approve`'s existing external behavior (response shape `{ message, businessId }`, `recordAudit` call) is unchanged for a new-business order (`order.businessId` falsy going in); for a renewal order (`order.businessId` already set), it now extends that business's `paidUntil` instead of calling `createProvisionedBusiness`.

- [ ] **Step 1: Write the failing tests**

First extend the top-of-file prisma mock in `tests/orderAdminController.test.js` — it already has a `business: { findUnique: jest.fn() }` entry from a prior task; add `update`:

```javascript
jest.mock('../server/config/database', () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  planPrice:          { findMany: jest.fn(), upsert: jest.fn() },
  paymentInstruction: { findUnique: jest.fn(), upsert: jest.fn() },
  businessOrder:      { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  business:           { findUnique: jest.fn(), update: jest.fn() },
}));
```

Then add this `describe` block after the existing `describe('approve', ...)` block:

```javascript
describe('approve (renewal orders)', () => {
  const renewalOrder = {
    id: 9, orderNo: 'ORD-BBBBBB', userId: 7, businessId: 3, period: 'MONTHLY',
    user: { id: 7, email: 'u@example.com' },
  };

  test('extends paidUntil from the business\'s current value when still in the future', async () => {
    prisma.businessOrder.findUnique.mockResolvedValue(renewalOrder);
    const future = new Date(Date.now() + 10 * 864e5); // 10 days out
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'Acme', paidUntil: future });

    const out = await call(ctrl.approve, { params: { id: '9' } });

    expect(prisma.business.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
    const newPaidUntil = prisma.business.update.mock.calls[0][0].data.paidUntil;
    expect(newPaidUntil.getTime()).toBeGreaterThan(future.getTime());
    expect(createProvisionedBusiness).not.toHaveBeenCalled();
    expect(prisma.businessOrder.update).not.toHaveBeenCalled(); // no businessId link needed, it's already set
    expect(out).toMatchObject({ businessId: 3 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE', businessId: 3 }));
  });

  test('extends from today when paidUntil already lapsed', async () => {
    prisma.businessOrder.findUnique.mockResolvedValue(renewalOrder);
    const past = new Date(Date.now() - 10 * 864e5);
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'Acme', paidUntil: past });

    await call(ctrl.approve, { params: { id: '9' } });

    const newPaidUntil = prisma.business.update.mock.calls[0][0].data.paidUntil;
    // ~1 month out from TODAY, not from the lapsed date — i.e. well past "10 days ago + 1 month"
    expect(newPaidUntil.getTime()).toBeGreaterThan(Date.now() + 25 * 864e5);
  });

  test('if extending paidUntil fails, the claim is reverted and the error surfaces', async () => {
    prisma.businessOrder.findUnique.mockResolvedValue(renewalOrder);
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'Acme', paidUntil: null });
    prisma.business.update.mockRejectedValue(new Error('db down'));

    await expect(call(ctrl.approve, { params: { id: '9' } })).rejects.toThrow('db down');
    expect(prisma.businessOrder.updateMany).toHaveBeenLastCalledWith({
      where: { id: 9 },
      data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: FAIL — the renewal-order tests fail because `approve` still always calls `createProvisionedBusiness` (e.g. `createProvisionedBusiness` gets called when the test expects it not to, or `prisma.business.update` is never called).

- [ ] **Step 3: Branch `approve` on `order.businessId`**

Replace the current `exports.approve` in `server/controllers/orderAdminController.js`:

```javascript
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const claimed = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!claimed.count) throw createError('This order is not awaiting approval', 409);

    let order, biz;
    try {
      order = await prisma.businessOrder.findUnique({ where: { id }, include: { user: true } });
      biz = await createProvisionedBusiness({
        name: order.companyName, tin: order.tin, address: order.address, phone: order.phone,
        email: order.user.email,
        companyType: order.companyType, taxType: order.taxType, booksStartDate: order.booksStartDate,
        ownerUserId: order.userId,
        paidUntil: computePaidUntil(new Date(), order.period),
      });
    } catch (err) {
      try {
        await prisma.businessOrder.updateMany({
          where: { id },
          data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
        });
      } catch (revertErr) {
        logger.error(`Failed to revert claim on business order ${id}: ${revertErr.message}`);
      }
      throw err;
    }

    try {
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
    } catch (linkErr) {
      logger.error(`Business order ${order.orderNo} (id ${id}) is APPROVED but linking business ${biz.id} failed: ${linkErr.message}`);
    }
    await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: biz.id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
    res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
  } catch (err) { next(err); }
};
```

with:

```javascript
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const claimed = await prisma.businessOrder.updateMany({
      where: { id, status: 'PROOF_SUBMITTED' },
      data: { status: 'APPROVED', reviewedById: req.user.id, reviewedAt: new Date() },
    });
    if (!claimed.count) throw createError('This order is not awaiting approval', 409);

    let order, biz, newPaidUntil;
    try {
      order = await prisma.businessOrder.findUnique({ where: { id }, include: { user: true } });

      if (order.businessId) {
        // Renewal — the business already exists; extend it instead of
        // provisioning a new one. Stack on top of a still-active paidUntil;
        // start fresh from today if it already lapsed.
        biz = await prisma.business.findUnique({ where: { id: order.businessId } });
        const from = biz.paidUntil && biz.paidUntil > new Date() ? biz.paidUntil : new Date();
        newPaidUntil = computePaidUntil(from, order.period);
        await prisma.business.update({ where: { id: order.businessId }, data: { paidUntil: newPaidUntil } });
      } else {
        biz = await createProvisionedBusiness({
          name: order.companyName, tin: order.tin, address: order.address, phone: order.phone,
          email: order.user.email,
          companyType: order.companyType, taxType: order.taxType, booksStartDate: order.booksStartDate,
          ownerUserId: order.userId,
          paidUntil: computePaidUntil(new Date(), order.period),
        });
      }
    } catch (err) {
      try {
        await prisma.businessOrder.updateMany({
          where: { id },
          data: { status: 'PROOF_SUBMITTED', reviewedById: null, reviewedAt: null },
        });
      } catch (revertErr) {
        logger.error(`Failed to revert claim on business order ${id}: ${revertErr.message}`);
      }
      throw err;
    }

    if (order.businessId) {
      await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: order.businessId, summary: `Approved ${order.orderNo}; extended "${biz.name}" to ${newPaidUntil.toISOString().slice(0, 10)}` });
      return res.json({ message: `Approved — extended to ${newPaidUntil.toISOString().slice(0, 10)}`, businessId: order.businessId });
    }

    try {
      await prisma.businessOrder.update({ where: { id }, data: { businessId: biz.id } });
    } catch (linkErr) {
      logger.error(`Business order ${order.orderNo} (id ${id}) is APPROVED but linking business ${biz.id} failed: ${linkErr.message}`);
    }
    await recordAudit({ req, action: 'APPROVE', entity: 'BusinessOrder', entityId: id, businessId: biz.id, summary: `Approved ${order.orderNo}; created business "${biz.name}"` });
    res.json({ message: `Approved — ${biz.name} created`, businessId: biz.id });
  } catch (err) { next(err); }
};
```

This preserves every existing new-business code path byte-for-byte (the pre-existing tests' `order` fixture has no `businessId` field, so `order.businessId` is `undefined` there and always takes the `else`/bottom path, exactly as before).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: PASS — all new renewal tests green, plus every pre-existing test in the file (including all 5 existing `describe('approve', ...)` tests) still passing unchanged.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/orderAdminController.js tests/orderAdminController.test.js
git commit -m "feat(orders): extend paidUntil on approving a renewal order

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Renew button + modal

**Files:**
- Modify: `lib/api.js`
- Create: `components/orders/RenewBusinessModal.jsx`
- Modify: `app/(dashboard)/my-businesses/page.jsx`

**Interfaces:**
- Consumes: `orders.renewQuote(businessId)` / `orders.renew(businessId, period)` (this task adds them to `lib/api.js`, then the modal consumes them); `ordersApi.qrBlob()`/`ordersApi.submitProof(id, {referenceNo, file})` (existing, already used by `AddBusinessModal`); `formatCurrency`/`formatDate` from `@/lib/auth` (existing).
- Produces: `export default function RenewBusinessModal({ business, onClose, onDone })` where `business` is `{ id, name, paidUntil }`.

- [ ] **Step 1: Add the API client methods**

In `lib/api.js`, inside the `orders` object, add the two new methods right after `qrBlob` and before `admin: {`:

```javascript
  qrBlob:      ()           => api.get('/orders/payment-qr', { responseType: 'blob' }),
  renewQuote:  (businessId)         => api.get(`/orders/renew/${businessId}`),
  renew:       (businessId, period) => api.post(`/orders/renew/${businessId}`, { period }),
  admin: {
```

- [ ] **Step 2: Create the renewal modal**

Create `components/orders/RenewBusinessModal.jsx`:

```javascript
'use client';
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';

const PERIODS = [{ key: 'MONTHLY', label: 'Monthly' }, { key: 'YEARLY', label: 'Yearly' }];

// Pay to extend `business`'s paidUntil. Two steps: pick a period (Step 1),
// then submit payment proof for the renewal order it creates (Step 2). Step 2
// mirrors AddBusinessModal's payment step; kept as its own component rather
// than a shared one since Step 1 has nothing in common with creating a new
// company (no company-details form — the business already exists).
export default function RenewBusinessModal({ business, onClose, onDone }) {
  const [quote, setQuote]     = useState(null);   // { companyType, prices, instructions }
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('MONTHLY');
  const [order, setOrder]     = useState(null);
  const [busy, setBusy]       = useState(false);
  const [qrUrl, setQrUrl]     = useState(null);
  const [referenceNo, setRef] = useState('');
  const [file, setFile]       = useState(null);

  useEffect(() => {
    ordersApi.renewQuote(business.id)
      .then(({ data }) => setQuote(data))
      .catch((err) => { toast.error(err.response?.data?.error || 'Could not load renewal pricing'); onClose(); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  // Show the QR only once we are on the payment step.
  useEffect(() => {
    if (!order || !quote?.instructions.hasQr) return undefined;
    let url;
    ordersApi.qrBlob().then(({ data }) => { url = URL.createObjectURL(data); setQrUrl(url); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [order, quote]);

  const price = quote?.prices.find((p) => p.period === period);

  const submitOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data } = await ordersApi.renew(business.id, period);
      setOrder(data);
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not place the renewal order');
    } finally { setBusy(false); }
  };

  const submitProof = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await ordersApi.submitProof(order.id, { referenceNo, file });
      toast.success('Payment submitted — we will review it shortly');
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not submit payment');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {order ? `Pay for ${order.orderNo}` : `Renew ${business.name}`}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : !order ? (
          <form onSubmit={submitOrder} className="px-6 py-5 space-y-4">
            <p className="text-sm text-gray-500">
              Currently paid until <strong>{business.paidUntil ? formatDate(business.paidUntil) : '—'}</strong>.
            </p>
            <div>
              <label className="label">Billing period *</label>
              <div className="grid grid-cols-2 gap-2">
                {PERIODS.map((p) => (
                  <label key={p.key} className={`border rounded-lg p-3 cursor-pointer text-sm text-center ${period === p.key ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <input type="radio" name="period" className="sr-only" checked={period === p.key} onChange={() => setPeriod(p.key)} />
                    <span className="font-semibold">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-sm">
              {price
                ? <>Amount to pay: <strong>{formatCurrency(price.amount)}</strong></>
                : <span className="text-red-600">This plan is not available yet. Please contact the administrator.</span>}
            </div>

            <button type="submit" disabled={busy || !price} className="btn-primary w-full justify-center flex items-center gap-2">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Continue to payment
            </button>
          </form>
        ) : (
          <form onSubmit={submitProof} className="px-6 py-5 space-y-4">
            <p className="text-sm">
              Pay <strong>{formatCurrency(order.amount)}</strong> to renew <strong>{order.companyName}</strong>, then submit your
              reference number or proof.
            </p>
            {quote.instructions.text
              ? <pre className="whitespace-pre-wrap text-sm rounded-lg bg-gray-50 dark:bg-gray-800 p-3 font-sans">{quote.instructions.text}</pre>
              : <p className="text-sm text-gray-500">Payment instructions have not been set up yet. Please contact the administrator.</p>}
            {qrUrl && <img src={qrUrl} alt="Payment QR" className="mx-auto max-h-56 rounded-lg border" />}

            <div><label className="label">Reference number</label><input className="input" value={referenceNo} onChange={(e) => setRef(e.target.value)} placeholder="e.g. GCash ref no." /></div>
            <div>
              <label className="label">Proof of payment (JPG, PNG, WEBP or PDF, max 5 MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>

            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 justify-center" onClick={onClose}>Pay later</button>
              <button type="submit" disabled={busy || (!referenceNo.trim() && !file)} className="btn-primary flex-1 justify-center flex items-center gap-2">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Submit payment
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the "Renew" button into My Businesses**

In `app/(dashboard)/my-businesses/page.jsx`, add the import alongside the existing ones:

```javascript
import RenewBusinessModal from '@/components/orders/RenewBusinessModal';
```

Add state next to the existing `viewBizId` state:

```javascript
  const [renewBiz, setRenewBiz] = useState(null);   // business object or null
```

Add a derived set of business ids that have one of the *current user's own* open renewal orders (a convenience-only hint — the real enforcement is the backend's 409), computed from the page's already-loaded `orders` state:

```javascript
  const openRenewalBizIds = new Set(
    orders.filter((o) => o.businessId && ['PENDING_PAYMENT', 'PROOF_SUBMITTED'].includes(o.status)).map((o) => o.businessId)
  );
```

Replace the Businesses table's header and body (the `isSuperAdmin`-only Actions column becomes an always-present one):

```javascript
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Name</th><th className="py-2">Type</th><th className="py-2">Code</th><th className="py-2">Paid until</th>
                  <th className="py-2">Actions</th>
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {list.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{b.name}</td>
                      <td className="py-2.5">{b.industry || '—'}</td>
                      <td className="py-2.5 font-mono text-xs">{b.code}</td>
                      <td className="py-2.5">{b.paidUntil ? formatDate(b.paidUntil) : '—'}</td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {b.paidUntil && !openRenewalBizIds.has(b.id) && (
                          <button className="btn-secondary mr-2" onClick={() => setRenewBiz(b)}>Renew</button>
                        )}
                        {isSuperAdmin && (
                          <button className="btn-secondary inline-flex items-center gap-1" onClick={() => setViewBizId(b.id)}>
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
```

Render the modal at the bottom of the component's JSX, alongside the existing modals:

```javascript
      {viewBizId && (
        <BusinessDetailModal businessId={viewBizId} onClose={() => setViewBizId(null)} />
      )}
      {renewBiz && (
        <RenewBusinessModal business={renewBiz} onClose={() => setRenewBiz(null)} onDone={load} />
      )}
```

- [ ] **Step 4: Verify the frontend still compiles**

Run: `npm run build:prod`
Expected: build succeeds with no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
1. As a user with access to a business that has `paidUntil` set, go to My Businesses, click "Renew", pick a period, confirm the price shows, submit, then submit a reference number — confirm a new order appears in the Orders table below as "Awaiting payment"/"Under review".
2. As `SUPER_ADMIN`, approve that order from Business Orders admin — confirm the success toast, then reload My Businesses and confirm that business's "Paid until" date moved forward by the chosen period from its old value (not from today).
3. Confirm the "Renew" button disappears for that business while its renewal order is open, and reappears (for a fresh renewal) once it's approved.
4. Confirm a legacy business with no `paidUntil` (e.g. the seeded default business) shows no "Renew" button at all.

- [ ] **Step 6: Commit**

```bash
git add lib/api.js components/orders/RenewBusinessModal.jsx "app/(dashboard)/my-businesses/page.jsx"
git commit -m "feat(orders): add business renewal (Renew button + payment modal)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** shared access helper with `ADMIN`/`SUPER_ADMIN` bypass (Task 1) ✓; renewal quote/create endpoints with company-type resolution from order history, current-business snapshot, single-query open-order check (Task 2) ✓; approval branching that extends `paidUntil` with the stack-or-reset-from-today rule (Task 3) ✓; Renew button + modal + combined Actions column + convenience-only open-renewal hiding (Task 4) ✓; no schema changes anywhere ✓.
- **Type/name consistency:** `assertBusinessAccess` (Task 1) imported identically in `orderController.js` (Task 2); `orders.renewQuote`/`orders.renew` (Task 4, `lib/api.js`) match the route paths registered in Task 2 exactly; `RenewBusinessModal`'s `business` prop shape (`{ id, name, paidUntil }`) matches what `my-businesses/page.jsx` passes (the full `b` row from `businesses.list()`, which is a superset — the modal only reads the three fields it needs).
- **Task 3 preserves existing behavior exactly:** every pre-existing `approve` test's `order` fixture has no `businessId` field, so `order.businessId` evaluates `undefined`/falsy and takes the unchanged new-business path — verified by inspection of the replacement code, and asserted by Task 3's Step 4 (existing tests must still pass unchanged).
