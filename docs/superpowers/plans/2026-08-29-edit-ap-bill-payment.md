# Edit AP Bill Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ADMIN/MANAGER correct a wrong `PaymentAP` record on an AP Bill (date/amount/method/reference/notes), recomputing the bill's `paidAmount`/`status` and correcting the GL entry to match — fixing the "staff accidentally marked the bill fully paid" scenario with no prior way to undo it.

**Architecture:** New `PUT /api/payable/:id/payment/:paymentId` endpoint (`editPayment` in `payableController.js`), following the exact GL-void-then-repost pattern `updateBill` already uses via the shared `voidPostedEntriesByReference` helper — except keyed on the *payment's* `paymentNo` reference, not the bill's `billNo`. Frontend adds an edit-icon on each Payment History row in `BillDetailModal`, opening a pre-filled `EditPaymentModal` (same shape as the existing `PaymentModal`).

**Tech Stack:** Express, Prisma, express-validator, Jest (backend tests only — this repo has no frontend component tests, so the frontend task is verified manually in the browser per `CLAUDE.md`).

## Global Constraints

- Route restricted to `ADMIN`/`MANAGER` via `authorize('ADMIN','MANAGER')`, same as `voidBill`.
- Edit allowed even when the bill's own status is `PAID` — only blocked when the bill is `VOID`.
- `PaymentAP.paymentNo` never changes on edit.
- GL correction is best-effort/non-blocking (`glPost.safePost` convention) — a GL failure never fails the edit itself, only logs a `GL_POST_FAILED` audit entry.
- Full design reference: `docs/superpowers/specs/2026-08-29-edit-ap-bill-payment-design.md`.

---

### Task 1: Backend — `editPayment` endpoint

**Files:**
- Modify: `server/controllers/payableController.js` (add `exports.editPayment`, after `exports.updateBill` at line 306)
- Modify: `server/routes/payable.js` (add route, after the `PUT /:id` block at line 53)
- Test: `tests/payableControllerEditPayment.test.js` (new)

**Interfaces:**
- Consumes: `voidPostedEntriesByReference(businessId, reference, req, contextLabel)` — already defined in `payableController.js:312-333`, shared with `updateBill`/`voidBill`. `createError(message, statusCode)` from `server/middleware/errorHandler.js`. `glPost.safePost({ entryDate, description, reference, lines, userId, businessId })` from `server/utils/glPost.js`. `recordAudit({ action, entity, entityId, summary, user, businessId })` from `server/utils/audit.js`.
- Produces: `exports.editPayment(req, res, next)` — an Express handler taking `req.params.id` (bill id), `req.params.paymentId`, `req.body.{paymentDate, amount, paymentMethod, reference, notes}`, responding `200 { message: 'Payment updated', remainingBalance: number }` or throwing a `createError`-shaped error (`{ statusCode, message }`) for `next()`.

- [ ] **Step 1: Write the failing tests**

Create `tests/payableControllerEditPayment.test.js`:

```javascript
jest.mock('../server/config/database', () => ({
  bill: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  paymentAP: {
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

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
});

const basePayment = {
  id: 55, billId: 7, paymentNo: 'PAP-000055', paymentDate: new Date('2026-08-01'),
  amount: 1120, paymentMethod: 'Cash', reference: null, notes: null,
};

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'PAID',
  paidAmount: 1120, totalAmount: 1120,
  vendor: { name: 'Triplekenn Supply' },
  payments: [basePayment],
};

const editBody = { paymentDate: '2026-08-02', amount: 200, paymentMethod: 'Bank Transfer', reference: 'REF-1', notes: 'Corrected' };

describe('editPayment — eligibility', () => {
  test('404s when the bill does not exist (or belongs to another business)', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('only looks up the bill scoped to the current business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.bill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7, businessId: 1 }) })
    );
  });

  test('404s when the paymentId does not belong to this bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, payments: [{ ...basePayment, id: 999 }] });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects editing a payment on a VOID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('allows editing a payment on a PAID bill (the accidental-full-payment scenario)', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(prisma.bill.update).toHaveBeenCalled();
  });

  test('rejects when the corrected amount would exceed the bill total', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 5000 } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe('editPayment — recompute and status transitions', () => {
  test('drops a PAID bill back to PARTIAL when the corrected amount undershoots the total', async () => {
    // Single payment on the bill, corrected down from 1120 to 200 — remaining 920 > 0.01, so PARTIAL.
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 200 } });

    expect(billUpdateArgs.data.paidAmount).toBeCloseTo(200, 2);
    expect(billUpdateArgs.data.status).toBe('PARTIAL');
  });

  test('recomputes to OPEN when the corrected amount is effectively removed (rounds to 0)', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 0.01 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 0.01, status: 'OPEN' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 0.01 } });

    expect(billUpdateArgs.data.status).toBe('OPEN');
  });

  test('recomputes to PAID when a second payment plus the corrected amount exactly covers the total', async () => {
    const secondPayment = { id: 56, billId: 7, paymentNo: 'PAP-000056', paymentDate: new Date('2026-08-05'), amount: 400, paymentMethod: 'Cash', reference: null, notes: null };
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 600, totalAmount: 1120, payments: [{ ...basePayment, amount: 200 }, secondPayment] });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 720 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 1120, status: 'PAID' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    // otherPaid = 600 - 200 = 400 (the untouched second payment); newPaid = 400 + 720 = 1120 = totalAmount
    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 720 } });

    expect(billUpdateArgs.data.paidAmount).toBeCloseTo(1120, 2);
    expect(billUpdateArgs.data.status).toBe('PAID');
  });
});

describe('editPayment — writes', () => {
  test('updates the PaymentAP row with all editable fields', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => {
      paymentUpdateArgs = args;
      return Promise.resolve({ ...basePayment, ...args.data });
    });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(paymentUpdateArgs.where).toEqual({ id: 55 });
    expect(paymentUpdateArgs.data).toMatchObject({
      amount: 200, paymentMethod: 'Bank Transfer', reference: 'REF-1', notes: 'Corrected',
    });
    expect(paymentUpdateArgs.data.paymentDate).toEqual(new Date('2026-08-02'));
  });
});

describe('editPayment — GL correction', () => {
  test('voids prior POSTED entries keyed on the payment\'s own paymentNo (not the bill\'s billNo) and posts one fresh entry', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 200, entryNo: 'JE-1-000200' }]);
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'PAP-000055', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 200 }, data: { status: 'VOIDED' } }));

    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('PAP-000055');
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.debit).toBeCloseTo(200, 2);
    const cashLine = call.lines.find((l) => l.accountCode === '1020');
    expect(cashLine.credit).toBeCloseTo(200, 2);
  });

  test('records a GL_POST_FAILED audit entry when the GL correction is skipped rather than posted', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ skipped: 'PRE_CUTOVER' });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'GL_POST_FAILED',
      entity: 'JournalEntry',
      entityId: 'PAP-000055',
    }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/payableControllerEditPayment.test.js`
Expected: FAIL — `ctrl.editPayment is not a function` (or `TypeError: fn is not a function` from the `run` helper).

- [ ] **Step 3: Implement `editPayment` in `payableController.js`**

Add after `exports.updateBill` (after line 306, before the `voidPostedEntriesByReference` helper at line 308):

```javascript
exports.editPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const paymentId = Number(req.params.paymentId);
    const bill = await prisma.bill.findFirst({
      where: { id, businessId: req.businessId },
      include: { payments: true, vendor: true },
    });
    if (!bill) throw createError('Bill not found', 404);

    const payment = bill.payments.find((p) => p.id === paymentId);
    if (!payment) throw createError('Payment not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot edit a payment on a voided bill.', 400);

    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
    const newPaid = otherPaid + Number(amount);

    if (newPaid > Number(bill.totalAmount) + 0.01) {
      throw createError(
        `Amount exceeds bill total. Balance available for this payment: ₱${(Number(bill.totalAmount) - otherPaid).toFixed(2)}.`,
        400
      );
    }

    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : (newPaid > 0.01 ? 'PARTIAL' : 'OPEN');

    await prisma.$transaction([
      prisma.paymentAP.update({
        where: { id: paymentId },
        data: { paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes },
      }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── GL correction: void the payment's own prior entry, post a fresh one ──
    await voidPostedEntriesByReference(bill.businessId, payment.paymentNo, req, 'PAYMENT EDIT');
    const glResult = await glPost.safePost({
      entryDate:   paymentDate,
      description: `AP Payment (Edited) — ${bill.vendor.name} (${bill.billNo})`,
      reference:   payment.paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${bill.vendor.name}` },
        { accountCode: '1020', credit: Number(amount), description: `Cash out — ${payment.paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });
    if (!glResult || glResult.skipped) {
      try {
        await recordAudit({
          action:     'GL_POST_FAILED',
          entity:     'JournalEntry',
          entityId:   payment.paymentNo,
          summary:    `Payment ${payment.paymentNo} was edited but its corrected GL entry did not post (${glResult?.skipped ? `skipped: ${glResult.skipped}` : 'failed'}) — its AP/cash impact may be missing from the ledger.`,
          user:       req.user?.id ? { id: req.user.id } : undefined,
          businessId: req.businessId,
        });
      } catch { /* auditing must never break anything either */ }
    }

    res.json({ message: 'Payment updated', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};
```

Note: `voidPostedEntriesByReference` is defined lower in the file (currently line 312) but that's fine — function declarations are hoisted, and `updateBill` above already calls it the same way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/payableControllerEditPayment.test.js`
Expected: PASS — all `describe` blocks green.

- [ ] **Step 5: Add the route**

In `server/routes/payable.js`, add after the `router.put('/:id', ...)` block (after line 53, before `router.post('/:id/void', ...)`):

```javascript
router.put('/:id/payment/:paymentId',
  authorize('ADMIN','MANAGER'),
  [
    param('id').isInt(),
    param('paymentId').isInt(),
    body('paymentDate').isISO8601(),
    body('amount').isFloat({ min: 0.01 }),
    body('paymentMethod').notEmpty(),
  ],
  validate, ctrl.editPayment);
```

- [ ] **Step 6: Run the full backend test suite to check for regressions**

Run: `npx jest tests/payableController`
Expected: PASS — all existing `payableController*` test files plus the new one green.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/payableController.js server/routes/payable.js tests/payableControllerEditPayment.test.js
git commit -m "$(cat <<'EOF'
feat(payable): let ADMIN/MANAGER edit a wrong AP bill payment

Bills had no way to correct a mistaken PaymentAP record (e.g. staff
marking a bill fully paid when the real amount was smaller). Adds
PUT /payable/:id/payment/:paymentId, recomputing paidAmount/status
and correcting the GL entry via the same void-then-repost pattern
updateBill already uses, keyed on the payment's own paymentNo.
EOF
)"
```

---

### Task 2: Frontend — Edit Payment UI

**Files:**
- Modify: `lib/api.js:210-218` (add `editPayment` to the `bills` object)
- Modify: `app/(dashboard)/payable/page.jsx` (add edit icon to Payment History rows, new `EditPaymentModal`, modal-state wiring)

**Interfaces:**
- Consumes: `pApi.bills.editPayment(billId, paymentId, data)` (defined in this task's first step) → `PUT /payable/:id/payment/:paymentId`, returning `{ message, remainingBalance }` per Task 1. `PaymentModal`'s existing structure (`page.jsx:234-326`) as the template for `EditPaymentModal`.
- Produces: `EditPaymentModal({ bill, payment, onClose, onSaved })` component; `BillDetailModal`'s prop list grows to include `onEditPayment`.

- [ ] **Step 1: Add the API helper**

In `lib/api.js`, inside the `bills` object (after the `payment:` line at `lib/api.js:215`):

```javascript
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    editPayment: (id, paymentId, data) => api.put(`/payable/${id}/payment/${paymentId}`, data),
```

- [ ] **Step 2: Add the edit icon to Payment History rows**

In `app/(dashboard)/payable/page.jsx`, `BillDetailModal`'s signature changes from:

```javascript
function BillDetailModal({ bill, onClose, onPayment, onVoid, onEdit }) {
```
to:
```javascript
function BillDetailModal({ bill, onClose, onPayment, onVoid, onEdit, onEditPayment }) {
```

Then replace the Payment History block (`page.jsx:182-198`):

```javascript
          {/* Payment history */}
          {bill.payments?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h4>
              <div className="space-y-2">
                {bill.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{formatCurrency(p.amount)}</span>
                      <span className="text-gray-500 ml-2">via {p.paymentMethod}</span>
                      {p.reference && <span className="text-gray-400 ml-2 text-xs">Ref: {p.reference}</span>}
                    </div>
                    <span className="text-gray-400 text-xs">{formatDate(p.paymentDate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
```

with:

```javascript
          {/* Payment history */}
          {bill.payments?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h4>
              <div className="space-y-2">
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
              </div>
            </div>
          )}
```

- [ ] **Step 3: Add `EditPaymentModal`**

In `app/(dashboard)/payable/page.jsx`, insert after the closing brace of `PaymentModal` (after `page.jsx:326`):

```javascript
// ─── Edit Payment Modal ───────────────────────────────────────
function EditPaymentModal({ bill, payment, onClose, onSaved }) {
  const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
  const balance = Number(bill.totalAmount) - otherPaid;
  const [form, setForm] = useState({
    paymentDate: payment.paymentDate.slice(0, 10),
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod,
    reference: payment.reference || '',
    notes: payment.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!(Number(form.amount) > 0)) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.editPayment(bill.id, payment.id, { ...form, amount: Number(form.amount) });
      toast.success('Payment updated successfully');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Edit Payment</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Bill</span><span className="font-medium">{bill.billNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Vendor</span><span>{bill.vendor?.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Total Amount</span><span className="font-medium">{formatCurrency(bill.totalAmount)}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1 text-base"><span>Max for this payment</span><span className="text-red-600">{formatCurrency(balance)}</span></div>
            </div>

            <div className="form-group">
              <label className="label">Payment Date *</label>
              <input type="date" className="input" required value={form.paymentDate} onChange={set('paymentDate')} />
            </div>

            <div className="form-group">
              <label className="label">Amount (₱) *</label>
              <NumberInput className="input" required placeholder="0.00"
                value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              <p className="text-xs text-gray-400 mt-1">Max: {formatCurrency(balance)}</p>
            </div>

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

            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-success">
              <Pencil className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire modal state in `BillsPage`**

Find the `modal?.type === 'detail'` block (`page.jsx:971-979`):

```javascript
      {modal?.type === 'detail' && (
        <BillDetailModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPayment={() => setModal({ type: 'payment', bill: modal.bill })}
          onVoid={() => { handleVoid(modal.bill); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', bill: modal.bill })}
        />
      )}
```

Add `onEditPayment`:

```javascript
      {modal?.type === 'detail' && (
        <BillDetailModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPayment={() => setModal({ type: 'payment', bill: modal.bill })}
          onVoid={() => { handleVoid(modal.bill); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', bill: modal.bill })}
          onEditPayment={(payment) => setModal({ type: 'editPayment', bill: modal.bill, payment })}
        />
      )}
```

Then, immediately after the `modal?.type === 'payment'` block (`page.jsx:980-986`), add a sibling block — `load()` is this file's existing reload function, already used by every other modal's `onSaved`/`onPaid` callback (`page.jsx:957`, `967`, `984`):

```javascript
      {modal?.type === 'payment' && (
        <PaymentModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPaid={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'editPayment' && (
        <EditPaymentModal
          bill={modal.bill}
          payment={modal.payment}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
```

- [ ] **Step 5: Manual verification in the browser**

The user runs their own dev server (`npm run dev`) — do not start a competing instance (check `netstat -ano | findstr :3000` or just ask the user to confirm it's running rather than launching one). With it up:

1. Navigate to Accounts Payable, open a bill that is fully `PAID` (or create one and pay it in full).
2. Open the bill detail, confirm each Payment History row now shows a pencil icon.
3. Click it, confirm the Edit Payment modal opens pre-filled with that payment's date/amount/method/reference/notes.
4. Reduce the amount (e.g. from the full total down to a small partial amount), submit.
5. Confirm: success toast, the modal closes, the bill list/detail now shows status `PARTIAL` (or `OPEN` if reduced to near-zero) with the corrected `paidAmount`, and the Payment History row reflects the new amount.
6. Reopen the bill detail and check the browser network tab / General Ledger page (if available) to confirm the AP payment's journal entry reflects the corrected amount, not the original.
7. Log in as (or switch to) a non-ADMIN/MANAGER role and confirm attempting the edit returns the expected 403 toast.

- [ ] **Step 6: Commit**

```bash
git add lib/api.js "app/(dashboard)/payable/page.jsx"
git commit -m "$(cat <<'EOF'
feat(payable): add Edit Payment UI to AP bill detail

Adds a pencil icon on each Payment History row (shown even on a PAID
bill) opening a pre-filled modal that calls the new
PUT /payable/:id/payment/:paymentId endpoint, so a wrong payment
amount/date/method can be corrected without voiding the whole bill.
EOF
)"
```
