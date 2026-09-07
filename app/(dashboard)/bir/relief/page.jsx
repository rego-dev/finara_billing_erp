'use client';
import { useState, useEffect, useCallback } from 'react';
import { bir } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  FileDown, RefreshCw, Search, Filter, AlertCircle, Info,
  CheckCircle, ShoppingCart, ShoppingBag, TrendingUp, TrendingDown,
  Calendar, Download, ChevronDown, ChevronUp,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';

const CURRENT_YEAR    = new Date().getFullYear();
const CURRENT_QUARTER = Math.ceil((new Date().getMonth() + 1) / 3);
const YEARS    = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const QUARTERS = [
  { label: 'Q1 (Jan–Mar)', start: '01', end: '03', months: [1, 2, 3] },
  { label: 'Q2 (Apr–Jun)', start: '04', end: '06', months: [4, 5, 6] },
  { label: 'Q3 (Jul–Sep)', start: '07', end: '09', months: [7, 8, 9] },
  { label: 'Q4 (Oct–Dec)', start: '10', end: '12', months: [10, 11, 12] },
];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-gray-500">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── CSV Export ───────────────────────────────────────────────
function exportToCsv(data, filename) {
  const rows = [
    ['Type', 'Date', 'Reference No', 'TIN', 'Name', 'Gross Amount', 'Exempt Amount', 'Zero-Rated Amount', 'VATable Amount', 'Input/Output VAT'],
    ...(data || []).map((r) => [
      r.type, formatDate(r.date), r.reference, r.tin || '', r.name,
      r.grossAmount, r.exemptAmount || 0, r.zeroRatedAmount || 0,
      r.vatableAmount, r.vatAmount,
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Transaction Table ────────────────────────────────────────
function TransactionTable({ transactions, type }) {
  const [search, setSearch] = useState('');
  const [page,   setPage]   = useState(1);
  const PER_PAGE = 15;

  const filtered = (transactions || []).filter((t) =>
    !search ||
    t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.tin?.includes(search) ||
    t.reference?.includes(search)
  );

  const total = filtered.length;
  const pages = Math.ceil(total / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const isSales = type === 'SALES';
  const accentColor = isSales ? 'text-blue-600' : 'text-purple-600';
  const badgeClass  = isSales ? 'badge-blue' : 'badge-purple';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input className="input pl-9 text-sm" placeholder="Search name, TIN, ref no..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <span className="text-xs text-gray-400">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {paged.length > 0 ? (
        <>
          <div className="table-wrapper">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Ref No.</th>
                  <th>TIN</th>
                  <th>{isSales ? 'Customer' : 'Vendor'}</th>
                  <th className="text-right">Gross Amount</th>
                  <th className="text-right">Exempt</th>
                  <th className="text-right">Zero-Rated</th>
                  <th className="text-right">VATable</th>
                  <th className={`text-right ${accentColor}`}>{isSales ? 'Output VAT' : 'Input VAT'}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((tx, i) => (
                  <tr key={i}>
                    <td className="text-gray-400">{formatDate(tx.date)}</td>
                    <td className="font-mono text-blue-600">{tx.reference}</td>
                    <td className="font-mono">{tx.tin || <span className="text-red-400">⚠ No TIN</span>}</td>
                    <td className="font-medium text-gray-800 max-w-40 truncate">{tx.name}</td>
                    <td className="text-right font-mono">{formatCurrency(tx.grossAmount)}</td>
                    <td className="text-right font-mono text-gray-400">{formatCurrency(tx.exemptAmount || 0)}</td>
                    <td className="text-right font-mono text-green-500">{formatCurrency(tx.zeroRatedAmount || 0)}</td>
                    <td className="text-right font-mono">{formatCurrency(tx.vatableAmount)}</td>
                    <td className={`text-right font-mono font-semibold ${accentColor}`}>{formatCurrency(tx.vatAmount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-gray-700 text-xs">
                    Page {page} total ({paged.length} rows)
                  </td>
                  <td className="text-right px-3 py-2 font-mono text-xs">{formatCurrency(paged.reduce((s, t) => s + Number(t.grossAmount), 0))}</td>
                  <td className="text-right px-3 py-2 font-mono text-xs text-gray-400">{formatCurrency(paged.reduce((s, t) => s + Number(t.exemptAmount || 0), 0))}</td>
                  <td className="text-right px-3 py-2 font-mono text-xs text-green-500">{formatCurrency(paged.reduce((s, t) => s + Number(t.zeroRatedAmount || 0), 0))}</td>
                  <td className="text-right px-3 py-2 font-mono text-xs">{formatCurrency(paged.reduce((s, t) => s + Number(t.vatableAmount), 0))}</td>
                  <td className={`text-right px-3 py-2 font-mono text-xs ${accentColor}`}>{formatCurrency(paged.reduce((s, t) => s + Number(t.vatAmount), 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{total} records</span>
              <div className="flex gap-1">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">← Prev</button>
                {Array.from({ length: Math.min(pages, 5) }, (_, i) => i + 1).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`px-2.5 py-1 rounded border ${page === p ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 hover:bg-gray-50'}`}>{p}</button>
                ))}
                <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">Next →</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="py-8 text-center text-gray-400">
          <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{search ? 'No matching records' : `No ${isSales ? 'sales' : 'purchase'} transactions`}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function ReliefPage() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState(CURRENT_QUARTER);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('sales'); // 'sales' | 'purchases' | 'summary'

  const load = useCallback(() => {
    setLoading(true);
    // Backend route is /bir/relief (api.bir.reliefExport). Normalize its response
    // (invoiceDate/invoiceNo/vatableSales/outputTax) into the shape this page
    // renders (date/reference/grossAmount/vatableAmount/vatAmount).
    bir.reliefExport({ quarter, year })
      .then((r) => {
        const d = r.data || {};
        const mapSale = (s) => ({
          tin: s.tin, name: s.name,
          date: s.invoiceDate, reference: s.invoiceNo,
          vatableAmount: Number(s.vatableSales || 0),
          vatAmount: Number(s.outputTax || 0),
          grossAmount: Number(s.vatableSales || 0) + Number(s.outputTax || 0),
          exemptAmount: 0, zeroRatedAmount: 0,
        });
        const mapPurchase = (p) => ({
          tin: p.tin, name: p.name,
          date: p.invoiceDate, reference: p.invoiceNo,
          vatableAmount: Number(p.vatablePurchases || 0),
          vatAmount: Number(p.inputTax || 0),
          grossAmount: Number(p.vatablePurchases || 0) + Number(p.inputTax || 0),
          exemptAmount: 0, zeroRatedAmount: 0,
        });
        setData({
          sales: (d.sales || []).map(mapSale),
          purchases: (d.purchases || []).map(mapPurchase),
        });
      })
      .catch(() => toast.error('Failed to load RELIEF data'))
      .finally(() => setLoading(false));
  }, [quarter, year]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = `${QUARTERS[quarter - 1]?.label} ${year}`;

  const sales     = data?.sales     || [];
  const purchases = data?.purchases || [];

  const missingTinCount = [...sales, ...purchases].filter((t) => !t.tin).length;

  const totalSalesGross  = sales.reduce((s, t) => s + Number(t.grossAmount), 0);
  const totalSalesVat    = sales.reduce((s, t) => s + Number(t.vatAmount), 0);
  const totalPurchGross  = purchases.reduce((s, t) => s + Number(t.grossAmount), 0);
  const totalPurchVat    = purchases.reduce((s, t) => s + Number(t.vatAmount), 0);
  const netVat           = totalSalesVat - totalPurchVat;

  // Monthly breakdown for chart
  const qMonths = QUARTERS[quarter - 1]?.months || [];
  const chartData = qMonths.map((m) => {
    const mSales = sales.filter((t) => new Date(t.date).getMonth() + 1 === m);
    const mPurch = purchases.filter((t) => new Date(t.date).getMonth() + 1 === m);
    return {
      month: MONTH_NAMES[m - 1],
      sales:     mSales.reduce((s, t) => s + Number(t.grossAmount), 0),
      purchases: mPurch.reduce((s, t) => s + Number(t.grossAmount), 0),
    };
  });

  const handleExportSales = () => exportToCsv(sales, `RELIEF_Sales_${year}_Q${quarter}.csv`);
  const handleExportPurch = () => exportToCsv(purchases, `RELIEF_Purchases_${year}_Q${quarter}.csv`);
  const handleExportAll   = () => {
    const all = [
      ...sales.map((s) => ({ ...s, type: 'SALES' })),
      ...purchases.map((p) => ({ ...p, type: 'PURCHASES' })),
    ];
    exportToCsv(all, `RELIEF_Combined_${year}_Q${quarter}.csv`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">RELIEF Export</h1>
          <p className="page-subtitle">Reconciliation of Listing for Enforcement · Sales & Purchases · {periodLabel}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          {data && (
            <button onClick={handleExportAll} className="btn-primary">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
          <select className="select w-44" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
            {QUARTERS.map((q, i) => <option key={q.label} value={i + 1}>{q.label}</option>)}
          </select>
          <span className="text-xs bg-blue-50 text-blue-600 rounded-lg px-3 py-1.5 font-medium">
            Period: {periodLabel}
          </span>
          {data && (
            <div className="ml-auto flex gap-2">
              <button onClick={handleExportSales} className="btn-secondary btn-sm text-xs">
                <FileDown className="w-3.5 h-3.5" /> Sales CSV
              </button>
              <button onClick={handleExportPurch} className="btn-secondary btn-sm text-xs">
                <FileDown className="w-3.5 h-3.5" /> Purchases CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading RELIEF data...
        </div>
      ) : data ? (
        <>
          {/* Missing TIN warning */}
          {missingTinCount > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-5 py-3.5 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-yellow-800">{missingTinCount} Transaction{missingTinCount > 1 ? 's' : ''} with Missing TIN</p>
                <p className="text-xs text-yellow-600">BIR RELIEF requires TIN for all payees. Update vendor and customer records before submitting.</p>
              </div>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Sales Transactions',     value: sales.length,                 sub: 'invoices/receipts',      icon: ShoppingCart,  color: 'text-blue-600'   },
              { label: 'Total Purchases',              value: purchases.length,             sub: 'bills/vouchers',         icon: ShoppingBag,   color: 'text-purple-600' },
              { label: 'Gross Sales Amount',           value: formatCurrency(totalSalesGross), sub: 'incl. VAT',           icon: TrendingUp,    color: 'text-green-600'  },
              { label: 'Gross Purchase Amount',        value: formatCurrency(totalPurchGross), sub: 'incl. VAT',           icon: TrendingDown,  color: 'text-orange-500' },
            ].map((s) => (
              <div key={s.label} className="card p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color.replace('text-','bg-').replace('600','100').replace('500','100')}`}>
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-gray-400">{s.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Monthly chart */}
          <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="xl:col-span-2 card p-5">
              <p className="text-sm font-semibold text-gray-700 mb-4">Monthly Breakdown — {periodLabel}</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="sales"     name="Gross Sales"     fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="purchases" name="Gross Purchases" fill="#a855f7" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* VAT reconciliation */}
            <div className="card p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">VAT Reconciliation</p>
              <div className="space-y-2 text-sm">
                {[
                  { label: 'Gross Sales',       value: totalSalesGross,  color: 'text-blue-600'   },
                  { label: 'Output VAT',        value: totalSalesVat,    color: 'text-blue-500'   },
                  { label: 'Gross Purchases',   value: totalPurchGross,  color: 'text-purple-600' },
                  { label: 'Input VAT',         value: totalPurchVat,    color: 'text-purple-500' },
                ].map((s) => (
                  <div key={s.label} className="flex justify-between py-1.5 border-b border-gray-50">
                    <span className="text-gray-500">{s.label}</span>
                    <span className={`font-semibold ${s.color}`}>{formatCurrency(s.value)}</span>
                  </div>
                ))}
                <div className={`flex justify-between pt-2 font-bold text-base ${netVat >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  <span>Net VAT {netVat >= 0 ? 'Payable' : 'Creditable'}</span>
                  <span>{formatCurrency(Math.abs(netVat))}</span>
                </div>
              </div>
              <div className={`rounded-xl p-3 text-xs mt-2 ${netVat >= 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                {netVat >= 0
                  ? `Remit ₱${formatCurrency(netVat)} to BIR with Form 2550Q`
                  : `Excess input VAT of ${formatCurrency(Math.abs(netVat))} — carry forward`
                }
              </div>
            </div>
          </div>

          {/* RELIEF info box */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-green-700 to-emerald-700 px-6 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white font-bold text-lg">RELIEF — Summary for {periodLabel}</p>
                  <p className="text-green-200 text-sm">Reconciliation of Listing for Enforcement</p>
                </div>
                <div className="text-right">
                  <p className="text-green-300 text-xs">To be submitted with</p>
                  <p className="text-white font-semibold text-sm">VAT Return 2550Q</p>
                </div>
              </div>
            </div>
            <div className="p-5 grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <ShoppingCart className="w-3.5 h-3.5 text-blue-500" /> Schedule 1 — Sales
                </p>
                <div className="space-y-1.5 text-sm">
                  {[
                    ['No. of Transactions',     sales.length],
                    ['VATable Sales (Gross)',    formatCurrency(sales.reduce((s, t) => s + Number(t.vatableAmount || 0), 0))],
                    ['Zero-Rated Sales',        formatCurrency(sales.reduce((s, t) => s + Number(t.zeroRatedAmount || 0), 0))],
                    ['Exempt Sales',            formatCurrency(sales.reduce((s, t) => s + Number(t.exemptAmount || 0), 0))],
                    ['Total Output VAT',        formatCurrency(totalSalesVat)],
                    ['Total Gross Receipts',    formatCurrency(totalSalesGross)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-purple-500" /> Schedule 2 — Purchases
                </p>
                <div className="space-y-1.5 text-sm">
                  {[
                    ['No. of Transactions',     purchases.length],
                    ['VATable Purchases (Net)',  formatCurrency(purchases.reduce((s, t) => s + Number(t.vatableAmount || 0), 0))],
                    ['Zero-Rated Purchases',    formatCurrency(purchases.reduce((s, t) => s + Number(t.zeroRatedAmount || 0), 0))],
                    ['Exempt Purchases',        formatCurrency(purchases.reduce((s, t) => s + Number(t.exemptAmount || 0), 0))],
                    ['Total Input VAT',         formatCurrency(totalPurchVat)],
                    ['Total Gross Payments',    formatCurrency(totalPurchGross)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs: Sales | Purchases */}
          <div className="card">
            <div className="flex border-b border-gray-200 px-5">
              {[
                { key: 'sales',     label: `Sales (${sales.length})`,          icon: ShoppingCart },
                { key: 'purchases', label: `Purchases (${purchases.length})`,  icon: ShoppingBag  },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key} onClick={() => setActiveTab(key)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                    activeTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>
            <div className="p-5">
              {activeTab === 'sales'     && <TransactionTable transactions={sales}     type="SALES"     />}
              {activeTab === 'purchases' && <TransactionTable transactions={purchases} type="PURCHASES" />}
            </div>
          </div>

          {/* BIR note */}
          <div className="card p-4 bg-blue-50 border-blue-200 flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-semibold mb-1">RELIEF Submission Requirements</p>
              <p className="text-blue-600 text-xs">
                The Summary List of Sales (SLS) and Summary List of Purchases (SLP) must be submitted quarterly together with BIR Form 2550Q. All transactions must include the TIN of customers/vendors. Submit via SLSP (Summary List of Sales and Purchases) feature in eFPS or eBIRForms. The deadline is the 25th day following the close of each taxable quarter.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <FileDown className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No RELIEF data for {periodLabel}</p>
          <p className="text-xs text-gray-400 mt-1">Posted invoices and bills with VAT codes will appear here</p>
        </div>
      )}
    </div>
  );
}
