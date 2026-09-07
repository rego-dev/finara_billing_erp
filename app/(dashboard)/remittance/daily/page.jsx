'use client';
import { useState, useEffect, useCallback } from 'react';
import { remittance as remittanceApi } from '@/lib/api';
import { formatCurrency, getUser } from '@/lib/auth';
import { printDocument } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  CalendarDays, TrendingUp, TrendingDown, Wallet, RefreshCw,
  Printer, Save, CheckCircle2, ChevronRight, ChevronDown,
  ShoppingCart, Banknote, CreditCard, Package,
  AlertCircle, FileText, RotateCcw, Send,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';

const fmt = n => formatCurrency(Number(n || 0));
const today = () => new Date().toISOString().slice(0, 10);

// "Cash ₱750.00 · Bank Transfer ₱500.00", largest first — falls back to the
// caller's default text when there's nothing to break down.
const methodBreakdown = (byMethod, fallback) => {
  const entries = Object.entries(byMethod || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return fallback;
  return entries.map(([method, amt]) => `${method} ${fmt(amt)}`).join(' · ');
};

const CATEGORIES = {
  SALES:        { label: 'Sales Invoices',           icon: ShoppingCart, color: 'blue',   sign: +1 },
  COLLECTION:   { label: 'Collections',              icon: Banknote,     color: 'green',  sign: +1 },
  EXPENSE:      { label: 'Expenses / Bills',         icon: PesoReceipt,  color: 'orange', sign: -1 },
  DISBURSEMENT: { label: 'Disbursements',            icon: CreditCard,   color: 'red',    sign: -1 },
  PETTY_CASH:   { label: 'Petty Cash Disbursements', icon: Wallet,       color: 'yellow', sign:  0 },
  INVENTORY:    { label: 'Inventory Moves',          icon: Package,      color: 'purple', sign:  0 },
};

const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SUBMITTED: 'badge-yellow',
  APPROVED:  'badge-green',
};

const STATUS_COLORS = {
  DRAFT:     'text-gray-500',
  SUBMITTED: 'text-yellow-600',
  APPROVED:  'text-green-600',
};

// ─── Section card that expands/collapses ─────────────────────────
function Section({ category, items, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const cfg  = CATEGORIES[category];
  const Icon = cfg.icon;
  const total = items.reduce((s, it) => s + Number(it.amount), 0);

  const BADGE = { blue: 'badge-blue', green: 'badge-green', orange: 'badge-yellow', red: 'badge-red', purple: 'badge-purple' };

  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center bg-${cfg.color}-100`}>
            <Icon className={`w-4 h-4 text-${cfg.color}-600`} />
          </div>
          <span className="font-semibold text-gray-900">{cfg.label}</span>
          <span className={`badge ${BADGE[cfg.color]}`}>{items.length}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className={`font-semibold text-sm ${cfg.sign < 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {cfg.sign < 0 ? '− ' : ''}{fmt(total)}
          </span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {items.length === 0 ? (
            <div className="px-5 py-6 text-center text-gray-400 text-sm">No {cfg.label.toLowerCase()} for this date</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Description</th>
                  {category === 'INVENTORY' && <th>Type</th>}
                  {(category === 'COLLECTION' || category === 'DISBURSEMENT') && <th>Method</th>}
                  {category === 'SALES' && <th>VAT</th>}
                  {category === 'EXPENSE' && <th>Status</th>}
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  let meta = {};
                  try { meta = JSON.parse(it.meta || '{}'); } catch {}
                  return (
                    <tr key={i}>
                      <td className="font-mono text-xs text-blue-600">{it.reference || '—'}</td>
                      <td>{it.description}</td>
                      {category === 'INVENTORY' && (
                        <td><span className={`badge ${meta.type === 'IN' || meta.type === 'RETURN_IN' ? 'badge-green' : 'badge-red'}`}>{meta.type}</span></td>
                      )}
                      {(category === 'COLLECTION' || category === 'DISBURSEMENT') && (
                        <td className="text-xs text-gray-500">{meta.method || '—'}</td>
                      )}
                      {category === 'SALES' && (
                        <td className="text-xs text-gray-500">{fmt(meta.vat)}</td>
                      )}
                      {category === 'EXPENSE' && (
                        <td><span className="badge badge-gray text-xs">{meta.status}</span></td>
                      )}
                      <td className="text-right font-medium">{fmt(it.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50">
                  <td colSpan={category === 'COLLECTION' || category === 'DISBURSEMENT' || category === 'INVENTORY' ? 3 : (category === 'SALES' || category === 'EXPENSE' ? 3 : 2)} className="px-4 py-2 text-xs font-semibold text-gray-500 text-right">Total</td>
                  <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function DailyRemittancePage() {
  const user = typeof window !== 'undefined' ? getUser() : null;

  const [date,       setDate]       = useState(today());
  const [calcData,   setCalcData]   = useState(null);   // raw from /calculate
  const [saved,      setSaved]      = useState(null);   // saved DB record
  const [loading,    setLoading]    = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [notes,      setNotes]      = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history,    setHistory]    = useState([]);
  const [histLoading,setHistLoading]= useState(false);

  // Load saved record for the chosen date
  const loadSaved = useCallback(async (d) => {
    try {
      const res = await remittanceApi.daily.list({ from: d, to: d });
      if (res.data.length > 0) {
        // Get full record with items
        const full = await remittanceApi.daily.get(res.data[0].id);
        setSaved(full.data);
        setNotes(full.data.notes || '');
        // collectionsByMethod isn't persisted — derive it from the saved items
        // so the Cash Received breakdown survives a reload, same treatment as
        // counts.pettyCash below.
        const collectionsByMethod = {};
        for (const it of full.data.items || []) {
          let meta = {};
          try { meta = JSON.parse(it.meta || '{}'); } catch {}
          const isCollection = it.category === 'COLLECTION';
          const isCashSale = it.category === 'SALES' && meta.method;
          if (!isCollection && !isCashSale) continue;
          const method = meta.method || 'Unspecified';
          collectionsByMethod[method] = (collectionsByMethod[method] || 0) + Number(it.amount);
        }
        // counts.cashOnHand isn't persisted either — derive it from saved
        // DISBURSEMENT items whose stamped accountCode is 1010, mirroring
        // counts.pettyCash below.
        let cashOnHandVoucherCount = 0;
        for (const it of full.data.items || []) {
          if (it.category !== 'DISBURSEMENT') continue;
          let meta = {};
          try { meta = JSON.parse(it.meta || '{}'); } catch {}
          if (meta.accountCode === '1010') cashOnHandVoucherCount++;
        }
        // Rebuild calcData shape from saved items
        setCalcData({
          date: d,
          totalSales:    Number(full.data.totalSales),
          vatCollected:  Number(full.data.vatCollected),
          cashReceived:  Number(full.data.cashReceived),
          collectionsByMethod,
          totalExpenses: Number(full.data.totalExpenses),
          pettyCashTotal:    Number(full.data.pettyCashTotal    || 0),
          cashOnHandIn:      Number(full.data.cashOnHandIn      || 0),
          cashOnHandOut:     Number(full.data.cashOnHandOut     || 0),
          pettyCashIn:       Number(full.data.pettyCashIn       || 0),
          pettyCashOut:      Number(full.data.pettyCashOut      || 0),
          // Read straight through — the column is nullable now, so `null`
          // survives the database round trip as `null` and a genuine 0
          // (fund had activity but nothing was spent) survives as 0.
          pettyCashGcashOut: full.data.pettyCashGcashOut,
          cashDisbursed: Number(full.data.cashDisbursed),
          netCash:       Number(full.data.netCash),
          items:         full.data.items || [],
          // counts.pettyCash isn't persisted — derive it from the saved items
          // so the voucher count on the Petty Cash card survives a reload.
          counts: {
            pettyCash: (full.data.items || []).filter(it => it.category === 'PETTY_CASH').length,
            cashOnHand: cashOnHandVoucherCount,
          },
        });
      } else {
        setSaved(null);
        setCalcData(null);
        setNotes('');
      }
    } catch { /* no saved record — fine */ }
  }, []);

  useEffect(() => { loadSaved(date); }, [date, loadSaved]);

  // Auto-generate from transactions
  const generate = async () => {
    setGenerating(true);
    try {
      const res = await remittanceApi.daily.calculate(date);
      setCalcData(res.data);
      toast.success('Generated from today\'s transactions');
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Generate failed');
    } finally { setGenerating(false); }
  };

  // Save / Update
  const save = async () => {
    if (!calcData) { toast.error('Generate first'); return; }
    setSaving(true);
    try {
      const payload = {
        date:          calcData.date,
        totalSales:    calcData.totalSales,
        vatCollected:  calcData.vatCollected,
        cashReceived:  calcData.cashReceived,
        totalExpenses: calcData.totalExpenses,
        cashDisbursed: calcData.cashDisbursed,
        netCash:       calcData.netCash,
        cashOnHandIn:      calcData.cashOnHandIn      || 0,
        cashOnHandOut:     calcData.cashOnHandOut     || 0,
        pettyCashIn:       calcData.pettyCashIn       || 0,
        pettyCashOut:      calcData.pettyCashOut      || 0,
        // Pass through as-is — calcData.pettyCashGcashOut is already either
        // null (no GCash fund activity) or a number, matching what
        // /calculate returns. Do not collapse null to 0.
        pettyCashGcashOut: calcData.pettyCashGcashOut,
        preparedBy:    user ? `${user.firstName} ${user.lastName}` : undefined,
        notes,
        items:         calcData.items,
      };
      if (saved) {
        await remittanceApi.daily.update(saved.id, payload);
        toast.success('Updated');
      } else {
        await remittanceApi.daily.create(payload);
        toast.success('Saved');
      }
      await loadSaved(date);
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  // Submit
  const submit = async () => {
    if (!saved) { toast.error('Save first'); return; }
    try {
      await remittanceApi.daily.submit(saved.id, { preparedBy: user ? `${user.firstName} ${user.lastName}` : undefined });
      toast.success('Submitted for approval');
      await loadSaved(date);
    } catch (e) { toast.error(e?.response?.data?.error || 'Error'); }
  };

  // Approve
  const approve = async () => {
    if (!saved) return;
    try {
      await remittanceApi.daily.approve(saved.id, { approvedBy: user ? `${user.firstName} ${user.lastName}` : undefined });
      toast.success('Approved');
      await loadSaved(date);
    } catch (e) { toast.error(e?.response?.data?.error || 'Error'); }
  };

  // Delete
  const deleteRecord = async () => {
    if (!saved || !confirm('Delete this daily report?')) return;
    try {
      await remittanceApi.daily.remove(saved.id);
      setSaved(null); setCalcData(null); setNotes('');
      toast.success('Deleted');
    } catch (e) { toast.error(e?.response?.data?.error || 'Error'); }
  };

  // Load history list
  const loadHistory = async () => {
    setHistLoading(true);
    try {
      const res = await remittanceApi.daily.list({});
      setHistory(res.data);
    } catch { toast.error('Could not load history'); }
    finally { setHistLoading(false); }
  };
  useEffect(() => {
    if (historyOpen) loadHistory();
  }, [historyOpen]);

  // Print
  const handlePrint = () => {
    if (!calcData) { toast.error('Generate or load a report first'); return; }
    const d = calcData;
    const grouped = {};
    for (const cat of Object.keys(CATEGORIES)) grouped[cat] = [];
    (d.items || []).forEach(it => { if (grouped[it.category]) grouped[it.category].push(it); });

    const sectionHtml = (cat, items) => {
      const cfg = CATEGORIES[cat];
      if (!items.length) return '';
      const total = items.reduce((s, i) => s + Number(i.amount), 0);
      const rows = items.map(it => `<tr><td style="padding:6px 8px;border:1px solid #e5e7eb">${it.reference || ''}</td><td style="padding:6px 8px;border:1px solid #e5e7eb">${it.description}</td><td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">${fmt(it.amount)}</td></tr>`).join('');
      return `
        <div style="margin-bottom:20px">
          <h3 style="font-size:13px;font-weight:700;color:#1f2937;margin:0 0 8px">${cfg.label}</h3>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:#f9fafb">
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left">Reference</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left">Description</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">Amount</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:#f3f4f6;font-weight:700">
              <td colspan="2" style="padding:6px 8px;border:1px solid #e5e7eb">Total</td>
              <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right">${fmt(total)}</td>
            </tr></tfoot>
          </table>
        </div>`;
    };

    const summaryRow = (label, value, highlight = false) =>
      `<tr style="${highlight ? 'background:#eff6ff;font-weight:700' : ''}">
        <td style="padding:8px 12px;border:1px solid #e5e7eb">${label}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right">${fmt(value)}</td>
      </tr>`;

    // Indented breakdown rows nested under a parent summaryRow, e.g. Cash
    // Received split by how each collection was actually paid.
    const summarySubRows = (byMethod) =>
      Object.entries(byMethod || {})
        .sort((a, b) => b[1] - a[1])
        .map(([method, amt]) => `<tr>
          <td style="padding:4px 12px 4px 28px;border:1px solid #e5e7eb;color:#6b7280;font-size:11px">— ${method}</td>
          <td style="padding:4px 12px;border:1px solid #e5e7eb;text-align:right;color:#6b7280;font-size:11px">${fmt(amt)}</td>
        </tr>`).join('');

    printDocument(
      'Daily Remittance Report',
      `Date: ${new Date(date + 'T12:00:00').toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f9fafb"><th colspan="2" style="padding:8px 12px;border:1px solid #e5e7eb;text-align:left">SUMMARY</th></tr></thead>
          <tbody>
            ${summaryRow('Total Sales Invoiced', d.totalSales)}
            ${summaryRow('VAT Collected', d.vatCollected)}
            ${summaryRow('Cash Received (Collections)', d.cashReceived)}
            ${summarySubRows(d.collectionsByMethod)}
            ${summaryRow('Total Expenses Incurred', d.totalExpenses)}
            ${summaryRow('Cash Disbursed (Payments)', d.cashDisbursed)}
            ${summaryRow('Net Cash Flow', d.netCash, true)}
            ${summaryRow('Cash on Hand — put in (1010)', d.cashOnHandIn || 0)}
            ${summaryRow('Cash on Hand — spent (1010)', d.cashOnHandOut || 0)}
            ${summaryRow('Petty Cash — put in (1011)', d.pettyCashIn || 0)}
            ${summaryRow('Petty Cash — spent (1011)', d.pettyCashOut || 0)}
            ${d.pettyCashGcashOut != null ? summaryRow('Petty Cash — spent (GCash 1012)', d.pettyCashGcashOut) : ''}
          </tbody>
        </table>
        <div style="font-size:12px;padding:12px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px">
          <div style="margin-bottom:6px"><strong>Prepared By:</strong> ${saved?.preparedBy || '_______________'}</div>
          <div style="margin-bottom:6px"><strong>Approved By:</strong> ${saved?.approvedBy || '_______________'}</div>
          <div style="margin-bottom:6px"><strong>Status:</strong> ${saved?.status || 'DRAFT'}</div>
          ${notes ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #e5e7eb"><strong>Notes:</strong> ${notes}</div>` : ''}
        </div>
      </div>
      ${Object.keys(CATEGORIES).map(cat => sectionHtml(cat, grouped[cat] || [])).join('')}
      `
    );
  };

  // Group items by category
  const grouped = {};
  for (const cat of Object.keys(CATEGORIES)) grouped[cat] = [];
  (calcData?.items || []).forEach(it => { if (grouped[it.category]) grouped[it.category].push(it); });

  const hasData   = calcData != null;
  const isApproved = saved?.status === 'APPROVED';
  const isSubmitted = saved?.status === 'SUBMITTED';
  const isDraft     = !saved || saved.status === 'DRAFT';

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="page-header items-start">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <CalendarDays className="w-6 h-6 text-blue-600" /> Daily Remittance Report
          </h1>
          <p className="page-subtitle">End-of-day summary of all sales, collections, expenses, and disbursements</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <button className="btn-secondary btn-sm" onClick={() => { setHistoryOpen(o => !o); }}>
            <FileText className="w-3.5 h-3.5" /> History
          </button>
          <button className="btn-secondary btn-sm" onClick={handlePrint} disabled={!hasData}>
            <Printer className="w-3.5 h-3.5" /> Print
          </button>
        </div>
      </div>

      {/* ── Date bar + controls ── */}
      <div className="card">
        <div className="card-body py-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="label mb-0">Date</label>
              <input type="date" className="input w-44" value={date}
                onChange={e => setDate(e.target.value)}
                max={today()} />
            </div>

            <button className="btn-secondary" onClick={generate} disabled={generating}>
              <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating…' : 'Generate from Transactions'}
            </button>

            {hasData && !isApproved && (
              <button className="btn-primary" onClick={save} disabled={saving}>
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : saved ? 'Update' : 'Save Draft'}
              </button>
            )}

            {saved && isDraft && (
              <button className="btn-secondary" onClick={submit}>
                <Send className="w-4 h-4" /> Submit
              </button>
            )}

            {saved && isSubmitted && (
              <button className="btn-success" onClick={approve}>
                <CheckCircle2 className="w-4 h-4" /> Approve
              </button>
            )}

            {saved && !isApproved && (
              <button className="btn-danger btn-sm" onClick={deleteRecord}>
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
            )}

            {/* Status pill */}
            {saved && (
              <span className={`ml-auto badge ${STATUS_BADGE[saved.status]} text-xs`}>
                {saved.status}
                {saved.preparedBy && ` · ${saved.preparedBy}`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── History panel ── */}
      {historyOpen && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-900">Previous Daily Reports</h2>
            <button className="text-gray-400 hover:text-gray-600 text-sm" onClick={() => setHistoryOpen(false)}>Close ×</button>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead><tr>
                <th>Date</th><th className="text-right">Sales</th>
                <th className="text-right">Collected</th><th className="text-right">Disbursed</th>
                <th className="text-right">Net Cash</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {histLoading ? (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">Loading…</td></tr>
                ) : history.length === 0 ? (
                  <tr><td colSpan={7} className="py-6 text-center text-gray-400">No records yet</td></tr>
                ) : history.map(h => (
                  <tr key={h.id} className="cursor-pointer hover:bg-blue-50" onClick={() => {
                    setDate(new Date(h.date).toISOString().slice(0, 10));
                    setHistoryOpen(false);
                  }}>
                    <td className="font-medium">{new Date(h.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="text-right">{fmt(h.totalSales)}</td>
                    <td className="text-right text-green-600">{fmt(h.cashReceived)}</td>
                    <td className="text-right text-red-600">{fmt(h.cashDisbursed)}</td>
                    <td className={`text-right font-semibold ${Number(h.netCash) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(h.netCash)}</td>
                    <td><span className={`badge ${STATUS_BADGE[h.status]}`}>{h.status}</span></td>
                    <td className="text-blue-500 text-xs">Load →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── No data state ── */}
      {!hasData && (
        <div className="card">
          <div className="p-16 text-center">
            <CalendarDays className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 mb-4">
              Select a date and click <strong>Generate from Transactions</strong> to pull all sales, collections, expenses, and disbursements for that day.
            </p>
            <button className="btn-primary" onClick={generate} disabled={generating}>
              <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Generating…' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      {/* ── Summary Cards ── */}
      {hasData && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3">
            {/* Sales */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShoppingCart className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-gray-500 font-medium">Total Sales</span>
              </div>
              <div className="text-xl font-bold text-gray-900">{fmt(calcData.totalSales)}</div>
              <div className="text-xs text-gray-400 mt-0.5">VAT: {fmt(calcData.vatCollected)}</div>
            </div>
            {/* Collections */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Banknote className="w-4 h-4 text-green-500" />
                <span className="text-xs text-gray-500 font-medium">Cash Received</span>
              </div>
              <div className="text-xl font-bold text-green-700">{fmt(calcData.cashReceived)}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {methodBreakdown(calcData.collectionsByMethod, 'AR Collections')}
              </div>
            </div>
            {/* Expenses */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <PesoReceipt className="w-4 h-4 text-orange-500" />
                <span className="text-xs text-gray-500 font-medium">Expenses</span>
              </div>
              <div className="text-xl font-bold text-orange-700">{fmt(calcData.totalExpenses)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Bills incurred</div>
            </div>
            {/* Disbursements */}
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <CreditCard className="w-4 h-4 text-red-500" />
                <span className="text-xs text-gray-500 font-medium">Cash Paid Out</span>
              </div>
              <div className="text-xl font-bold text-red-700">{fmt(calcData.cashDisbursed)}</div>
              <div className="text-xs text-gray-400 mt-0.5">AP payments + vouchers</div>
            </div>
            {/* Cash on Hand (1010) — put in vs. spent today */}
            <div className="card p-4 border-blue-200 bg-blue-50">
              <div className="flex items-center gap-2 mb-2">
                <Banknote className="w-4 h-4 text-blue-600" />
                <span className="text-xs text-gray-500 font-medium">Cash on Hand</span>
              </div>
              <div className="text-xl font-bold text-blue-700">
                {fmt(calcData.cashOnHandIn || 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {fmt(calcData.cashOnHandOut || 0)} Spent today · {calcData.counts?.cashOnHand ?? 0} voucher{(calcData.counts?.cashOnHand ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
            {/* Petty Cash – Cash (1011) — put in vs. spent today */}
            <div className="card p-4 border-yellow-200 bg-yellow-50">
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-yellow-600" />
                <span className="text-xs text-gray-500 font-medium">Petty Cash – Cash</span>
              </div>
              <div className="text-xl font-bold text-yellow-700">
                {fmt(calcData.pettyCashIn || 0)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                {fmt(calcData.pettyCashOut || 0)} Spent today · {calcData.counts?.pettyCash ?? 0} voucher{(calcData.counts?.pettyCash ?? 0) === 1 ? '' : 's'}
              </div>
            </div>
            {calcData.pettyCashGcashOut != null && (
              <div className="card p-4 border-blue-200 bg-blue-50">
                <div className="flex items-center gap-2 mb-2">
                  <Wallet className="w-4 h-4 text-blue-600" />
                  <span className="text-xs text-gray-500 font-medium">Petty Cash – GCash</span>
                </div>
                <div className="text-xl font-bold text-blue-700">
                  {fmt(calcData.pettyCashGcashOut)}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Spent today · Account 1012</div>
              </div>
            )}
            {/* Net Cash */}
            <div className={`card p-4 col-span-2 xl:col-span-2 ${Number(calcData.netCash) >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-2 mb-2">
                {Number(calcData.netCash) >= 0
                  ? <TrendingUp className="w-4 h-4 text-green-600" />
                  : <TrendingDown className="w-4 h-4 text-red-600" />}
                <span className="text-xs font-medium text-gray-600">Net Cash Flow</span>
              </div>
              <div className={`text-2xl font-bold ${Number(calcData.netCash) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {fmt(calcData.netCash)}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Collections − Disbursements (excl. petty cash)</div>
            </div>
          </div>

          {/* ── Detail Sections ── */}
          {Object.entries(CATEGORIES).map(([cat]) => (
            <Section key={cat} category={cat} items={grouped[cat] || []} />
          ))}

          {/* ── Notes ── */}
          {!isApproved && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold text-gray-900">Notes / Remarks</h2>
              </div>
              <div className="card-body pt-3">
                <textarea
                  className="input h-24 resize-none"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Add any notes, remarks, or discrepancies observed for this day…"
                />
              </div>
            </div>
          )}

          {/* ── Approval trail ── */}
          {saved && (saved.preparedBy || saved.approvedBy) && (
            <div className="card">
              <div className="card-body">
                <div className="flex gap-8 text-sm">
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Prepared By</div>
                    <div className="font-medium text-gray-900">{saved.preparedBy || '—'}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-400 mb-1">Approved By</div>
                    <div className="font-medium text-gray-900">{saved.approvedBy || '—'}</div>
                  </div>
                  {saved.notes && (
                    <div className="flex-1">
                      <div className="text-xs text-gray-400 mb-1">Notes</div>
                      <div className="text-gray-700">{saved.notes}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
