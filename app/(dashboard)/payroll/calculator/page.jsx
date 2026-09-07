'use client';
import { useState, useMemo, useCallback } from 'react';
import { Calculator, Info, TrendingUp, RefreshCw, ChevronDown, ChevronUp, Award } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';

// ─── Philippine Compliance (client-side mirror) ───────────────
const SSS_TABLE = [
  { min: 0,     max: 3249.99,  msc: 3000,  ee: 135,  er: 270  },
  { min: 3250,  max: 3749.99,  msc: 3500,  ee: 157.50, er: 315 },
  { min: 3750,  max: 4249.99,  msc: 4000,  ee: 180,  er: 360  },
  { min: 4250,  max: 4749.99,  msc: 4500,  ee: 202.50, er: 405 },
  { min: 4750,  max: 5249.99,  msc: 5000,  ee: 225,  er: 450  },
  { min: 5250,  max: 5749.99,  msc: 5500,  ee: 247.50, er: 495 },
  { min: 5750,  max: 6249.99,  msc: 6000,  ee: 270,  er: 540  },
  { min: 6250,  max: 6749.99,  msc: 6500,  ee: 292.50, er: 585 },
  { min: 6750,  max: 7249.99,  msc: 7000,  ee: 315,  er: 630  },
  { min: 7250,  max: 7749.99,  msc: 7500,  ee: 337.50, er: 675 },
  { min: 7750,  max: 8249.99,  msc: 8000,  ee: 360,  er: 720  },
  { min: 8250,  max: 8749.99,  msc: 8500,  ee: 382.50, er: 765 },
  { min: 8750,  max: 9249.99,  msc: 9000,  ee: 405,  er: 810  },
  { min: 9250,  max: 9749.99,  msc: 9500,  ee: 427.50, er: 855 },
  { min: 9750,  max: 10249.99, msc: 10000, ee: 450,  er: 900  },
  { min: 10250, max: 10749.99, msc: 10500, ee: 472.50, er: 945 },
  { min: 10750, max: 11249.99, msc: 11000, ee: 495,  er: 990  },
  { min: 11250, max: 11749.99, msc: 11500, ee: 517.50, er: 1035 },
  { min: 11750, max: 12249.99, msc: 12000, ee: 540,  er: 1080 },
  { min: 12250, max: 12749.99, msc: 12500, ee: 562.50, er: 1125 },
  { min: 12750, max: 13249.99, msc: 13000, ee: 585,  er: 1170 },
  { min: 13250, max: 13749.99, msc: 13500, ee: 607.50, er: 1215 },
  { min: 13750, max: 14249.99, msc: 14000, ee: 630,  er: 1260 },
  { min: 14250, max: 14749.99, msc: 14500, ee: 652.50, er: 1305 },
  { min: 14750, max: 15249.99, msc: 15000, ee: 675,  er: 1350 },
  { min: 15250, max: 15749.99, msc: 15500, ee: 697.50, er: 1395 },
  { min: 15750, max: 16249.99, msc: 16000, ee: 720,  er: 1440 },
  { min: 16250, max: 16749.99, msc: 16500, ee: 742.50, er: 1485 },
  { min: 16750, max: 17249.99, msc: 17000, ee: 765,  er: 1530 },
  { min: 17250, max: 17749.99, msc: 17500, ee: 787.50, er: 1575 },
  { min: 17750, max: 18249.99, msc: 18000, ee: 810,  er: 1620 },
  { min: 18250, max: 18749.99, msc: 18500, ee: 832.50, er: 1665 },
  { min: 18750, max: 19249.99, msc: 19000, ee: 855,  er: 1710 },
  { min: 19250, max: 19749.99, msc: 19500, ee: 877.50, er: 1755 },
  { min: 19750, max: Infinity,  msc: 20000, ee: 900,  er: 1800 },
];

function computeSSS(salary) {
  const row = SSS_TABLE.find((r) => salary >= r.min && salary <= r.max) || SSS_TABLE[SSS_TABLE.length - 1];
  return { ee: row.ee, er: row.er, total: row.ee + row.er, msc: row.msc };
}

function computePhilHealth(salary) {
  const base = Math.min(Math.max(salary, 10000), 100000);
  const total = base * 0.05;
  const half  = total / 2;
  return { ee: half, er: half, total, rate: 5 };
}

function computePagIBIG(salary) {
  const rate = salary <= 1500 ? 0.01 : 0.02;
  const base = Math.min(salary, 5000);
  const ee   = Math.min(base * rate, 100);
  const er   = Math.min(base * 0.02, 100);
  return { ee, er, total: ee + er };
}

const TAX_BRACKETS = [
  { min: 0,        max: 250000,   base: 0,       rate: 0    },
  { min: 250000,   max: 400000,   base: 0,       rate: 0.15 },
  { min: 400000,   max: 800000,   base: 22500,   rate: 0.20 },
  { min: 800000,   max: 2000000,  base: 102500,  rate: 0.25 },
  { min: 2000000,  max: 8000000,  base: 402500,  rate: 0.30 },
  { min: 8000000,  max: Infinity, base: 2202500, rate: 0.35 },
];

function computeAnnualTax(annual) {
  const bracket = TAX_BRACKETS.find((b) => annual > b.min && annual <= b.max) || TAX_BRACKETS[TAX_BRACKETS.length - 1];
  return bracket.base + (annual - bracket.min) * bracket.rate;
}

function computeWithholdingTax(grossMonthly, monthlyDeductions, frequency) {
  const periodsPerYear = frequency === 'MONTHLY' ? 12 : frequency === 'SEMI_MONTHLY' ? 24 : 52;
  const annualGross = grossMonthly * 12;
  const annualDeductions = monthlyDeductions * 12;
  const taxable = Math.max(0, annualGross - annualDeductions);
  const annualTax = computeAnnualTax(taxable);
  return annualTax / periodsPerYear;
}

function computeAll(salary, allowances, overtimePay, frequency) {
  if (!salary || salary <= 0) return null;

  const gross = Number(salary) + Number(allowances || 0) + Number(overtimePay || 0);
  const sss  = computeSSS(salary);
  const ph   = computePhilHealth(salary);
  const pi   = computePagIBIG(salary);

  const monthlyDeductions = sss.ee + ph.ee + pi.ee;
  const tax   = computeWithholdingTax(gross, monthlyDeductions, frequency);
  const totalDeductions = monthlyDeductions + tax;

  const periodsPerYear = frequency === 'MONTHLY' ? 12 : frequency === 'SEMI_MONTHLY' ? 24 : 52;
  const grossPerPeriod = gross / (periodsPerYear / 12);
  const netPerPeriod   = grossPerPeriod - (monthlyDeductions / (periodsPerYear / 12)) - tax;

  const annualGross = gross * 12;
  const annualNet   = annualGross - (monthlyDeductions + tax) * 12;
  const month13     = salary; // Basic monthly salary

  const annualTaxable = Math.max(0, annualGross - monthlyDeductions * 12);
  const annualTax     = computeAnnualTax(annualTaxable);

  return {
    basicSalary: Number(salary), allowances: Number(allowances || 0), overtimePay: Number(overtimePay || 0),
    grossMonthly: gross, grossPerPeriod,
    sss, ph, pi,
    monthlyDeductions,
    taxPerPeriod: tax,
    totalDeductionsPerPeriod: monthlyDeductions / (periodsPerYear / 12) + tax,
    netPerPeriod,
    netMonthly: gross - totalDeductions,
    annualGross, annualNet, annualTax,
    month13,
    employerCost: gross + sss.er + ph.er + pi.er,
    effectiveTaxRate: annualGross > 0 ? (annualTax / annualGross) * 100 : 0,
    periodsPerYear,
  };
}

// ─── Donut Chart ──────────────────────────────────────────────
function DonutChart({ segments, centerLabel, centerSub }) {
  const total = segments.reduce((s, sg) => s + sg.value, 0);
  if (!total) return null;

  let cumulative = 0;
  const R = 56, CX = 70, CY = 70, strokeW = 18;
  const circumference = 2 * Math.PI * R;

  return (
    <svg viewBox="0 0 140 140" className="w-32 h-32">
      {segments.map((sg, i) => {
        const pct = sg.value / total;
        const offset = circumference - pct * circumference;
        const rotation = (cumulative / total) * 360 - 90;
        cumulative += sg.value;
        return (
          <circle
            key={i}
            cx={CX} cy={CY} r={R}
            fill="none" stroke={sg.color} strokeWidth={strokeW}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={offset}
            strokeLinecap="butt"
            transform={`rotate(${rotation} ${CX} ${CY})`}
          />
        );
      })}
      <text x={CX} y={CY - 6} textAnchor="middle" className="fill-gray-900 font-bold" style={{ fontSize: 10 }}>{centerLabel}</text>
      <text x={CX} y={CY + 8} textAnchor="middle" className="fill-gray-500" style={{ fontSize: 7.5 }}>{centerSub}</text>
    </svg>
  );
}

// ─── Info Tooltip ─────────────────────────────────────────────
function InfoTip({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)} className="text-gray-400 hover:text-blue-500">
        <Info className="w-3.5 h-3.5" />
      </button>
      {show && (
        <div className="absolute z-30 bottom-full mb-1.5 left-1/2 -translate-x-1/2 w-56 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </span>
  );
}

// ─── Comparison Table ─────────────────────────────────────────
function FrequencyComparisonTable({ salary, allowances }) {
  if (!salary || salary <= 0) return null;
  const rows = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'].map((freq) => {
    const r = computeAll(salary, allowances, 0, freq);
    const periods = freq === 'MONTHLY' ? 12 : freq === 'SEMI_MONTHLY' ? 24 : 52;
    return {
      label: freq === 'MONTHLY' ? 'Monthly' : freq === 'SEMI_MONTHLY' ? 'Semi-Monthly' : 'Weekly',
      periods,
      grossPerPeriod: r.grossPerPeriod,
      netPerPeriod: r.netPerPeriod,
      taxPerPeriod: r.taxPerPeriod,
      annualTax: r.annualTax,
      netMonthly: r.netMonthly,
    };
  });

  return (
    <div className="overflow-x-auto">
      <table className="table text-sm">
        <thead>
          <tr>
            <th>Frequency</th>
            <th className="text-center">Periods/yr</th>
            <th className="text-right">Gross / Period</th>
            <th className="text-right">Tax / Period</th>
            <th className="text-right text-green-600">Net / Period</th>
            <th className="text-right">Annual Tax</th>
            <th className="text-right">Monthly Net</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="font-medium">{r.label}</td>
              <td className="text-center text-gray-500">{r.periods}×</td>
              <td className="text-right font-mono">{formatCurrency(r.grossPerPeriod)}</td>
              <td className="text-right font-mono text-red-500">({formatCurrency(r.taxPerPeriod)})</td>
              <td className="text-right font-mono font-bold text-green-600">{formatCurrency(r.netPerPeriod)}</td>
              <td className="text-right font-mono text-red-500">({formatCurrency(r.annualTax)})</td>
              <td className="text-right font-mono">{formatCurrency(r.netMonthly)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tax bracket explainer ────────────────────────────────────
function TaxBracketPanel({ annualTaxable }) {
  return (
    <div className="space-y-1.5">
      {TAX_BRACKETS.filter((b) => b.rate > 0).map((b) => {
        const inBracket = annualTaxable > b.min;
        const taxable   = inBracket ? Math.min(annualTaxable, b.max) - b.min : 0;
        const contribution = taxable * b.rate;
        const maxBracket = b.max === Infinity ? '8M+' : `₱${(b.max / 1000).toFixed(0)}K`;
        return (
          <div key={b.min} className={`flex items-center gap-3 p-2.5 rounded-lg text-xs transition-colors ${inBracket ? 'bg-blue-50 border border-blue-100' : 'bg-gray-50 opacity-50'}`}>
            <div className="flex-1">
              <span className="font-medium text-gray-700">
                ₱{(b.min / 1000).toFixed(0)}K – {maxBracket}
              </span>
              <span className="ml-2 text-gray-500">@ {(b.rate * 100).toFixed(0)}%</span>
            </div>
            <div className="text-right">
              <span className={`font-semibold ${inBracket && contribution > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {formatCurrency(contribution)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Calculator Page ─────────────────────────────────────
export default function CalculatorPage() {
  const [salary,     setSalary]     = useState('');
  const [allowances, setAllowances] = useState('');
  const [overtime,   setOvertime]   = useState('');
  const [frequency,  setFrequency]  = useState('SEMI_MONTHLY');
  const [showBrackets, setShowBrackets] = useState(false);

  const result = useMemo(
    () => computeAll(salary, allowances, overtime, frequency),
    [salary, allowances, overtime, frequency]
  );

  const reset = () => { setSalary(''); setAllowances(''); setOvertime(''); };

  const annualTaxable = result
    ? Math.max(0, result.annualGross - result.monthlyDeductions * 12)
    : 0;

  const QUICK_SALARIES = [15000, 25000, 35000, 50000, 75000, 100000];
  const FREQ_LABELS = { MONTHLY: 'Monthly', SEMI_MONTHLY: 'Semi-Monthly', WEEKLY: 'Weekly' };

  const donutSegments = result
    ? [
        { color: '#22c55e', value: result.netPerPeriod, label: 'Net Pay' },
        { color: '#ef4444', value: result.taxPerPeriod, label: 'Tax' },
        { color: '#3b82f6', value: result.sss.ee / (result.periodsPerYear / 12), label: 'SSS' },
        { color: '#a855f7', value: result.ph.ee  / (result.periodsPerYear / 12), label: 'PhilHealth' },
        { color: '#f97316', value: result.pi.ee  / (result.periodsPerYear / 12), label: 'Pag-IBIG' },
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Calculator</h1>
          <p className="page-subtitle">Philippine TRAIN Law · SSS 2024 · PhilHealth 5% · Pag-IBIG</p>
        </div>
        {salary && (
          <button onClick={reset} className="btn-secondary">
            <RefreshCw className="w-4 h-4" /> Reset
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-5">

        {/* ── Left: Input Panel ── */}
        <div className="space-y-4">
          <div className="card p-5 space-y-4">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Calculator className="w-4 h-4 text-blue-600" /> Employee Compensation
            </p>

            {/* Quick salary picks */}
            <div>
              <p className="label mb-2">Quick Pick (Basic Salary)</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_SALARIES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setSalary(s)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      Number(salary) === s
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-200 text-gray-600 hover:border-blue-300'
                    }`}
                  >
                    {s >= 1000 ? `₱${s / 1000}K` : `₱${s}`}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="label">
                Basic Monthly Salary (₱) *
                <InfoTip text="Gross monthly salary before any deductions. Used as basis for SSS, PhilHealth, and Pag-IBIG." />
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₱</span>
                <input
                  type="number" min="0" step="100"
                  className="input pl-7 text-lg font-semibold"
                  value={salary} onChange={(e) => setSalary(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">
                Non-Taxable Allowances (₱)
                <InfoTip text="De minimis benefits and allowances excluded from taxable income (e.g. meal, transportation, ₱90K annual threshold)." />
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₱</span>
                <input
                  type="number" min="0" step="50"
                  className="input pl-7"
                  value={allowances} onChange={(e) => setAllowances(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">
                Overtime Pay (₱)
                <InfoTip text="Additional pay for overtime work. Included in gross; taxable." />
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">₱</span>
                <input
                  type="number" min="0" step="50"
                  className="input pl-7"
                  value={overtime} onChange={(e) => setOvertime(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Pay Frequency</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {Object.entries(FREQ_LABELS).map(([key, label]) => (
                  <button
                    key={key} type="button"
                    onClick={() => setFrequency(key)}
                    className={`p-2.5 rounded-xl border-2 text-center text-xs font-semibold transition-all ${
                      frequency === key ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-blue-200'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Statutory notes */}
          <div className="card p-4 bg-yellow-50 border-yellow-200 space-y-2 text-xs text-yellow-800">
            <p className="font-semibold">Philippine Statutory Rates Applied</p>
            <ul className="space-y-1 text-yellow-700">
              <li>• SSS: 2024 contribution table (EE 4.5%)</li>
              <li>• PhilHealth: 5% of salary (₱10K–₱100K range)</li>
              <li>• Pag-IBIG: 1–2% (max ₱100 EE)</li>
              <li>• Income Tax: TRAIN Law 2023+ brackets</li>
            </ul>
          </div>
        </div>

        {/* ── Middle: Results ── */}
        <div className="space-y-4">
          {!result ? (
            <div className="card p-12 text-center">
              <Calculator className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">Enter a salary to compute</p>
              <p className="text-sm text-gray-300 mt-1">Results will appear here</p>
            </div>
          ) : (
            <>
              {/* Net Pay Hero */}
              <div className="card p-5 bg-gradient-to-br from-blue-700 to-indigo-700 text-white">
                <div className="flex items-center gap-4">
                  <DonutChart
                    segments={donutSegments}
                    centerLabel={formatCurrency(result.netPerPeriod).replace('₱', '₱')}
                    centerSub="net pay"
                  />
                  <div className="flex-1">
                    <p className="text-blue-200 text-xs font-semibold uppercase tracking-wide mb-0.5">
                      Per {FREQ_LABELS[frequency]} Period
                    </p>
                    <p className="text-3xl font-bold">{formatCurrency(result.netPerPeriod)}</p>
                    <p className="text-blue-200 text-sm mt-0.5">
                      Gross: {formatCurrency(result.grossPerPeriod)}
                    </p>
                    <div className="flex gap-2 mt-2 text-xs">
                      {donutSegments.slice(1).map((s) => (
                        <span key={s.label} className="flex items-center gap-1 text-white/70">
                          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Deductions breakdown */}
              <div className="card p-5 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Monthly Deductions (EE)</p>

                {/* Income breakdown */}
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-gray-600 font-medium py-1.5 border-b border-gray-100">
                    <span>Gross Monthly Pay</span>
                    <span className="font-bold text-gray-900">{formatCurrency(result.grossMonthly)}</span>
                  </div>
                  {[
                    {
                      label: 'SSS Contribution', value: result.sss.ee,
                      tip: `MSC: ₱${result.sss.msc.toLocaleString()} · EE: ${formatCurrency(result.sss.ee)} · ER: ${formatCurrency(result.sss.er)}`,
                      color: 'bg-blue-100 text-blue-700',
                    },
                    {
                      label: 'PhilHealth Premium', value: result.ph.ee,
                      tip: `5% of salary, split equally. EE: ${formatCurrency(result.ph.ee)} · ER: ${formatCurrency(result.ph.er)}`,
                      color: 'bg-purple-100 text-purple-700',
                    },
                    {
                      label: 'Pag-IBIG / HDMF', value: result.pi.ee,
                      tip: `2% of salary (max ₱100). EE: ${formatCurrency(result.pi.ee)} · ER: ${formatCurrency(result.pi.er)}`,
                      color: 'bg-orange-100 text-orange-700',
                    },
                  ].map((d) => (
                    <div key={d.label} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-5 rounded-full ${d.color.split(' ')[0]}`} />
                        <span className="text-gray-600">{d.label}</span>
                        <InfoTip text={d.tip} />
                      </div>
                      <span className="text-red-500 font-medium">({formatCurrency(d.value)})</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-5 rounded-full bg-red-100" />
                      <span className="text-gray-600">Withholding Tax</span>
                      <InfoTip text={`TRAIN Law bracket. Annual taxable: ${formatCurrency(annualTaxable)}. Per period tax: ${formatCurrency(result.taxPerPeriod)}.`} />
                    </div>
                    <span className="text-red-500 font-medium">({formatCurrency(result.taxPerPeriod)})</span>
                  </div>
                  <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
                    <span>Net Monthly Take-Home</span>
                    <span className="text-green-600">{formatCurrency(result.netMonthly)}</span>
                  </div>
                </div>
              </div>

              {/* Effective rate */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600">Effective Tax Rate</span>
                  <span className="text-lg font-bold text-gray-900">{result.effectiveTaxRate.toFixed(2)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-blue-500 to-red-400 h-2 rounded-full transition-all"
                    style={{ width: `${Math.min(result.effectiveTaxRate, 35)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span><span>35% (max TRAIN Law rate)</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Right: Annual & Employer ── */}
        <div className="space-y-4">
          {result ? (
            <>
              {/* Annual projection */}
              <div className="card p-5 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-green-500" /> Annual Projection
                </p>
                <div className="space-y-2 text-sm">
                  {[
                    { label: 'Annual Gross Income', value: result.annualGross, bold: false },
                    { label: 'SSS (EE, annual)',    value: result.sss.ee * 12, red: true },
                    { label: 'PhilHealth (EE, annual)', value: result.ph.ee * 12, red: true },
                    { label: 'Pag-IBIG (EE, annual)',   value: result.pi.ee * 12, red: true },
                    { label: 'Annual Taxable Income',   value: annualTaxable, bold: false },
                    { label: 'Annual Income Tax',       value: result.annualTax, red: true, bold: true },
                    { label: 'Annual Net Take-Home',    value: result.annualNet, green: true, bold: true },
                  ].map((r) => (
                    <div key={r.label} className={`flex justify-between py-1.5 ${r.bold ? 'border-t border-gray-100' : ''}`}>
                      <span className="text-gray-500">{r.label}</span>
                      <span className={`font-semibold ${r.green ? 'text-green-600 text-base' : r.red ? 'text-red-500' : 'text-gray-900'}`}>
                        {r.red ? `(${formatCurrency(r.value)})` : formatCurrency(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 13th month */}
              <div className="card p-5 bg-green-50 border-green-200">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                    <Award className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-xs text-green-600 font-semibold uppercase tracking-wide">13th Month Pay</p>
                    <p className="text-2xl font-bold text-green-700">{formatCurrency(result.month13)}</p>
                    <p className="text-xs text-green-600 mt-0.5">= 1 month basic salary · tax-exempt up to ₱90,000</p>
                  </div>
                </div>
              </div>

              {/* Employer cost */}
              <div className="card p-5 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Employer Cost / Month</p>
                <div className="space-y-1.5 text-sm">
                  {[
                    { label: 'Gross Salary',   value: result.grossMonthly },
                    { label: 'SSS (ER)',        value: result.sss.er,  red: true },
                    { label: 'PhilHealth (ER)', value: result.ph.er,   red: true },
                    { label: 'Pag-IBIG (ER)',   value: result.pi.er,   red: true },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between py-1">
                      <span className="text-gray-500">{r.label}</span>
                      <span className={r.red ? 'text-red-500' : 'text-gray-900 font-medium'}>
                        {r.red ? `+ ${formatCurrency(r.value)}` : formatCurrency(r.value)}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-gray-200 pt-2 font-bold text-base">
                    <span>Total Cost to Company</span>
                    <span className="text-blue-700">{formatCurrency(result.employerCost)}</span>
                  </div>
                </div>
                <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-2">
                  Employer shares are separate from employee deductions and represent additional cost to the company.
                </div>
              </div>
            </>
          ) : (
            <div className="card p-8 text-center text-gray-300">
              <TrendingUp className="w-10 h-10 mx-auto mb-2" />
              <p className="text-sm">Annual projection will appear here</p>
            </div>
          )}
        </div>
      </div>

      {/* ── TRAIN Law Brackets ── */}
      {result && (
        <div className="card">
          <button
            onClick={() => setShowBrackets(!showBrackets)}
            className="w-full flex items-center justify-between p-5 text-left hover:bg-gray-50 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-gray-900">TRAIN Law Income Tax Brackets (2023+)</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Annual taxable income: {formatCurrency(annualTaxable)} → Tax: {formatCurrency(result.annualTax)}
              </p>
            </div>
            {showBrackets ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showBrackets && (
            <div className="px-5 pb-5">
              <TaxBracketPanel annualTaxable={annualTaxable} />
            </div>
          )}
        </div>
      )}

      {/* ── Frequency Comparison ── */}
      {result && (
        <div className="card">
          <div className="card-header">
            <p className="text-sm font-semibold text-gray-900">Pay Frequency Comparison</p>
            <p className="text-xs text-gray-500">Same salary across different pay schedules</p>
          </div>
          <FrequencyComparisonTable salary={salary} allowances={allowances} />
        </div>
      )}
    </div>
  );
}
