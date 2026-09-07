# AP Aging Due-Date Buckets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Break the AP Aging report's single "Current" bucket into Due Today / This Week / Next Week / This Month / Later, and make the far overdue buckets (31-60/61-90/Over 90 days) hideable via a multi-select filter.

**Architecture:** A new pure date-bucket classifier (`server/utils/apAgingBuckets.js`) decides which upcoming bucket a not-yet-due bill falls into; `payableController.agingReport` wires it in alongside the existing (unchanged) overdue-bucket logic. The frontend page gets the new bucket list/colors, a small local filter-dropdown component, and every render spot that currently iterates the full bucket list switches to a `visibleBuckets` list derived from filter state.

**Tech Stack:** Next.js 14 (App Router) + Express.js + Prisma. `date-fns` (already a project dependency) for calendar week/month math. Jest for backend unit tests — this repo has no frontend test suite, so the frontend task is verified manually in the browser instead.

## Global Constraints

- Weeks are calendar weeks, Monday–Sunday (PH business week).
- Every open bill must land in exactly one bucket — "Later" is the catch-all for anything due after the end of the current calendar month.
- Overdue bucket definitions (`1-30/31-60/61-90/Over 90 days`) are unchanged.
- The multi-select filter only ever applies to `31-60 days`, `61-90 days`, `Over 90 days`. All three are visible by default (nothing hidden on page load).
- KPI header cards (Total Outstanding, Not Yet Due, Total Overdue, Overdue %) always reflect the full dataset — never filtered by the bucket-visibility filter.
- The bar chart and "Bucket Summary" panel DO follow the filter — they render `visibleBuckets` only.
- Scope is `app/(dashboard)/payable/aging/page.jsx` and its backend (`payableController.agingReport`) only. AR Aging (`receivableController.agingReport`, `app/(dashboard)/receivable/aging/page.jsx`) is untouched.

---

### Task 1: Due-date bucket classifier utility

**Files:**
- Create: `server/utils/apAgingBuckets.js`
- Test: `tests/apAgingBuckets.test.js`

**Interfaces:**
- Produces: `AGING_BUCKETS` — `string[]`, the full ordered bucket list: `['Due Today', 'This Week', 'Next Week', 'This Month', 'Later', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days']`.
- Produces: `classifyUpcomingBucket(dueDate: Date, today: Date): string` — returns one of `'Due Today' | 'This Week' | 'Next Week' | 'This Month' | 'Later'`. Only valid to call for a bill that is not overdue (`dueDate >= today`).

- [ ] **Step 1: Write the failing test**

Create `tests/apAgingBuckets.test.js`:

```js
const { classifyUpcomingBucket, AGING_BUCKETS } = require('../server/utils/apAgingBuckets');

describe('classifyUpcomingBucket', () => {
  // Monday, 2026-08-03 — a "today" with clean week/month boundaries:
  // This Week = Aug 4-9, Next Week = Aug 10-16, This Month = Aug 17-31, Later = Sep 1+.
  const TODAY = new Date('2026-08-03T00:00:00');

  test('due today', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-03'), TODAY)).toBe('Due Today');
  });

  test('this week: day after today through this Sunday', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-04'), TODAY)).toBe('This Week');
    expect(classifyUpcomingBucket(new Date('2026-08-09'), TODAY)).toBe('This Week');
  });

  test('next week: Monday through Sunday of the following week', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-10'), TODAY)).toBe('Next Week');
    expect(classifyUpcomingBucket(new Date('2026-08-16'), TODAY)).toBe('Next Week');
  });

  test('this month: after next week through end of the calendar month', () => {
    expect(classifyUpcomingBucket(new Date('2026-08-17'), TODAY)).toBe('This Month');
    expect(classifyUpcomingBucket(new Date('2026-08-31'), TODAY)).toBe('This Month');
  });

  test('later: after the end of the current calendar month', () => {
    expect(classifyUpcomingBucket(new Date('2026-09-01'), TODAY)).toBe('Later');
    expect(classifyUpcomingBucket(new Date('2027-01-15'), TODAY)).toBe('Later');
  });

  test('near month-end: a short "next week" can already extend past month-end, leaving "This Month" empty', () => {
    // Thursday, 2026-08-27: this week ends Sun Aug 30, next week ends Sun Sep 6,
    // but the calendar month ends Aug 31 — before next week's Sunday. Any date
    // past next week's Sunday is therefore already past month-end too, so it's
    // "Later", never "This Month", for this particular "today".
    const nearMonthEnd = new Date('2026-08-27T00:00:00');
    expect(classifyUpcomingBucket(new Date('2026-09-07'), nearMonthEnd)).toBe('Later');
  });
});

describe('AGING_BUCKETS', () => {
  test('is the full ordered list, upcoming buckets before overdue buckets', () => {
    expect(AGING_BUCKETS).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
      '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/apAgingBuckets.test.js`
Expected: FAIL with `Cannot find module '../server/utils/apAgingBuckets'`

- [ ] **Step 3: Write minimal implementation**

Create `server/utils/apAgingBuckets.js`:

```js
const { startOfDay, endOfWeek, addWeeks, endOfMonth, isSameDay, isAfter } = require('date-fns');

// Full aging-bucket order shared by the "not yet due" and "overdue" halves of
// a bill's lifecycle. payableController.agingReport reduces bill totals into
// these keys to build the bucket summary.
const AGING_BUCKETS = [
  'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
  '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
];

// Classifies a not-yet-due bill (dueDate >= today) into one of the five
// upcoming buckets. Weeks run Monday-Sunday (PH business week).
function classifyUpcomingBucket(dueDate, today) {
  const day = startOfDay(dueDate);
  const now = startOfDay(today);

  if (isSameDay(day, now)) return 'Due Today';

  const endThisWeek = endOfWeek(now, { weekStartsOn: 1 });
  if (!isAfter(day, endThisWeek)) return 'This Week';

  const endNextWeek = endOfWeek(addWeeks(now, 1), { weekStartsOn: 1 });
  if (!isAfter(day, endNextWeek)) return 'Next Week';

  const endThisMonth = endOfMonth(now);
  if (!isAfter(day, endThisMonth)) return 'This Month';

  return 'Later';
}

module.exports = { AGING_BUCKETS, classifyUpcomingBucket };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/apAgingBuckets.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/utils/apAgingBuckets.js tests/apAgingBuckets.test.js
git commit -m "feat(payable): add due-date bucket classifier for AP aging"
```

---

### Task 2: Wire the classifier into the AP aging report endpoint

**Files:**
- Modify: `server/controllers/payableController.js:1-6` (add require), `server/controllers/payableController.js:240-269` (`agingReport`)
- Test: `tests/payableAgingReportBuckets.test.js`

**Interfaces:**
- Consumes: `AGING_BUCKETS`, `classifyUpcomingBucket(dueDate, today)` from Task 1 (`server/utils/apAgingBuckets.js`).
- Produces: `GET /api/payable/aging` response `items[].bucket` now takes one of the 9 `AGING_BUCKETS` values instead of the old 5-value set (`Current` is gone); `summary` object now has all 9 keys.

- [ ] **Step 1: Write the failing test**

Create `tests/payableAgingReportBuckets.test.js`:

```js
jest.mock('../server/config/database', () => ({
  bill:   { findMany: jest.fn() },
  vendor: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-08-03T00:00:00')); // Monday
});

afterEach(() => jest.useRealTimers());

describe('agingReport — due-date buckets', () => {
  test('classifies not-yet-due bills into Due Today / This Week / Next Week / This Month / Later', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-A', vendorId: 1, dueDate: new Date('2026-08-03'), totalAmount: 100, paidAmount: 0 }, // Due Today
      { billNo: 'BILL-B', vendorId: 1, dueDate: new Date('2026-08-09'), totalAmount: 200, paidAmount: 0 }, // This Week
      { billNo: 'BILL-C', vendorId: 1, dueDate: new Date('2026-08-16'), totalAmount: 300, paidAmount: 0 }, // Next Week
      { billNo: 'BILL-D', vendorId: 1, dueDate: new Date('2026-08-31'), totalAmount: 400, paidAmount: 0 }, // This Month
      { billNo: 'BILL-E', vendorId: 1, dueDate: new Date('2026-09-15'), totalAmount: 500, paidAmount: 0 }, // Later
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items.map((i) => i.bucket)).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
    ]);
    expect(result.summary['Due Today']).toBe(100);
    expect(result.summary['Later']).toBe(500);
  });

  test('overdue bills still bucket by days overdue, unaffected by the due-date buckets', async () => {
    prisma.bill.findMany.mockResolvedValue([
      { billNo: 'BILL-F', vendorId: 1, dueDate: new Date('2026-07-01'), totalAmount: 1000, paidAmount: 0 }, // 33 days overdue
    ]);
    prisma.vendor.findMany.mockResolvedValue([{ id: 1, name: 'Acme' }]);

    const result = await run(ctrl.agingReport, {});

    expect(result.items[0].bucket).toBe('31-60 days');
  });

  test('summary has all 9 bucket keys even with no bills', async () => {
    prisma.bill.findMany.mockResolvedValue([]);
    prisma.vendor.findMany.mockResolvedValue([]);

    const result = await run(ctrl.agingReport, {});

    expect(Object.keys(result.summary)).toEqual([
      'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
      '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/payableAgingReportBuckets.test.js`
Expected: FAIL — first test's `result.items.map((i) => i.bucket)` is `['Current', 'Current', 'Current', 'Current', 'Current']`, not the expected array.

- [ ] **Step 3: Write minimal implementation**

In `server/controllers/payableController.js`, add the require near the top (after the existing requires, e.g. after line 6):

```js
const { AGING_BUCKETS, classifyUpcomingBucket } = require('../utils/apAgingBuckets');
```

Then replace the body of `exports.agingReport` (currently lines 240-269) with:

```js
exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const bills = await prisma.bill.findMany({
      where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
    });

    // Fetch vendor names separately (not via `include`) so a bill whose vendor
    // was deleted out from under it (orphaned FK) can't crash the whole report —
    // Prisma throws on `include` when a required relation resolves to null.
    const vendorIds = [...new Set(bills.map((b) => b.vendorId))];
    const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } });
    const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today - due) / 86400000));
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

    const buckets = AGING_BUCKETS;
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/payableAgingReportBuckets.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `npx jest`
Expected: All tests pass (no existing test asserted on the old `'Current'` bucket name — confirm this by checking the output for any newly-failing test; if one references `'Current'` for AP aging specifically, that test needs updating to the new bucket names as part of this task).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payableController.js tests/payableAgingReportBuckets.test.js
git commit -m "feat(payable): classify not-yet-due bills into due-date buckets in AP aging"
```

---

### Task 3: Frontend — due-date buckets, colors, optional-bucket filter, KPI fixes

**Files:**
- Modify: `app/(dashboard)/payable/aging/page.jsx`

**Interfaces:**
- Consumes: `GET /api/payable/aging` response shape from Task 2 — `items[].bucket` is one of the 9 `AGING_BUCKETS` string values; `summary` has all 9 keys.
- No new exports — this is a leaf page component.

This task has no automated test (the repo has no frontend test suite — `npx jest` only covers `server/` and `tests/`). Verify manually in the browser as the last step.

- [ ] **Step 1: Update imports**

In `app/(dashboard)/payable/aging/page.jsx`, replace the top imports (currently lines 1-13):

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend
} from 'recharts';
```

with:

```jsx
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

- [ ] **Step 2: Replace the bucket constants**

Replace the constants block (currently lines 15-32):

```jsx
// ─── Constants ────────────────────────────────────────────────
const BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const BUCKET_COLORS = {
  'Current':       '#22c55e',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#991b1b',
};

const BUCKET_BADGE = {
  'Current':       'badge-green',
  '1-30 days':     'badge-yellow',
  '31-60 days':    'text-orange-700 bg-orange-100 badge',
  '61-90 days':    'badge-red',
  'Over 90 days':  'bg-red-900 text-white badge',
};
```

with:

```jsx
// ─── Constants ────────────────────────────────────────────────
const BUCKETS = [
  'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
  '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
];
const NOT_YET_DUE_BUCKETS = ['Due Today', 'This Week', 'Next Week', 'This Month', 'Later'];
const OVERDUE_BUCKETS = ['1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
const OPTIONAL_BUCKETS = ['31-60 days', '61-90 days', 'Over 90 days'];

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

- [ ] **Step 3: Add the bucket filter dropdown component**

Insert a new component right after `CustomTooltip` and before `VendorRow` (currently between lines 48 and 50):

```jsx
// ─── Bucket Filter Dropdown ─────────────────────────────────────
function BucketFilterDropdown({ hidden, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary text-sm py-1.5">
        <ListFilter className="w-3.5 h-3.5" /> Buckets
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 card p-2 z-10 shadow-lg">
          {OPTIONAL_BUCKETS.map((bucket) => (
            <label key={bucket} className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer hover:bg-gray-50 rounded-lg">
              <input
                type="checkbox"
                checked={!hidden.has(bucket)}
                onChange={() => onToggle(bucket)}
              />
              <span style={{ color: BUCKET_COLORS[bucket] }}>{bucket}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Make VendorRow render a `buckets` prop instead of the module-level `BUCKETS`**

Change the function signature (currently line 51):

```jsx
function VendorRow({ vendorName, items }) {
```

to:

```jsx
function VendorRow({ vendorName, items, buckets }) {
```

Then replace the two column-rendering loops inside it. First one (currently lines 74-84):

```jsx
        {BUCKETS.map((bucket) => (
          <td key={bucket} className="text-right py-3">
            {bucketTotals[bucket] > 0 ? (
              <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                {formatCurrency(bucketTotals[bucket])}
              </span>
            ) : (
              <span className="text-gray-300 text-sm">—</span>
            )}
          </td>
        ))}
```

becomes:

```jsx
        {buckets.map((bucket) => (
          <td key={bucket} className="text-right py-3">
            {bucketTotals[bucket] > 0 ? (
              <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                {formatCurrency(bucketTotals[bucket])}
              </span>
            ) : (
              <span className="text-gray-300 text-sm">—</span>
            )}
          </td>
        ))}
```

Second one, in the expanded item rows (currently lines 103-113):

```jsx
          {BUCKETS.map((bucket) => (
            <td key={bucket} className="text-right py-2">
              {item.bucket === bucket ? (
                <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                  {formatCurrency(item.outstanding)}
                </span>
              ) : (
                <span className="text-gray-200 text-xs">—</span>
              )}
            </td>
          ))}
```

becomes:

```jsx
          {buckets.map((bucket) => (
            <td key={bucket} className="text-right py-2">
              {item.bucket === bucket ? (
                <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                  {formatCurrency(item.outstanding)}
                </span>
              ) : (
                <span className="text-gray-200 text-xs">—</span>
              )}
            </td>
          ))}
```

Then update the per-item status pill (currently line 118):

```jsx
            <span className={`${BUCKET_BADGE[item.bucket]} text-xs`}>{item.daysOverdue === 0 ? 'Current' : `${item.daysOverdue}d`}</span>
```

becomes:

```jsx
            <span className={`${BUCKET_BADGE[item.bucket]} text-xs`}>{item.daysOverdue > 0 ? `${item.daysOverdue}d` : item.bucket}</span>
```

(`bucketTotals` itself, initialized from the module-level `BUCKETS` a few lines above these, stays as-is — it just holds totals for all 9 buckets regardless of which ones are currently visible.)

- [ ] **Step 5: Add filter state to the page component**

Replace the state declarations (currently lines 127-131):

```jsx
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
```

with:

```jsx
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [hiddenOptional, setHiddenOptional] = useState(() => new Set());

  const toggleOptionalBucket = (bucket) => {
    setHiddenOptional((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket); else next.add(bucket);
      return next;
    });
  };
```

- [ ] **Step 6: Compute `visibleBuckets` and fix the KPI/chart calculations**

Right after `if (!data) return null;` and before the `// Group items by vendor` comment (currently lines 155-157), insert:

```jsx
  const visibleBuckets = BUCKETS.filter((b) => !OPTIONAL_BUCKETS.includes(b) || !hiddenOptional.has(b));
```

Then replace the chart-data line (currently lines 168-172):

```jsx
  const chartData = BUCKETS.map((bucket) => ({
    name: bucket,
    amount: data.summary[bucket] || 0,
    count: data.items.filter((i) => i.bucket === bucket).length,
  }));
```

with:

```jsx
  const chartData = visibleBuckets.map((bucket) => ({
    name: bucket,
    amount: data.summary[bucket] || 0,
    count: data.items.filter((i) => i.bucket === bucket).length,
  }));
```

Then replace the KPI derivation lines (currently lines 174-176):

```jsx
  const totalOutstanding = data.total;
  const overdueTotal = BUCKETS.slice(1).reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount = data.items.filter(i => i.bucket !== 'Current').length;
```

with:

```jsx
  const totalOutstanding = data.total;
  const overdueTotal = OVERDUE_BUCKETS.reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount = data.items.filter((i) => OVERDUE_BUCKETS.includes(i.bucket)).length;
  const notYetDueTotal = NOT_YET_DUE_BUCKETS.reduce((s, b) => s + (data.summary[b] || 0), 0);
  const notYetDueCount = data.items.filter((i) => NOT_YET_DUE_BUCKETS.includes(i.bucket)).length;
```

(Note: `overdueTotal`/`overdueCount` previously relied on `BUCKETS.slice(1)` / `bucket !== 'Current'`, which assumed `'Current'` was the only non-overdue bucket at index 0. That assumption breaks now that there are 5 non-overdue buckets, so this fix is required, not optional.)

- [ ] **Step 7: Update the "Not Yet Due" KPI card**

Replace the second KPI card (currently lines 204-208):

```jsx
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Current (Not Due)</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(data.summary['Current'] || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.filter(i => i.bucket === 'Current').length} bills</p>
        </div>
```

with:

```jsx
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Not Yet Due</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(notYetDueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{notYetDueCount} bills</p>
        </div>
```

- [ ] **Step 8: Make the Bucket Summary panel follow the filter**

Replace the panel's bucket loop (currently line 264):

```jsx
            {BUCKETS.map((bucket) => {
```

with:

```jsx
            {visibleBuckets.map((bucket) => {
```

- [ ] **Step 9: Add the filter dropdown next to the vendor search box**

Replace the "Detail by Vendor" card header (currently lines 316-329):

```jsx
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
          </div>
        </div>
```

with:

```jsx
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

- [ ] **Step 10: Make the table header, empty state, rows, and totals row follow the filter**

Replace the table header bucket loop (currently lines 336-340):

```jsx
                {BUCKETS.map((b) => (
                  <th key={b} className="text-right whitespace-nowrap">
                    <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                  </th>
                ))}
```

with:

```jsx
                {visibleBuckets.map((b) => (
                  <th key={b} className="text-right whitespace-nowrap">
                    <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                  </th>
                ))}
```

Replace the empty-state `colSpan` (currently line 348):

```jsx
                  <td colSpan={8} className="text-center py-12 text-gray-400">
```

with:

```jsx
                  <td colSpan={visibleBuckets.length + 3} className="text-center py-12 text-gray-400">
```

Replace the `VendorRow` instantiation (currently line 358):

```jsx
                <VendorRow key={vendorName} vendorName={vendorName} items={items} />
```

with:

```jsx
                <VendorRow key={vendorName} vendorName={vendorName} items={items} buckets={visibleBuckets} />
```

Replace the totals-row bucket loop (currently lines 367-378):

```jsx
                  {BUCKETS.map((bucket) => {
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
```

with:

```jsx
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
```

- [ ] **Step 11: Manual verification in the browser**

This repo has no frontend test suite, so this step is the real gate for this task. The dev server (`npm run dev`) is expected to already be running (do not start a second instance — see project conventions). Next.js hot-reloads automatically on save.

Navigate to `http://localhost:3000/payable/aging` for the BFaith business (this requires an authenticated session — if you don't have valid login credentials in this environment, ask the user to do this check and report back, rather than guessing credentials):

1. Confirm the table header now shows `Due Today, This Week, Next Week, This Month, Later, 1-30 days, 31-60 days, 61-90 days, Over 90 days` as columns (no more `Current`).
2. Confirm the "Buckets ▾" control appears next to the vendor search box, and opening it shows exactly 3 checkboxes: `31-60 days`, `61-90 days`, `Over 90 days` — all checked.
3. Uncheck `61-90 days`: confirm its column disappears from the table header/rows, the "Bucket Summary" panel, and the bar chart, while the KPI cards at the top (Total Outstanding, Not Yet Due, Total Overdue, Overdue %) stay exactly the same numbers as before unchecking.
4. Re-check it and confirm everything reappears.
5. Confirm the "Not Yet Due" KPI card shows a number (not blank/NaN) and its bill count matches the sum of bills currently in Due Today/This Week/Next Week/This Month/Later.
6. Confirm no console errors appear in the browser dev tools.

- [ ] **Step 12: Commit**

```bash
git add "app/(dashboard)/payable/aging/page.jsx"
git commit -m "feat(payable): add due-date buckets and optional-bucket filter to AP aging UI"
```

---

## Self-Review Notes

- **Spec coverage:** Bucket definitions (Task 1), backend wiring (Task 2), bucket colors/badges/filter/KPI rename (Task 3) all covered. "Later" catch-all covered in Task 1's classifier and Task 1's near-month-end test. Calendar Mon-Sun weeks covered in Task 1. Optional-bucket filter defaulting to all-visible covered in Task 3 Step 5 (`useState(() => new Set())` — empty means nothing hidden). Chart/Bucket-Summary-panel following the filter covered in Task 3 Steps 6 and 8. KPI cards staying full-dataset covered in Task 3 Step 6 (derived from `OVERDUE_BUCKETS`/`NOT_YET_DUE_BUCKETS` against `data.summary`, never `visibleBuckets`). AR Aging untouched — no task modifies `receivableController.js` or the AR aging page.
- **Known pre-existing dead code left alone:** `worstBucket` (declared in both `VendorRow` and the main component) is computed but never read anywhere in the current file. It still evaluates without error against the new 9-bucket list, so it's left as-is — not in scope for this feature.
