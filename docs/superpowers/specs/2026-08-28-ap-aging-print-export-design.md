# AP Aging — Print, Export & Vendor History (parity with AR Aging) — Design

**Date:** 2026-08-28
**Status:** Approved

## Goal

`app/(dashboard)/payable/aging/page.jsx` (AP Aging Report) has zero print or
export capability today — no `Printer` import, no `printDocument` call
anywhere in the file. Its sibling, `app/(dashboard)/receivable/aging/page.jsx`
(AR Aging Report), already has a complete, shipped implementation: a
per-customer "Statement of Account" (print + Excel export), a "Print All"
button that prints every customer alphabetically with their full invoice
history, and a customer search box that drills into a full transaction
history (drawer, opened via an Eye icon on each row). The user wants full
parity on the AP side — vendors instead of customers, bills instead of
invoices — so the owner has a printable record of upcoming and overdue
payables to act on, matching what already exists for receivables.

This is a **port**, not a new design: `receivable/aging/page.jsx` is the
approved, working reference implementation. Every function below names the
AR function it mirrors and the field substitutions, rather than
re-deriving behavior from scratch.

## Scope decision

**One deliberate simplification, agreed with the user:** AP's main table
already classifies bills into a richer 9-bucket system (`Due Today`, `This
Week`, `Next Week`, `This Month`, `Later`, then `1-30/31-60/61-90/Over 90
days`), computed server-side in `agingReport`
(`server/controllers/payableController.js:309-341`, backed by
`classifyUpcomingBucket` in `server/utils/apAgingBuckets.js`). That table,
`printVendorStatement`, and `printAllVendorsSummary` all consume
`data.items` from that same aging endpoint, so they get the full 9-bucket
detail for free — no simplification there.

The **vendor history drawer** (Eye icon, full history for one vendor —
paid/void bills included, not just outstanding ones) is different: it
fetches fresh via `pApi.bills.list({ vendorId, limit: 100 })`, which has no
bucket field at all (that endpoint doesn't run the aging classifier).
Rather than duplicate `classifyUpcomingBucket`'s calendar-boundary logic
(week/month cutoffs) into the frontend just for this drawer, it uses a
simple day-count classifier: `daysOverdue === 0` → `"Not yet due"`,
otherwise the same 4 overdue tiers already used everywhere
(`1-30/31-60/61-90/Over 90 days`). The main table — the actual
"alert the owner" view — is untouched by this simplification.

## Data model

No schema change. Two backend response-shape additions:

**`agingReport`** (`server/controllers/payableController.js:309-341`)
currently returns each item as `{ billNo, vendor, dueDate, outstanding,
daysOverdue, bucket }` — missing `vendorId` and `notes`, both of which
`receivableController.js`'s equivalent already includes
(`receivableController.js:376-389`, `{ invoiceNo, customer, customerId,
dueDate, outstanding, daysOverdue, notes, bucket }`). Add both:
`vendorId: b.vendorId` (needed so the Eye icon can open the drawer without
a second vendor-name→id lookup) and `notes: b.notes` (shown in the printed
statement, same as AR's `i.notes` usage in `printCustomerStatement`).

**`listBills`** (`server/controllers/payableController.js:119-138`, already
modified once this session to fetch vendor separately rather than via
`include`) currently includes only `lines`. Add
`payments: { orderBy: { paymentDate: 'asc' } }` to that `include`, matching
`listInvoices`'s own `include.payments` (`receivableController.js:124`) —
needed so `pApi.bills.list({ vendorId, limit: 100 })` returns each bill's
payment history for the drawer's expandable rows.

## Backend changes

```javascript
// agingReport — item shape, add vendorId + notes:
return {
  billNo: b.billNo, vendor: vendorNames[b.vendorId] || 'Unknown vendor', vendorId: b.vendorId,
  dueDate: b.dueDate, outstanding, daysOverdue, notes: b.notes,
  bucket: daysOverdue === 0 ? classifyUpcomingBucket(due, today)
    : daysOverdue <= 30  ? '1-30 days'
    : daysOverdue <= 60  ? '31-60 days'
    : daysOverdue <= 90  ? '61-90 days'
    : 'Over 90 days',
};
```

```javascript
// listBills — findMany include, add payments:
prisma.bill.findMany({
  where,
  include: { lines: true, payments: { orderBy: { paymentDate: 'asc' } } },
  orderBy: { billDate: 'desc' },
  skip: (Number(page)-1)*Number(limit), take: Number(limit),
}),
```

Everything else in both functions (the orphaned-vendor-safe manual lookup
added earlier this session) is untouched.

## Frontend changes — `app/(dashboard)/payable/aging/page.jsx`

All of the following are ported from `app/(dashboard)/receivable/aging/page.jsx`
with these substitutions applied throughout: `customer`→`vendor`,
`customerId`→`vendorId`, `invoiceNo`→`billNo`, `invoiceDate`→`billDate`,
`rApi.invoices`→`pApi.bills`, `rApi.customers`→`pApi.vendors`,
green/emerald accent colors→blue (matching AP's existing blue/`Building2`
theme, not AR's green/`Users` theme), `PaymentAR` fields→`PaymentAP` fields
(identical shape: `paymentNo`, `paymentDate`, `amount`, `paymentMethod`,
`reference`, `notes`).

**New imports:** add `Printer`, `History`, `FileSpreadsheet`, `Eye`, `X` to
the existing `lucide-react` import (`page.jsx:5-8`); add `printDocument,
phpFmt, dateFmt` from `@/lib/print` and `exportToExcel` from `@/lib/export`
(neither is currently imported in this file).

**`printVendorStatement(vendorName, outstandingItems)`** — mirrors
`printCustomerStatement` (`receivable/aging/page.jsx:60-102`) exactly,
field-substituted. Title "Statement of Account" (kept identical — the term
applies to either direction), rows sorted by `daysOverdue` descending, each
followed by its payment rows if `Array.isArray(i.payments)` (omitted, not
claimed empty, when the source list didn't fetch payments — same
`payments === undefined` convention AR uses for aging-summary-sourced
items vs. drawer-sourced items).

**`printAllVendorsSummary(vendorGroups)`** — mirrors
`printAllCustomersSummary` (`receivable/aging/page.jsx:108-168`). Uses the
full `BUCKETS` constant already defined in this file (9 buckets), NOT
`visibleBuckets` — a printed report is comprehensive regardless of the
on-screen optional-bucket-hide toggle. Title "AP Aging — Detail by Vendor".

**`exportVendorStatement(vendorName, outstandingItems)`** — mirrors
`exportCustomerStatement` (`receivable/aging/page.jsx:173-210`) exactly,
field-substituted, via the same `exportToExcel` helper.

**`ExportMenu`** (`receivable/aging/page.jsx:213-247`) — copied verbatim
(it's already generic: `onPrint`, `onExcel`, `disabled`, `label` props, no
customer/invoice-specific logic inside it) into the AP file as a local
component, matching this codebase's existing convention of not sharing
one-off UI subcomponents across sibling pages.

**`STATUS_BADGE_CLASS`** — new local constant, same color mapping AR uses
(`receivable/aging/page.jsx:38-44`): `OPEN: 'bg-blue-100 text-blue-700'`,
`PARTIAL: 'bg-yellow-100 text-yellow-700'`, `PAID: 'bg-green-100
text-green-700'`, `OVERDUE: 'bg-red-100 text-red-700'`, `VOID: 'bg-gray-100
text-gray-500'` — `Bill.status` uses the identical `OPEN/PARTIAL/PAID/
OVERDUE/VOID` enum values as `Invoice.status`.

**`overdueSeverity(dueDate)`** — new helper, replacing AR's `bucketFor`
(`receivable/aging/page.jsx:47-55`) for this file's simplified drawer-only
classification (see Scope decision above):
```javascript
function overdueSeverity(dueDate) {
  const daysOverdue = Math.max(0, Math.floor((new Date() - new Date(dueDate)) / 86400000));
  const bucket = daysOverdue === 0 ? 'Not yet due'
    : daysOverdue <= 30 ? '1-30 days'
    : daysOverdue <= 60 ? '31-60 days'
    : daysOverdue <= 90 ? '61-90 days'
    : 'Over 90 days';
  return { daysOverdue, bucket };
}
```

**`outstandingItemsFrom(bills)`** — mirrors
`receivable/aging/page.jsx:492-505`, using `overdueSeverity` instead of
`bucketFor`, filtering `['OPEN', 'PARTIAL', 'OVERDUE'].includes(bill.status)`
(same statuses), mapping to `{ billNo, dueDate, daysOverdue, bucket, notes,
outstanding, payments }`.

**`HistoryTable({ bills })`** — mirrors `HistoryTable({ invoices })`
(`receivable/aging/page.jsx:386-490`), same expandable-row structure
(click a bill row to reveal its `PaymentAP` rows), same columns (Bill #,
Bill Date, Due Date, Status, Aging, Total, Paid, Outstanding, Notes) with
"Bill #"/"Bill Date" replacing "Invoice #"/"Invoice Date". The `Aging`
column shows `overdueSeverity(bill.dueDate).bucket` for outstanding bills,
`—` otherwise (mirrors AR's `bucketFor` call in the same spot).

**`HistoryCustomerBlock`** → **`HistoryVendorBlock({ vendor, bills })`** —
mirrors `receivable/aging/page.jsx:508-546`.

**`CustomerHistoryDrawer`** → **`VendorHistoryDrawer({ vendorName, bills,
loading, onClose })`** — mirrors `receivable/aging/page.jsx:549-611`, blue
gradient header (`from-blue-600 to-blue-700`, matching AP's existing blue
theme) instead of AR's green.

**Main `APAgingPage` component additions** (mirroring
`receivable/aging/page.jsx:614-1086`'s equivalents):
- `historyResults`, `historyLoading`, `viewVendor`, `viewBills`,
  `viewLoading` state, plus the debounced search-driven history-fetch
  `useEffect` (search already exists in this file as a vendor-name filter
  on the summary table — extending it to also drive the full-history view
  when non-empty, exactly as AR's `search` does double duty).
- `openHistoryDrawer(vendorId, vendorName)` — mirrors
  `receivable/aging/page.jsx:630-642`, calling `pApi.bills.list({
  vendorId, limit: 100 })`.
- A "Print All" button next to the existing search input in the "Detail by
  Vendor" card header (`page.jsx:378-393`), disabled when there are no
  grouped vendors, shown only when `!search.trim()` — mirrors
  `receivable/aging/page.jsx:939-948`.
- `VendorRow` (`page.jsx:101-174`, already exists) gains an `onView` prop
  and, in its action cell, an Eye icon button (`onView(vendorId,
  vendorName)`) and an `ExportMenu` (`onPrint`/`onExcel` wired to the new
  print/export functions with that row's `items`) — mirrors
  `CustomerRow`'s action cell (`receivable/aging/page.jsx:326-343`).
  `VendorRow` needs `vendorId` from its `items` (already available per
  item once the backend change lands) the same way `CustomerRow` reads
  `items[0]?.customerId`.
- When `search.trim()` is non-empty, render `historyResults.map(({vendor,
  bills}) => <HistoryVendorBlock ... />)` instead of the summary table —
  mirrors `receivable/aging/page.jsx:1054-1073`.
- `viewVendor && <VendorHistoryDrawer ... />` at the end, mirrors
  `receivable/aging/page.jsx:1076-1083`.

## Out of scope

- Any change to the AR aging page itself — it's the reference
  implementation and already ships this functionality.
- Duplicating the full calendar-boundary bucket classifier
  (`classifyUpcomingBucket`) into the frontend — the drawer uses the
  simplified `overdueSeverity` instead, per the Scope decision above.
- Any change to the main aging table's own bucket rendering, the bucket
  optional-hide filter, or the existing KPI cards/charts/severe-overdue
  banner — all untouched.
