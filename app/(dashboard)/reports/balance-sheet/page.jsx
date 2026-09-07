'use client';
import { useState, useEffect, useCallback } from 'react';
import { journal } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Building2, Wallet, TrendingUp, Scale, RefreshCw, CheckCircle,
  AlertCircle, ChevronDown, ChevronUp, Printer, Info,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';

// ─── Config ───────────────────────────────────────────────────
const SECTION_CONFIG = {
  CURRENT_ASSETS:     { label: 'Current Assets',         color: 'text-blue-700',   bg: 'bg-blue-50',    border: 'border-blue-200',   pieColor: '#3b82f6' },
  NON_CURRENT_ASSETS: { label: 'Non-Current Assets',     color: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-200', pieColor: '#6366f1' },
  CURRENT_LIAB:       { label: 'Current Liabilities',    color: 'text-red-700',    bg: 'bg-red-50',     border: 'border-red-200',    pieColor: '#ef4444' },
  NON_CURRENT_LIAB:   { label: 'Non-Current Liabilities',color: 'text-rose-700',   bg: 'bg-rose-50',    border: 'border-rose-200',   pieColor: '#f43f5e' },
  EQUITY:             { label: 'Equity',                  color: 'text-purple-700', bg: 'bg-purple-50',  border: 'border-purple-200', pieColor: '#a855f7' },
};

// Heuristic: classify assets/liabilities as current vs. non-current by account code range
// 1000-1499 = current assets, 1500+ = non-current; 2000-2499 = current liab, 2500+ = non-current
function classifyAccounts(accounts) {
  const currentAssets    = accounts.filter((a) => a.type === 'ASSET'     && (Number(a.code) < 1500 || a.isCurrent));
  const nonCurrentAssets = accounts.filter((a) => a.type === 'ASSET'     && (Number(a.code) >= 1500 && !a.isCurrent));
  const currentLiab      = accounts.filter((a) => a.type === 'LIABILITY' && (Number(a.code) < 2500 || a.isCurrent));
  const nonCurrentLiab   = accounts.filter((a) => a.type === 'LIABILITY' && (Number(a.code) >= 2500 && !a.isCurrent));
  const equity           = accounts.filter((a) => a.type === 'EQUITY');
  return { currentAssets, nonCurrentAssets, currentLiab, nonCurrentLiab, equity };
}

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

// ─── Tooltip ──────────────────────────────────────────────────
const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{payload[0].name}</p>
      <p className="font-medium" style={{ color: payload[0].payload.pieColor }}>{formatCurrency(payload[0].value)}</p>
    </div>
  );
};

// ─── Account Section ──────────────────────────────────────────
function AccountSection({ sectionKey, accounts, startCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const cfg   = SECTION_CONFIG[sectionKey];
  const total = accounts.reduce((s, a) => s + Number(a.balance || a.debitBalance || a.creditBalance || 0), 0);

  if (accounts.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl ${cfg.bg} border ${cfg.border} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronDown className={`w-4 h-4 ${cfg.color}`} /> : <ChevronUp className={`w-4 h-4 ${cfg.color}`} />}
          <span className={`text-xs font-bold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
          <span className="badge bg-white/60 text-gray-600 text-xs">{accounts.length}</span>
        </div>
        <span className={`font-mono text-sm font-bold ${cfg.color}`}>{formatCurrency(total)}</span>
      </button>

      {!collapsed && (
        <div className="mt-0.5 divide-y divide-gray-50">
          {accounts.map((acct) => {
            const bal = Number(acct.balance || acct.debitBalance || acct.creditBalance || 0);
            return (
              <div key={acct.id} className="flex items-center justify-between py-2" style={{ paddingLeft: 40, paddingRight: 16 }}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-gray-400 w-14 flex-shrink-0">{acct.code}</span>
                  <span className="text-sm text-gray-700">{acct.name}</span>
                </div>
                <span className="font-mono text-sm text-gray-900">{formatCurrency(bal)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Balance Side (Assets or Liab+Equity) ────────────────────
function BalanceSide({ title, icon: Icon, color, sections, total }) {
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl ${color.bg} border-2 ${color.border}`}>
        <Icon className={`w-5 h-5 ${color.text}`} />
        <span className={`text-sm font-bold uppercase tracking-wide ${color.text}`}>{title}</span>
        <span className={`font-mono text-lg font-bold ml-auto ${color.text}`}>{formatCurrency(total)}</span>
      </div>
      {sections.map(({ key, accounts }) => (
        <AccountSection key={key} sectionKey={key} accounts={accounts} />
      ))}
      <div className={`flex justify-between items-center px-4 py-3 rounded-xl border-2 ${color.border} ${color.bg} font-bold`}>
        <span className={`text-sm ${color.text}`}>Total {title}</span>
        <span className={`font-mono text-base ${color.text}`}>{formatCurrency(total)}</span>
      </div>
    </div>
  );
}

// ─── Donut chart ──────────────────────────────────────────────
function CompositionChart({ data, title }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">{title}</p>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={42} outerRadius={70} paddingAngle={2} dataKey="value">
            {data.map((entry, i) => <Cell key={i} fill={entry.pieColor} />)}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.pieColor }} />
              <span className="text-gray-600 truncate max-w-28">{d.name}</span>
            </div>
            <span className="font-medium text-gray-800">{formatCurrency(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Financial Ratios ─────────────────────────────────────────
function RatioPanel({ totalAssets, totalLiab, totalEquity, currentAssets, currentLiab }) {
  const currentRatio  = currentLiab > 0 ? currentAssets / currentLiab : null;
  const debtRatio     = totalAssets  > 0 ? totalLiab   / totalAssets : null;
  const debtToEquity  = totalEquity  > 0 ? totalLiab   / totalEquity : null;
  const equityRatio   = totalAssets  > 0 ? totalEquity / totalAssets : null;

  const ratios = [
    {
      label: 'Current Ratio',
      value: currentRatio,
      format: (v) => v.toFixed(2) + 'x',
      good: (v) => v >= 2,
      warn: (v) => v >= 1,
      goodLabel: 'Healthy (≥2.0)',
      warnLabel: 'Adequate (1–2)',
      badLabel:  'Below 1 — risk',
      tip: 'Current Assets ÷ Current Liabilities. Ideal ≥ 2.0',
    },
    {
      label: 'Debt Ratio',
      value: debtRatio,
      format: (v) => (v * 100).toFixed(1) + '%',
      good: (v) => v < 0.4,
      warn: (v) => v < 0.6,
      goodLabel: 'Low leverage (<40%)',
      warnLabel: 'Moderate (40–60%)',
      badLabel:  'High leverage (>60%)',
      tip: 'Total Liabilities ÷ Total Assets',
    },
    {
      label: 'Debt-to-Equity',
      value: debtToEquity,
      format: (v) => v.toFixed(2) + 'x',
      good: (v) => v < 1,
      warn: (v) => v < 2,
      goodLabel: 'Conservative (<1x)',
      warnLabel: 'Moderate (1–2x)',
      badLabel:  'Leveraged (>2x)',
      tip: 'Total Liabilities ÷ Total Equity',
    },
    {
      label: 'Equity Ratio',
      value: equityRatio,
      format: (v) => (v * 100).toFixed(1) + '%',
      good: (v) => v > 0.6,
      warn: (v) => v > 0.4,
      goodLabel: 'Strong (>60%)',
      warnLabel: 'Adequate (40–60%)',
      badLabel:  'Low equity (<40%)',
      tip: 'Total Equity ÷ Total Assets',
    },
  ];

  return (
    <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-3">
      {ratios.map((r) => {
        if (r.value === null) return null;
        const isGood = r.good(r.value);
        const isWarn = !isGood && r.warn(r.value);
        const isBad  = !isGood && !isWarn;
        return (
          <div key={r.label} className={`card p-4 border-l-4 ${isGood ? 'border-green-400' : isWarn ? 'border-yellow-400' : 'border-red-400'}`}>
            <div className="flex items-start justify-between gap-1 mb-1">
              <p className="text-xs text-gray-500">{r.label}</p>
              <span title={r.tip} className="text-gray-300 hover:text-blue-400 cursor-help"><Info className="w-3 h-3" /></span>
            </div>
            <p className={`text-xl font-bold ${isGood ? 'text-green-600' : isWarn ? 'text-yellow-600' : 'text-red-600'}`}>
              {r.format(r.value)}
            </p>
            <p className={`text-xs mt-1 ${isGood ? 'text-green-500' : isWarn ? 'text-yellow-500' : 'text-red-500'}`}>
              {isGood ? r.goodLabel : isWarn ? r.warnLabel : r.badLabel}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function BalanceSheetPage() {
  const today = new Date().toISOString().split('T')[0];
  const [asOf,   setAsOf]   = useState(today);
  const [data,   setData]   = useState(null);
  const [loading,setLoading]= useState(false);

  const load = useCallback(() => {
    setLoading(true);
    journal.balanceSheet({ asOf })
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load balance sheet'))
      .finally(() => setLoading(false));
  }, [asOf]);

  useEffect(() => { load(); }, [load]);

  // Classify accounts
  const allAccounts = data?.accounts || [];
  const { currentAssets, nonCurrentAssets, currentLiab, nonCurrentLiab, equity } = classifyAccounts(allAccounts);

  const totalCurrentAssets    = currentAssets.reduce((s, a)    => s + Number(a.balance || a.debitBalance  || 0), 0);
  const totalNonCurrentAssets = nonCurrentAssets.reduce((s, a) => s + Number(a.balance || a.debitBalance  || 0), 0);
  const totalCurrentLiab      = currentLiab.reduce((s, a)      => s + Number(a.balance || a.creditBalance || 0), 0);
  const totalNonCurrentLiab   = nonCurrentLiab.reduce((s, a)   => s + Number(a.balance || a.creditBalance || 0), 0);
  const totalEquity           = equity.reduce((s, a)            => s + Number(a.balance || a.creditBalance || 0), 0);
  const totalAssets           = totalCurrentAssets + totalNonCurrentAssets;
  const totalLiab             = totalCurrentLiab + totalNonCurrentLiab;
  const totalLiabEquity       = totalLiab + totalEquity;
  const isBalanced            = Math.abs(totalAssets - totalLiabEquity) < 1;
  const diff                  = Math.abs(totalAssets - totalLiabEquity);

  // Pie charts
  const assetPie = [
    { name: 'Current Assets',      value: totalCurrentAssets,    pieColor: SECTION_CONFIG.CURRENT_ASSETS.pieColor },
    { name: 'Non-Current Assets',  value: totalNonCurrentAssets, pieColor: SECTION_CONFIG.NON_CURRENT_ASSETS.pieColor },
  ].filter((d) => d.value > 0);

  const liabEquityPie = [
    { name: 'Current Liabilities',     value: totalCurrentLiab,    pieColor: SECTION_CONFIG.CURRENT_LIAB.pieColor },
    { name: 'Non-Current Liabilities', value: totalNonCurrentLiab, pieColor: SECTION_CONFIG.NON_CURRENT_LIAB.pieColor },
    { name: 'Equity',                  value: totalEquity,          pieColor: SECTION_CONFIG.EQUITY.pieColor },
  ].filter((d) => d.value > 0);

  // Comparison bar
  const equationData = [
    { name: 'Assets', value: totalAssets,     fill: '#3b82f6' },
    { name: 'Liab + Equity', value: totalLiabEquity, fill: totalLiabEquity <= totalAssets ? '#22c55e' : '#ef4444' },
  ];

  const handlePrint = () => {
    const makeRows = (accts) => accts.map((a) => `
      <tr>
        <td class="mono blue small">${a.code || a.accountCode || ''}</td>
        <td>${a.name || a.accountName || ''}</td>
        <td class="right mono">${phpFmt(a.balance ?? a.debitBalance ?? a.creditBalance ?? 0)}</td>
      </tr>`).join('');

    const section = (title, accts, total, colorClass = '') => `
      <tr class="section-row"><td colspan="3">${title}</td></tr>
      ${makeRows(accts)}
      <tr style="background:#f8faff;font-weight:700;font-size:9.5px">
        <td colspan="2" class="right gray">Total ${title}</td>
        <td class="right mono ${colorClass}">${phpFmt(total)}</td>
      </tr>`;

    const body = `
      <div class="sum-row">
        <div class="sum-box"><div class="sum-lbl">Total Assets</div><div class="sum-val">${phpFmt(totalAssets)}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">Total Liabilities</div><div class="sum-val">${phpFmt(totalLiab)}</div></div>
        <div class="sum-box sum-green"><div class="sum-lbl">Total Equity</div><div class="sum-val">${phpFmt(totalEquity)}</div></div>
        <div class="sum-box ${isBalanced ? 'sum-green' : 'sum-red'}"><div class="sum-lbl">Balance Check</div><div class="sum-val">${isBalanced ? '✓ OK' : `Off ${phpFmt(diff)}`}</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px">
        <!-- ASSETS -->
        <div>
          <div class="section-title">Assets</div>
          <table>
            <thead><tr><th>Code</th><th>Account</th><th class="right">Amount (₱)</th></tr></thead>
            <tbody>
              ${section('Current Assets', currentAssets, totalCurrentAssets, 'blue')}
              ${section('Non-Current Assets', nonCurrentAssets, totalNonCurrentAssets, 'blue')}
            </tbody>
            <tfoot>
              <tr><td colspan="2" class="right">TOTAL ASSETS</td><td class="right mono blue">${phpFmt(totalAssets)}</td></tr>
            </tfoot>
          </table>
        </div>
        <!-- LIAB + EQUITY -->
        <div>
          <div class="section-title">Liabilities & Equity</div>
          <table>
            <thead><tr><th>Code</th><th>Account</th><th class="right">Amount (₱)</th></tr></thead>
            <tbody>
              ${section('Current Liabilities', currentLiab, totalCurrentLiab, 'red')}
              ${section('Non-Current Liabilities', nonCurrentLiab, totalNonCurrentLiab, 'red')}
              ${section('Equity', equity, totalEquity, 'green')}
            </tbody>
            <tfoot>
              <tr><td colspan="2" class="right">TOTAL LIAB. & EQUITY</td><td class="right mono ${isBalanced ? 'green' : 'red'}">${phpFmt(totalLiabEquity)}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="desc-box" style="margin-top:12px;font-size:8.5px;">
        Assets = Liabilities + Equity (Fundamental Accounting Equation).
        ${isBalanced ? '✓ This balance sheet is balanced.' : `⚠ Difference of ${phpFmt(diff)} detected — please review posted journal entries.`}
      </div>`;

    printDocument('Balance Sheet', `Statement of Financial Position · As of ${dateFmt(asOf)}`, body);
  };

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">Balance Sheet</h1>
          <p className="page-subtitle">Statement of Financial Position · As of {formatDate(asOf)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} disabled={!data} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block text-center border-b-2 border-gray-800 pb-4 mb-4">
        <p className="text-xl font-bold">Balance Sheet</p>
        <p className="text-sm text-gray-500">(Statement of Financial Position)</p>
        <p className="text-sm text-gray-600">As of {formatDate(asOf)}</p>
      </div>

      {/* Filter */}
      <div className="card print:hidden">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <label className="label mb-0 text-sm whitespace-nowrap">As of Date:</label>
          <input type="date" className="input w-40" value={asOf} onChange={(e) => setAsOf(e.target.value)} max={today} />
          <span className="text-xs bg-blue-50 text-blue-600 rounded-lg px-3 py-1.5 font-medium">
            As of {formatDate(asOf)}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Computing balance sheet...
        </div>
      ) : data ? (
        <>
          {/* Accounting equation banner */}
          <div className={`rounded-2xl px-5 py-3.5 flex flex-wrap items-center gap-4 ${isBalanced ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            {isBalanced
              ? <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
              : <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            }
            <div>
              <p className={`text-sm font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
                {isBalanced ? 'Accounting Equation Balances: Assets = Liabilities + Equity ✓' : 'Accounting Equation Out of Balance'}
              </p>
              {!isBalanced && <p className="text-xs text-red-500">Difference: {formatCurrency(diff)} — check for unposted entries or missing accounts</p>}
            </div>
            <div className="ml-auto flex gap-6 text-center">
              {[
                { label: 'Total Assets',    value: totalAssets,     color: 'text-blue-700'   },
                { label: '=',              value: null,             color: 'text-gray-400'   },
                { label: 'Liabilities',    value: totalLiab,        color: 'text-red-600'    },
                { label: '+',             value: null,             color: 'text-gray-400'   },
                { label: 'Equity',         value: totalEquity,      color: 'text-purple-600' },
              ].map((s, i) => (
                <div key={i}>
                  {s.value !== null ? (
                    <>
                      <p className="text-xs text-gray-400">{s.label}</p>
                      <p className={`font-bold text-sm ${s.color}`}>{formatCurrency(s.value)}</p>
                    </>
                  ) : (
                    <p className={`text-2xl font-bold ${s.color} pt-2`}>{s.label}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Summary KPIs */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
            {[
              { label: 'Total Assets',            value: formatCurrency(totalAssets),     sub: 'resources owned',        color: 'text-blue-600',   border: 'border-blue-500',   icon: Building2 },
              { label: 'Current Assets',          value: formatCurrency(totalCurrentAssets), sub: 'liquid resources',    color: 'text-blue-500',   border: 'border-blue-300',   icon: Wallet    },
              { label: 'Total Liabilities',       value: formatCurrency(totalLiab),       sub: 'obligations',            color: 'text-red-600',    border: 'border-red-500',    icon: AlertCircle },
              { label: 'Stockholders\' Equity',   value: formatCurrency(totalEquity),     sub: 'net worth',              color: 'text-purple-600', border: 'border-purple-500', icon: TrendingUp },
            ].map((s) => (
              <div key={s.label} className={`card p-4 border-l-4 ${s.border}`}>
                <div className="flex items-start gap-2">
                  <div>
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{s.sub}</p>
                  </div>
                  <s.icon className={`w-5 h-5 ml-auto ${s.color} opacity-60`} />
                </div>
              </div>
            ))}
          </div>

          {/* Financial ratios */}
          <RatioPanel
            totalAssets={totalAssets}
            totalLiab={totalLiab}
            totalEquity={totalEquity}
            currentAssets={totalCurrentAssets}
            currentLiab={totalCurrentLiab}
          />

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-4 print:hidden">
            <div className="card p-5">
              <CompositionChart data={assetPie} title="Asset Composition" />
            </div>
            <div className="card p-5">
              <CompositionChart data={liabEquityPie} title="Liabilities & Equity Mix" />
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide text-center mb-3">Accounting Equation</p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={equationData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                  <Tooltip formatter={(v) => formatCurrency(v)} />
                  <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
                    {equationData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-2 text-center">
                <span className={`text-xs font-semibold ${isBalanced ? 'text-green-600' : 'text-red-500'}`}>
                  {isBalanced ? '✓ Assets = Liabilities + Equity' : `⚠ Difference: ${formatCurrency(diff)}`}
                </span>
              </div>
            </div>
          </div>

          {/* ── Formal Balance Sheet ── */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-blue-800 to-blue-900 px-6 py-4 print:bg-blue-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">Balance Sheet</p>
                  <p className="text-blue-200 text-sm">Statement of Financial Position · As of {formatDate(asOf)}</p>
                </div>
                <div className="flex items-center gap-2 text-blue-300 text-xs">
                  <Scale className="w-4 h-4" />
                  <span>PFRS-compliant format</span>
                </div>
              </div>
            </div>

            <div className="p-6">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                {/* ASSETS */}
                <BalanceSide
                  title="Assets"
                  icon={Building2}
                  color={{ bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' }}
                  total={totalAssets}
                  sections={[
                    { key: 'CURRENT_ASSETS',     accounts: currentAssets    },
                    { key: 'NON_CURRENT_ASSETS',  accounts: nonCurrentAssets },
                  ]}
                />

                {/* LIABILITIES + EQUITY */}
                <BalanceSide
                  title="Liabilities & Equity"
                  icon={Wallet}
                  color={{ bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' }}
                  total={totalLiabEquity}
                  sections={[
                    { key: 'CURRENT_LIAB',      accounts: currentLiab     },
                    { key: 'NON_CURRENT_LIAB',  accounts: nonCurrentLiab  },
                    { key: 'EQUITY',            accounts: equity           },
                  ]}
                />
              </div>

              {/* Equation check */}
              <div className={`mt-8 p-5 rounded-2xl border-2 ${isBalanced ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {isBalanced
                      ? <CheckCircle className="w-6 h-6 text-green-500" />
                      : <AlertCircle className="w-6 h-6 text-red-500" />
                    }
                    <div>
                      <p className={`font-bold text-base ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>
                        {isBalanced ? 'Balance Sheet Balances ✓' : 'Balance Sheet Out of Balance'}
                      </p>
                      <p className={`text-xs ${isBalanced ? 'text-green-500' : 'text-red-500'}`}>
                        Assets = Liabilities + Stockholders&apos; Equity
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-6 text-center">
                    {[
                      { label: 'Total Assets',          value: totalAssets    },
                      { label: 'Total Liabilities',     value: totalLiab      },
                      { label: 'Total Equity',          value: totalEquity    },
                      { label: 'Liab + Equity',        value: totalLiabEquity },
                    ].map((s) => (
                      <div key={s.label}>
                        <p className="text-xs text-gray-400">{s.label}</p>
                        <p className="font-bold text-gray-900">{formatCurrency(s.value)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Working capital note */}
          {totalCurrentAssets > 0 && (
            <div className={`card p-4 flex items-start gap-3 ${totalCurrentAssets > totalCurrentLiab ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
              <Info className={`w-4 h-4 flex-shrink-0 mt-0.5 ${totalCurrentAssets > totalCurrentLiab ? 'text-blue-500' : 'text-red-500'}`} />
              <div className="text-sm">
                <p className={`font-semibold ${totalCurrentAssets > totalCurrentLiab ? 'text-blue-700' : 'text-red-700'}`}>
                  Working Capital: {formatCurrency(totalCurrentAssets - totalCurrentLiab)}
                </p>
                <p className={`text-xs mt-0.5 ${totalCurrentAssets > totalCurrentLiab ? 'text-blue-600' : 'text-red-500'}`}>
                  {totalCurrentAssets > totalCurrentLiab
                    ? 'Positive working capital — the company can meet its short-term obligations.'
                    : 'Negative working capital — current liabilities exceed current assets. Monitor liquidity closely.'
                  }
                </p>
              </div>
            </div>
          )}

          {/* Print footer */}
          <div className="hidden print:block text-center text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">
            <p>Generated on {formatDate(new Date().toISOString())} · Philippine ERP Accounting System</p>
            <p>All amounts in Philippine Peso (₱) · Prepared in accordance with PFRS for SMEs</p>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <Scale className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No balance sheet data</p>
          <p className="text-xs text-gray-400 mt-1">Post journal entries to populate the balance sheet</p>
        </div>
      )}
    </div>
  );
}
