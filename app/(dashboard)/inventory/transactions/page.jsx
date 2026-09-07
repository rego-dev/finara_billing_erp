'use client';
import { useState, useEffect, useCallback } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  ArrowUpCircle, ArrowDownCircle, SlidersHorizontal,
  Plus, Search, RefreshCw, Printer, X, Package,
  TrendingUp, TrendingDown, RotateCcw,
} from 'lucide-react';

const today = new Date().toISOString().split('T')[0];

const TXN_TYPES = [
  { value: 'IN',         label: 'Stock In',       icon: ArrowUpCircle,    color: 'text-green-600',  bg: 'bg-green-50',  badge: 'badge-green' },
  { value: 'OUT',        label: 'Stock Out',       icon: ArrowDownCircle,  color: 'text-red-600',    bg: 'bg-red-50',    badge: 'badge-red'   },
  { value: 'ADJUSTMENT', label: 'Adjustment',      icon: SlidersHorizontal,color: 'text-blue-600',   bg: 'bg-blue-50',   badge: 'badge-blue'  },
  { value: 'RETURN_IN',  label: 'Customer Return', icon: RotateCcw,        color: 'text-purple-600', bg: 'bg-purple-50', badge: 'badge-gray'  },
  { value: 'RETURN_OUT', label: 'Return to Supplier', icon: RotateCcw,    color: 'text-orange-600', bg: 'bg-orange-50', badge: 'badge-yellow'},
];
const TXN_MAP = Object.fromEntries(TXN_TYPES.map((t) => [t.value, t]));

const BLANK_TXN = {
  itemId: '', type: 'IN', quantity: '', unitCost: '',
  reference: '', notes: '', txnDate: today,
};

// ── New Transaction Modal ─────────────────────────────────────────────────────
function TxnModal({ items, onClose, onSaved }) {
  const [form, setForm] = useState(BLANK_TXN);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selectedItem = items.find((i) => i.id === Number(form.itemId));
  const isAdjustment = form.type === 'ADJUSTMENT';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.transactions.create({
        ...form,
        quantity: Number(form.quantity),
        unitCost: Number(form.unitCost) || 0,
      });
      toast.success('Transaction recorded');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-lg shadow-2xl flex flex-col" style={{borderRadius:'0 0 1rem 1rem',maxHeight:'88vh',animation:'topDrawerIn .28s cubic-bezier(.4,0,.2,1)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">Record Stock Movement</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Type selector */}
          <div>
            <label className="label">Transaction Type <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
              {TXN_TYPES.map((t) => (
                <button
                  key={t.value} type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                  className={`flex flex-col items-center gap-1 p-2.5 border-2 rounded-lg text-xs font-medium transition-all ${
                    form.type === t.value
                      ? `border-blue-500 ${t.bg} ${t.color}`
                      : 'border-gray-100 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Item */}
          <div>
            <label className="label">Item <span className="text-red-500">*</span></label>
            <select className="input w-full" value={form.itemId} onChange={set('itemId')} required>
              <option value="">— Select Item —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
            {selectedItem && (
              <p className="text-xs text-gray-500 mt-1">
                Current stock: <strong className="text-gray-800">{Number(selectedItem.currentStock).toLocaleString('en-PH')} {selectedItem.unit}</strong>
                {' · '}Cost: {phpFmt(selectedItem.costPrice)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">
                {isAdjustment ? 'New Stock Count' : 'Quantity'} <span className="text-red-500">*</span>
              </label>
              <input className="input w-full" type="number" min="0" step="0.001"
                value={form.quantity} onChange={set('quantity')} required placeholder="0" />
              {isAdjustment && selectedItem && (
                <p className="text-xs text-gray-500 mt-1">Enter the actual count; difference will be computed</p>
              )}
            </div>
            <div>
              <label className="label">Unit Cost</label>
              <input className="input w-full" type="number" min="0" step="0.01"
                value={form.unitCost} onChange={set('unitCost')} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Date</label>
              <input className="input w-full" type="date" value={form.txnDate} onChange={set('txnDate')} />
            </div>
            <div>
              <label className="label">Reference</label>
              <input className="input w-full" value={form.reference} onChange={set('reference')} placeholder="PO#, INV#, etc." />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full" rows={2} value={form.notes} onChange={set('notes')} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Record Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const [txns,   setTxns]   = useState([]);
  const [items,  setItems]  = useState([]);
  const [total,  setTotal]  = useState(0);
  const [modal,  setModal]  = useState(false);
  const [loading,setLoading]= useState(true);
  const [filter, setFilter] = useState({ search: '', type: '', itemId: '', from: '', to: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.type)   params.type   = filter.type;
      if (filter.itemId) params.itemId = filter.itemId;
      if (filter.from)   params.from   = filter.from;
      if (filter.to)     params.to     = filter.to;
      if (filter.search) params.search = filter.search;
      const [txnRes, itemRes] = await Promise.all([
        inventoryApi.transactions.list(params),
        inventoryApi.items.list({ isActive: 'true' }),
      ]);
      setTxns(txnRes.data.data);
      setTotal(txnRes.data.total);
      setItems(itemRes.data);
    } catch { toast.error('Failed to load transactions'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handlePrint = async () => {
    const rows = txns.map((t) => {
      const meta = TXN_MAP[t.type];
      return `<tr>
        <td class="mono">${t.txnNo}</td>
        <td>${dateFmt(t.txnDate)}</td>
        <td><span class="badge ${meta?.badge || 'b-gray'}">${meta?.label || t.type}</span></td>
        <td class="mono">${t.item?.sku}</td>
        <td>${t.item?.name}</td>
        <td class="right">${Number(t.quantity).toLocaleString('en-PH')} ${t.item?.unit || ''}</td>
        <td class="right">${phpFmt(t.unitCost)}</td>
        <td class="right bold">${phpFmt(t.totalCost)}</td>
        <td class="right">${Number(t.runningStock).toLocaleString('en-PH')}</td>
        <td>${t.reference || '—'}</td>
      </tr>`;
    }).join('');

    const body = `
      <table>
        <thead><tr>
          <th>Txn No</th><th>Date</th><th>Type</th><th>SKU</th><th>Item</th>
          <th class="right">Qty</th><th class="right">Unit Cost</th><th class="right">Total Cost</th>
          <th class="right">Running Stock</th><th>Reference</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    await printDocument('Stock Movement Log', `${txns.length} transactions`, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock Movements</h1>
          <p className="page-subtitle">All inventory transactions · {total} records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={() => setModal(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Movement
          </button>
        </div>
      </div>

      {/* Type Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {TXN_TYPES.map((t) => {
          const count = txns.filter((x) => x.type === t.value).length;
          return (
            <button key={t.value}
              onClick={() => setFilter((f) => ({ ...f, type: f.type === t.value ? '' : t.value }))}
              className={`card card-body text-left transition-all hover:shadow-md ${filter.type === t.value ? 'ring-2 ring-blue-500' : ''}`}>
              <div className="flex items-center gap-2">
                <t.icon className={`w-4 h-4 ${t.color}`} />
                <span className="text-xs font-semibold text-gray-700">{t.label}</span>
              </div>
              <p className={`text-xl font-bold mt-1 ${t.color}`}>{count}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Search txn#, reference…"
                value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
            </div>
            <select className="input w-44" value={filter.itemId}
              onChange={(e) => setFilter((f) => ({ ...f, itemId: e.target.value }))}>
              <option value="">All Items</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
            <select className="input w-44" value={filter.type}
              onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}>
              <option value="">All Types</option>
              {TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="input w-36" type="date" value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
            <input className="input w-36" type="date" value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
            <button onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Txn No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Unit Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Running Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">No transactions found</td></tr>
              ) : txns.map((t) => {
                const meta = TXN_MAP[t.type];
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.txnNo}</td>
                    <td className="px-4 py-3 text-gray-700">{dateFmt(t.txnDate)}</td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${meta?.bg} ${meta?.color}`}>
                        {meta && <meta.icon className="w-3.5 h-3.5" />}
                        {meta?.label || t.type}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.item?.sku}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{t.item?.name}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${['IN','RETURN_IN'].includes(t.type) ? 'text-green-700' : ['OUT','RETURN_OUT'].includes(t.type) ? 'text-red-700' : 'text-blue-700'}`}>
                      {['IN','RETURN_IN'].includes(t.type) ? '+' : ['OUT','RETURN_OUT'].includes(t.type) ? '-' : '~'}
                      {Number(t.quantity).toLocaleString('en-PH')} {t.item?.unit}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{phpFmt(t.unitCost)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{phpFmt(t.totalCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{Number(t.runningStock).toLocaleString('en-PH')}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {t.reference && <span className="font-medium text-gray-700">{t.reference}</span>}
                      {t.notes && <div className="text-gray-400 mt-0.5">{t.notes}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <TxnModal
          items={items}
          onClose={() => setModal(false)}
          onSaved={() => { setModal(false); load(); }}
        />
      )}
    </div>
  );
}
