'use client';
import { useState, useEffect, useCallback } from 'react';
import { customReports } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, FileText, Play, Pencil, Trash2, RefreshCw,
  BarChart2, TrendingUp, Activity, Search, Clock,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatDate } from '@/lib/auth';
import Link from 'next/link';

const TYPE_META = {
  account_balance:   { label: 'Account Balance',   Icon: PesoSign,  color: 'blue' },
  period_comparison: { label: 'Period Comparison',  Icon: BarChart2,   color: 'purple' },
  account_movement:  { label: 'Account Movement',   Icon: Activity,    color: 'orange' },
  profit_loss:       { label: 'Profit & Loss',      Icon: TrendingUp,  color: 'green' },
};

const COLOR_BADGE = {
  blue:   'bg-blue-50 text-blue-700 border border-blue-200',
  purple: 'bg-purple-50 text-purple-700 border border-purple-200',
  orange: 'bg-orange-50 text-orange-700 border border-orange-200',
  green:  'bg-green-50 text-green-700 border border-green-200',
};

export default function CustomReportsPage() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search,  setSearch]  = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    customReports.list()
      .then((r) => setReports(r.data))
      .catch(() => toast.error('Failed to load reports'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await customReports.remove(id);
      toast.success('Report deleted');
      setReports((prev) => prev.filter((r) => r.id !== id));
    } catch {
      toast.error('Failed to delete report');
    } finally {
      setDeleting(null);
    }
  };

  const filtered = reports.filter((r) =>
    !search ||
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase()) ||
    TYPE_META[r.reportType]?.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Custom Reports</h1>
          <p className="page-subtitle">Create and manage your own report definitions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <Link href="/reports/custom/builder" className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Report
          </Link>
        </div>
      </div>

      {/* Search */}
      <div className="card">
        <div className="card-body py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 w-full"
              placeholder="Search reports by name or type…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Reports grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading reports…
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">
            {search ? 'No reports match your search' : 'No custom reports yet'}
          </p>
          <p className="text-xs text-gray-400 mt-1 mb-5">
            {search ? 'Try a different keyword' : 'Build your first report using the Report Builder'}
          </p>
          {!search && (
            <Link href="/reports/custom/builder" className="btn-primary inline-flex">
              <Plus className="w-4 h-4" /> Create Report
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 sm:grid-cols-3 gap-4">
          {filtered.map((r) => {
            const meta = TYPE_META[r.reportType] || { label: r.reportType, Icon: FileText, color: 'blue' };
            const Icon = meta.Icon;
            return (
              <div key={r.id} className="card p-5 hover:shadow-md transition-shadow group flex flex-col">
                {/* Type badge & actions */}
                <div className="flex items-start justify-between mb-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${COLOR_BADGE[meta.color]}`}>
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                      href={`/reports/custom/builder?edit=${r.id}`}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      onClick={() => handleDelete(r.id, r.name)}
                      disabled={deleting === r.id}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content */}
                <h3 className="font-semibold text-gray-900 mb-1 leading-tight">{r.name}</h3>
                {r.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mb-3">{r.description}</p>
                )}

                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {formatDate(r.updatedAt)}
                  </div>
                  <Link
                    href={`/reports/custom/${r.id}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800"
                  >
                    <Play className="w-3 h-3" /> Run Report
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Type legend */}
      {reports.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Report Types</p>
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(TYPE_META).map(([key, { label, Icon, color }]) => (
              <div key={key} className="flex items-center gap-2">
                <span className={`p-1.5 rounded-lg ${COLOR_BADGE[color]}`}><Icon className="w-3.5 h-3.5" /></span>
                <span className="text-xs text-gray-600">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
