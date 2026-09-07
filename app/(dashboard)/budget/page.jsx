'use client';
import { useState, useEffect, useCallback } from 'react';
import { budget as budgetApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, BarChart3, Trash2, Eye } from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';

function BudgetModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', fiscalYear: new Date().getFullYear(), notes: '', lines: [{ accountId: '', annualAmount: 0 }] });
  const [saving, setSaving] = useState(false);
  const setLine = (i, f, v) => setForm((p) => ({ ...p, lines: p.lines.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, { accountId: '', annualAmount: 0 }] }));
  const rmLine = (i) => setForm((p) => ({ ...p, lines: p.lines.filter((_, idx) => idx !== i) }));
  const submit = async (e) => {
    e.preventDefault();
    const lines = form.lines.filter((l) => l.accountId);
    if (!lines.length) return toast.error('Add at least one account line');
    setSaving(true);
    try { await budgetApi.create({ ...form, lines }); toast.success('Budget created'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Save failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header"><h3 className="text-lg font-semibold">New Budget</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group"><label className="label">Budget Name *</label><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Operating Budget" /></div>
              <div className="form-group"><label className="label">Fiscal Year *</label><input type="number" className="input" required value={form.fiscalYear} onChange={(e) => setForm((f) => ({ ...f, fiscalYear: e.target.value }))} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><label className="label mb-0">Account Allocations</label><button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add</button></div>
              <table className="table text-sm">
                <thead><tr><th>Account</th><th className="w-40 text-right">Annual Amount</th><th className="w-8"></th></tr></thead>
                <tbody>
                  {form.lines.map((l, i) => (
                    <tr key={i}>
                      <td><AccountSelect
                        value={l.accountId}
                        onChange={(val) => setLine(i, 'accountId', val)}
                        accounts={accounts}
                        placeholder="-- Select Account --"
                      /></td>
                      <td><input type="number" min="0" step="0.01" className="input w-full text-right" value={l.annualAmount} onChange={(e) => setLine(i, 'annualAmount', e.target.value)} /></td>
                      <td>{form.lines.length > 1 && <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Create Budget'}</button></div>
        </form>
      </div>
    </div>
  );
}

function VsActualModal({ budget, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { budgetApi.vsActual(budget.id).then((r) => setData(r.data)); }, [budget.id]);
  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        <div className="modal-header"><div><h3 className="text-lg font-semibold">{budget.name}</h3><p className="text-xs text-gray-400">Budget vs Actual — FY{budget.fiscalYear}</p></div><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
        <div className="modal-body">
          {!data ? <p className="text-gray-400">Loading…</p> : (
            <div className="max-h-96 overflow-y-auto">
              <table className="table text-sm">
                <thead><tr><th>Account</th><th className="text-right">Budgeted</th><th className="text-right">Actual</th><th className="text-right">Variance</th><th className="text-right">Used</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.accountId}>
                      <td><span className="font-mono text-xs text-gray-400">{r.accountCode}</span> {r.accountName}</td>
                      <td className="text-right font-mono">{formatCurrency(r.budgeted)}</td>
                      <td className="text-right font-mono">{formatCurrency(r.actual)}</td>
                      <td className={`text-right font-mono ${r.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(r.variance)}</td>
                      <td className="text-right">{r.utilization != null ? `${r.utilization}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold bg-gray-50">
                    <td>TOTAL</td>
                    <td className="text-right font-mono">{formatCurrency(data.totals.budgeted)}</td>
                    <td className="text-right font-mono">{formatCurrency(data.totals.actual)}</td>
                    <td className={`text-right font-mono ${data.totals.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(data.totals.variance)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer"><button onClick={onClose} className="btn-secondary">Close</button></div>
      </div>
    </div>
  );
}

export default function BudgetPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);
  const [report, setReport] = useState(null);

  const load = useCallback(() => { setLoading(true); budgetApi.list().then((r) => setRows(r.data)).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)); }, []);

  const del = async (b) => { if (!confirm(`Delete budget "${b.name}"?`)) return; try { await budgetApi.remove(b.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><BarChart3 className="w-6 h-6 text-blue-700" /> Budgeting</h1><p className="page-subtitle">Plan & track spending vs actuals</p></div>
        <button className="btn-primary" onClick={() => setModal(true)}><Plus className="w-4 h-4" /> New Budget</button>
      </div>

      <div className="card"><div className="table-wrapper">
        <table className="table">
          <thead><tr><th>Name</th><th>Fiscal Year</th><th>Accounts</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={5} className="text-center py-8 text-gray-400">No budgets yet.</td></tr>
              : rows.map((b) => (
                <tr key={b.id}>
                  <td className="font-medium">{b.name}</td>
                  <td>{b.fiscalYear}</td>
                  <td>{b._count?.lines ?? 0}</td>
                  <td><span className={b.status === 'ACTIVE' ? 'badge-green' : 'badge-gray'}>{b.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => setReport(b)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Budget vs Actual"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => del(b)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div></div>

      {modal && <BudgetModal accounts={accounts} onClose={() => setModal(false)} onSaved={() => { setModal(false); load(); }} />}
      {report && <VsActualModal budget={report} onClose={() => setReport(null)} />}
    </div>
  );
}
