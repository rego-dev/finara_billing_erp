'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { remittance as remittanceApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import { printDocument } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Plus, X, Printer, RefreshCw, CheckCircle2, Clock, Trash2,
  Calculator, Edit2, ChevronDown, Search, Landmark,
} from 'lucide-react';

const MONTHS_LONG  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPE_OPTIONS = [
  { value: 'SSS',       label: 'SSS',         sub: 'Social Security System',          color: 'blue'   },
  { value: 'PHILHEALTH',label: 'PhilHealth',   sub: 'Philippine Health Insurance',     color: 'green'  },
  { value: 'PAGIBIG',   label: 'Pag-IBIG',     sub: 'Home Development Mutual Fund',    color: 'purple' },
  { value: 'BIR_1601C', label: 'BIR 1601-C',  sub: 'Withholding Tax on Compensation', color: 'red'    },
];
const STATUS_BADGE  = { DRAFT: 'badge-gray', FILED: 'badge-blue', PAID: 'badge-green', OVERDUE: 'badge-red' };
const COLOR_CLASSES = { blue: 'bg-blue-50 border-blue-200 text-blue-700', green: 'bg-green-50 border-green-200 text-green-700', purple: 'bg-purple-50 border-purple-200 text-purple-700', red: 'bg-red-50 border-red-200 text-red-700' };
const TABS = ['All', 'SSS', 'PhilHealth', 'Pag-IBIG', 'BIR 1601-C'];
const TAB_TYPE = { All: '', PhilHealth: 'PHILHEALTH', 'Pag-IBIG': 'PAGIBIG', 'BIR 1601-C': 'BIR_1601C' };

function fmt(n) { return formatCurrency(Number(n || 0)); }

// ─── Top-drawer modal wrapper ───────────────────────────────────
function Drawer({ open, onClose, title, children, footer }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else       document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-3xl shadow-2xl flex flex-col"
        style={{ borderRadius: '0 0 1rem 1rem', maxHeight: '90vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="px-4 lg:px-6 py-3 lg:py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 lg:p-6 space-y-4 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-4 lg:px-6 py-3 border-t border-gray-200 flex flex-wrap items-center justify-end gap-2 flex-shrink-0 bg-gray-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── File/Pay sub-drawer ────────────────────────────────────────
function ActionDrawer({ mode, record, open, onClose, onDone }) {
  const [form, setForm] = useState({ referenceNo: '', date: new Date().toISOString().slice(0, 10), paidAmount: '', penalty: '0' });
  useEffect(() => {
    if (open && record) {
      setForm({
        referenceNo: record.referenceNo || '',
        date: new Date().toISOString().slice(0, 10),
        paidAmount: String(record.totalAmount || ''),
        penalty: '0',
      });
    }
  }, [open, record]);

  const submit = async () => {
    try {
      if (mode === 'file') {
        await remittanceApi.markFiled(record.id, { referenceNo: form.referenceNo, filedDate: form.date });
        toast.success('Marked as Filed');
      } else {
        await remittanceApi.markPaid(record.id, { referenceNo: form.referenceNo, paidDate: form.date, paidAmount: Number(form.paidAmount), penalty: Number(form.penalty) });
        toast.success('Marked as Paid');
      }
      onDone();
      onClose();
    } catch (e) { toast.error(e?.response?.data?.error || 'Error'); }
  };

  const title = mode === 'file' ? 'Mark as Filed' : 'Mark as Paid';
  return (
    <Drawer open={open} onClose={onClose} title={title}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit}>{title}</button></>}>
      {record && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 text-sm space-y-1">
            <div className="font-medium text-gray-900">{TYPE_OPTIONS.find(t=>t.value===record.type)?.label} — {MONTHS_LONG[record.periodMonth - 1]} {record.periodYear}</div>
            <div className="text-gray-500">Total Amount: <span className="font-semibold text-gray-800">{fmt(record.totalAmount)}</span></div>
          </div>
          <div className="form-group">
            <label className="label">{mode === 'file' ? 'Filing Reference No.' : 'OR / Transaction Reference'}</label>
            <input className="input" placeholder="e.g. OR-12345678" value={form.referenceNo} onChange={e => setForm(p => ({ ...p, referenceNo: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">{mode === 'file' ? 'Filed Date' : 'Payment Date'}</label>
            <input type="date" className="input" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
          </div>
          {mode === 'pay' && (
            <>
              <div className="form-group">
                <label className="label">Amount Paid</label>
                <input type="number" className="input" value={form.paidAmount} onChange={e => setForm(p => ({ ...p, paidAmount: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Penalty / Surcharge (if any)</label>
                <input type="number" className="input" value={form.penalty} onChange={e => setForm(p => ({ ...p, penalty: e.target.value }))} />
              </div>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

// ─── Main Records Page ──────────────────────────────────────────
export default function RemittanceRecords() {
  const today   = new Date();
  const [records,   setRecords]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState('All');
  const [filterYear,  setFilterYear]  = useState(String(today.getFullYear()));
  const [filterMonth, setFilterMonth] = useState('');
  const [search,      setSearch]      = useState('');

  // New/Edit drawer state
  const [drawerOpen,  setDrawerOpen]  = useState(false);
  const [editing,     setEditing]     = useState(null);  // existing record or null

  // Form state
  const [step,         setStep]       = useState(1);  // 1=select type+period, 2=amounts
  const [formType,     setFormType]   = useState('');
  const [formMonth,    setFormMonth]  = useState(String(today.getMonth() + 1));
  const [formYear,     setFormYear]   = useState(String(today.getFullYear()));
  const [calcMode,     setCalcMode]   = useState('auto'); // auto | manual
  const [calcLoading,  setCalcLoading] = useState(false);
  const [calcData,     setCalcData]   = useState(null);
  // Editable amounts (manual or overridden)
  const [eeShare, setEeShare] = useState('');
  const [erShare, setErShare] = useState('');
  const [total,   setTotal]   = useState('');
  const [notes,   setNotes]   = useState('');
  const [details, setDetails] = useState([]); // per-employee rows

  // Action sub-drawers
  const [actionMode,   setActionMode]   = useState(''); // 'file' | 'pay'
  const [actionRecord, setActionRecord] = useState(null);
  const [actionOpen,   setActionOpen]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = {};
    const typeMap = { SSS: 'SSS', PhilHealth: 'PHILHEALTH', 'Pag-IBIG': 'PAGIBIG', 'BIR 1601-C': 'BIR_1601C' };
    if (tab !== 'All') params.type = typeMap[tab];
    if (filterYear)  params.year  = filterYear;
    if (filterMonth) params.month = filterMonth;
    try {
      const res = await remittanceApi.list(params);
      setRecords(res.data);
    } catch { toast.error('Failed to load records'); }
    finally  { setLoading(false); }
  }, [tab, filterYear, filterMonth]);

  useEffect(() => { load(); }, [load]);

  // Sync total when ee/er changes in manual mode
  useEffect(() => {
    if (calcMode === 'manual') {
      setTotal(String((Number(eeShare || 0) + Number(erShare || 0)).toFixed(2)));
    }
  }, [eeShare, erShare, calcMode]);

  function openNew() {
    setEditing(null);
    setStep(1);
    setFormType('');
    setFormMonth(String(today.getMonth() + 1));
    setFormYear(String(today.getFullYear()));
    setCalcMode('auto');
    setCalcData(null);
    setEeShare(''); setErShare(''); setTotal(''); setNotes('');
    setDetails([]);
    setDrawerOpen(true);
  }

  function openEdit(rec) {
    setEditing(rec);
    setStep(2);
    setFormType(rec.type);
    setFormMonth(String(rec.periodMonth));
    setFormYear(String(rec.periodYear));
    setCalcMode('manual');
    setCalcData(null);
    setEeShare(String(rec.totalEmployeeShare));
    setErShare(String(rec.totalEmployerShare));
    setTotal(String(rec.totalAmount));
    setNotes(rec.notes || '');
    setDetails(rec.details || []);
    setDrawerOpen(true);
  }

  async function doCalculate() {
    if (!formType || !formMonth || !formYear) { toast.error('Select type, month, and year first'); return; }
    setCalcLoading(true);
    try {
      const res = await remittanceApi.calculate({ type: formType, periodMonth: Number(formMonth), periodYear: Number(formYear) });
      setCalcData(res.data);
      setEeShare(String(res.data.totalEmployeeShare.toFixed(2)));
      setErShare(String(res.data.totalEmployerShare.toFixed(2)));
      setTotal(String(res.data.totalAmount.toFixed(2)));
      setDetails(res.data.details.map(d => ({ ...d, employeeId: d.employee.id })));
      setStep(2);
    } catch (e) { toast.error(e?.response?.data?.error || 'Calculation failed'); }
    finally     { setCalcLoading(false); }
  }

  function proceedManual() {
    if (!formType || !formMonth || !formYear) { toast.error('Select type, month, and year first'); return; }
    setCalcData(null);
    setEeShare(''); setErShare(''); setTotal('');
    setDetails([]);
    setStep(2);
  }

  async function handleSave(status) {
    const payload = {
      type:               formType,
      periodMonth:        Number(formMonth),
      periodYear:         Number(formYear),
      totalEmployeeShare: Number(eeShare || 0),
      totalEmployerShare: Number(erShare || 0),
      totalAmount:        Number(total   || 0),
      isManual:           calcMode === 'manual',
      notes,
      details: details.map(d => ({
        employeeId:        d.employeeId,
        employeeShare:     d.employeeShare,
        employerShare:     d.employerShare,
        totalContribution: d.totalContribution,
        grossCompensation: d.grossCompensation,
      })),
    };

    try {
      if (editing) {
        await remittanceApi.update(editing.id, payload);
        toast.success('Updated');
      } else {
        await remittanceApi.create(payload);
        toast.success('Created');
      }
      setDrawerOpen(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Save failed'); }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this remittance record?')) return;
    try {
      await remittanceApi.remove(id);
      toast.success('Deleted');
      load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Delete failed'); }
  }

  function openAction(mode, rec) {
    setActionMode(mode);
    setActionRecord(rec);
    setActionOpen(true);
  }

  function handlePrint() {
    const rows = filteredRecords.map(r => `
      <tr>
        <td>${TYPE_OPTIONS.find(t => t.value === r.type)?.label}</td>
        <td>${MONTHS_SHORT[r.periodMonth - 1]} ${r.periodYear}</td>
        <td>${new Date(r.dueDate).toLocaleDateString('en-PH')}</td>
        <td style="text-align:right">${fmt(r.totalEmployeeShare)}</td>
        <td style="text-align:right">${fmt(r.totalEmployerShare)}</td>
        <td style="text-align:right"><strong>${fmt(r.totalAmount)}</strong></td>
        <td>${r.referenceNo || '—'}</td>
        <td><span style="padding:2px 8px;border-radius:9px;font-size:11px;
          background:${r.status==='PAID'?'#dcfce7':r.status==='FILED'?'#dbeafe':r.status==='OVERDUE'?'#fee2e2':'#f3f4f6'};
          color:${r.status==='PAID'?'#15803d':r.status==='FILED'?'#1d4ed8':r.status==='OVERDUE'?'#b91c1c':'#374151'}">
          ${r.status}</span></td>
      </tr>`).join('');
    printDocument('Remittance Records', `${tab !== 'All' ? tab : 'All Types'} · ${filterYear}${search ? ` · Search: "${search}"` : ''}`, `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f8fafc">
            ${['Type','Period','Due Date','EE Share','ER Share','Total','Reference','Status']
              .map(h=>`<th style="padding:8px;border:1px solid #e2e8f0;text-align:left">${h}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`);
  }

  const typeOpt = TYPE_OPTIONS.find(t => t.value === formType);
  const isBIR   = formType === 'BIR_1601C';

  // Year options for filter
  const yearOptions = [];
  for (let y = today.getFullYear() + 1; y >= 2020; y--) yearOptions.push(y);

  // Client-side search — the page already loads a full year/type at once (no
  // pagination), so filtering the fetched set is simpler than a server round-trip.
  const q = search.trim().toLowerCase();
  const filteredRecords = !q ? records : records.filter(r => {
    const tOpt = TYPE_OPTIONS.find(t => t.value === r.type);
    return [tOpt?.label, r.referenceNo, r.notes, r.status, `${MONTHS_LONG[r.periodMonth - 1]} ${r.periodYear}`]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Remittance Records</h1>
          <p className="page-subtitle">Track SSS, PhilHealth, Pag-IBIG, and BIR 1601-C contributions</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></button>
          <button className="btn-secondary btn-sm" onClick={handlePrint}><Printer className="w-3.5 h-3.5" /> Print</button>
          <button className="btn-primary btn-sm" onClick={openNew}><Plus className="w-4 h-4" /> New Remittance</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Type Tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {TABS.map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Search reference no., notes, status…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-2 ml-auto">
              <select className="input w-36" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select className="input w-36" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}>
                <option value="">All Months</option>
                {MONTHS_LONG.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Records Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th><th>Period</th><th>Due Date</th>
                <th className="text-right">EE Share</th>
                <th className="text-right">ER Share</th>
                <th className="text-right">Total</th>
                <th>Reference</th><th>Status</th><th>Filed / Paid</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    <Landmark className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                    <p>No remittance records. Click <strong>New Remittance</strong> to start.</p>
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400">No records match "{search}"</td></tr>
              ) : filteredRecords.map(r => {
                const tOpt   = TYPE_OPTIONS.find(t => t.value === r.type);
                const canEdit = r.status !== 'PAID';
                return (
                  <tr key={r.id}>
                    <td><span className={`badge badge-${tOpt?.color || 'gray'}`}>{tOpt?.label}</span></td>
                    <td className="font-medium">{MONTHS_SHORT[r.periodMonth - 1]} {r.periodYear}</td>
                    <td className="text-sm text-gray-500">{new Date(r.dueDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="text-right text-sm">{fmt(r.totalEmployeeShare)}</td>
                    <td className="text-right text-sm">{fmt(r.totalEmployerShare)}</td>
                    <td className="text-right font-semibold">{fmt(r.totalAmount)}</td>
                    <td className="text-xs text-gray-500">{r.referenceNo || '—'}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                    <td className="text-xs text-gray-400">
                      {r.status === 'PAID'  && r.paidDate  && new Date(r.paidDate ).toLocaleDateString('en-PH')}
                      {r.status === 'FILED' && r.filedDate && new Date(r.filedDate).toLocaleDateString('en-PH')}
                    </td>
                    <td>
                      <div className="flex gap-1 flex-nowrap">
                        {canEdit && <button className="btn-secondary btn-sm" onClick={() => openEdit(r)}><Edit2 className="w-3 h-3" /></button>}
                        {(r.status === 'DRAFT' || r.status === 'OVERDUE') && (
                          <button className="btn-secondary btn-sm" onClick={() => openAction('file', r)} title="Mark Filed"><Clock className="w-3 h-3" /></button>
                        )}
                        {(r.status === 'DRAFT' || r.status === 'FILED' || r.status === 'OVERDUE') && (
                          <button className="btn-success btn-sm" onClick={() => openAction('pay', r)} title="Mark Paid"><CheckCircle2 className="w-3 h-3" /></button>
                        )}
                        {(r.status === 'DRAFT' || r.status === 'OVERDUE') && (
                          <button className="btn-danger btn-sm" onClick={() => handleDelete(r.id)}><Trash2 className="w-3 h-3" /></button>
                        )}
                        <button className="btn-secondary btn-sm" onClick={() => handlePrintSingle(r)}><Printer className="w-3 h-3" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ──── New / Edit Drawer ──── */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? `Edit — ${TYPE_OPTIONS.find(t=>t.value===editing.type)?.label} ${MONTHS_SHORT[editing.periodMonth-1]} ${editing.periodYear}` : 'New Remittance'}
        footer={
          step === 1 ? (
            <>
              <button className="btn-secondary" onClick={() => setDrawerOpen(false)}>Cancel</button>
              {calcMode === 'auto'
                ? <button className="btn-primary" onClick={doCalculate} disabled={calcLoading}>{calcLoading ? 'Calculating…' : <><Calculator className="w-4 h-4" /> Auto-Calculate</>}</button>
                : <button className="btn-primary" onClick={proceedManual}>Continue →</button>
              }
            </>
          ) : (
            <>
              {!editing && <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>}
              <button className="btn-secondary" onClick={() => setDrawerOpen(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => handleSave()}>Save as Draft</button>
            </>
          )
        }
      >
        {step === 1 ? (
          /* ── Step 1: Type + Period + Mode ── */
          <div className="space-y-5">
            {/* Type selector */}
            <div>
              <label className="label">Remittance Type</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                {TYPE_OPTIONS.map(t => (
                  <button key={t.value} type="button"
                    onClick={() => setFormType(t.value)}
                    className={`border-2 rounded-xl p-3 text-left transition-all ${formType === t.value ? `border-${t.color}-400 bg-${t.color}-50` : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                    <div className={`font-semibold text-sm ${formType === t.value ? `text-${t.color}-700` : 'text-gray-900'}`}>{t.label}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{t.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Period */}
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Period Month</label>
                <select className="input" value={formMonth} onChange={e => setFormMonth(e.target.value)}>
                  {MONTHS_LONG.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Period Year</label>
                <select className="input" value={formYear} onChange={e => setFormYear(e.target.value)}>
                  {[2026, 2025, 2024, 2023, 2022].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>

            {/* Calculation Mode */}
            <div>
              <label className="label">Calculation Mode</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button type="button" onClick={() => setCalcMode('auto')}
                  className={`border-2 rounded-xl p-3 text-left transition-all ${calcMode === 'auto' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className={`font-semibold text-sm ${calcMode === 'auto' ? 'text-blue-700' : 'text-gray-900'}`}>Auto-Calculate</div>
                  <div className="text-xs text-gray-500 mt-0.5">Pull totals from approved payroll data for the period</div>
                </button>
                <button type="button" onClick={() => setCalcMode('manual')}
                  className={`border-2 rounded-xl p-3 text-left transition-all ${calcMode === 'manual' ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                  <div className={`font-semibold text-sm ${calcMode === 'manual' ? 'text-blue-700' : 'text-gray-900'}`}>Manual Entry</div>
                  <div className="text-xs text-gray-500 mt-0.5">Enter amounts directly (for adjustments or special cases)</div>
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ── Step 2: Amounts ── */
          <div className="space-y-5">
            {/* Period info banner */}
            {typeOpt && (
              <div className={`rounded-xl p-4 border text-sm ${COLOR_CLASSES[typeOpt.color]}`}>
                <div className="font-semibold">{typeOpt.label} — {MONTHS_LONG[Number(formMonth)-1]} {formYear}</div>
                {calcData && <div className="text-xs mt-1 opacity-80">{calcData.payrollPeriodsCount} payroll item(s) found for the period</div>}
                {calcMode === 'manual' && !calcData && <div className="text-xs mt-1 opacity-80">Manual entry mode</div>}
              </div>
            )}

            {/* Amounts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="form-group">
                <label className="label">Employee Share (EE)</label>
                <input type="number" className="input" value={eeShare} onChange={e => setEeShare(e.target.value)}
                  placeholder="0.00" step="0.01" min="0" />
              </div>
              <div className="form-group">
                <label className="label">{isBIR ? 'Employer Share (N/A)' : 'Employer Share (ER)'}</label>
                <input type="number" className="input" value={erShare}
                  onChange={e => { setErShare(e.target.value); }}
                  placeholder="0.00" step="0.01" min="0" disabled={isBIR} />
              </div>
              <div className="form-group">
                <label className="label">Total Amount</label>
                <input type="number" className="input font-semibold" value={total} onChange={e => setTotal(e.target.value)}
                  placeholder="0.00" step="0.01" min="0" readOnly={calcMode === 'manual'} />
              </div>
            </div>

            {/* Notes */}
            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input h-20 resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />
            </div>

            {/* Per-employee breakdown */}
            {details.length > 0 && (
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Employee Breakdown ({details.length})</div>
                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <table className="table text-xs">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th className="text-right">EE Share</th>
                        {!isBIR && <th className="text-right">ER Share</th>}
                        {isBIR && <th className="text-right">Gross Pay</th>}
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {details.map((d, i) => {
                        const emp = d.employee || {};
                        const name = emp.firstName ? `${emp.firstName} ${emp.lastName}` : `Employee #${d.employeeId}`;
                        return (
                          <tr key={i}>
                            <td>
                              <div className="font-medium text-gray-800">{name}</div>
                              <div className="text-gray-400">{emp.employeeNo}</div>
                            </td>
                            <td className="text-right">{fmt(d.employeeShare)}</td>
                            {!isBIR && <td className="text-right">{fmt(d.employerShare)}</td>}
                            {isBIR  && <td className="text-right">{fmt(d.grossCompensation)}</td>}
                            <td className="text-right font-semibold">{fmt(d.totalContribution)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 font-semibold">
                        <td>Total</td>
                        <td className="text-right">{fmt(eeShare)}</td>
                        {!isBIR && <td className="text-right">{fmt(erShare)}</td>}
                        {isBIR  && <td className="text-right"></td>}
                        <td className="text-right">{fmt(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* ──── File / Pay Sub-drawer ──── */}
      <ActionDrawer
        mode={actionMode}
        record={actionRecord}
        open={actionOpen}
        onClose={() => setActionOpen(false)}
        onDone={load}
      />
    </div>
  );
}

// Single record print (defined outside component so it's accessible inside the table's button)
function handlePrintSingle(r) {
  const TYPE_LABELS = { SSS: 'SSS', PHILHEALTH: 'PhilHealth', PAGIBIG: 'Pag-IBIG', BIR_1601C: 'BIR 1601-C' };
  const fmtCur = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(n || 0));
  const mo = MONTHS_LONG[r.periodMonth - 1];
  const details = r.details || [];
  const isBIR   = r.type === 'BIR_1601C';

  const detailRows = details.map(d => {
    const emp  = d.employee || {};
    const name = emp.firstName ? `${emp.firstName} ${emp.lastName}` : `Employee #${d.employeeId}`;
    return `<tr>
      <td>${emp.employeeNo || ''}</td>
      <td>${name}</td>
      <td style="text-align:right">${fmtCur(d.employeeShare)}</td>
      ${!isBIR ? `<td style="text-align:right">${fmtCur(d.employerShare)}</td>` : `<td style="text-align:right">${fmtCur(d.grossCompensation)}</td>`}
      <td style="text-align:right"><strong>${fmtCur(d.totalContribution)}</strong></td>
    </tr>`;
  }).join('');

  printDocument(
    `${TYPE_LABELS[r.type]} Remittance Schedule`,
    `Period: ${mo} ${r.periodYear}`,
    `
    <div style="margin-bottom:16px;padding:12px;background:#f8fafc;border-radius:8px;font-size:12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div><strong>Type:</strong> ${TYPE_LABELS[r.type]}</div>
      <div><strong>Period:</strong> ${mo} ${r.periodYear}</div>
      <div><strong>Status:</strong> ${r.status}</div>
      <div><strong>Due Date:</strong> ${new Date(r.dueDate).toLocaleDateString('en-PH')}</div>
      <div><strong>Reference:</strong> ${r.referenceNo || '—'}</div>
      <div><strong>Penalty:</strong> ${fmtCur(r.penalty)}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Emp No.</th>
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Employee</th>
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">EE Share</th>
          ${!isBIR ? '<th style="padding:8px;border:1px solid #e2e8f0;text-align:right">ER Share</th>' : '<th style="padding:8px;border:1px solid #e2e8f0;text-align:right">Gross Pay</th>'}
          <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${detailRows || '<tr><td colspan="5" style="text-align:center;padding:16px;color:#9ca3af">No employee breakdown recorded</td></tr>'}</tbody>
      <tfoot>
        <tr style="background:#f8fafc;font-weight:700">
          <td colspan="2" style="padding:8px;border:1px solid #e2e8f0">TOTAL</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${fmtCur(r.totalEmployeeShare)}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${fmtCur(r.totalEmployerShare)}</td>
          <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${fmtCur(r.totalAmount)}</td>
        </tr>
        ${Number(r.penalty) > 0 ? `<tr><td colspan="4" style="padding:8px;border:1px solid #e2e8f0;text-align:right;color:#dc2626">Penalty / Surcharge</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right;color:#dc2626">${fmtCur(r.penalty)}</td></tr>` : ''}
      </tfoot>
    </table>
    ${r.notes ? `<p style="font-size:12px;color:#6b7280"><strong>Notes:</strong> ${r.notes}</p>` : ''}
    `
  );
}
