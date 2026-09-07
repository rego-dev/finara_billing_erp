'use client';
import { useState, useCallback } from 'react';
import { receivable as rApi, cashSales as csApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { ReceiptText, RefreshCw, Printer } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const SOURCE_BADGE = { Invoice: 'badge-blue', 'Cash Sale': 'badge-green' };

export default function SalesReportPage() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const [invRes, csRes] = await Promise.all([
        rApi.invoices.list({ from, to, limit: 1000 }),
        csApi.list({ from, to, limit: 1000 }),
      ]);

      const invoiceRows = (invRes.data.data || []).map((inv) => ({
        source: 'Invoice',
        docNo: inv.invoiceNo,
        date: inv.invoiceDate,
        party: inv.customer?.name || '—',
        description: inv.description || '—',
        subtotal: Number(inv.subtotal),
        vatAmount: Number(inv.vatAmount),
        totalAmount: Number(inv.totalAmount),
        status: inv.status,
        void: inv.status === 'VOID',
      }));

      const cashSaleRows = (csRes.data.data || []).map((cs) => ({
        source: 'Cash Sale',
        docNo: cs.saleNo,
        date: cs.saleDate,
        party: cs.buyerName || 'Walk-in',
        description: cs.description || '—',
        subtotal: Number(cs.subtotal),
        vatAmount: Number(cs.vatAmount),
        totalAmount: Number(cs.totalAmount),
        status: cs.status,
        void: cs.status === 'VOID',
      }));

      const merged = [...invoiceRows, ...cashSaleRows].sort((a, b) => {
        const d = new Date(a.date) - new Date(b.date);
        return d !== 0 ? d : a.docNo.localeCompare(b.docNo);
      });

      setRows(merged);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not generate the report');
    } finally { setBusy(false); }
  }, [from, to]);

  const totals = (rows || []).filter((r) => !r.void).reduce((t, r) => ({
    subtotal: t.subtotal + r.subtotal,
    vatAmount: t.vatAmount + r.vatAmount,
    totalAmount: t.totalAmount + r.totalAmount,
  }), { subtotal: 0, vatAmount: 0, totalAmount: 0 });

  const print = () => {
    if (!rows) return;
    const body = `
      <table>
        <thead>
          <tr>
            <th>Date</th><th>Source</th><th>Doc #</th><th>Customer / Buyer</th><th>Description</th>
            <th class="right">Subtotal</th><th class="right">VAT</th><th class="right">Total</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td>${dateFmt(r.date)}</td>
              <td>${r.source}</td>
              <td class="mono">${r.docNo}</td>
              <td>${r.party}</td>
              <td>${r.description}</td>
              <td class="right">${phpFmt(r.subtotal)}</td>
              <td class="right">${phpFmt(r.vatAmount)}</td>
              <td class="right bold">${phpFmt(r.totalAmount)}</td>
              <td>${badge(r.status)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="5">Total (excludes voided)</td>
            <td class="right">${phpFmt(totals.subtotal)}</td>
            <td class="right">${phpFmt(totals.vatAmount)}</td>
            <td class="right">${phpFmt(totals.totalAmount)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>`;
    printDocument('Sales Report', `${dateFmt(from)} — ${dateFmt(to)}`, body);
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Report</h1>
          <p className="page-subtitle">Invoices and Cash Sales combined, by date range</p>
        </div>
        {rows && (
          <button className="btn-secondary" onClick={print}>
            <Printer className="w-4 h-4" /> Print
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div className="form-group">
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {!rows && (
        <div className="card">
          <div className="p-16 text-center">
            <ReceiptText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Pick a date range and click <strong>Generate</strong>.</p>
          </div>
        </div>
      )}

      {rows && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-5 border-l-4 border-l-gray-400">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Records</p>
            <p className="text-2xl font-bold text-gray-900">{rows.length}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-blue-500">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">VAT</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totals.vatAmount)}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-green-500">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Sales</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(totals.totalAmount)}</p>
          </div>
        </div>
      )}

      {rows && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="pl-4">Date</th>
                  <th>Source</th>
                  <th>Doc #</th>
                  <th>Customer / Buyer</th>
                  <th>Description</th>
                  <th className="text-right">Subtotal</th>
                  <th className="text-right">VAT</th>
                  <th className="text-right">Total</th>
                  <th className="pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">No sales found in this date range.</td></tr>
                ) : rows.map((r) => (
                  <tr key={`${r.source}-${r.docNo}`} className={`border-b border-gray-100 ${r.void ? 'opacity-50' : ''}`}>
                    <td className="pl-4 py-2 text-sm text-gray-600">{dateFmt(r.date)}</td>
                    <td className="py-2">
                      <span className={`badge text-xs ${SOURCE_BADGE[r.source]}`}>{r.source}</span>
                    </td>
                    <td className="py-2 font-mono text-sm text-gray-700">{r.docNo}</td>
                    <td className="py-2 text-sm">{r.party}</td>
                    <td className="py-2 text-sm text-gray-600">{r.description}</td>
                    <td className="text-right py-2 text-sm">{formatCurrency(r.subtotal)}</td>
                    <td className="text-right py-2 text-sm">{formatCurrency(r.vatAmount)}</td>
                    <td className="text-right py-2 text-sm font-semibold">{formatCurrency(r.totalAmount)}</td>
                    <td className="py-2 pr-4">
                      <span className={`badge text-xs ${r.status === 'VOID' ? 'badge-gray' : r.status === 'PAID' || r.status === 'ACTIVE' ? 'badge-green' : 'badge-yellow'}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
