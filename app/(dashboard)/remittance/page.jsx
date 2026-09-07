'use client';
import { useState, useEffect, useCallback } from 'react';
import { remittance as remittanceApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import { printDocument } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Landmark, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  RefreshCw, ChevronRight, Printer,
} from 'lucide-react';
import Link from 'next/link';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TYPE_LABELS  = { SSS: 'SSS', PHILHEALTH: 'PhilHealth', PAGIBIG: 'Pag-IBIG', BIR_1601C: 'BIR 1601-C' };
const TYPE_COLORS  = { SSS: 'blue', PHILHEALTH: 'green', PAGIBIG: 'purple', BIR_1601C: 'red' };
const STATUS_BADGE = {
  DRAFT:   'badge-gray',
  FILED:   'badge-blue',
  PAID:    'badge-green',
  OVERDUE: 'badge-red',
};

function fmt(n) { return formatCurrency(Number(n || 0)); }

export default function RemittanceDashboard() {
  const [summary, setSummary]   = useState(null);
  const [recent,  setRecent]    = useState([]);
  const [loading, setLoading]   = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, listRes] = await Promise.all([
        remittanceApi.summary(),
        remittanceApi.list({}),
      ]);
      setSummary(sumRes.data);
      setRecent(listRes.data.slice(0, 12));
    } catch { toast.error('Failed to load remittance data'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today    = new Date();
  const curMonth = today.getMonth() + 1;
  const curYear  = today.getFullYear();

  function handlePrint() {
    if (!recent.length) return;
    const rows = recent.map(r => `
      <tr>
        <td>${TYPE_LABELS[r.type]}</td>
        <td>${MONTHS[(r.periodMonth - 1)]} ${r.periodYear}</td>
        <td>${new Date(r.dueDate).toLocaleDateString('en-PH')}</td>
        <td style="text-align:right">${fmt(r.totalEmployeeShare)}</td>
        <td style="text-align:right">${fmt(r.totalEmployerShare)}</td>
        <td style="text-align:right"><strong>${fmt(r.totalAmount)}</strong></td>
        <td><span style="padding:2px 8px;border-radius:999px;font-size:11px;background:${r.status==='PAID'?'#dcfce7':r.status==='FILED'?'#dbeafe':r.status==='OVERDUE'?'#fee2e2':'#f3f4f6'};color:${r.status==='PAID'?'#15803d':r.status==='FILED'?'#1d4ed8':r.status==='OVERDUE'?'#b91c1c':'#374151'}">${r.status}</span></td>
      </tr>`).join('');

    printDocument('Remittance Summary', `As of ${today.toLocaleDateString('en-PH')}`, `
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Type</th>
            <th style="padding:8px;border:1px solid #e2e8f0">Period</th>
            <th style="padding:8px;border:1px solid #e2e8f0">Due Date</th>
            <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">EE Share</th>
            <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">ER Share</th>
            <th style="padding:8px;border:1px solid #e2e8f0;text-align:right">Total</th>
            <th style="padding:8px;border:1px solid #e2e8f0">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Landmark className="w-6 h-6 text-blue-600" /> Remittances</h1>
          <p className="page-subtitle">Government contribution remittance tracking — SSS, PhilHealth, Pag-IBIG, BIR</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /> Refresh</button>
          <button className="btn-secondary btn-sm" onClick={handlePrint}><Printer className="w-3.5 h-3.5" /> Print</button>
          <Link href="/remittance/records" className="btn-primary btn-sm">Manage Records <ChevronRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card p-5 h-24 animate-pulse bg-gray-100" />)}
        </div>
      ) : summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="stat-icon bg-red-100"><AlertTriangle className="w-6 h-6 text-red-600" /></div>
            <div>
              <div className="stat-label">Overdue</div>
              <div className="stat-value text-red-600">{summary.overdue}</div>
              <div className="text-xs text-red-500 mt-0.5">Needs immediate action</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon bg-orange-100"><Clock className="w-6 h-6 text-orange-600" /></div>
            <div>
              <div className="stat-label">Filed / Pending Payment</div>
              <div className="stat-value text-orange-600">{summary.filed}</div>
              <div className="text-xs text-gray-400 mt-0.5">Awaiting remittance payment</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon bg-blue-100"><Landmark className="w-6 h-6 text-blue-600" /></div>
            <div>
              <div className="stat-label">Due This Month</div>
              <div className="stat-value">{fmt(summary.thisMonthTotal)}</div>
              <div className="text-xs text-gray-400 mt-0.5">{MONTHS[curMonth-1]} {curYear}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon bg-green-100"><TrendingUp className="w-6 h-6 text-green-600" /></div>
            <div>
              <div className="stat-label">Total Paid YTD</div>
              <div className="stat-value text-green-600">{fmt(summary.paidTotal)}</div>
              <div className="text-xs text-gray-400 mt-0.5">Year {curYear}</div>
            </div>
          </div>
        </div>
      )}

      {/* Upcoming Deadlines */}
      {summary && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold text-gray-900">Upcoming Deadlines (Next 3 Months)</h2>
          </div>
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th><th>Period</th><th>Due Date</th><th>Days Left</th>
                </tr>
              </thead>
              <tbody>
                {summary.upcoming.map((u, i) => {
                  const due  = new Date(u.dueDate);
                  const days = Math.ceil((due - today) / 86400000);
                  const urgent = days <= 7;
                  const color = TYPE_COLORS[u.type];
                  return (
                    <tr key={i}>
                      <td><span className={`badge badge-${color}`}>{TYPE_LABELS[u.type]}</span></td>
                      <td>{MONTHS[u.periodMonth - 1]} {u.periodYear}</td>
                      <td>{due.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td>
                        {days < 0
                          ? <span className="text-red-600 font-medium text-xs">Overdue</span>
                          : <span className={urgent ? 'text-orange-600 font-medium text-xs' : 'text-gray-600 text-xs'}>
                              {days === 0 ? 'Due today' : `${days} days`}
                            </span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Records */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-gray-900">Recent Remittance Records</h2>
          <Link href="/remittance/records" className="text-blue-600 text-sm hover:underline">View all →</Link>
        </div>
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading…</div>
        ) : recent.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Landmark className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>No remittance records yet.</p>
            <Link href="/remittance/records" className="mt-3 inline-block btn-primary btn-sm">Create First Record</Link>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th><th>Period</th><th>Due Date</th>
                  <th className="text-right">EE Share</th>
                  <th className="text-right">ER Share</th>
                  <th className="text-right">Total</th>
                  <th>Status</th><th>Filed / Paid Date</th>
                </tr>
              </thead>
              <tbody>
                {recent.map(r => {
                  const due    = new Date(r.dueDate);
                  const color  = TYPE_COLORS[r.type];
                  return (
                    <tr key={r.id}>
                      <td><span className={`badge badge-${color}`}>{TYPE_LABELS[r.type]}</span></td>
                      <td className="font-medium">{MONTHS[r.periodMonth - 1]} {r.periodYear}</td>
                      <td className="text-sm text-gray-500">{due.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="text-right text-sm">{fmt(r.totalEmployeeShare)}</td>
                      <td className="text-right text-sm">{fmt(r.totalEmployerShare)}</td>
                      <td className="text-right font-semibold">{fmt(r.totalAmount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
                      <td className="text-xs text-gray-400">
                        {r.status === 'PAID' && r.paidDate && new Date(r.paidDate).toLocaleDateString('en-PH')}
                        {r.status === 'FILED' && r.filedDate && new Date(r.filedDate).toLocaleDateString('en-PH')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
