# Invoice Editing & Shipping Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff edit an unpaid or partially-paid Sales Invoice in place, and record/track shipping status (Pending → Shipped) on any non-voided invoice.

**Architecture:** Two independent features sharing the same page/controller. Invoice editing (Tasks 1-2) generalizes the existing `CreateInvoiceModal` into a create/edit dual-mode component backed by a new `PUT /receivable/:id` endpoint that recomputes totals, replaces line items, and corrects the GL by voiding the old journal entry and posting a new one. Invoice shipping (Tasks 3-5) adds a `DeliveryStatus` enum and four columns to `Invoice` (a Prisma migration), a `POST /receivable/:id/ship` endpoint with no GL involvement, and a new `ShippingModal` component. Both features are additive — no existing endpoint's behavior changes.

**Tech Stack:** Next.js 14 (App Router, client components), Express controller (Prisma 5), Jest for backend tests, MySQL via Prisma migrations.

## Global Constraints

- Invoice edit eligibility: `status !== 'PAID' && status !== 'VOID'` (i.e. `OPEN`, `PARTIAL`, `OVERDUE` are editable). Reject if the edited total would drop below `paidAmount`.
- Invoice edit is a full replace of customer/dates/description/notes/lines — no "amounts only" restricted mode.
- Invoice edit's GL correction: void the old `JournalEntry` (found via `reference = invoiceNo`, `status: 'POSTED'`, scoped to `businessId`) if one exists, then `glPost.safePost()` a fresh entry with the same DR AR / CR revenue-lines / CR Output VAT shape `createInvoice` already builds. Never wrap the DB write and the GL correction in one transaction — matches `createInvoice`'s own existing structure (DB write, then a separate best-effort GL post).
- No `authorize()` role restriction on either new endpoint (`updateInvoice`, `markShipped`) — matches `createInvoice`'s own stance (any authenticated user).
- New backend lookups by `id` must scope by `businessId: req.businessId` (via `findFirst`, not `findUnique`) — this is a positive pattern to follow (matching `cashSaleController.create`'s own scoping), not something already consistent elsewhere in `receivableController.js` (`getInvoice`/`recordPayment`/`voidInvoice` are pre-existing gaps, out of scope to fix here).
- Delivery status (`PENDING`/`SHIPPED`) is a new, independent field from `InvoiceStatus` (payment status) — never conflate the two, never derive one from the other.
- `markShipped` never posts to the GL — shipping is a logistics fact, not a financial event.
- Follow the existing single-file-per-page convention — `ShippingModal` and the edit-mode changes to `CreateInvoiceModal` are local functions inside `app/(dashboard)/receivable/page.jsx`, no new component files.
- The page's modal state is a single `{ type, invoice }` object via `setModal` — new modal types (`'edit'`, `'ship'`) follow this same convention, not new boolean flags.

---

### Task 1: Backend — `updateInvoice`

**Files:**
- Modify: `server/controllers/receivableController.js` (add `exports.updateInvoice`, after `exports.createInvoice`, before `exports.recordPayment`)
- Modify: `server/routes/receivable.js` (add `PUT /:id` route, after the `POST /` route)
- Modify: `lib/api.js` (add `update` to the `receivable.invoices` object, `lib/api.js:226-232`)
- Test: `tests/receivableController.test.js` (new file)

**Interfaces:**
- Consumes: `prisma.invoice.findFirst/update`, `prisma.journalEntry.findFirst/update` (Prisma models, `prisma/schema.prisma:318-344,153-173`), `glPost.safePost` (`server/utils/glPost.js:159`), `createError` (`server/middleware/errorHandler.js`), `computeVAT` (`server/utils/phCompliance.js`, already imported in this file at line 3).
- Produces: `PUT /api/receivable/:id` — body `{ customerId, invoiceDate, dueDate, description, notes, lines: [{ accountId, description, quantity, unitPrice, vatCode }] }`. Response: the updated invoice (with `customer` and `lines` included), same shape `getInvoice` returns. `lib/api.js`: `receivable.invoices.update(id, data)` — the exact function name `update` and call shape `api.put(\`/receivable/${id}\`, data)` is what Task 2's frontend work depends on.

- [ ] **Step 1: Write the failing tests**

Create `tests/receivableController.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice: {
    findFirst: jest.fn(),
    update: jest.fn(),
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

beforeEach(() => jest.clearAllMocks());

const baseInvoice = {
  id: 5, businessId: 1, invoiceNo: 'INV-000005', status: 'OPEN',
  paidAmount: 0, totalAmount: 1120, subtotal: 1000, vatAmount: 120,
};

const editBody = {
  customerId: 2, invoiceDate: '2026-08-11', dueDate: '2026-09-10',
  description: 'Edited', notes: '',
  lines: [{ accountId: 10, description: 'Item A', quantity: 2, unitPrice: 500, vatCode: 'VAT' }],
};

describe('updateInvoice — eligibility', () => {
  test('rejects editing a PAID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PAID', paidAmount: 1120 });

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('rejects editing a VOID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'VOID' });

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('rejects when the edited total would drop below the amount already collected', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 900 });
    // editBody totals to 1000 * 1.12 = 1120... use a body that totals below 900
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] };

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: smallBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('404s when the invoice belongs to another business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the invoice scoped to the current business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });
});

describe('updateInvoice — recompute and status transitions', () => {
  test('recomputes subtotal/vatAmount/totalAmount from submitted lines and replaces lines via deleteMany+create', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({
        id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
        totalAmount: 1120, vatAmount: 120,
        customer: { name: 'Acme Corp' },
        lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
      });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(updateArgs.data.subtotal).toBeCloseTo(1000, 2);
    expect(updateArgs.data.vatAmount).toBeCloseTo(120, 2);
    expect(updateArgs.data.totalAmount).toBeCloseTo(1120, 2);
    expect(updateArgs.data.lines.deleteMany).toEqual({});
    expect(updateArgs.data.lines.create).toHaveLength(1);
    expect(updateArgs.data.lines.create[0]).toMatchObject({ accountId: 10, description: 'Item A' });
  });

  test('flips a PARTIAL invoice to PAID when the edited total exactly matches paidAmount', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 112 });
    const smallBody = { ...editBody, lines: [{ accountId: 10, description: 'Item A', quantity: 1, unitPrice: 100, vatCode: 'VAT' }] }; // totals to 112
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 112, vatAmount: 12, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: smallBody });

    expect(updateArgs.data.status).toBe('PAID');
  });

  test('keeps status PARTIAL when a collection exists and remaining balance is still positive', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'PARTIAL', paidAmount: 100 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody }); // totals to 1120, paid 100, remaining 1020

    expect(updateArgs.data.status).toBe('PARTIAL');
  });

  test('keeps status OPEN unchanged when there are no collections', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date(), totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' }, lines: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(updateArgs.data.status).toBe('OPEN');
  });
});

describe('updateInvoice — GL correction', () => {
  test('voids the existing POSTED journal entry (scoped to businessId) and posts a fresh one', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({
      id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120,
      customer: { name: 'Acme Corp' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 42, entryNo: 'JE-1-000042' });
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'INV-000005', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 }, data: { status: 'VOIDED' } })
    );
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('INV-000005');
    const arLine = call.lines.find((l) => l.accountCode === '1100');
    expect(arLine.debit).toBeCloseTo(1120, 2);
    const vatLine = call.lines.find((l) => l.accountCode === '2030');
    expect(vatLine.credit).toBeCloseTo(120, 2);
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ ...baseInvoice, status: 'OPEN', paidAmount: 0 });
    prisma.invoice.update.mockResolvedValue({
      id: 5, invoiceNo: 'INV-000005', invoiceDate: new Date('2026-08-11'),
      totalAmount: 1120, vatAmount: 120, customer: { name: 'Acme' },
      lines: [{ accountId: 10, amount: 1000, description: 'Item A' }],
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, { params: { id: '5' }, body: editBody });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/receivableController.test.js`
Expected: FAIL — `ctrl.updateInvoice` is `undefined` (not yet exported).

- [ ] **Step 3: Implement `updateInvoice`**

In `server/controllers/receivableController.js`, add this new export after `exports.createInvoice` (after line 159) and before `exports.recordPayment`:

```js
exports.updateInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, businessId: req.businessId } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'PAID') throw createError('Cannot edit a fully paid invoice.', 400);
    if (inv.status === 'VOID') throw createError('Cannot edit a voided invoice.', 400);

    const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;
    let subtotal = 0, vatAmount = 0;
    const processedLines = lines.map((l) => {
      const amt = Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      subtotal += v.base; vatAmount += v.vat;
      return { ...l, amount: v.base };
    });
    const totalAmount = subtotal + vatAmount;

    if (totalAmount < Number(inv.paidAmount) - 0.01) {
      throw createError(
        `New total (₱${totalAmount.toFixed(2)}) is less than the amount already collected (₱${Number(inv.paidAmount).toFixed(2)}). Adjust line items so the total covers what's been paid.`,
        400
      );
    }

    const remaining = totalAmount - Number(inv.paidAmount);
    const status = remaining <= 0.01 ? 'PAID' : (Number(inv.paidAmount) > 0 ? 'PARTIAL' : inv.status);

    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate),
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
      include: { customer: true, lines: true },
    });

    // ── GL correction: void the old entry (if any), post a fresh one ────────
    const oldEntry = await prisma.journalEntry.findFirst({
      where: { businessId: req.businessId, reference: updated.invoiceNo, status: 'POSTED' },
    });
    if (oldEntry) {
      await prisma.journalEntry.update({ where: { id: oldEntry.id }, data: { status: 'VOIDED' } });
    }

    const glLines = [
      { accountCode: '1100', debit: Number(updated.totalAmount), description: `AR — ${updated.customer.name} (${updated.invoiceNo})` },
      ...updated.lines.map((l) => ({ accountId: l.accountId, credit: Number(l.amount), description: l.description })),
      ...(Number(updated.vatAmount) > 0 ? [{ accountCode: '2030', credit: Number(updated.vatAmount), description: 'Output VAT' }] : []),
    ];
    await glPost.safePost({
      entryDate:   updated.invoiceDate,
      description: `AR Invoice (Edited) — ${updated.customer.name} (${updated.invoiceNo})`,
      reference:   updated.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};
```

In `server/routes/receivable.js`, add this route right after the `POST '/'` route block (after line 29, before `router.post('/:id/payment', ...)`):

```js
router.put('/:id',
  [
    param('id').isInt(),
    body('customerId').isInt(),
    body('invoiceDate').isISO8601(),
    body('dueDate').isISO8601(),
    body('lines').isArray({ min: 1 }),
    body('lines.*.accountId').isInt(),
    body('lines.*.description').notEmpty(),
    body('lines.*.quantity').isFloat({ min: 0.001 }),
    body('lines.*.unitPrice').isFloat({ min: 0 }),
    body('lines.*.vatCode').isIn(['VAT','EXEMPT','ZERO']),
  ],
  validate, ctrl.updateInvoice);
```

In `lib/api.js`, inside the `receivable.invoices` object (`lib/api.js:226-232`), add:

```js
    update: (id, data) => api.put(`/receivable/${id}`, data),
```

(placed after the existing `create` line, before `payment`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/receivableController.test.js`
Expected: PASS — all 11 tests.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/receivableController.js server/routes/receivable.js lib/api.js tests/receivableController.test.js
git commit -m "feat(invoices): add updateInvoice endpoint for editing unpaid/partial invoices"
```

---

### Task 2: Frontend — Edit mode for `CreateInvoiceModal`

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx` (imports; `InvoiceDetailModal`; `CreateInvoiceModal`; `InvoicesPage`'s row actions, modal render block)

**Interfaces:**
- Consumes: `rApi.invoices.update(id, data)` (Task 1). `rApi.invoices.get(id)` (existing, `lib/api.js:228`).
- Produces: nothing new consumed elsewhere — this is the UI leaf for Task 1's endpoint.

- [ ] **Step 1: Add the `Pencil` icon import**

In `app/(dashboard)/receivable/page.jsx`, the `lucide-react` import (line 5-9) currently reads:

```js
import {
  Plus, Search, Eye, Ban, Filter, X,
  AlertCircle, Clock, CheckCircle2, FileText,
  Printer, ChevronDown, ChevronUp,
} from 'lucide-react';
```

Add `Pencil` to it:

```js
import {
  Plus, Search, Eye, Ban, Filter, X,
  AlertCircle, Clock, CheckCircle2, FileText,
  Printer, ChevronDown, ChevronUp, Pencil,
} from 'lucide-react';
```

- [ ] **Step 2: Add an Edit button to `InvoiceDetailModal`'s footer**

`InvoiceDetailModal`'s signature (line 45) currently reads `function InvoiceDetailModal({ invoice, onClose, onCollect, onVoid }) {` — add an `onEdit` prop:

```js
function InvoiceDetailModal({ invoice, onClose, onCollect, onVoid, onEdit }) {
```

The footer (currently lines 265-286) reads:

```jsx
        <div className="modal-footer">
          {invoice.status === 'VOID' ? (
            <span className="text-gray-400 text-sm mr-auto">This invoice has been voided.</span>
          ) : (
            <>
              {invoice.paidAmount == 0 && (
                <button onClick={onVoid} className="btn-danger btn-sm mr-auto">
                  <Ban className="w-4 h-4" /> Void
                </button>
              )}
              {invoice.status !== 'PAID' && (
                <button onClick={onCollect} className="btn-success">
                  <PesoSign className="w-4 h-4" /> Record Collection
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

Add an Edit button next to Record Collection (both share the `status !== 'PAID'` gate — plus `status !== 'VOID'`, already guaranteed by the outer `invoice.status === 'VOID' ? ... : (...)` branch):

```jsx
        <div className="modal-footer">
          {invoice.status === 'VOID' ? (
            <span className="text-gray-400 text-sm mr-auto">This invoice has been voided.</span>
          ) : (
            <>
              {invoice.paidAmount == 0 && (
                <button onClick={onVoid} className="btn-danger btn-sm mr-auto">
                  <Ban className="w-4 h-4" /> Void
                </button>
              )}
              {invoice.status !== 'PAID' && (
                <button onClick={onEdit} className="btn-secondary">
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              )}
              {invoice.status !== 'PAID' && (
                <button onClick={onCollect} className="btn-success">
                  <PesoSign className="w-4 h-4" /> Record Collection
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

- [ ] **Step 3: Generalize `CreateInvoiceModal` for edit mode**

`CreateInvoiceModal`'s signature (line 429) currently reads:

```js
function CreateInvoiceModal({ customers, accounts, onClose, onSaved, onCustomerAdded }) {
  const [form, setForm] = useState({
    customerId:   '',
    invoiceDate:  new Date().toISOString().split('T')[0],
    dueDate:      '',
    description:  '',
    notes:        '',
    lines: [
      { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
    ],
  });
  const [saving, setSaving] = useState(false);
```

Replace with:

```js
function CreateInvoiceModal({ customers, accounts, invoice, onClose, onSaved, onCustomerAdded }) {
  const [form, setForm] = useState(() => invoice ? {
    customerId:  String(invoice.customerId),
    invoiceDate: invoice.invoiceDate.slice(0, 10),
    dueDate:     invoice.dueDate.slice(0, 10),
    description: invoice.description || '',
    notes:       invoice.notes || '',
    lines: invoice.lines.map((l) => ({
      accountId: String(l.accountId), description: l.description,
      quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
    })),
  } : {
    customerId:   '',
    invoiceDate:  new Date().toISOString().split('T')[0],
    dueDate:      '',
    description:  '',
    notes:        '',
    lines: [
      { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
    ],
  });
  const [saving, setSaving] = useState(false);
```

The due-date auto-fill `useEffect` (currently lines 454-460, unchanged) only fires when `!form.dueDate`, so it will not clobber an edit-mode invoice's existing due date — no change needed there.

Replace `handleSubmit` (currently lines 473-499):

```js
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customerId) { toast.error('Select or add a customer'); return; }
    const validLines = form.lines.filter((l) => l.accountId && l.description && l.unitPrice);
    if (!validLines.length) { toast.error('Add at least one line item'); return; }
    validLines.forEach((l) => rememberDescription(l.description));
    setSaving(true);
    try {
      const payload = {
        ...form,
        customerId: Number(form.customerId),
        lines: validLines.map((l) => ({
          accountId:   Number(l.accountId),
          description: l.description,
          quantity:    Number(l.quantity),
          unitPrice:   Number(l.unitPrice),
          vatCode:     l.vatCode,
        })),
      };
      if (invoice) {
        await rApi.invoices.update(invoice.id, payload);
        toast.success('Invoice updated successfully');
      } else {
        await rApi.invoices.create(payload);
        toast.success('Invoice created successfully');
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${invoice ? 'update' : 'create'} invoice`);
    } finally {
      setSaving(false);
    }
  };
```

In the returned JSX, change the header title (currently line 505, `<h3 className="text-lg font-semibold">New Sales Invoice</h3>`) to:

```jsx
          <h3 className="text-lg font-semibold">{invoice ? 'Edit Invoice' : 'New Sales Invoice'}</h3>
```

And the submit button (currently lines 667-670):

```jsx
            <button type="submit" disabled={saving} className="btn-primary">
              <PesoReceipt className="w-4 h-4" />
              {saving ? (invoice ? 'Saving...' : 'Creating Invoice...') : (invoice ? 'Save Changes' : 'Create Invoice')}
            </button>
```

- [ ] **Step 4: Wire the Edit action into the invoice list's row actions**

In `InvoicesPage`'s row actions (currently lines 963-993), add an Edit button between the existing "View details" (Eye) and "Record collection" (PesoSign) buttons:

```jsx
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openInvoice(inv)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await rApi.invoices.get(inv.id);
                              setModal({ type: 'edit', invoice: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit invoice"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {inv.status !== 'PAID' && (
                          <button
                            onClick={async () => {
                              const { data } = await rApi.invoices.get(inv.id);
                              setModal({ type: 'collect', invoice: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Record collection"
                          >
                            <PesoSign className="w-4 h-4" />
                          </button>
                        )}
                        {inv.paidAmount == 0 && inv.status !== 'VOID' && (
                          <button
                            onClick={() => handleVoid(inv)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Void invoice"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
```

- [ ] **Step 5: Wire `onEdit` into `InvoiceDetailModal` and add the `'edit'` modal render block**

The `InvoiceDetailModal` usage (currently lines 1039-1046) reads:

```jsx
      {modal?.type === 'detail' && (
        <InvoiceDetailModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onCollect={() => setModal({ type: 'collect', invoice: modal.invoice })}
          onVoid={() => { handleVoid(modal.invoice); setModal(null); }}
        />
      )}
```

Add `onEdit`:

```jsx
      {modal?.type === 'detail' && (
        <InvoiceDetailModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onCollect={() => setModal({ type: 'collect', invoice: modal.invoice })}
          onVoid={() => { handleVoid(modal.invoice); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', invoice: modal.invoice })}
        />
      )}
```

Add a new `'edit'` block right after the existing `'create'` block (currently lines 1030-1038):

```jsx
      {modal?.type === 'edit' && (
        <CreateInvoiceModal
          customers={customers}
          accounts={accounts}
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])}
        />
      )}
```

- [ ] **Step 6: Manually verify in the browser**

Set up an isolated worktree dev server pair (non-default ports, following the same pattern as the Cash Sale POS Picker work — copy `.env` into the worktree, edit `FRONTEND_URL`/`NEXT_PUBLIC_API_URL` to non-default ports, run `npx concurrently -k -n api,web "cross-env PORT=<port> node server/index.js" "next dev -p <port>"` in the background). Do not touch the user's own running dev server.

1. Navigate to `/receivable`.
2. Open an `OPEN` invoice's detail (or create one) — confirm the **Edit** button appears in the footer and the pencil icon appears in the row actions.
3. Click Edit — modal opens titled "Edit Invoice", pre-filled with the invoice's customer, dates, description, notes, and line items exactly as they were.
4. Change a line item's quantity/price, add a new line, remove a line — confirm the totals recompute live (existing `CreateInvoiceModal` totals display, unchanged logic).
5. Submit — toast "Invoice updated successfully", modal closes, the list row reflects the new total/lines.
6. Re-open the same invoice's detail — confirm the line items shown match the edit.
7. Record a partial collection on an `OPEN` invoice (via the existing Record Collection flow) so it becomes `PARTIAL`. Confirm Edit is still available.
8. Edit that `PARTIAL` invoice, reducing the total to exactly the collected amount — submit — confirm the invoice's status badge becomes `PAID`.
9. Attempt to edit a `PAID` invoice (via a fresh partial→paid one, or by fully collecting one) — confirm neither the row's pencil icon nor the detail modal's Edit button appear.
10. Attempt to edit a `VOID` invoice — confirm neither appears.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(invoices): add Edit action for unpaid/partial invoices"
```

---

### Task 3: Prisma migration — add shipping fields to `Invoice`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: new folder under `prisma/migrations/` (auto-generated by `prisma migrate dev`)

**Interfaces:**
- Produces: `Invoice.deliveryStatus` (`DeliveryStatus` enum, default `PENDING`), `Invoice.shippedDate` (`DateTime?`), `Invoice.shippingAddress` (`String?`), `Invoice.courier` (`String?`), `Invoice.trackingNumber` (`String?`). Task 4's `markShipped` and Task 5's frontend both depend on these exact field names and the `PENDING`/`SHIPPED` enum values.

- [ ] **Step 1: Add the enum and fields to the schema**

In `prisma/schema.prisma`, add a new enum near the other invoice-related enums (next to `enum InvoiceStatus` at line 378):

```prisma
enum DeliveryStatus {
  PENDING
  SHIPPED
}
```

In the `Invoice` model (`prisma/schema.prisma:318-344`), add five fields after the existing `status` field (after line 332, before `createdAt`):

```prisma
  deliveryStatus  DeliveryStatus @default(PENDING)
  shippedDate     DateTime?      @db.Date
  shippingAddress String?        @db.Text
  courier         String?        @db.VarChar(100)
  trackingNumber  String?        @db.VarChar(100)
```

- [ ] **Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_invoice_shipping_fields`
Expected: a new folder appears under `prisma/migrations/` (timestamped, e.g. `2026XXXXXXXXXX_add_invoice_shipping_fields/migration.sql`), containing `ALTER TABLE`/`CREATE TYPE`-equivalent SQL for the new enum and columns, and the command reports the migration applied successfully. This also regenerates the Prisma client (`@prisma/client`) automatically as part of `migrate dev`.

If running inside an isolated worktree, this applies directly to the same local MySQL database the rest of the app uses (via the worktree's own copy of `.env`) — this is expected and required, since the new columns must exist for Task 4/5 to work against the real database.

- [ ] **Step 3: Verify the full test suite still passes**

Run: `npx jest`
Expected: all existing tests still pass — this change only adds new nullable/defaulted columns, nothing existing reads or depends on them yet.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(invoices): add DeliveryStatus enum and shipping fields to Invoice"
```

---

### Task 4: Backend — `markShipped`

**Files:**
- Modify: `server/controllers/receivableController.js` (add `exports.markShipped`, after `exports.voidInvoice`, before `exports.agingReport`)
- Modify: `server/routes/receivable.js` (add `POST /:id/ship` route, after the `POST /:id/void` route)
- Modify: `lib/api.js` (add `ship` to the `receivable.invoices` object)
- Test: `tests/receivableController.test.js` (extend)

**Interfaces:**
- Consumes: the `deliveryStatus`/`shippedDate`/`shippingAddress`/`courier`/`trackingNumber` fields Task 3 added.
- Produces: `POST /api/receivable/:id/ship` — body `{ shippedDate, shippingAddress, courier, trackingNumber }`. Response: the updated invoice. `lib/api.js`: `receivable.invoices.ship(id, data)` — `api.post(\`/receivable/${id}/ship\`, data)` — this exact name/shape is what Task 5's frontend depends on.

- [ ] **Step 1: Write the failing tests**

Append to `tests/receivableController.test.js`. First, update the top-of-file `jest.mock('../server/config/database', ...)` factory (from Task 1) to ensure `invoice.findFirst` and `invoice.update` are present (they already are from Task 1 — no change needed to the mock factory itself).

Append these new `describe` blocks at the end of the file:

```js
describe('markShipped', () => {
  test('marks a PENDING invoice as SHIPPED and stores shipment details', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'OPEN', deliveryStatus: 'PENDING' });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, deliveryStatus: 'SHIPPED', ...args.data });
    });

    await run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '123 Rizal St, Davao', courier: 'LBC', trackingNumber: 'TRK123' },
    });

    expect(updateArgs.data.deliveryStatus).toBe('SHIPPED');
    expect(updateArgs.data.shippingAddress).toBe('123 Rizal St, Davao');
    expect(updateArgs.data.courier).toBe('LBC');
    expect(updateArgs.data.trackingNumber).toBe('TRK123');
    expect(updateArgs.data.shippedDate).toBeInstanceOf(Date);
  });

  test('rejects shipping a VOID invoice', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'VOID', deliveryStatus: 'PENDING' });

    await expect(run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '', courier: '', trackingNumber: '' },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('re-shipping an already-SHIPPED invoice updates the details without erroring', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'OPEN', deliveryStatus: 'SHIPPED' });
    let updateArgs;
    prisma.invoice.update.mockImplementation((args) => {
      updateArgs = args;
      return Promise.resolve({ id: 5, deliveryStatus: 'SHIPPED', ...args.data });
    });

    await run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-12', shippingAddress: 'Updated address', courier: 'J&T', trackingNumber: 'TRK999' },
    });

    expect(updateArgs.data.deliveryStatus).toBe('SHIPPED');
    expect(updateArgs.data.trackingNumber).toBe('TRK999');
  });

  test('404s when the invoice belongs to another business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.markShipped, {
      params: { id: '5' },
      body: { shippedDate: '2026-08-11', shippingAddress: '', courier: '', trackingNumber: '' },
    })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('only looks up the invoice scoped to the current business', async () => {
    prisma.invoice.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.markShipped, { params: { id: '5' }, body: {} })).rejects.toBeDefined();

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/receivableController.test.js -t "markShipped"`
Expected: FAIL — `ctrl.markShipped` is `undefined`.

- [ ] **Step 3: Implement `markShipped`**

In `server/controllers/receivableController.js`, add this new export after `exports.voidInvoice` (after line 216) and before `exports.agingReport`:

```js
exports.markShipped = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findFirst({ where: { id, businessId: req.businessId } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'VOID') throw createError('Cannot ship a voided invoice.', 400);

    const { shippedDate, shippingAddress, courier, trackingNumber } = req.body;
    const updated = await prisma.invoice.update({
      where: { id },
      data: {
        deliveryStatus:  'SHIPPED',
        shippedDate:     shippedDate ? new Date(shippedDate) : new Date(),
        shippingAddress: shippingAddress || null,
        courier:         courier || null,
        trackingNumber:  trackingNumber || null,
      },
    });

    res.json(updated);
  } catch (err) { next(err); }
};
```

In `server/routes/receivable.js`, add this route right after the `POST '/:id/void'` route (after line 33):

```js
router.post('/:id/ship', param('id').isInt(), validate, ctrl.markShipped);
```

In `lib/api.js`, inside the `receivable.invoices` object, add (after `update`, before `void`):

```js
    ship: (id, data) => api.post(`/receivable/${id}/ship`, data),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/receivableController.test.js`
Expected: PASS — all tests in the file (Task 1's 11 plus this task's 5).

- [ ] **Step 5: Commit**

```bash
git add server/controllers/receivableController.js server/routes/receivable.js lib/api.js tests/receivableController.test.js
git commit -m "feat(invoices): add markShipped endpoint for delivery status tracking"
```

---

### Task 5: Frontend — `ShippingModal` and delivery-status UI

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx` (imports; `STATUS_BADGE`-adjacent delivery badge in the list and detail modal; new `ShippingModal` component; row actions; modal render block)

**Interfaces:**
- Consumes: `rApi.invoices.ship(id, data)` (Task 4). `invoice.deliveryStatus`/`shippedDate`/`shippingAddress`/`courier`/`trackingNumber` (Task 3's fields, present on every invoice object returned by `listInvoices`/`getInvoice` once Task 3's migration is applied).
- Produces: nothing new consumed elsewhere — this is the UI leaf for Task 3/4's work.

- [ ] **Step 1: Add the `Truck` icon import**

Extend the same `lucide-react` import Task 2 already touched:

```js
import {
  Plus, Search, Eye, Ban, Filter, X,
  AlertCircle, Clock, CheckCircle2, FileText,
  Printer, ChevronDown, ChevronUp, Pencil, Truck,
} from 'lucide-react';
```

- [ ] **Step 2: Add a delivery-status badge next to the payment-status badge**

In the invoice list row (currently around line 958-961, inside the `<td>` that renders `STATUS_BADGE`):

```jsx
                    <td>
                      <span className={`${STATUS_BADGE[inv.status]} flex items-center gap-1 w-fit`}>
                        {STATUS_ICON[inv.status]} {inv.status}
                      </span>
                      {inv.deliveryStatus === 'SHIPPED' && (
                        <span className="badge badge-green text-xs ml-1">Shipped</span>
                      )}
                    </td>
```

In `InvoiceDetailModal`'s header (currently around lines 122-132, inside the `<div className="flex items-center gap-2">` that renders the status badge):

```jsx
          <div className="flex items-center gap-2">
            <span className={`${STATUS_BADGE[invoice.status]} flex items-center gap-1`}>
              {STATUS_ICON[invoice.status]} {invoice.status}
            </span>
            {invoice.deliveryStatus === 'SHIPPED' && (
              <span className="badge badge-green text-xs flex items-center gap-1">
                <Truck className="w-3 h-3" /> Shipped
              </span>
            )}
            {isOverdue && invoice.status !== 'VOID' && (
              <span className="badge-red flex items-center gap-1 text-xs">
                <AlertCircle className="w-3 h-3" /> Overdue
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
```

- [ ] **Step 3: Add a Ship button to `InvoiceDetailModal`'s footer**

Add `onShip` to the component's props (alongside the `onEdit` prop Task 2 added):

```js
function InvoiceDetailModal({ invoice, onClose, onCollect, onVoid, onEdit, onShip }) {
```

In the footer, add a Ship button next to Edit (available whenever the invoice isn't `VOID` — the outer `invoice.status === 'VOID' ? ... : (...)` branch already guarantees that):

```jsx
              {invoice.status !== 'PAID' && (
                <button onClick={onEdit} className="btn-secondary">
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              )}
              <button onClick={onShip} className="btn-secondary">
                <Truck className="w-4 h-4" /> {invoice.deliveryStatus === 'SHIPPED' ? 'Shipping Info' : 'Mark as Shipped'}
              </button>
              {invoice.status !== 'PAID' && (
                <button onClick={onCollect} className="btn-success">
                  <PesoSign className="w-4 h-4" /> Record Collection
                </button>
              )}
```

- [ ] **Step 4: Add the `ShippingModal` component**

Add this new component right after `CollectionModal` (after its closing `}`, before `CreateInvoiceModal`'s comment/declaration):

```jsx
// ─── Shipping Modal ─────────────────────────────────────────────
function ShippingModal({ invoice, onClose, onShipped }) {
  const [form, setForm] = useState({
    shippedDate:     invoice.shippedDate ? invoice.shippedDate.slice(0, 10) : new Date().toISOString().split('T')[0],
    shippingAddress: invoice.shippingAddress || invoice.customer?.address || '',
    courier:         invoice.courier || '',
    trackingNumber:  invoice.trackingNumber || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const alreadyShipped = invoice.deliveryStatus === 'SHIPPED';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await rApi.invoices.ship(invoice.id, form);
      toast.success(alreadyShipped ? 'Shipping info updated' : 'Invoice marked as shipped');
      onShipped();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update shipping info');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-lg">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{alreadyShipped ? 'Shipping Info' : 'Mark as Shipped'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-group">
              <label className="label">Ship Date *</label>
              <input type="date" className="input" required value={form.shippedDate} onChange={set('shippedDate')} />
            </div>
            <div className="form-group">
              <label className="label">Shipping Address</label>
              <textarea className="input resize-none" rows={2} value={form.shippingAddress} onChange={set('shippingAddress')} />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Courier</label>
                <input className="input" value={form.courier} onChange={set('courier')} placeholder="e.g. LBC, J&T Express" />
              </div>
              <div className="form-group">
                <label className="label">Tracking Number</label>
                <input className="input" value={form.trackingNumber} onChange={set('trackingNumber')} />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : (alreadyShipped ? 'Update Shipping Info' : 'Mark as Shipped')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire the Ship action into the invoice list's row actions**

Add a truck-icon button to the row actions (alongside Edit/Collect/Void), gated only by `inv.status !== 'VOID'` (shipping is available regardless of payment status):

```jsx
                        {inv.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await rApi.invoices.get(inv.id);
                              setModal({ type: 'ship', invoice: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title={inv.deliveryStatus === 'SHIPPED' ? 'Shipping info' : 'Mark as shipped'}
                          >
                            <Truck className="w-4 h-4" />
                          </button>
                        )}
```

Place it after the existing Void button in the row actions block (or anywhere in that `<div className="flex items-center justify-center gap-1">` — order is a visual preference, not a functional requirement).

- [ ] **Step 6: Wire `onShip` into `InvoiceDetailModal` and add the `'ship'` modal render block**

Add `onShip` to the existing `InvoiceDetailModal` usage:

```jsx
      {modal?.type === 'detail' && (
        <InvoiceDetailModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onCollect={() => setModal({ type: 'collect', invoice: modal.invoice })}
          onVoid={() => { handleVoid(modal.invoice); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', invoice: modal.invoice })}
          onShip={() => setModal({ type: 'ship', invoice: modal.invoice })}
        />
      )}
```

Add a new `'ship'` block after the `'edit'` block Task 2 added:

```jsx
      {modal?.type === 'ship' && (
        <ShippingModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onShipped={() => { setModal(null); load(); }}
        />
      )}
```

- [ ] **Step 7: Manually verify in the browser**

Using the same isolated worktree dev server pair from Task 2:

1. Navigate to `/receivable`, open any non-VOID invoice's detail — confirm the truck icon appears in row actions and "Mark as Shipped" appears in the detail modal footer.
2. Click it — modal opens titled "Mark as Shipped", Ship Date defaults to today, Shipping Address pre-fills from the customer's address (if the customer has one).
3. Fill in Courier and Tracking Number, submit — toast "Invoice marked as shipped", modal closes.
4. Confirm a green "Shipped" badge now appears next to the invoice's payment-status badge in both the list row and the detail modal header.
5. Re-open the same invoice's Ship action — confirm the modal now shows title "Shipping Info", button "Update Shipping Info", and the fields are pre-filled with what was just saved (not the customer's default address).
6. Change the tracking number and submit again — toast "Shipping info updated", confirm the change persisted on re-open.
7. Void an invoice (one with `paidAmount == 0`), confirm the truck icon disappears from that row and "Mark as Shipped" is not offered in its detail modal.
8. Confirm a `PAID` invoice can still be shipped (delivery status is independent of payment status) — the truck icon should still appear for a `PAID`, non-`VOID` invoice.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(invoices): add ShippingModal and delivery-status tracking UI"
```

---

## Self-Review Notes

- **Spec coverage:** Invoice edit design — eligibility rule (Task 1 Step 3), full-field editability (Task 2), total-vs-paidAmount guard (Task 1 tests/impl), status recompute (Task 1), GL void-then-repost via `reference`/`status: 'POSTED'` lookup (Task 1). Invoice shipping design — two-state `PENDING`/`SHIPPED` (Task 3 enum), no GL posting (Task 4 has none), shipping fields (Task 3), re-shippable/not-a-lock (Task 4 test), `VOID` guard (Task 4), delivery badge/ShippingModal/action wiring (Task 5).
- **Type consistency:** `rApi.invoices.update`/`rApi.invoices.ship` names match between Task 1/4's `lib/api.js` additions and Task 2/5's frontend usage. `deliveryStatus`/`shippedDate`/`shippingAddress`/`courier`/`trackingNumber` field names match exactly between Task 3's schema, Task 4's controller, and Task 5's frontend. Modal type strings (`'edit'`, `'ship'`) match between where they're set (row actions, detail modal callbacks) and where they're read (the render block).
- **Out of scope, confirmed not touched:** `DELIVERED` state beyond `SHIPPED`, per-line shipment, carrier API integration, any GL effect from shipping, an "unship" action, fixing the pre-existing unscoped `getInvoice`/`recordPayment`/`voidInvoice` lookups (noted as a known gap, not fixed here to avoid unrelated scope creep).
