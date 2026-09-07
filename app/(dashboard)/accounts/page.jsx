'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { accounts as api } from '@/lib/api';
import { printDocument } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Plus, Search, Edit2, Trash2, Printer, RefreshCw,
  ChevronLeft, ChevronRight, X, Landmark, CreditCard,
  Scale, TrendingUp, LayoutGrid,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';

// ── Constants ──────────────────────────────────────────────────────────────────
const TYPES    = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];
const PAGE_SIZE = 15;

const TYPE_META = {
  ASSET:     { label: 'Assets',       icon: Landmark,   color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',   badge: 'badge-blue',   header: 'bg-blue-700'   },
  LIABILITY: { label: 'Liabilities',  icon: CreditCard, color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',    badge: 'badge-red',    header: 'bg-red-700'    },
  EQUITY:    { label: 'Equity',       icon: Scale,      color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200', badge: 'badge-purple', header: 'bg-purple-700' },
  REVENUE:   { label: 'Revenue',      icon: TrendingUp, color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200',  badge: 'badge-green',  header: 'bg-green-700'  },
  EXPENSE:   { label: 'Expenses',     icon: PesoReceipt,    color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'badge-yellow', header: 'bg-yellow-700' },
};

const NB_BADGE = {
  DEBIT:  'bg-blue-50 text-blue-700 border border-blue-200',
  CREDIT: 'bg-purple-50 text-purple-700 border border-purple-200',
};

// ── Account Modal ──────────────────────────────────────────────────────────────
function AccountModal({ account, onClose, onSaved, allAccounts }) {
  const isEdit = !!account?.id;
  const [form, setForm] = useState(account
    ? { accountCode: account.accountCode, accountName: account.accountName, accountType: account.accountType, normalBalance: account.normalBalance, parentId: account.parentId || '', description: account.description || '' }
    : { accountCode: '', accountName: '', accountType: 'ASSET', normalBalance: 'DEBIT', parentId: '', description: '' }
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const autoNB = (type) => (['ASSET', 'EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, parentId: form.parentId ? Number(form.parentId) : null };
      if (isEdit) await api.update(account.id, payload);
      else        await api.create(payload);
      toast.success(isEdit ? 'Account updated' : 'Account created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const eligible = allAccounts.filter((a) => a.id !== account?.id && !a.parentId);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-lg shadow-2xl flex flex-col" style={{borderRadius:'0 0 1rem 1rem',maxHeight:'88vh',animation:'topDrawerIn .28s cubic-bezier(.4,0,.2,1)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Edit Account' : 'New Account'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400 hover:text-gray-600" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Account Code</label>
              <input className="input w-full font-mono" value={form.accountCode}
                onChange={set('accountCode')} placeholder="Auto (e.g. 1010)"
                disabled={isEdit} />
              {!isEdit && <p className="text-xs text-gray-400 mt-1">Blank = auto by account type.</p>}
            </div>
            <div>
              <label className="label">Account Type <span className="text-red-500">*</span></label>
              <select className="input w-full" value={form.accountType}
                onChange={(e) => setForm((f) => ({ ...f, accountType: e.target.value, normalBalance: autoNB(e.target.value) }))}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label} ({t})</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Account Name <span className="text-red-500">*</span></label>
            <input className="input w-full" required value={form.accountName}
              onChange={set('accountName')} placeholder="e.g. Cash on Hand" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Normal Balance</label>
              <select className="input w-full" value={form.normalBalance} onChange={set('normalBalance')}>
                <option value="DEBIT">Debit</option>
                <option value="CREDIT">Credit</option>
              </select>
            </div>
            <div>
              <label className="label">Parent / Header Account</label>
              <select className="input w-full" value={form.parentId} onChange={set('parentId')}>
                <option value="">— Root Account —</option>
                {eligible.map((a) => (
                  <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input w-full resize-none" rows={2} value={form.description} onChange={set('description')} />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : isEdit ? 'Update Account' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Pagination Controls ────────────────────────────────────────────────────────
const JUMP_THRESHOLD = 7; // show "Go to page" input once there are more pages than fit inline

function Pagination({ page, totalPages, total, pageSize, onPage }) {
  const [jumpValue, setJumpValue] = useState('');

  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const submitJump = (e) => {
    e.preventDefault();
    const n = Number(jumpValue);
    if (Number.isInteger(n) && n >= 1 && n <= totalPages) {
      onPage(n);
    }
    setJumpValue('');
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
      <p className="text-sm text-gray-500">
        Showing <span className="font-medium">{start}–{end}</span> of <span className="font-medium">{total}</span> accounts
      </p>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => onPage(page - 1)} disabled={page === 1}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronLeft className="w-4 h-4" />
          </button>
          {pages.map((p, i) =>
            p === '…' ? (
              <span key={`ellipsis-${i}`} className="px-2 text-gray-400 text-sm">…</span>
            ) : (
              <button key={p} onClick={() => onPage(p)}
                className={`w-8 h-8 rounded-md text-sm font-medium transition-colors ${
                  p === page ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {p}
              </button>
            )
          )}
          <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        {totalPages > JUMP_THRESHOLD && (
          <form onSubmit={submitJump} className="flex items-center gap-1.5 text-sm text-gray-500">
            <span className="whitespace-nowrap">Go to</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              placeholder={String(page)}
              className="w-14 px-2 py-1 border border-gray-200 rounded-md text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button type="submit" className="px-2 py-1 text-gray-600 hover:text-blue-600 font-medium">
              Go
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [activeTab,setActiveTab]= useState('ALL');
  const [page,     setPage]     = useState(1);
  const [modal,    setModal]    = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.list()
      .then((r) => setAccounts(r.data))
      .catch(() => toast.error('Failed to load accounts'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Reset page when tab or search changes
  useEffect(() => { setPage(1); }, [activeTab, search]);

  // ── Tab counts ──────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { ALL: accounts.length };
    TYPES.forEach((t) => { c[t] = accounts.filter((a) => a.accountType === t).length; });
    return c;
  }, [accounts]);

  // ── Filter ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = activeTab === 'ALL' ? accounts : accounts.filter((a) => a.accountType === activeTab);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter((a) =>
        a.accountCode.toLowerCase().includes(s) || a.accountName.toLowerCase().includes(s)
      );
    }
    return list; // already sorted by accountCode from API
  }, [accounts, activeTab, search]);

  // ── Build flat rows with section headers ────────────────────
  // Rows: { rowType: 'section' | 'account', data, depth }
  const flatRows = useMemo(() => {
    const filteredIds = new Set(filtered.map((a) => a.id));
    const rows = [];

    // In "ALL" mode, insert type-section breaks
    const types = activeTab === 'ALL' ? TYPES : [activeTab];

    for (const type of types) {
      const typeAccounts = filtered.filter((a) => a.accountType === type);
      if (typeAccounts.length === 0) continue;

      // Insert type header only in ALL mode
      if (activeTab === 'ALL') {
        rows.push({ rowType: 'typeHeader', type });
      }

      // Root accounts (no parent, or parent not in filtered set)
      const roots  = typeAccounts.filter((a) => !a.parentId || !filteredIds.has(a.parentId));
      const nonRoot= typeAccounts.filter((a) =>  a.parentId &&  filteredIds.has(a.parentId));

      // Build a quick parent → children map within this type
      const childMap = {};
      for (const a of nonRoot) {
        if (!childMap[a.parentId]) childMap[a.parentId] = [];
        childMap[a.parentId].push(a);
      }

      const addRows = (acct, depth = 0) => {
        const children = childMap[acct.id] || [];
        rows.push({ rowType: 'account', data: acct, depth, isHeader: children.length > 0 });
        for (const child of children) addRows(child, depth + 1);
      };

      for (const root of roots) addRows(root, 0);
    }

    return rows;
  }, [filtered, activeTab]);

  // ── Pagination ──────────────────────────────────────────────
  // Only count 'account' rows toward page size; type headers are always shown
  const accountRows    = flatRows.filter((r) => r.rowType === 'account');
  const totalAccounts  = accountRows.length;
  const totalPages     = Math.max(1, Math.ceil(totalAccounts / PAGE_SIZE));

  const visibleRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    const end   = page * PAGE_SIZE;
    let accountIdx = 0;
    const result = [];
    let currentTypePushed = false;
    let lastType = null;

    for (const row of flatRows) {
      if (row.rowType === 'typeHeader') {
        lastType = row.type;
        currentTypePushed = false;
        continue; // will push when we know there's a visible account in this type
      }
      if (row.rowType === 'account') {
        if (accountIdx >= start && accountIdx < end) {
          // Push type header if needed
          if (!currentTypePushed && activeTab === 'ALL') {
            result.push({ rowType: 'typeHeader', type: lastType });
            currentTypePushed = true;
          }
          result.push(row);
        }
        accountIdx++;
        if (accountIdx >= end) break;
      }
    }
    return result;
  }, [flatRows, page, activeTab]);

  // ── Handlers ────────────────────────────────────────────────
  const handleDelete = async (acct) => {
    if (!confirm(`Delete "${acct.accountName}"?`)) return;
    try {
      await api.remove(acct.id);
      toast.success('Account deleted');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Cannot delete account'); }
  };

  const handlePrint = async () => {
    const typeRows = activeTab === 'ALL' ? TYPES : [activeTab];
    let body = '';
    for (const type of typeRows) {
      const typeAccounts = filtered.filter((a) => a.accountType === type);
      if (!typeAccounts.length) continue;
      const meta = TYPE_META[type];
      const rows = typeAccounts.map((a) => {
        const isRoot = !a.parentId;
        return `<tr ${isRoot ? 'class="section-row"' : ''}>
          <td class="mono${isRoot ? ' bold' : ''}">${a.accountCode}</td>
          <td style="padding-left:${a.parentId ? '24px' : '8px'}" class="${isRoot ? 'bold' : ''}">${a.accountName}</td>
          <td><span class="badge ${meta.badge}">${type}</span></td>
          <td><span class="badge ${a.normalBalance === 'DEBIT' ? 'b-blue' : 'b-gray'}">${a.normalBalance}</span></td>
          <td class="center"><span class="badge ${a.isActive ? 'b-green' : 'b-gray'}">${a.isActive ? 'Active' : 'Inactive'}</span></td>
        </tr>`;
      }).join('');
      body += `
        <div class="section-title">${meta.label}</div>
        <table>
          <thead><tr><th>Code</th><th>Account Name</th><th>Type</th><th>Normal Balance</th><th class="center">Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }
    await printDocument(
      'Chart of Accounts',
      activeTab === 'ALL' ? `All Types · ${filtered.length} accounts` : `${TYPE_META[activeTab].label} · ${filtered.length} accounts`,
      body
    );
  };

  // ── Render ───────────────────────────────────────────────────
  const TAB_ITEMS = [
    { key: 'ALL', label: 'All Accounts', icon: LayoutGrid },
    ...TYPES.map((t) => ({ key: t, label: TYPE_META[t].label, icon: TYPE_META[t].icon })),
  ];

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-subtitle">PFRS-aligned — advertising & retail</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Account
          </button>
        </div>
      </div>

      {/* Type Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          const meta   = TYPE_META[key];
          return (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all border ${
                active
                  ? key === 'ALL'
                    ? 'bg-gray-900 text-white border-gray-900 shadow-md'
                    : `${meta.bg} ${meta.color} ${meta.border} shadow-sm`
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-xs font-bold ${
                active
                  ? key === 'ALL' ? 'bg-white/20 text-white' : 'bg-white/70'
                  : 'bg-gray-100 text-gray-500'
              }`}>
                {counts[key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search code or account name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Code</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Account Name</th>
                {activeTab === 'ALL' && (
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Type</th>
                )}
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-28">Normal Bal.</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide w-24">Status</th>
                <th className="px-4 py-3 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400">Loading accounts…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16 text-center text-gray-400">
                  {search ? 'No accounts match your search.' : 'No accounts yet — run the seed to populate.'}
                </td></tr>
              ) : visibleRows.map((row, i) => {

                // ── Type separator (ALL tab only) ──
                if (row.rowType === 'typeHeader') {
                  const meta = TYPE_META[row.type];
                  const Icon = meta.icon;
                  return (
                    <tr key={`type-${row.type}`}>
                      <td colSpan={6} className={`px-4 py-2 ${meta.bg} border-y ${meta.border}`}>
                        <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${meta.color}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {meta.label}
                          <span className="font-normal normal-case tracking-normal text-gray-500">
                            ({accounts.filter((a) => a.accountType === row.type).length} accounts)
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // ── Account row ──
                const { data: a, depth, isHeader } = row;
                const meta = TYPE_META[a.accountType];

                return (
                  <tr key={a.id} className={`border-b border-gray-50 transition-colors group ${
                    isHeader && depth === 0
                      ? `${meta.bg} hover:brightness-95`
                      : 'hover:bg-gray-50'
                  }`}>
                    {/* Code */}
                    <td className="px-4 py-3">
                      <span className={`font-mono text-xs font-semibold ${meta.color}`}>
                        {a.accountCode}
                      </span>
                    </td>

                    {/* Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 20}px` }}>
                        {depth > 0 && (
                          <span className="text-gray-300 select-none mr-1">
                            {'└'}
                          </span>
                        )}
                        <span className={`${isHeader && depth === 0 ? `font-bold ${meta.color}` : depth === 1 ? 'font-medium text-gray-800' : 'text-gray-700'}`}>
                          {a.accountName}
                        </span>
                        {isHeader && depth === 0 && (
                          <span className="ml-2 text-xs text-gray-400 font-normal">(header)</span>
                        )}
                      </div>
                    </td>

                    {/* Type (ALL tab only) */}
                    {activeTab === 'ALL' && (
                      <td className="px-4 py-3 text-center">
                        <span className={`badge ${meta.badge}`}>{a.accountType}</span>
                      </td>
                    )}

                    {/* Normal Balance */}
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${NB_BADGE[a.normalBalance]}`}>
                        {a.normalBalance}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span className={`badge ${a.isActive ? 'badge-green' : 'badge-gray'}`}>
                        {a.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setModal(a)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Edit">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <Pagination
          page={page}
          totalPages={totalPages}
          total={totalAccounts}
          pageSize={PAGE_SIZE}
          onPage={(p) => setPage(Math.max(1, Math.min(p, totalPages)))}
        />
      </div>

      {/* Modal */}
      {modal && (
        <AccountModal
          account={modal === 'new' ? null : modal}
          allAccounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
