# Cash Request (Cash Advance & Liquidation) — Design

**Date:** 2026-08-03
**Status:** Approved

## Goal

Let staff file a **cash request form** for money they need before making a
purchase (typically materials), route it through approval, release the cash,
and settle it against receipts. Until settled, the amount must be visible as an
outstanding accountability — "kinsa pa'y naa'y hawak nga kwarta."

## Problem in the current code

`ExpenseType` already contains `CASH_ADVANCE` and `LIQUIDATION`
(`prisma/schema.prisma:685`) and both are already selectable in the Expense
Voucher UI (`app/(dashboard)/expenses/page.jsx:23-24`). But the GL posting in
`server/controllers/expenseController.js:264-292` treats every voucher type
identically — debit the expense/category account, credit cash. So today:

- A `CASH_ADVANCE` posts **DR Expense / CR Cash**. An advance is not an expense
  yet; it is a receivable from the person holding the cash.
- A `LIQUIDATION` would then post the same expense a **second** time.
- Account `1104 Advances to Officers & Employees` is seeded (`prisma/seed.js:49`)
  but referenced nowhere in the codebase.

This is a live accounting defect independent of the new feature, and this design
fixes it.

## Decision

**Hybrid model.** A new `CashRequest` owns the request → approval → release
stage. The liquidation reuses the existing `ExpenseVoucher` (with
`type = LIQUIDATION`), linked back by FK.

Considered and rejected:

- **Extend `ExpenseVoucher` for both stages** — least new code and reuses the
  existing workflow, but the request form is buried in the Expenses module.
- **Fully standalone `CashRequest` + `CashLiquidation`** — cleanest separation
  but duplicates the approval workflow, line items, and GL posting, and leaves
  money-out records split across two unrelated modules.

The hybrid was chosen for a dedicated request form while reusing the expense
line-item machinery for actual spend. Its cost is that the advance→liquidation
link spans two tables; the `@unique` FK below keeps that link unambiguous.

### Accountability subject: free-text name

`requestedFor` is a plain `VarChar(100)`, matching the existing
`ExpenseVoucher.requestedBy`. No FK to `Employee` or `User`.

**Known limitation:** per-person aging groups by string, so typos and name
variants ("Juan Dela Cruz" vs "Juan dela Cruz") split a person's balance across
rows. Mitigation: the form's name input offers a `<datalist>` of
previously-used names, the same pattern as `components/DescriptionInput.jsx`.
Migrating to an `Employee` FK later is additive and does not invalidate this
design.

## Data model

```prisma
enum CashRequestStatus {
  DRAFT        // being encoded
  SUBMITTED    // waiting for approval
  APPROVED     // approved, cash not yet handed over
  RELEASED     // cash handed over — 1104 carries a balance
  LIQUIDATED   // settled with receipts — 1104 cleared
  REJECTED
  CANCELLED
}

model CashRequest {
  id              Int       @id @default(autoincrement())
  businessId      Int       @default(1)
  requestNo       String    @unique @db.VarChar(30)   // CR-000001
  requestDate     DateTime  @db.Date
  neededDate      DateTime? @db.Date
  requestedFor    String    @db.VarChar(100)   // person receiving the cash
  purpose         String    @db.Text
  requestedAmount Decimal   @default(0) @db.Decimal(15, 2)
  releasedAmount  Decimal   @default(0) @db.Decimal(15, 2)
  cashAccountCode String?   @db.VarChar(10)    // 1010 / 1011 / 1020, set at release
  status          CashRequestStatus @default(DRAFT)
  requestedBy     String?   @db.VarChar(100)   // who encoded the form (may differ
                                               // from requestedFor, e.g. an admin
                                               // filing on someone's behalf)
  approvedBy      String?   @db.VarChar(100)
  releasedBy      String?   @db.VarChar(100)
  releasedDate    DateTime? @db.Date
  rejectedReason  String?   @db.Text
  notes           String?   @db.Text
  items           CashRequestItem[]
  liquidation     ExpenseVoucher?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([businessId])
  @@index([status])
  @@index([requestDate])
  @@map("cash_requests")
}

model CashRequestItem {
  id            Int         @id @default(autoincrement())
  requestId     Int
  request       CashRequest @relation(fields: [requestId], references: [id], onDelete: Cascade)
  description   String      @db.VarChar(255)   // "Plywood 3/4 — 4 pcs"
  quantity      Decimal?    @db.Decimal(15, 3)
  estimatedCost Decimal     @db.Decimal(15, 2)
  accountId     Int?        // optional intended COA
  account       Account?    @relation(fields: [accountId], references: [id])

  @@index([requestId])
  @@map("cash_request_items")
}

// added to the existing model
model ExpenseVoucher {
  cashRequestId Int?         @unique
  cashRequest   CashRequest? @relation(fields: [cashRequestId], references: [id])
}
```

`CashRequestItem` holds **estimates**. Actual spend lives in the liquidation
voucher's `ExpenseVoucherItem` rows, which already carry an optional per-line
`accountId` with a category fallback.

`@unique` on `cashRequestId` enforces **one liquidation per request**. Partial
liquidations are explicitly out of scope.

## Chart of accounts mapping

No journal entry is written at `DRAFT`, `SUBMITTED`, or `APPROVED` — an approval
is not a transaction.

### On release

```
DR  1104  Advances to Officers & Employees   releasedAmount
    CR  <cashAccountCode>                        releasedAmount
reference: requestNo
```

`cashAccountCode` is chosen at release time from the cash accounts:
`1010 Cash on Hand`, `1011 Petty Cash Fund`, `1020 Cash in Bank — BDO Checking`,
or any other `10xx` cash account in the COA.

### On liquidation

Let `actualSpent = Σ(liquidation line amounts)` and
`variance = actualSpent − releasedAmount`.

**Case RETURN — `variance < 0`** (spent less; sukli returned):

```
DR  <per-line COA>          actualSpent
DR  <cashAccountCode>       −variance        (cash coming back)
    CR  1104 Advances           releasedAmount
```

**Case REIMBURSE — `variance > 0`** (spent more; company owes the difference):

```
DR  <per-line COA>          actualSpent
    CR  1104 Advances           releasedAmount
    CR  <cashAccountCode>       variance     (cash paid out)
```

**Case EXACT — `variance == 0`:**

```
DR  <per-line COA>          actualSpent
    CR  1104 Advances           releasedAmount
```

Both postings go through the existing `glPost.safePost()`.

**`1104` is the accountability ledger: any balance there is cash somebody still
holds unliquidated.**

## API

New `server/controllers/cashRequestController.js` and
`server/routes/cashRequests.js`, registered in `server/routes/index.js` and
`server/index.js`. Numbering follows the `EV-000001` pattern → `CR-000001`.

| Endpoint | Guard | Behaviour |
| --- | --- | --- |
| `GET /api/cash-requests` | authenticate | List; filters `status`, `search`, `from`, `to` |
| `GET /api/cash-requests/summary` | authenticate | Pending approval, released-unliquidated, total outstanding |
| `GET /api/cash-requests/unliquidated` | authenticate | Aging grouped by `requestedFor` |
| `GET /api/cash-requests/:id` | authenticate | Detail + items + linked liquidation |
| `POST /api/cash-requests` | authenticate | Create as `DRAFT` |
| `PUT /api/cash-requests/:id` | authenticate | Edit — only while `DRAFT` or `SUBMITTED` |
| `POST /api/cash-requests/:id/submit` | authenticate | `DRAFT → SUBMITTED` |
| `POST /api/cash-requests/:id/approve` | ADMIN, MANAGER | `SUBMITTED → APPROVED` |
| `POST /api/cash-requests/:id/reject` | ADMIN, MANAGER | `→ REJECTED`, reason required |
| `POST /api/cash-requests/:id/release` | ADMIN, MANAGER, ACCOUNTANT | `APPROVED → RELEASED` + GL post |
| `POST /api/cash-requests/:id/liquidate` | authenticate | `RELEASED → LIQUIDATED`; creates the `ExpenseVoucher` + GL post |
| `POST /api/cash-requests/:id/cancel` | authenticate | `→ CANCELLED`, only before `RELEASED` |

Every transition validates the current status server-side, not only in the UI.

### Shared pure module

`server/utils/cashAdvance.js`:

```js
buildReleaseEntry({ requestNo, amount, cashAccountCode })
  // → { lines }

buildLiquidationEntry({ requestNo, releasedAmount, lines, cashAccountCode })
  // → { lines, variance, mode: 'RETURN' | 'REIMBURSE' | 'EXACT' }
```

This is the unit-tested core, matching the shape of `server/utils/finance.js`
and `server/utils/phCompliance.js`.

### Fix to the existing expense module

- `expenseController.markPaid` branches: when
  `type === 'LIQUIDATION' && cashRequestId`, credit `1104` via
  `buildLiquidationEntry` instead of crediting cash.
- `CASH_ADVANCE` is removed from the Expense Voucher type picker in
  `app/(dashboard)/expenses/page.jsx`; cash advances now live in `CashRequest`.
  The enum value stays for existing rows.

## UI

New route `app/(dashboard)/cash-requests/page.jsx`, following the standard page
shape (`page-header` → filter `card` → data `card`).

- **List** — summary tiles, filter row, status badges reusing
  `badge-blue/yellow/green/red`.
- **New Cash Request modal** — `requestedFor` (free text with a `<datalist>` of
  previously-used names), purpose, needed date, and a line-item grid of
  materials with estimated cost. Uses `table table-compact` and `NumberInput`.
- **Release modal** — released amount, cash account picker, `releasedBy`, date.
- **Liquidate modal** — actual lines with per-line `AccountSelect`, receipt no.,
  and a live variance strip showing "Sukli ₱800" or "Reimburse ₱300" before
  submit.
- **Detail modal** — workflow timeline, both journal entries linked, print via
  `printDocument`.

Nav: new entry under **PURCHASES**, beside Expense Vouchers. Permissions:
add `/cash-requests` to the existing `payable` module's `routes` array in
`lib/permissions.js`, which already owns `/expenses`.

## Error handling

- Double-release and double-liquidate are rejected by status guards, and the
  `@unique` on `cashRequestId` enforces one liquidation at the DB level.
- Partial release is allowed (`releasedAmount` may differ from
  `requestedAmount`) but must be `> 0`. `1104` tracks `releasedAmount`.
- `cashAccountCode` must resolve to an existing account in the COA.
- Liquidation requires at least one line with an amount `> 0`.
- Reject requires a non-empty reason.
- Cancel is blocked once `RELEASED` — the only way out is liquidation.

**Known limitation:** `glPost.safePost()` records failures to the audit log
rather than throwing, so a failed post leaves the status updated with no journal
entry. Every existing module behaves this way; this design keeps consistency
rather than diverging. Revisiting it is a separate, codebase-wide concern.

## Testing

`tests/cashAdvance.test.js` — jest unit tests against
`server/utils/cashAdvance.js`:

- Release entry balances, debits `1104`, credits the chosen cash account.
- Liquidation with sukli → DR lines + DR cash, CR `1104`, balanced, mode
  `RETURN`.
- Liquidation with reimbursement → DR lines, CR `1104` + CR cash, balanced, mode
  `REIMBURSE`.
- Liquidation exact → no cash line, mode `EXACT`.
- Every case asserts `isBalanced()` from `server/utils/finance.js`.
- Per-line `accountId` is honoured; category fallback applies when absent.
- Zero or negative released amount is rejected.

## Out of scope

- Partial or multiple liquidations against one request.
- Salary deduction for unliquidated advances (needs the `Employee` FK).
- Attaching scanned receipts to the liquidation (the `Attachments` component
  exists and can be wired later).
- Converting a cash request into a purchase order or vendor bill.
