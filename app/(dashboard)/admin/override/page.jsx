'use client';
import { useState, useCallback } from 'react';
import { adminOverride } from '@/lib/api';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Search, Trash2, Unlock, ShieldAlert, Eye, EyeOff, ChevronDown, ChevronRight, BarChart2 } from 'lucide-react';

const TABS = ['Journal Entries', 'Bills', 'Invoices', 'GL Account Viewer'];

const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  POSTED:    'badge-green',
  APPROVED:  'badge-green',
  PAID:      'badge-green',
  PARTIAL:   'badge-yellow',
  UNPAID:    'badge-red',
  CANCELLED: 'badge-red',
  VOIDED:    'badge-red',
};

// ─── Confirm overlay ──────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }) {
  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <div className="flex items-center gap-2 text-red-600">
            <ShieldAlert className="w-5 h-5" />
            <h3 className="font-bold">Confirm Dangerous Action</h3>
          </div>
        </div>
        <div className="modal-body">
          <p className="text-sm text-gray-700">{message}</p>
          <p className="text-xs text-red-500 mt-2 font-medium">⚠ This cannot be undone.</p>
        </div>
        <div className="modal-footer">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn-danger">Yes, Proceed</button>
        </div>
      </div>
    </div>
  );
}

// ─── Journal Entry row (expandable) ──────────────────────────
function JERow({ entry, onUnpost, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td>
          <button onClick={() => setOpen(o => !o)} className="text-gray-400 hover:text-gray-600 mr-1">
            {open ? <ChevronDown className="w-3.5 h-3.5 inline" /> : <ChevronRight className="w-3.5 h-3.5 inline" />}
          </button>
          <span className="font-mono text-xs text-blue-700">{entry.entryNo}</span>
        </td>
        <td className="text-xs text-gray-500">{formatDate(entry.entryDate)}</td>
        <td className="text-sm max-w-xs truncate">{entry.description}</td>
        <td><span className={STATUS_BADGE[entry.status] || 'badge-gray'}>{entry.status}</span></td>
        <td className="text-right font-mono text-sm">
          {formatCurrency(entry.lines?.reduce((s, l) => s + Number(l.debit || 0), 0) || 0)}
        </td>
        <td>
          <div className="flex gap-1 justify-end">
            {entry.status === 'POSTED' && (
              <button
                onClick={() => onUnpost(entry)}
                className="p-1.5 rounded text-yellow-500 hover:bg-yellow-50 hover:text-yellow-700"
                title="Unpost → back to DRAFT (editable in GL)"
              >
                <Unlock className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => onDelete(entry)}
              className="p-1.5 rounded text-red-400 hover:bg-red-50 hover:text-red-600"
              title="Force delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>
      {open && entry.lines?.length > 0 && (
        <tr>
          <td colSpan={6} className="bg-gray-50 px-6 py-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 border-b border-gray-200">
                  <th className="text-left pb-1">Account</th>
                  <th className="text-right pb-1">Debit</th>
                  <th className="text-right pb-1">Credit</th>
                  <th className="text-left pb-1 pl-4">Memo</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((l, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1 font-mono">
                      {l.account?.accountCode} — {l.account?.accountName}
                    </td>
                    <td className="text-right py-1 font-mono">{Number(l.debit) > 0 ? formatCurrency(l.debit) : ''}</td>
                    <td className="text-right py-1 font-mono">{Number(l.credit) > 0 ? formatCurrency(l.credit) : ''}</td>
                    <td className="pl-4 py-1 text-gray-500">{l.description || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AdminOverridePage() {
  const user = typeof window !== 'undefined' ? getUser() : null;

  // Access guard — client-side fallback (server enforces via JWT)
  if (user && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-gray-400">
        <ShieldAlert className="w-12 h-12 mb-3 text-red-300" />
        <p className="font-semibold text-gray-600">Access Denied</p>
        <p className="text-sm">This page is restricted to administrators.</p>
      </div>
    );
  }

  const [tab,      setTab]      = useState(0);
  const [search,   setSearch]   = useState('');
  const [data,     setData]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [confirm,  setConfirm]  = useState(null);
  const [showPage, setShowPage] = useState(false);
  // GL Account Viewer
  const [glCode,   setGlCode]   = useState('1011');
  const [glData,   setGlData]   = useState(null);
  const [glLoading,setGlLoading]= useState(false);

  const loadGl = useCallback(async () => {
    setGlLoading(true);
    try {
      const res = await adminOverride.glDiag(glCode);
      setGlData(res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'GL load failed');
    } finally { setGlLoading(false); }
  }, [glCode]);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      let res;
      if (tab === 0) res = await adminOverride.listEntries({ search, limit: 100 });
      if (tab === 1) res = await adminOverride.listBills({ search, limit: 100 });
      if (tab === 2) res = await adminOverride.listInvoices({ search, limit: 100 });
      setData(res.data.data || res.data);
    } catch (e) {
      toast.error(e.response?.data?.error || 'Load failed');
    } finally { setLoading(false); }
  }, [tab, search]);

  // Journal Entry actions
  const unpostEntry = (entry) => {
    setConfirm({
      message: `Unpost journal entry ${entry.entryNo}? It will revert to DRAFT and can be edited in the General Ledger page, then re-posted.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await adminOverride.unpostEntry(entry.id);
          toast.success(`${entry.entryNo} reverted to DRAFT — edit it in General Ledger`);
          doSearch();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
      },
    });
  };

  const deleteEntry = (entry) => {
    setConfirm({
      message: `Permanently delete journal entry ${entry.entryNo} (${entry.description})? All line items will also be deleted.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await adminOverride.deleteEntry(entry.id);
          toast.success(`${entry.entryNo} deleted`);
          doSearch();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
      },
    });
  };

  // Bill actions
  const unpostBill = (bill) => {
    setConfirm({
      message: `Revert bill ${bill.billNo} (${bill.vendor?.name}) to UNPAID? All AP payments on this bill will be deleted. The related GL journal entry must be deleted separately.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await adminOverride.unpostBill(bill.id);
          toast.success(`${bill.billNo} reverted to UNPAID — payments removed`);
          doSearch();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
      },
    });
  };

  const deleteBill = (bill) => {
    setConfirm({
      message: `Permanently delete bill ${bill.billNo} (${bill.vendor?.name})? All lines and payments will also be deleted.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await adminOverride.deleteBill(bill.id);
          toast.success(`${bill.billNo} deleted`);
          doSearch();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
      },
    });
  };

  // Invoice actions
  const deleteInvoice = (inv) => {
    setConfirm({
      message: `Permanently delete invoice ${inv.invoiceNo} (${inv.customer?.name})? All lines and payments will also be deleted.`,
      onConfirm: async () => {
        setConfirm(null);
        try {
          await adminOverride.deleteInvoice(inv.id);
          toast.success(`${inv.invoiceNo} deleted`);
          doSearch();
        } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
      },
    });
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2 text-red-700">
            <ShieldAlert className="w-5 h-5" /> Admin Data Override
          </h1>
          <p className="page-subtitle text-red-400">
            Restricted · Admin only · All actions are permanent and cannot be undone
          </p>
        </div>
        <button
          onClick={() => setShowPage(o => !o)}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600"
        >
          {showPage ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {showPage ? 'Hide' : 'Show'} controls
        </button>
      </div>

      {!showPage && (
        <div className="card p-10 text-center text-gray-400">
          <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-red-200" />
          <p className="text-sm">Click <strong>Show controls</strong> to access the override tools.</p>
        </div>
      )}

      {showPage && (
        <>
          {/* Warning banner */}
          <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-sm text-red-700 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <strong>Admin Override Mode.</strong> Deleting transactions here will NOT automatically reverse their GL entries.
              If a posted journal entry is linked to this transaction, delete the journal entry separately too,
              or use <strong>Unpost → Edit → Re-post</strong> for journal entries to keep the GL clean.
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-gray-200">
            {TABS.map((t, i) => (
              <button
                key={t}
                onClick={() => { setTab(i); setData([]); }}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  tab === i ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Search — hide on GL Viewer tab */}
          {tab < 3 && <div className="flex gap-3 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                className="input pl-9"
                placeholder={
                  tab === 0 ? 'Search by entry no., description, reference…' :
                  tab === 1 ? 'Search by bill no. or vendor name…' :
                              'Search by invoice no. or customer name…'
                }
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch()}
              />
            </div>
            <button onClick={doSearch} disabled={loading} className="btn-primary">
              {loading ? 'Loading…' : 'Search'}
            </button>
          </div>}

          {/* Results */}
          {data.length > 0 && tab < 3 && (
            <div className="card overflow-hidden">
              {/* ── Journal Entries ── */}
              {tab === 0 && (
                <div className="table-wrapper">
                  <table className="table text-sm">
                    <thead>
                      <tr>
                        <th>Entry No.</th>
                        <th>Date</th>
                        <th>Description</th>
                        <th>Status</th>
                        <th className="text-right">Amount</th>
                        <th className="text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(entry => (
                        <JERow
                          key={entry.id}
                          entry={entry}
                          onUnpost={unpostEntry}
                          onDelete={deleteEntry}
                        />
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">
                    <Unlock className="w-3 h-3 inline mr-1 text-yellow-500" /> Unpost = revert POSTED → DRAFT (edit in GL page, then re-post)
                    &nbsp;·&nbsp;
                    <Trash2 className="w-3 h-3 inline mr-1 text-red-400" /> Delete = permanent
                  </div>
                </div>
              )}

              {/* ── Bills ── */}
              {tab === 1 && (
                <div className="table-wrapper">
                  <table className="table text-sm">
                    <thead>
                      <tr>
                        <th>Bill No.</th>
                        <th>Vendor</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Payments</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(bill => (
                        <tr key={bill.id} className="hover:bg-gray-50">
                          <td className="font-mono text-xs text-blue-700">{bill.billNo}</td>
                          <td className="font-medium">{bill.vendor?.name}</td>
                          <td className="text-xs text-gray-500">{formatDate(bill.billDate)}</td>
                          <td><span className={STATUS_BADGE[bill.status] || 'badge-gray'}>{bill.status}</span></td>
                          <td className="text-right font-mono">{formatCurrency(bill.totalAmount)}</td>
                          <td className="text-right text-xs text-gray-500">
                            {bill.payments?.length > 0
                              ? `${bill.payments.length} payment(s)`
                              : '—'}
                          </td>
                          <td className="flex gap-1 items-center">
                            {bill.status !== 'UNPAID' && (
                              <button
                                onClick={() => unpostBill(bill)}
                                className="p-1.5 rounded text-amber-500 hover:bg-amber-50 hover:text-amber-700"
                                title="Revert to UNPAID — removes payments"
                              >
                                <Unlock className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => deleteBill(bill)}
                              className="p-1.5 rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                              title="Force delete bill + payments"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 text-xs text-red-400 border-t border-gray-100">
                    ⚠ Deleting a bill also deletes its line items and all AP payments. The GL entry must be deleted separately if already posted.
                  </div>
                </div>
              )}

              {/* ── Invoices ── */}
              {tab === 2 && (
                <div className="table-wrapper">
                  <table className="table text-sm">
                    <thead>
                      <tr>
                        <th>Invoice No.</th>
                        <th>Customer</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th className="text-right">Total</th>
                        <th className="text-right">Payments</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map(inv => (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="font-mono text-xs text-blue-700">{inv.invoiceNo}</td>
                          <td className="font-medium">{inv.customer?.name}</td>
                          <td className="text-xs text-gray-500">{formatDate(inv.invoiceDate)}</td>
                          <td><span className={STATUS_BADGE[inv.status] || 'badge-gray'}>{inv.status}</span></td>
                          <td className="text-right font-mono">{formatCurrency(inv.totalAmount)}</td>
                          <td className="text-right text-xs text-gray-500">
                            {inv.payments?.length > 0
                              ? `${inv.payments.length} payment(s)`
                              : '—'}
                          </td>
                          <td>
                            <button
                              onClick={() => deleteInvoice(inv)}
                              className="p-1.5 rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                              title="Force delete invoice + payments"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-4 py-2 text-xs text-red-400 border-t border-gray-100">
                    ⚠ Deleting an invoice also deletes its line items and all AR payments. The GL entry must be deleted separately if already posted.
                  </div>
                </div>
              )}
            </div>
          )}

          {data.length === 0 && !loading && tab < 3 && (
            <div className="card p-10 text-center text-gray-400 text-sm">
              Search above to load records.
            </div>
          )}

          {/* ── GL Account Viewer ── */}
          {tab === 3 && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700 flex items-start gap-2">
                <BarChart2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>Enter any account code to see ALL posted GL lines for that account and compute the running balance. Useful for diagnosing why a balance looks wrong.</div>
              </div>
              <div className="flex gap-3 items-center">
                <input
                  className="input max-w-[160px] font-mono"
                  placeholder="e.g. 1011"
                  value={glCode}
                  onChange={e => setGlCode(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && loadGl()}
                />
                <button onClick={loadGl} disabled={glLoading} className="btn-primary">
                  {glLoading ? 'Loading…' : 'Load GL'}
                </button>
              </div>

              {glData && (
                <div className="card overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="font-mono font-bold text-blue-700 text-sm">{glData.account?.code}</span>
                      <span className="ml-2 text-gray-700 font-medium text-sm">{glData.account?.name}</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-gray-500">Total Dr: <strong className="text-gray-800 font-mono">{formatCurrency(glData.totalDr)}</strong></span>
                      <span className="text-gray-500">Total Cr: <strong className="text-gray-800 font-mono">{formatCurrency(glData.totalCr)}</strong></span>
                      <span className={`font-bold font-mono ${glData.balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        Balance: {formatCurrency(glData.balance)}
                      </span>
                    </div>
                  </div>
                  {glData.lines?.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">No POSTED journal lines found for this account.</div>
                  ) : (
                    <div className="table-wrapper">
                      <table className="table text-xs">
                        <thead>
                          <tr>
                            <th>Entry #</th>
                            <th>Entry No.</th>
                            <th>Date</th>
                            <th>Description / Reference</th>
                            <th className="text-right text-green-700">Debit</th>
                            <th className="text-right text-red-600">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {glData.lines.map((l, i) => (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="font-mono text-gray-400">{l.entryId}</td>
                              <td className="font-mono text-blue-700">{l.entryNo || '—'}</td>
                              <td className="text-gray-500">{formatDate(l.entryDate)}</td>
                              <td className="max-w-xs">
                                <div className="truncate">{l.description}</div>
                                {l.reference && <div className="text-gray-400 font-mono">{l.reference}</div>}
                              </td>
                              <td className="text-right font-mono text-green-700">
                                {l.debit > 0 ? formatCurrency(l.debit) : ''}
                              </td>
                              <td className="text-right font-mono text-red-600">
                                {l.credit > 0 ? formatCurrency(l.credit) : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                          <tr>
                            <td colSpan={4} className="px-4 py-2 text-xs font-bold text-gray-600">TOTALS</td>
                            <td className="text-right font-mono font-bold text-green-700 px-4 py-2">{formatCurrency(glData.totalDr)}</td>
                            <td className="text-right font-mono font-bold text-red-600 px-4 py-2">{formatCurrency(glData.totalCr)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
