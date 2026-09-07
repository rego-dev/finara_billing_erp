'use client';
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { customReports } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Play, RefreshCw, Printer, ArrowLeft, Pencil, FileText,
  BarChart2, TrendingUp, Activity, ChevronDown, ChevronUp,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import Link from 'next/link';

const TYPE_META = {
  account_balance:   { label: 'Account Balance',  Icon: PesoSign,  color: 'blue' },
  period_comparison: { label: 'Period Comparison', Icon: BarChart2,   color: 'purple' },
  account_movement:  { label: 'Account Movement',  Icon: Activity,    color: 'orange' },
  profit_loss:       { label: 'Profit & Loss',     Icon: TrendingUp,  color: 'green' },
};

export default function CustomReportViewerPage() {
  const { id } = useParams();
  const [report, setReport]   = useState(null);
  const [result, setResult]   = useState(null);
  const [loading, setLoading] = useState(false);

  const runReport = useCallback(() => {
    setLoading(true);
    customReports.run(id)
      .then((r) => { setReport(r.data.report); setResult(r.data.result); })
      .catch(() => toast.error('Failed to run report'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { runReport(); }, [runReport]);

  const handlePrint = () => {
    if (!report || !result) return;
    const body = buildPrintBody(report.reportType, result, report);
    printDocument(report.name, TYPE_META[report.reportType]?.label || '', body);
  };

  const meta = report ? (TYPE_META[report.reportType] || { label: report.reportType, Icon: FileText, color: 'blue' }) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Link href="/reports/custom" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="page-title">{report?.name || 'Custom Report'}</h1>
            <p className="page-subtitle">
              {meta && <span className="mr-2">{meta.label}</span>}
              {report?.description && <span className="text-gray-400">· {report.description}</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link href={`/reports/custom/builder?edit=${id}`} className="btn-secondary">
            <Pencil className="w-4 h-4" /> Edit
          </Link>
          <button onClick={handlePrint} disabled={!result} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={runReport} disabled={loading} className="btn-primary">
            <Play className={`w-4 h-4 ${loading ? 'animate-pulse' : ''}`} />
            {loading ? 'Running…' : 'Run'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Running report…
        </div>
      ) : result ? (
        <ResultView type={report.reportType} result={result} config={report.config} />
      ) : (
        <div className="card p-16 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">Press Run to generate the report</p>
        </div>
      )}
    </div>
  );
}

// ─── Result views ───────────────────────────────────────────────
function ResultView({ type, result, config }) {
  if (type === 'account_balance')   return <AccountBalanceView data={result} config={config} />;
  if (type === 'period_comparison') return <PeriodComparisonView data={result} config={config} />;
  if (type === 'account_movement')  return <AccountMovementView data={result} config={config} />;
  if (type === 'profit_loss')       return <ProfitLossView data={result} config={config} />;
  return <pre className="text-xs bg-gray-50 p-4 rounded-xl overflow-auto">{JSON.stringify(result, null, 2)}</pre>;
}

function AccountBalanceView({ data, config }) {
  const byType = data.rows.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r); return acc; }, {});
  const types = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].filter((t) => byType[t]?.length);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-gray-400 mb-1">Total Debit</p><p className="text-xl font-bold text-gray-900">{formatCurrency(data.totals.debit)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-400 mb-1">Total Credit</p><p className="text-xl font-bold text-gray-900">{formatCurrency(data.totals.credit)}</p></div>
        <div className="card p-4"><p className="text-xs text-gray-400 mb-1">Net Balance</p><p className={`text-xl font-bold ${data.totals.balance >= 0 ? 'text-blue-700' : 'text-red-600'}`}>{formatCurrency(data.totals.balance)}</p></div>
      </div>
      <div className="card overflow-hidden">
        <div className="card-body border-b border-gray-100">
          <p className="text-sm text-gray-500">As of <span className="font-semibold text-gray-800">{formatDate(config.asOf)}</span> · {data.rowCount} accounts</p>
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
              {types.map((type) => (
                <>
                  <tr key={type} className="bg-blue-50">
                    <td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-blue-700">{type}</td>
                  </tr>
                  {byType[type].map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                      <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-400">{r.type}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{r.debit > 0 ? formatCurrency(r.debit) : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{r.credit > 0 ? formatCurrency(r.credit) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-semibold ${r.balance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(r.balance)}</td>
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
            <tfoot><tr className="bg-gray-100 font-bold">
              <td colSpan={3} className="px-4 py-3">TOTAL</td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.debit)}</td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.credit)}</td>
              <td className="px-4 py-3 text-right font-mono">{formatCurrency(data.totals.balance)}</td>
            </tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function PeriodComparisonView({ data, config }) {
  const byType = data.rows.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r); return acc; }, {});
  const types  = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'].filter((t) => byType[t]?.length);

  return (
    <div className="card overflow-hidden">
      <div className="card-body border-b border-gray-100 flex justify-between items-center">
        <p className="text-sm text-gray-500">{data.rowCount} accounts with activity</p>
        <div className="flex gap-6 text-right text-sm">
          <div><p className="text-xs text-gray-400">{data.label1}</p><p className="text-xs text-gray-400">{formatDate(data.period1?.from)} — {formatDate(data.period1?.to)}</p></div>
          <div><p className="text-xs text-gray-400">{data.label2}</p><p className="text-xs text-gray-400">{formatDate(data.period2?.from)} — {formatDate(data.period2?.to)}</p></div>
        </div>
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
            {types.map((type) => (
              <>
                <tr key={type} className="bg-blue-50">
                  <td colSpan={6} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-blue-700">{type}</td>
                </tr>
                {byType[type].map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                    <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.bal1)}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(r.bal2)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono font-semibold ${r.variance > 0 ? 'text-green-600' : r.variance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {r.variance !== 0 ? (r.variance > 0 ? '+' : '') + formatCurrency(r.variance) : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right text-xs font-semibold ${r.variance > 0 ? 'text-green-600' : r.variance < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {r.variancePct !== null ? `${r.variancePct > 0 ? '+' : ''}${r.variancePct.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountMovementView({ data, config }) {
  const [expanded, setExpanded] = useState({});
  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <div className="space-y-3">
      <div className="card p-4 flex justify-between items-center">
        <p className="text-sm text-gray-500">
          {formatDate(config.from)} — {formatDate(config.to)} · {data.rowCount} accounts with activity
        </p>
      </div>
      {data.rows.map((r) => (
        <div key={r.id} className="card overflow-hidden">
          <button
            onClick={() => toggle(r.id)}
            className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-blue-600 w-16">{r.code}</span>
              <span className="font-semibold text-gray-800 text-sm">{r.name}</span>
              <span className="badge badge-blue text-xs">{r.lines.length}</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500 text-xs">Dr: <span className="font-mono font-semibold text-gray-800">{formatCurrency(r.totalDebit)}</span></span>
              <span className="text-gray-500 text-xs">Cr: <span className="font-mono font-semibold text-gray-800">{formatCurrency(r.totalCredit)}</span></span>
              {expanded[r.id] ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>
          {expanded[r.id] && (
            <table className="w-full text-xs">
              <thead><tr className="bg-white border-b border-gray-100">
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Entry</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Date</th>
                <th className="text-left px-4 py-2 text-gray-400 font-medium">Description</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Debit</th>
                <th className="text-right px-4 py-2 text-gray-400 font-medium">Credit</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {r.lines.map((l, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-blue-600">{l.entryNo}</td>
                    <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatDate(l.date)}</td>
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

function ProfitLossView({ data, config }) {
  const revenue  = data.rows.filter((r) => r.type === 'REVENUE');
  const expenses = data.rows.filter((r) => r.type === 'EXPENSE');

  return (
    <div className="space-y-4">
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
          <p className="text-sm text-gray-500">{formatDate(config.from)} — {formatDate(config.to)}</p>
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
            <tr className="bg-green-100 font-bold">
              <td colSpan={2} className="px-4 py-2 text-green-800">Total Revenue</td>
              <td className="px-4 py-2 text-right font-mono text-green-800">{formatCurrency(data.revenue)}</td>
            </tr>
            <tr className="bg-red-50"><td colSpan={3} className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-700">Expenses</td></tr>
            {expenses.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 border-b border-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{r.code}</td>
                <td className="px-4 py-2.5 text-gray-800">{r.name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-red-700">{formatCurrency(r.amount)}</td>
              </tr>
            ))}
            <tr className="bg-red-100 font-bold">
              <td colSpan={2} className="px-4 py-2 text-red-800">Total Expenses</td>
              <td className="px-4 py-2 text-right font-mono text-red-800">{formatCurrency(data.expenses)}</td>
            </tr>
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

// ─── Print HTML builder ─────────────────────────────────────────
function buildPrintBody(type, result, report) {
  const config = report.config || {};

  if (type === 'account_balance') {
    const byType = result.rows.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r); return acc; }, {});
    const rows = Object.entries(byType).map(([t, accounts]) => `
      <tr class="section-row"><td colspan="6">${t}</td></tr>
      ${accounts.map((r) => `<tr>
        <td class="mono blue small">${r.code}</td><td>${r.name}</td><td class="small center">${r.type}</td>
        <td class="right mono">${r.debit > 0 ? phpFmt(r.debit) : ''}</td>
        <td class="right mono">${r.credit > 0 ? phpFmt(r.credit) : ''}</td>
        <td class="right mono bold">${phpFmt(r.balance)}</td>
      </tr>`).join('')}
    `).join('');
    return `
      <div class="info-grid"><div class="info-box"><div class="info-lbl">As of</div><div class="info-val">${dateFmt(config.asOf)}</div></div><div class="info-box"><div class="info-lbl">Accounts</div><div class="info-val">${result.rowCount}</div></div></div>
      <table><thead><tr><th>Code</th><th>Account</th><th class="center">Type</th><th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="3" class="right">TOTAL</td><td class="right mono">${phpFmt(result.totals.debit)}</td><td class="right mono">${phpFmt(result.totals.credit)}</td><td class="right mono">${phpFmt(result.totals.balance)}</td></tr></tfoot>
      </table>`;
  }

  if (type === 'profit_loss') {
    const rev  = result.rows.filter((r) => r.type === 'REVENUE');
    const exp  = result.rows.filter((r) => r.type === 'EXPENSE');
    return `
      <div class="sum-row">
        <div class="sum-box sum-green"><div class="sum-lbl">Revenue</div><div class="sum-val">${phpFmt(result.revenue)}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">Expenses</div><div class="sum-val">${phpFmt(result.expenses)}</div></div>
        <div class="sum-box"><div class="sum-lbl">Net Income</div><div class="sum-val">${phpFmt(result.netIncome)}</div></div>
      </div>
      <table><thead><tr><th>Code</th><th>Account</th><th class="right">Amount</th></tr></thead>
      <tbody>
        <tr class="section-row"><td colspan="3">Revenue</td></tr>
        ${rev.map((r) => `<tr><td class="mono blue small">${r.code}</td><td>${r.name}</td><td class="right mono green">${phpFmt(r.amount)}</td></tr>`).join('')}
        <tr style="font-weight:700;background:#dcfce7"><td colspan="2" class="right">Total Revenue</td><td class="right mono green">${phpFmt(result.revenue)}</td></tr>
        <tr class="section-row"><td colspan="3">Expenses</td></tr>
        ${exp.map((r) => `<tr><td class="mono blue small">${r.code}</td><td>${r.name}</td><td class="right mono red">${phpFmt(r.amount)}</td></tr>`).join('')}
        <tr style="font-weight:700;background:#fee2e2"><td colspan="2" class="right">Total Expenses</td><td class="right mono red">${phpFmt(result.expenses)}</td></tr>
      </tbody>
      <tfoot><tr><td colspan="2" class="right">NET INCOME</td><td class="right mono">${phpFmt(result.netIncome)}</td></tr></tfoot>
      </table>`;
  }

  return `<pre>${JSON.stringify(result, null, 2)}</pre>`;
}
