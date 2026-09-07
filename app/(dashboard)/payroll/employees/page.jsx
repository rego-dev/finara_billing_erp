'use client';
import { useState, useEffect, useCallback } from 'react';
import { payroll as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Edit2, Users, Phone, Mail, MapPin,
  Briefcase, ChevronRight, ToggleLeft, ToggleRight, X,
  CheckCircle2, AlertCircle, BadgeCheck, Calendar,
  CreditCard, Hash, Building2, Clock, TrendingUp, FileText,
  Filter,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';

// ─── Constants ─────────────────────────────────────────────────
const EMP_TYPES    = ['REGULAR', 'PROBATIONARY', 'CONTRACTUAL', 'PART_TIME'];
const PAY_FREQS    = ['MONTHLY', 'SEMI_MONTHLY', 'WEEKLY'];
const DEPARTMENTS  = ['Finance', 'HR', 'Operations', 'Sales', 'IT', 'Admin', 'Marketing', 'Legal'];

const TYPE_BADGE = {
  REGULAR:       'badge-blue',
  PROBATIONARY:  'badge-yellow',
  CONTRACTUAL:   'bg-orange-100 text-orange-700 badge',
  PART_TIME:     'badge-gray',
};
const TYPE_COLOR = {
  REGULAR:       'bg-blue-100 text-blue-700',
  PROBATIONARY:  'bg-yellow-100 text-yellow-700',
  CONTRACTUAL:   'bg-orange-100 text-orange-700',
  PART_TIME:     'bg-gray-100 text-gray-600',
};

const FREQ_LABEL = { MONTHLY: 'Monthly', SEMI_MONTHLY: 'Semi-Monthly', WEEKLY: 'Weekly' };

// ─── Government Number Field ─────────────────────────────────
const GovtField = ({ label, icon: Icon, value, onChange, placeholder, color }) => (
  <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
      <Icon className="w-4 h-4" />
    </div>
    <div className="flex-1">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <input
        className="input py-1.5 text-sm font-mono"
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
      />
    </div>
  </div>
);

// ─── Employee Form Modal ──────────────────────────────────────
function EmployeeModal({ employee, onClose, onSaved }) {
  const isEdit = !!employee?.id;
  const [tab, setTab] = useState('basic');
  const [form, setForm] = useState(employee || {
    employeeNo: '', firstName: '', lastName: '', middleName: '',
    position: '', department: '',
    tin: '', sssNo: '', philhealthNo: '', pagibigNo: '',
    hireDate:       new Date().toISOString().split('T')[0],
    employmentType: 'REGULAR',
    payFrequency:   'SEMI_MONTHLY',
    basicSalary:    '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.basicSalary) {
      toast.error('Name and basic salary are required'); return;
    }
    setSaving(true);
    try {
      if (isEdit) await pApi.employees.update(employee.id, form);
      else        await pApi.employees.create(form);
      toast.success(isEdit ? 'Employee updated' : 'Employee added to payroll');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const TABS = [
    { key: 'basic',  label: 'Basic Info' },
    { key: 'payroll', label: 'Payroll' },
    { key: 'govt',   label: 'Govt. Numbers' },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal max-w-xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{isEdit ? 'Edit Employee' : 'New Employee'}</h3>
            {isEdit && <p className="text-sm text-gray-400">{employee.employeeNo}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-6">
          {TABS.map((t) => (
            <button
              key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">

            {/* ── Basic Info ── */}
            {tab === 'basic' && (
              <>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Employee No.</label>
                    <input className="input font-mono" value={form.employeeNo || ''} onChange={set('employeeNo')} placeholder="Auto-generated (EMP-001)" disabled={isEdit} />
                    {!isEdit && <p className="text-xs text-gray-400 mt-1">Leave blank to auto-generate.</p>}
                  </div>
                  <div className="form-group">
                    <label className="label">Department</label>
                    <select className="select" value={form.department || ''} onChange={set('department')}>
                      <option value="">Select...</option>
                      {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Last Name *</label>
                    <input className="input" required value={form.lastName} onChange={set('lastName')} />
                  </div>
                  <div className="form-group">
                    <label className="label">First Name *</label>
                    <input className="input" required value={form.firstName} onChange={set('firstName')} />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Middle Name</label>
                    <input className="input" value={form.middleName || ''} onChange={set('middleName')} />
                  </div>
                  <div className="form-group">
                    <label className="label">Position / Job Title</label>
                    <input className="input" value={form.position || ''} onChange={set('position')} placeholder="e.g. Senior Accountant" />
                  </div>
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Hire Date *</label>
                    <input type="date" className="input" required value={form.hireDate} onChange={set('hireDate')} />
                  </div>
                  <div className="form-group">
                    <label className="label">Employment Type</label>
                    <select className="select" value={form.employmentType} onChange={set('employmentType')}>
                      {EMP_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {isEdit && (
                  <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-700">Active Status</p>
                      <p className="text-xs text-gray-500">Inactive employees are excluded from payroll computation</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                      className={`transition-colors ${form.isActive !== false ? 'text-green-500' : 'text-gray-300'}`}
                    >
                      {form.isActive !== false ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── Payroll ── */}
            {tab === 'payroll' && (
              <>
                <div className="form-group">
                  <label className="label">Basic Monthly Salary (₱) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium text-sm">₱</span>
                    <input
                      type="number" step="0.01" min="0"
                      className="input pl-7 text-lg font-semibold"
                      required value={form.basicSalary} onChange={set('basicSalary')}
                      placeholder="0.00"
                    />
                  </div>
                  {form.basicSalary > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Daily rate: {formatCurrency(form.basicSalary / 26)} (÷26 working days)
                    </p>
                  )}
                </div>
                <div className="form-group">
                  <label className="label">Pay Frequency</label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      { val: 'MONTHLY',     label: 'Monthly',     sub: 'Once/month' },
                      { val: 'SEMI_MONTHLY', label: 'Semi-Monthly', sub: '15th & 30th' },
                      { val: 'WEEKLY',      label: 'Weekly',      sub: 'Every week' },
                    ].map((f) => (
                      <button
                        key={f.val} type="button"
                        onClick={() => setForm((fm) => ({ ...fm, payFrequency: f.val }))}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          form.payFrequency === f.val
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-blue-200'
                        }`}
                      >
                        <p className={`text-sm font-semibold ${form.payFrequency === f.val ? 'text-blue-700' : 'text-gray-700'}`}>{f.label}</p>
                        <p className="text-xs text-gray-400">{f.sub}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Live preview */}
                {form.basicSalary > 0 && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-3">Estimated Deductions Preview</p>
                    {(() => {
                      const sal  = Number(form.basicSalary);
                      const freq = form.payFrequency === 'MONTHLY' ? 12 : form.payFrequency === 'SEMI_MONTHLY' ? 24 : 52;
                      const periodsPerMonth = freq / 12;
                      // Rough estimates
                      const sss  = sal >= 20250 ? 900  : Math.round(sal * 0.045);
                      const ph   = Math.min(Math.max(sal, 10000), 100000) * 0.025;
                      const pi   = Math.min(sal <= 1500 ? sal * 0.01 : sal * 0.02, 100);
                      const annualTax = sal * 12 <= 250000 ? 0 : sal * 12 <= 400000 ? (sal * 12 - 250000) * 0.15 : (sal * 12 - 400000) * 0.20 + 22500;
                      const taxPerPeriod = annualTax / freq;
                      const totalDed = (sss + ph + pi) / periodsPerMonth + taxPerPeriod;
                      const grossPerPeriod = sal / periodsPerMonth;
                      return (
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between"><span className="text-gray-600">Gross per period</span><span className="font-medium">{formatCurrency(grossPerPeriod)}</span></div>
                          <div className="flex justify-between text-red-600"><span>SSS (est.)</span><span>- {formatCurrency(sss / periodsPerMonth)}</span></div>
                          <div className="flex justify-between text-red-600"><span>PhilHealth (est.)</span><span>- {formatCurrency(ph / periodsPerMonth)}</span></div>
                          <div className="flex justify-between text-red-600"><span>Pag-IBIG (est.)</span><span>- {formatCurrency(pi / periodsPerMonth)}</span></div>
                          <div className="flex justify-between text-red-600"><span>Withholding Tax (est.)</span><span>- {formatCurrency(taxPerPeriod)}</span></div>
                          <div className="flex justify-between font-bold border-t border-blue-200 pt-1.5 text-blue-800">
                            <span>Est. Net Pay</span><span>{formatCurrency(grossPerPeriod - totalDed)}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            )}

            {/* ── Government Numbers ── */}
            {tab === 'govt' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">Required for BIR Form 2316, SSS, PhilHealth, and Pag-IBIG reporting.</p>
                <GovtField
                  label="BIR TIN"
                  icon={Hash}
                  color="bg-yellow-100 text-yellow-700"
                  value={form.tin}
                  onChange={set('tin')}
                  placeholder="000-000-000-000"
                />
                <GovtField
                  label="SSS Number"
                  icon={BadgeCheck}
                  color="bg-blue-100 text-blue-700"
                  value={form.sssNo}
                  onChange={set('sssNo')}
                  placeholder="XX-XXXXXXX-X"
                />
                <GovtField
                  label="PhilHealth Number"
                  icon={BadgeCheck}
                  color="bg-green-100 text-green-700"
                  value={form.philhealthNo}
                  onChange={set('philhealthNo')}
                  placeholder="XX-000000000-X"
                />
                <GovtField
                  label="Pag-IBIG / HDMF Number"
                  icon={BadgeCheck}
                  color="bg-red-100 text-red-700"
                  value={form.pagibigNo}
                  onChange={set('pagibigNo')}
                  placeholder="XXXX-XXXX-XXXX"
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <div className="flex gap-2 mr-auto">
              {TABS.map((t, i) => (
                <div key={t.key} className={`w-2 h-2 rounded-full transition-colors ${tab === t.key ? 'bg-blue-600' : 'bg-gray-200'}`} />
              ))}
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Employee')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Employee Profile Drawer ──────────────────────────────────
function EmployeeDrawer({ employee, payrollHistory, onClose, onEdit, onView2316 }) {
  const yearsSince = employee.hireDate
    ? ((new Date() - new Date(employee.hireDate)) / (365.25 * 24 * 3600 * 1000)).toFixed(1)
    : null;

  const totalEarned = payrollHistory.reduce((s, p) => s + Number(p.grossPay), 0);
  const totalTax    = payrollHistory.reduce((s, p) => s + Number(p.withholdingTax), 0);
  const avgNetPay   = payrollHistory.length
    ? payrollHistory.reduce((s, p) => s + Number(p.netPay), 0) / payrollHistory.length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">

        {/* Header */}
        <div className="p-6 bg-gradient-to-br from-blue-700 to-indigo-700 text-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
              {employee.firstName[0]}{employee.lastName[0]}
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <h3 className="text-xl font-bold">{employee.lastName}, {employee.firstName} {employee.middleName || ''}</h3>
          <p className="text-blue-200 text-sm mt-0.5">{employee.position || 'No position set'}</p>
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="badge bg-white/15 text-white text-xs font-mono">{employee.employeeNo}</span>
            <span className={`badge text-xs ${employee.isActive ? 'bg-green-400/25 text-green-100' : 'bg-red-400/25 text-red-100'}`}>
              {employee.isActive ? 'Active' : 'Inactive'}
            </span>
            <span className="badge bg-white/15 text-blue-100 text-xs">
              {employee.employmentType?.replace('_', ' ')}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Quick stats */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            {[
              { label: 'Monthly Salary', value: formatCurrency(employee.basicSalary), color: 'text-gray-900' },
              { label: 'Avg Net Pay',    value: formatCurrency(avgNetPay),            color: 'text-green-600' },
              { label: 'Tax Withheld',   value: formatCurrency(totalTax),             color: 'text-red-500' },
            ].map((s) => (
              <div key={s.label} className="p-4 text-center">
                <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Employment info */}
          <div className="p-5 space-y-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Employment Details</p>
            {[
              [Briefcase,  employee.department,                            'Department'],
              [Calendar,   formatDate(employee.hireDate),                  'Hire Date'],
              [Clock,      yearsSince ? `${yearsSince} years` : '—',       'Tenure'],
              [TrendingUp, FREQ_LABEL[employee.payFrequency] || '—',       'Pay Frequency'],
            ].map(([Icon, value, label], i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-medium text-gray-800">{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Government numbers */}
          <div className="p-5 space-y-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Government Numbers</p>
            {[
              { label: 'BIR TIN',      value: employee.tin,          color: 'bg-yellow-100 text-yellow-700' },
              { label: 'SSS',          value: employee.sssNo,        color: 'bg-blue-100 text-blue-700' },
              { label: 'PhilHealth',   value: employee.philhealthNo, color: 'bg-green-100 text-green-700' },
              { label: 'Pag-IBIG',     value: employee.pagibigNo,    color: 'bg-red-100 text-red-700' },
            ].map((g) => (
              <div key={g.label} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold ${g.color}`}>{g.label}</span>
                </div>
                <span className={`font-mono text-sm ${g.value ? 'text-gray-800' : 'text-gray-300'}`}>
                  {g.value || 'Not set'}
                </span>
              </div>
            ))}
          </div>

          {/* Payslip history */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Payslips</p>
              <button
                onClick={onView2316}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1"
              >
                <FileText className="w-3 h-3" /> BIR 2316
              </button>
            </div>
            {payrollHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No payroll history yet</p>
            ) : (
              <div className="space-y-2">
                {payrollHistory.map((p) => (
                  <div key={p.id} className="bg-gray-50 rounded-xl p-3 hover:bg-gray-100 transition-colors">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{p.period?.periodName}</p>
                        <p className="text-xs text-gray-400">
                          {formatDate(p.period?.startDate)} – {formatDate(p.period?.endDate)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-green-600">{formatCurrency(p.netPay)}</p>
                        <p className="text-xs text-gray-400">Net Pay</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
                      <div>Gross: <span className="font-medium text-gray-700">{formatCurrency(p.grossPay)}</span></div>
                      <div>Tax: <span className="font-medium text-red-500">{formatCurrency(p.withholdingTax)}</span></div>
                      <div>Deductions: <span className="font-medium text-red-500">{formatCurrency(p.totalDeductions)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button onClick={onEdit} className="btn-primary w-full justify-center">
            <Edit2 className="w-4 h-4" /> Edit Employee
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BIR 2316 Modal ───────────────────────────────────────────
function BIR2316Modal({ employee, onClose }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const load = async () => {
    setLoading(true);
    try {
      const r = await pApi.bir2316(employee.id, year);
      setData(r.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to generate 2316');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [year]);

  return (
    <div className="modal-overlay">
      <div className="modal max-w-lg">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">BIR Form 2316</h3>
            <p className="text-sm text-gray-400">Certificate of Compensation Payment/Tax Withheld</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="flex items-center gap-3">
            <label className="label mb-0">Year:</label>
            <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y}>{y}</option>)}
            </select>
            <button onClick={load} disabled={loading} className="btn-secondary btn-sm">
              {loading ? 'Loading...' : 'Generate'}
            </button>
          </div>

          {data && (
            <div className="space-y-4">
              <div className="border-2 border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-yellow-50 border-b border-yellow-200 px-5 py-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-yellow-700" />
                  <span className="text-sm font-bold text-yellow-800">BIR Form 2316 — Taxable Year {data.year}</span>
                </div>
                <div className="p-5 space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
                    <div><span className="text-gray-500 text-xs block">Employee Name</span><span className="font-medium">{data.employee.name}</span></div>
                    <div><span className="text-gray-500 text-xs block">TIN</span><span className="font-mono">{data.employee.tin || '—'}</span></div>
                    <div><span className="text-gray-500 text-xs block">Position</span><span>{data.employee.position || '—'}</span></div>
                    <div><span className="text-gray-500 text-xs block">Pay Periods</span><span>{data.periodCount}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[['SSS No.', data.employee.sssNo], ['PhilHealth', data.employee.philhealthNo], ['Pag-IBIG', data.employee.pagibigNo]].map(([l, v]) => (
                      <div key={l}><span className="text-gray-500 text-xs block">{l}</span><span className="font-mono text-xs">{v || '—'}</span></div>
                    ))}
                  </div>
                  <hr />
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-gray-600">Gross Compensation</span><span className="font-semibold">{formatCurrency(data.totals.grossPay)}</span></div>
                    <div className="flex justify-between text-red-600"><span>SSS Contributions (EE)</span><span>({formatCurrency(data.totals.sssEmployee)})</span></div>
                    <div className="flex justify-between text-red-600"><span>PhilHealth (EE)</span><span>({formatCurrency(data.totals.philhealthEe)})</span></div>
                    <div className="flex justify-between text-red-600"><span>Pag-IBIG (EE)</span><span>({formatCurrency(data.totals.pagibigEe)})</span></div>
                    <div className="flex justify-between font-bold text-base border-t pt-2">
                      <span>Total Tax Withheld</span>
                      <span className="text-red-600">{formatCurrency(data.totals.withholdingTax)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-green-600">
                      <span>Total Net Pay</span>
                      <span>{formatCurrency(data.totals.netPay)}</span>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 text-center">Data sourced from approved/paid payroll periods only</p>
            </div>
          )}
          {loading && <div className="text-center py-8 text-gray-400">Generating form...</div>}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Close</button>
          {data && <button className="btn-primary" onClick={() => window.print()}>Print 2316</button>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Employees Page ──────────────────────────────────────
export default function EmployeesPage() {
  const [employees, setEmployees]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('active');
  const [viewMode, setViewMode]     = useState('table'); // 'table' | 'cards'
  const [modal, setModal]           = useState(null);
  const [drawer, setDrawer]         = useState(null);
  const [drawerHistory, setDrawerHistory] = useState([]);
  const [show2316, setShow2316]     = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = { search, department: deptFilter };
    if (activeFilter !== 'all') params.active = activeFilter === 'active';
    pApi.employees.list(params)
      .then((r) => setEmployees(r.data))
      .catch(() => toast.error('Failed to load employees'))
      .finally(() => setLoading(false));
  }, [search, deptFilter, activeFilter]);

  useEffect(() => { load(); }, [load]);

  const openDrawer = async (emp) => {
    setDrawer(emp);
    try {
      const r = await pApi.employees.get(emp.id);
      setDrawerHistory(r.data.payrollItems || []);
    } catch { setDrawerHistory([]); }
  };

  const filtered = employees.filter((e) => !typeFilter || e.employmentType === typeFilter);
  const activeCount = employees.filter((e) => e.isActive).length;
  const depts = [...new Set(employees.map((e) => e.department).filter(Boolean))];

  // Totals
  const totalSalary = filtered.filter((e) => e.isActive).reduce((s, e) => s + Number(e.basicSalary), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-subtitle">{filtered.length} employee{filtered.length !== 1 ? 's' : ''} · {activeCount} active</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> New Employee
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Employees',   value: employees.length,       sub: 'on record',          color: 'bg-blue-100 text-blue-600',   icon: <Users className="w-5 h-5" /> },
          { label: 'Active',            value: activeCount,             sub: 'in payroll',          color: 'bg-green-100 text-green-600', icon: <CheckCircle2 className="w-5 h-5" /> },
          { label: 'Monthly Payroll',   value: formatCurrency(totalSalary), sub: 'gross basic (active)', color: 'bg-purple-100 text-purple-600', icon: <TrendingUp className="w-5 h-5" /> },
          { label: 'Departments',       value: depts.length,            sub: 'active departments',  color: 'bg-orange-100 text-orange-600', icon: <Building2 className="w-5 h-5" /> },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{s.value}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search name, employee no., position..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <select className="select w-40" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>

          <select className="select w-36" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {EMP_TYPES.map((t) => <option key={t}>{t.replace('_', ' ')}</option>)}
          </select>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['active', 'Active'], ['all', 'All'], ['inactive', 'Inactive']].map(([k, label]) => (
              <button key={k} onClick={() => setActiveFilter(k)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${activeFilter === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button onClick={() => setViewMode('table')} className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 4h14v2H3V4zm0 5h14v2H3V9zm0 5h14v2H3v-2z" /></svg>
            </button>
            <button onClick={() => setViewMode('cards')} className={`p-2 transition-colors ${viewMode === 'cards' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M3 3h6v6H3V3zm8 0h6v6h-6V3zm-8 8h6v6H3v-6zm8 0h6v6h-6v-6z" /></svg>
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />Loading employees...
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No employees found</p>
          <button className="btn-primary mt-4" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> Add Employee</button>
        </div>
      ) : viewMode === 'table' ? (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Department</th><th>Position</th>
                  <th>Type</th><th>Frequency</th>
                  <th className="text-right">Basic Salary</th>
                  <th>Hire Date</th><th>Status</th><th className="text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="cursor-pointer hover:bg-blue-50/30" onClick={() => openDrawer(emp)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                          {emp.firstName[0]}{emp.lastName[0]}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{emp.lastName}, {emp.firstName}</p>
                          <p className="text-xs text-gray-400 font-mono">{emp.employeeNo}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-gray-500 text-sm">{emp.department || '—'}</td>
                    <td className="text-gray-600 text-sm">{emp.position || '—'}</td>
                    <td><span className={`${TYPE_BADGE[emp.employmentType]} text-xs`}>{emp.employmentType?.replace('_', ' ')}</span></td>
                    <td className="text-gray-500 text-xs">{FREQ_LABEL[emp.payFrequency]}</td>
                    <td className="text-right font-semibold text-gray-900">{formatCurrency(emp.basicSalary)}</td>
                    <td className="text-gray-500 text-sm">{formatDate(emp.hireDate)}</td>
                    <td><span className={`badge ${emp.isActive ? 'badge-green' : 'badge-gray'}`}>{emp.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => setModal(emp)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 flex justify-between text-sm text-gray-500">
            <span>{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</span>
            <span>Total Active Payroll: <strong className="text-gray-900">{formatCurrency(totalSalary)}/mo</strong></span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 sm:grid-cols-3 gap-4">
          {filtered.map((emp) => (
            <div key={emp.id} className={`card cursor-pointer group hover:shadow-md hover:border-blue-200 transition-all ${!emp.isActive ? 'opacity-60' : ''}`}
              onClick={() => openDrawer(emp)}>
              <div className="p-5">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-base flex-shrink-0">
                    {emp.firstName[0]}{emp.lastName[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-900 truncate group-hover:text-blue-700">{emp.lastName}, {emp.firstName}</p>
                    <p className="text-xs text-gray-400 font-mono">{emp.employeeNo}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{emp.position || 'No position'}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`${TYPE_BADGE[emp.employmentType]} text-xs`}>{emp.employmentType?.replace('_', ' ')}</span>
                  {emp.department && <span className="badge-gray text-xs">{emp.department}</span>}
                  <span className={`badge text-xs ml-auto ${emp.isActive ? 'badge-green' : 'badge-gray'}`}>{emp.isActive ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
              <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/50 rounded-b-xl">
                <div>
                  <p className="text-xs text-gray-400">Basic Salary</p>
                  <p className="text-sm font-bold text-gray-900">{formatCurrency(emp.basicSalary)}/mo</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setModal(emp); }}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal && (
        <EmployeeModal
          employee={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {drawer && (
        <EmployeeDrawer
          employee={drawer}
          payrollHistory={drawerHistory}
          onClose={() => setDrawer(null)}
          onEdit={() => { setModal(drawer); setDrawer(null); }}
          onView2316={() => { setShow2316(drawer); setDrawer(null); }}
        />
      )}
      {show2316 && (
        <BIR2316Modal employee={show2316} onClose={() => setShow2316(null)} />
      )}
    </div>
  );
}
