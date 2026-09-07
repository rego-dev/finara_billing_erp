# AP Aging Print, Export & Vendor History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `app/(dashboard)/payable/aging/page.jsx` (AP Aging Report) to full print/export/history parity with its already-shipped sibling `app/(dashboard)/receivable/aging/page.jsx` (AR Aging Report) — a per-vendor printable Statement of Account, a "Print All" report, Excel export, and a vendor search/full-history drawer.

**Architecture:** This is a port, not a new design. Every frontend function is a direct field-substituted copy of an existing, working AR function (named inline). Two small backend response-shape additions (`agingReport` gains `vendorId`/`notes` per item, `listBills` gains `payments` in its include) unlock the port — no other backend change.

**Tech Stack:** Next.js 14 (App Router), Express.js, MySQL 8, Prisma ORM 5, Jest (backend unit tests only — no frontend test suite in this repo).

## Global Constraints

- This is a **port**: every new frontend function/component names the exact AR function it mirrors (`app/(dashboard)/receivable/aging/page.jsx`). Where this plan's code differs from a literal line-for-line copy, the difference is called out explicitly (field names, color theme, the `overdueSeverity` simplification) — anywhere it isn't called out, match AR's structure exactly.
- Color theme: AP already uses blue/`Building2` throughout this file (unlike AR's green/`Users`) — every ported piece of UI (hover colors, gradient header, badge tints) uses blue, not AR's green, even though the AR source uses green.
- No `@testing-library`/frontend test runner exists in this repo — verify frontend changes manually against the running dev server, not with a Jest test.
- Backend controller tests mock `../server/config/database` following the exact `run(fn, req)` promise-wrapper pattern already used across this codebase's test suite.

---

### Task 1: Backend — `agingReport` gains `vendorId`/`notes`, `listBills` gains `payments`

**Files:**
- Modify: `server/controllers/payableController.js`
- Modify: `tests/payableAgingReportBuckets.test.js`

**Interfaces:**
- Produces: each `agingReport` item now has `vendorId` and `notes` fields in addition to the existing `billNo, vendor, dueDate, outstanding, daysOverdue, bucket`. `listBills`'s response items now include a `payments` array (each with `id, paymentNo, paymentDate, amount, paymentMethod, reference, notes`) in addition to the existing `lines`. Tasks 2 and 3 (frontend) depend on both.

- [ ] **Step 1: Update `agingReport`**

In `server/controllers/payableController.js`, inside `exports.agingReport` (currently starting at line 349), find the `report` mapping (currently lines 363-376):

```javascript
    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, differenceInCalendarDays(today, due));
      const outstanding = Number(b.totalAmount) - Number(b.paidAmount);
      return {
        billNo: b.billNo, vendor: vendorNames[b.vendorId] || 'Unknown vendor',
        dueDate: b.dueDate, outstanding, daysOverdue,
        bucket: daysOverdue === 0 ? classifyUpcomingBucket(due, today)
          : daysOverdue <= 30  ? '1-30 days'
          : daysOverdue <= 60  ? '31-60 days'
          : daysOverdue <= 90  ? '61-90 days'
          : 'Over 90 days',
      };
    });
```

Replace with:

```javascript
    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, differenceInCalendarDays(today, due));
      const outstanding = Number(b.totalAmount) - Number(b.paidAmount);
      return {
        billNo: b.billNo, vendor: vendorNames[b.vendorId] || 'Unknown vendor', vendorId: b.vendorId,
        dueDate: b.dueDate, outstanding, daysOverdue, notes: b.notes,
        bucket: daysOverdue === 0 ? classifyUpcomingBucket(due, today)
          : daysOverdue <= 30  ? '1-30 days'
          : daysOverdue <= 60  ? '31-60 days'
          : daysOverdue <= 90  ? '61-90 days'
          : 'Over 90 days',
      };
    });
```

(Only the `return { ... }` object changed — two fields added: `vendorId: b.vendorId` and `notes: b.notes`. Nothing else in the function changes.)

- [ ] **Step 2: Update `listBills`**

In the same file, inside `exports.listBills` (currently starting at line 119), find the `findMany` call (currently around lines 127-135):

```javascript
    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        include: { lines: true },
        orderBy: { billDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.bill.count({ where }),
    ]);
```

Replace with:

```javascript
    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        include: { lines: true, payments: { orderBy: { paymentDate: 'asc' } } },
        orderBy: { billDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.bill.count({ where }),
    ]);
```

(Only `include: { lines: true }` → `include: { lines: true, payments: { orderBy: { paymentDate: 'asc' } } }`. The rest of `listBills`, including the orphaned-vendor-safe manual vendor lookup right after this block, is unchanged.)

- [ ] **Step 3: Add a test for the new `agingReport` fields**

In `tests/payableAgingReportBuckets.test.js`, add this test inside the existing `describe('agingReport — due-date buckets', ...)` block, alongside the existing tests:

```javascript
  test('includes vendorId and notes on every item', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-L', vendorId: 7, dueDate: new Date('2026-08-03'), totalAmount: 500, paidAmount: 0, notes: 'Rush order' },
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 7, name: 'Acme Supply' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items[0]).toMatchObject({ vendorId: 7, notes: 'Rush order' });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payableAgingReportBuckets.test.js`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 5: Run the full backend test suite**

Run: `npx jest`
Expected: PASS, zero failures (the suite was fully clean before this task).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payableController.js tests/payableAgingReportBuckets.test.js
git commit -m "feat(payable): add vendorId/notes to agingReport items, payments to listBills"
```

---

### Task 2: Frontend — print/export capability (Statement of Account, Print All, Excel)

**Files:**
- Modify: `app/(dashboard)/payable/aging/page.jsx`

**Interfaces:**
- Consumes: `printDocument`, `phpFmt`, `dateFmt` from `@/lib/print`; `exportToExcel` from `@/lib/export` (none currently imported in this file). `Printer`, `FileSpreadsheet` from `lucide-react` (added to the existing import).
- Produces: `printVendorStatement(vendorName, outstandingItems)`, `printAllVendorsSummary(vendorGroups)`, `exportVendorStatement(vendorName, outstandingItems)`, `ExportMenu` component, `sortedVendors` variable in `APAgingPage`. Task 3 consumes `printVendorStatement`/`exportVendorStatement`/`ExportMenu` again (from the vendor history drawer) and `sortedVendors`.

- [ ] **Step 1: Add the new imports**

At the top of `app/(dashboard)/payable/aging/page.jsx`, the current imports read:

```javascript
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter, ListFilter
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend
} from 'recharts';
```

Replace with:

```javascript
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter, ListFilter,
  Printer, FileSpreadsheet
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel } from '@/lib/export';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend
} from 'recharts';
```

- [ ] **Step 2: Add the print/export functions and `ExportMenu`**

Directly after the `BUCKET_BADGE` constant (currently ending at line 46, `};`) and before the `// ─── Custom Tooltip` comment (currently line 48), insert:

```javascript
// ─── Print a per-vendor Statement of Account (outstanding bills only) ──────
// Each bill row is followed by its payment history (if any were recorded
// against it) so the reader can see exactly what was paid and when.
async function printVendorStatement(vendorName, outstandingItems) {
  const total = outstandingItems.reduce((s, i) => s + i.outstanding, 0);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = outstandingItems
    .slice()
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .map((i) => {
      // `payments` is undefined when the source list didn't fetch payment history at
      // all (e.g. the main aging table) — omit the section rather than claim "none".
      const paymentRows = !Array.isArray(i.payments) ? '' : i.payments.length
        ? i.payments.map((p) => `
          <tr>
            <td class="small gray" style="padding-left:20px;">↳ ${esc(p.paymentNo)}</td>
            <td class="small gray">${dateFmt(p.paymentDate)}</td>
            <td class="small gray">${esc(p.paymentMethod)}${p.reference ? ` · Ref: ${esc(p.reference)}` : ''}</td>
            <td class="right small gray">${phpFmt(p.amount)}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" class="small gray" style="padding-left:20px;font-style:italic;">No payments recorded yet</td></tr>`;
      return `
      <tr>
        <td class="mono">${i.billNo}</td>
        <td>${dateFmt(i.dueDate)}</td>
        <td><span class="badge" style="background:${BUCKET_COLORS[i.bucket]}22;color:${BUCKET_COLORS[i.bucket]}">${i.bucket}</span></td>
        <td class="right bold">${phpFmt(i.outstanding)}</td>
      </tr>
      ${i.notes ? `<tr><td colspan="4" class="small gray" style="padding-top:0;">Note: ${esc(i.notes)}</td></tr>` : ''}
      ${paymentRows}`;
    })
    .join('');

  const body = `
    <div class="info-grid" style="grid-template-columns:1fr;">
      <div class="info-box"><div class="info-lbl">Vendor</div><div class="info-val">${vendorName}</div></div>
    </div>
    <table>
      <thead><tr><th>Bill #</th><th>Due Date</th><th>Aging</th><th class="right">Outstanding</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">TOTAL OUTSTANDING</td><td class="right">${phpFmt(total)}</td></tr></tfoot>
    </table>
    <p class="small gray" style="margin-top:10px;">This statement reflects open and partially paid bills only, with their payment history, as of the print date above.</p>`;

  await printDocument('Statement of Account', vendorName, body);
}

// ─── Print ALL vendors, alphabetically, each with their full bill history ──
async function printAllVendorsSummary(vendorGroups) {
  const alphabetical = vendorGroups.slice().sort(([a], [b]) => a.localeCompare(b));

  const grandTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  let grandTotal = 0;
  let billCount = 0;

  const sections = alphabetical.map(([vendorName, items]) => {
    const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });
    const total = items.reduce((s, i) => s + i.outstanding, 0);
    BUCKETS.forEach((b) => { grandTotals[b] += bucketTotals[b]; });
    grandTotal += total;
    billCount += items.length;

    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const vendorRow = `
      <tr style="background:#f9fafb;">
        <td class="bold">${esc(vendorName)} <span class="small gray">(${items.length} bill${items.length !== 1 ? 's' : ''})</span></td>
        ${BUCKETS.map((b) => `<td class="right mono bold">${bucketTotals[b] > 0 ? phpFmt(bucketTotals[b]) : '—'}</td>`).join('')}
        <td class="right mono bold">${phpFmt(total)}</td>
      </tr>`;

    const billRows = items
      .slice()
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((i) => `
        <tr>
          <td class="small gray" style="padding-left:20px;">
            <span class="mono">${i.billNo}</span> · Due ${dateFmt(i.dueDate)}${i.daysOverdue > 0 ? ` · ${i.daysOverdue}d overdue` : ''}
          </td>
          ${BUCKETS.map((b) => `<td class="right mono small">${i.bucket === b ? phpFmt(i.outstanding) : ''}</td>`).join('')}
          <td class="right mono small">${phpFmt(i.outstanding)}</td>
        </tr>`)
      .join('');

    return vendorRow + billRows;
  }).join('');

  const body = `
    <table>
      <thead>
        <tr>
          <th>Vendor / Bill</th>
          ${BUCKETS.map((b) => `<th class="right">${b}</th>`).join('')}
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${sections}</tbody>
      <tfoot>
        <tr>
          <td class="bold">GRAND TOTAL (${alphabetical.length} vendor${alphabetical.length !== 1 ? 's' : ''}, ${billCount} bill${billCount !== 1 ? 's' : ''})</td>
          ${BUCKETS.map((b) => `<td class="right mono bold">${phpFmt(grandTotals[b])}</td>`).join('')}
          <td class="right mono bold">${phpFmt(grandTotal)}</td>
        </tr>
      </tfoot>
    </table>
    <p class="small gray" style="margin-top:10px;">Vendors listed alphabetically, each with their full outstanding bill history. Reflects open and partially paid bills only, as of the print date above.</p>`;

  await printDocument('AP Aging — Detail by Vendor', `${alphabetical.length} vendor${alphabetical.length !== 1 ? 's' : ''} · ${billCount} bill${billCount !== 1 ? 's' : ''}`, body);
}

// ─── Export a per-vendor Statement of Account to Excel ─────────────────────
function exportVendorStatement(vendorName, outstandingItems) {
  const total = outstandingItems.reduce((s, i) => s + i.outstanding, 0);
  const rows = [];
  outstandingItems
    .slice()
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .forEach((i) => {
      rows.push({ type: 'Bill', billNo: i.billNo, dueDate: i.dueDate, bucket: i.bucket, outstanding: i.outstanding, amount: '', notes: i.notes });
      // `payments` is undefined when the source list didn't fetch payment history at
      // all (e.g. the main aging table) — omit the rows rather than claim "none".
      if (Array.isArray(i.payments)) {
        if (i.payments.length) {
          i.payments.forEach((p) => rows.push({
            type: 'Payment', billNo: `  ↳ ${p.paymentNo}`, dueDate: p.paymentDate, bucket: p.paymentMethod,
            outstanding: '', amount: Number(p.amount), notes: p.reference || '',
          }));
        } else {
          rows.push({ type: 'Payment', billNo: '  ↳ (none)', dueDate: '', bucket: '', outstanding: '', amount: '', notes: 'No payments recorded yet' });
        }
      }
    });
  rows.push({ type: '', billNo: '', dueDate: '', bucket: 'TOTAL OUTSTANDING', outstanding: total, amount: '', notes: '' });

  const safeName = vendorName.replace(/[^a-z0-9]+/gi, '-');
  exportToExcel(
    rows,
    [
      { key: 'billNo', label: 'Bill # / Payment #' },
      { key: 'dueDate', label: 'Due / Payment Date', format: (v) => (v ? dateFmt(v) : '') },
      { key: 'bucket', label: 'Aging / Method' },
      { key: 'outstanding', label: 'Outstanding', format: (v) => (v === '' ? '' : phpFmt(v)) },
      { key: 'amount', label: 'Amount Paid', format: (v) => (v === '' ? '' : phpFmt(v)) },
      { key: 'notes', label: 'Notes / Reference' },
    ],
    `Statement-${safeName}`,
    vendorName.slice(0, 31)
  );
}

// ─── Print / Export dropdown, used per vendor row ───────────────────────────
function ExportMenu({ onPrint, onExcel, disabled, label }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={`Export statement — ${label}`}
        className="text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-30"
      >
        <Printer className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-6 z-20 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 text-left">
            <button
              onClick={() => { setOpen(false); onPrint(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Printer className="w-3.5 h-3.5 text-gray-400" /> Print / Save as PDF
            </button>
            <button
              onClick={() => { setOpen(false); onExcel(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-gray-400" /> Export to Excel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

```

(That trailing blank line before the next `// ─── Custom Tooltip` comment is intentional — just don't delete the comment itself.)

- [ ] **Step 3: Wire `ExportMenu` into `VendorRow`'s action cell**

In the same file, inside `VendorRow` (currently lines 101-174), find the action cell (currently lines 138-142):

```javascript
        <td className="py-3 pr-2 text-center">
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400 inline" />
            : <ChevronDown className="w-4 h-4 text-gray-400 inline" />}
        </td>
```

Replace with:

```javascript
        <td className="py-3 pr-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <ExportMenu
              label={vendorName}
              onPrint={() => printVendorStatement(vendorName, items)}
              onExcel={() => exportVendorStatement(vendorName, items)}
            />
            {expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
```

- [ ] **Step 4: Extract `sortedVendors`, add the "Print All" button**

In the same file, inside `APAgingPage`, find where `grouped`/`filtered` are built and the table body currently does its own inline sort (currently around lines 218-226 for the grouping, and lines 416-423 for the inline-sorted `.map()` in the table body).

First, directly after the vendor-grouping block (currently):

```javascript
  // Group items by vendor
  const grouped = {};
  const filtered = data.items.filter((i) =>
    !search || i.vendor.toLowerCase().includes(search.toLowerCase())
  );
  filtered.forEach((item) => {
    if (!grouped[item.vendor]) grouped[item.vendor] = [];
    grouped[item.vendor].push(item);
  });
```

add a new `sortedVendors` variable right after it (before the `// Chart data` comment):

```javascript
  // Group items by vendor
  const grouped = {};
  const filtered = data.items.filter((i) =>
    !search || i.vendor.toLowerCase().includes(search.toLowerCase())
  );
  filtered.forEach((item) => {
    if (!grouped[item.vendor]) grouped[item.vendor] = [];
    grouped[item.vendor].push(item);
  });

  // Sort vendors: worst bucket first
  const sortedVendors = Object.entries(grouped).sort(([, a], [, b]) => {
    const aWorst = [...BUCKETS].reverse().findIndex((bucket) => a.some((i) => i.bucket === bucket));
    const bWorst = [...BUCKETS].reverse().findIndex((bucket) => b.some((i) => i.bucket === bucket));
    return bWorst - aWorst;
  });
```

Then in the table body, find the inline-sorted `.map()` (currently):

```javascript
              ) : Object.entries(grouped).sort(([, a], [, b]) => {
                // Sort by worst bucket
                const aWorst = [...BUCKETS].reverse().findIndex((bucket) => a.some(i => i.bucket === bucket));
                const bWorst = [...BUCKETS].reverse().findIndex((bucket) => b.some(i => i.bucket === bucket));
                return bWorst - aWorst;
              }).map(([vendorName, items]) => (
                <VendorRow key={vendorName} vendorName={vendorName} items={items} buckets={visibleBuckets} />
              ))}
```

Replace with:

```javascript
              ) : sortedVendors.map(([vendorName, items]) => (
                <VendorRow key={vendorName} vendorName={vendorName} items={items} buckets={visibleBuckets} />
              ))}
```

Then, in the "Detail by Vendor" card header (currently):

```javascript
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Detail by Vendor</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-48 py-1.5"
                placeholder="Filter vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <BucketFilterDropdown hidden={hiddenOptional} onToggle={toggleOptionalBucket} />
          </div>
        </div>
```

Replace with:

```javascript
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Detail by Vendor</h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={sortedVendors.length === 0}
              onClick={() => printAllVendorsSummary(sortedVendors)}
              title="Print all vendors, alphabetically, each with their full bill history"
            >
              <Printer className="w-3.5 h-3.5" /> Print All
            </button>
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-48 py-1.5"
                placeholder="Filter vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <BucketFilterDropdown hidden={hiddenOptional} onToggle={toggleOptionalBucket} />
          </div>
        </div>
```

- [ ] **Step 5: Sanity-check by inspection (no automated frontend test suite in this repo)**

Re-read the full modified file. Confirm: `printVendorStatement`, `printAllVendorsSummary`, `exportVendorStatement`, `ExportMenu` are all defined once, `sortedVendors` is defined once and used in both the table body and the Print All button, `VendorRow`'s action cell renders `ExportMenu` correctly, balanced JSX tags throughout, `Printer`/`FileSpreadsheet` are the only new icon imports (no `Eye`/`History`/`X` yet — those are Task 3's).

- [ ] **Step 6: Manual verification against the running dev server**

The dev server is already running (owned by the user — do not start a competing instance). Ask the user to check, or use the `run` skill, to walk through:

1. Open Accounts Payable → AP Aging Report.
2. Confirm a "Print All" button appears next to the vendor search filter, and clicking it opens a print preview with every vendor listed alphabetically, each bucket column, and their bills underneath.
3. On any vendor row, confirm a small printer icon appears in the action cell; clicking it shows a "Print / Save as PDF" and "Export to Excel" dropdown.
4. Confirm "Print / Save as PDF" opens a per-vendor Statement of Account, and "Export to Excel" downloads a `.xls` file.

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/payable/aging/page.jsx"
git commit -m "feat(payable): add print/export capability to AP Aging (Statement of Account, Print All, Excel)"
```

---

### Task 3: Frontend — vendor search + full transaction-history drawer

**Files:**
- Modify: `app/(dashboard)/payable/aging/page.jsx`

**Interfaces:**
- Consumes: `printVendorStatement`, `exportVendorStatement`, `ExportMenu`, `sortedVendors` (Task 2). `pApi.vendors.list({ search })`, `pApi.bills.list({ vendorId, limit: 100 })` (both already exist server-side; `pApi.bills.list` now returns `payments` per bill as of Task 1).
- Produces: no new exports — this is the final leaf UI addition to this page.

- [ ] **Step 1: Add the remaining icon imports and `Fragment`**

At the top of the file, the React import currently reads:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react';
```

Replace with:

```javascript
import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
```

The `lucide-react` import (after Task 2) currently reads:

```javascript
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter, ListFilter,
  Printer, FileSpreadsheet
} from 'lucide-react';
```

Replace with:

```javascript
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter, ListFilter,
  Printer, FileSpreadsheet, History, Eye, X
} from 'lucide-react';
```

- [ ] **Step 2: Add a "Not yet due" entry to `BUCKET_COLORS`, and add `STATUS_BADGE_CLASS`**

The `BUCKET_COLORS` constant currently reads:

```javascript
const BUCKET_COLORS = {
  'Due Today':     '#0ea5e9',
  'This Week':     '#16a34a',
  'Next Week':     '#4ade80',
  'This Month':    '#a3e635',
  'Later':         '#94a3b8',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#991b1b',
};
```

Add one entry (`'Not yet due'`, used only by the new drawer/history feature's simplified classifier, not by the main table):

```javascript
const BUCKET_COLORS = {
  'Due Today':     '#0ea5e9',
  'This Week':     '#16a34a',
  'Next Week':     '#4ade80',
  'This Month':    '#a3e635',
  'Later':         '#94a3b8',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#991b1b',
  'Not yet due':   '#16a34a',
};
```

Directly after the `BUCKET_BADGE` constant (which now has the print/export block from Task 2 right after it), add a new `STATUS_BADGE_CLASS` constant. Find the end of `BUCKET_BADGE`:

```javascript
const BUCKET_BADGE = {
  'Due Today':     'badge-blue',
  'This Week':     'badge-green',
  'Next Week':     'text-lime-700 bg-lime-100 badge',
  'This Month':    'text-yellow-700 bg-yellow-100 badge',
  'Later':         'badge-gray',
  '1-30 days':     'badge-yellow',
  '31-60 days':    'text-orange-700 bg-orange-100 badge',
  '61-90 days':    'badge-red',
  'Over 90 days':  'bg-red-900 text-white badge',
};
```

Insert directly after it (before the `printVendorStatement` function Task 2 added):

```javascript

const STATUS_BADGE_CLASS = {
  OPEN:    'bg-blue-100 text-blue-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  VOID:    'bg-gray-100 text-gray-500',
};

// Days-overdue → simple severity label for the vendor history drawer only —
// the main table's own Due Today/This Week/... calendar buckets are
// server-computed and not duplicated here; this only classifies whether/how
// overdue a bill is, for a vendor's full (paid+open+void) history view.
function overdueSeverity(dueDate) {
  const daysOverdue = Math.max(0, Math.floor((new Date() - new Date(dueDate)) / 86400000));
  const bucket = daysOverdue === 0 ? 'Not yet due'
    : daysOverdue <= 30 ? '1-30 days'
    : daysOverdue <= 60 ? '31-60 days'
    : daysOverdue <= 90 ? '61-90 days'
    : 'Over 90 days';
  return { daysOverdue, bucket };
}

function outstandingItemsFrom(bills) {
  return bills
    .filter((bill) => ['OPEN', 'PARTIAL', 'OVERDUE'].includes(bill.status))
    .map((bill) => {
      const { daysOverdue, bucket } = overdueSeverity(bill.dueDate);
      return {
        billNo: bill.billNo, dueDate: bill.dueDate, daysOverdue, bucket, notes: bill.notes,
        outstanding: Number(bill.totalAmount) - Number(bill.paidAmount),
        // `undefined` (not `[]`) when the source list didn't fetch payments at all —
        // print/export treat that as "unknown" rather than falsely claiming none were made.
        payments: bill.payments,
      };
    });
}
```

- [ ] **Step 3: Add `HistoryTable`, `HistoryVendorBlock`, `VendorHistoryDrawer`**

Directly after the `ExportMenu` component Task 2 added (find its closing `}` and the blank line before `// ─── Custom Tooltip`), insert these three components:

```javascript
// ─── Shared full-history table: Bill #, dates, status, aging, amounts, notes ──
// Each row expands to show the individual AP payments applied to that bill,
// so a partial/aging balance can be traced back to exactly what was paid and when.
function HistoryTable({ bills }) {
  const [expandedIds, setExpandedIds] = useState(new Set());

  const toggle = (id) => setExpandedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th className="pl-4">Bill #</th>
            <th>Bill Date</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Aging</th>
            <th className="text-right">Total</th>
            <th className="text-right">Paid</th>
            <th className="text-right">Outstanding</th>
            <th className="pr-4">Notes</th>
          </tr>
        </thead>
        <tbody>
          {bills.length === 0 ? (
            <tr><td colSpan={9} className="text-center py-8 text-gray-400">No bills for this vendor yet.</td></tr>
          ) : bills
            .slice()
            .sort((a, b) => new Date(b.billDate) - new Date(a.billDate))
            .map((bill) => {
              const isOutstanding = ['OPEN', 'PARTIAL', 'OVERDUE'].includes(bill.status);
              const { bucket } = isOutstanding ? overdueSeverity(bill.dueDate) : { bucket: null };
              const payments = bill.payments || [];
              const expanded = expandedIds.has(bill.id);
              return (
                <Fragment key={bill.id}>
                  <tr
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                    onClick={() => toggle(bill.id)}
                  >
                    <td className="pl-4 py-2 font-mono text-sm text-blue-700">
                      <span className="inline-flex items-center gap-1.5">
                        {expanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                          : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        {bill.billNo}
                        {payments.length > 0 && <span className="badge-gray text-xs font-sans">{payments.length}</span>}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-gray-600">{formatDate(bill.billDate)}</td>
                    <td className="py-2 text-sm text-gray-600">{formatDate(bill.dueDate)}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASS[bill.status] || 'bg-gray-100 text-gray-500'}`}>
                        {bill.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {bucket ? (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{ backgroundColor: `${BUCKET_COLORS[bucket]}22`, color: BUCKET_COLORS[bucket] }}
                        >
                          {bucket}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="text-right py-2 text-sm">{formatCurrency(bill.totalAmount)}</td>
                    <td className="text-right py-2 text-sm text-gray-500">{formatCurrency(bill.paidAmount)}</td>
                    <td className="text-right py-2 text-sm font-semibold">
                      {formatCurrency(Number(bill.totalAmount) - Number(bill.paidAmount))}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500 max-w-[200px] truncate" title={bill.notes || ''}>
                      {bill.notes || <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                  {expanded && (
                    payments.length === 0 ? (
                      <tr className="bg-blue-50/30 border-b border-blue-100/50">
                        <td colSpan={9} className="py-2 pl-14 text-xs text-gray-400 italic">No payments recorded yet for this bill.</td>
                      </tr>
                    ) : payments.map((p) => (
                      <tr key={p.id} className="bg-blue-50/30 border-b border-blue-100/50">
                        <td colSpan={2} className="py-1.5 pl-14">
                          <span className="font-mono text-xs text-blue-700">{p.paymentNo}</span>
                        </td>
                        <td className="py-1.5 text-xs text-gray-500">{formatDate(p.paymentDate)}</td>
                        <td colSpan={2} className="py-1.5 text-xs text-gray-500">{p.paymentMethod}{p.reference ? ` · Ref: ${p.reference}` : ''}</td>
                        <td className="text-right py-1.5" />
                        <td className="text-right py-1.5 text-xs font-medium text-blue-700">{formatCurrency(p.amount)}</td>
                        <td className="text-right py-1.5" />
                        <td className="py-1.5 pr-4 text-xs text-gray-400 max-w-[200px] truncate" title={p.notes || ''}>
                          {p.notes || ''}
                        </td>
                      </tr>
                    ))
                  )}
                </Fragment>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Full bill history for one matched vendor (search mode) ────────────────
function HistoryVendorBlock({ vendor, bills }) {
  const [expanded, setExpanded] = useState(true);

  const outstandingItems = outstandingItemsFrom(bills);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="card">
      <div
        className="card-header cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <h3 className="font-semibold text-gray-900">{vendor.name}</h3>
          <span className="badge-gray text-xs">{bills.length} bill{bills.length !== 1 ? 's' : ''}</span>
          {outstandingTotal > 0 && (
            <span className="badge bg-red-100 text-red-600 text-xs">{formatCurrency(outstandingTotal)} outstanding</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            label={vendor.name}
            disabled={outstandingItems.length === 0}
            onPrint={() => printVendorStatement(vendor.name, outstandingItems)}
            onExcel={() => exportVendorStatement(vendor.name, outstandingItems)}
          />
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && <HistoryTable bills={bills} />}
    </div>
  );
}

// ─── Slide-out drawer: one vendor's full transaction history ──────────────
function VendorHistoryDrawer({ vendorName, bills, loading, onClose }) {
  const outstandingItems = outstandingItemsFrom(bills);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-6xl bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <History className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{vendorName}</h3>
                <p className="text-blue-200 text-sm">Full transaction history</p>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center gap-3">
              <button
                onClick={() => printVendorStatement(vendorName, outstandingItems)}
                disabled={outstandingItems.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-4 h-4" /> Print
              </button>
              <button
                onClick={() => exportVendorStatement(vendorName, outstandingItems)}
                disabled={outstandingItems.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" /> Download Statement
              </button>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-2 flex-wrap items-center">
            <span className="badge bg-white/10 text-blue-100 text-xs">{bills.length} bill{bills.length !== 1 ? 's' : ''}</span>
            {outstandingTotal > 0 && (
              <span className="badge bg-white/10 text-blue-100 text-xs">{formatCurrency(outstandingTotal)} outstanding</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
              Loading history...
            </div>
          ) : (
            <HistoryTable bills={bills} />
          )}
        </div>
      </div>
    </div>
  );
}

```

(Leave the trailing blank line before `// ─── Custom Tooltip` — don't remove that comment.)

- [ ] **Step 4: Add the Eye button + `onView` prop to `VendorRow`**

Find `VendorRow`'s signature and its action cell (as left by Task 2):

```javascript
function VendorRow({ vendorName, items, buckets }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.outstanding, 0);
  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);
```

Replace with:

```javascript
function VendorRow({ vendorName, items, buckets, onView }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.outstanding, 0);
  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);
  const vendorId = items[0]?.vendorId;
```

Then find the action cell Task 2 left behind:

```javascript
        <td className="py-3 pr-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <ExportMenu
              label={vendorName}
              onPrint={() => printVendorStatement(vendorName, items)}
              onExcel={() => exportVendorStatement(vendorName, items)}
            />
            {expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
```

Replace with:

```javascript
        <td className="py-3 pr-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onView(vendorId, vendorName); }}
              title={`View full transaction history — ${vendorName}`}
              className="text-gray-400 hover:text-blue-600 transition-colors"
            >
              <Eye className="w-4 h-4" />
            </button>
            <ExportMenu
              label={vendorName}
              onPrint={() => printVendorStatement(vendorName, items)}
              onExcel={() => exportVendorStatement(vendorName, items)}
            />
            {expanded
              ? <ChevronUp className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
```

- [ ] **Step 5: Add state, `openHistoryDrawer`, and the debounced search-history effect to `APAgingPage`**

Find the top of `APAgingPage`'s body:

```javascript
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [hiddenOptional, setHiddenOptional] = useState(() => new Set());

  const toggleOptionalBucket = (bucket) => {
```

Replace with:

```javascript
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [hiddenOptional, setHiddenOptional] = useState(() => new Set());
  const [historyResults, setHistoryResults] = useState([]); // [{ vendor, bills }] — full history for search
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewVendor, setViewVendor] = useState(null); // { vendorId, vendorName } — drawer target
  const [viewBills, setViewBills]   = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const openHistoryDrawer = async (vendorId, vendorName) => {
    setViewVendor({ vendorId, vendorName });
    setViewLoading(true);
    try {
      const { data: billRes } = await pApi.bills.list({ vendorId, limit: 100 });
      setViewBills(billRes.data);
    } catch {
      toast.error('Failed to load vendor history');
      setViewBills([]);
    } finally {
      setViewLoading(false);
    }
  };

  const toggleOptionalBucket = (bucket) => {
```

Then find the `load` callback and its two `useEffect`s:

```javascript
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await pApi.bills.aging();
      setData(r.data);
      setLastRefresh(new Date());
    } catch (err) {
      toast.error('Failed to load aging report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
```

Replace with:

```javascript
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await pApi.bills.aging();
      setData(r.data);
      setLastRefresh(new Date());
    } catch (err) {
      toast.error('Failed to load aging report');
    } finally {
      setLoading(false);
    }
  }, []);

  // Searching a vendor name pulls their FULL bill history (paid, open, void —
  // everything), not just what's currently outstanding — debounced so typing
  // doesn't fire a fetch per keystroke.
  useEffect(() => {
    const term = search.trim();
    if (!term) { setHistoryResults([]); setHistoryLoading(false); return; }

    setHistoryLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data: vendors } = await pApi.vendors.list({ search: term });
        const results = await Promise.all(
          vendors.map(async (vendor) => {
            try {
              const { data: billRes } = await pApi.bills.list({ vendorId: vendor.id, limit: 100 });
              return { vendor, bills: billRes.data };
            } catch {
              return { vendor, bills: [] };
            }
          })
        );
        setHistoryResults(results);
      } catch {
        toast.error('Failed to load vendor history');
        setHistoryResults([]);
      } finally {
        setHistoryLoading(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { load(); }, [load]);
```

- [ ] **Step 6: Make the "Detail by Vendor" card's filters/table conditional on search, add search-mode rendering, add the drawer**

Find the "Detail by Vendor" card header (as left by Task 2) — the title line and the bucket-filter row:

```javascript
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Detail by Vendor</h3>
          <div className="flex items-center gap-2">
            <button
              className="btn-secondary btn-sm"
              disabled={sortedVendors.length === 0}
              onClick={() => printAllVendorsSummary(sortedVendors)}
              title="Print all vendors, alphabetically, each with their full bill history"
            >
              <Printer className="w-3.5 h-3.5" /> Print All
            </button>
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-48 py-1.5"
                placeholder="Filter vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <BucketFilterDropdown hidden={hiddenOptional} onToggle={toggleOptionalBucket} />
          </div>
        </div>
```

Replace with:

```javascript
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">
            {search.trim() ? 'Search Results — Full Vendor History' : 'Detail by Vendor'}
          </h3>
          <div className="flex items-center gap-2">
            {!search.trim() && (
              <button
                className="btn-secondary btn-sm"
                disabled={sortedVendors.length === 0}
                onClick={() => printAllVendorsSummary(sortedVendors)}
                title="Print all vendors, alphabetically, each with their full bill history"
              >
                <Printer className="w-3.5 h-3.5" /> Print All
              </button>
            )}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-48 py-1.5"
                placeholder="Search vendor name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {!search.trim() && (
              <BucketFilterDropdown hidden={hiddenOptional} onToggle={toggleOptionalBucket} />
            )}
          </div>
        </div>
```

Now find everything from the table (`<div className="overflow-x-auto">`) through the footer note div, ending with the closing of the "Detail by Vendor" `card` div — currently:

```javascript
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4 min-w-48">Vendor</th>
                {visibleBuckets.map((b) => (
                  <th key={b} className="text-right whitespace-nowrap">
                    <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                  </th>
                ))}
                <th className="text-right pr-4">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {Object.keys(grouped).length === 0 ? (
                <tr>
                  <td colSpan={visibleBuckets.length + 3} className="text-center py-12 text-gray-400">
                    {search ? 'No vendors match your search.' : 'No outstanding payables. You are all caught up! 🎉'}
                  </td>
                </tr>
              ) : sortedVendors.map(([vendorName, items]) => (
                <VendorRow key={vendorName} vendorName={vendorName} items={items} buckets={visibleBuckets} />
              ))}
            </tbody>

            {/* Totals row */}
            {Object.keys(grouped).length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="py-3 pl-4 text-gray-700">TOTAL</td>
                  {visibleBuckets.map((bucket) => {
                    const filteredTotal = filtered
                      .filter((i) => i.bucket === bucket)
                      .reduce((s, i) => s + i.outstanding, 0);
                    return (
                      <td key={bucket} className="text-right py-3">
                        <span style={{ color: filteredTotal > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}>
                          {formatCurrency(filteredTotal)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="text-right py-3 pr-4 text-blue-700">
                    {formatCurrency(filtered.reduce((s, i) => s + i.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Aging calculated as of today · Only Open and Partial bills are included · Void and Paid bills are excluded
          {hiddenOptional.size > 0 && ' · Some overdue buckets are hidden by the filter — Total still includes every bill.'}
        </div>
      </div>
```

Replace with (the whole table + totals + footer note wrapped in `{!search.trim() && (<>...</>)}`, then the search-results block and the drawer as new siblings after the card closes):

```javascript
        {!search.trim() && (
          <>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="pl-4 min-w-48">Vendor</th>
                    {visibleBuckets.map((b) => (
                      <th key={b} className="text-right whitespace-nowrap">
                        <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                      </th>
                    ))}
                    <th className="text-right pr-4">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(grouped).length === 0 ? (
                    <tr>
                      <td colSpan={visibleBuckets.length + 3} className="text-center py-12 text-gray-400">
                        No outstanding payables. You are all caught up! 🎉
                      </td>
                    </tr>
                  ) : sortedVendors.map(([vendorName, items]) => (
                    <VendorRow key={vendorName} vendorName={vendorName} items={items} buckets={visibleBuckets} onView={openHistoryDrawer} />
                  ))}
                </tbody>

                {/* Totals row */}
                {Object.keys(grouped).length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                      <td className="py-3 pl-4 text-gray-700">TOTAL</td>
                      {visibleBuckets.map((bucket) => {
                        const filteredTotal = filtered
                          .filter((i) => i.bucket === bucket)
                          .reduce((s, i) => s + i.outstanding, 0);
                        return (
                          <td key={bucket} className="text-right py-3">
                            <span style={{ color: filteredTotal > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}>
                              {formatCurrency(filteredTotal)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-right py-3 pr-4 text-blue-700">
                        {formatCurrency(filtered.reduce((s, i) => s + i.outstanding, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
              Aging calculated as of today · Only Open and Partial bills are included · Void and Paid bills are excluded
              {hiddenOptional.size > 0 && ' · Some overdue buckets are hidden by the filter — Total still includes every bill.'}
            </div>
          </>
        )}
      </div>

      {/* Full vendor history — shown while searching */}
      {search.trim() && (
        <div className="space-y-3">
          {historyLoading ? (
            <div className="card p-10 flex items-center justify-center text-gray-400">
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
              Searching vendor history...
            </div>
          ) : historyResults.length === 0 ? (
            <div className="card p-10 flex flex-col items-center justify-center text-center text-gray-400 gap-2">
              <History className="w-8 h-8 text-gray-200" />
              <p>No vendors match "{search}".</p>
            </div>
          ) : (
            historyResults.map(({ vendor, bills }) => (
              <HistoryVendorBlock key={vendor.id} vendor={vendor} bills={bills} />
            ))
          )}
        </div>
      )}

      {/* Per-vendor history drawer, opened via the Eye icon */}
      {viewVendor && (
        <VendorHistoryDrawer
          vendorName={viewVendor.vendorName}
          bills={viewBills}
          loading={viewLoading}
          onClose={() => setViewVendor(null)}
        />
      )}
```

Note the important structural change here: the closing `</div>` that used to end the "Detail by Vendor" `card` div now appears right after the conditional table block (before the new "Full vendor history" sibling block) — read the surrounding JSX carefully to make sure the `card` div's closing tag lands in the right place and the overall component still returns one well-formed tree ending in the outermost `</div>` that was already there at the very end of the file.

- [ ] **Step 7: Sanity-check by inspection (no automated frontend test suite in this repo)**

Re-read the full modified file top to bottom. Confirm: every JSX tag opened is closed, `search.trim()` gates the summary table/Print-All/bucket-filter on one side and the history search results on the other with no overlap, `VendorRow` receives `onView={openHistoryDrawer}`, `HistoryTable`/`HistoryVendorBlock`/`VendorHistoryDrawer`/`overdueSeverity`/`outstandingItemsFrom`/`STATUS_BADGE_CLASS` are each defined exactly once, `Fragment` is imported and used only inside `HistoryTable`, and there are no leftover references to anything that doesn't exist (e.g. no stray `grouped`/`filtered` usage inside the now-conditional block that isn't already covered by the `{!search.trim() && (...)}` wrapper).

- [ ] **Step 8: Manual verification against the running dev server**

Ask the user to check, or use the `run` skill, to walk through:

1. Open AP Aging Report, type a vendor name into the search box. Confirm the summary table, Print All button, and bucket filter all disappear, replaced by that vendor's full bill history (including any paid/void bills, not just outstanding ones).
2. Confirm each bill row expands to show its payment history, and the vendor block's own print/export menu works.
3. Clear the search box — confirm the summary table returns exactly as before.
4. Click the Eye icon on any vendor row in the summary table — confirm a slide-out drawer opens showing that vendor's full history, with working Print/Download Statement buttons.
5. Confirm the drawer's Aging column shows "Not yet due" or a day-count bucket, not a crash or `undefined`.

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/payable/aging/page.jsx"
git commit -m "feat(payable): add vendor search + full transaction-history drawer to AP Aging"
```

---

## Plan Self-Review Notes

- **Spec coverage:** backend field additions (Task 1), print/export/Print-All (Task 2), vendor search + history drawer (Task 3) — every section of `docs/superpowers/specs/2026-08-28-ap-aging-print-export-design.md` is covered, including the explicit `overdueSeverity` simplification decision.
- **Type/name consistency checked:** `printVendorStatement`/`printAllVendorsSummary`/`exportVendorStatement`/`ExportMenu` (Task 2) are referenced with identical names in Task 3's `HistoryVendorBlock`/`VendorHistoryDrawer`; `sortedVendors` (Task 2) is referenced identically in Task 3's table-body replacement; `onView`/`openHistoryDrawer` names match between `VendorRow`'s prop and `APAgingPage`'s handler.
- **Out-of-scope items intentionally not implemented anywhere in this plan:** any change to `receivable/aging/page.jsx` itself, duplicating `classifyUpcomingBucket`'s calendar-boundary logic client-side, and any change to the main table's own bucket rendering/optional-hide filter/KPI cards/charts.
