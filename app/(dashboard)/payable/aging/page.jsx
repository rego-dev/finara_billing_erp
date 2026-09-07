'use client';
import { Fragment, useState, useEffect, useCallback, useRef } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter, ListFilter,
  Printer, FileSpreadsheet, History, Eye, X
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel } from '@/lib/export';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────
const BUCKETS = [
  'Due Today', 'This Week', 'Next Week', 'This Month', 'Later',
  '1-30 days', '31-60 days', '61-90 days', 'Over 90 days',
];
const NOT_YET_DUE_BUCKETS = ['Due Today', 'This Week', 'Next Week', 'This Month', 'Later'];
const OVERDUE_BUCKETS = ['1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];
const OPTIONAL_BUCKETS = ['31-60 days', '61-90 days', 'Over 90 days'];

// Vendor history (search results / drawer) fetch cap — a vendor with more
// bills than this shows a truncation notice rather than silently omitting
// older ones from its outstanding total.
const HISTORY_FETCH_LIMIT = 500;

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
        <td class="mono">${esc(i.billNo)}</td>
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
      <div class="info-box"><div class="info-lbl">Vendor</div><div class="info-val">${esc(vendorName)}</div></div>
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
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
            <span class="mono">${esc(i.billNo)}</span> · Due ${dateFmt(i.dueDate)}${i.daysOverdue > 0 ? ` · ${i.daysOverdue}d overdue` : ''}
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
function HistoryVendorBlock({ vendor, bills, total }) {
  const [expanded, setExpanded] = useState(true);

  const outstandingItems = outstandingItemsFrom(bills);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);
  const truncated = total > bills.length;

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

      {truncated && (
        <div className="px-5 py-2 bg-yellow-50 border-t border-yellow-100 text-xs text-yellow-700">
          Showing the latest {bills.length} of {total} bills — older bills, and any outstanding balance on them, aren't included here or in the printed total.
        </div>
      )}

      {expanded && <HistoryTable bills={bills} />}
    </div>
  );
}

// ─── Slide-out drawer: one vendor's full transaction history ──────────────
function VendorHistoryDrawer({ vendorName, bills, total, loading, onClose }) {
  const outstandingItems = outstandingItemsFrom(bills);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);
  const truncated = !loading && total > bills.length;

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
          {truncated && (
            <div className="px-6 py-2 bg-yellow-50 border-b border-yellow-100 text-xs text-yellow-700">
              Showing the latest {bills.length} of {total} bills — older bills, and any outstanding balance on them, aren't included here or in the printed total.
            </div>
          )}
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

// ─── Custom Tooltip ───────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
        <p className="font-semibold text-gray-800 mb-1">{label}</p>
        <p style={{ color: BUCKET_COLORS[label] }} className="font-bold text-base">
          {formatCurrency(payload[0].value)}
        </p>
        <p className="text-gray-400 text-xs">{payload[0].payload.count} bill{payload[0].payload.count !== 1 ? 's' : ''}</p>
      </div>
    );
  }
  return null;
};

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
        <ListFilter className="w-3.5 h-3.5" /> Buckets{hidden.size > 0 ? ` (${hidden.size} hidden)` : ''}
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

// ─── Vendor Group Row ─────────────────────────────────────────
function VendorRow({ vendorName, items, buckets, onView }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.outstanding, 0);
  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);
  const vendorId = items[0]?.vendorId;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 pl-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <span className="font-medium text-gray-900">{vendorName}</span>
            <span className="badge-gray text-xs">{items.length} bill{items.length !== 1 ? 's' : ''}</span>
          </div>
        </td>
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
        <td className="text-right py-3 pr-4">
          <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
        </td>
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
      </tr>

      {expanded && items.map((item, idx) => (
        <tr key={idx} className="bg-blue-50/40 border-b border-blue-100/50">
          <td className="py-2 pl-14">
            <div>
              <span className="font-mono text-sm text-blue-700">{item.billNo}</span>
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
            </div>
          </td>
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
          <td className="text-right py-2 pr-4">
            <span className="text-sm font-medium">{formatCurrency(item.outstanding)}</span>
          </td>
          <td className="py-2 pr-2 text-center">
            <span className={`${BUCKET_BADGE[item.bucket]} text-xs`}>{item.daysOverdue > 0 ? `${item.daysOverdue}d` : item.bucket}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Main AP Aging Page ───────────────────────────────────────
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [hiddenOptional, setHiddenOptional] = useState(() => new Set());
  const [historyResults, setHistoryResults] = useState([]); // [{ vendor, bills, total }] — full history for search
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewVendor, setViewVendor] = useState(null); // { vendorId, vendorName } — drawer target
  const [viewBills, setViewBills]   = useState([]);
  const [viewTotal, setViewTotal]   = useState(0);
  const [viewLoading, setViewLoading] = useState(false);

  const openHistoryDrawer = async (vendorId, vendorName) => {
    setViewVendor({ vendorId, vendorName });
    setViewBills([]);
    setViewTotal(0);
    setViewLoading(true);
    try {
      const { data: billRes } = await pApi.bills.list({ vendorId, limit: HISTORY_FETCH_LIMIT });
      setViewBills(billRes.data);
      setViewTotal(billRes.total);
    } catch {
      toast.error('Failed to load vendor history');
      setViewBills([]);
      setViewTotal(0);
    } finally {
      setViewLoading(false);
    }
  };

  const toggleOptionalBucket = (bucket) => {
    setHiddenOptional((prev) => {
      const next = new Set(prev);
      if (next.has(bucket)) next.delete(bucket); else next.add(bucket);
      return next;
    });
  };

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
              const { data: billRes } = await pApi.bills.list({ vendorId: vendor.id, limit: HISTORY_FETCH_LIMIT });
              return { vendor, bills: billRes.data, total: billRes.total };
            } catch {
              return { vendor, bills: [], total: 0 };
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

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
      <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p>Building aging report...</p>
    </div>
  );

  if (!data) return null;

  const visibleBuckets = BUCKETS.filter((b) => !OPTIONAL_BUCKETS.includes(b) || !hiddenOptional.has(b));

  // Group items by vendor
  const grouped = {};
  const filtered = data.items.filter((i) =>
    !search.trim() || i.vendor.toLowerCase().includes(search.toLowerCase())
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

  // Chart data
  const chartData = visibleBuckets.map((bucket) => ({
    name: bucket,
    amount: data.summary[bucket] || 0,
    count: data.items.filter((i) => i.bucket === bucket).length,
  }));

  const totalOutstanding = data.total;
  const overdueTotal = OVERDUE_BUCKETS.reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount = data.items.filter((i) => OVERDUE_BUCKETS.includes(i.bucket)).length;
  const notYetDueTotal = NOT_YET_DUE_BUCKETS.reduce((s, b) => s + (data.summary[b] || 0), 0);
  const notYetDueCount = data.items.filter((i) => NOT_YET_DUE_BUCKETS.includes(i.bucket)).length;

  // Worst bucket by amount
  const worstBucket = [...BUCKETS].reverse().find((b) => data.summary[b] > 0) || 'Current';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">AP Aging Report</h1>
          <p className="page-subtitle">
            As of {new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            {lastRefresh && <span className="ml-2 text-gray-400">· Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.length} open bill{data.items.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Not Yet Due</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(notYetDueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{notYetDueCount} bills</p>
        </div>
        <div className="card p-5 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Overdue</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{overdueCount} overdue bill{overdueCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-orange-400">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Overdue %</p>
          <p className="text-2xl font-bold text-orange-600">
            {totalOutstanding > 0 ? ((overdueTotal / totalOutstanding) * 100).toFixed(1) : '0.0'}%
          </p>
          <p className="text-xs text-gray-400 mt-1">of total outstanding</p>
        </div>
      </div>

      {/* Chart + Bucket summary */}
      <div className="grid xl:grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Bar chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Aging Distribution</h3>
            <span className="badge-blue text-xs">By Days Outstanding</span>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={48} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={BUCKET_COLORS[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bucket breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Bucket Summary</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleBuckets.map((bucket) => {
              const amount = data.summary[bucket] || 0;
              const count  = data.items.filter((i) => i.bucket === bucket).length;
              const pct    = totalOutstanding > 0 ? (amount / totalOutstanding) * 100 : 0;
              return (
                <div key={bucket} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: BUCKET_COLORS[bucket] }} />
                      <span className="text-sm font-medium text-gray-700">{bucket}</span>
                      {count > 0 && <span className="badge-gray text-xs">{count}</span>}
                    </div>
                    <span className={`text-sm font-bold ${amount > 0 ? '' : 'text-gray-300'}`}
                      style={{ color: amount > 0 ? BUCKET_COLORS[bucket] : undefined }}>
                      {formatCurrency(amount)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: BUCKET_COLORS[bucket] }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1 text-right">{pct.toFixed(1)}%</p>
                </div>
              );
            })}
            <div className="px-5 py-3 bg-gray-50 flex justify-between font-bold">
              <span className="text-gray-700">Total</span>
              <span className="text-gray-900">{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert banner for severely overdue */}
      {(data.summary['Over 90 days'] || 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {formatCurrency(data.summary['Over 90 days'])} is more than 90 days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {data.items.filter(i => i.bucket === 'Over 90 days').length} bills · Immediate action recommended. Contact vendors to negotiate payment terms or escalate.
            </p>
          </div>
        </div>
      )}

      {/* Detailed table */}
      <div className="card">
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
            historyResults.map(({ vendor, bills, total }) => (
              <HistoryVendorBlock key={vendor.id} vendor={vendor} bills={bills} total={total} />
            ))
          )}
        </div>
      )}

      {/* Per-vendor history drawer, opened via the Eye icon */}
      {viewVendor && (
        <VendorHistoryDrawer
          vendorName={viewVendor.vendorName}
          bills={viewBills}
          total={viewTotal}
          loading={viewLoading}
          onClose={() => setViewVendor(null)}
        />
      )}
    </div>
  );
}
