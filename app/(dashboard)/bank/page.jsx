'use client';
import { useState, useEffect, useCallback } from 'react';
import { bank as bankApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, Landmark, CheckCircle2, Trash2, ScrollText } from 'lucide-react';

function AccountModal({ glAccounts, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', bankName: '', accountNumber: '', glAccountId: '', currentBalance: 0 });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await bankApi.accounts.create(form); toast.success('Bank account added'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay"><div className="modal max-w-lg">
      <div className="modal-header"><h3 className="text-lg font-semibold">New Bank Account</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
      <form onSubmit={submit}><div className="modal-body space-y-3">
        <div className="form-group"><label className="label">Account Name *</label><input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Operating Account" /></div>
        <div className="form-grid">
          <div className="form-group"><label className="label">Bank</label><input className="input" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. BDO" /></div>
          <div className="form-group"><label className="label">Account Number</label><input className="input" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} /></div>
        </div>
        <div className="form-group"><label className="label">Linked GL Account</label>
          <select className="select" value={form.glAccountId} onChange={(e) => setForm((f) => ({ ...f, glAccountId: e.target.value }))}>
            <option value="">-- none --</option>
            {glAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="label">Opening Balance</label><input type="number" step="0.01" className="input" value={form.currentBalance} onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))} /></div>
      </div>
      <div className="modal-footer"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add Account'}</button></div></form>
    </div></div>
  );
}

function TxnModal({ accountId, onClose, onSaved }) {
  const [form, setForm] = useState({ txnDate: new Date().toISOString().split('T')[0], description: '', reference: '', amount: '', type: 'DEBIT' });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true);
    try { await bankApi.transactions.create({ ...form, bankAccountId: accountId }); toast.success('Transaction added'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay"><div className="modal max-w-lg">
      <div className="modal-header"><h3 className="text-lg font-semibold">New Bank Transaction</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
      <form onSubmit={submit}><div className="modal-body space-y-3">
        <div className="form-grid">
          <div className="form-group"><label className="label">Date *</label><input type="date" className="input" required value={form.txnDate} onChange={(e) => setForm((f) => ({ ...f, txnDate: e.target.value }))} /></div>
          <div className="form-group"><label className="label">Type</label>
            <select className="select" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="DEBIT">Deposit (+)</option>
              <option value="CREDIT">Withdrawal (−)</option>
            </select>
          </div>
        </div>
        <div className="form-group"><label className="label">Description *</label><input className="input" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
        <div className="form-grid">
          <div className="form-group"><label className="label">Reference</label><input className="input" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} /></div>
          <div className="form-group"><label className="label">Amount *</label><input type="number" min="0" step="0.01" className="input" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
        </div>
      </div>
      <div className="modal-footer"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add'}</button></div></form>
    </div></div>
  );
}

function ReconcileModal({ recId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const load = useCallback(() => { bankApi.reconciliations.get(recId).then((r) => setData(r.data)); }, [recId]);
  useEffect(() => { load(); }, [load]);

  const toggle = async (txnId) => { try { await bankApi.reconciliations.toggle(recId, txnId); load(); onChanged?.(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const complete = async () => {
    try { await bankApi.reconciliations.complete(recId); toast.success('Reconciliation completed'); onClose(); onChanged?.(); }
    catch (e) {
      if (e.response?.data?.error?.includes('out of balance') && confirm(`${e.response.data.error}\n\nComplete anyway?`)) {
        try { await bankApi.reconciliations.complete(recId); toast.success('Completed (forced)'); onClose(); onChanged?.(); } catch (e2) { toast.error(e2.response?.data?.error); }
      } else { toast.error(e.response?.data?.error || 'Failed'); }
    }
  };

  if (!data) return <div className="modal-overlay"><div className="modal max-w-2xl"><div className="modal-body">Loading…</div></div></div>;
  const cleared = data.transactions.filter((t) => t.isReconciled && t.reconciliationId === recId).reduce((s, t) => s + Number(t.amount), 0);
  const diff = Number(data.statementBalance) - cleared;

  return (
    <div className="modal-overlay"><div className="modal max-w-2xl">
      <div className="modal-header"><div><h3 className="text-lg font-semibold">{data.bankAccount?.name}</h3><p className="text-xs text-gray-400">Statement {formatDate(data.statementDate)} · {data.status}</p></div><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
      <div className="modal-body">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Statement Balance</p><p className="font-bold">{formatCurrency(data.statementBalance)}</p></div>
          <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-gray-500">Cleared</p><p className="font-bold">{formatCurrency(cleared)}</p></div>
          <div className={`rounded-lg p-3 ${Math.abs(diff) < 0.01 ? 'bg-green-50' : 'bg-amber-50'}`}><p className="text-xs text-gray-500">Difference</p><p className={`font-bold ${Math.abs(diff) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>{formatCurrency(diff)}</p></div>
        </div>
        <div className="max-h-72 overflow-y-auto border rounded-lg">
          <table className="table text-sm">
            <thead><tr><th className="w-10"></th><th>Date</th><th>Description</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {data.transactions.length === 0 ? <tr><td colSpan={4} className="text-center py-6 text-gray-400">No transactions up to the statement date.</td></tr>
                : data.transactions.map((t) => {
                  const checked = t.isReconciled && t.reconciliationId === recId;
                  return (
                    <tr key={t.id} className={checked ? 'bg-green-50' : ''}>
                      <td><input type="checkbox" className="w-4 h-4 accent-green-600" checked={checked} disabled={data.status === 'COMPLETED'} onChange={() => toggle(t.id)} /></td>
                      <td>{formatDate(t.txnDate)}</td>
                      <td>{t.description}</td>
                      <td className={`text-right font-mono ${Number(t.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(t.amount)}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="modal-footer">
        <button onClick={onClose} className="btn-secondary">Close</button>
        {data.status !== 'COMPLETED' && <button onClick={complete} className="btn-primary"><CheckCircle2 className="w-4 h-4" /> Complete</button>}
      </div>
    </div></div>
  );
}

export default function BankPage() {
  const [accounts, setAccounts] = useState([]);
  const [glAccounts, setGlAccounts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [txns, setTxns] = useState([]);
  const [recs, setRecs] = useState([]);
  const [acctModal, setAcctModal] = useState(false);
  const [txnModal, setTxnModal] = useState(false);
  const [reconcileId, setReconcileId] = useState(null);
  const [acctLoading, setAcctLoading] = useState(true);

  const loadAccounts = useCallback(() => {
    setAcctLoading(true);
    bankApi.accounts.list()
      .then((r) => { setAccounts(r.data); if (!selected && r.data[0]) setSelected(r.data[0]); })
      .catch(() => toast.error('Failed to load bank accounts'))
      .finally(() => setAcctLoading(false));
  }, [selected]);
  const loadDetail = useCallback(() => {
    if (!selected) return;
    bankApi.transactions.list({ bankAccountId: selected.id }).then((r) => setTxns(r.data));
    bankApi.reconciliations.list({ bankAccountId: selected.id }).then((r) => setRecs(r.data));
  }, [selected]);

  useEffect(() => { loadAccounts(); acctApi.list({ active: true }).then((r) => setGlAccounts(r.data)); }, []);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const startReconcile = async () => {
    const bal = prompt('Statement ending balance (₱)?');
    if (bal === null) return;
    const date = prompt('Statement date (YYYY-MM-DD)?', new Date().toISOString().split('T')[0]);
    if (!date) return;
    try { const { data } = await bankApi.reconciliations.create({ bankAccountId: selected.id, statementDate: date, statementBalance: Number(bal) }); setReconcileId(data.id); loadDetail(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const delTxn = async (t) => { if (!confirm('Delete this transaction?')) return; try { await bankApi.transactions.remove(t.id); loadDetail(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title flex items-center gap-2"><Landmark className="w-6 h-6 text-blue-700" /> Bank Reconciliation</h1><p className="page-subtitle">Match bank statements to your records</p></div>
        <button className="btn-secondary" onClick={() => setAcctModal(true)}><Plus className="w-4 h-4" /> Bank Account</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Accounts list */}
        <div className="card lg:col-span-1"><div className="card-body">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Accounts</h4>
          {acctLoading ? <p className="text-xs text-gray-400">Loading…</p> : accounts.length === 0 ? <p className="text-xs text-gray-400">No bank accounts yet.</p> : (
            <ul className="space-y-1">
              {accounts.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setSelected(a)} className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selected?.id === a.id ? 'bg-blue-50 text-blue-700 font-medium' : 'hover:bg-gray-50'}`}>
                    {a.name}<div className="text-xs text-gray-400">{a.bankName} · {formatCurrency(a.currentBalance)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div></div>

        {/* Detail */}
        <div className="lg:col-span-3 space-y-4">
          {!selected ? <div className="card"><div className="card-body text-center text-gray-400 py-10">Select or create a bank account.</div></div> : (
            <>
              <div className="card"><div className="card-body">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700">Transactions — {selected.name}</h4>
                  <div className="flex gap-2">
                    <button className="btn-secondary btn-sm" onClick={() => setTxnModal(true)}><Plus className="w-3.5 h-3.5" /> Transaction</button>
                    <button className="btn-primary btn-sm" onClick={startReconcile}><ScrollText className="w-3.5 h-3.5" /> Reconcile</button>
                  </div>
                </div>
                <div className="table-wrapper max-h-80 overflow-y-auto">
                  <table className="table text-sm">
                    <thead><tr><th>Date</th><th>Description</th><th>Ref</th><th className="text-right">Amount</th><th>Cleared</th><th></th></tr></thead>
                    <tbody>
                      {txns.length === 0 ? <tr><td colSpan={6} className="text-center py-6 text-gray-400">No transactions.</td></tr>
                        : txns.map((t) => (
                          <tr key={t.id}>
                            <td>{formatDate(t.txnDate)}</td>
                            <td>{t.description}</td>
                            <td className="text-gray-400 text-xs">{t.reference || '—'}</td>
                            <td className={`text-right font-mono ${Number(t.amount) < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(t.amount)}</td>
                            <td>{t.isReconciled ? <span className="badge-green">✓</span> : <span className="text-gray-300">—</span>}</td>
                            <td>{!t.isReconciled && <button onClick={() => delTxn(t)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div></div>

              <div className="card"><div className="card-body">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Reconciliation History</h4>
                {recs.length === 0 ? <p className="text-xs text-gray-400">No reconciliations yet.</p> : (
                  <table className="table text-sm">
                    <thead><tr><th>Statement Date</th><th className="text-right">Statement Bal.</th><th className="text-right">Reconciled</th><th>Status</th><th></th></tr></thead>
                    <tbody>
                      {recs.map((r) => (
                        <tr key={r.id}>
                          <td>{formatDate(r.statementDate)}</td>
                          <td className="text-right font-mono">{formatCurrency(r.statementBalance)}</td>
                          <td className="text-right font-mono">{formatCurrency(r.reconciledBalance)}</td>
                          <td><span className={r.status === 'COMPLETED' ? 'badge-green' : 'badge-yellow'}>{r.status}</span></td>
                          <td><button onClick={() => setReconcileId(r.id)} className="text-blue-600 text-xs hover:underline">Open</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div></div>
            </>
          )}
        </div>
      </div>

      {acctModal && <AccountModal glAccounts={glAccounts} onClose={() => setAcctModal(false)} onSaved={() => { setAcctModal(false); loadAccounts(); }} />}
      {txnModal && <TxnModal accountId={selected.id} onClose={() => setTxnModal(false)} onSaved={() => { setTxnModal(false); loadDetail(); }} />}
      {reconcileId && <ReconcileModal recId={reconcileId} onClose={() => setReconcileId(null)} onChanged={loadDetail} />}
    </div>
  );
}
