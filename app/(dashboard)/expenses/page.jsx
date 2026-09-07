'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { expenses as expApi, accounts as accountsApi, audit as auditApi } from '@/lib/api';
import { formatCurrency, formatDate, getUser, scopedKey } from '@/lib/auth';
import { printDocument } from '@/lib/print';
import Attachments from '@/components/Attachments';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';
import toast from 'react-hot-toast';
import {
  Plus, X, Printer, RefreshCw, Trash2, Send, CheckCircle2,
  Banknote, AlertCircle, Edit2, Search, Wallet, ChevronDown,
  FileText, History, Ban,
} from 'lucide-react';
import { saveDraft, loadDraft, clearDraft, listDraftKeys } from '@/lib/draftStorage';

const fmt = n => formatCurrency(Number(n || 0));
const todayStr = () => new Date().toISOString().slice(0, 10);

const HISTORY_ACTION_BADGE = {
  CREATE:  'badge-green',
  UPDATE:  'badge-blue',
  SUBMIT:  'badge-blue',
  APPROVE: 'badge-green',
  PAY:     'badge-green',
  REJECT:  'badge-red',
  DELETE:  'badge-red',
  VOID:    'badge-gray',
};

const fmtDateTime = (d) => {
  const dt = new Date(d);
  return `${formatDate(dt)} ${dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const TYPE_OPTS = [
  { value: 'PETTY_CASH',     label: 'Petty Cash',      sub: 'Small cash purchases from petty fund',  color: 'blue'   },
  { value: 'REIMBURSEMENT',  label: 'Reimbursement',   sub: 'Employee personal spend for company',   color: 'green'  },
  { value: 'DIRECT_PAYMENT', label: 'Direct Payment',  sub: 'Utilities, rent, service payments',     color: 'purple' },
  { value: 'LIQUIDATION',    label: 'Liquidation',     sub: 'Settlement of a cash advance',          color: 'red'    },
];

const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SUBMITTED: 'badge-yellow',
  APPROVED:  'badge-blue',
  PAID:      'badge-green',
  REJECTED:  'badge-red',
  VOID:      'badge-gray',
};

const TABS = ['All', 'Petty Cash', 'Reimbursement', 'Direct Payment', 'Cash Advance', 'Liquidation'];
const TAB_MAP = {
  'Petty Cash': 'PETTY_CASH', 'Reimbursement': 'REIMBURSEMENT',
  'Direct Payment': 'DIRECT_PAYMENT', 'Cash Advance': 'CASH_ADVANCE', 'Liquidation': 'LIQUIDATION',
};

// ─── Top-drawer wrapper ───────────────────────────────────────────
function Drawer({ open, onClose, title, subtitle, children, footer, wide }) {
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className={`bg-white ${wide ? 'max-w-4xl' : 'max-w-2xl'} w-full shadow-2xl flex flex-col`}
        style={{ borderRadius: '0 0 1rem 1rem', maxHeight: '92vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="px-4 lg:px-6 py-3 lg:py-4 border-b border-gray-200 flex items-start justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 lg:p-6 space-y-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-4 lg:px-6 py-3 lg:py-4 border-t border-gray-200 flex flex-wrap items-center justify-end gap-2 flex-shrink-0 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Line-item row ────────────────────────────────────────────────
function ItemRow({ item, index, accounts, onChange, onRemove }) {
  return (
    <div className="border border-gray-100 rounded-lg p-3 space-y-2 lg:border-0 lg:p-0 lg:space-y-0 lg:grid lg:grid-cols-12 lg:gap-2 lg:items-start">
      {/* Description */}
      <div className="lg:col-span-5">
        <label className="text-xs text-gray-400 lg:hidden">Description</label>
        <input className="input text-sm" placeholder="Description" value={item.description}
          onChange={e => onChange(index, 'description', e.target.value)} />
      </div>
      {/* COA Account */}
      <div className="lg:col-span-3">
        <label className="text-xs text-gray-400 lg:hidden">COA Account</label>
        <AccountSelect
          value={item.accountId || ''}
          onChange={(val) => onChange(index, 'accountId', val ? Number(val) : null)}
          accounts={accounts.filter(a => a.accountType === 'EXPENSE')}
          placeholder="— COA Account (opt.) —"
        />
      </div>
      {/* Amount + Receipt on same row on mobile */}
      <div className="flex gap-2 lg:contents">
        <div className="flex-1 lg:col-span-2">
          <label className="text-xs text-gray-400 lg:hidden">Amount</label>
          <NumberInput className="input text-sm text-right" placeholder="0.00"
            value={item.amount} onChange={v => onChange(index, 'amount', v)} />
        </div>
        <div className="w-24 lg:col-span-1">
          <label className="text-xs text-gray-400 lg:hidden">Receipt #</label>
          <input className="input text-sm" placeholder="Receipt#" value={item.receiptNo || ''}
            onChange={e => onChange(index, 'receiptNo', e.target.value)} />
        </div>
        <div className="lg:col-span-1 flex items-end justify-end pb-0.5">
          <button type="button" onClick={() => onRemove(index)} className="p-1.5 text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────
export default function ExpensesPage() {
  const user = typeof window !== 'undefined' ? getUser() : null;
  const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '';

  const [vouchers,   setVouchers]   = useState([]);
  const [summary,    setSummary]    = useState(null);
  const [categories, setCategories] = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [tab,        setTab]        = useState('All');
  const [statusFilter, setStatusFilter] = useState('');
  const [search,     setSearch]     = useState('');
  const [fromDate,   setFromDate]   = useState('');
  const [toDate,     setToDate]     = useState('');

  // Drawer states
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing,    setEditing]    = useState(null);

  // Action drawer
  const [actionOpen,   setActionOpen]   = useState(false);
  const [actionMode,   setActionMode]   = useState(''); // submit|approve|pay|reject
  const [actionRecord, setActionRecord] = useState(null);
  const [actionForm,   setActionForm]   = useState({ name: '', date: todayStr(), reason: '', paymentAccountCode: '' });
  const [actionItems,  setActionItems]  = useState([]);
  const [cashAccounts, setCashAccounts] = useState([]);

  // History drawer
  const [historyOpen,    setHistoryOpen]    = useState(false);
  const [historyRecord,  setHistoryRecord]  = useState(null);
  const [historyLogs,    setHistoryLogs]    = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(null);

  // Form state
  const [fType,       setFType]       = useState('PETTY_CASH');
  const [fDate,       setFDate]       = useState(todayStr());
  const [fPayee,      setFPayee]      = useState('');
  const [fCategory,   setFCategory]   = useState('');
  const [fPurpose,    setFPurpose]    = useState('');
  const [fReceiptNo,  setFReceiptNo]  = useState('');
  const [fRequestedBy,setFRequestedBy]= useState(userName);
  const [fNotes,      setFNotes]      = useState('');
  const [fItems,      setFItems]      = useState([{ description: '', accountId: null, amount: '', receiptNo: '' }]);

  const fTotal = fItems.reduce((s, it) => s + Number(it.amount || 0), 0);

  const draftKey = scopedKey(editing?.id ? `expense:edit:${editing.id}` : 'expense:new');
  const autoOpenedRef = useRef(false);
  const initialSnapshotRef = useRef(null);

  const applyDraft = useCallback((d) => {
    if (!d || typeof d !== 'object') return;
    if (d.fType !== undefined) setFType(d.fType);
    if (d.fDate !== undefined) setFDate(d.fDate);
    if (d.fPayee !== undefined) setFPayee(d.fPayee);
    if (d.fCategory !== undefined) setFCategory(d.fCategory);
    if (d.fPurpose !== undefined) setFPurpose(d.fPurpose);
    if (d.fReceiptNo !== undefined) setFReceiptNo(d.fReceiptNo);
    if (d.fRequestedBy !== undefined) setFRequestedBy(d.fRequestedBy);
    if (d.fNotes !== undefined) setFNotes(d.fNotes);
    if (Array.isArray(d.fItems)) setFItems(d.fItems);
  }, []);

  useEffect(() => {
    if (!drawerOpen || typeof window === 'undefined') return undefined;
    const current = JSON.stringify({
      fType, fDate, fPayee, fCategory, fPurpose, fReceiptNo, fRequestedBy, fNotes, fItems,
    });
    if (current === initialSnapshotRef.current) return undefined;
    const t = setTimeout(() => {
      saveDraft(window.localStorage, draftKey, {
        fType, fDate, fPayee, fCategory, fPurpose, fReceiptNo, fRequestedBy, fNotes, fItems,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [drawerOpen, draftKey, fType, fDate, fPayee, fCategory, fPurpose, fReceiptNo, fRequestedBy, fNotes, fItems]);

  // Load data
  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    if (tab !== 'All')  params.type   = TAB_MAP[tab];
    if (statusFilter)   params.status = statusFilter;
    if (search)         params.search = search;
    if (fromDate)       params.from   = fromDate;
    if (toDate)         params.to     = toDate;
    try {
      const [vRes, sumRes] = await Promise.all([
        expApi.list(params),
        expApi.summary(),
      ]);
      setVouchers(vRes.data.data || vRes.data);
      setSummary(sumRes.data);
    } catch { toast.error('Failed to load expenses'); }
    finally  { setLoading(false); }
  }, [tab, statusFilter, search, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    expApi.categories().then(c => setCategories(c.data)).catch(() => {});
    // Load ALL accounts for line-items selector; derive cash subset for payment account picker
    accountsApi.list({ active: 'true' })
      .then(a => {
        const all = a.data || [];
        setAccounts(all);
        // Cash & bank accounts: codes 1010–1099 (petty cash, bank accounts)
        const cash = all.filter(ac =>
          ac.accountCode && Number(ac.accountCode) >= 1010 && Number(ac.accountCode) <= 1099
        );
        // Fallback: if no 10xx accounts found, show all ASSET accounts
        setCashAccounts(cash.length ? cash : all.filter(ac => ac.accountType === 'ASSET'));
      })
      .catch(() => toast.error('Could not load accounts — check server connection'));
  }, []);

  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, scopedKey('expense:new'))) { openNew(); return; }

    const editKeys = listDraftKeys(window.localStorage, scopedKey('expense:edit:'));
    if (!editKeys.length) return;
    const id = Number(editKeys[0].split(':').pop());
    if (!Number.isFinite(id)) { clearDraft(window.localStorage, editKeys[0]); return; }
    expApi.get(id)
      .then(({ data }) => openEdit(data))
      .catch(() => clearDraft(window.localStorage, editKeys[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Form helpers ──────────────────────────────────────────────
  function resetForm() {
    setFType('PETTY_CASH'); setFDate(todayStr()); setFPayee(''); setFCategory('');
    setFPurpose(''); setFReceiptNo(''); setFRequestedBy(userName); setFNotes('');
    setFItems([{ description: '', accountId: null, amount: '', receiptNo: '' }]);
  }

  function openNew() {
    setEditing(null);
    resetForm();
    setDrawerOpen(true);
    initialSnapshotRef.current = JSON.stringify({
      fType: 'PETTY_CASH', fDate: todayStr(), fPayee: '', fCategory: '',
      fPurpose: '', fReceiptNo: '', fRequestedBy: userName, fNotes: '',
      fItems: [{ description: '', accountId: null, amount: '', receiptNo: '' }],
    });
    const d = loadDraft(window.localStorage, scopedKey('expense:new'));
    if (d) { applyDraft(d); toast('Draft restored from your last session', { icon: '📝' }); }
  }

  function openEdit(v) {
    setEditing(v);
    setFType(v.type);
    setFDate(new Date(v.date).toISOString().slice(0, 10));
    setFPayee(v.payee);
    setFCategory(v.category);
    setFPurpose(v.purpose);
    setFReceiptNo(v.receiptNo || '');
    setFRequestedBy(v.requestedBy || '');
    setFNotes(v.notes || '');
    const items = v.items?.length
      ? v.items.map(it => ({ description: it.description, accountId: it.accountId || null, amount: String(it.amount), receiptNo: it.receiptNo || '' }))
      : [{ description: '', accountId: null, amount: '', receiptNo: '' }];
    setFItems(items);
    setDrawerOpen(true);
    initialSnapshotRef.current = JSON.stringify({
      fType: v.type,
      fDate: new Date(v.date).toISOString().slice(0, 10),
      fPayee: v.payee,
      fCategory: v.category,
      fPurpose: v.purpose,
      fReceiptNo: v.receiptNo || '',
      fRequestedBy: v.requestedBy || '',
      fNotes: v.notes || '',
      fItems: items,
    });
    const d = loadDraft(window.localStorage, scopedKey(`expense:edit:${v.id}`));
    if (d) { applyDraft(d); toast('Draft restored from your last session', { icon: '📝' }); }
  }

  function addItem() {
    setFItems(prev => [...prev, { description: '', accountId: null, amount: '', receiptNo: '' }]);
  }

  function updateItem(idx, field, val) {
    setFItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }

  function removeItem(idx) {
    setFItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!fPayee || !fCategory || !fPurpose) { toast.error('Payee, category, and purpose are required'); return; }
    if (fItems.some(it => !it.description || !it.amount)) { toast.error('Each line item needs a description and amount'); return; }

    const payload = {
      type: fType, date: fDate, payee: fPayee, category: fCategory, purpose: fPurpose,
      receiptNo: fReceiptNo, requestedBy: fRequestedBy, notes: fNotes,
      items: fItems.map(it => ({ ...it, amount: Number(it.amount) })),
    };
    try {
      if (editing) {
        await expApi.update(editing.id, payload);
        toast.success('Updated');
      } else {
        await expApi.create(payload);
        toast.success('Expense voucher created');
      }
      clearDraft(window.localStorage, draftKey);
      setDrawerOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Save failed'); }
  }

  // ── Actions ───────────────────────────────────────────────────
  function openAction(mode, rec) {
    setActionMode(mode);
    setActionRecord(rec);
    // Pre-fill with the value already on the voucher so submitting/approving/paying
    // never clobbers an existing requester (e.g. the requester entered at creation).
    const existingName = mode === 'submit'  ? rec.requestedBy
                       : mode === 'approve' ? rec.approvedBy
                       : mode === 'pay'     ? rec.paidBy
                       : '';
    // Default payment account: Petty Cash (1011) for PETTY_CASH type, else Cash in Bank (1020)
    const defaultCashCode = rec.type === 'PETTY_CASH' ? '1011' : '1020';
    setActionForm({ name: existingName || userName, date: todayStr(), reason: '', paymentAccountCode: defaultCashCode });
    setActionItems(mode === 'approve'
      ? (rec.items?.length
          ? rec.items.map(it => ({ description: it.description, accountId: it.accountId || null, amount: String(it.amount), receiptNo: it.receiptNo || '' }))
          : [{ description: '', accountId: null, amount: '', receiptNo: '' }])
      : []);
    setActionOpen(true);
  }

  function addActionItem() {
    setActionItems(prev => [...prev, { description: '', accountId: null, amount: '', receiptNo: '' }]);
  }

  function updateActionItem(idx, field, val) {
    setActionItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }

  function removeActionItem(idx) {
    setActionItems(prev => prev.filter((_, i) => i !== idx));
  }

  const actionItemsTotal = actionItems.reduce((s, it) => s + Number(it.amount || 0), 0);

  async function handleAction() {
    const { id } = actionRecord;
    if (actionMode === 'approve') {
      if (!actionItems.length) { toast.error('At least one line item is required'); return; }
      if (actionItems.some(it => !it.description || !Number(it.amount))) { toast.error('Each line item needs a description and amount'); return; }
    }
    if (actionMode === 'void' && !actionForm.reason.trim()) { toast.error('A reason is required to void this voucher'); return; }
    try {
      if (actionMode === 'submit')  await expApi.submit(id,  { requestedBy: actionForm.name });
      if (actionMode === 'approve') await expApi.approve(id, { approvedBy: actionForm.name, items: actionItems.map(it => ({ ...it, amount: Number(it.amount) })) });
      if (actionMode === 'pay')     await expApi.pay(id,     { paidBy: actionForm.name, paidDate: actionForm.date, paymentAccountCode: actionForm.paymentAccountCode });
      if (actionMode === 'reject')  await expApi.reject(id,  { rejectedReason: actionForm.reason });
      if (actionMode === 'void')    await expApi.void(id,    actionForm.reason);
      toast.success(`Voucher ${actionMode}${actionMode === 'pay' ? 'd' : 'ed'}`);
      setActionOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Action failed'); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this expense voucher?')) return;
    try { await expApi.remove(id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e?.response?.data?.error || 'Delete failed'); }
  }

  // ── History ──────────────────────────────────────────────────
  async function openHistory(v) {
    setHistoryRecord(v);
    setHistoryExpanded(null);
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await auditApi.list({ entity: 'ExpenseVoucher', entityId: v.id, limit: 100 });
      setHistoryLogs(res.data.data || res.data);
    } catch { toast.error('Failed to load history'); }
    finally { setHistoryLoading(false); }
  }

  // ── Print single voucher ──────────────────────────────────────
  function printVoucher(v) {
    const typeLabel = TYPE_OPTS.find(t => t.value === v.type)?.label || v.type;
    const itemRows  = (v.items || []).map(it => `
      <tr>
        <td style="padding:6px 10px;border:1px solid #e5e7eb">${it.description}</td>
        ${it.account ? `<td style="padding:6px 10px;border:1px solid #e5e7eb">${it.account.accountCode} — ${it.account.accountName}</td>` : '<td style="padding:6px 10px;border:1px solid #e5e7eb">—</td>'}
        <td style="padding:6px 10px;border:1px solid #e5e7eb">${it.receiptNo || '—'}</td>
        <td style="padding:6px 10px;border:1px solid #e5e7eb;text-align:right"><strong>${fmt(it.amount)}</strong></td>
      </tr>`).join('');

    printDocument(
      `${typeLabel} — ${v.voucherNo}`,
      `Date: ${new Date(v.date).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:12px;margin-bottom:20px">
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 8px;color:#6b7280;width:120px">Voucher No.</td><td style="padding:4px 8px;font-weight:600">${v.voucherNo}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Type</td><td style="padding:4px 8px">${typeLabel}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Date</td><td style="padding:4px 8px">${new Date(v.date).toLocaleDateString('en-PH')}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Payee</td><td style="padding:4px 8px;font-weight:600">${v.payee}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Category</td><td style="padding:4px 8px">${v.category}</td></tr>
        </table>
        <table style="border-collapse:collapse">
          <tr><td style="padding:4px 8px;color:#6b7280;width:120px">Status</td><td style="padding:4px 8px;font-weight:600">${v.status}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Requested By</td><td style="padding:4px 8px">${v.requestedBy || '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Approved By</td><td style="padding:4px 8px">${v.approvedBy || '—'}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b7280">Paid By</td><td style="padding:4px 8px">${v.paidBy || '—'}</td></tr>
          ${v.paidDate ? `<tr><td style="padding:4px 8px;color:#6b7280">Date Paid</td><td style="padding:4px 8px">${new Date(v.paidDate).toLocaleDateString('en-PH')}</td></tr>` : ''}
        </table>
      </div>
      <div style="font-size:12px;margin-bottom:16px;padding:10px;background:#f9fafb;border-radius:8px">
        <strong>Purpose:</strong> ${v.purpose}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:20px">
        <thead><tr style="background:#f3f4f6">
          <th style="padding:7px 10px;border:1px solid #e5e7eb;text-align:left">Description</th>
          <th style="padding:7px 10px;border:1px solid #e5e7eb;text-align:left">Account</th>
          <th style="padding:7px 10px;border:1px solid #e5e7eb;text-align:left">Receipt #</th>
          <th style="padding:7px 10px;border:1px solid #e5e7eb;text-align:right">Amount</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr style="background:#f3f4f6">
          <td colspan="3" style="padding:8px 10px;border:1px solid #e5e7eb;font-weight:700;text-align:right">TOTAL</td>
          <td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:14px">${fmt(v.totalAmount)}</td>
        </tr></tfoot>
      </table>
      ${v.notes ? `<p style="font-size:11px;color:#6b7280"><strong>Notes:</strong> ${v.notes}</p>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:32px;margin-top:40px;font-size:11px;text-align:center">
        <div><div style="border-top:1px solid #374151;padding-top:4px;margin-top:32px">Requested By</div><div style="font-weight:600">${v.requestedBy || ''}</div></div>
        <div><div style="border-top:1px solid #374151;padding-top:4px;margin-top:32px">Approved By</div><div style="font-weight:600">${v.approvedBy || ''}</div></div>
        <div><div style="border-top:1px solid #374151;padding-top:4px;margin-top:32px">Received By</div><div style="font-weight:600">${v.paidBy || ''}</div></div>
      </div>`
    );
  }

  const typeOpt = TYPE_OPTS.find(t => t.value === fType);

  const yearOpts = [];
  for (let y = new Date().getFullYear() + 1; y >= 2020; y--) yearOpts.push(y);

  // ── Action drawer title/label helpers ─────────────────────────
  const actionConfig = {
    submit:  { title: 'Submit for Approval', btnLabel: 'Submit',  btnClass: 'btn-primary', fieldLabel: 'Submitted By' },
    approve: { title: 'Approve Voucher',     btnLabel: 'Approve', btnClass: 'btn-success', fieldLabel: 'Approved By'  },
    pay:     { title: 'Mark as Paid',        btnLabel: 'Mark Paid', btnClass: 'btn-success', fieldLabel: 'Paid By'    },
    reject:  { title: 'Reject Voucher',      btnLabel: 'Reject',  btnClass: 'btn-danger',  fieldLabel: 'Reason'       },
    void:    { title: 'Void Voucher',        btnLabel: 'Void Voucher', btnClass: 'btn-danger', fieldLabel: 'Reason'  },
  };
  const aCfg = actionConfig[actionMode] || {};

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Wallet className="w-6 h-6 text-blue-600" /> Expense Vouchers</h1>
          <p className="page-subtitle">Petty cash, reimbursements, direct payments, cash advances & liquidations</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></button>
          <button className="btn-primary btn-sm" onClick={openNew}><Plus className="w-4 h-4" /> New Voucher</button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { key: 'submitted', label: 'Pending Approval', cls: 'text-yellow-600', bg: 'bg-yellow-50' },
            { key: 'approved',  label: 'Approved / For Payment', cls: 'text-blue-600',   bg: 'bg-blue-50'   },
            { key: 'paid',      label: 'Paid This Month', cls: 'text-green-700',  bg: 'bg-green-50'  },
            { key: 'rejected',  label: 'Rejected',        cls: 'text-red-600',    bg: 'bg-red-50'    },
            { key: 'draft',     label: 'Drafts',          cls: 'text-gray-600',   bg: 'bg-gray-50'   },
          ].map(({ key, label, cls, bg }) => (
            <div key={key} className={`card p-4 ${bg}`}>
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className={`text-2xl font-bold ${cls}`}>{summary[key]?.count ?? 0}</div>
              <div className="text-xs text-gray-400 mt-0.5">{fmt(summary[key]?.amount)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3 space-y-3">
          {/* Type tabs */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>
          {/* Row 2: search + status + date range */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input className="input pl-9" placeholder="Search voucher, payee, purpose…" value={search}
                onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="input w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              {['DRAFT','SUBMITTED','APPROVED','PAID','REJECTED','VOID'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="date" className="input w-40" value={fromDate} onChange={e => setFromDate(e.target.value)} placeholder="From" />
            <input type="date" className="input w-40" value={toDate}   onChange={e => setToDate(e.target.value)}   placeholder="To" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Voucher No.</th><th>Type</th><th>Date</th><th>Payee</th>
                <th>Category</th><th>Purpose</th><th className="text-right">Amount</th>
                <th>Status</th><th>Requested By</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">Loading…</td></tr>
              ) : vouchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-14 text-center text-gray-400">
                    <Wallet className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p>No expense vouchers yet. Click <strong>New Voucher</strong> to start.</p>
                  </td>
                </tr>
              ) : vouchers.map(v => {
                const tOpt = TYPE_OPTS.find(t => t.value === v.type);
                const can  = { edit: ['DRAFT','REJECTED'].includes(v.status), del: ['DRAFT','REJECTED'].includes(v.status) };
                return (
                  <tr key={v.id}>
                    <td className="font-mono text-xs text-blue-600 font-semibold">{v.voucherNo}</td>
                    <td><span className={`badge badge-${tOpt?.color || 'gray'}`}>{tOpt?.label || v.type}</span></td>
                    <td className="text-sm text-gray-600">{new Date(v.date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="font-medium max-w-[140px] truncate" title={v.payee}>{v.payee}</td>
                    <td className="text-xs text-gray-500">{v.category?.replace('_', ' ')}</td>
                    <td className="max-w-[160px] truncate text-sm text-gray-700" title={v.purpose}>{v.purpose}</td>
                    <td className="text-right font-semibold">{fmt(v.totalAmount)}</td>
                    <td><span className={`badge ${STATUS_BADGE[v.status]}`}>{v.status}</span></td>
                    <td className="text-xs text-gray-500">{v.requestedBy || '—'}</td>
                    <td>
                      <div className="flex gap-1 flex-nowrap">
                        {can.edit && <button className="btn-secondary btn-sm" onClick={() => openEdit(v)} title="Edit"><Edit2 className="w-3 h-3" /></button>}
                        {v.status === 'DRAFT'     && <button className="btn-primary btn-sm"  onClick={() => openAction('submit',  v)} title="Submit"><Send className="w-3 h-3" /></button>}
                        {v.status === 'SUBMITTED' && <button className="btn-success btn-sm"  onClick={() => openAction('approve', v)} title="Approve"><CheckCircle2 className="w-3 h-3" /></button>}
                        {v.status === 'SUBMITTED' && <button className="btn-danger btn-sm"   onClick={() => openAction('reject',  v)} title="Reject"><X className="w-3 h-3" /></button>}
                        {v.status === 'APPROVED'  && <button className="btn-success btn-sm"  onClick={() => openAction('pay',     v)} title="Mark Paid"><Banknote className="w-3 h-3" /></button>}
                        {['SUBMITTED','APPROVED','PAID'].includes(v.status) && <button className="btn-danger btn-sm" onClick={() => openAction('void', v)} title="Void"><Ban className="w-3 h-3" /></button>}
                        <button className="btn-secondary btn-sm" onClick={() => printVoucher(v)} title="Print"><Printer className="w-3 h-3" /></button>
                        <button className="btn-secondary btn-sm" onClick={() => openHistory(v)} title="History"><History className="w-3 h-3" /></button>
                        {can.del && <button className="btn-danger btn-sm" onClick={() => handleDelete(v.id)} title="Delete"><Trash2 className="w-3 h-3" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── New / Edit Voucher Drawer ── */}
      <Drawer wide open={drawerOpen} onClose={() => { clearDraft(window.localStorage, draftKey); setDrawerOpen(false); }}
        title={editing ? `Edit — ${editing.voucherNo}` : 'New Expense Voucher'}
        subtitle={editing ? `${TYPE_OPTS.find(t=>t.value===editing.type)?.label || editing.type} · ${editing.status}` : 'Fill in the details below'}
        footer={
          <>
            <button className="btn-secondary" onClick={() => { clearDraft(window.localStorage, draftKey); setDrawerOpen(false); }}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>
              {editing ? 'Save Changes' : 'Create Voucher'}
            </button>
          </>
        }
      >
        {/* Type selector */}
        <div>
          <label className="label">Voucher Type</label>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-1">
            {TYPE_OPTS.map(t => (
              <button key={t.value} type="button" onClick={() => setFType(t.value)}
                className={`border-2 rounded-xl p-2.5 text-left transition-all ${fType === t.value ? `border-blue-400 bg-blue-50` : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                <div className={`font-semibold text-xs ${fType === t.value ? 'text-blue-700' : 'text-gray-800'}`}>{t.label}</div>
                <div className="text-xs text-gray-400 mt-0.5 leading-tight hidden sm:block">{t.sub}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Core fields */}
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Date *</label>
            <input type="date" className="input" value={fDate} onChange={e => setFDate(e.target.value)} max={todayStr()} />
          </div>
          <div className="form-group">
            <label className="label">Category *</label>
            <select className="input" value={fCategory} onChange={e => setFCategory(e.target.value)}>
              <option value="">— Select category —</option>
              {categories.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group">
          <label className="label">Payee / Recipient *</label>
          <input className="input" placeholder="e.g. Juan Dela Cruz, Shell Station EDSA, PLDT" value={fPayee}
            onChange={e => setFPayee(e.target.value)} />
          <p className="text-xs text-gray-400 mt-1">Enter any name — not limited to registered vendors</p>
        </div>

        <div className="form-group">
          <label className="label">Purpose / Description *</label>
          <textarea className="input h-16 resize-none" placeholder="Brief description of what this expense is for…"
            value={fPurpose} onChange={e => setFPurpose(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Requested By</label>
            <input className="input" value={fRequestedBy} onChange={e => setFRequestedBy(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Overall Receipt No. (optional)</label>
            <input className="input" placeholder="e.g. OR-12345" value={fReceiptNo} onChange={e => setFReceiptNo(e.target.value)} />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Line Items *</label>
            <button type="button" className="btn-secondary btn-sm" onClick={addItem}><Plus className="w-3 h-3" /> Add Line</button>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-0.5 mb-1">
            <div className="col-span-5 text-xs text-gray-500 font-medium">Description</div>
            <div className="col-span-3 text-xs text-gray-500 font-medium">COA Account (opt.)</div>
            <div className="col-span-2 text-xs text-gray-500 font-medium text-right">Amount</div>
            <div className="col-span-1 text-xs text-gray-500 font-medium">Receipt #</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {fItems.map((it, idx) => (
              <ItemRow key={idx} item={it} index={idx} accounts={accounts}
                onChange={updateItem} onRemove={removeItem} />
            ))}
          </div>

          {/* Total */}
          <div className="flex justify-end mt-3 pt-3 border-t border-gray-100">
            <div className="text-right">
              <span className="text-sm text-gray-500 mr-4">Total</span>
              <span className="text-xl font-bold text-gray-900">{fmt(fTotal)}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="form-group">
          <label className="label">Notes / Remarks</label>
          <textarea className="input h-16 resize-none" placeholder="Optional notes…"
            value={fNotes} onChange={e => setFNotes(e.target.value)} />
        </div>

        {/* Attachments — only available once the voucher exists */}
        {editing?.id && (
          <div className="border-t border-gray-100 pt-4">
            <Attachments entity="ExpenseVoucher" entityId={editing.id} />
          </div>
        )}

        {/* Tip for non-vendor payees */}
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-xs text-blue-700">
          <strong>Tip:</strong> Payee can be any person or business name — gas stations, convenience stores, freelancers, government agencies. These vouchers automatically appear in the Daily Remittance Report once Approved or Paid.
        </div>
      </Drawer>

      {/* ── Action Sub-Drawer ── */}
      <Drawer open={actionOpen} onClose={() => setActionOpen(false)} title={aCfg.title || ''} wide={actionMode === 'approve'}
        subtitle={actionRecord ? `${actionRecord.voucherNo} · ${actionRecord.payee} · ${fmt(actionRecord.totalAmount)}` : ''}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setActionOpen(false)}>Cancel</button>
            <button className={aCfg.btnClass || 'btn-primary'} onClick={handleAction}>{aCfg.btnLabel}</button>
          </>
        }
      >
        {actionRecord && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-sm">
              <div className="font-semibold text-gray-900">{actionRecord.voucherNo} — {TYPE_OPTS.find(t=>t.value===actionRecord.type)?.label || actionRecord.type}</div>
              <div className="text-gray-500 mt-0.5">Payee: <strong>{actionRecord.payee}</strong> · Amount: <strong>{fmt(actionRecord.totalAmount)}</strong></div>
              <div className="text-gray-400 mt-0.5 text-xs">{actionRecord.purpose}</div>
            </div>

            {actionMode === 'approve' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Line Items *</label>
                  <button type="button" className="btn-secondary btn-sm" onClick={addActionItem}><Plus className="w-3 h-3" /> Add Line</button>
                </div>

                <div className="grid grid-cols-12 gap-2 px-0.5 mb-1">
                  <div className="col-span-5 text-xs text-gray-500 font-medium">Description</div>
                  <div className="col-span-3 text-xs text-gray-500 font-medium">COA Account (opt.)</div>
                  <div className="col-span-2 text-xs text-gray-500 font-medium text-right">Amount</div>
                  <div className="col-span-1 text-xs text-gray-500 font-medium">Receipt #</div>
                  <div className="col-span-1" />
                </div>

                <div className="space-y-2">
                  {actionItems.map((it, idx) => (
                    <ItemRow key={idx} item={it} index={idx} accounts={accounts}
                      onChange={updateActionItem} onRemove={removeActionItem} />
                  ))}
                </div>

                <div className="flex justify-end mt-3 pt-3 border-t border-gray-100">
                  <div className="text-right">
                    <span className="text-sm text-gray-500 mr-4">Total</span>
                    <span className="text-xl font-bold text-gray-900">{fmt(actionItemsTotal)}</span>
                  </div>
                </div>
              </div>
            )}

            {(actionMode !== 'reject' && actionMode !== 'void') ? (
              <>
                <div className="form-group">
                  <label className="label">{aCfg.fieldLabel}</label>
                  <input className="input" value={actionForm.name} onChange={e => setActionForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                {actionMode === 'pay' && (
                  <>
                    <div className="form-group">
                      <label className="label">Payment Account <span className="text-red-500">*</span></label>
                      <select
                        className="input"
                        value={actionForm.paymentAccountCode}
                        onChange={e => setActionForm(p => ({ ...p, paymentAccountCode: e.target.value }))}
                        required
                      >
                        <option value="">— Select account —</option>
                        {(cashAccounts.length ? cashAccounts : accounts.filter(ac => ac.accountType === 'ASSET')).map(ac => (
                          <option key={ac.id} value={ac.accountCode}>
                            {ac.accountCode} — {ac.accountName}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-400 mt-1">Where the funds came from (Petty Cash, Cash in Bank, etc.)</p>
                    </div>
                    <div className="form-group">
                      <label className="label">Payment Date</label>
                      <input type="date" className="input" value={actionForm.date} onChange={e => setActionForm(p => ({ ...p, date: e.target.value }))} />
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="form-group">
                <label className="label">{actionMode === 'void' ? 'Reason for Voiding *' : 'Reason for Rejection *'}</label>
                <textarea className="input h-24 resize-none" value={actionForm.reason}
                  onChange={e => setActionForm(p => ({ ...p, reason: e.target.value }))}
                  placeholder={actionMode === 'void' ? 'Explain why this voucher is being voided…' : 'Explain why this voucher is being rejected…'} />
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* ── History Drawer ── */}
      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)}
        title={historyRecord ? `History — ${historyRecord.voucherNo}` : 'History'}
        subtitle={historyRecord ? `${historyRecord.payee} · ${fmt(historyRecord.totalAmount)}` : ''}
        footer={<button className="btn-secondary" onClick={() => setHistoryOpen(false)}>Close</button>}
      >
        {historyLoading ? (
          <div className="py-10 text-center text-gray-400 text-sm">Loading…</div>
        ) : historyLogs.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">No history recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {historyLogs.map(l => (
              <div key={l.id} className="border border-gray-100 rounded-lg overflow-hidden">
                <button type="button" className="w-full text-left p-3 hover:bg-gray-50"
                  onClick={() => l.changes && setHistoryExpanded(historyExpanded === l.id ? null : l.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`badge ${HISTORY_ACTION_BADGE[l.action] || 'badge-gray'}`}>{l.action}</span>
                    <span className="text-xs text-gray-400 font-mono">{fmtDateTime(l.createdAt)}</span>
                    <span className="text-xs text-gray-400">· {l.userEmail || '—'}</span>
                  </div>
                  <div className="text-sm text-gray-700 mt-1">{l.summary || '—'}</div>
                </button>
                {historyExpanded === l.id && l.changes && (
                  <pre className="text-xs bg-gray-50 border-t border-gray-100 p-3 overflow-x-auto text-gray-700">{JSON.stringify(l.changes, null, 2)}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}