'use client';
import { useState, useEffect, useCallback } from 'react';
import { openingBalances as obApi, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, X, Scale } from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

const emptyRow = () => ({ accountId: '', debit: '', credit: '' });

export default function OpeningBalancesPage() {
  const [accounts, setAccounts] = useState([]);
  const [rows, setRows]         = useState([emptyRow()]);
  const [state, setState]       = useState({ booksStartDate: null, entry: null });
  const [recon, setRecon]       = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ob, acc] = await Promise.all([obApi.get(), acctApi.list({ limit: 500 })]);
      setState(ob.data);
      setAccounts(acc.data.data || acc.data);
      obApi.reconcile().then((r) => setRecon(r.data)).catch(() => setRecon(null));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load opening balances');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setRow = (i, k, v) => setRows((p) => p.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  const addRow = () => setRows((p) => [...p, emptyRow()]);
  const rmRow  = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  const totalDebit  = rows.reduce((s, r) => s + (Number(r.debit)  || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
  const equity      = Number((totalDebit - totalCredit).toFixed(2));

  const codeOf = (id) => accounts.find((a) => a.id === Number(id))?.accountCode;

  const submit = async () => {
    const lines = rows
      .filter((r) => r.accountId && (Number(r.debit) > 0 || Number(r.credit) > 0))
      .map((r) => ({ accountCode: codeOf(r.accountId), debit: Number(r.debit) || 0, credit: Number(r.credit) || 0 }));
    if (!lines.length) { toast.error('Enter at least one opening balance line'); return; }

    setSaving(true);
    try {
      await obApi.create({ lines });
      toast.success('Opening balances posted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post opening balances');
    } finally { setSaving(false); }
  };

  const ReconPanel = () => (
    recon?.posted ? (
      <div className="card card-body mb-4">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Reconciliation</h4>
        {[['Accounts Receivable', recon.ar], ['Accounts Payable', recon.ap]].map(([label, r]) => (
          <div key={label} className="flex justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
            <span className="text-gray-600">{label}</span>
            <span className="flex gap-6">
              <span className="text-gray-500">documents {formatCurrency(r.subledger)}</span>
              <span className="text-gray-500">opening {formatCurrency(r.opening)}</span>
              <span className={r.ok ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                {r.ok ? 'matches' : `off by ${formatCurrency(Math.abs(r.difference))}`}
              </span>
            </span>
          </div>
        ))}
        <p className="text-[11px] text-gray-500 mt-3">
          Compares the unpaid balance of documents dated before the books start date against
          the figures in the opening entry. A mismatch means a document was mis-entered or an
          opening figure is wrong.
        </p>
      </div>
    ) : null
  );

  if (loading) return <div className="card card-body text-center py-16 text-gray-400">Loading…</div>;

  if (!state.booksStartDate) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-subtitle">Your day-one position when the books went live</p>
          </div>
        </div>
        <div className="card card-body">
          <p className="text-sm text-gray-600">
            Set this business&apos;s <strong>Books Start Date</strong> in Settings → Businesses first.
            Opening balances are posted on that date.
          </p>
        </div>
      </div>
    );
  }

  if (state.entry) {
    return (
      <div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Opening Balances</h1>
            <p className="page-subtitle">Posted as {state.entry.entryNo} on {formatDate(state.entry.entryDate)}</p>
          </div>
        </div>
        <ReconPanel />
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr>
              </thead>
              <tbody>
                {state.entry.lines.map((l) => (
                  <tr key={l.id}>
                    <td><span className="font-mono text-xs text-gray-500 mr-2">{l.account.accountCode}</span>{l.account.accountName}</td>
                    <td className="text-right">{Number(l.debit)  > 0 ? formatCurrency(l.debit)  : '—'}</td>
                    <td className="text-right">{Number(l.credit) > 0 ? formatCurrency(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Opening balances are posted once. To correct them, reverse {state.entry.entryNo} in the General Ledger first.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Opening Balances</h1>
          <p className="page-subtitle">
            Your position on {formatDate(state.booksStartDate)} — enter only what was still open
          </p>
        </div>
        <button onClick={submit} disabled={saving} className="btn-primary">
          <Scale className="w-4 h-4" /> {saving ? 'Posting…' : 'Post Opening Balances'}
        </button>
      </div>

      <div className="card card-body mb-4 text-sm text-gray-600">
        Enter receivables customers <strong>still owe</strong> you, payables you <strong>still owe</strong>,
        and your actual cash and bank balances on that date. Invoices already settled before the cutover
        belong to the old books — leave them out. The difference is balanced automatically against
        <span className="font-mono"> 3070 Opening Balance Equity</span>.
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="w-44 text-right">Debit (₱)</th>
                <th className="w-44 text-right">Credit (₱)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <AccountSelect value={r.accountId} onChange={(v) => setRow(i, 'accountId', v)}
                      accounts={accounts} placeholder="— select account —" />
                  </td>
                  <td><NumberInput className="input text-right" placeholder="0.00" value={r.debit}
                    onChange={(v) => setRow(i, 'debit', v)} /></td>
                  <td><NumberInput className="input text-right" placeholder="0.00" value={r.credit}
                    onChange={(v) => setRow(i, 'credit', v)} /></td>
                  <td>
                    {rows.length > 1 && (
                      <button onClick={() => rmRow(i)} className="p-1 text-gray-300 hover:text-red-500">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body flex items-center justify-between">
          <button onClick={addRow} className="btn-secondary btn-sm"><Plus className="w-3 h-3" /> Add Line</button>
          <div className="w-96 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Total Debit</span><span>{formatCurrency(totalDebit)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">Total Credit</span><span>{formatCurrency(totalCredit)}</span></div>
            <div className="flex justify-between font-bold border-t border-gray-200 pt-2">
              <span>3070 Opening Balance Equity</span>
              <span>{equity >= 0 ? `${formatCurrency(equity)} CR` : `${formatCurrency(-equity)} DR`}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
