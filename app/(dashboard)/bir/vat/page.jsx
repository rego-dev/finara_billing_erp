'use client';
import { useState, useEffect, useCallback } from 'react';
import { bir } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  TrendingUp, TrendingDown, AlertCircle,
  CheckCircle, FileText, Download, RefreshCw, Info,
} from 'lucide-react';
import PesoReceipt from '@/components/icons/PesoReceipt';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';

// ─── Constants ────────────────────────────────────────────────
const CURRENT_YEAR  = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const QUARTERS = ['Q1 (Jan–Mar)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Oct–Dec)'];
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

const VAT_COLORS = {
  output: '#3b82f6',
  input:  '#a855f7',
  payable:'#ef4444',
  excess: '#22c55e',
};

// ─── Tooltip ─────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-6">
          <span className="text-gray-500">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── VAT Rate Badge ───────────────────────────────────────────
const VatBadge = ({ code }) => {
  const map = {
    VAT:    { label: '12% VAT',    cls: 'badge-blue'   },
    ZERO:   { label: '0% Zero',    cls: 'badge-green'  },
    EXEMPT: { label: 'VAT-Exempt', cls: 'badge-gray'   },
  };
  const cfg = map[code] || map.VAT;
  return <span className={`badge ${cfg.cls} text-xs`}>{cfg.label}</span>;
};

// ─── Summary Stat Card ────────────────────────────────────────
const StatCard = ({ label, value, sub, icon: Icon, color, border }) => (
  <div className={`card p-4 ${border ? `border-l-4 ${border}` : ''}`}>
    <div className="flex items-start justify-between gap-2">
      <div>
        <p className="text-xs text-gray-500 mb-1">{label}</p>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {Icon && <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color.replace('text-', 'bg-').replace('600','100').replace('500','100')}`}>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>}
    </div>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────
export default function VatSummaryPage() {
  const [mode,    setMode]    = useState('month');   // 'month' | 'quarter'
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [month,   setMonth]   = useState(CURRENT_MONTH);
  const [quarter, setQuarter] = useState(Math.ceil(CURRENT_MONTH / 3));
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [chartTab, setChartTab] = useState('bar'); // 'bar' | 'pie'

  const load = useCallback(() => {
    setLoading(true);
    const params = mode === 'month'
      ? { month, year }
      : { quarter, year };
    bir.vatSummary(params)
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load VAT summary'))
      .finally(() => setLoading(false));
  }, [mode, year, month, quarter]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = mode === 'month'
    ? `${MONTHS[month - 1]} ${year}`
    : `${QUARTERS[quarter - 1]} ${year}`;

  const vatPayable = data ? Math.max(0, data.outputVat - data.inputVat) : 0;
  const excessInput = data ? Math.max(0, data.inputVat - data.outputVat) : 0;

  const barData = data ? [
    { name: 'Output VAT (Sales)',    value: data.outputVat,   fill: VAT_COLORS.output },
    { name: 'Input VAT (Purchases)', value: data.inputVat,    fill: VAT_COLORS.input  },
    { name: vatPayable > 0 ? 'VAT Payable' : 'Excess Input', value: vatPayable || excessInput, fill: vatPayable > 0 ? VAT_COLORS.payable : VAT_COLORS.excess },
  ] : [];

  const pieData = data ? [
    { name: 'VATable Sales',   value: data.vatableSales   || 0, color: '#3b82f6' },
    { name: 'Zero-Rated',      value: data.zeroRatedSales || 0, color: '#22c55e' },
    { name: 'Exempt Sales',    value: data.exemptSales    || 0, color: '#9ca3af' },
  ].filter((d) => d.value > 0) : [];

  const totalSales = data ? (data.vatableSales || 0) + (data.zeroRatedSales || 0) + (data.exemptSales || 0) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">VAT Summary</h1>
          <p className="page-subtitle">BIR Form 2550M (Monthly) / 2550Q (Quarterly) · {periodLabel}</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['month', 'Monthly (2550M)'], ['quarter', 'Quarterly (2550Q)']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`px-4 py-2 text-xs font-medium transition-colors ${mode === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {l}
              </button>
            ))}
          </div>
          <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
          {mode === 'month' ? (
            <select className="select w-36" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          ) : (
            <select className="select w-44" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {QUARTERS.map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
            </select>
          )}
          <span className="text-xs text-gray-400 bg-blue-50 text-blue-600 rounded-lg px-3 py-1.5 font-medium">
            Period: {periodLabel}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading VAT data...
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Sales (Net of VAT)" value={formatCurrency(data.totalSalesNet || 0)} sub="VATable + Zero + Exempt" icon={TrendingUp} color="text-blue-600" border="border-blue-500" />
            <StatCard label="Output VAT Collected"    value={formatCurrency(data.outputVat)}    sub="12% on VATable sales"  icon={PesoSign}   color="text-purple-600" border="border-purple-500" />
            <StatCard label="Input VAT (Purchases)"   value={formatCurrency(data.inputVat)}     sub="12% on VATable purchases" icon={TrendingDown} color="text-orange-500" border="border-orange-400" />
            {vatPayable > 0 ? (
              <StatCard label="VAT Payable to BIR" value={formatCurrency(vatPayable)} sub="Output − Input" icon={AlertCircle} color="text-red-600" border="border-red-500" />
            ) : (
              <StatCard label="Excess Input VAT" value={formatCurrency(excessInput)} sub="Carry forward to next period" icon={CheckCircle} color="text-green-600" border="border-green-500" />
            )}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Bar chart */}
            <div className="xl:col-span-2 card p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700">Output vs. Input VAT</p>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {[['bar', 'Bar'], ['pie', 'Pie']].map(([k, l]) => (
                    <button key={k} onClick={() => setChartTab(k)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${chartTab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {chartTab === 'bar' ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {barData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3} dataKey="value">
                      {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Legend formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Sales composition */}
            <div className="card p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Sales Composition</p>
              {[
                { label: 'VATable Sales (12%)', value: data.vatableSales || 0,   color: 'bg-blue-500'  },
                { label: 'Zero-Rated (0%)',     value: data.zeroRatedSales || 0, color: 'bg-green-500' },
                { label: 'Exempt',              value: data.exemptSales || 0,    color: 'bg-gray-400'  },
              ].map((s) => {
                const pct = totalSales > 0 ? (s.value / totalSales) * 100 : 0;
                return (
                  <div key={s.label} className="space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${s.color}`} />
                        <span className="text-gray-600">{s.label}</span>
                      </div>
                      <span className="font-semibold text-gray-800">{formatCurrency(s.value)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className={`${s.color} h-1.5 rounded-full`} style={{ width: `${pct.toFixed(1)}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 text-right">{pct.toFixed(1)}% of total sales</p>
                  </div>
                );
              })}
              <div className="border-t border-gray-100 pt-3">
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-gray-700">Total Gross Sales</span>
                  <span className="text-gray-900">{formatCurrency(totalSales)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 2550 Filing Summary Box */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-blue-700 to-blue-800 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">BIR Form {mode === 'month' ? '2550M' : '2550Q'} Summary</p>
                  <p className="text-blue-200 text-sm">{periodLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-blue-200 text-xs">Due Date</p>
                  <p className="text-white font-semibold text-sm">
                    {mode === 'month' ? '20th of following month' : '25th of month after quarter'}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Output VAT */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Part A — Output VAT</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ['VATable Sales (Gross)',    formatCurrency(data.vatableSales || 0)],
                      ['Output VAT (12%)',          formatCurrency(data.outputVat)],
                      ['Zero-Rated Sales',          formatCurrency(data.zeroRatedSales || 0)],
                      ['Exempt Sales',              formatCurrency(data.exemptSales || 0)],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-medium text-gray-900">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Input VAT */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Part B — Input VAT</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ['VATable Purchases (Gross)', formatCurrency(data.vatablePurchases || 0)],
                      ['Input VAT (12%)',            formatCurrency(data.inputVat)],
                      ['Prior Period Excess Input',  formatCurrency(data.priorExcessInput || 0)],
                      ['Total Available Input',      formatCurrency((data.inputVat || 0) + (data.priorExcessInput || 0))],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">{label}</span>
                        <span className="font-medium text-gray-900">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Net VAT */}
              <div className={`mt-5 p-4 rounded-2xl border-2 ${vatPayable > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {vatPayable > 0
                      ? <AlertCircle className="w-5 h-5 text-red-500" />
                      : <CheckCircle className="w-5 h-5 text-green-500" />
                    }
                    <div>
                      <p className={`font-bold text-base ${vatPayable > 0 ? 'text-red-700' : 'text-green-700'}`}>
                        {vatPayable > 0 ? 'VAT Payable' : 'Excess Input VAT'}
                      </p>
                      <p className={`text-xs ${vatPayable > 0 ? 'text-red-500' : 'text-green-500'}`}>
                        {vatPayable > 0 ? 'Remit to BIR on or before due date' : 'Carry forward to next period as creditable input'}
                      </p>
                    </div>
                  </div>
                  <p className={`text-2xl font-bold ${vatPayable > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(vatPayable || excessInput)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Invoice/Bill detail table */}
          {data.transactions && data.transactions.length > 0 && (
            <div className="card">
              <div className="card-header flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Supporting Transactions</p>
                  <p className="text-xs text-gray-500">{data.transactions.length} record{data.transactions.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Date</th><th>Reference</th><th>Party</th>
                      <th>Type</th><th className="text-right">Net Amount</th>
                      <th className="text-right">VAT</th><th className="text-right">Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.transactions.map((tx, i) => (
                      <tr key={i}>
                        <td className="text-gray-500 text-xs">{formatDate(tx.date)}</td>
                        <td className="font-mono text-xs text-blue-600">{tx.reference}</td>
                        <td className="text-gray-700">{tx.party}</td>
                        <td>
                          <span className={`badge text-xs ${tx.type === 'SALE' ? 'badge-blue' : 'badge-purple'}`}>{tx.type}</span>
                          <VatBadge code={tx.vatCode} />
                        </td>
                        <td className="text-right font-mono text-xs">{formatCurrency(tx.netAmount)}</td>
                        <td className="text-right font-mono text-xs text-purple-600">{formatCurrency(tx.vatAmount)}</td>
                        <td className="text-right font-mono text-xs font-medium">{formatCurrency(tx.grossAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card p-12 text-center">
          <PesoReceipt className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No VAT data for {periodLabel}</p>
          <p className="text-xs text-gray-400 mt-1">Post invoices and bills with VAT codes to see data here</p>
        </div>
      )}
    </div>
  );
}
