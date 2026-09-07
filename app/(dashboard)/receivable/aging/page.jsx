'use client';
import { Fragment, useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, TrendingUp,
  Users, ChevronDown, ChevronUp, Filter, Printer, History, FileSpreadsheet, Eye, X, Download,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel } from '@/lib/export';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend,
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────
const BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const BUCKET_COLORS = {
  'Current':       '#22c55e',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#7f1d1d',
};

const BUCKET_BADGE_CLASS = {
  'Current':       'bg-green-100 text-green-700',
  '1-30 days':     'bg-yellow-100 text-yellow-700',
  '31-60 days':    'bg-orange-100 text-orange-700',
  '61-90 days':    'bg-red-100 text-red-700',
  'Over 90 days':  'bg-red-900 text-white',
};

const STATUS_BADGE_CLASS = {
  OPEN:    'bg-blue-100 text-blue-700',
  PARTIAL: 'bg-yellow-100 text-yellow-700',
  PAID:    'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  VOID:    'bg-gray-100 text-gray-500',
};

// Days-overdue → bucket, mirrors the server-side aging calculation
function bucketFor(dueDate) {
  const daysOverdue = Math.max(0, Math.floor((new Date() - new Date(dueDate)) / 86400000));
  const bucket = daysOverdue === 0 ? 'Current'
    : daysOverdue <= 30 ? '1-30 days'
    : daysOverdue <= 60 ? '31-60 days'
    : daysOverdue <= 90 ? '61-90 days'
    : 'Over 90 days';
  return { daysOverdue, bucket };
}

// ─── Print a per-customer Statement of Account (outstanding invoices only) ──
// Each invoice row is followed by its payment history (if any were recorded
// against it) so the reader can see exactly what was collected and when.
async function printCustomerStatement(customerName, outstandingItems) {
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
        <td class="mono">${i.invoiceNo}</td>
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
      <div class="info-box"><div class="info-lbl">Customer</div><div class="info-val">${customerName}</div></div>
    </div>
    <table>
      <thead><tr><th>Invoice #</th><th>Due Date</th><th>Aging</th><th class="right">Outstanding</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3">TOTAL OUTSTANDING</td><td class="right">${phpFmt(total)}</td></tr></tfoot>
    </table>
    <p class="small gray" style="margin-top:10px;">This statement reflects open and partially paid invoices only, with their payment history, as of the print date above.</p>`;

  await printDocument('Statement of Account', customerName, body);
}

// ─── Print ALL customers, alphabetically, each with their full invoice history ──
// Mirrors the on-screen expandable row: a bold customer summary line, followed
// by every one of that customer's outstanding invoices — no need to expand
// each row individually, it's all shown at once.
async function printAllCustomersSummary(customerGroups) {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const alphabetical = customerGroups.slice().sort(([a], [b]) => a.localeCompare(b));

  const grandTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  let grandTotal = 0;
  let invoiceCount = 0;

  const sections = alphabetical.map(([customerName, items]) => {
    const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });
    const total = items.reduce((s, i) => s + i.outstanding, 0);
    BUCKETS.forEach((b) => { grandTotals[b] += bucketTotals[b]; });
    grandTotal += total;
    invoiceCount += items.length;

    const customerRow = `
      <tr style="background:#f9fafb;">
        <td class="bold">${esc(customerName)} <span class="small gray">(${items.length} inv.)</span></td>
        ${BUCKETS.map((b) => `<td class="right mono bold">${bucketTotals[b] > 0 ? phpFmt(bucketTotals[b]) : '—'}</td>`).join('')}
        <td class="right mono bold">${phpFmt(total)}</td>
      </tr>`;

    const invoiceRows = items
      .slice()
      .sort((a, b) => b.daysOverdue - a.daysOverdue)
      .map((i) => `
        <tr>
          <td class="small gray" style="padding-left:20px;">
            <span class="mono">${i.invoiceNo}</span> · Due ${dateFmt(i.dueDate)}${i.daysOverdue > 0 ? ` · ${i.daysOverdue}d overdue` : ''}
          </td>
          ${BUCKETS.map((b) => `<td class="right mono small">${i.bucket === b ? phpFmt(i.outstanding) : ''}</td>`).join('')}
          <td class="right mono small">${phpFmt(i.outstanding)}</td>
        </tr>`)
      .join('');

    return customerRow + invoiceRows;
  }).join('');

  const body = `
    <table>
      <thead>
        <tr>
          <th>Customer / Invoice</th>
          ${BUCKETS.map((b) => `<th class="right">${b}</th>`).join('')}
          <th class="right">Total</th>
        </tr>
      </thead>
      <tbody>${sections}</tbody>
      <tfoot>
        <tr>
          <td class="bold">GRAND TOTAL (${alphabetical.length} customer${alphabetical.length !== 1 ? 's' : ''}, ${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''})</td>
          ${BUCKETS.map((b) => `<td class="right mono bold">${phpFmt(grandTotals[b])}</td>`).join('')}
          <td class="right mono bold">${phpFmt(grandTotal)}</td>
        </tr>
      </tfoot>
    </table>
    <p class="small gray" style="margin-top:10px;">Customers listed alphabetically, each with their full outstanding invoice history. Reflects open and partially paid invoices only, as of the print date above.</p>`;

  await printDocument('AR Aging — Detail by Customer', `${alphabetical.length} customer${alphabetical.length !== 1 ? 's' : ''} · ${invoiceCount} invoice${invoiceCount !== 1 ? 's' : ''}`, body);
}

// ─── Export a per-customer Statement of Account to Excel ───────────────────
// Each invoice row is followed by one row per payment applied to it, so the
// payment history is visible in the spreadsheet, not just the outstanding total.
function exportCustomerStatement(customerName, outstandingItems) {
  const total = outstandingItems.reduce((s, i) => s + i.outstanding, 0);
  const rows = [];
  outstandingItems
    .slice()
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .forEach((i) => {
      rows.push({ type: 'Invoice', invoiceNo: i.invoiceNo, dueDate: i.dueDate, bucket: i.bucket, outstanding: i.outstanding, amount: '', notes: i.notes });
      // `payments` is undefined when the source list didn't fetch payment history at
      // all (e.g. the main aging table) — omit the rows rather than claim "none".
      if (Array.isArray(i.payments)) {
        if (i.payments.length) {
          i.payments.forEach((p) => rows.push({
            type: 'Payment', invoiceNo: `  ↳ ${p.paymentNo}`, dueDate: p.paymentDate, bucket: p.paymentMethod,
            outstanding: '', amount: Number(p.amount), notes: p.reference || '',
          }));
        } else {
          rows.push({ type: 'Payment', invoiceNo: '  ↳ (none)', dueDate: '', bucket: '', outstanding: '', amount: '', notes: 'No payments recorded yet' });
        }
      }
    });
  rows.push({ type: '', invoiceNo: '', dueDate: '', bucket: 'TOTAL OUTSTANDING', outstanding: total, amount: '', notes: '' });

  const safeName = customerName.replace(/[^a-z0-9]+/gi, '-');
  exportToExcel(
    rows,
    [
      { key: 'invoiceNo', label: 'Invoice # / Payment #' },
      { key: 'dueDate', label: 'Due / Payment Date', format: (v) => (v ? dateFmt(v) : '') },
      { key: 'bucket', label: 'Aging / Method' },
      { key: 'outstanding', label: 'Outstanding', format: (v) => (v === '' ? '' : phpFmt(v)) },
      { key: 'amount', label: 'Amount Paid', format: (v) => (v === '' ? '' : phpFmt(v)) },
      { key: 'notes', label: 'Notes / Reference' },
    ],
    `Statement-${safeName}`,
    customerName.slice(0, 31)
  );
}

// ─── Print / Export dropdown, used per customer row ─────────────────────────
function ExportMenu({ onPrint, onExcel, disabled, label }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={`Export statement — ${label}`}
        className="text-gray-400 hover:text-green-600 transition-colors disabled:opacity-30"
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

// ─── Custom Bar Tooltip ───────────────────────────────────────
const BarTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm min-w-36">
        <p className="font-semibold text-gray-800 mb-1">{label}</p>
        <p className="font-bold text-base" style={{ color: BUCKET_COLORS[label] }}>
          {formatCurrency(payload[0].value)}
        </p>
        <p className="text-gray-400 text-xs">
          {payload[0].payload.count} invoice{payload[0].payload.count !== 1 ? 's' : ''}
        </p>
      </div>
    );
  }
  return null;
};

// ─── Pie Tooltip ──────────────────────────────────────────────
const PieTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
        <p className="font-semibold" style={{ color: payload[0].payload.fill }}>{payload[0].name}</p>
        <p className="font-bold">{formatCurrency(payload[0].value)}</p>
        <p className="text-gray-400 text-xs">{payload[0].payload.percent?.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
};

// ─── Expandable Customer Row ──────────────────────────────────
function CustomerRow({ customerName, items, onView }) {
  const [expanded, setExpanded] = useState(false);

  const total = items.reduce((s, i) => s + i.outstanding, 0);

  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);
  const overdueAmt  = BUCKETS.slice(1).reduce((s, b) => s + (bucketTotals[b] || 0), 0);
  const customerId  = items[0]?.customerId;

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 pl-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 text-xs font-bold">
              {customerName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
            </div>
            <span className="font-medium text-gray-900">{customerName}</span>
            <span className="badge-gray text-xs">{items.length} inv.</span>
            {overdueAmt > 0 && (
              <span className="badge bg-red-100 text-red-600 text-xs">{formatCurrency(overdueAmt)} overdue</span>
            )}
          </div>
        </td>
        {BUCKETS.map((bucket) => (
          <td key={bucket} className="text-right py-3">
            {bucketTotals[bucket] > 0 ? (
              <span className="font-medium text-sm" style={{ color: BUCKET_COLORS[bucket] }}>
                {formatCurrency(bucketTotals[bucket])}
              </span>
            ) : (
              <span className="text-gray-200 text-sm">—</span>
            )}
          </td>
        ))}
        <td className="text-right py-3 pr-4">
          <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
        </td>
        <td className="py-3 pr-2 text-center">
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onView(customerId, customerName); }}
              title={`View full transaction history — ${customerName}`}
              className="text-gray-400 hover:text-blue-600 transition-colors"
            >
              <Eye className="w-4 h-4" />
            </button>
            <ExportMenu
              label={customerName}
              onPrint={() => printCustomerStatement(customerName, items)}
              onExcel={() => exportCustomerStatement(customerName, items)}
            />
            {expanded
              ? <ChevronUp   className="w-4 h-4 text-gray-400" />
              : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
      </tr>

      {expanded && items.map((item, idx) => (
        <tr key={idx} className="bg-green-50/40 border-b border-green-100/50">
          <td className="py-2 pl-14">
            <div>
              <span className="font-mono text-sm text-green-700">{item.invoiceNo}</span>
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
              {item.daysOverdue > 0 && (
                <span className="text-xs text-red-500 ml-2">({item.daysOverdue}d overdue)</span>
              )}
            </div>
          </td>
          {BUCKETS.map((bucket) => (
            <td key={bucket} className="text-right py-2">
              {item.bucket === bucket ? (
                <span className="font-medium text-sm" style={{ color: BUCKET_COLORS[bucket] }}>
                  {formatCurrency(item.outstanding)}
                </span>
              ) : (
                <span className="text-gray-100 text-xs">—</span>
              )}
            </td>
          ))}
          <td className="text-right py-2 pr-4">
            <span className="text-sm font-medium">{formatCurrency(item.outstanding)}</span>
          </td>
          <td className="py-2 pr-2 text-center">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_BADGE_CLASS[item.bucket]}`}>
              {item.bucket}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Shared full-history table: Invoice #, dates, status, aging, amounts, notes ──
// Each row expands to show the individual AR payments applied to that invoice,
// so a partial/aging balance can be traced back to exactly what was collected and when.
function HistoryTable({ invoices }) {
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
            <th className="pl-4">Invoice #</th>
            <th>Invoice Date</th>
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
          {invoices.length === 0 ? (
            <tr><td colSpan={9} className="text-center py-8 text-gray-400">No invoices for this customer yet.</td></tr>
          ) : invoices
            .slice()
            .sort((a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate))
            .map((inv) => {
              const isOutstanding = ['OPEN', 'PARTIAL', 'OVERDUE'].includes(inv.status);
              const { bucket } = isOutstanding ? bucketFor(inv.dueDate) : { bucket: null };
              const payments = inv.payments || [];
              const expanded = expandedIds.has(inv.id);
              return (
                <Fragment key={inv.id}>
                  <tr
                    className="border-b border-gray-100 cursor-pointer hover:bg-gray-50"
                    onClick={() => toggle(inv.id)}
                  >
                    <td className="pl-4 py-2 font-mono text-sm text-green-700">
                      <span className="inline-flex items-center gap-1.5">
                        {expanded
                          ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
                          : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        {inv.invoiceNo}
                        {payments.length > 0 && <span className="badge-gray text-xs font-sans">{payments.length}</span>}
                      </span>
                    </td>
                    <td className="py-2 text-sm text-gray-600">{formatDate(inv.invoiceDate)}</td>
                    <td className="py-2 text-sm text-gray-600">{formatDate(inv.dueDate)}</td>
                    <td className="py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASS[inv.status] || 'bg-gray-100 text-gray-500'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2">
                      {bucket ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_BADGE_CLASS[bucket]}`}>
                          {bucket}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="text-right py-2 text-sm">{formatCurrency(inv.totalAmount)}</td>
                    <td className="text-right py-2 text-sm text-gray-500">{formatCurrency(inv.paidAmount)}</td>
                    <td className="text-right py-2 text-sm font-semibold">
                      {formatCurrency(Number(inv.totalAmount) - Number(inv.paidAmount))}
                    </td>
                    <td className="py-2 pr-4 text-xs text-gray-500 max-w-[200px] truncate" title={inv.notes || ''}>
                      {inv.notes || <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                  {expanded && (
                    payments.length === 0 ? (
                      <tr className="bg-blue-50/30 border-b border-blue-100/50">
                        <td colSpan={9} className="py-2 pl-14 text-xs text-gray-400 italic">No payments recorded yet for this invoice.</td>
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

function outstandingItemsFrom(invoices) {
  return invoices
    .filter((inv) => ['OPEN', 'PARTIAL', 'OVERDUE'].includes(inv.status))
    .map((inv) => {
      const { daysOverdue, bucket } = bucketFor(inv.dueDate);
      return {
        invoiceNo: inv.invoiceNo, dueDate: inv.dueDate, daysOverdue, bucket, notes: inv.notes,
        outstanding: Number(inv.totalAmount) - Number(inv.paidAmount),
        // `undefined` (not `[]`) when the source list didn't fetch payments at all —
        // print/export treat that as "unknown" rather than falsely claiming none were made.
        payments: inv.payments,
      };
    });
}

// ─── Full invoice history for one matched customer (search mode) ──────────
function HistoryCustomerBlock({ customer, invoices }) {
  const [expanded, setExpanded] = useState(true);

  const outstandingItems = outstandingItemsFrom(invoices);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="card">
      <div
        className="card-header cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 text-xs font-bold">
            {customer.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
          </div>
          <h3 className="font-semibold text-gray-900">{customer.name}</h3>
          <span className="badge-gray text-xs">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
          {outstandingTotal > 0 && (
            <span className="badge bg-red-100 text-red-600 text-xs">{formatCurrency(outstandingTotal)} outstanding</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            label={customer.name}
            disabled={outstandingItems.length === 0}
            onPrint={() => printCustomerStatement(customer.name, outstandingItems)}
            onExcel={() => exportCustomerStatement(customer.name, outstandingItems)}
          />
          {expanded
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && <HistoryTable invoices={invoices} />}
    </div>
  );
}

// ─── Slide-out drawer: one customer's full transaction history ────────────
function CustomerHistoryDrawer({ customerName, invoices, loading, onClose }) {
  const outstandingItems = outstandingItemsFrom(invoices);
  const outstandingTotal = outstandingItems.reduce((s, i) => s + i.outstanding, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-6xl bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-green-600 to-emerald-600 text-white flex-shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <History className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{customerName}</h3>
                <p className="text-green-200 text-sm">Full transaction history</p>
              </div>
            </div>
            <div className="flex-1 flex items-center justify-center gap-3">
              <button
                onClick={() => printCustomerStatement(customerName, outstandingItems)}
                disabled={outstandingItems.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Printer className="w-4 h-4" /> Print
              </button>
              <button
                onClick={() => exportCustomerStatement(customerName, outstandingItems)}
                disabled={outstandingItems.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 border border-white/20 text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" /> Download SOA
              </button>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors flex-shrink-0">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-2 flex-wrap items-center">
            <span className="badge bg-white/10 text-green-100 text-xs">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</span>
            {outstandingTotal > 0 && (
              <span className="badge bg-white/10 text-green-100 text-xs">{formatCurrency(outstandingTotal)} outstanding</span>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-3" />
              Loading history...
            </div>
          ) : (
            <HistoryTable invoices={invoices} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main AR Aging Page ───────────────────────────────────────
export default function ARAgingPage() {
  const searchParams = useSearchParams();
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState(searchParams.get('search') || '');
  const [bucketFilter, setBucketFilter] = useState('');
  const [dateFrom, setDateFrom]   = useState('');
  const [dateTo, setDateTo]       = useState('');
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'pie'
  const [lastRefresh, setLastRefresh] = useState(null);
  const [historyResults, setHistoryResults] = useState([]); // [{ customer, invoices }] — full history for search
  const [historyLoading, setHistoryLoading] = useState(false);
  const [viewCustomer, setViewCustomer] = useState(null); // { customerId, customerName } — drawer target
  const [viewInvoices, setViewInvoices] = useState([]);
  const [viewLoading, setViewLoading]   = useState(false);

  const openHistoryDrawer = async (customerId, customerName) => {
    setViewCustomer({ customerId, customerName });
    setViewLoading(true);
    try {
      const { data: invRes } = await rApi.invoices.list({ customerId, limit: 100 });
      setViewInvoices(invRes.data);
    } catch {
      toast.error('Failed to load customer history');
      setViewInvoices([]);
    } finally {
      setViewLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rApi.invoices.aging();
      setData(r.data);
      setLastRefresh(new Date());
    } catch {
      toast.error('Failed to load AR aging report');
    } finally {
      setLoading(false);
    }
  }, []);

  // Searching a client name pulls their FULL invoice history (paid, open, void — everything),
  // not just what's currently outstanding — debounced so typing doesn't fire a fetch per keystroke.
  useEffect(() => {
    const term = search.trim();
    if (!term) { setHistoryResults([]); setHistoryLoading(false); return; }

    setHistoryLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data: customers } = await rApi.customers.list({ search: term });
        const results = await Promise.all(
          customers.map(async (customer) => {
            try {
              const { data: invRes } = await rApi.invoices.list({ customerId: customer.id, limit: 100 });
              return { customer, invoices: invRes.data };
            } catch {
              return { customer, invoices: [] };
            }
          })
        );
        setHistoryResults(results);
      } catch {
        toast.error('Failed to load customer history');
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
      <div className="w-8 h-8 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
      <p>Building AR aging report...</p>
    </div>
  );

  if (!data) return null;

  // Group by customer
  const filtered = data.items.filter((i) => {
    if (search && !i.customer.toLowerCase().includes(search.toLowerCase())) return false;
    if (bucketFilter && i.bucket !== bucketFilter) return false;
    if (dateFrom && new Date(i.dueDate) < new Date(dateFrom)) return false;
    if (dateTo && new Date(i.dueDate) > new Date(dateTo)) return false;
    return true;
  });
  const hasDetailFilters = !!(bucketFilter || dateFrom || dateTo);
  const grouped = {};
  filtered.forEach((item) => {
    if (!grouped[item.customer]) grouped[item.customer] = [];
    grouped[item.customer].push(item);
  });

  // Sort customers: worst bucket first, then by outstanding desc
  const sortedCustomers = Object.entries(grouped).sort(([, a], [, b]) => {
    const aWorst = [...BUCKETS].reverse().findIndex((bucket) => a.some((i) => i.bucket === bucket));
    const bWorst = [...BUCKETS].reverse().findIndex((bucket) => b.some((i) => i.bucket === bucket));
    if (bWorst !== aWorst) return bWorst - aWorst;
    return b.reduce((s, i) => s + i.outstanding, 0) - a.reduce((s, i) => s + i.outstanding, 0);
  });

  // Chart data
  const barData = BUCKETS.map((bucket) => ({
    name:   bucket,
    amount: data.summary[bucket] || 0,
    count:  data.items.filter((i) => i.bucket === bucket).length,
  }));

  const pieData = BUCKETS.filter((b) => (data.summary[b] || 0) > 0).map((bucket) => ({
    name:    bucket,
    value:   data.summary[bucket] || 0,
    fill:    BUCKET_COLORS[bucket],
    percent: data.total > 0 ? ((data.summary[bucket] || 0) / data.total) * 100 : 0,
  }));

  const totalOutstanding  = data.total;
  const overdueTotal      = BUCKETS.slice(1).reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount      = data.items.filter((i) => i.bucket !== 'Current').length;
  const currentAmount     = data.summary['Current'] || 0;
  const collectionRisk    = totalOutstanding > 0 ? (overdueTotal / totalOutstanding) * 100 : 0;
  const uniqueCustomers   = Object.keys(grouped).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">AR Aging Report</h1>
          <p className="page-subtitle">
            As of {new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            {lastRefresh && (
              <span className="ml-2 text-gray-400">· Refreshed {lastRefresh.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Receivable</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.length} open invoice{data.items.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Not Yet Due</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(currentAmount)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.filter((i) => i.bucket === 'Current').length} invoices</p>
        </div>
        <div className="card p-5 border-l-4 border-l-red-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Overdue</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{overdueCount} overdue invoice{overdueCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-orange-400">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Collection Risk</p>
          <div className="flex items-end gap-2">
            <p className={`text-2xl font-bold ${collectionRisk < 20 ? 'text-green-600' : collectionRisk < 50 ? 'text-yellow-600' : 'text-red-600'}`}>
              {collectionRisk.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-400 mb-1">overdue</p>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${collectionRisk < 20 ? 'bg-green-500' : collectionRisk < 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, collectionRisk)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Charts + bucket summary */}
      <div className="grid xl:grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Main chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Aging Distribution</h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {[['bar', 'Bar'], ['pie', 'Pie']].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setChartType(k)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      chartType === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="badge-green text-xs">{uniqueCustomers} customer{uniqueCustomers !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="card-body pt-2">
            {chartType === 'bar' ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={barData} barSize={48} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {barData.map((entry) => (
                      <Cell key={entry.name} fill={BUCKET_COLORS[entry.name]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bucket summary panel */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Bucket Breakdown</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {BUCKETS.map((bucket) => {
              const amount = data.summary[bucket] || 0;
              const count  = data.items.filter((i) => i.bucket === bucket).length;
              const pct    = totalOutstanding > 0 ? (amount / totalOutstanding) * 100 : 0;
              return (
                <div key={bucket} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: BUCKET_COLORS[bucket] }}
                      />
                      <span className="text-sm font-medium text-gray-700">{bucket}</span>
                      {count > 0 && <span className="badge-gray text-xs">{count}</span>}
                    </div>
                    <span
                      className="text-sm font-bold"
                      style={{ color: amount > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}
                    >
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
            <div className="px-5 py-3 bg-gray-50 flex justify-between items-center">
              <span className="font-bold text-gray-700">Total Outstanding</span>
              <span className="font-bold text-green-700 text-base">{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert banners */}
      {(data.summary['Over 90 days'] || 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {formatCurrency(data.summary['Over 90 days'])} is more than 90 days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {data.items.filter((i) => i.bucket === 'Over 90 days').length} invoices · Consider engaging a collection agency or writing off as bad debt.
            </p>
          </div>
        </div>
      )}

      {totalOutstanding === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-4 text-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-green-500" />
          <div>
            <p className="font-semibold text-green-800">All receivables are fully collected!</p>
            <p className="text-xs text-green-600">No outstanding invoices at this time.</p>
          </div>
        </div>
      )}

      {/* Detail header + search */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">
            {search.trim() ? 'Search Results — Full Customer History' : 'Detail by Customer'}
          </h3>
          <div className="flex items-center gap-2">
            {!search.trim() && (
              <button
                className="btn-secondary btn-sm"
                disabled={sortedCustomers.length === 0}
                onClick={() => printAllCustomersSummary(sortedCustomers)}
                title="Print all customers, alphabetically, each with their full invoice history"
              >
                <Printer className="w-3.5 h-3.5" /> Print All
              </button>
            )}
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-64 py-1.5"
                placeholder="Search customer name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        {!search.trim() && (
          <>
            <div className="card-body py-3 border-b border-gray-100 flex flex-wrap items-center gap-3">
              <select
                className="select w-40 text-sm py-1.5"
                value={bucketFilter}
                onChange={(e) => setBucketFilter(e.target.value)}
              >
                <option value="">All Terms</option>
                {BUCKETS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Due From</label>
                <input type="date" className="input w-40 text-sm py-1.5"
                  value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Due To</label>
                <input type="date" className="input w-40 text-sm py-1.5"
                  value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              {hasDetailFilters && (
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => { setBucketFilter(''); setDateFrom(''); setDateTo(''); }}
                >
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="pl-4 min-w-52">Customer</th>
                    {BUCKETS.map((b) => (
                      <th key={b} className="text-right whitespace-nowrap">
                        <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                      </th>
                    ))}
                    <th className="text-right pr-4">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {sortedCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400">
                        {hasDetailFilters
                          ? 'No invoices match the selected terms/date range.'
                          : 'No outstanding receivables. All invoices are collected! 🎉'}
                      </td>
                    </tr>
                  ) : sortedCustomers.map(([customerName, items]) => (
                    <CustomerRow key={customerName} customerName={customerName} items={items} onView={openHistoryDrawer} />
                  ))}
                </tbody>

                {/* Totals footer */}
                {sortedCustomers.length > 0 && (
                  <tfoot>
                    <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                      <td className="py-3 pl-4 text-gray-700">TOTAL</td>
                      {BUCKETS.map((bucket) => {
                        const amt = filtered.filter((i) => i.bucket === bucket).reduce((s, i) => s + i.outstanding, 0);
                        return (
                          <td key={bucket} className="text-right py-3">
                            <span style={{ color: amt > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}>
                              {formatCurrency(amt)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-right py-3 pr-4 text-green-700">
                        {formatCurrency(filtered.reduce((s, i) => s + i.outstanding, 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
              <span>Aging calculated as of today · Only Open and Partial invoices are included</span>
              <span className="flex items-center gap-1">
                <PesoSign className="w-3.5 h-3.5" /> Amounts in Philippine Peso (₱)
              </span>
            </div>
          </>
        )}
      </div>

      {/* Full customer history — shown while searching */}
      {search.trim() && (
        <div className="space-y-3">
          {historyLoading ? (
            <div className="card p-10 flex items-center justify-center text-gray-400">
              <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-3" />
              Searching customer history...
            </div>
          ) : historyResults.length === 0 ? (
            <div className="card p-10 flex flex-col items-center justify-center text-center text-gray-400 gap-2">
              <History className="w-8 h-8 text-gray-200" />
              <p>No customers match "{search}".</p>
            </div>
          ) : (
            historyResults.map(({ customer, invoices }) => (
              <HistoryCustomerBlock key={customer.id} customer={customer} invoices={invoices} />
            ))
          )}
        </div>
      )}

      {/* Per-customer history drawer, opened via the eye icon */}
      {viewCustomer && (
        <CustomerHistoryDrawer
          customerName={viewCustomer.customerName}
          invoices={viewInvoices}
          loading={viewLoading}
          onClose={() => setViewCustomer(null)}
        />
      )}
    </div>
  );
}
