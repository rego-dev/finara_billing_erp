# Cash Sales (Non-Invoiced) — Design

**Date:** 2026-08-10
**Status:** Approved

## Goal

Let staff record a walk-in / counter cash sale that doesn't get a formal AR
Invoice — cash received on the spot, no per-customer billing — so it is still
captured in the books, VAT Summary, and Daily Remittance Report, instead of
being invisible to the system entirely.

## Problem in the current code

`dailyRemittanceController.calculate()` (`server/controllers/dailyRemittanceController.js:125`)
derives `totalSales` **only** from `Invoice` records for the day:

```js
const totalSales = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
```

There is currently no way to record a sale that doesn't go through the full
AR Invoice flow (customer selection, due date, AR posting). For a lot of PH
retail/counter transactions — a snack bar sale, a small walk-in purchase —
issuing a formal invoice per transaction is unnecessary overhead, and today
those sales simply aren't recorded anywhere. This is a real gap independent
of this feature's UI; this design closes it.

## Decision

**A new, single-line `CashSale` model, direct-posted, separate from
`Invoice`.**

Considered and rejected:

- **Extend `Invoice` with an "invoiceless" flag** — reuses AR posting and
  reporting, but `Invoice` carries a required `customerId`, a `dueDate`, and
  an AR receivable/collection lifecycle that doesn't apply here — cash is
  already in hand, there is no balance to age or collect against. Bending
  the model to allow a null customer and an immediately-settled "invoice"
  makes every consumer of `Invoice` (AR Aging, Customers drawer, Collection
  rate) special-case it.
- **Multi-line items like `Invoice`/`Quotation`** — more expressive, but per
  the confirmed scope this is a single amount + description per sale; a
  line-items table would be unused complexity for the common case (one cash
  sale = one till transaction).

A dedicated model keeps `Invoice` semantics (AR, aging, collections) clean
and keeps `CashSale` as what it actually is: a same-instant cash receipt.

## Data model

```prisma
enum CashSaleStatus {
  ACTIVE
  VOID
}

model CashSale {
  id             Int            @id @default(autoincrement())
  businessId     Int            @default(1)
  saleNo         String         @unique @db.VarChar(30)    // CS-000001
  saleDate       DateTime       @db.Date
  buyerName      String?        @db.VarChar(150)           // optional; blank = "Walk-in"
  description    String         @db.Text                   // what was sold
  accountId      Int
  account        Account        @relation(fields: [accountId], references: [id])
  vatCode        VatCode        @default(VAT)               // reuse existing enum (VAT/ZERO/EXEMPT)
  subtotal       Decimal        @default(0) @db.Decimal(15, 2)
  vatAmount      Decimal        @default(0) @db.Decimal(15, 2)
  totalAmount    Decimal        @default(0) @db.Decimal(15, 2)
  paymentMethod  String         @db.VarChar(30)             // Cash, Bank Transfer, Check, GCash, Maya, ...
  status         CashSaleStatus @default(ACTIVE)
  voidedReason   String?        @db.Text
  voidedAt       DateTime?
  notes          String?        @db.Text
  journalEntryId Int?           @unique
  journalEntry   JournalEntry?  @relation(fields: [journalEntryId], references: [id])
  createdBy      Int?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  @@index([businessId])
  @@index([saleDate])
  @@index([status])
  @@map("cash_sales")
}
```

`buyerName` is a plain optional string, same convention as
`CashRequest.requestedFor` and `ExpenseVoucher.payee` — no FK to `Customer`.
This is deliberately **not** wired into the Customers module (no collection
rate, no per-customer history) — it's a memo field, not a receivable.

`vatCode` and the subtotal/vat/total computation reuse the exact same
`computeVAT()` helper `createInvoice` already uses, so a `VAT`-coded cash
sale computes identically to a VAT-coded invoice line.

## Chart of accounts mapping

Direct-post on create — cash is already in hand, there is nothing to
approve:

```
DR  <cash account, by payment method>   totalAmount
    CR  <accountId>  (chosen revenue account)   subtotal
    CR  2030 Output VAT                          vatAmount   (if vatCode = VAT)
reference: saleNo
```

Payment-method → cash account mapping reuses the exact table already in
`receivableController.recordPayment`:

```js
{ 'Cash': '1010', 'Bank Transfer': '1020', 'Check': '1020',
  'GCash': '1024', 'Maya': '1024', 'Credit Card': '1020', 'Online': '1020' }
```

### Void

`voidInvoice` (`receivableController.js:208`) only flips `Invoice.status` to
`'VOID'` — it never touches the linked journal entry, which stays `POSTED`
forever. Since Trial Balance / Income Statement / Balance Sheet only sum
`POSTED` journal entries, this is a pre-existing gap: voiding an invoice
today does not actually remove its financial effect from the reports. That's
an existing-code issue, out of scope for this design — **not fixed here** —
but `CashSale` void is written correctly from the start rather than copying
the gap:

```
1. CashSale.status → VOID, voidedReason, voidedAt
2. Its linked JournalEntry.status → VOIDED   (the actual JournalStatus enum
                                               value — DRAFT/POSTED/VOIDED,
                                               prisma/schema.prisma:190)
```

Step 2 alone is sufficient — no reversing entry needed — because every
report already filters to `status: 'POSTED'`. This mirrors how a
directly-voided Journal Entry already behaves in the General Ledger module
(`journalController.js:201`, which sets the same `'VOIDED'` status).

## API

New `server/controllers/cashSaleController.js` and
`server/routes/cashSales.js`, registered in `server/routes/index.js` and
`server/index.js`. Numbering via `nextDocNumber('CS-', lastSaleNo)`
(`server/utils/docNumber.js`).

| Endpoint | Guard | Behaviour |
| --- | --- | --- |
| `GET /api/cash-sales` | authenticate | List; filters `status`, `search` (buyerName/description/saleNo), `from`, `to` |
| `GET /api/cash-sales/:id` | authenticate | Detail |
| `POST /api/cash-sales` | ADMIN, MANAGER, ACCOUNTANT | Create — computes VAT, posts GL, direct `ACTIVE` |
| `POST /api/cash-sales/:id/void` | ADMIN, MANAGER | `ACTIVE → VOID`, reason required, also voids the linked journal entry |

Note: `createInvoice` today has **no** role restriction beyond being
authenticated (`server/routes/receivable.js` — only `:id/void` is
`authorize('ADMIN','MANAGER')`). `CashSale` create is deliberately narrower —
ADMIN/MANAGER/ACCOUNTANT, excluding VIEWER — since this posts directly to
the GL with no draft/approval step to catch a mistaken entry before it hits
the books. Void matches Invoice void's ADMIN/MANAGER gate.

### GL posting

Goes through the existing `glPost.safePost()` — no new posting utility
needed, since this is a single fixed 2-or-3-line entry, unlike the
multi-branch cash-advance arithmetic that justified a dedicated pure module
in the Cash Request design.

## Daily Remittance integration

`dailyRemittanceController.calculate()` gets a second query alongside its
existing `Invoice` query for the day, scoped the same way (`businessId`,
date range, excluding `VOID`):

```js
const cashSales = await prisma.cashSale.findMany({
  where: { businessId, saleDate: { gte: dayStart, lt: dayEnd }, status: 'ACTIVE' },
});
```

Merged into the existing aggregates:
- `totalSales` += Σ `cashSales.totalAmount`
- `vatCollected` += Σ `cashSales.vatAmount`
- `cashReceived` and its per-payment-method breakdown += cash sales grouped
  by `paymentMethod`, using the same `collectionsByMethod` shape invoice
  collections already populate.

The Daily Report's expandable "Sales" detail section gains cash sales rows
alongside invoice rows, distinguished by a small badge ("Cash Sale" vs the
invoice number) so a reviewer can tell which rows are formally invoiced.

## UI

New route `app/(dashboard)/receivable/cash-sales/page.jsx`, following the
standard page shape (`page-header` → filter `card` → data `card`), styled
consistently with the Invoices list it sits beside.

- **List** — summary tiles (Today's Cash Sales, This Month, VAT Collected),
  filter row (date range, search), table: Sale #, Date, Buyer, Description,
  Payment Method (badge), Amount, Status.
- **New Cash Sale modal** — Sale Date (defaults today), Buyer Name (optional,
  placeholder "Walk-in"), Description, Revenue Account (`AccountSelect`,
  filtered to REVENUE type), Amount + VAT code (live subtotal/VAT/total,
  same computation display Invoices already use), Payment Method (same
  picker as invoice collections), Notes. Single "Record Sale" submit — no
  draft state.
- **Void** — confirm dialog requiring a reason, same pattern as
  `voidInvoice`'s UI, but restricted to ADMIN/MANAGER.
- **Print** — via `printDocument`, a simple receipt-style layout (not a
  formal VAT invoice — footer explicitly labeled "Not a BIR-registered sales
  invoice — internal record only" to avoid it being mistaken for one).

Nav: new entry under **Sales**, beside **Accounts Receivable**
(`components/layout/Sidebar.jsx`). No `lib/permissions.js` change needed —
its `receivable` module already lists `routes: ['/receivable']`
(`lib/permissions.js:17`) and `canAccess()` matches by prefix
(`pathname.startsWith(r + '/')`), so `/receivable/cash-sales` is already
covered.

## Error handling

- `accountId` must resolve to an active REVENUE-type account.
- `totalAmount` must be `> 0`.
- Void requires a non-empty reason and is blocked if already `VOID`.
- Payment method must be one of the known set; unrecognized values fall back
  to `1010 Cash on Hand`, matching `recordPayment`'s existing fallback.
- If `glPost.safePost()` fails, the sale is still created (matching the
  existing app-wide `safePost` convention documented in the Cash Request
  design) — the audit log records the posting failure.

## Testing

`tests/cashSale.test.js` — jest unit tests against a small pure helper
extracted for the arithmetic (`server/utils/cashSale.js`,
`buildCashSaleEntry({ saleNo, subtotal, vatAmount, totalAmount, accountId, paymentMethod })`):

- VAT-coded sale: DR cash, CR revenue (subtotal), CR Output VAT (vatAmount),
  balanced.
- ZERO/EXEMPT-coded sale: DR cash, CR revenue (totalAmount), no VAT line,
  balanced.
- Every payment method maps to the correct cash account; unknown method
  falls back to `1010`.
- Every case asserts `isBalanced()` from `server/utils/finance.js`.

`tests/dailyRemittanceCashSales.test.js` — confirms `calculate()` merges
active cash sales into `totalSales`/`vatCollected`/`cashReceived` and
excludes `VOID` ones.

## Out of scope

- Inventory stock deduction / COGS posting for items sold this way (per
  scope decision — this is a financial-only record; a related stock
  adjustment, if needed, is a separate manual Inventory > Transactions >
  Stock Out entry).
- Multi-line items per cash sale.
- Converting a cash sale into a formal Invoice after the fact.
- Fixing `voidInvoice`'s pre-existing gap of not voiding its linked journal
  entry (flagged above, not addressed here).
- An approval workflow (DRAFT → SUBMITTED → APPROVED) — direct-post only,
  matching the scope decision.
