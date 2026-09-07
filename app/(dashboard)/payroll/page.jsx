'use client';
import { useState, useEffect, useCallback } from 'react';
import { payroll as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Calculator, Play, CheckCircle, Eye } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';

const EMP_TYPE_BADGE = { REGULAR:'badge-blue', PROBATIONARY:'badge-yellow', CONTRACTUAL:'badge-gray', PART_TIME:'badge-gray' };
const PERIOD_STATUS_BADGE = { OPEN:'badge-yellow', COMPUTED:'badge-blue', APPROVED:'badge-green', PAID:'badge-purple' };

function EmployeeModal({ emp, onClose, onSaved }) {
  const [form, setForm] = useState(emp || {
    employeeNo:'', firstName:'', lastName:'', middleName:'', position:'', department:'',
    tin:'', sssNo:'', philhealthNo:'', pagibigNo:'',
    hireDate: new Date().toISOString().split('T')[0],
    employmentType:'REGULAR', payFrequency:'SEMI_MONTHLY', basicSalary:'',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm(f => ({...f, [k]: e.target.value}));

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (emp?.id) await pApi.employees.update(emp.id, form);
      else await pApi.employees.create(form);
      toast.success(emp?.id ? 'Employee updated' : 'Employee created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{emp?.id ? 'Edit Employee' : 'New Employee'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group"><label className="label">Employee No. *</label><input className="input" required value={form.employeeNo} onChange={set('employeeNo')} placeholder="EMP-001" /></div>
              <div className="form-group"><label className="label">Position</label><input className="input" value={form.position || ''} onChange={set('position')} /></div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label className="label">First Name *</label><input className="input" required value={form.firstName} onChange={set('firstName')} /></div>
              <div className="form-group"><label className="label">Last Name *</label><input className="input" required value={form.lastName} onChange={set('lastName')} /></div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label className="label">Department</label><input className="input" value={form.department || ''} onChange={set('department')} /></div>
              <div className="form-group"><label className="label">Hire Date *</label><input type="date" className="input" required value={form.hireDate} onChange={set('hireDate')} /></div>
            </div>
            <div className="form-grid">
              <div className="form-group"><label className="label">Employment Type</label>
                <select className="select" value={form.employmentType} onChange={set('employmentType')}>
                  {['REGULAR','PROBATIONARY','CONTRACTUAL','PART_TIME'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="label">Pay Frequency</label>
                <select className="select" value={form.payFrequency} onChange={set('payFrequency')}>
                  <option value="MONTHLY">Monthly</option>
                  <option value="SEMI_MONTHLY">Semi-Monthly (15th & 30th)</option>
                  <option value="WEEKLY">Weekly</option>
                </select>
              </div>
            </div>
            <div className="form-group"><label className="label">Basic Monthly Salary (₱) *</label>
              <input type="number" step="0.01" min="0" className="input" required value={form.basicSalary} onChange={set('basicSalary')} placeholder="e.g. 25000.00" />
            </div>
            <hr />
            <p className="text-sm font-semibold text-gray-700">Government Numbers</p>
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {[['TIN','tin','000-000-000-000'],['SSS No.','sssNo','XX-XXXXXXX-X'],['PhilHealth','philhealthNo','XX-000000000-X'],['Pag-IBIG','pagibigNo','XXXX-XXXX-XXXX']].map(([label,key,ph]) => (
                <div key={key} className="form-group">
                  <label className="label">{label}</label>
                  <input className="input text-xs" value={form[key] || ''} onChange={set(key)} placeholder={ph} />
                </div>
              ))}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Employee'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CalculatorPanel() {
  const [params, setParams] = useState({ basicSalary: 25000, payFrequency: 'SEMI_MONTHLY' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const compute = async () => {
    setLoading(true);
    try {
      const { data } = await pApi.calculator(params);
      setResult(data);
    } catch (err) { toast.error('Computation failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="card">
      <div className="card-header"><h3 className="font-semibold">Payroll Calculator</h3></div>
      <div className="card-body space-y-4">
        <div className="form-grid">
          <div className="form-group">
            <label className="label">Monthly Basic Salary (₱)</label>
            <input type="number" className="input" value={params.basicSalary} onChange={(e) => setParams(p => ({...p, basicSalary: e.target.value}))} />
          </div>
          <div className="form-group">
            <label className="label">Pay Frequency</label>
            <select className="select" value={params.payFrequency} onChange={(e) => setParams(p => ({...p, payFrequency: e.target.value}))}>
              <option value="MONTHLY">Monthly</option>
              <option value="SEMI_MONTHLY">Semi-Monthly</option>
              <option value="WEEKLY">Weekly</option>
            </select>
          </div>
        </div>
        <button onClick={compute} disabled={loading} className="btn-primary w-full justify-center">
          <Calculator className="w-4 h-4" /> {loading ? 'Computing...' : 'Compute Payroll'}
        </button>
        {result && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Gross Pay (per period)</span><span className="font-semibold">{formatCurrency(result.grossPay)}</span></div>
            <hr />
            <div className="flex justify-between"><span className="text-gray-500">SSS (employee)</span><span className="text-red-600">- {formatCurrency(result.sssEmployee)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">PhilHealth (employee)</span><span className="text-red-600">- {formatCurrency(result.philhealthEe)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Pag-IBIG (employee)</span><span className="text-red-600">- {formatCurrency(result.pagibigEe)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Withholding Tax</span><span className="text-red-600">- {formatCurrency(result.withholdingTax)}</span></div>
            <hr />
            <div className="flex justify-between text-base font-bold"><span>Net Pay</span><span className="text-green-600">{formatCurrency(result.netPay)}</span></div>
            <p className="text-xs text-gray-400 pt-1">SSS Employer: {formatCurrency(result.sssEmployer)} | PhilHealth ER: {formatCurrency(result.philhealthEr)} | Pag-IBIG ER: {formatCurrency(result.pagibigEr)}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PayrollPage() {
  const [tab, setTab] = useState('employees');
  const [employees, setEmployees] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const loadEmployees = useCallback(() => {
    pApi.employees.list().then(r => setEmployees(r.data)).catch(console.error).finally(() => setLoading(false));
  }, []);

  const loadPeriods = useCallback(() => {
    pApi.periods.list().then(r => setPeriods(r.data)).catch(console.error);
  }, []);

  useEffect(() => { loadEmployees(); loadPeriods(); }, [loadEmployees, loadPeriods]);

  const handleCompute = async (id) => {
    if (!confirm('Compute payroll for all active employees in this period?')) return;
    try { const { data } = await pApi.periods.compute(id); toast.success(`${data.message}`); loadPeriods(); }
    catch (err) { toast.error(err.response?.data?.error || 'Compute failed'); }
  };

  const handleApprove = async (id) => {
    try { await pApi.periods.approve(id); toast.success('Payroll period approved'); loadPeriods(); }
    catch (err) { toast.error(err.response?.data?.error || 'Approval failed'); }
  };

  const TABS = [
    { key: 'employees', label: `Employees (${employees.length})` },
    { key: 'periods',   label: 'Pay Periods' },
    { key: 'calculator', label: 'Calculator' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Payroll Management</h1>
          <p className="page-subtitle">SSS • PhilHealth • Pag-IBIG • BIR TRAIN Law compliant</p>
        </div>
        {tab === 'employees' && <button className="btn-primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> New Employee</button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'employees' && (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Employee No.</th><th>Name</th><th>Position</th><th>Department</th><th>Type</th><th>Frequency</th><th className="text-right">Basic Salary</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">Loading...</td></tr>
                : employees.length === 0 ? <tr><td colSpan={8} className="text-center py-8 text-gray-400">No employees yet.</td></tr>
                : employees.map(emp => (
                  <tr key={emp.id}>
                    <td className="font-mono text-blue-700">{emp.employeeNo}</td>
                    <td className="font-medium">{emp.lastName}, {emp.firstName}</td>
                    <td className="text-gray-500">{emp.position || '—'}</td>
                    <td className="text-gray-500">{emp.department || '—'}</td>
                    <td><span className={EMP_TYPE_BADGE[emp.employmentType] || 'badge-gray'}>{emp.employmentType}</span></td>
                    <td className="text-gray-500 text-xs">{emp.payFrequency.replace('_', ' ')}</td>
                    <td className="text-right font-semibold">{formatCurrency(emp.basicSalary)}</td>
                    <td><button onClick={() => setModal(emp)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Eye className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'periods' && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold">Pay Periods</h3>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr><th>Period</th><th>Start</th><th>End</th><th>Pay Date</th><th>Employees</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {periods.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No pay periods created.</td></tr>
                : periods.map(p => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.periodName}</td>
                    <td>{formatDate(p.startDate)}</td>
                    <td>{formatDate(p.endDate)}</td>
                    <td>{formatDate(p.payDate)}</td>
                    <td>{p._count?.items || 0}</td>
                    <td><span className={PERIOD_STATUS_BADGE[p.status]}>{p.status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        {p.status === 'OPEN' && <button onClick={() => handleCompute(p.id)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded" title="Compute"><Play className="w-4 h-4" /></button>}
                        {p.status === 'COMPUTED' && <button onClick={() => handleApprove(p.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Approve"><CheckCircle className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'calculator' && <CalculatorPanel />}

      {modal && (
        <EmployeeModal
          emp={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadEmployees(); }}
        />
      )}
    </div>
  );
}
