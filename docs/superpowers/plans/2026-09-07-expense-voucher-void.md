# Expense Voucher Void Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Void action to Expense Vouchers that cancels a `SUBMITTED`/`APPROVED`/`PAID` voucher and, for a `PAID` voucher, reverses its posted GL entry.

**Architecture:** Follows the existing void pattern already used for Bills (`payableController.voidBill`), Invoices (`receivableController.voidInvoice`), and Cash Sales (`cashSaleController.voidSale`): a new controller action flips `status` to `VOID`, stores the reason, and — if the record had posted GL impact — flips the matching `JournalEntry` to `VOIDED` without ever letting a GL-side failure block the status change itself.

**Tech Stack:** Next.js 14 (App Router) + Express.js + MySQL 8 + Prisma ORM 5, Jest for backend controller tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-07-expense-voucher-void-design.md`.
- Void is allowed only from `SUBMITTED`, `APPROVED`, or `PAID` (`DRAFT`/`REJECTED` keep using the existing Delete button; `VOID` cannot be re-voided).
- A non-empty `reason` is required (backend 400s without one, matching `cashSaleController.voidSale`).
- Void route uses the same `authorize('ADMIN', 'MANAGER')` gate as approve/pay/reject (the `approve` middleware alias already defined in `server/routes/expense.js`).
- **Windows/Prisma constraint (from project memory):** `npm run db:migrate` can fail with `EPERM` on the generated Prisma Client `.dll` if the dev server (`npm run dev`) is running and holding a lock. The dev server is owned by the user — never start or stop it yourself. Before running the migration in Task 1, ask the user to stop `npm run dev` if it's running, and let them know they can restart it once the migration finishes.
- No automated frontend test harness exists in this repo (no `@testing-library/react`); Task 3 is verified manually in the browser per `CLAUDE.md`.

---

## Task 1: Schema — add VOID status and voided fields to ExpenseVoucher

**Files:**
- Modify: `prisma/schema.prisma:733-773`

**Interfaces:**
- Produces: `ExpenseStatus.VOID` enum value; `ExpenseVoucher.voidedReason` (`String?`), `ExpenseVoucher.voidedAt` (`DateTime?`) — consumed by Task 2's controller.

**Deviation from spec:** the design doc proposed a `voidedBy String?` field, but the approved UI (Task 3) reuses the reason-only drawer from Reject — there's no "voided by" name input, so `voidedBy` would always be `null`. `CashSale` already has this exact precedent (`voidedReason` + `voidedAt`, no `voidedBy` — see `prisma/schema.prisma:1201-1202`), so this plan uses `voidedAt` instead: it's actually populated, and matches the nearest existing analog.

- [ ] **Step 1: Edit the `ExpenseStatus` enum**

In `prisma/schema.prisma`, find:

```prisma
enum ExpenseStatus {
  DRAFT
  SUBMITTED
  APPROVED
  PAID
  REJECTED
}
```

Replace with:

```prisma
enum ExpenseStatus {
  DRAFT
  SUBMITTED
  APPROVED
  PAID
  REJECTED
  VOID
}
```

- [ ] **Step 2: Add voided fields to the `ExpenseVoucher` model**

Find (inside `model ExpenseVoucher`):

```prisma
  rejectedReason String?              @db.Text
  notes          String?              @db.Text
```

Replace with:

```prisma
  rejectedReason String?              @db.Text
  voidedReason   String?              @db.Text
  voidedAt       DateTime?
  notes          String?              @db.Text
```

- [ ] **Step 3: Ask the user to stop the dev server if it's running**

Say to the user: "About to run a Prisma migration — if `npm run dev` is currently running, please stop it first (Windows locks the generated Prisma Client DLL while it's up). Let me know when it's stopped, or if it's already down."

Wait for confirmation before proceeding to Step 4.

- [ ] **Step 4: Generate and apply the migration**

Run: `npm run db:migrate -- --name add_expense_voucher_void`

Expected: Prisma prints a new migration folder name under `prisma/migrations/` (timestamp-prefixed, e.g. `..._add_expense_voucher_void`) and ends with `Your database is now in sync with your schema.` The Prisma Client regenerates automatically as part of this command.

- [ ] **Step 5: Tell the user the dev server can be restarted**

Say to the user: "Migration applied. You can restart `npm run dev` now."

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(expense): add VOID status and voided fields to ExpenseVoucher"
```

---

## Task 2: Backend — voidExpense controller, route, and API helper

**Files:**
- Modify: `server/controllers/expenseController.js:1-5` (add `logger` import)
- Modify: `server/controllers/expenseController.js:409-427` (insert `voidExpense` between `reject` and `remove`)
- Modify: `server/routes/expense.js:19-20` (add void route)
- Modify: `lib/api.js:348-349` (add `void` API helper)
- Test: `tests/expenseControllerVoidExpense.test.js`

**Interfaces:**
- Consumes: `prisma.expenseVoucher.findUnique({ where: { id } })`, `prisma.expenseVoucher.update(...)`, `prisma.cashRequest.findUnique({ where: { id }, select: { requestNo: true } })`, `prisma.journalEntry.findFirst(...)`, `prisma.journalEntry.update(...)`, `recordAudit(...)` from `../utils/audit`, `createError(message, statusCode)` from `../middleware/errorHandler`, `logger.error(...)` from `../utils/logger` — all already used elsewhere in this file/sibling controllers.
- Produces: `exports.void(req, res, next)` in `server/controllers/expenseController.js`; route `POST /api/expenses/:id/void`; `expenses.void(id, reason)` in `lib/api.js` returning the axios promise for `api.post('/expenses/${id}/void', { reason })`.

**Key correctness detail:** a `LIQUIDATION`-type voucher's GL entry is posted with `reference` set to its linked `CashRequest.requestNo` — **not** the voucher's own `voucherNo` (see `expenseController.pay()`'s `linkedRequest` branch, and `cashRequestController.js:359-366` where a liquidation voucher is created already `PAID` and posted under `cr.requestNo`). Voiding a `PAID` voucher must look up the correct reference: use the linked cash request's `requestNo` when `voucher.cashRequestId` is set, otherwise fall back to `voucher.voucherNo`.

- [ ] **Step 1: Write the failing test**

Create `tests/expenseControllerVoidExpense.test.js`:

```js
jest.mock('../server/config/database', () => ({
  expenseVoucher: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  cashRequest: {
    findUnique: jest.fn(),
  },
  journalEntry: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn(), diff: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/expenseController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseVoucher = {
  id: 12, businessId: 1, voucherNo: 'EV-000012', type: 'PETTY_CASH',
  status: 'SUBMITTED', totalAmount: 1500, cashRequestId: null,
};

describe('voidExpense', () => {
  test('rejects when no reason is given', async () => {
    await expect(run(ctrl.void, { params: { id: '12' }, body: {} }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('404s when the voucher does not exist', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.void, { params: { id: '999' }, body: { reason: 'x' } }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects voiding a DRAFT voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'DRAFT' });
    await expect(run(ctrl.void, { params: { id: '12' }, body: { reason: 'test' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.expenseVoucher.update).not.toHaveBeenCalled();
  });

  test('rejects voiding an already-VOID voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    await expect(run(ctrl.void, { params: { id: '12' }, body: { reason: 'test' } }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('voids a SUBMITTED voucher without touching the GL', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'SUBMITTED' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID', voidedReason: 'duplicate entry' });

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'duplicate entry' } });

    expect(prisma.expenseVoucher.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { status: 'VOID', voidedReason: 'duplicate entry', voidedAt: expect.any(Date) },
    });
    expect(prisma.journalEntry.findFirst).not.toHaveBeenCalled();
  });

  test('voids the POSTED journal entry (by voucherNo) for a PAID non-liquidation voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 55 });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { businessId: 1, reference: 'EV-000012', status: 'POSTED' },
    });
    expect(prisma.journalEntry.update).toHaveBeenCalledWith({ where: { id: 55 }, data: { status: 'VOIDED' } });
    expect(prisma.cashRequest.findUnique).not.toHaveBeenCalled();
  });

  test('voids the POSTED journal entry by the linked cash request\'s requestNo for a PAID liquidation voucher', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID', type: 'LIQUIDATION', cashRequestId: 9 });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.cashRequest.findUnique.mockResolvedValue({ requestNo: 'CR-000009' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 77 });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'wrong liquidation' } });

    expect(prisma.cashRequest.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { requestNo: true } });
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
      where: { businessId: 1, reference: 'CR-000009', status: 'POSTED' },
    });
    expect(prisma.journalEntry.update).toHaveBeenCalledWith({ where: { id: 77 }, data: { status: 'VOIDED' } });
  });

  test('a GL-void failure does not block the voucher status change', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 55 });
    prisma.journalEntry.update.mockRejectedValue(new Error('db hiccup'));

    const result = await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(result.status).toBe('VOID');
  });

  test('proceeds without error when no prior POSTED entry is found', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ ...baseVoucher, status: 'PAID' });
    prisma.expenseVoucher.update.mockResolvedValue({ ...baseVoucher, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue(null);

    await run(ctrl.void, { params: { id: '12' }, body: { reason: 'overpaid' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/expenseControllerVoidExpense.test.js`
Expected: FAIL — `ctrl.void is not a function` (or similar `TypeError`), since `void` doesn't exist yet.

- [ ] **Step 3: Add the `logger` import**

In `server/controllers/expenseController.js`, find:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { buildLiquidationEntry } = require('../utils/cashAdvance');
const { recordAudit, diff } = require('../utils/audit');
```

Replace with:

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { buildLiquidationEntry } = require('../utils/cashAdvance');
const { recordAudit, diff } = require('../utils/audit');
const logger = require('../utils/logger');
```

- [ ] **Step 4: Implement `voidExpense`**

In `server/controllers/expenseController.js`, find the boundary between `reject` and `remove`:

```js
    await recordAudit({
      req, action: 'REJECT', entity: 'ExpenseVoucher', entityId: id,
      summary: `Rejected ${updated.voucherNo}${rejectedReason ? `: ${rejectedReason}` : ''}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft/rejected only) ────────────────────────────────
```

Replace with:

```js
    await recordAudit({
      req, action: 'REJECT', entity: 'ExpenseVoucher', entityId: id,
      summary: `Rejected ${updated.voucherNo}${rejectedReason ? `: ${rejectedReason}` : ''}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Void ─────────────────────────────────────────────────────────
// A LIQUIDATION voucher's GL entry is posted under its linked cash
// request's requestNo, not the voucher's own voucherNo — see pay()'s
// linkedRequest branch and cashRequestController.liquidate. The GL
// lookup below must match whichever reference was actually posted.
exports.void = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const voucher = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!voucher) throw createError('Expense voucher not found', 404);
    if (!['SUBMITTED', 'APPROVED', 'PAID'].includes(voucher.status)) {
      throw createError('Only SUBMITTED, APPROVED, or PAID vouchers can be voided', 400);
    }

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
    });

    if (voucher.status === 'PAID') {
      let reference = voucher.voucherNo;
      if (voucher.cashRequestId) {
        const cashRequest = await prisma.cashRequest.findUnique({
          where: { id: voucher.cashRequestId },
          select: { requestNo: true },
        });
        if (cashRequest) reference = cashRequest.requestNo;
      }

      const entry = await prisma.journalEntry.findFirst({
        where: { businessId: voucher.businessId, reference, status: 'POSTED' },
      });
      if (entry) {
        try {
          await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
        } catch (err) {
          logger.error(`[EXPENSE VOID — GL VOID FAILED] voucherNo=${voucher.voucherNo} biz=${voucher.businessId} — ${err.message}`);
          try {
            await recordAudit({
              action:     'GL_POST_FAILED',
              entity:     'JournalEntry',
              entityId:   String(entry.id),
              summary:    `Failed to void GL entry for voided expense voucher ${voucher.voucherNo} — ${err.message}`,
              user:       req.user?.id ? { id: req.user.id } : undefined,
              businessId: voucher.businessId,
            });
          } catch { /* auditing must never break anything either */ }
        }
      }
    }

    await recordAudit({
      req, action: 'VOID', entity: 'ExpenseVoucher', entityId: id,
      summary: `Voided ${voucher.voucherNo}: ${reason}`,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft/rejected only) ────────────────────────────────
```

Note: the exported name is `exports.void` (matches `journalController.void` — a reserved word is valid as an object property name in JS). The route and API helper below both call it as `ctrl.void`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest tests/expenseControllerVoidExpense.test.js`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Add the route**

In `server/routes/expense.js`, find:

```js
router.post('/:id/reject',       approve, ctrl.reject);
router.delete('/:id',            write,   ctrl.remove);
```

Replace with:

```js
router.post('/:id/reject',       approve, ctrl.reject);
router.post('/:id/void',         approve, ctrl.void);
router.delete('/:id',            write,   ctrl.remove);
```

- [ ] **Step 7: Add the API helper**

In `lib/api.js`, find:

```js
  reject:     (id, data)   => api.post(`/expenses/${id}/reject`, data),
  remove:     (id)         => api.delete(`/expenses/${id}`),
```

Replace with:

```js
  reject:     (id, data)   => api.post(`/expenses/${id}/reject`, data),
  void:       (id, reason) => api.post(`/expenses/${id}/void`, { reason }),
  remove:     (id)         => api.delete(`/expenses/${id}`),
```

- [ ] **Step 8: Run the full test file once more**

Run: `npx jest tests/expenseControllerVoidExpense.test.js`
Expected: PASS (confirms the route/API edits didn't touch anything the test imports — no behavior change expected here).

- [ ] **Step 9: Commit**

```bash
git add server/controllers/expenseController.js server/routes/expense.js lib/api.js tests/expenseControllerVoidExpense.test.js
git commit -m "feat(expense): add voidExpense controller, route, and API helper"
```

---

## Task 3: Frontend — Void button and drawer wiring

**Files:**
- Modify: `app/(dashboard)/expenses/page.jsx`

**Interfaces:**
- Consumes: `expApi.void(id, reason)` from Task 2 (`lib/api.js`).

- [ ] **Step 1: Import the `Ban` icon**

Find:

```js
import {
  Plus, X, Printer, RefreshCw, Trash2, Send, CheckCircle2,
  Banknote, AlertCircle, Edit2, Search, Wallet, ChevronDown,
  FileText, History,
} from 'lucide-react';
```

Replace with:

```js
import {
  Plus, X, Printer, RefreshCw, Trash2, Send, CheckCircle2,
  Banknote, AlertCircle, Edit2, Search, Wallet, ChevronDown,
  FileText, History, Ban,
} from 'lucide-react';
```

- [ ] **Step 2: Add the VOID status badge**

Find:

```js
const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SUBMITTED: 'badge-yellow',
  APPROVED:  'badge-blue',
  PAID:      'badge-green',
  REJECTED:  'badge-red',
};
```

Replace with:

```js
const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SUBMITTED: 'badge-yellow',
  APPROVED:  'badge-blue',
  PAID:      'badge-green',
  REJECTED:  'badge-red',
  VOID:      'badge-gray',
};
```

- [ ] **Step 3: Add `void` to the action drawer config**

Find:

```js
  const actionConfig = {
    submit:  { title: 'Submit for Approval', btnLabel: 'Submit',  btnClass: 'btn-primary', fieldLabel: 'Submitted By' },
    approve: { title: 'Approve Voucher',     btnLabel: 'Approve', btnClass: 'btn-success', fieldLabel: 'Approved By'  },
    pay:     { title: 'Mark as Paid',        btnLabel: 'Mark Paid', btnClass: 'btn-success', fieldLabel: 'Paid By'    },
    reject:  { title: 'Reject Voucher',      btnLabel: 'Reject',  btnClass: 'btn-danger',  fieldLabel: 'Reason'       },
  };
```

Replace with:

```js
  const actionConfig = {
    submit:  { title: 'Submit for Approval', btnLabel: 'Submit',  btnClass: 'btn-primary', fieldLabel: 'Submitted By' },
    approve: { title: 'Approve Voucher',     btnLabel: 'Approve', btnClass: 'btn-success', fieldLabel: 'Approved By'  },
    pay:     { title: 'Mark as Paid',        btnLabel: 'Mark Paid', btnClass: 'btn-success', fieldLabel: 'Paid By'    },
    reject:  { title: 'Reject Voucher',      btnLabel: 'Reject',  btnClass: 'btn-danger',  fieldLabel: 'Reason'       },
    void:    { title: 'Void Voucher',        btnLabel: 'Void Voucher', btnClass: 'btn-danger', fieldLabel: 'Reason'  },
  };
```

- [ ] **Step 4: Validate and submit the void reason in `handleAction`**

Find:

```js
    if (actionMode === 'approve') {
      if (!actionItems.length) { toast.error('At least one line item is required'); return; }
      if (actionItems.some(it => !it.description || !Number(it.amount))) { toast.error('Each line item needs a description and amount'); return; }
    }
    try {
      if (actionMode === 'submit')  await expApi.submit(id,  { requestedBy: actionForm.name });
      if (actionMode === 'approve') await expApi.approve(id, { approvedBy: actionForm.name, items: actionItems.map(it => ({ ...it, amount: Number(it.amount) })) });
      if (actionMode === 'pay')     await expApi.pay(id,     { paidBy: actionForm.name, paidDate: actionForm.date, paymentAccountCode: actionForm.paymentAccountCode });
      if (actionMode === 'reject')  await expApi.reject(id,  { rejectedReason: actionForm.reason });
      toast.success(`Voucher ${actionMode}${actionMode === 'pay' ? 'd' : 'ed'}`);
```

Replace with:

```js
    if (actionMode === 'approve') {
      if (!actionItems.length) { toast.error('At least one line item is required'); return; }
      if (actionItems.some(it => !it.description || !Number(it.amount))) { toast.error('Each line item needs a description and amount'); return; }
    }
    if (actionMode === 'void' && !actionForm.reason.trim()) { toast.error('A reason is required to void this voucher'); return; }
    try {
      if (actionMode === 'submit')  await expApi.submit(id,  { requestedBy: actionForm.name });
      if (actionMode === 'approve') await expApi.approve(id, { approvedBy: actionForm.name, items: actionItems.map(it => ({ ...it, amount: Number(it.amount) })) });
      if (actionMode === 'pay')     await expApi.pay(id,     { paidBy: actionForm.name, paidDate: actionForm.date, paymentAccountCode: actionForm.paymentAccountCode });
      if (actionMode === 'reject')  await expApi.reject(id,  { rejectedReason: actionForm.reason });
      if (actionMode === 'void')    await expApi.void(id,    actionForm.reason);
      toast.success(`Voucher ${actionMode}${actionMode === 'pay' ? 'd' : 'ed'}`);
```

- [ ] **Step 5: Add the Void row action**

Find:

```js
                        {v.status === 'APPROVED'  && <button className="btn-success btn-sm"  onClick={() => openAction('pay',     v)} title="Mark Paid"><Banknote className="w-3 h-3" /></button>}
                        <button className="btn-secondary btn-sm" onClick={() => printVoucher(v)} title="Print"><Printer className="w-3 h-3" /></button>
```

Replace with:

```js
                        {v.status === 'APPROVED'  && <button className="btn-success btn-sm"  onClick={() => openAction('pay',     v)} title="Mark Paid"><Banknote className="w-3 h-3" /></button>}
                        {['SUBMITTED','APPROVED','PAID'].includes(v.status) && <button className="btn-danger btn-sm" onClick={() => openAction('void', v)} title="Void"><Ban className="w-3 h-3" /></button>}
                        <button className="btn-secondary btn-sm" onClick={() => printVoucher(v)} title="Print"><Printer className="w-3 h-3" /></button>
```

- [ ] **Step 6: Add `VOID` to the status filter dropdown**

Find:

```js
              {['DRAFT','SUBMITTED','APPROVED','PAID','REJECTED'].map(s => <option key={s} value={s}>{s}</option>)}
```

Replace with:

```js
              {['DRAFT','SUBMITTED','APPROVED','PAID','REJECTED','VOID'].map(s => <option key={s} value={s}>{s}</option>)}
```

- [ ] **Step 7: Reuse the reason textarea for `void`, with a mode-aware placeholder**

Find:

```js
            {actionMode !== 'reject' ? (
              <>
```

Replace with:

```js
            {(actionMode !== 'reject' && actionMode !== 'void') ? (
              <>
```

Then find:

```js
            ) : (
              <div className="form-group">
                <label className="label">Reason for Rejection *</label>
                <textarea className="input h-24 resize-none" value={actionForm.reason}
                  onChange={e => setActionForm(p => ({ ...p, reason: e.target.value }))} placeholder="Explain why this voucher is being rejected…" />
              </div>
            )}
```

Replace with:

```js
            ) : (
              <div className="form-group">
                <label className="label">{actionMode === 'void' ? 'Reason for Voiding *' : 'Reason for Rejection *'}</label>
                <textarea className="input h-24 resize-none" value={actionForm.reason}
                  onChange={e => setActionForm(p => ({ ...p, reason: e.target.value }))}
                  placeholder={actionMode === 'void' ? 'Explain why this voucher is being voided…' : 'Explain why this voucher is being rejected…'} />
              </div>
            )}
```

- [ ] **Step 8: Manual verification in the browser**

The dev server must already be running (owned by the user — don't start a competing instance; ask them to run `npm run dev` if it's down).

1. Navigate to `/expenses`.
2. Create a new voucher, submit it, approve it (status becomes `APPROVED`) — confirm a red Void button (Ban icon) now appears alongside Mark Paid.
3. Click Void, leave the reason blank, click "Void Voucher" — confirm the toast "A reason is required to void this voucher" appears and nothing is submitted.
4. Fill in a reason and confirm — confirm the row's status badge becomes `VOID` (gray) and the Void/Mark Paid buttons disappear from that row (only Print/History remain).
5. Open History for that voucher — confirm a `VOID` entry with the reason appears.
6. Repeat end-to-end for a `PAID` voucher: submit → approve → mark paid → void. After voiding, open **General Ledger / Journal Entries** and confirm the journal entry whose reference is that voucher's number now shows status `VOIDED`, and check the Trial Balance / Income Statement no longer include that voucher's amounts.
7. Confirm a `PAID` voucher still shows `Print` and `History` after voiding, but no Edit/Delete/Pay/Void buttons.

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/expenses/page.jsx"
git commit -m "feat(expense): add Void button and drawer flow to Expense Vouchers UI"
```

---

## Out of Scope (documented, not implemented)

- Voiding a `LIQUIDATION`-type voucher does **not** revert its linked `CashRequest.status` from `LIQUIDATED` back to an earlier state. The cash request will remain marked liquidated even after its liquidation voucher is voided. This mirrors how voiding a Bill/Invoice doesn't unwind other derived state, and reopening cash-advance lifecycle handling is a separate feature.
- The Daily Remittance report requires no change — it already filters expense vouchers with an explicit `status: { in: ['APPROVED', 'PAID'] }` allowlist (`server/controllers/dailyRemittanceController.js:64`), so `VOID` vouchers are excluded automatically.
