# Business Detail View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "View" action on the My Businesses page (SUPER_ADMIN only) that opens a modal showing a business's full profile, who ordered/created it, and its order/payment history.

**Architecture:** One new read-only backend endpoint (`GET /api/orders/admin/business/:businessId`, gated by the existing `superOnly` middleware) returns `{ business, orders }` in a single call. The frontend adds a role-gated "Actions" column to the existing My Businesses table and a new self-contained modal component that fetches and renders that payload, reusing existing formatting helpers and the existing proof-download endpoint.

**Tech Stack:** Next.js 14 (App Router) + Express.js + Prisma 5, Jest for backend tests, lucide-react icons, react-hot-toast.

## Global Constraints
- Endpoint is `SUPER_ADMIN`-only — reuse the existing `superOnly` middleware in `server/routes/orders.js`, do not invent a new role check. (Spec: "Decisions")
- The "Actions" column with the View button must be omitted entirely (not disabled) for non-`SUPER_ADMIN` users. (Spec: "Frontend")
- No Prisma schema changes — `Business` and `BusinessOrder` already carry everything needed. (Spec: "Backend")
- Reuse existing helpers instead of duplicating: `formatCurrency`/`formatDate` from `lib/auth.js`, `ordersApi.proofBlob` for viewing payment proof, and the modal chrome pattern already used by `components/orders/AddBusinessModal.jsx`.
- The shared order-status label/class map currently inline in `app/(dashboard)/my-businesses/page.jsx` moves to `lib/orderStatus.js` so both the page and the new modal import the same constant (no duplication). (Spec: "Frontend")

---

## File Structure

| File | Responsibility |
|---|---|
| `server/controllers/orderAdminController.js` | Add `businessDetail` export (modify) |
| `server/routes/orders.js` | Register the new route + `businessId` param guard (modify) |
| `tests/orderAdminController.test.js` | Unit tests for `businessDetail` (modify) |
| `tests/ordersRoutes.test.js` | Route-level id-validation test for the new param (modify) |
| `lib/orderStatus.js` | New shared `STATUS` map (create) |
| `lib/api.js` | Add `orders.admin.businessDetail` (modify) |
| `app/(dashboard)/my-businesses/page.jsx` | Import shared `STATUS`, add role-gated Actions column + modal wiring (modify) |
| `components/orders/BusinessDetailModal.jsx` | New modal component (create) |

---

## Task 1: Backend endpoint — `GET /api/orders/admin/business/:businessId`

**Files:**
- Modify: `server/controllers/orderAdminController.js`
- Modify: `server/routes/orders.js`
- Test: `tests/orderAdminController.test.js`
- Test: `tests/ordersRoutes.test.js`

**Interfaces:**
- Produces: `exports.businessDetail(req, res, next)` in `orderAdminController.js` — reads `req.params.businessId` (already validated numeric by the route's `router.param`), responds `res.json({ business, orders })` where `business` is the raw `prisma.business` row (or throws a 404 `createError` if not found) and `orders` is `prisma.businessOrder.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' }, include: { user: { select: { id, email, firstName, lastName } } } })`.
- Produces: route `GET /orders/admin/business/:businessId` (mounted under `/api/orders`, so the full path is `/api/orders/admin/business/:businessId`), protected by `superOnly`.
- Consumes: `createError` from `../middleware/errorHandler` (existing), `prisma` singleton from `../config/database` (existing) — both already imported at the top of `orderAdminController.js`.

- [ ] **Step 1: Write the failing controller tests**

Add to `tests/orderAdminController.test.js`. First extend the existing prisma mock at the top of the file to add a `business` model (it currently only mocks `planPrice`, `paymentInstruction`, `businessOrder`):

```javascript
jest.mock('../server/config/database', () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  planPrice:          { findMany: jest.fn(), upsert: jest.fn() },
  paymentInstruction: { findUnique: jest.fn(), upsert: jest.fn() },
  businessOrder:      { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  business:           { findUnique: jest.fn() },
}));
```

Then add a new `describe` block at the end of the file (after the `saveInstructions` block):

```javascript
describe('businessDetail', () => {
  const biz = { id: 42, code: 'BIZ-001', name: 'Acme', isActive: true, paidUntil: null };
  const linkedOrder = {
    id: 9, orderNo: 'ORD-AAAAAA', businessId: 42, status: 'APPROVED', amount: 1000,
    createdAt: new Date('2026-01-01'), user: { id: 7, email: 'u@example.com', firstName: 'Jane', lastName: 'Doe' },
  };

  test('returns the business with its orders, oldest first', async () => {
    prisma.business.findUnique.mockResolvedValue(biz);
    prisma.businessOrder.findMany.mockResolvedValue([linkedOrder]);

    const out = await call(ctrl.businessDetail, { params: { businessId: '42' } });

    expect(prisma.business.findUnique).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(prisma.businessOrder.findMany).toHaveBeenCalledWith({
      where: { businessId: 42 },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });
    expect(out).toEqual({ business: biz, orders: [linkedOrder] });
  });

  test('returns an empty orders list for a business with none', async () => {
    prisma.business.findUnique.mockResolvedValue(biz);
    prisma.businessOrder.findMany.mockResolvedValue([]);

    const out = await call(ctrl.businessDetail, { params: { businessId: '42' } });

    expect(out).toEqual({ business: biz, orders: [] });
  });

  test('404s for a business that does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);

    await expect(call(ctrl.businessDetail, { params: { businessId: '999' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.businessOrder.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: FAIL — `ctrl.businessDetail is not a function`.

- [ ] **Step 3: Implement `businessDetail` in the controller**

Add to `server/controllers/orderAdminController.js`, after the `reject` export (end of file):

```javascript
// ─── Business detail (My Businesses "View") ───────────────────────
exports.businessDetail = async (req, res, next) => {
  try {
    const businessId = Number(req.params.businessId);
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) throw createError('Business not found', 404);

    const orders = await prisma.businessOrder.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
    });

    res.json({ business, orders });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/orderAdminController.test.js`
Expected: PASS — all `businessDetail` tests green, plus every pre-existing test in the file still passing.

- [ ] **Step 5: Register the route**

In `server/routes/orders.js`, add a `businessId` param guard next to the existing `id` one, and register the route among the other `superOnly` admin routes:

```javascript
// Reject non-numeric ids before any upload middleware touches the disk.
router.param('id', (req, res, next, v) => (/^\d+$/.test(v) ? next() : res.status(400).json({ error: 'Invalid order id' })));
router.param('businessId', (req, res, next, v) => (/^\d+$/.test(v) ? next() : res.status(400).json({ error: 'Invalid business id' })));

const superOnly = authorize('SUPER_ADMIN');   // ADMIN is deliberately not enough
router.get('/admin/prices',                 superOnly, admin.getPrices);
router.put('/admin/prices',                 superOnly, admin.savePrices);
router.get('/admin/instructions',           superOnly, admin.getInstructions);
router.put('/admin/instructions',           superOnly, uploadMiddleware, admin.saveInstructions);
router.get('/admin/orders',                 superOnly, admin.listOrders);
router.get('/admin/business/:businessId',   superOnly, admin.businessDetail);
router.post('/admin/orders/:id/approve',    superOnly, admin.approve);
router.post('/admin/orders/:id/reject',     superOnly, admin.reject);
```

- [ ] **Step 6: Write the failing route-level id-validation test**

Add to `tests/ordersRoutes.test.js`. First extend the mocked `orderAdminController` to include `businessDetail`:

```javascript
jest.mock('../server/controllers/orderAdminController', () => {
  const ok = (req, res) => res.json({ ok: true });
  return { getPrices: ok, savePrices: ok, getInstructions: ok, saveInstructions: ok, listOrders: ok, businessDetail: ok, approve: ok, reject: ok };
});
```

Then extend the `test.each` id-validation table and add a passing case:

```javascript
describe('order id validation', () => {
  test.each([
    ['post', '/api/orders/abc/proof'],
    ['post', '/api/orders/abc/cancel'],
    ['get', '/api/orders/1x/proof'],
    ['post', '/api/orders/admin/orders/abc/approve'],
    ['post', '/api/orders/admin/orders/abc/reject'],
    ['get', '/api/orders/admin/business/abc'],
  ])('%s %s is a 400 and never reaches the upload middleware', async (method, url) => {
    const res = await request(app)[method](url);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid order id' });
    expect(uploadMiddleware).not.toHaveBeenCalled();
  });

  test('a numeric id passes through', async () => {
    const res = await request(app).post('/api/orders/12/proof');
    expect(res.status).toBe(200);
    expect(uploadMiddleware).toHaveBeenCalled();
  });

  test('a numeric business id passes through', async () => {
    const res = await request(app).get('/api/orders/admin/business/42');
    expect(res.status).toBe(200);
  });
});
```

Note: the non-numeric `businessId` case is asserted against `{ error: 'Invalid order id' }` in the shared `test.each` table purely because that's the message every other row in that table expects — but `businessId`'s own param guard actually replies `{ error: 'Invalid business id' }` (Step 5). Since a single `test.each` can't mix two expected bodies, put the `/admin/business/abc` case in its own test instead of the shared table:

```javascript
test('a non-numeric business id is a 400', async () => {
  const res = await request(app).get('/api/orders/admin/business/abc');
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Invalid business id' });
});
```

(Do not add the `/admin/business/abc` row to the shared `test.each` table above — use this standalone test instead.)

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test -- tests/ordersRoutes.test.js`
Expected: FAIL — 404 (no matching route) before the route is registered, or passes trivially if Step 5 was already done; if it already passes, that's expected since Step 5 precedes this step in this task — just confirm no regressions by re-running after Step 5 if you did these out of order.

- [ ] **Step 8: Run the full test file to verify it passes**

Run: `npm test -- tests/ordersRoutes.test.js`
Expected: PASS — including the pre-existing id-validation cases and the two new ones.

- [ ] **Step 9: Run the whole backend test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else.

- [ ] **Step 10: Commit**

```bash
git add server/controllers/orderAdminController.js server/routes/orders.js tests/orderAdminController.test.js tests/ordersRoutes.test.js
git commit -m "feat(orders): add SUPER_ADMIN business detail endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — shared status map + API client

**Files:**
- Create: `lib/orderStatus.js`
- Modify: `lib/api.js`
- Modify: `app/(dashboard)/my-businesses/page.jsx`

**Interfaces:**
- Produces: `export const STATUS` (default export style: named export) from `lib/orderStatus.js` — an object keyed by order status (`PENDING_PAYMENT`, `PROOF_SUBMITTED`, `APPROVED`, `REJECTED`, `CANCELLED`) to `{ label, cls }`, identical in content to the map currently inline in `my-businesses/page.jsx`.
- Produces: `orders.admin.businessDetail(businessId)` in `lib/api.js` — `GET /orders/admin/business/${businessId}`, returns the axios response whose `.data` is `{ business, orders }` (see Task 1).
- Consumes (Task 3 will use these): `STATUS` from `@/lib/orderStatus`, `orders.admin.businessDetail` from `@/lib/api`.

- [ ] **Step 1: Create the shared status map**

Create `lib/orderStatus.js`:

```javascript
// Shared label/badge-class map for BusinessOrder statuses. Used by the My
// Businesses page (customer's own orders) and the business detail modal
// (a business's order/payment history) so both stay in sync.
export const STATUS = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'badge-yellow' },
  PROOF_SUBMITTED: { label: 'Under review',     cls: 'badge-blue' },
  APPROVED:        { label: 'Approved',         cls: 'badge-green' },
  REJECTED:        { label: 'Rejected',         cls: 'badge-red' },
  CANCELLED:       { label: 'Cancelled',        cls: 'badge' },
};
```

- [ ] **Step 2: Point `my-businesses/page.jsx` at the shared map**

In `app/(dashboard)/my-businesses/page.jsx`, remove the inline `STATUS` constant and import the shared one instead:

```javascript
// remove this block:
const STATUS = {
  PENDING_PAYMENT: { label: 'Awaiting payment', cls: 'badge-yellow' },
  PROOF_SUBMITTED: { label: 'Under review',     cls: 'badge-blue' },
  APPROVED:        { label: 'Approved',         cls: 'badge-green' },
  REJECTED:        { label: 'Rejected',         cls: 'badge-red' },
  CANCELLED:       { label: 'Cancelled',        cls: 'badge' },
};
```

Add near the top with the other imports:

```javascript
import { STATUS } from '@/lib/orderStatus';
```

- [ ] **Step 3: Add the API client method**

In `lib/api.js`, inside the existing `orders.admin` object (right after the `orders:` line), add:

```javascript
    orders:  (status)      => api.get('/orders/admin/orders', { params: status ? { status } : {} }),
    businessDetail: (businessId) => api.get(`/orders/admin/business/${businessId}`),
    approve: (id)          => api.post(`/orders/admin/orders/${id}/approve`),
```

- [ ] **Step 4: Verify the frontend still compiles**

Run: `npm run build:prod`
Expected: build succeeds with no errors (per the project's memory note, use `build:prod`, never plain `build`, while `npm run dev` may be running — it uses a separate `.next-prod` output dir so it can't collide with a live dev server's `.next/`).

- [ ] **Step 5: Commit**

```bash
git add lib/orderStatus.js lib/api.js "app/(dashboard)/my-businesses/page.jsx"
git commit -m "refactor(orders): extract shared order-status map; add businessDetail API client

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `BusinessDetailModal` + "View" action on My Businesses

**Files:**
- Create: `components/orders/BusinessDetailModal.jsx`
- Modify: `app/(dashboard)/my-businesses/page.jsx`

**Interfaces:**
- Consumes: `orders.admin.businessDetail(businessId)` from `@/lib/api` (Task 2), `STATUS` from `@/lib/orderStatus` (Task 2), `formatCurrency`/`formatDate`/`getUser` from `@/lib/auth` (existing), `ordersApi.proofBlob(id)` from `@/lib/api` (existing, already used in `app/(dashboard)/admin/orders/page.jsx`).
- Produces: `export default function BusinessDetailModal({ businessId, onClose })` — self-contained; renders nothing external, calls `onClose()` on close or load failure.

- [ ] **Step 1: Create the modal component**

Create `components/orders/BusinessDetailModal.jsx`:

```javascript
'use client';
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { STATUS } from '@/lib/orderStatus';

export default function BusinessDetailModal({ businessId, onClose }) {
  const [data, setData]       = useState(null);   // { business, orders }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersApi.admin.businessDetail(businessId)
      .then(({ data }) => setData(data))
      .catch(() => { toast.error('Failed to load business details'); onClose(); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const viewProof = async (o) => {
    try {
      const { data } = await ordersApi.proofBlob(o.id);
      window.open(URL.createObjectURL(data), '_blank');
    } catch { toast.error('Could not open the proof'); }
  };

  const biz = data?.business;
  const ordersList = data?.orders || [];
  const creator = ordersList[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {biz ? biz.name : 'Business details'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : !biz ? null : (
          <div className="px-6 py-5 space-y-6">
            {/* ── Business profile ──────────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Business profile</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-gray-500">Code</dt><dd className="font-mono">{biz.code}</dd></div>
                <div><dt className="text-xs text-gray-500">Type</dt><dd>{biz.industry || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">TIN</dt><dd>{biz.tin || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Tax registration</dt><dd>{biz.taxType || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Phone</dt><dd>{biz.phone || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Email</dt><dd>{biz.email || '—'}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-gray-500">Address</dt><dd>{biz.address || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Status</dt><dd><span className={`badge ${biz.isActive ? 'badge-green' : 'badge-red'}`}>{biz.isActive ? 'Active' : 'Inactive'}</span></dd></div>
                <div><dt className="text-xs text-gray-500">Paid until</dt><dd>{biz.paidUntil ? formatDate(biz.paidUntil) : '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Books start date</dt><dd>{biz.booksStartDate ? formatDate(biz.booksStartDate) : '—'}</dd></div>
              </dl>
            </section>

            {/* ── Created by ─────────────────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Created by</h4>
              {creator ? (
                <p className="text-sm">
                  {creator.user.firstName} {creator.user.lastName} <span className="text-gray-500">({creator.user.email})</span>
                  {' '}via order <span className="font-mono text-xs">{creator.orderNo}</span>
                  {' '}— ordered {formatDate(creator.createdAt)}
                  {creator.reviewedAt && <>, approved {formatDate(creator.reviewedAt)}</>}
                </p>
              ) : (
                <p className="text-sm text-gray-500">Legacy business — no order on record</p>
              )}
            </section>

            {/* ── Order & payment history ────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Order &amp; payment history</h4>
              {ordersList.length === 0 ? <p className="text-sm text-gray-500">No orders yet.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="py-2">Order</th><th className="py-2">Period</th>
                    <th className="py-2 text-right">Amount</th><th className="py-2">Reference</th>
                    <th className="py-2">Status</th><th className="py-2">Date</th><th className="py-2" />
                  </tr></thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {ordersList.map((o) => {
                      const s = STATUS[o.status] || STATUS.CANCELLED;
                      return (
                        <tr key={o.id}>
                          <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                          <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                          <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                          <td className="py-2.5">{o.referenceNo || '—'}</td>
                          <td className="py-2.5"><span className={`badge ${s.cls}`}>{s.label}</span></td>
                          <td className="py-2.5">{formatDate(o.createdAt)}</td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            {o.proofFileName && <button className="btn-secondary" onClick={() => viewProof(o)}>View proof</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the "View" action into My Businesses**

In `app/(dashboard)/my-businesses/page.jsx`:

Add imports (alongside the existing ones):

```javascript
import { Plus, Building2, Loader2, Eye } from 'lucide-react';
import { getUser } from '@/lib/auth';
import BusinessDetailModal from '@/components/orders/BusinessDetailModal';
```

Add state and the role check inside `MyBusinessesPage`, next to the existing `useState` calls:

```javascript
  const [viewBizId, setViewBizId] = useState(null);
  const isSuperAdmin = getUser()?.role === 'SUPER_ADMIN';
```

Update the Businesses table header to add the Actions column only for a super admin:

```javascript
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 uppercase">
                  <th className="py-2">Name</th><th className="py-2">Type</th><th className="py-2">Code</th><th className="py-2">Paid until</th>
                  {isSuperAdmin && <th className="py-2" />}
                </tr></thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {list.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2.5 flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-400" />{b.name}</td>
                      <td className="py-2.5">{b.industry || '—'}</td>
                      <td className="py-2.5 font-mono text-xs">{b.code}</td>
                      <td className="py-2.5">{b.paidUntil ? formatDate(b.paidUntil) : '—'}</td>
                      {isSuperAdmin && (
                        <td className="py-2.5 text-right">
                          <button className="btn-secondary flex items-center gap-1 ml-auto" onClick={() => setViewBizId(b.id)}>
                            <Eye className="w-3.5 h-3.5" /> View
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
```

Render the modal at the bottom of the component's JSX, alongside the existing `AddBusinessModal` render:

```javascript
      {modal && (
        <AddBusinessModal
          order={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onDone={load}
        />
      )}
      {viewBizId && (
        <BusinessDetailModal businessId={viewBizId} onClose={() => setViewBizId(null)} />
      )}
```

- [ ] **Step 3: Verify the frontend still compiles**

Run: `npm run build:prod`
Expected: build succeeds with no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
1. Sign in as a `SUPER_ADMIN` user, go to My Businesses, confirm a "View" button appears per row.
2. Click it: confirm the modal shows business profile, "Created by" (or the legacy message for a business with no linked order, e.g. the seeded default/DEMO business), and the order history table.
3. If a row's order has a proof file, click "View proof" and confirm it opens in a new tab.
4. Sign in as a plain `ADMIN` (not `SUPER_ADMIN`) user, go to My Businesses, confirm no Actions column / View button appears at all.

- [ ] **Step 5: Commit**

```bash
git add components/orders/BusinessDetailModal.jsx "app/(dashboard)/my-businesses/page.jsx"
git commit -m "feat(orders): add business detail view modal for SUPER_ADMIN

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** combined endpoint (Task 1) ✓; role gate via existing `superOnly` (Task 1) ✓; modal on the same page (Task 3) ✓; business profile / created-by / order history sections (Task 3) ✓; shared `STATUS` map extraction (Task 2) ✓; proof viewing reuse (Task 3) ✓; error handling — load failure toast + close (Task 3), 404 on unknown business (Task 1) ✓.
- **Testing deviation from spec:** the spec's Testing section mentioned a 403-for-non-SUPER_ADMIN controller test; this plan drops it because the codebase has no established pattern for it — `orderAdminController.test.js` calls controller functions directly (bypassing the `authorize` middleware entirely), and `ordersRoutes.test.js` mocks `authorize` to a no-op for every route. The role boundary is enforced structurally by reusing `superOnly` in the route table (Task 1, Step 5), the same way every other admin route in this file already is, with no per-route role test elsewhere in the suite either.
- **Type/name consistency:** `orders.admin.businessDetail` (Task 2) matches its usage in the modal (Task 3); `STATUS` export name and shape match between `lib/orderStatus.js` (Task 2) and both consumers; `businessDetail` controller name matches the route registration and the test file's `ctrl.businessDetail`.
