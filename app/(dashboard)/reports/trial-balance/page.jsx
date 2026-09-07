'use client';
import { useState, useEffect, useCallback } from 'react';
import { journal } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  Scale, RefreshCw, CheckCircle, AlertCircle, Eye, EyeOff,
  TrendingUp, TrendingDown, Hash, Download,
  ChevronDown, ChevronUp, Search, Printer,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';

// ─── Account type config ──────────────────────────────────────
const TYPE_CONFIG = {
  ASSET:     { label: 'Assets',      color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',  badge: 'badge-blue',   normal: 'DEBIT'  },
  LIABILITY: { label: 'Liabilities', color: 'text-red-700',    bg: 'bg-red-50',    border: 'border-red-200',   badge: 'badge-red',    normal: 'CREDIT' },
  EQUITY:    { label: 'Equity',      color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200',badge: 'badge-purple', normal: 'CREDIT' },
  REVENUE:   { label: 'Revenue',     color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200', badge: 'badge-green',  normal: 'CREDIT' },
  EXPENSE:   { label: 'Expenses',    color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200',badge: 'bg-orange-100 text-orange-700 badge', normal: 'DEBIT' },
};

const TYPE_ORDER = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

// ─── Tooltip ──────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1 truncate max-w-48">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-gray-500">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Account Row ──────────────────────────────────────────────
function AccountRow({ account, showZero }) {
  const hasBalance = account.debitBalance > 0 || account.creditBalance > 0;
  if (!showZero && !hasBalance) return null;

  const isNormal = account.normalBalance === 'DEBIT' ? account.debitBalance > 0 : account.creditBalance > 0;
  const isAbnormal = hasBalance && !isNormal;

  return (
    <tr className={`hover:bg-gray-50/50 ${!hasBalance ? 'opacity-40' : ''}`}>
      <td>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-gray-400 w-16 flex-shrink-0">{account.code}</span>
          <span className={`text-sm ${isAbnormal ? 'text-amber-600 font-medium' : 'text-gray-800'}`}>
            {account.name}
          </span>
          {isAbnormal && (
            <span title="Abnormal balance" className="text-amber-500">
              <AlertCircle className="w-3 h-3" />
            </span>
          )}
        </div>
      </td>
      <td className="text-right font-mono text-sm">
        {account.debitBalance > 0 ? (
          <span className="text-gray-900">{formatCurrency(account.debitBalance)}</span>
        ) : (
          <span className="text-gray-200">—</span>
        )}
      </td>
      <td className="text-right font-mono text-sm">
        {account.creditBalance > 0 ? (
          <span className="text-gray-900">{formatCurrency(account.creditBalance)}</span>
        ) : (
          <span className="text-gray-200">—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Account Group ────────────────────────────────────────────
function AccountGroup({ type, accounts, showZero, search }) {
  const [collapsed, setCollapsed] = useState(false);
  const cfg = TYPE_CONFIG[type];

  const filtered = accounts.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.code.includes(search)
  );

  const visible = showZero ? filtered : filtered.filter((a) => a.debitBalance > 0 || a.creditBalance > 0);
  if (visible.length === 0 && !showZero) return null;

  const totalDebit  = visible.reduce((s, a) => s + Number(a.debitBalance),  0);
  const totalCredit = visible.reduce((s, a) => s + Number(a.creditBalance), 0);

  return (
    <>
      {/* Group header */}
      <tr
        className={`cursor-pointer select-none ${cfg.bg} border-t-2 ${cfg.border}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {collapsed
              ? <ChevronDown className={`w-3.5 h-3.5 ${cfg.color}`} />
              : <ChevronUp   className={`w-3.5 h-3.5 ${cfg.color}`} />
            }
            <span className={`text-xs font-bold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
            <span className={`badge text-xs ${cfg.badge}`}>{visible.length}</span>
          </div>
        </td>
        <td className={`text-right px-4 py-2.5 font-mono text-sm font-bold ${cfg.color}`}>
          {totalDebit > 0 ? formatCurrency(totalDebit) : '—'}
        </td>
        <td className={`text-right px-4 py-2.5 font-mono text-sm font-bold ${cfg.color}`}>
          {totalCredit > 0 ? formatCurrency(totalCredit) : '—'}
        </td>
      </tr>

      {/* Account rows */}
      {!collapsed && visible.map((acct) => (
        <AccountRow key={acct.id} account={acct} showZero={showZero} />
      ))}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function TrialBalancePage() {
  const today = new Date().toISOString().split('T')[0];

  const [asOf,     setAsOf]     = useState(today);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [showZero, setShowZero] = useState(false);
  const [search,   setSearch]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    journal.trialBalance({ asOf })
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load trial balance'))
      .finally(() => setLoading(false));
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  // Group accounts by type
  const grouped = TYPE_ORDER.reduce((acc, type) => {
    acc[type] = (data?.accounts || []).filter((a) => a.type === type);
    return acc;
  }, {});

  const totalDebit  = (data?.accounts || []).reduce((s, a) => s + Number(a.debitBalance),  0);
  const totalCredit = (data?.accounts || []).reduce((s, a) => s + Number(a.creditBalance), 0);
  const isBalanced  = Math.abs(totalDebit - totalCredit) < 0.01;
  const diff        = Math.abs(totalDebit - totalCredit);

  // Chart: total by account type
  const chartData = TYPE_ORDER.map((type) => {
    const accts = grouped[type] || [];
    const cfg = TYPE_CONFIG[type];
    const totalD = accts.reduce((s, a) => s + Number(a.debitBalance), 0);
    const totalC = accts.reduce((s, a) => s + Number(a.creditBalance), 0);
    return { name: cfg.label, debit: totalD, credit: totalC };
  });

  const accountCount = (data?.accounts || []).filter((a) => a.debitBalance > 0 || a.creditBalance > 0).length;

  const handlePrint = () => {
    const accounts = data?.accounts || [];
    const visible  = showZero ? accounts : accounts.filter((a) => a.debitBalance > 0 || a.creditBalance > 0);

    const rowsByType = TYPE_ORDER.map((type) => {
      const typeAccts = visible.filter((a) => a.accountType === type || a.type === type);
      if (!typeAccts.length) return '';
      const cfg = TYPE_CONFIG[type];
      const typeRows = typeAccts.map((a) => `
        <tr>
          <td class="mono blue small" style="width:100px">${a.accountCode}</td>
          <td>${a.accountName}</td>
          <td class="center small">${a.accountType || type}</td>
          <td class="right mono">${a.debitBalance > 0 ? phpFmt(a.debitBalance) : ''}</td>
          <td class="right mono">${a.creditBalance > 0 ? phpFmt(a.creditBalance) : ''}</td>
        </tr>`).join('');
      const subtotalDr = typeAccts.reduce((s, a) => s + Number(a.debitBalance), 0);
      const subtotalCr = typeAccts.reduce((s, a) => s + Number(a.creditBalance), 0);
      return `
        <tr class="section-row"><td colspan="5">${cfg.label}</td></tr>
        ${typeRows}
        <tr style="background:#f8faff;font-weight:600;font-size:9.5px">
          <td colspan="3" class="right gray">Subtotal — ${cfg.label}</td>
          <td class="right mono">${phpFmt(subtotalDr)}</td>
          <td class="right mono">${phpFmt(subtotalCr)}</td>
        </tr>`;
    }).join('');

    const body = `
      <div class="info-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:10px">
        <div class="info-box"><div class="info-lbl">As of Date</div><div class="info-val">${dateFmt(asOf)}</div></div>
        <div class="info-box"><div class="info-lbl">Active Accounts</div><div class="info-val">${accountCount}</div></div>
        <div class="info-box"><div class="info-lbl">Balance Status</div><div class="info-val ${isBalanced ? 'green' : 'red'}">${isBalanced ? '✓ Balanced' : `⚠ Off by ${phpFmt(diff)}`}</div></div>
      </div>
      <table>
        <thead><tr><th>Code</th><th>Account Name</th><th class="center">Type</th><th class="right">Debit (₱)</th><th class="right">Credit (₱)</th></tr></thead>
        <tbody>${rowsByType}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" class="right">GRAND TOTAL</td>
            <td class="right mono">${phpFmt(totalDebit)}</td>
            <td class="right mono">${phpFmt(totalCredit)}</td>
          </tr>
        </tfoot>
      </table>`;

    printDocument('Trial Balance', `As of ${dateFmt(asOf)}`, body);
  };

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">Trial Balance</h1>
          <p className="page-subtitle">As of {formatDate(asOf)} · {accountCount} active accounts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Print header (only shows when printing) */}
      <div className="hidden print:block text-center border-b-2 border-gray-800 pb-4 mb-4">
        <p className="text-xl font-bold">Trial Balance</p>
        <p className="text-sm text-gray-600">As of {formatDate(asOf)}</p>
      </div>

      {/* Filters */}
      <div className="card print:hidden">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="label mb-0 text-sm whitespace-nowrap">As of Date:</label>
            <input type="date" className="input w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} max={today} />
          </div>
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 text-sm" placeholder="Search account name or code..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button
            onClick={() => setShowZero(!showZero)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${showZero ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            {showZero ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            {showZero ? 'Hiding zero' : 'Show zero'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Computing trial balance...
        </div>
      ) : data ? (
        <>
          {/* Balance status banner */}
          <div className={`rounded-2xl px-5 py-3.5 flex items-center gap-3 ${isBalanced ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            {isBalanced
              ? <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              : <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            }
            <div>
              <p className={`text-sm font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
                {isBalanced ? 'Trial Balance is in Balance ✓' : 'Out of Balance — Difference Detected'}
              </p>
              <p className={`text-xs ${isBalanced ? 'text-green-500' : 'text-red-500'}`}>
                {isBalanced
                  ? `Total Debits = Total Credits = ${formatCurrency(totalDebit)}`
                  : `Difference of ${formatCurrency(diff)} — check for missing or unposted journal entries`
                }
              </p>
            </div>
            <div className="ml-auto flex gap-6 text-right">
              <div>
                <p className="text-xs text-gray-400">Total Debits</p>
                <p className="font-bold text-gray-900">{formatCurrency(totalDebit)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Credits</p>
                <p className="font-bold text-gray-900">{formatCurrency(totalCredit)}</p>
              </div>
            </div>
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 print:hidden">
            {TYPE_ORDER.map((type) => {
              const cfg   = TYPE_CONFIG[type];
              const accts = grouped[type] || [];
              const total = accts.reduce((s, a) => s + Math.max(Number(a.debitBalance), Number(a.creditBalance)), 0);
              return (
                <div key={type} className={`card p-3 border-l-4 ${cfg.border}`}>
                  <p className={`text-xs font-bold uppercase tracking-wide ${cfg.color} mb-1`}>{cfg.label}</p>
                  <p className="text-lg font-bold text-gray-900">{formatCurrency(total)}</p>
                  <p className="text-xs text-gray-400">{accts.filter((a) => a.debitBalance > 0 || a.creditBalance > 0).length} accounts</p>
                </div>
              );
            })}
          </div>

          {/* Bar chart */}
          <div className="card p-5 print:hidden">
            <p className="text-sm font-semibold text-gray-700 mb-4">Balance by Account Type</p>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="debit"  name="Debit"  fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="credit" name="Credit" fill="#a855f7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Main trial balance table */}
          <div className="card overflow-hidden print:shadow-none print:border print:border-gray-300">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-800 text-white">
                    <th className="text-left px-4 py-3 font-semibold">Account</th>
                    <th className="text-right px-4 py-3 font-semibold w-40">Debit (₱)</th>
                    <th className="text-right px-4 py-3 font-semibold w-40">Credit (₱)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {TYPE_ORDER.map((type) => (
                    <AccountGroup
                      key={type}
                      type={type}
                      accounts={grouped[type] || []}
                      showZero={showZero}
                      search={search}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`font-bold text-base ${isBalanced ? 'bg-green-50 border-t-2 border-green-400' : 'bg-red-50 border-t-2 border-red-400'}`}>
                    <td className="px-4 py-4 text-gray-800">
                      <div className="flex items-center gap-2">
                        <Scale className="w-4 h-4" />
                        TOTAL
                        {isBalanced
                          ? <span className="text-xs font-normal text-green-600 ml-2">✓ Balanced</span>
                          : <span className="text-xs font-normal text-red-600 ml-2">⚠ Difference: {formatCurrency(diff)}</span>
                        }
                      </div>
                    </td>
                    <td className={`text-right px-4 py-4 font-mono text-base ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                      {formatCurrency(totalDebit)}
                    </td>
                    <td className={`text-right px-4 py-4 font-mono text-base ${isBalanced ? 'text-green-700' : 'text-red-600'}`}>
                      {formatCurrency(totalCredit)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Abnormal balance note */}
          {(data?.accounts || []).some((a) => {
            const hasBalance = a.debitBalance > 0 || a.creditBalance > 0;
            const isNormal = a.normalBalance === 'DEBIT' ? a.debitBalance > 0 : a.creditBalance > 0;
            return hasBalance && !isNormal;
          }) && (
            <div className="card p-4 bg-amber-50 border-amber-200 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-700">
                <p className="font-semibold">Abnormal Balances Detected</p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Accounts marked with ⚠ have balances on the side opposite their normal balance. This may indicate errors in journal entries or legitimate transactions (e.g., overdraft in a bank account).
                </p>
              </div>
            </div>
          )}

          {/* Print footer */}
          <div className="hidden print:block text-center text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">
            <p>Generated on {formatDate(new Date().toISOString())} · Philippine ERP Accounting System</p>
            <p>All amounts in Philippine Peso (₱)</p>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <Scale className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No trial balance data</p>
          <p className="text-xs text-gray-400 mt-1">Post journal entries to see the trial balance</p>
        </div>
      )}
    </div>
  );
}
