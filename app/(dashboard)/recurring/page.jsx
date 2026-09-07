'use client';
import { useState, useEffect, useCallback } from 'react';
import { recurring as recApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, Play, RefreshCw, Power, Trash2, Repeat } from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput, { groupThousands } from '@/components/NumberInput';

const emptyLine = () => ({ accountId: '', debit: '', credit: '', description: '' });

function RecurringModal({ accounts, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: '', frequency: 'MONTHLY', startDate: new Date().toISOString().split('T')[0],
    endDate: '', description: '', notes: '', reference: '', payload: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);
  const totalDr = form.payload.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = form.payload.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;
  const setLine = (i, f, v) => setForm((p) => ({ ...p, payload: p.payload.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm((p) => ({ ...p, payload: [...p.payload, emptyLine()] }));
  const rmLine = (i) => setForm((p) => ({ ...p, payload: p.payload.filter((_, idx) => idx !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    if (!balanced) return toast.error('Lines must balance');
    const payload = form.payload.filter((l) => l.accountId).map((l) => ({ accountId: Number(l.accountId), debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description }));
    setSaving(true);
    try { await recApi.create({ ...form, payload }); toast.success('Recurring template created'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Save failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header"><h3 className="text-lg font-semibold">New Recurring Entry</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group"><label className="label">Name *</label><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Monthly Rent" /></div>
              <div className="form-group"><label className="label">Frequency</label>
                <select className="select" value={form.frequency} onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}>
                  {['WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'].map((x) => <option key={x}>{x}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">Start Date *</label><input type="date" className="input" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="form-group"><label className="label">End Date</label><input type="date" className="input" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Description</label><input className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
              <div className="form-group"><label className="label">Reference</label><input className="input" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2"><label className="label mb-0">Journal Template</label><button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Line</button></div>
              <table className="table table-compact text-sm">
                <thead><tr><th>Account</th><th className="w-36 text-right">Debit</th><th className="w-36 text-right">Credit</th><th>Memo</th><th className="w-8"></th></tr></thead>
                <tbody>
                  {form.payload.map((l, i) => (
                    <tr key={i}>
                      <td><AccountSelect
                        value={l.accountId}
                        onChange={(val) => setLine(i, 'accountId', val)}
                        accounts={accounts}
                        placeholder="-- Account --"
                      /></td>
                      <td><NumberInput className="input w-full text-right" value={l.debit} onChange={(v) => setLine(i, 'debit', v)} placeholder="0.00" /></td>
                      <td><NumberInput className="input w-full text-right" value={l.credit} onChange={(v) => setLine(i, 'credit', v)} placeholder="0.00" /></td>
                      <td><input className="input w-full text-xs" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                      <td>{form.payload.length > 2 && <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-semibold text-sm">
                    <td className="text-right text-gray-500">Totals</td>
                    <td className="text-right font-mono">{groupThousands(totalDr.toFixed(2))}</td>
                    <td className="text-right font-mono">{groupThousands(totalCr.toFixed(2))}</td>
                    <td colSpan={2}>{balanced ? <span className="text-green-600 text-xs">✓ Balanced</span> : <span className="text-red-500 text-xs">✗ Off by {Math.abs(totalDr - totalCr).toFixed(2)}</span>}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Purpose of this recurring entry…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !balanced} className="btn-primary">{saving ? 'Saving…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RecurringPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(false);

  const load = useCallback(() => { setLoading(true); recApi.list().then((r) => setRows(r.data)).finally(() => setLoading(false)); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)); }, []);

  const runNow = async (t) => { try { const { data } = await recApi.runNow(t.id); toast.success(data.message); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const runDue = async () => { try { const { data } = await recApi.runDue(); toast.success(`Ran ${data.ran} due template(s)`); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const toggle = async (t) => { try { await recApi.toggle(t.id); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const del = async (t) => { if (!confirm(`Delete "${t.name}"?`)) return; try { await recApi.remove(t.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><Repeat className="w-6 h-6 text-blue-700" /> Recurring Entries</h1><p className="page-subtitle">Automated journal entries on a schedule</p></div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={runDue}><RefreshCw className="w-4 h-4" /> Run All Due</button>
          <button className="btn-primary" onClick={() => setModal(true)}><Plus className="w-4 h-4" /> New Template</button>
        </div>
      </div>

      <div className="card"><div className="table-wrapper">
        <table className="table">
          <thead><tr><th>Name</th><th>Frequency</th><th>Next Run</th><th>Last Run</th><th>Active</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={6} className="text-center py-8 text-gray-400">No recurring templates yet.</td></tr>
              : rows.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}<div className="text-xs text-gray-400">{t.description}</div></td>
                  <td><span className="badge-blue">{t.frequency}</span></td>
                  <td>{formatDate(t.nextRunDate)}</td>
                  <td className="text-gray-500">{t.lastRunDate ? formatDate(t.lastRunDate) : '—'}</td>
                  <td><span className={t.isActive ? 'badge-green' : 'badge-gray'}>{t.isActive ? 'Active' : 'Paused'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => runNow(t)} className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Run now"><Play className="w-4 h-4" /></button>
                      <button onClick={() => toggle(t)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Toggle active"><Power className="w-4 h-4" /></button>
                      <button onClick={() => del(t)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div></div>

      {modal && <RecurringModal accounts={accounts} onClose={() => setModal(false)} onSaved={() => { setModal(false); load(); }} />}
    </div>
  );
}
