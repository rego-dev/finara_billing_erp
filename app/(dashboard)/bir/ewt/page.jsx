'use client';
import { useState, useEffect, useCallback } from 'react';
import { bir } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  Building2, RefreshCw, AlertCircle, ChevronDown,
  ChevronUp, FileText, Hash, Info, TrendingDown, Calendar,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';

const CURRENT_YEAR    = new Date().getFullYear();
const CURRENT_QUARTER = Math.ceil((new Date().getMonth() + 1) / 3);
const YEARS    = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const QUARTERS = [
  { label: 'Q1 (Jan–Mar)', months: '01–03' },
  { label: 'Q2 (Apr–Jun)', months: '04–06' },
  { label: 'Q3 (Jul–Sep)', months: '07–09' },
  { label: 'Q4 (Oct–Dec)', months: '10–12' },
];

// ATC Codes per BIR Revenue Regulations
const ATC_CODES = {
  WI010: { label: 'Professional/Talent Fee',          rate: 10, description: 'Individuals — 10% if >₱720K gross/yr, else 5%' },
  WI158: { label: 'Professional (Juridical)',          rate: 15, description: 'Juridical persons — professional fee' },
  WV010: { label: 'Rental of Real Property',          rate: 5,  description: 'Gross rental payments to individual lessor' },
  WC158: { label: 'Purchase of Goods',                rate: 1,  description: 'Purchases from Top 20K/Top 5K corporations' },
  WC157: { label: 'Purchase of Services',             rate: 2,  description: 'Service fees to juridical persons' },
  WI158B:{ label: 'Commission/Brokerage (Ind.)',      rate: 10, description: 'Agent/broker commissions' },
  WC200: { label: 'Income Payment > ₱10,000',         rate: 2,  description: 'General EWT on payments to suppliers' },
};

// 1601-EQ Due dates: last day of month after quarter end
function getEwtDueDate(year, quarter) {
  const quarterEndMonth = quarter * 3;
  const dueMonth = quarterEndMonth === 12 ? 1 : quarterEndMonth + 1;
  const dueYear  = quarterEndMonth === 12 ? year + 1 : year;
  return new Date(dueYear, dueMonth - 1, 31);
}

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

// ─── ATC Reference Panel ──────────────────────────────────────
function AtcReferencePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold text-gray-700">EWT ATC Code Reference</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <div className="table-wrapper">
            <table className="table text-xs">
              <thead>
                <tr><th>ATC Code</th><th>Description</th><th className="text-right">Rate</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {Object.entries(ATC_CODES).map(([code, info]) => (
                  <tr key={code}>
                    <td className="font-mono font-bold text-blue-700">{code}</td>
                    <td className="font-medium text-gray-800">{info.label}</td>
                    <td className="text-right text-red-500 font-semibold">{info.rate}%</td>
                    <td className="text-gray-400">{info.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vendor EWT Row ───────────────────────────────────────────
function VendorEwtRow({ vendor }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(!open)}>
        <td>
          <div className="flex items-center gap-2">
            {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
            <div>
              <p className="font-medium text-gray-900">{vendor.vendorName}</p>
              <p className="text-xs text-gray-400 font-mono">{vendor.vendorCode}</p>
            </div>
          </div>
        </td>
        <td className="font-mono text-xs text-gray-500">{vendor.tin || '—'}</td>
        <td className="text-center">
          <span className="badge-blue badge text-xs font-mono">{vendor.atcCode || 'WC200'}</span>
        </td>
        <td className="text-right font-mono">{formatCurrency(vendor.totalPayments)}</td>
        <td className="text-right font-mono">{formatCurrency(vendor.vatableAmount)}</td>
        <td className="text-right font-mono text-red-500 font-semibold">{formatCurrency(vendor.ewtAmount)}</td>
        <td className="text-center">
          <span className={`badge text-xs ${vendor.ewtAmount > 0 ? 'badge-red' : 'badge-gray'}`}>
            {vendor.ewtAmount > 0 ? 'Subject' : 'Exempt'}
          </span>
        </td>
      </tr>
      {open && vendor.bills && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="bg-blue-50/40 border-t border-b border-blue-100 px-10 py-3">
              <p className="text-xs font-semibold text-gray-500 mb-2">Supporting Bills</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left py-0.5">Bill No.</th>
                    <th className="text-left">Date</th>
                    <th className="text-right">Gross Amount</th>
                    <th className="text-right">EWT Rate</th>
                    <th className="text-right text-red-500">EWT Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {vendor.bills.map((b) => (
                    <tr key={b.billNo} className="border-t border-blue-100/50">
                      <td className="py-1 font-mono text-blue-600">{b.billNo}</td>
                      <td>{formatDate(b.date)}</td>
                      <td className="text-right font-mono">{formatCurrency(b.amount)}</td>
                      <td className="text-right text-gray-500">{b.ewtRate}%</td>
                      <td className="text-right font-mono text-red-500 font-semibold">{formatCurrency(b.ewtAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function EwtSummaryPage() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [quarter, setQuarter] = useState(CURRENT_QUARTER);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');

  const load = useCallback(() => {
    setLoading(true);
    bir.ewtSummary({ quarter, year })
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load EWT data'))
      .finally(() => setLoading(false));
  }, [quarter, year]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = `${QUARTERS[quarter - 1]?.label} ${year}`;
  const dueDate     = getEwtDueDate(year, quarter);

  const vendors = (data?.vendors || []).filter((v) =>
    !search || v.vendorName.toLowerCase().includes(search.toLowerCase()) || v.vendorCode?.includes(search)
  );

  // Bar chart: top vendors by EWT
  const chartData = [...(data?.vendors || [])]
    .sort((a, b) => b.ewtAmount - a.ewtAmount)
    .slice(0, 8)
    .map((v) => ({ name: v.vendorName.length > 15 ? v.vendorName.slice(0, 15) + '…' : v.vendorName, ewt: v.ewtAmount, payments: v.totalPayments }));

  // ATC breakdown
  const atcSummary = data?.vendors
    ? Object.entries(
        data.vendors.reduce((acc, v) => {
          const code = v.atcCode || 'WC200';
          if (!acc[code]) acc[code] = { count: 0, payments: 0, ewt: 0 };
          acc[code].count++;
          acc[code].payments += Number(v.totalPayments);
          acc[code].ewt += Number(v.ewtAmount);
          return acc;
        }, {})
      ).map(([code, info]) => ({ code, ...info, rate: ATC_CODES[code]?.rate || 2, label: ATC_CODES[code]?.label || code }))
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">EWT Summary</h1>
          <p className="page-subtitle">BIR Form 1601-EQ — Expanded Withholding Tax · {periodLabel}</p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
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
          <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600">
            <Calendar className="w-3.5 h-3.5" />
            Due: {formatDate(dueDate)}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading EWT data...
        </div>
      ) : data ? (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Vendors Subject to EWT', value: data.vendorCount || 0,             sub: `of ${data.totalVendors || 0} total vendors`, icon: Building2,   color: 'text-blue-600'   },
              { label: 'Total Payments Made',    value: formatCurrency(data.totalPayments), sub: 'gross amount (incl. VAT)',                   icon: PesoSign,  color: 'text-purple-600' },
              { label: 'VATable Payments',       value: formatCurrency(data.vatableAmount), sub: 'basis for EWT (excl. VAT)',                  icon: TrendingDown,color: 'text-orange-500' },
              { label: 'Total EWT to Remit',     value: formatCurrency(data.totalEwt),      sub: 'remit with 1601-EQ',                         icon: Hash,        color: 'text-red-600'    },
            ].map((s) => (
              <div key={s.label} className="card p-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color.replace('text-','bg-').replace('600','100').replace('500','100')}`}>
                  <s.icon className={`w-5 h-5 ${s.color}`} />
                </div>
                <div>
                  <p className="text-xs text-gray-500">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{typeof s.value === 'number' ? s.value : s.value}</p>
                  <p className="text-xs text-gray-400">{s.sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Top vendors bar */}
            <div className="xl:col-span-2 card p-5">
              <p className="text-sm font-semibold text-gray-700 mb-4">Top Vendors by EWT Amount</p>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="ewt" name="EWT Amount" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-center py-12 text-gray-300"><Building2 className="w-10 h-10 mx-auto mb-2" /><p className="text-sm">No EWT data</p></div>
              )}
            </div>

            {/* ATC breakdown */}
            <div className="card p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">By ATC Code</p>
              {atcSummary.length > 0 ? atcSummary.map((a) => (
                <div key={a.code} className="border border-gray-100 rounded-xl p-3 space-y-1.5">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{a.code}</span>
                      <p className="text-xs text-gray-600 mt-1">{a.label}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-500">{formatCurrency(a.ewt)}</p>
                      <p className="text-xs text-gray-400">{a.rate}% rate</p>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{a.count} vendor{a.count !== 1 ? 's' : ''}</span>
                    <span>Payments: {formatCurrency(a.payments)}</span>
                  </div>
                </div>
              )) : (
                <p className="text-sm text-gray-400 text-center py-6">No ATC data</p>
              )}
            </div>
          </div>

          {/* 1601-EQ Form summary */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-red-700 to-red-800 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">BIR Form 1601-EQ</p>
                  <p className="text-red-200 text-sm">Quarterly Remittance Return of Creditable Income Taxes Withheld (EWT)</p>
                </div>
                <div className="text-right">
                  <p className="text-red-300 text-xs">Quarter / Due Date</p>
                  <p className="text-white font-bold">{periodLabel} · {formatDate(dueDate)}</p>
                </div>
              </div>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Summary of Payments</p>
                <div className="space-y-2 text-sm">
                  {[
                    ['Total Gross Payments',       formatCurrency(data.totalPayments)],
                    ['Less: VAT Component',        `(${formatCurrency(data.totalVatComponent || 0)})`],
                    ['Net of VAT (EWT Base)',       formatCurrency(data.vatableAmount)],
                    ['No. of Payees',              data.vendorCount || 0],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Tax Computation</p>
                <div className="space-y-2 text-sm">
                  {[
                    ['Total EWT Required',      formatCurrency(data.totalEwt)],
                    ['Prior Quarter Remittance', formatCurrency(0)],
                    ['Tax Still Due',            formatCurrency(data.totalEwt)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium text-gray-900">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-4 rounded-xl bg-red-50 border border-red-200">
                  <p className="text-xs text-gray-500 mb-1">Total EWT Payable</p>
                  <p className="text-3xl font-bold text-red-600">{formatCurrency(data.totalEwt)}</p>
                  <p className="text-xs text-red-400 mt-1">Remit on or before {formatDate(dueDate)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* ATC Reference */}
          <AtcReferencePanel />

          {/* Vendor table */}
          <div className="card">
            <div className="card-header flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Vendor EWT Breakdown</p>
                <p className="text-xs text-gray-500">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</p>
              </div>
              <input className="input w-60 text-sm" placeholder="Search vendor..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {vendors.length > 0 ? (
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Vendor</th>
                      <th>TIN</th>
                      <th className="text-center">ATC</th>
                      <th className="text-right">Total Payments</th>
                      <th className="text-right">VATable Amount</th>
                      <th className="text-right text-red-500">EWT Amount</th>
                      <th className="text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendors.map((v, i) => <VendorEwtRow key={i} vendor={v} />)}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td colSpan={3} className="px-4 py-3 text-gray-700">TOTAL ({vendors.length} vendors)</td>
                      <td className="text-right px-4 py-3 font-mono">{formatCurrency(vendors.reduce((s, v) => s + Number(v.totalPayments), 0))}</td>
                      <td className="text-right px-4 py-3 font-mono">{formatCurrency(vendors.reduce((s, v) => s + Number(v.vatableAmount), 0))}</td>
                      <td className="text-right px-4 py-3 font-mono text-red-500">{formatCurrency(vendors.reduce((s, v) => s + Number(v.ewtAmount), 0))}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400">
                <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No vendors subject to EWT for this quarter</p>
                <p className="text-xs mt-1">EWT applies to bills over ₱10,000 (excluding VAT)</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No EWT data for {periodLabel}</p>
          <p className="text-xs text-gray-400 mt-1">Bills over ₱10,000 to vendors will appear here</p>
        </div>
      )}
    </div>
  );
}
