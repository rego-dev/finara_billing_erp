'use client';
import { useState, useEffect, useCallback } from 'react';
import { assets as assetApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, TrendingDown, CalendarRange, Archive, Building2 } from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';

const STATUS_BADGE = { ACTIVE: 'badge-green', FULLY_DEPRECIATED: 'badge-blue', DISPOSED: 'badge-gray' };

function AssetModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', category: '', acquisitionDate: new Date().toISOString().split('T')[0],
    cost: '', salvageValue: 0, usefulLifeMonths: 60, method: 'STRAIGHT_LINE', decliningRate: '',
    assetAccountId: '', depreciationExpenseAccountId: '', accumulatedDepreciationAccountId: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await assetApi.create(form); toast.success('Asset created'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Save failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header"><h3 className="text-lg font-semibold">New Fixed Asset</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group"><label className="label">Asset Name *</label><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Category</label><input className="input" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Equipment" /></div>
              <div className="form-group"><label className="label">Acquisition Date *</label><input type="date" className="input" required value={form.acquisitionDate} onChange={(e) => setForm((f) => ({ ...f, acquisitionDate: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Cost *</label><input type="number" min="0" step="0.01" className="input" required value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Salvage Value</label><input type="number" min="0" step="0.01" className="input" value={form.salvageValue} onChange={(e) => setForm((f) => ({ ...f, salvageValue: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Useful Life (months) *</label><input type="number" min="1" className="input" required value={form.usefulLifeMonths} onChange={(e) => setForm((f) => ({ ...f, usefulLifeMonths: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Method</label>
                <select className="select" value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  <option value="STRAIGHT_LINE">Straight Line</option>
                  <option value="DECLINING_BALANCE">Declining Balance</option>
                </select>
              </div>
              {form.method === 'DECLINING_BALANCE' && (
                <div className="form-group"><label className="label">Annual Rate (%)</label><input type="number" min="0" step="0.01" className="input" value={form.decliningRate} onChange={(e) => setForm((f) => ({ ...f, decliningRate: e.target.value }))} /></div>
              )}
            </div>
            <div className="border-t pt-3">
              <p className="text-xs text-gray-500 mb-2">GL accounts (optional — enables auto-posting of depreciation)</p>
              <div className="form-grid">
                <div className="form-group"><label className="label">Asset Account</label><AcctSelect accounts={accounts} value={form.assetAccountId} onChange={(v) => setForm((f) => ({ ...f, assetAccountId: v }))} /></div>
                <div className="form-group"><label className="label">Depreciation Expense</label><AcctSelect accounts={accounts} value={form.depreciationExpenseAccountId} onChange={(v) => setForm((f) => ({ ...f, depreciationExpenseAccountId: v }))} /></div>
                <div className="form-group"><label className="label">Accumulated Depreciation</label><AcctSelect accounts={accounts} value={form.accumulatedDepreciationAccountId} onChange={(v) => setForm((f) => ({ ...f, accumulatedDepreciationAccountId: v }))} /></div>
              </div>
            </div>
          </div>
          <div className="modal-footer"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Create Asset'}</button></div>
        </form>
      </div>
    </div>
  );
}

const AcctSelect = ({ accounts, value, onChange }) => (
  <AccountSelect accounts={accounts} value={value || ''} onChange={onChange} placeholder="-- none --" />
);

function ScheduleModal({ asset, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { assetApi.schedule(asset.id).then((r) => setData(r.data)); }, [asset.id]);
  useEffect(() => { load(); }, [load]);

  const depreciate = async () => {
    setBusy(true);
    try { const { data: r } = await assetApi.runDepreciation(asset.id, {}); toast.success(`Recorded depreciation ${formatCurrency(r.entry.amount)}`); load(); onChanged(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header">
          <div><h3 className="text-lg font-semibold">{asset.assetCode} — {asset.name}</h3><p className="text-xs text-gray-400">Depreciation schedule</p></div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body">
          {!data ? <p className="text-gray-400">Loading…</p> : (
            <>
              <div className="flex gap-4 mb-3 text-sm">
                <div>Cost: <strong>{formatCurrency(asset.cost)}</strong></div>
                <div>Accumulated: <strong>{formatCurrency(asset.accumulatedDepreciation)}</strong></div>
                <div>Book Value: <strong>{formatCurrency(asset.bookValue)}</strong></div>
              </div>
              <div className="max-h-80 overflow-y-auto border rounded-lg">
                <table className="table text-sm">
                  <thead><tr><th>#</th><th>Period</th><th className="text-right">Depreciation</th><th className="text-right">Accumulated</th><th className="text-right">Book Value</th><th>Posted</th></tr></thead>
                  <tbody>
                    {data.schedule.map((r) => (
                      <tr key={r.period} className={r.posted ? 'bg-green-50' : ''}>
                        <td>{r.period}</td>
                        <td>{formatDate(r.periodDate)}</td>
                        <td className="text-right font-mono">{formatCurrency(r.depreciation)}</td>
                        <td className="text-right font-mono">{formatCurrency(r.accumulated)}</td>
                        <td className="text-right font-mono">{formatCurrency(r.bookValue)}</td>
                        <td>{r.posted ? <span className="badge-green">✓</span> : <span className="text-gray-300">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Close</button>
          {asset.status === 'ACTIVE' && <button onClick={depreciate} disabled={busy} className="btn-primary"><TrendingDown className="w-4 h-4" /> {busy ? 'Posting…' : 'Record Next Period'}</button>}
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value }) => (
  <div className="card"><div className="card-body py-4"><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900 mt-1">{value}</p></div></div>
);

export default function AssetsPage() {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);
  const [scheduleAsset, setScheduleAsset] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([assetApi.list(), assetApi.summary()]).then(([a, s]) => { setRows(a.data); setSummary(s.data); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)); }, []);

  const dispose = async (a) => {
    const amt = prompt(`Dispose ${a.assetCode}. Disposal amount (₱)?`, '0');
    if (amt === null) return;
    try { await assetApi.dispose(a.id, { disposalAmount: Number(amt), disposalDate: new Date().toISOString().split('T')[0] }); toast.success('Asset disposed'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><Building2 className="w-6 h-6 text-blue-700" /> Fixed Assets</h1><p className="page-subtitle">Asset register & depreciation</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus className="w-4 h-4" /> New Asset</button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <Stat label="Total Assets" value={summary.count} />
          <Stat label="Total Cost" value={formatCurrency(summary.totalCost)} />
          <Stat label="Accumulated Dep." value={formatCurrency(summary.totalAccumulated)} />
          <Stat label="Net Book Value" value={formatCurrency(summary.totalBookValue)} />
        </div>
      )}

      <div className="card"><div className="table-wrapper">
        <table className="table">
          <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Acquired</th><th className="text-right">Cost</th><th className="text-right">Book Value</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No assets registered.</td></tr>
              : rows.map((a) => (
                <tr key={a.id}>
                  <td className="font-mono text-blue-700">{a.assetCode}</td>
                  <td>{a.name}</td>
                  <td className="text-gray-500">{a.category || '—'}</td>
                  <td>{formatDate(a.acquisitionDate)}</td>
                  <td className="text-right">{formatCurrency(a.cost)}</td>
                  <td className="text-right font-medium">{formatCurrency(a.bookValue)}</td>
                  <td><span className={STATUS_BADGE[a.status]}>{a.status.replace('_', ' ')}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => setScheduleAsset(a)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Schedule"><CalendarRange className="w-4 h-4" /></button>
                      {a.status !== 'DISPOSED' && <button onClick={() => dispose(a)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Dispose"><Archive className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div></div>

      {modal && <AssetModal accounts={accounts} onClose={() => setModal(false)} onSaved={() => { setModal(false); load(); }} />}
      {scheduleAsset && <ScheduleModal asset={scheduleAsset} onClose={() => setScheduleAsset(null)} onChanged={load} />}
    </div>
  );
}
