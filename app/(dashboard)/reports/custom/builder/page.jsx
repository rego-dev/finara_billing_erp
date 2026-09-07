'use client';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { customReports, accounts } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  FileText, Save, Play, ArrowLeft, Plus, X, ChevronDown, ChevronUp,
  Settings, Calendar, BarChart2, TrendingUp, Activity,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import Link from 'next/link';

// ─── Report type definitions ────────────────────────────────────
const REPORT_TYPES = [
  {
    value: 'account_balance',
    label: 'Account Balance',
    icon: PesoSign,
    color: 'blue',
    description: 'Account balances as of a specific date (debit, credit, net balance)',
    fields: ['asOf', 'accountTypes', 'accountIds', 'showZeroBalances'],
  },
  {
    value: 'period_comparison',
    label: 'Period Comparison',
    icon: BarChart2,
    color: 'purple',
    description: 'Compare balances between two date ranges side by side with variance',
    fields: ['period1', 'period2', 'labels', 'accountTypes', 'accountIds'],
  },
  {
    value: 'account_movement',
    label: 'Account Movement',
    icon: Activity,
    color: 'orange',
    description: 'Line-by-line journal activity for selected accounts within a date range',
    fields: ['from', 'to', 'accountTypes', 'accountIds'],
  },
  {
    value: 'profit_loss',
    label: 'Profit & Loss',
    icon: TrendingUp,
    color: 'green',
    description: 'Revenue vs Expenses summary with net income for a date range',
    fields: ['from', 'to'],
  },
];

const ACCOUNT_TYPES = [
  { value: 'ASSET',     label: 'Assets',      color: 'blue' },
  { value: 'LIABILITY', label: 'Liabilities', color: 'red' },
  { value: 'EQUITY',    label: 'Equity',      color: 'purple' },
  { value: 'REVENUE',   label: 'Revenue',     color: 'green' },
  { value: 'EXPENSE',   label: 'Expenses',    color: 'orange' },
];

const COLOR_MAP = {
  blue: 'bg-blue-50 border-blue-200 text-blue-700',
  purple: 'bg-purple-50 border-purple-200 text-purple-700',
  orange: 'bg-orange-50 border-orange-200 text-orange-700',
  green: 'bg-green-50 border-green-200 text-green-700',
  red: 'bg-red-50 border-red-200 text-red-700',
};

const today = new Date().toISOString().split('T')[0];
const firstOfYear = `${new Date().getFullYear()}-01-01`;

// ─── Main page ──────────────────────────────────────────────────
export default function ReportBuilderPage() {
  const router = useRouter();
  const params = useSearchParams();
  const editId = params.get('edit');

  const [step, setStep]             = useState(editId ? 2 : 1); // 1=type, 2=config, 3=preview
  const [name, setName]             = useState('');
  const [description, setDescription] = useState('');
  const [reportType, setReportType] = useState('');
  const [config, setConfig]         = useState({});
  const [allAccounts, setAllAccounts] = useState([]);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountPanelOpen, setAccountPanelOpen] = useState(false);

  // Load all accounts for picker
  useEffect(() => {
    accounts.list({ limit: 500 }).then((r) => setAllAccounts(r.data?.data || [])).catch(() => toast.error('Failed to load accounts'));
  }, []);

  // Load existing report for editing
  useEffect(() => {
    if (!editId) return;
    customReports.get(editId).then((r) => {
      setName(r.data.name);
      setDescription(r.data.description || '');
      setReportType(r.data.reportType);
      setConfig(r.data.config || {});
    }).catch(() => toast.error('Failed to load report'));
  }, [editId]);

  const selectedType = REPORT_TYPES.find((t) => t.value === reportType);

  const setConfigField = (key, value) => setConfig((prev) => ({ ...prev, [key]: value }));

  const toggleAccountType = (type) => {
    const current = config.accountTypes || [];
    setConfigField('accountTypes', current.includes(type) ? current.filter((t) => t !== type) : [...current, type]);
  };

  const toggleAccountId = (id) => {
    const current = config.accountIds || [];
    setConfigField('accountIds', current.includes(id) ? current.filter((i) => i !== id) : [...current, id]);
  };

  const handlePreview = async () => {
    if (!reportType) return toast.error('Select a report type first');
    setPreviewLoading(true);
    try {
      const r = await customReports.preview({ reportType, config });
      setPreviewData(r.data);
      setStep(3);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return toast.error('Report name is required');
    if (!reportType)  return toast.error('Select a report type');
    setSaving(true);
    try {
      const payload = { name, description, reportType, config };
      if (editId) {
        await customReports.update(editId, payload);
        toast.success('Report updated');
      } else {
        const r = await customReports.create(payload);
        toast.success('Report saved');
        router.push(`/reports/custom/${r.data.id}`);
        return;
      }
      router.push('/reports/custom');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const filteredAccounts = allAccounts.filter((a) => {
    const matchType = !config.accountTypes?.length || config.accountTypes.includes(a.accountType);
    const matchSearch = !accountSearch ||
      a.accountName.toLowerCase().includes(accountSearch.toLowerCase()) ||
      a.accountCode.includes(accountSearch);
    return matchType && matchSearch;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link href="/reports/custom" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="page-title">{editId ? 'Edit Report' : 'Report Builder'}</h1>
            <p className="page-subtitle">Design a custom report tailored to your needs</p>
          </div>
        </div>
        <div className="flex gap-2">
          {step === 3 && (
            <button onClick={() => setStep(2)} className="btn-secondary">
              <Settings className="w-4 h-4" /> Edit Config
            </button>
          )}
          {step >= 2 && (
            <button onClick={handlePreview} disabled={previewLoading} className="btn-secondary">
              <Play className={`w-4 h-4 ${previewLoading ? 'animate-pulse' : ''}`} />
              {previewLoading ? 'Running…' : 'Preview'}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !reportType || !name.trim()} className="btn-primary">
            <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Report'}
          </button>
        </div>
      </div>

      {/* Step 1 — Choose type */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Report Name</h2>
            <input
              className="input w-full mb-4"
              placeholder="e.g., Q2 Revenue Breakdown"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <h2 className="text-sm font-semibold text-gray-700 mb-1">Description <span className="text-gray-400 font-normal">(optional)</span></h2>
            <textarea
              className="input w-full resize-none"
              rows={2}
              placeholder="What does this report show?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <p className="text-sm font-semibold text-gray-600 px-1">Choose a report type:</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {REPORT_TYPES.map((t) => {
              const Icon = t.icon;
              const isSelected = reportType === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => { setReportType(t.value); setStep(2); setConfig(buildDefaults(t.value)); }}
                  className={`text-left p-5 rounded-2xl border-2 transition-all ${isSelected ? `border-blue-500 bg-blue-50` : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/30'}`}
                >
                  <div className={`inline-flex p-2 rounded-xl mb-3 ${COLOR_MAP[t.color]}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <p className="font-semibold text-gray-900 mb-1">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 2 — Configure */}
      {step === 2 && selectedType && (
        <div className="grid grid-cols-1 lg:grid-cols-1 sm:grid-cols-3 gap-5">
          {/* Left: fields */}
          <div className="lg:col-span-2 space-y-4">
            {/* Name / description card */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-500" /> Report Details
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="label">Report Name *</label>
                  <input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Report name…" />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input w-full resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
              </div>
            </div>

            {/* Date fields */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-500" /> Date Parameters
              </h2>
              <DateFields type={reportType} config={config} setConfigField={setConfigField} />
            </div>

            {/* Account filter */}
            {selectedType.fields.includes('accountTypes') && (
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Settings className="w-4 h-4 text-blue-500" /> Account Filter
                  <span className="text-xs text-gray-400 font-normal ml-1">(leave all unchecked = include all)</span>
                </h2>
                <div className="flex flex-wrap gap-2 mb-4">
                  {ACCOUNT_TYPES.map((at) => {
                    const active = (config.accountTypes || []).includes(at.value);
                    return (
                      <button
                        key={at.value}
                        onClick={() => toggleAccountType(at.value)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${active ? COLOR_MAP[at.color] + ' border-current' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                      >
                        {at.label}
                      </button>
                    );
                  })}
                </div>

                {/* Specific accounts picker */}
                <button
                  onClick={() => setAccountPanelOpen(!accountPanelOpen)}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  {accountPanelOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  {config.accountIds?.length ? `${config.accountIds.length} specific accounts selected` : 'Pin specific accounts (optional)'}
                </button>

                {accountPanelOpen && (
                  <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
                    <div className="p-2 border-b border-gray-100 bg-gray-50">
                      <input
                        className="input text-sm w-full"
                        placeholder="Search by name or code…"
                        value={accountSearch}
                        onChange={(e) => setAccountSearch(e.target.value)}
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                      {filteredAccounts.slice(0, 80).map((a) => {
                        const selected = (config.accountIds || []).includes(a.id);
                        return (
                          <label key={a.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                            <input type="checkbox" checked={selected} onChange={() => toggleAccountId(a.id)} className="rounded" />
                            <span className="font-mono text-xs text-blue-600 w-16 flex-shrink-0">{a.accountCode}</span>
                            <span className="text-sm text-gray-700 truncate">{a.accountName}</span>
                            <span className="ml-auto text-xs text-gray-400">{a.accountType}</span>
                          </label>
                        );
                      })}
                      {filteredAccounts.length === 0 && (
                        <p className="text-sm text-gray-400 text-center py-4">No accounts found</p>
                      )}
                    </div>
                    {(config.accountIds || []).length > 0 && (
                      <div className="p-2 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                        <span className="text-xs text-gray-500">{config.accountIds.length} selected</span>
                        <button onClick={() => setConfigField('accountIds', [])} className="text-xs text-red-500 hover:text-red-700">Clear all</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Show zero toggle */}
                {selectedType.fields.includes('showZeroBalances') && (
                  <div className="mt-4 flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="showZero"
                      checked={config.showZeroBalances || false}
                      onChange={(e) => setConfigField('showZeroBalances', e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="showZero" className="text-sm text-gray-600">Show zero-balance accounts</label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: summary card */}
          <div className="space-y-4">
            <div className={`card p-5 border-2 ${COLOR_MAP[selectedType.color]}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-xl ${COLOR_MAP[selectedType.color]}`}>
                  <selectedType.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{selectedType.label}</p>
                  <p className="text-xs text-gray-500">Selected type</p>
                </div>
              </div>
              <p className="text-xs text-gray-600 mb-4">{selectedType.description}</p>
              <button onClick={() => { setStep(1); setReportType(''); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                ← Change type
              </button>
            </div>

            <div className="card p-5">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Configuration Summary</p>
              <ConfigSummary type={reportType} config={config} />
            </div>

            <button
              onClick={handlePreview}
              disabled={previewLoading}
              className="btn-primary w-full justify-center"
            >
              <Play className="w-4 h-4" />
              {previewLoading ? 'Running…' : 'Preview Report'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Preview */}
      {step === 3 && previewData && (
        <ReportPreview reportType={reportType} data={previewData} config={config} name={name} />
      )}
    </div>
  );
}

// ─── Date fields by report type ─────────────────────────────────
function DateFields({ type, config, setConfigField }) {
  if (type === 'account_balance') {
    return (
      <div>
        <label className="label">As of Date</label>
        <input type="date" className="input w-48" value={config.asOf || today} max={today}
          onChange={(e) => setConfigField('asOf', e.target.value)} />
      </div>
    );
  }

  if (type === 'period_comparison') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Period 1</p>
          <div className="space-y-2">
            <div>
              <label className="label text-xs">Label</label>
              <input className="input w-full text-sm" value={config.label1 || 'Period 1'} onChange={(e) => setConfigField('label1', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input w-full text-sm" value={config.period1From || firstOfYear}
                onChange={(e) => setConfigField('period1From', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input w-full text-sm" value={config.period1To || today}
                onChange={(e) => setConfigField('period1To', e.target.value)} />
            </div>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Period 2</p>
          <div className="space-y-2">
            <div>
              <label className="label text-xs">Label</label>
              <input className="input w-full text-sm" value={config.label2 || 'Period 2'} onChange={(e) => setConfigField('label2', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">From</label>
              <input type="date" className="input w-full text-sm" value={config.period2From || ''}
                onChange={(e) => setConfigField('period2From', e.target.value)} />
            </div>
            <div>
              <label className="label text-xs">To</label>
              <input type="date" className="input w-full text-sm" value={config.period2To || ''}
                onChange={(e) => setConfigField('period2To', e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <div>
        <label className="label">From</label>
        <input type="date" className="input w-48" value={config.from || firstOfYear}
          onChange={(e) => setConfigField('from', e.target.value)} />
      </div>
      <div>
        <label className="label">To</label>
        <input type="date" className="input w-48" value={config.to || today}
          onChange={(e) => setConfigField('to', e.target.value)} />
      </div>
    </div>
  );
}

// ─── Config summary for sidebar card ───────────────────────────
function ConfigSummary({ type, config }) {
  const items = [];
  if (config.asOf)        items.push({ label: 'As of', value: formatDate(config.asOf) });
  if (config.from)        items.push({ label: 'From', value: formatDate(config.from) });
  if (config.to)          items.push({ label: 'To', value: formatDate(config.to) });
  if (config.period1From) items.push({ label: `${config.label1 || 'P1'} from`, value: formatDate(config.period1From) });
  if (config.period1To)   items.push({ label: `${config.label1 || 'P1'} to`, value: formatDate(config.period1To) });
  if (config.period2From) items.push({ label: `${config.label2 || 'P2'} from`, value: formatDate(config.period2From) });
  if (config.period2To)   items.push({ label: `${config.label2 || 'P2'} to`, value: formatDate(config.period2To) });
  if (config.accountTypes?.length) items.push({ label: 'Types', value: config.accountTypes.join(', ') });
  if (config.accountIds?.length)   items.push({ label: 'Pinned accounts', value: `${config.accountIds.length} selected` });

  if (!items.length) return <p className="text-xs text-gray-400">No parameters set yet</p>;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="flex justify-between text-xs">
          <span className="text-gray-400">{item.label}</span>
          <span className="text-gray-700 font-medium text-right max-w-32 truncate">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Report preview tables ──────────────────────────────────────
function ReportPreview({ reportType, data, config, name }) {
  if (reportType === 'account_balance') return <AccountBalancePreview data={data} config={config} name={name} />;
  if (reportType === 'period_comparison') return <PeriodComparisonPreview data={data} config={config} name={name} />;
  if (reportType === 'account_movement') return <AccountMovementPreview data={data} config={config} name={name} />;
  if (reportType === 'profit_loss') return <ProfitLossPreview data={data} config={config} name={name} />;
  return null;
}

function AccountBalancePreview({ data, config, name }) {
  const byType = data.rows.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r); return acc; }, {});
  return (
    <div className="card overflow-hidden">
      <div className="card-body border-b border-gray-100 flex justify-between items-center">
        <div>
          <p className="font-semibold text-gray-800">{name || 'Account Balance'}</p>
          <p className="text-xs text-gray-400">As of {formatDate(config.asOf)} · {data.rowCount} accounts</p>
        </div>
        <div className="flex gap-4 text-right">
          <div><p className="text-xs text-gray-400">Total Debit</p><p className="font-bold text-gray-900">{formatCurrency(data.totals.debit)}</p></div>
          <div><p className="text-xs text-gray-400">Total Credit</p><p className="font-bold text-gray-900">{formatCurrency(data.totals.credit)}</p></div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-800 text-white">
            <th className="text-left px-4 py-3">Code</th>
            <th className="text-left px-4 py-3">Account</th>
            <th className="text-left px-4 py-3">Type</th>
            <th className="text-right px-4 py-3">Debit</th>
            <th className="text-right px-4 py-3">Credit</th>
            <th className="text-right px-4 py-3">Balance</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {Object.entries(byType).map(([type, rows]) => (
              <>
                <tr key={type} className="bg-blue-50"><td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-blue-700">{type}</td></tr>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                    <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{r.type}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{r.debit > 0 ? formatCurrency(r.debit) : '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-sm">{r.credit > 0 ? formatCurrency(r.credit) : '—'}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${r.balance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(r.balance)}</td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
          <tfoot><tr className="bg-gray-100 font-bold">
            <td colSpan={3} className="px-4 py-3 text-gray-700">TOTAL</td>
            <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.debit)}</td>
            <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.credit)}</td>
            <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.balance)}</td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  );
}

function PeriodComparisonPreview({ data, config, name }) {
  return (
    <div className="card overflow-hidden">
      <div className="card-body border-b border-gray-100">
        <p className="font-semibold text-gray-800">{name || 'Period Comparison'}</p>
        <p className="text-xs text-gray-400">{data.rowCount} accounts with activity</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-800 text-white">
            <th className="text-left px-4 py-3">Code</th>
            <th className="text-left px-4 py-3">Account</th>
            <th className="text-right px-4 py-3">{data.label1}</th>
            <th className="text-right px-4 py-3">{data.label2}</th>
            <th className="text-right px-4 py-3">Variance</th>
            <th className="text-right px-4 py-3">%</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {data.rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm">{formatCurrency(r.bal1)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm">{formatCurrency(r.bal2)}</td>
                <td className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${r.variance > 0 ? 'text-green-600' : r.variance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {r.variance !== 0 ? (r.variance > 0 ? '+' : '') + formatCurrency(r.variance) : '—'}
                </td>
                <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.variance > 0 ? 'text-green-600' : r.variance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {r.variancePct !== null ? `${r.variancePct > 0 ? '+' : ''}${r.variancePct.toFixed(1)}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountMovementPreview({ data, config, name }) {
  const [expandedAccounts, setExpandedAccounts] = useState({});
  const toggle = (id) => setExpandedAccounts((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-3">
      <div className="card p-4 flex justify-between items-center">
        <div>
          <p className="font-semibold text-gray-800">{name || 'Account Movement'}</p>
          <p className="text-xs text-gray-400">{formatDate(config.from)} — {formatDate(config.to)} · {data.rowCount} accounts</p>
        </div>
      </div>
      {data.rows.map((r) => (
        <div key={r.id} className="card overflow-hidden">
          <button
            onClick={() => toggle(r.id)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-blue-600">{r.code}</span>
              <span className="font-semibold text-gray-800 text-sm">{r.name}</span>
              <span className="badge badge-blue text-xs">{r.lines.length} entries</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">Dr: <span className="font-mono font-semibold text-gray-800">{formatCurrency(r.totalDebit)}</span></span>
              <span className="text-gray-500">Cr: <span className="font-mono font-semibold text-gray-800">{formatCurrency(r.totalCredit)}</span></span>
              {expandedAccounts[r.id] ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>
          {expandedAccounts[r.id] && (
            <table className="w-full text-xs">
              <thead><tr className="bg-white border-b border-gray-100">
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Entry No.</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Date</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Description</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Debit</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Credit</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {r.lines.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-blue-600">{l.entryNo}</td>
                    <td className="px-4 py-2 text-gray-500">{formatDate(l.date)}</td>
                    <td className="px-4 py-2 text-gray-700 truncate max-w-xs">{l.description}</td>
                    <td className="px-4 py-2 text-right font-mono">{l.debit > 0 ? formatCurrency(l.debit) : '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{l.credit > 0 ? formatCurrency(l.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function ProfitLossPreview({ data, config, name }) {
  const revenue  = data.rows.filter((r) => r.type === 'REVENUE');
  const expenses = data.rows.filter((r) => r.type === 'EXPENSE');

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4 border-l-4 border-green-400">
          <p className="text-xs text-gray-400 mb-1">Total Revenue</p>
          <p className="text-xl font-bold text-green-600">{formatCurrency(data.revenue)}</p>
        </div>
        <div className="card p-4 border-l-4 border-red-400">
          <p className="text-xs text-gray-400 mb-1">Total Expenses</p>
          <p className="text-xl font-bold text-red-600">{formatCurrency(data.expenses)}</p>
        </div>
        <div className={`card p-4 border-l-4 ${data.netIncome >= 0 ? 'border-blue-400' : 'border-orange-400'}`}>
          <p className="text-xs text-gray-400 mb-1">Net Income</p>
          <p className={`text-xl font-bold ${data.netIncome >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>{formatCurrency(data.netIncome)}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="card-body border-b border-gray-100">
          <p className="font-semibold text-gray-800">{name || 'Profit & Loss'}</p>
          <p className="text-xs text-gray-400">{formatDate(config.from)} — {formatDate(config.to)}</p>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-800 text-white">
            <th className="text-left px-4 py-3">Code</th>
            <th className="text-left px-4 py-3">Account</th>
            <th className="text-right px-4 py-3">Amount</th>
          </tr></thead>
          <tbody>
            <tr className="bg-green-50"><td colSpan={3} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-green-700">Revenue</td></tr>
            {revenue.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 border-b border-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-green-700">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
            <tr className="bg-green-100"><td colSpan={2} className="px-4 py-2 font-bold text-green-800 text-sm">Total Revenue</td><td className="px-4 py-2 text-right font-mono font-bold text-green-800">{formatCurrency(data.revenue)}</td></tr>

            <tr className="bg-red-50"><td colSpan={3} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700">Expenses</td></tr>
            {expenses.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 border-b border-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-red-700">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
            <tr className="bg-red-100"><td colSpan={2} className="px-4 py-2 font-bold text-red-800 text-sm">Total Expenses</td><td className="px-4 py-2 text-right font-mono font-bold text-red-800">{formatCurrency(data.expenses)}</td></tr>

            <tr className={`font-bold text-base ${data.netIncome >= 0 ? 'bg-blue-50' : 'bg-orange-50'}`}>
              <td colSpan={2} className="px-4 py-3 text-gray-800">Net Income</td>
              <td className={`px-4 py-3 text-right font-mono ${data.netIncome >= 0 ? 'text-blue-700' : 'text-orange-600'}`}>{formatCurrency(data.netIncome)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Default config per type ────────────────────────────────────
function buildDefaults(type) {
  const base = { accountTypes: [], accountIds: [], showZeroBalances: false };
  if (type === 'account_balance')   return { ...base, asOf: today };
  if (type === 'period_comparison') return { ...base, period1From: firstOfYear, period1To: today, period2From: '', period2To: '', label1: 'Current Period', label2: 'Comparison Period' };
  if (type === 'account_movement')  return { ...base, from: firstOfYear, to: today };
  if (type === 'profit_loss')       return { from: firstOfYear, to: today };
  return base;
}
