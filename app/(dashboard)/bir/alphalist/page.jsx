'use client';
import { useState, useEffect, useCallback } from 'react';
import { bir } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Users, TrendingUp, RefreshCw, Download,
  Search, Info, FileText, ChevronDown, ChevronUp, Award,
  AlertCircle,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency } from '@/lib/auth';

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// Status codes per BIR 1604-C
const STATUS_CODES = {
  '1': 'New/Retrenched Employee',
  '2': 'Resigned/Separated',
  '3': 'Minimum Wage Earner',
  '4': 'Regular Employee',
  '5': 'Working Director',
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1 truncate max-w-40">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-gray-500">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Missing TIN Alert ────────────────────────────────────────
function TinAlert({ count }) {
  if (!count) return null;
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-2xl px-5 py-3.5 flex items-center gap-3">
      <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
      <div>
        <p className="text-sm font-semibold text-yellow-800">Missing TIN Numbers</p>
        <p className="text-xs text-yellow-600">
          {count} employee{count > 1 ? 's have' : ' has'} no TIN on record. BIR requires TIN for 1604-C submission. Update employee records in the Payroll → Employees page.
        </p>
      </div>
    </div>
  );
}

// ─── Employee Row ─────────────────────────────────────────────
function AlphalistRow({ emp, rank }) {
  const [open, setOpen] = useState(false);
  const effectiveRate = emp.grossCompensation > 0
    ? ((emp.totalTaxWithheld / emp.grossCompensation) * 100).toFixed(2)
    : '0.00';

  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(!open)}>
        <td className="text-gray-400 text-xs text-center">{rank}</td>
        <td>
          <div>
            <p className="font-medium text-gray-900">{emp.lastName}, {emp.firstName} {emp.middleName ? `${emp.middleName[0]}.` : ''}</p>
            <p className="text-xs text-gray-400 font-mono">{emp.employeeNo}</p>
          </div>
        </td>
        <td className="font-mono text-xs">{emp.tin || <span className="text-red-400 font-semibold">⚠ No TIN</span>}</td>
        <td className="text-xs text-gray-500">{emp.position || '—'}</td>
        <td className="text-right font-mono text-xs">{formatCurrency(emp.grossCompensation)}</td>
        <td className="text-right font-mono text-xs text-red-400">({formatCurrency(emp.totalDeductions)})</td>
        <td className="text-right font-mono text-xs">{formatCurrency(emp.taxableCompensation)}</td>
        <td className="text-right font-mono text-sm font-bold text-red-500">{formatCurrency(emp.totalTaxWithheld)}</td>
        <td className="text-center text-xs text-gray-400">{effectiveRate}%</td>
        <td className="text-center">
          {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 mx-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 mx-auto" />}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={10} className="p-0">
            <div className="bg-blue-50/40 border-t border-b border-blue-100 px-10 py-4">
              <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">Gross Pay Breakdown</p>
                  {[
                    ['Basic Salary',    formatCurrency(emp.basicSalary)],
                    ['Allowances',      formatCurrency(emp.allowances || 0)],
                    ['Overtime',        formatCurrency(emp.overtime || 0)],
                    ['13th Month Pay',  formatCurrency(emp.month13 || 0)],
                    ['Total Gross',     formatCurrency(emp.grossCompensation)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">Government Contributions (EE)</p>
                  {[
                    ['SSS',       formatCurrency(emp.sssContributions || 0)],
                    ['PhilHealth',formatCurrency(emp.philhealthContributions || 0)],
                    ['Pag-IBIG',  formatCurrency(emp.pagibigContributions || 0)],
                    ['Total',     formatCurrency(emp.totalDeductions)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium text-red-400">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">Tax Computation</p>
                  {[
                    ['Taxable Compensation', formatCurrency(emp.taxableCompensation)],
                    ['Annual Tax Due',       formatCurrency(emp.totalTaxWithheld)],
                    ['Effective Rate',       `${effectiveRate}%`],
                    ['Pay Periods',          emp.periodCount || '—'],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-500">{l}</span>
                      <span className="font-medium">{v}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">Government Numbers</p>
                  {[
                    ['BIR TIN',    emp.tin          || '— Not set'],
                    ['SSS',        emp.sssNo        || '— Not set'],
                    ['PhilHealth', emp.philhealthNo || '— Not set'],
                    ['Pag-IBIG',   emp.pagibigNo    || '— Not set'],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between py-0.5 text-xs">
                      <span className="text-gray-500">{l}</span>
                      <span className={`font-mono ${v.startsWith('—') ? 'text-red-400' : 'text-gray-700'}`}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function AlphalistPage() {
  const [year,   setYear]   = useState(CURRENT_YEAR);
  const [data,   setData]   = useState(null);
  const [loading,setLoading]= useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'gross' | 'tax'

  const load = useCallback(() => {
    setLoading(true);
    bir.alphalist({ year })
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load alphalist'))
      .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const missingTin = (data?.employees || []).filter((e) => !e.tin).length;

  const sortedEmployees = [...(data?.employees || [])]
    .filter((e) => !search ||
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
      e.employeeNo?.includes(search) ||
      e.tin?.includes(search)
    )
    .sort((a, b) => {
      if (sortBy === 'gross') return b.grossCompensation - a.grossCompensation;
      if (sortBy === 'tax')   return b.totalTaxWithheld - a.totalTaxWithheld;
      return a.lastName.localeCompare(b.lastName);
    });

  // Top 10 for chart
  const chartData = [...(data?.employees || [])]
    .sort((a, b) => b.totalTaxWithheld - a.totalTaxWithheld)
    .slice(0, 10)
    .map((e) => ({
      name: `${e.lastName.slice(0, 8)}, ${e.firstName[0]}.`,
      gross: e.grossCompensation,
      tax: e.totalTaxWithheld,
    }));

  const totalGross = (data?.employees || []).reduce((s, e) => s + Number(e.grossCompensation), 0);
  const totalTax   = (data?.employees || []).reduce((s, e) => s + Number(e.totalTaxWithheld), 0);
  const avgEffRate = totalGross > 0 ? (totalTax / totalGross * 100).toFixed(2) : '0.00';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Alphalist of Employees</h1>
          <p className="page-subtitle">BIR Form 1604-C Annex — Annual Information Return · {year}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y}>{y}</option>)}
          </select>
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 text-sm" placeholder="Search name, employee no., TIN..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['name','By Name'],['gross','By Gross'],['tax','By Tax']].map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${sortBy === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="text-xs bg-blue-50 text-blue-600 rounded-lg px-3 py-1.5 font-medium">
            {sortedEmployees.length} employee{sortedEmployees.length !== 1 ? 's' : ''} for {year}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Building alphalist...
        </div>
      ) : data ? (
        <>
          {/* TIN alert */}
          <TinAlert count={missingTin} />

          {/* KPI Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Total Employees',         value: data.employees?.length || 0, sub: 'in alphalist',               icon: Users,      color: 'text-blue-600'   },
              { label: 'Total Gross Compensation', value: formatCurrency(totalGross), sub: 'annual aggregate',             icon: TrendingUp, color: 'text-purple-600' },
              { label: 'Total Tax Withheld',       value: formatCurrency(totalTax),  sub: 'remitted to BIR',              icon: PesoSign, color: 'text-red-600'    },
              { label: 'Avg Effective Tax Rate',   value: `${avgEffRate}%`,           sub: 'across all employees',         icon: Award,      color: 'text-green-600'  },
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

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="card p-5">
              <p className="text-sm font-semibold text-gray-700 mb-4">Top 10 Employees — Gross Compensation vs. Tax Withheld ({year})</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="gross" name="Gross Compensation" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tax"   name="Tax Withheld"       fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Annex form info */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-blue-800 to-blue-900 px-6 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">BIR Form 1604-C Annex</p>
                  <p className="text-blue-200 text-sm">Annual Information Return of Compensation Taxes Withheld — Alphalist of Employees</p>
                </div>
                <div className="text-right">
                  <p className="text-blue-300 text-xs">Due Date</p>
                  <p className="text-white font-bold">January 31, {year + 1}</p>
                </div>
              </div>
            </div>
            <div className="p-5 grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                ['Total Employees',      data.employees?.length || 0],
                ['Total Gross Pay',      formatCurrency(totalGross)],
                ['Total Deductions',     formatCurrency((data.employees || []).reduce((s, e) => s + Number(e.totalDeductions || 0), 0))],
                ['Total Tax Withheld',   formatCurrency(totalTax)],
              ].map(([l, v]) => (
                <div key={l} className="text-center bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">{l}</p>
                  <p className="text-base font-bold text-gray-900">{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Main alphalist table */}
          <div className="card">
            <div className="card-header">
              <p className="text-sm font-semibold text-gray-900">Employee Alphalist — {year}</p>
              <p className="text-xs text-gray-500">Click a row to expand details</p>
            </div>
            {sortedEmployees.length > 0 ? (
              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th className="text-center w-10">#</th>
                      <th>Employee</th>
                      <th>TIN</th>
                      <th>Position</th>
                      <th className="text-right">Gross Compensation</th>
                      <th className="text-right">Deductions</th>
                      <th className="text-right">Taxable Income</th>
                      <th className="text-right text-red-500">Tax Withheld</th>
                      <th className="text-center">Eff. Rate</th>
                      <th className="text-center w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEmployees.map((emp, i) => (
                      <AlphalistRow key={emp.id} emp={emp} rank={i + 1} />
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold text-sm">
                    <tr>
                      <td colSpan={4} className="px-4 py-3 text-gray-700">TOTALS ({sortedEmployees.length} employees)</td>
                      <td className="text-right px-4 py-3 font-mono">{formatCurrency(sortedEmployees.reduce((s, e) => s + Number(e.grossCompensation), 0))}</td>
                      <td className="text-right px-4 py-3 font-mono text-red-400">({formatCurrency(sortedEmployees.reduce((s, e) => s + Number(e.totalDeductions || 0), 0))})</td>
                      <td className="text-right px-4 py-3 font-mono">{formatCurrency(sortedEmployees.reduce((s, e) => s + Number(e.taxableCompensation), 0))}</td>
                      <td className="text-right px-4 py-3 font-mono text-red-500">{formatCurrency(sortedEmployees.reduce((s, e) => s + Number(e.totalTaxWithheld), 0))}</td>
                      <td className="text-center px-4 py-3 text-gray-400">{avgEffRate}%</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="p-10 text-center text-gray-400">
                <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">{search ? 'No employees match your search' : `No payroll data for ${year}`}</p>
              </div>
            )}
          </div>

          {/* BIR submission note */}
          <div className="card p-4 bg-blue-50 border-blue-200 flex items-start gap-3">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700">
              <p className="font-semibold mb-1">Filing Reminder — 1604-C Annex</p>
              <p className="text-blue-600 text-xs">
                Submit the Annual Information Return (BIR Form 1604-C) together with this alphalist on or before January 31 of the year following the calendar year of payment. File electronically via eBIRForms or eFPS. Ensure all employees have valid TIN numbers before submission.
              </p>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No alphalist data for {year}</p>
          <p className="text-xs text-gray-400 mt-1">Approved/paid payroll periods will populate this list</p>
        </div>
      )}
    </div>
  );
}
