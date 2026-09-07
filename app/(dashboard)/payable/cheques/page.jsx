'use client';
import { useState, useEffect, useCallback } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Clock, AlertCircle, CheckCircle2, Ban, XCircle, Printer,
  FileSpreadsheet, RefreshCw, History,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel } from '@/lib/export';

const BUCKET_ORDER = ['Past Due', '0-7 days', '8-14 days', '15-30 days', '30+ days'];
const BUCKET_BADGE = {
  'Past Due':   'badge-red',
  '0-7 days':   'badge-yellow',
  '8-14 days':  'badge-yellow',
  '15-30 days': 'badge-blue',
  '30+ days':   'badge-gray',
};
const STATUS_BADGE = {
  OUTSTANDING: 'badge-yellow',
  CLEARED:     'badge-green',
  BOUNCED:     'badge-red',
  CANCELLED:   'badge-gray',
};

// ─── Action confirm dialog — Clear (needs a date) or Bounce/Cancel (needs a reason) ───
function ActionDialog({ cheque, action, onClose, onDone }) {
  const [clearDate, setClearDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const title = action === 'clear' ? 'Mark Cheque Cleared' : action === 'bounce' ? 'Mark Cheque Bounced' : 'Cancel Cheque';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (action !== 'clear' && !reason.trim()) {
      toast.error('A reason is required');
      return;
    }
    setSaving(true);
    try {
      if (action === 'clear') await pApi.cheques.clear(cheque.id, { clearDate });
      else if (action === 'bounce') await pApi.cheques.bounce(cheque.id, { reason });
      else await pApi.cheques.cancel(cheque.id, { reason });
      toast.success(`Cheque ${action === 'clear' ? 'cleared' : action === 'bounce' ? 'marked bounced' : 'cancelled'}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Vendor</span><span className="font-medium">{cheque.vendorName}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Bill</span><span>{cheque.billNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Cheque No.</span><span>{cheque.checkNo || '—'}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1"><span>Amount</span><span>{formatCurrency(cheque.amount)}</span></div>
            </div>

            {action === 'clear' ? (
              <div className="form-group">
                <label className="label">Clear Date *</label>
                <input type="date" className="input" required value={clearDate} onChange={(e) => setClearDate(e.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label className="label">Reason *</label>
                <textarea className="input resize-none" rows={3} required value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder={action === 'bounce' ? 'e.g. Insufficient funds' : 'e.g. Stop payment requested by vendor'} />
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className={action === 'clear' ? 'btn-success' : 'btn-danger'}>
              {saving ? 'Saving...' : title}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChequesPage() {
  const [cheques, setCheques] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('outstanding'); // 'outstanding' | 'history'
  const [dialog, setDialog] = useState(null); // { cheque, action }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await pApi.cheques.list();
      setCheques(data);
    } catch {
      toast.error('Failed to load cheques');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
      <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p>Loading cheques...</p>
    </div>
  );

  const outstanding = cheques.filter((c) => c.clearingStatus === 'OUTSTANDING');
  const history = cheques.filter((c) => c.clearingStatus !== 'OUTSTANDING');
  const totalOutstanding = outstanding.reduce((s, c) => s + Number(c.amount), 0);
  const pastDueCount = outstanding.filter((c) => c.bucket === 'Past Due').length;

  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: outstanding.filter((c) => c.bucket === bucket).sort((a, b) => new Date(a.checkDate) - new Date(b.checkDate)),
  })).filter((g) => g.items.length > 0);

  const handlePrint = () => {
    const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sections = grouped.map((g) => `
      <div class="section-title">${esc(g.bucket)} (${g.items.length})</div>
      <table>
        <thead><tr><th>Vendor</th><th>Bill #</th><th>Cheque No.</th><th>Check Date</th><th class="right">Amount</th></tr></thead>
        <tbody>${g.items.map((c) => `
          <tr>
            <td>${esc(c.vendorName)}</td>
            <td class="mono">${esc(c.billNo)}</td>
            <td class="mono small">${esc(c.checkNo)}</td>
            <td>${dateFmt(c.checkDate)}</td>
            <td class="right mono bold">${phpFmt(c.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>`).join('');
    const body = `
      <div class="totals-block" style="max-width:320px;margin-bottom:16px;">
        <div class="totals-row totals-total"><span>Total Outstanding</span><span class="mono">${phpFmt(totalOutstanding)}</span></div>
      </div>
      ${sections}
      <p class="small gray" style="margin-top:10px;">Outstanding post-dated cheques only, grouped by days until check date, as of the print date above.</p>`;
    printDocument('Outstanding Cheques', `${outstanding.length} cheque${outstanding.length !== 1 ? 's' : ''} · ${phpFmt(totalOutstanding)}`, body);
  };

  const handleExcel = () => {
    const rows = outstanding.map((c) => ({
      bucket: c.bucket, vendorName: c.vendorName, billNo: c.billNo, checkNo: c.checkNo,
      checkDate: c.checkDate, amount: Number(c.amount),
    }));
    exportToExcel(
      rows,
      [
        { key: 'bucket', label: 'Aging' },
        { key: 'vendorName', label: 'Vendor' },
        { key: 'billNo', label: 'Bill #' },
        { key: 'checkNo', label: 'Cheque No.' },
        { key: 'checkDate', label: 'Check Date', format: (v) => dateFmt(v) },
        { key: 'amount', label: 'Amount', format: (v) => phpFmt(v) },
      ],
      'Outstanding-Cheques'
    );
  };

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cheques</h1>
          <p className="page-subtitle">
            {outstanding.length} outstanding · {formatCurrency(totalOutstanding)}
            {pastDueCount > 0 && <span className="ml-2 text-red-600 font-medium">· {pastDueCount} past due</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw className="w-4 h-4" /> Refresh</button>
          <button onClick={handlePrint} className="btn-secondary" disabled={outstanding.length === 0}><Printer className="w-4 h-4" /> Print</button>
          <button onClick={handleExcel} className="btn-secondary" disabled={outstanding.length === 0}><FileSpreadsheet className="w-4 h-4" /> Excel</button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab('outstanding')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'outstanding' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
        >
          <Clock className="w-4 h-4 inline mr-1" /> Outstanding ({outstanding.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`px-4 py-2 text-sm font-medium border-b-2 ${tab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}
        >
          <History className="w-4 h-4 inline mr-1" /> History ({history.length})
        </button>
      </div>

      {tab === 'outstanding' && (
        <div className="space-y-4">
          {grouped.length === 0 && (
            <div className="card"><div className="card-body text-center py-10 text-gray-400">No outstanding cheques.</div></div>
          )}
          {grouped.map((g) => (
            <div key={g.bucket} className="card">
              <div className="card-body pt-4 pb-2">
                <span className={`badge ${BUCKET_BADGE[g.bucket]}`}>{g.bucket}</span>
                <span className="text-gray-400 text-sm ml-2">{g.items.length} cheque{g.items.length !== 1 ? 's' : ''} · {formatCurrency(g.items.reduce((s, c) => s + Number(c.amount), 0))}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500 border-t border-gray-100">
                  <tr>
                    <th className="px-4 py-2">Vendor</th>
                    <th className="px-4 py-2">Bill #</th>
                    <th className="px-4 py-2">Cheque No.</th>
                    <th className="px-4 py-2">Check Date</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">{c.vendorName}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.billNo}</td>
                      <td className="px-4 py-2 font-mono text-xs">{c.checkNo || '—'}</td>
                      <td className="px-4 py-2">{formatDate(c.checkDate)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-2">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setDialog({ cheque: c, action: 'clear' })} className="text-green-600 hover:text-green-700" title="Mark cleared">
                            <CheckCircle2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDialog({ cheque: c, action: 'bounce' })} className="text-red-600 hover:text-red-700" title="Mark bounced">
                            <AlertCircle className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDialog({ cheque: c, action: 'cancel' })} className="text-gray-400 hover:text-gray-600" title="Cancel cheque">
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="card">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr>
                <th className="px-4 py-2">Vendor</th>
                <th className="px-4 py-2">Bill #</th>
                <th className="px-4 py-2">Cheque No.</th>
                <th className="px-4 py-2">Check Date</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">No settled cheques yet.</td></tr>
              )}
              {history.map((c) => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-4 py-2">{c.vendorName}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.billNo}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.checkNo || '—'}</td>
                  <td className="px-4 py-2">{formatDate(c.checkDate)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(c.amount)}</td>
                  <td className="px-4 py-2"><span className={`badge ${STATUS_BADGE[c.clearingStatus]}`}>{c.clearingStatus}</span></td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{c.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog && (
        <ActionDialog
          cheque={dialog.cheque}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
}
