'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { journal as jApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Eye, CheckCircle, XCircle, Filter, AlertTriangle, ShieldAlert, Lock, Printer, Search } from 'lucide-react';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput, { groupThousands } from '@/components/NumberInput';
import { formatCurrency, formatDate, scopedKey } from '@/lib/auth';
import { useDraftGuard } from '@/lib/useDraftGuard';
import { loadDraft, listDraftKeys, clearDraft } from '@/lib/draftStorage';

const STATUS_BADGE = { DRAFT:'badge-yellow', POSTED:'badge-green', VOIDED:'badge-gray' };

// ─── 2-Step Void Authorization Modal ─────────────────────────
function VoidModal({ entry, onClose, onVoided }) {
  const [step, setStep]       = useState(1);   // 1 = confirm, 2 = admin auth
  const [reason, setReason]   = useState('');
  const [agreed, setAgreed]   = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwError, setPwError] = useState('');

  const totalDr = entry.lines?.reduce((s, l) => s + Number(l.debit), 0) || 0;

  const handleStep1 = () => {
    if (!reason.trim()) { toast.error('Please provide a reason for voiding'); return; }
    if (!agreed)        { toast.error('You must confirm you understand this action'); return; }
    setStep(2);
  };

  const handleVoid = async () => {
    if (!password) { setPwError('Admin password is required'); return; }
    setLoading(true);
    setPwError('');
    try {
      await jApi.void(entry.id, { adminPassword: password, reason });
      toast.success(`${entry.entryNo} has been voided`);
      onVoided();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Void failed';
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('unauthorized')) {
        setPwError(msg);
      } else {
        toast.error(msg);
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">

        {/* ── Step 1: Confirm ── */}
        {step === 1 && (
          <>
            <div className="modal-header bg-red-50 border-b border-red-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-800">Void Journal Entry</h3>
                  <p className="text-xs text-red-500">This action cannot be undone</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="modal-body space-y-4">
              {/* Entry summary */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Entry No.</span>
                  <span className="font-mono font-bold text-gray-900">{entry.entryNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date</span>
                  <span className="text-gray-700">{formatDate(entry.entryDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(totalDr)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Description</span>
                  <span className="text-gray-700 text-right max-w-[200px] truncate">{entry.description}</span>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
                <strong>Warning:</strong> Voiding this entry will permanently reverse its effect on all account balances,
                reports, and financial statements. The entry will be marked VOIDED and cannot be re-posted.
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for voiding <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="input w-full h-20 resize-none text-sm"
                  placeholder="State the reason this entry must be voided…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-red-600"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className="text-sm text-gray-700">
                  I understand that voiding this entry is <strong>permanent</strong> and will affect
                  financial reports. Super admin authorization is required on the next step.
                </span>
              </label>
            </div>

            <div className="modal-footer">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleStep1} className="btn bg-red-600 text-white hover:bg-red-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Proceed to Authorization
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Admin password ── */}
        {step === 2 && (
          <>
            <div className="modal-header bg-red-50 border-b border-red-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Lock className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-800">Super Admin Authorization</h3>
                  <p className="text-xs text-red-500">Step 2 of 2 — Enter admin credentials to confirm</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="modal-body space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
                You are about to void <strong className="font-mono">{entry.entryNo}</strong>.
                An account with <strong>ADMIN</strong> role must authorize this action.
              </div>

              <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
                <p><span className="font-medium">Reason recorded:</span> {reason}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    className={`input pl-9 w-full ${pwError ? 'border-red-400 focus:ring-red-400' : ''}`}
                    placeholder="Enter super admin password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPwError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleVoid()}
                    autoFocus
                  />
                </div>
                {pwError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{pwError}</p>}
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setStep(1)} className="btn-secondary">← Back</button>
              <button
                onClick={handleVoid}
                disabled={loading}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? 'Verifying…' : <><XCircle className="w-4 h-4" /> Confirm Void</>}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

function printEntry(entry) {
  const lines = (entry.lines || []);
  const totalDr = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCr = lines.reduce((s, l) => s + Number(l.credit), 0);

  const linesHTML = lines.map((l) => `
    <tr>
      <td class="mono blue small">${l.account?.accountCode || '—'}</td>
      <td>${l.account?.accountName || '—'}</td>
      <td class="right mono">${Number(l.debit) > 0 ? phpFmt(l.debit) : ''}</td>
      <td class="right mono">${Number(l.credit) > 0 ? phpFmt(l.credit) : ''}</td>
      <td class="gray small">${l.description || ''}</td>
    </tr>`).join('');

  const body = `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">Entry No.</div><div class="info-val mono">${entry.entryNo}</div></div>
      <div class="info-box"><div class="info-lbl">Date</div><div class="info-val">${dateFmt(entry.entryDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${badge(entry.status)}</div></div>
      <div class="info-box"><div class="info-lbl">Reference</div><div class="info-val mono small">${entry.reference || '—'}</div></div>
      <div class="info-box" style="grid-column:span 2"><div class="info-lbl">Description</div><div class="info-val">${entry.description || '—'}</div></div>
    </div>
    <div class="section-title">Journal Lines</div>
    <table>
      <thead><tr><th>Account Code</th><th>Account Name</th><th class="right">Debit</th><th class="right">Credit</th><th>Memo</th></tr></thead>
      <tbody>${linesHTML}</tbody>
      <tfoot>
        <tr>
          <td colspan="2" class="right gray">TOTALS</td>
          <td class="right mono">${phpFmt(totalDr)}</td>
          <td class="right mono">${phpFmt(totalCr)}</td>
          <td class="${Math.abs(totalDr - totalCr) < 0.01 ? 'green' : 'red'}">${Math.abs(totalDr - totalCr) < 0.01 ? '✓ Balanced' : '✗ Not balanced'}</td>
        </tr>
      </tfoot>
    </table>`;

  printDocument(`Journal Entry — ${entry.entryNo}`, dateFmt(entry.entryDate), body);
}

function JournalModal({ entry, accounts, onClose, onSaved }) {
  const [form, setForm] = useState({
    ...(entry || {
      entryDate: new Date().toISOString().split('T')[0],
      reference: '', description: '',
      lines: [
        { accountId: '', debit: '', credit: '', description: '' },
        { accountId: '', debit: '', credit: '', description: '' },
      ],
    }),
    notes: entry?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const draftKey = scopedKey(entry?.id ? `journal:edit:${entry.id}` : 'journal:new');
  const { clearDraft: clearJournalDraft } = useDraftGuard(draftKey, form, setForm);

  const totalDebit  = form.lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const setLine = (i, field, val) => setForm(f => ({
    ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l)
  }));

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { accountId:'', debit:'', credit:'', description:'' }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!balanced) { toast.error('Entry is not balanced'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lines: form.lines.filter(l => l.accountId).map(l => ({ ...l, accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) };
      if (entry?.id) await jApi.update(entry.id, payload);
      else await jApi.create(payload);
      toast.success('Journal entry saved');
      clearJournalDraft();
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const handleClose = () => { clearJournalDraft(); onClose(); };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{entry?.id ? `Edit — ${entry.entryNo}` : 'New Journal Entry'}</h3>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Date *</label>
                <input type="date" className="input" required value={form.entryDate} onChange={(e) => setForm(f => ({...f, entryDate: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="label">Reference</label>
                <input className="input" value={form.reference} onChange={(e) => setForm(f => ({...f, reference: e.target.value}))} placeholder="e.g. OR-0001" />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Description *</label>
              <input className="input" required value={form.description} onChange={(e) => setForm(f => ({...f, description: e.target.value}))} placeholder="e.g. Payment received from client" />
            </div>
            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Journal Lines</label>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Line</button>
              </div>
              <div className="overflow-x-auto">
                <table className="table table-compact text-sm">
                  <thead><tr><th>Account</th><th className="w-36 text-right">Debit</th><th className="w-36 text-right">Credit</th><th>Memo</th><th className="w-8"></th></tr></thead>
                  <tbody>
                    {form.lines.map((line, i) => (
                      <tr key={i}>
                        <td>
                          <AccountSelect
                            value={line.accountId}
                            onChange={(val) => setLine(i, 'accountId', val)}
                            accounts={accounts}
                            placeholder="-- Select Account --"
                          />
                        </td>
                        <td><NumberInput className="input w-full text-right" value={line.debit} onChange={(v) => setLine(i, 'debit', v)} placeholder="0.00" /></td>
                        <td><NumberInput className="input w-full text-right" value={line.credit} onChange={(v) => setLine(i, 'credit', v)} placeholder="0.00" /></td>
                        <td><input className="input w-full text-xs" value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Optional memo" /></td>
                        <td>{form.lines.length > 2 && <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>}</td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 font-semibold text-sm">
                      <td className="text-right text-gray-500">Totals</td>
                      <td className="text-right font-mono">{groupThousands(totalDebit.toFixed(2))}</td>
                      <td className="text-right font-mono">{groupThousands(totalCredit.toFixed(2))}</td>
                      <td colSpan={2}>
                        {balanced
                          ? <span className="text-green-600 text-xs">✓ Balanced</span>
                          : <span className="text-red-500 text-xs">✗ Off by {Math.abs(totalDebit - totalCredit).toFixed(2)}</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Supporting details, approval remarks…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
            {entry?.id && (
              <button type="button" onClick={() => printEntry(entry)} className="btn-secondary">
                <Printer className="w-4 h-4" /> Print
              </button>
            )}
            <button type="submit" disabled={saving || !balanced} className="btn-primary">{saving ? 'Saving...' : 'Save Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ status: '', from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [voidEntry, setVoidEntry] = useState(null);
  const autoOpenedRef = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    jApi.list({ ...filter, page, limit: 20 }).then(r => { setEntries(r.data.data); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then(r => setAccounts(r.data)); }, []);

  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, scopedKey('journal:new'))) { setModal('new'); return; }

    const editKeys = listDraftKeys(window.localStorage, scopedKey('journal:edit:'));
    if (!editKeys.length) return;
    const id = Number(editKeys[0].split(':').pop());
    if (!Number.isFinite(id)) { clearDraft(window.localStorage, editKeys[0]); return; }
    jApi.get(id)
      .then(({ data }) => setModal(data))
      .catch(() => clearDraft(window.localStorage, editKeys[0]));
  }, [loading]);

  const handlePost = async (id) => {
    try { await jApi.post(id); toast.success('Entry posted to GL'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Cannot post'); }
  };

  const handlePrintList = () => {
    if (!entries.length) { toast.error('No entries to print'); return; }
    const rows = entries.map((e) => {
      const dr = e.lines?.reduce((s, l) => s + Number(l.debit), 0) || 0;
      return `<tr>
        <td class="mono blue small">${e.entryNo}</td>
        <td>${dateFmt(e.entryDate)}</td>
        <td>${e.description}</td>
        <td class="mono small gray">${e.reference || '—'}</td>
        <td class="right mono">${phpFmt(dr)}</td>
        <td class="center">${badge(e.status)}</td>
      </tr>`;
    }).join('');
    const totalDr = entries.reduce((s, e) => s + (e.lines?.reduce((ss, l) => ss + Number(l.debit), 0) || 0), 0);
    const subtitle = [
      filter.status && `Status: ${filter.status}`,
      filter.from   && `From: ${dateFmt(filter.from)}`,
      filter.to     && `To: ${dateFmt(filter.to)}`,
    ].filter(Boolean).join('  ·  ') || 'All entries';

    const body = `
      <table>
        <thead><tr><th>Entry No.</th><th>Date</th><th>Description</th><th>Reference</th><th class="right">Debit</th><th class="center">Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4" class="right">TOTAL (${entries.length} entries)</td><td class="right mono">${phpFmt(totalDr)}</td><td></td></tr></tfoot>
      </table>`;

    printDocument('Journal Entries', subtitle, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-subtitle">{total} total entries</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={handlePrintList}><Printer className="w-4 h-4" /> Print List</button>
          <button className="btn-primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> New Entry</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <label htmlFor="journal-search" className="sr-only">Search by entry number, description, or reference</label>
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input id="journal-search" className="input pl-9 w-full" placeholder="Search entry"
              title="Search by entry number, description, or reference"
              value={filter.search} onChange={(e) => setFilter(f => ({...f, search: e.target.value}))} />
          </div>
          <select className="select w-40" value={filter.status} onChange={(e) => setFilter(f => ({...f, status: e.target.value}))}>
            <option value="">All Status</option>
            <option>DRAFT</option><option>POSTED</option><option>VOIDED</option>
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">From</label>
            <input type="date" className="input w-40" value={filter.from} onChange={(e) => setFilter(f => ({...f, from: e.target.value}))} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">To</label>
            <input type="date" className="input w-40" value={filter.to} onChange={(e) => setFilter(f => ({...f, to: e.target.value}))} />
          </div>
          <button className="btn-secondary" onClick={load}><Filter className="w-4 h-4" /> Filter</button>
          <button className="btn-secondary" onClick={() => setFilter({ status: '', from: '', to: '', search: '' })}>Reset</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Entry No.</th><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">No journal entries found.</td></tr>
              ) : entries.map(e => {
                const totalDr = e.lines?.reduce((s, l) => s + Number(l.debit), 0) || 0;
                return (
                  <tr key={e.id}>
                    <td className="font-mono text-blue-700 font-medium">{e.entryNo}</td>
                    <td>{formatDate(e.entryDate)}</td>
                    <td className="max-w-xs truncate text-gray-700">{e.description}</td>
                    <td className="text-gray-400 text-xs">{e.reference || '—'}</td>
                    <td className="text-right font-medium">{formatCurrency(totalDr)}</td>
                    <td><span className={STATUS_BADGE[e.status]}>{e.status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => setModal(e)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Eye className="w-4 h-4" /></button>
                        {e.status === 'DRAFT' && <button onClick={() => handlePost(e.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Post"><CheckCircle className="w-4 h-4" /></button>}
                        {e.status !== 'VOIDED' && <button onClick={() => setVoidEntry(e)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Void"><XCircle className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-between text-sm text-gray-500">
          <span>{total} entries total</span>
          <div className="flex gap-2">
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="btn-secondary btn-sm">Previous</button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button disabled={entries.length < 20} onClick={() => setPage(p=>p+1)} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      </div>

      {modal && <JournalModal entry={modal === 'new' ? null : modal} accounts={accounts} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {voidEntry && <VoidModal entry={voidEntry} onClose={() => setVoidEntry(null)} onVoided={() => { setVoidEntry(null); load(); }} />}
    </div>
  );
}
