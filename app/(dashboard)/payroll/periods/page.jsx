'use client';
import { useState, useEffect, useCallback } from 'react';
import { payroll as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Calendar, ChevronDown, ChevronUp, Play, CheckCircle,
  AlertCircle, Clock, Users, TrendingUp, Eye,
  FileText, MoreHorizontal, X, Loader2, ArrowRight, Printer,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { formatCurrency, formatDate } from '@/lib/auth';

// ─── Status config ────────────────────────────────────────────
const STATUS = {
  OPEN:     { label: 'Open',     color: 'badge-gray',   icon: Clock,         next: 'COMPUTED',  action: 'Compute' },
  COMPUTED: { label: 'Computed', color: 'badge-yellow',  icon: AlertCircle,   next: 'APPROVED',  action: 'Approve' },
  APPROVED: { label: 'Approved', color: 'badge-blue',    icon: CheckCircle,   next: 'PAID',      action: 'Mark Paid' },
  PAID:     { label: 'Paid',     color: 'badge-green',   icon: CheckCircle,   next: null,        action: null },
};
const FREQ_OPTS = [
  { value: 'MONTHLY',      label: 'Monthly',      perYear: 12 },
  { value: 'SEMI_MONTHLY', label: 'Semi-Monthly', perYear: 24 },
  { value: 'WEEKLY',       label: 'Weekly',       perYear: 52 },
];

// ─── Create Period Modal ──────────────────────────────────────
function CreatePeriodModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    periodName: '',
    payFrequency: 'SEMI_MONTHLY',
    startDate: '',
    endDate: '',
    payDate: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Auto-suggest period name from dates
  useEffect(() => {
    if (form.startDate && form.endDate) {
      const start = new Date(form.startDate);
      const end   = new Date(form.endDate);
      const mn = start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
      const day1 = start.getDate();
      const day2 = end.getDate();
      setForm((f) => ({
        ...f,
        periodName: f.periodName || `${mn} ${day1}–${day2}`,
        payDate: f.payDate || form.endDate,
      }));
    }
  }, [form.startDate, form.endDate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.startDate || !form.endDate || !form.periodName) {
      toast.error('Period name and dates are required'); return;
    }
    setSaving(true);
    try {
      await pApi.periods.create(form);
      toast.success('Pay period created');
      onCreated();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create period');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Pay Period</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-group">
              <label className="label">Pay Frequency</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {FREQ_OPTS.map((f) => (
                  <button
                    key={f.value} type="button"
                    onClick={() => setForm((fm) => ({ ...fm, payFrequency: f.value }))}
                    className={`p-3 rounded-xl border-2 text-center transition-all ${
                      form.payFrequency === f.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'
                    }`}
                  >
                    <p className={`text-sm font-semibold ${form.payFrequency === f.value ? 'text-blue-700' : 'text-gray-700'}`}>{f.label}</p>
                    <p className="text-xs text-gray-400">{f.perYear}×/yr</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Start Date *</label>
                <input type="date" className="input" required value={form.startDate} onChange={set('startDate')} />
              </div>
              <div className="form-group">
                <label className="label">End Date *</label>
                <input type="date" className="input" required value={form.endDate} min={form.startDate} onChange={set('endDate')} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Period Name *</label>
              <input className="input" required value={form.periodName} onChange={set('periodName')} placeholder="e.g. June 2026 1st Half" />
            </div>
            <div className="form-group">
              <label className="label">Pay Date</label>
              <input type="date" className="input" value={form.payDate} onChange={set('payDate')} />
              <p className="text-xs text-gray-400 mt-1">When employees receive payment</p>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Creating...' : 'Create Period'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Period Detail Modal ──────────────────────────────────────
function PeriodDetailModal({ period, onClose, onRefresh }) {
  const [items, setItems]   = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);

  useEffect(() => {
    pApi.periods.items(period.id)
      .then((r) => {
        setItems(r.data.items || []);
        setTotals(r.data.totals || null);
      })
      .catch(() => toast.error('Failed to load payslips'))
      .finally(() => setLoading(false));
  }, [period.id]);

  const handleAction = async () => {
    const { next, action } = STATUS[period.status];
    if (!next) return;
    const msg = action === 'Compute'
      ? 'Compute payroll for all active employees?'
      : `${action} this payroll period?`;
    if (!confirm(msg)) return;
    setActioning(true);
    try {
      if (next === 'COMPUTED') await pApi.periods.compute(period.id);
      else if (next === 'APPROVED') await pApi.periods.approve(period.id);
      else await pApi.periods.update(period.id, { status: 'PAID' });
      toast.success(`Period ${action.toLowerCase()}d successfully`);
      onRefresh();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally { setActioning(false); }
  };

  const cfg = STATUS[period.status];

  const handlePrint = () => {
    if (!items.length) { toast.error('No payslip data. Compute payroll first.'); return; }
    const rows = items.map((item) => `
      <tr>
        <td>
          <div class="bold small">${item.employee.lastName}, ${item.employee.firstName}</div>
          <div class="mono gray" style="font-size:8px">${item.employee.employeeNo}</div>
        </td>
        <td class="right mono">${phpFmt(item.basicPay)}</td>
        <td class="right mono gray">${phpFmt(item.allowances || 0)}</td>
        <td class="right mono bold">${phpFmt(item.grossPay)}</td>
        <td class="right mono red">(${phpFmt(item.sssEmployee)})</td>
        <td class="right mono red">(${phpFmt(item.philhealthEe)})</td>
        <td class="right mono red">(${phpFmt(item.pagibigEe)})</td>
        <td class="right mono red">(${phpFmt(item.withholdingTax)})</td>
        <td class="right mono bold green">${phpFmt(item.netPay)}</td>
      </tr>`).join('');

    const footRow = totals ? `
      <tfoot>
        <tr>
          <td class="gray">TOTALS (${items.length} employees)</td>
          <td class="right mono">${phpFmt(totals.basicPay)}</td>
          <td class="right mono gray">${phpFmt(totals.allowances || 0)}</td>
          <td class="right mono">${phpFmt(totals.grossPay)}</td>
          <td class="right mono red">(${phpFmt(totals.sssEmployee)})</td>
          <td class="right mono red">(${phpFmt(totals.philhealthEe)})</td>
          <td class="right mono red">(${phpFmt(totals.pagibigEe)})</td>
          <td class="right mono red">(${phpFmt(totals.withholdingTax)})</td>
          <td class="right mono green">${phpFmt(totals.netPay)}</td>
        </tr>
      </tfoot>` : '';

    const summaryHTML = totals ? `
      <div class="sum-row">
        <div class="sum-box"><div class="sum-lbl">Employees</div><div class="sum-val">${items.length}</div></div>
        <div class="sum-box"><div class="sum-lbl">Total Gross</div><div class="sum-val">${phpFmt(totals.grossPay)}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">SSS (EE)</div><div class="sum-val">${phpFmt(totals.sssEmployee)}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">PhilHealth (EE)</div><div class="sum-val">${phpFmt(totals.philhealthEe)}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">Tax Withheld</div><div class="sum-val">${phpFmt(totals.withholdingTax)}</div></div>
        <div class="sum-box sum-green"><div class="sum-lbl">Total Net Pay</div><div class="sum-val">${phpFmt(totals.netPay)}</div></div>
      </div>` : '';

    const body = `
      <div class="info-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="info-box"><div class="info-lbl">Period</div><div class="info-val">${period.periodName}</div></div>
        <div class="info-box"><div class="info-lbl">Start Date</div><div class="info-val">${dateFmt(period.startDate)}</div></div>
        <div class="info-box"><div class="info-lbl">End Date</div><div class="info-val">${dateFmt(period.endDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${cfg.label}</div></div>
      </div>
      ${summaryHTML}
      <div class="section-title">Payroll Register</div>
      <table>
        <thead>
          <tr>
            <th>Employee</th><th class="right">Basic Pay</th><th class="right">Allowances</th>
            <th class="right">Gross Pay</th><th class="right">SSS</th><th class="right">PhilHealth</th>
            <th class="right">Pag-IBIG</th><th class="right">Tax</th><th class="right">Net Pay</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        ${footRow}
      </table>
      <div class="desc-box" style="margin-top:12px;font-size:8.5px;">
        This payroll register is generated by the PH-ERP Accounting System. All statutory deductions are computed based on the 2024 SSS contribution table, PhilHealth 5% rate, Pag-IBIG 2% rate (max ₱100), and TRAIN Law 2023 withholding tax schedule.
      </div>`;

    printDocument('Payroll Register', `${period.periodName} · ${dateFmt(period.startDate)} – ${dateFmt(period.endDate)}`, body);
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{period.periodName}</h3>
            <p className="text-sm text-gray-400">
              {formatDate(period.startDate)} → {formatDate(period.endDate)}
              {period.payDate && ` · Pay Date: ${formatDate(period.payDate)}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`badge ${cfg.color}`}>{cfg.label}</span>
            <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
          </div>
        </div>

        {/* Totals summary */}
        {totals && (
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-6 gap-3 text-center">
              {[
                { label: 'Employees', value: items.length, isNum: true },
                { label: 'Total Gross', value: formatCurrency(totals.grossPay) },
                { label: 'SSS (EE)', value: formatCurrency(totals.sssEmployee), red: true },
                { label: 'PhilHealth (EE)', value: formatCurrency(totals.philhealthEe), red: true },
                { label: 'Tax Withheld', value: formatCurrency(totals.withholdingTax), red: true },
                { label: 'Total Net Pay', value: formatCurrency(totals.netPay), bold: true, green: true },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-xl p-3 shadow-sm">
                  <p className={`text-sm font-bold ${s.green ? 'text-green-600' : s.red ? 'text-red-500' : 'text-gray-900'} ${s.bold ? 'text-base' : ''}`}>
                    {s.value}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-body p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading payslips...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              {period.status === 'OPEN'
                ? <p>No payslips yet. Click "Compute" to process payroll.</p>
                : <p>No payroll items found for this period.</p>
              }
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th className="text-right">Basic</th>
                    <th className="text-right">Allowances</th>
                    <th className="text-right">Gross Pay</th>
                    <th className="text-right text-red-500">SSS</th>
                    <th className="text-right text-red-500">PhilHealth</th>
                    <th className="text-right text-red-500">Pag-IBIG</th>
                    <th className="text-right text-red-500">Tax</th>
                    <th className="text-right text-green-600 font-bold">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div>
                          <p className="font-medium text-gray-900 text-xs">
                            {item.employee.lastName}, {item.employee.firstName}
                          </p>
                          <p className="text-xs text-gray-400 font-mono">{item.employee.employeeNo}</p>
                        </div>
                      </td>
                      <td className="text-right font-mono text-xs">{formatCurrency(item.basicPay)}</td>
                      <td className="text-right font-mono text-xs text-gray-500">{formatCurrency(item.allowances || 0)}</td>
                      <td className="text-right font-mono text-xs font-medium">{formatCurrency(item.grossPay)}</td>
                      <td className="text-right font-mono text-xs text-red-500">({formatCurrency(item.sssEmployee)})</td>
                      <td className="text-right font-mono text-xs text-red-500">({formatCurrency(item.philhealthEe)})</td>
                      <td className="text-right font-mono text-xs text-red-500">({formatCurrency(item.pagibigEe)})</td>
                      <td className="text-right font-mono text-xs text-red-500">({formatCurrency(item.withholdingTax)})</td>
                      <td className="text-right font-mono text-sm font-bold text-green-600">{formatCurrency(item.netPay)}</td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot className="bg-gray-50 font-semibold text-sm">
                    <tr>
                      <td className="px-4 py-2 text-gray-600">TOTALS ({items.length} emp.)</td>
                      <td className="text-right px-4 py-2 font-mono">{formatCurrency(totals.basicPay)}</td>
                      <td className="text-right px-4 py-2 font-mono text-gray-500">{formatCurrency(totals.allowances || 0)}</td>
                      <td className="text-right px-4 py-2 font-mono">{formatCurrency(totals.grossPay)}</td>
                      <td className="text-right px-4 py-2 font-mono text-red-500">({formatCurrency(totals.sssEmployee)})</td>
                      <td className="text-right px-4 py-2 font-mono text-red-500">({formatCurrency(totals.philhealthEe)})</td>
                      <td className="text-right px-4 py-2 font-mono text-red-500">({formatCurrency(totals.pagibigEe)})</td>
                      <td className="text-right px-4 py-2 font-mono text-red-500">({formatCurrency(totals.withholdingTax)})</td>
                      <td className="text-right px-4 py-2 font-mono text-green-600">{formatCurrency(totals.netPay)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={handlePrint} disabled={loading || !items.length} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print Payroll
          </button>
          {cfg.action && (
            <button onClick={handleAction} disabled={actioning} className={`${cfg.next === 'COMPUTED' ? 'btn-primary' : cfg.next === 'APPROVED' ? 'btn-success' : 'btn-secondary'} flex items-center gap-2`}>
              {actioning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {actioning ? 'Processing...' : cfg.action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Period Card ─────────────────────────────────────────────
function PeriodCard({ period, onView, onAction }) {
  const cfg = STATUS[period.status];
  const Icon = cfg.icon;
  const nextCfg = cfg.next ? STATUS[cfg.next] : null;

  return (
    <div className="card hover:shadow-md hover:border-blue-200 transition-all">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1">
            <p className="font-bold text-gray-900">{period.periodName}</p>
            <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-1">
              <Calendar className="w-3 h-3" />
              {formatDate(period.startDate)} – {formatDate(period.endDate)}
            </div>
            {period.payDate && (
              <p className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                <PesoSign className="w-3 h-3" /> Pay date: {formatDate(period.payDate)}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className={`badge ${cfg.color} text-xs`}>
              <Icon className="w-3 h-3 mr-1 inline" />
              {cfg.label}
            </span>
            <span className="text-xs text-gray-400">{period.payFrequency?.replace('_', '-')}</span>
          </div>
        </div>

        {/* Status flow */}
        <div className="flex items-center gap-1 mb-4">
          {['OPEN', 'COMPUTED', 'APPROVED', 'PAID'].map((s, i) => {
            const steps = ['OPEN', 'COMPUTED', 'APPROVED', 'PAID'];
            const currentIdx = steps.indexOf(period.status);
            const stepIdx = steps.indexOf(s);
            const done = stepIdx <= currentIdx;
            return (
              <div key={s} className="flex items-center gap-1 flex-1">
                <div className={`h-1.5 flex-1 rounded-full transition-colors ${done ? 'bg-blue-500' : 'bg-gray-200'}`} />
                {i < 3 && <div className={`w-1 h-1 rounded-full ${done ? 'bg-blue-500' : 'bg-gray-200'}`} />}
              </div>
            );
          })}
        </div>

        {/* Mini stats (if computed) */}
        {period._count && period.status !== 'OPEN' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
            {[
              { label: 'Employees', value: period._count.items },
              { label: 'Gross Pay', value: formatCurrency(period.totalGross || 0) },
              { label: 'Net Pay', value: formatCurrency(period.totalNet || 0), green: true },
            ].map((s) => (
              <div key={s.label} className="text-center bg-gray-50 rounded-lg p-2">
                <p className={`text-xs font-bold ${s.green ? 'text-green-600' : 'text-gray-800'}`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={onView} className="btn-secondary btn-sm flex-1 justify-center">
            <Eye className="w-3.5 h-3.5" /> View Payslips
          </button>
          {cfg.action && (
            <button onClick={() => onAction(period)} className="btn-primary btn-sm flex-1 justify-center">
              <Play className="w-3.5 h-3.5" /> {cfg.action}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function PayPeriodsPage() {
  const [periods, setPeriods]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreate, setShowCreate]     = useState(false);
  const [detailPeriod, setDetailPeriod] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    pApi.periods.list({ status: statusFilter })
      .then((r) => setPeriods(r.data))
      .catch(() => toast.error('Failed to load periods'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (period) => {
    const { next, action } = STATUS[period.status];
    if (!next) return;
    if (!confirm(`${action} this payroll period?`)) return;
    const id = toast.loading(`${action}ing period...`);
    try {
      if (next === 'COMPUTED') await pApi.periods.compute(period.id);
      else if (next === 'APPROVED') await pApi.periods.approve(period.id);
      else await pApi.periods.update(period.id, { status: 'PAID' });
      toast.success(`Period ${action.toLowerCase()}d`, { id });
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed', { id });
    }
  };

  const counts = {
    OPEN:     periods.filter((p) => p.status === 'OPEN').length,
    COMPUTED: periods.filter((p) => p.status === 'COMPUTED').length,
    APPROVED: periods.filter((p) => p.status === 'APPROVED').length,
    PAID:     periods.filter((p) => p.status === 'PAID').length,
  };

  const totalPaid = periods.filter((p) => p.status === 'PAID').reduce((s, p) => s + Number(p.totalNet || 0), 0);
  const avgPeriod = periods.length ? totalPaid / Math.max(counts.PAID, 1) : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Pay Periods</h1>
          <p className="page-subtitle">{periods.length} period{periods.length !== 1 ? 's' : ''} · {counts.OPEN} open</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Period
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(STATUS).map(([key, cfg]) => {
          const Icon = cfg.icon;
          const colorMap = {
            OPEN: 'bg-gray-100 text-gray-500',
            COMPUTED: 'bg-yellow-100 text-yellow-600',
            APPROVED: 'bg-blue-100 text-blue-600',
            PAID: 'bg-green-100 text-green-600',
          };
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(statusFilter === key ? '' : key)}
              className={`card p-4 flex items-center gap-3 text-left transition-all hover:shadow-md ${statusFilter === key ? 'ring-2 ring-blue-500 border-blue-200' : ''}`}
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${colorMap[key]}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-gray-500">{cfg.label}</p>
                <p className="text-2xl font-bold text-gray-900">{counts[key]}</p>
                <p className="text-xs text-gray-400">periods</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Workflow guide */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3.5 flex items-center gap-3 text-sm text-blue-700">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span className="font-medium">Payroll Workflow:</span>
        {['Open', 'Compute', 'Approve', 'Mark Paid'].map((step, i) => (
          <span key={step} className="flex items-center gap-1">
            {i > 0 && <ArrowRight className="w-3.5 h-3.5 opacity-50" />}
            <span className={i === 1 ? 'font-semibold' : ''}>{step}</span>
          </span>
        ))}
      </div>

      {/* Periods grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading pay periods...
        </div>
      ) : periods.length === 0 ? (
        <div className="card p-12 text-center">
          <Calendar className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No pay periods found</p>
          <p className="text-sm text-gray-400 mt-1">Create your first pay period to start processing payroll</p>
          <button className="btn-primary mt-4" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Create Pay Period
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 sm:grid-cols-3 gap-4">
          {periods.map((p) => (
            <PeriodCard
              key={p.id}
              period={p}
              onView={() => setDetailPeriod(p)}
              onAction={handleAction}
            />
          ))}
        </div>
      )}

      {/* Summary bar */}
      {counts.PAID > 0 && (
        <div className="card p-4 flex flex-wrap items-center justify-between gap-4 bg-green-50 border-green-200">
          <div className="flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <div>
              <p className="text-sm font-semibold text-green-800">Payroll Disbursed — {counts.PAID} Period{counts.PAID > 1 ? 's' : ''} Paid</p>
              <p className="text-xs text-green-600">Avg net pay per period: {formatCurrency(avgPeriod)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-green-600">Total Net Pay Disbursed</p>
            <p className="text-xl font-bold text-green-700">{formatCurrency(totalPaid)}</p>
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreatePeriodModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {detailPeriod && (
        <PeriodDetailModal
          period={detailPeriod}
          onClose={() => setDetailPeriod(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}
