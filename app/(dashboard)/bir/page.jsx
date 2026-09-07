'use client';
import { useState } from 'react';
import { bir as birApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { FileText, Download, RefreshCw, AlertCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';

const FORMS = [
  { key: 'vat', label: 'VAT Summary', form: '2550M / 2550Q', description: 'Monthly/quarterly VAT return data — output vs. input tax.' },
  { key: 'withholding', label: 'Withholding Tax', form: '1601-C', description: 'Monthly compensation withholding tax summary.' },
  { key: 'ewt', label: 'EWT Summary', form: '1601-EQ', description: 'Expanded withholding tax on payments to suppliers.' },
  { key: 'alphalist', label: 'Alphalist', form: 'BIR Alphalist', description: 'Annual alphalist of employees and withholding tax.' },
  { key: 'relief', label: 'RELIEF Export', form: 'BIR RELIEF', description: 'Sales and purchases data for RELIEF submission.' },
];

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function VATReport({ params }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await birApi.vatSummary(params); setData(r.data); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed to load'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={load} disabled={loading} className="btn-primary">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Generate Report
      </button>
      {data && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header"><h4 className="font-semibold text-green-700">OUTPUT VAT (Sales)</h4></div>
            <div className="card-body space-y-3 text-sm">
              <div className="flex justify-between"><span>Vatable Sales</span><span className="font-medium">{formatCurrency(data.outputVAT.vatable)}</span></div>
              <div className="flex justify-between"><span>Output VAT (12%)</span><span className="font-medium">{formatCurrency(data.outputVAT.vatAmount)}</span></div>
              <div className="flex justify-between"><span>Zero-rated Sales</span><span>{formatCurrency(data.outputVAT.zeroRated)}</span></div>
              <div className="flex justify-between"><span>Exempt Sales</span><span>{formatCurrency(data.outputVAT.exempt)}</span></div>
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h4 className="font-semibold text-orange-700">INPUT VAT (Purchases)</h4></div>
            <div className="card-body space-y-3 text-sm">
              <div className="flex justify-between"><span>Vatable Purchases</span><span className="font-medium">{formatCurrency(data.inputVAT.vatable)}</span></div>
              <div className="flex justify-between"><span>Input VAT (12%)</span><span className="font-medium">{formatCurrency(data.inputVAT.vatAmount)}</span></div>
              <div className="flex justify-between"><span>Zero-rated</span><span>{formatCurrency(data.inputVAT.zeroRated)}</span></div>
              <div className="flex justify-between"><span>Exempt</span><span>{formatCurrency(data.inputVAT.exempt)}</span></div>
            </div>
          </div>
          <div className={`card md:col-span-2 border-2 ${data.vatPayable > 0 ? 'border-red-200' : 'border-green-200'}`}>
            <div className="card-body flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{data.vatPayable > 0 ? 'VAT PAYABLE to BIR' : 'EXCESS INPUT TAX (carry forward)'}</p>
                <p className={`text-3xl font-bold ${data.vatPayable > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(data.vatPayable > 0 ? data.vatPayable : data.excessInputTax)}
                </p>
              </div>
              <AlertCircle className={`w-10 h-10 ${data.vatPayable > 0 ? 'text-red-400' : 'text-green-400'}`} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WithholdingReport({ params }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await birApi.withholdingSummary(params); setData(r.data); }
    catch (err) { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={load} disabled={loading} className="btn-primary">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Generate Report
      </button>
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-5 text-center">
              <p className="text-gray-500 text-sm">Total Gross Compensation</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totalGross)}</p>
            </div>
            <div className="card p-5 text-center border-red-200 border-2">
              <p className="text-gray-500 text-sm">Total Tax Withheld (1601-C)</p>
              <p className="text-2xl font-bold text-red-600">{formatCurrency(data.totalTax)}</p>
            </div>
          </div>
          <div className="card">
            <div className="table-wrapper">
              <table className="table">
                <thead><tr><th>Name</th><th>TIN</th><th className="text-right">Gross Pay</th><th className="text-right">Tax Withheld</th></tr></thead>
                <tbody>
                  {data.employees.map((e, i) => (
                    <tr key={i}>
                      <td className="font-medium">{e.name}</td>
                      <td className="text-gray-400 text-xs font-mono">{e.tin || '—'}</td>
                      <td className="text-right">{formatCurrency(e.grossPay)}</td>
                      <td className="text-right text-red-600 font-medium">{formatCurrency(e.withholdingTax)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AlphalistReport({ params }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const r = await birApi.alphalist(params); setData(r.data); }
    catch (err) { toast.error('Failed to load'); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={load} disabled={loading} className="btn-primary">
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Generate Alphalist
      </button>
      {data && (
        <div className="card">
          <div className="card-header">
            <span className="font-semibold">Alphalist — {data.year} ({data.count} employees)</span>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead><tr><th>Name</th><th>TIN</th><th className="text-right">Gross</th><th className="text-right">Taxable</th><th className="text-right">Tax Withheld</th><th className="text-right">SSS</th><th className="text-right">PhilHealth</th><th className="text-right">Pag-IBIG</th></tr></thead>
              <tbody>
                {data.employees.map((e, i) => (
                  <tr key={i}>
                    <td className="font-medium text-sm">{e.name}</td>
                    <td className="font-mono text-xs text-gray-400">{e.tin || '—'}</td>
                    <td className="text-right">{formatCurrency(e.grossCompensation)}</td>
                    <td className="text-right">{formatCurrency(e.taxableCompensation)}</td>
                    <td className="text-right text-red-600 font-medium">{formatCurrency(e.withholdingTax)}</td>
                    <td className="text-right text-xs">{formatCurrency(e.sss)}</td>
                    <td className="text-right text-xs">{formatCurrency(e.philhealth)}</td>
                    <td className="text-right text-xs">{formatCurrency(e.pagibig)}</td>
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

export default function BIRPage() {
  const [activeForm, setActiveForm] = useState('vat');
  const now = new Date();
  const [params, setParams] = useState({ month: now.getMonth() + 1, year: now.getFullYear() });

  const YEARS = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i);

  const renderReport = () => {
    switch (activeForm) {
      case 'vat':          return <VATReport params={params} />;
      case 'withholding':  return <WithholdingReport params={params} />;
      case 'alphalist':    return <AlphalistReport params={{ year: params.year }} />;
      default: return <div className="text-gray-400 py-8 text-center">Report coming soon. Select from the list.</div>;
    }
  };

  const currentForm = FORMS.find(f => f.key === activeForm);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">BIR Compliance</h1>
          <p className="page-subtitle">RA 11976 (Ease of Paying Taxes) • TRAIN Law</p>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Form list */}
        <div className="w-64 flex-shrink-0 space-y-1">
          {FORMS.map(f => (
            <button key={f.key} onClick={() => setActiveForm(f.key)}
              className={`w-full text-left p-3 rounded-xl border transition-all ${activeForm === f.key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-blue-50/40'}`}>
              <div className="flex items-center gap-2 mb-1">
                <FileText className={`w-4 h-4 ${activeForm === f.key ? 'text-blue-600' : 'text-gray-400'}`} />
                <span className={`text-xs font-bold uppercase tracking-wide ${activeForm === f.key ? 'text-blue-700' : 'text-gray-500'}`}>{f.form}</span>
              </div>
              <p className="text-sm font-medium text-gray-900">{f.label}</p>
            </button>
          ))}
        </div>

        {/* Report area */}
        <div className="flex-1">
          <div className="card mb-4">
            <div className="card-body py-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="label mb-0 whitespace-nowrap">Period:</label>
                <select className="select w-36" value={params.month} onChange={(e) => setParams(p => ({...p, month: Number(e.target.value)}))}>
                  {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
                <select className="select w-24" value={params.year} onChange={(e) => setParams(p => ({...p, year: Number(e.target.value)}))}>
                  {YEARS.map(y => <option key={y}>{y}</option>)}
                </select>
              </div>
              {currentForm && (
                <div className="flex-1">
                  <span className="text-sm text-gray-500">{currentForm.description}</span>
                </div>
              )}
            </div>
          </div>

          {renderReport()}
        </div>
      </div>
    </div>
  );
}
