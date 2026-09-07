'use client';
import { useState, useEffect, useCallback } from 'react';
import { audit as auditApi } from '@/lib/api';
import { formatDate } from '@/lib/auth';
import { exportToCSV } from '@/lib/export';
import { Filter, Shield, Search, RefreshCw, Download } from 'lucide-react';
import toast from 'react-hot-toast';

// Map actions to badge colours
const ACTION_BADGE = {
  CREATE: 'badge-green',
  UPDATE: 'badge-blue',
  DELETE: 'badge-red',
  POST: 'badge-green',
  VOID: 'badge-red',
  LOGIN: 'badge-green',
  LOGOUT: 'badge-gray',
  LOGIN_FAILED: 'badge-yellow',
  LOGIN_BLOCKED: 'badge-red',
  ACCOUNT_LOCKED: 'badge-red',
  PASSWORD_CHANGE: 'badge-blue',
  PASSWORD_RESET: 'badge-blue',
  PASSWORD_RESET_REQUEST: 'badge-yellow',
};

const fmtDateTime = (d) => {
  const dt = new Date(d);
  return `${formatDate(dt)} ${dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

export default function AuditPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [opts, setOpts] = useState({ actions: [], entities: [] });
  const [filter, setFilter] = useState({ action: '', entity: '', search: '', from: '', to: '' });
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    auditApi.list({ ...filter, page, limit: 50 })
      .then((r) => { setLogs(r.data.data); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load audit logs'))
      .finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { auditApi.filters().then((r) => setOpts(r.data)).catch(() => toast.error('Failed to load filter options')); }, []);

  const reset = () => { setFilter({ action: '', entity: '', search: '', from: '', to: '' }); setPage(1); };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Shield className="w-6 h-6 text-blue-700" /> Audit Trail</h1>
          <p className="page-subtitle">{total} recorded events — who did what, and when</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => exportToCSV(logs, [
            { key: 'createdAt', label: 'Timestamp', format: (v) => fmtDateTime(v) },
            { key: 'userEmail', label: 'User' },
            { key: 'action', label: 'Action' },
            { key: 'entity', label: 'Entity' },
            { key: 'entityId', label: 'Entity ID' },
            { key: 'summary', label: 'Summary' },
            { key: 'ipAddress', label: 'IP' },
          ], 'audit-trail')}><Download className="w-4 h-4" /> Export CSV</button>
          <button className="btn-secondary" onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3 flex flex-wrap gap-3 items-center">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 w-56"
              placeholder="Search user / summary / ID"
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
            />
          </div>
          <select className="select w-44" value={filter.action} onChange={(e) => setFilter((f) => ({ ...f, action: e.target.value }))}>
            <option value="">All Actions</option>
            {opts.actions.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select className="select w-44" value={filter.entity} onChange={(e) => setFilter((f) => ({ ...f, entity: e.target.value }))}>
            <option value="">All Entities</option>
            {opts.entities.map((e) => <option key={e}>{e}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">From</label>
            <input type="date" className="input w-40" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500">To</label>
            <input type="date" className="input w-40" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
          </div>
          <button className="btn-secondary" onClick={() => { setPage(1); load(); }}><Filter className="w-4 h-4" /> Filter</button>
          <button className="btn-secondary" onClick={reset}>Reset</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th><th>IP</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">No audit events found.</td></tr>
              ) : logs.map((l) => (
                <>
                  <tr key={l.id} className="cursor-pointer hover:bg-gray-50" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                    <td className="whitespace-nowrap text-xs text-gray-600 font-mono">{fmtDateTime(l.createdAt)}</td>
                    <td className="text-gray-700 text-sm">{l.userEmail || '—'}</td>
                    <td><span className={ACTION_BADGE[l.action] || 'badge-gray'}>{l.action}</span></td>
                    <td className="text-gray-600 text-sm">{l.entity}{l.entityId ? <span className="text-gray-400"> #{l.entityId}</span> : ''}</td>
                    <td className="text-gray-700 text-sm max-w-md truncate">{l.summary || '—'}</td>
                    <td className="text-gray-400 text-xs font-mono">{l.ipAddress || '—'}</td>
                  </tr>
                  {expanded === l.id && l.changes && (
                    <tr key={`${l.id}-detail`} className="bg-gray-50">
                      <td colSpan={6} className="px-6 py-3">
                        <pre className="text-xs bg-white border rounded-lg p-3 overflow-x-auto text-gray-700">{JSON.stringify(l.changes, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-between text-sm text-gray-500">
          <span>{total} events total</span>
          <div className="flex gap-2 items-center">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary btn-sm">Previous</button>
            <span className="px-3 py-1">Page {page}</span>
            <button disabled={logs.length < 50} onClick={() => setPage((p) => p + 1)} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}
