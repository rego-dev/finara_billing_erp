'use client';
import { useState, useEffect, useCallback } from 'react';
import { bir } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import {
  Users, AlertTriangle, CheckCircle, RefreshCw,
  Calendar, Clock, TrendingUp, Info, ChevronDown, ChevronUp,
  FileText, AlertCircle,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';

const CURRENT_YEAR  = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// Due date: 10th of following month (e-filing), 15th (manual)
function getDueDate(year, month) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  return new Date(nextYear, nextMonth - 1, 10);
}

function isOverdue(year, month) {
  return new Date() > getDueDate(year, month);
}

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

// ─── Period Row ───────────────────────────────────────────────
function PeriodRow({ period }) {
  const [open, setOpen] = useState(false);
  const overdue = period.status !== 'FILED' && isOverdue(period.year, period.month);
  return (
    <>
      <tr className={`cursor-pointer hover:bg-gray-50 ${overdue ? 'bg-red-50/30' : ''}`} onClick={() => setOpen(!open)}>
        <td>
          <div className="flex items-center gap-2">
            {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            <span className="font-medium">{MONTHS[period.month - 1]} {period.year}</span>
          </div>
        </td>
        <td className="text-center text-gray-600">{period.employeeCount}</td>
        <td className="text-right font-mono">{formatCurrency(period.totalCompensation)}</td>
        <td className="text-right font-mono text-red-500">{formatCurrency(period.totalTaxWithheld)}</td>
        <td>
          <span className={`badge text-xs ${
            period.status === 'FILED'   ? 'badge-green'  :
            overdue                     ? 'badge-red'    : 'badge-yellow'
          }`}>
            {period.status === 'FILED' ? 'Filed' : overdue ? 'Overdue' : 'Pending'}
          </span>
        </td>
        <td className="text-xs text-gray-400">
          {formatDate(getDueDate(period.year, period.month))}
        </td>
      </tr>
      {open && period.employees && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="bg-blue-50/40 border-t border-b border-blue-100 px-8 py-3">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500">
                    <th className="text-left py-1">Employee</th>
                    <th className="text-right">Gross Pay</th>
                    <th className="text-right">SSS</th>
                    <th className="text-right">PhilHealth</th>
                    <th className="text-right">Pag-IBIG</th>
                    <th className="text-right text-red-500">Tax Withheld</th>
                    <th className="text-right text-green-600">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {period.employees.map((emp) => (
                    <tr key={emp.id} className="border-t border-blue-100/50">
                      <td className="py-1.5">
                        <p className="font-medium text-gray-800">{emp.name}</p>
                        <p className="text-gray-400 font-mono">{emp.tin || 'No TIN'}</p>
                      </td>
                      <td className="text-right font-mono">{formatCurrency(emp.grossPay)}</td>
                      <td className="text-right font-mono text-gray-500">{formatCurrency(emp.sss)}</td>
                      <td className="text-right font-mono text-gray-500">{formatCurrency(emp.philhealth)}</td>
                      <td className="text-right font-mono text-gray-500">{formatCurrency(emp.pagibig)}</td>
                      <td className="text-right font-mono text-red-500 font-semibold">{formatCurrency(emp.taxWithheld)}</td>
                      <td className="text-right font-mono text-green-600 font-semibold">{formatCurrency(emp.netPay)}</td>
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

// ─── Penalty Estimator ────────────────────────────────────────
function PenaltyEstimator({ taxDue }) {
  const [daysLate, setDaysLate] = useState(30);
  const surcharge = taxDue * 0.25;
  const interest  = taxDue * 0.20 * (daysLate / 365);
  const compromise = Math.min(taxDue * 0.01, 25000);
  const total = surcharge + interest + compromise;
  return (
    <div className="card p-5 bg-red-50 border-red-200">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-4 h-4 text-red-500" />
        <p className="text-sm font-semibold text-red-700">Late Filing Penalty Estimator</p>
      </div>
      <div className="flex items-center gap-3 mb-4">
        <label className="label text-xs mb-0 text-red-600 whitespace-nowrap">Days Late:</label>
        <input type="range" min={1} max={365} value={daysLate} onChange={(e) => setDaysLate(Number(e.target.value))} className="flex-1 accent-red-500" />
        <span className="w-10 text-sm font-bold text-red-600">{daysLate}d</span>
      </div>
      <div className="space-y-1.5 text-sm">
        {[
          ['Tax Due (Base)',         formatCurrency(taxDue),   ''],
          ['Surcharge (25%)',        formatCurrency(surcharge), 'text-red-500'],
          [`Interest (20%/yr × ${daysLate}d)`, formatCurrency(interest), 'text-red-500'],
          ['Compromise Penalty',    formatCurrency(compromise),'text-red-500'],
        ].map(([l, v, c]) => (
          <div key={l} className="flex justify-between">
            <span className="text-gray-600">{l}</span>
            <span className={`font-medium ${c}`}>{v}</span>
          </div>
        ))}
        <div className="border-t border-red-200 pt-2 flex justify-between font-bold text-red-700 text-base">
          <span>Total Amount Due</span>
          <span>{formatCurrency(taxDue + total)}</span>
        </div>
      </div>
      <p className="text-xs text-red-400 mt-3">Estimate only. Actual penalties per NIRC Sec. 248–249.</p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function WithholdingPage() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [month,   setMonth]   = useState(CURRENT_MONTH);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPenalty, setShowPenalty] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    bir.withholdingSummary({ month, year })
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load withholding data'))
      .finally(() => setLoading(false));
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = `${MONTHS[month - 1]} ${year}`;
  const dueDate     = getDueDate(year, month);
  const overdue     = data && isOverdue(year, month);

  // Monthly trend data (all months of selected year up to current)
  const trendData = data?.monthlyTrend || [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Withholding Tax</h1>
          <p className="page-subtitle">BIR Form 1601-C — Monthly Remittance Return · {periodLabel}</p>
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
          <select className="select w-36" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium ${overdue ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'}`}>
            <Calendar className="w-3.5 h-3.5" />
            Due: {formatDate(dueDate)}
            {overdue && <AlertTriangle className="w-3.5 h-3.5" />}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading 1601-C data...
        </div>
      ) : data ? (
        <>
          {/* Overdue alert */}
          {overdue && (
            <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3.5 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">This period is overdue</p>
                <p className="text-xs text-red-500">Due date was {formatDate(dueDate)}. Late filing surcharges and interest may apply.</p>
              </div>
              <button
                onClick={() => setShowPenalty(!showPenalty)}
                className="ml-auto btn-sm bg-red-100 text-red-700 hover:bg-red-200 border-0"
              >
                Estimate Penalty
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Employees This Period', value: data.employeeCount,                      sub: 'covered by 1601-C',          icon: Users,       color: 'text-blue-600'  },
              { label: 'Total Compensation',    value: formatCurrency(data.totalCompensation),   sub: 'gross pay + allowances',     icon: TrendingUp,  color: 'text-purple-600' },
              { label: 'Total Tax Withheld',    value: formatCurrency(data.totalTaxWithheld),    sub: 'to remit to BIR',            icon: PesoSign,  color: 'text-red-600'   },
              { label: 'Total Net Pay',         value: formatCurrency(data.totalNetPay),         sub: 'disbursed to employees',     icon: CheckCircle, color: 'text-green-600'  },
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

          {/* Penalty estimator (togglable) */}
          {showPenalty && data.totalTaxWithheld > 0 && (
            <PenaltyEstimator taxDue={data.totalTaxWithheld} />
          )}

          {/* 1601-C Form box */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">BIR Form 1601-C</p>
                  <p className="text-gray-300 text-sm">Monthly Remittance Return of Creditable Income Taxes Withheld (Expanded)</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400 text-xs">Return Period</p>
                  <p className="text-white font-bold">{periodLabel}</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Part I */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Part I — Compensation Details</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ['No. of Employees',             data.employeeCount],
                      ['Total Gross Compensation',     formatCurrency(data.totalCompensation)],
                      ['Total Non-Taxable Compensation', formatCurrency(data.totalNonTaxable || 0)],
                      ['Total Taxable Compensation',   formatCurrency(data.totalTaxable || 0)],
                      ['Total SSS Contributions (EE)',  formatCurrency(data.totalSss || 0)],
                      ['Total PhilHealth (EE)',         formatCurrency(data.totalPhilhealth || 0)],
                      ['Total Pag-IBIG (EE)',           formatCurrency(data.totalPagibig || 0)],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">{l}</span>
                        <span className="font-medium text-gray-900">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Part II */}
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Part II — Tax Computation</p>
                  <div className="space-y-2 text-sm">
                    {[
                      ['Total Tax Required to be Withheld', formatCurrency(data.totalTaxWithheld)],
                      ['Tax Remitted in Prior Months',       formatCurrency(data.priorRemitted || 0)],
                      ['Tax Still Due This Period',          formatCurrency(data.totalTaxWithheld)],
                      ['Penalties (if late)',                formatCurrency(0)],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between py-1 border-b border-gray-50">
                        <span className="text-gray-500">{l}</span>
                        <span className="font-medium text-gray-900">{v}</span>
                      </div>
                    ))}
                  </div>
                  <div className={`mt-4 p-4 rounded-xl ${overdue ? 'bg-red-50 border border-red-200' : 'bg-blue-50 border border-blue-200'}`}>
                    <p className="text-xs text-gray-500 mb-1">Total Amount Payable</p>
                    <p className={`text-3xl font-bold ${overdue ? 'text-red-600' : 'text-blue-700'}`}>
                      {formatCurrency(data.totalTaxWithheld)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      Remit via AAB or eBIRForms on or before {formatDate(dueDate)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Monthly trend chart */}
          {trendData.length > 0 && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-gray-700 mb-4">Monthly Tax Withheld — {year}</p>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m) => MONTHS[m - 1]?.slice(0, 3)} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="taxWithheld" name="Tax Withheld" radius={[4, 4, 0, 0]}>
                    {trendData.map((entry, i) => (
                      <Cell key={i} fill={entry.month === month ? '#ef4444' : '#3b82f6'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Per-period breakdown table */}
          {data.periods && data.periods.length > 0 && (
            <div className="card">
              <div className="card-header">
                <p className="text-sm font-semibold text-gray-900">Payroll Periods — {periodLabel}</p>
                <p className="text-xs text-gray-500">{data.periods.length} period{data.periods.length !== 1 ? 's' : ''} processed</p>
              </div>
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Pay Period</th>
                      <th className="text-center">Employees</th>
                      <th className="text-right">Gross Compensation</th>
                      <th className="text-right text-red-500">Tax Withheld</th>
                      <th>Filing Status</th>
                      <th>Due Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.periods.map((p, i) => (
                      <PeriodRow key={i} period={p} />
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold">
                    <tr>
                      <td className="px-4 py-3 text-gray-700">TOTAL</td>
                      <td className="text-center px-4 py-3">{data.employeeCount}</td>
                      <td className="text-right px-4 py-3 font-mono">{formatCurrency(data.totalCompensation)}</td>
                      <td className="text-right px-4 py-3 font-mono text-red-500">{formatCurrency(data.totalTaxWithheld)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No payroll data for {periodLabel}</p>
          <p className="text-xs text-gray-400 mt-1">Process and approve payroll periods to populate 1601-C</p>
        </div>
      )}
    </div>
  );
}
