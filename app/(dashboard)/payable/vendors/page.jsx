'use client';
import { useState, useEffect, useCallback } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Edit2, Building2, Phone, Mail, MapPin,
  Hash, ChevronRight, ToggleLeft, ToggleRight, X, FileText,
  TrendingDown, CheckCircle2, Clock
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import Link from 'next/link';

// ─── Vendor Form Modal ────────────────────────────────────────
function VendorModal({ vendor, onClose, onSaved }) {
  const isEdit = !!vendor?.id;
  const [form, setForm] = useState(vendor || {
    vendorCode: '', name: '', tin: '', address: '',
    contactName: '', email: '', phone: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await pApi.vendors.update(vendor.id, form);
      else await pApi.vendors.create(form);
      toast.success(isEdit ? 'Vendor updated' : 'Vendor created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save vendor');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Vendor' : 'New Vendor'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Vendor Code</label>
                <input className="input font-mono" value={form.vendorCode || ''} onChange={set('vendorCode')} placeholder="Auto-generated (VEN-001)" disabled={isEdit} />
                {!isEdit && <p className="text-xs text-gray-400 mt-1">Leave blank to auto-generate.</p>}
              </div>
              <div className="form-group">
                <label className="label">TIN</label>
                <input className="input font-mono" value={form.tin || ''} onChange={set('tin')} placeholder="000-000-000-000" />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Vendor / Company Name *</label>
              <input className="input" required value={form.name} onChange={set('name')} placeholder="e.g. ABC Supplies Corporation" />
            </div>

            <div className="form-group">
              <label className="label">Address</label>
              <textarea className="input resize-none" rows={2} value={form.address || ''} onChange={set('address')} placeholder="Complete business address" />
            </div>

            <hr className="border-gray-100" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Information</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="label">Contact Person</label>
                <input className="input" value={form.contactName || ''} onChange={set('contactName')} placeholder="Full name" />
              </div>
              <div className="form-group">
                <label className="label">Phone</label>
                <input className="input" value={form.phone || ''} onChange={set('phone')} placeholder="e.g. 02-1234-5678" />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Email Address</label>
              <input type="email" className="input" value={form.email || ''} onChange={set('email')} placeholder="vendor@company.com" />
            </div>

            {isEdit && (
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Active Status</p>
                  <p className="text-xs text-gray-500">Inactive vendors won't appear in bill creation</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className={`transition-colors ${form.isActive !== false ? 'text-green-500' : 'text-gray-300'}`}
                >
                  {form.isActive !== false
                    ? <ToggleRight className="w-8 h-8" />
                    : <ToggleLeft className="w-8 h-8" />}
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Vendor')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Vendor Detail Drawer ─────────────────────────────────────
function VendorDrawer({ vendor, bills, onClose, onEdit }) {
  const totalBilled = bills.reduce((s, b) => s + Number(b.totalAmount), 0);
  const totalPaid   = bills.reduce((s, b) => s + Number(b.paidAmount), 0);
  const outstanding = totalBilled - totalPaid;
  const openBills   = bills.filter((b) => ['OPEN','PARTIAL','OVERDUE'].includes(b.status)).length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Building2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{vendor.name}</h3>
                <p className="text-blue-200 text-sm">{vendor.vendorCode}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-2">
            <span className={`badge text-xs ${vendor.isActive ? 'bg-green-400/20 text-green-100' : 'bg-red-400/20 text-red-100'}`}>
              {vendor.isActive ? 'Active' : 'Inactive'}
            </span>
            {vendor.tin && (
              <span className="badge bg-white/10 text-blue-100 text-xs font-mono">TIN: {vendor.tin}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Stats */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            {[
              { label: 'Total Billed', value: formatCurrency(totalBilled), color: 'text-gray-900' },
              { label: 'Outstanding',  value: formatCurrency(outstanding),  color: outstanding > 0 ? 'text-red-600' : 'text-green-600' },
              { label: 'Open Bills',   value: openBills,                    color: openBills > 0 ? 'text-orange-600' : 'text-green-600' },
            ].map((s) => (
              <div key={s.label} className="p-4 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Contact info */}
          <div className="p-5 space-y-3 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
            {[
              [MapPin,  vendor.address,     'Address'],
              [Phone,   vendor.phone,       'Phone'],
              [Mail,    vendor.email,       'Email'],
              [Hash,    vendor.contactName, 'Contact Person'],
            ].filter(([, v]) => v).map(([Icon, value, label], i) => (
              <div key={i} className="flex items-start gap-3">
                <Icon className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm text-gray-800">{value}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Recent bills */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Bills</p>
              <Link href={`/payable?vendorId=${vendor.id}`} className="text-xs text-blue-600 hover:underline">View all</Link>
            </div>
            {bills.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No bills yet</p>
            ) : (
              <div className="space-y-2">
                {bills.slice(0, 8).map((b) => (
                  <div key={b.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div>
                      <p className="text-sm font-mono font-medium text-blue-700">{b.billNo}</p>
                      <p className="text-xs text-gray-400">{formatDate(b.billDate)} · Due {formatDate(b.dueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{formatCurrency(b.totalAmount)}</p>
                      <span className={`text-xs font-medium ${
                        b.status === 'PAID' ? 'text-green-600'
                        : b.status === 'VOID' ? 'text-gray-400'
                        : 'text-orange-600'
                      }`}>{b.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200">
          <button onClick={onEdit} className="btn-primary w-full justify-center">
            <Edit2 className="w-4 h-4" /> Edit Vendor
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Vendors Page ────────────────────────────────────────
export default function VendorsPage() {
  const [vendors, setVendors]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // all | active | inactive
  const [modal, setModal]           = useState(null); // null | 'new' | vendor (edit)
  const [drawer, setDrawer]         = useState(null); // vendor for side drawer
  const [drawerBills, setDrawerBills] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    const params = { search };
    if (activeFilter !== 'all') params.active = activeFilter === 'active';
    pApi.vendors.list(params)
      .then((r) => setVendors(r.data))
      .catch(() => toast.error('Failed to load vendors'))
      .finally(() => setLoading(false));
  }, [search, activeFilter]);

  useEffect(() => { load(); }, [load]);

  const openDrawer = async (vendor) => {
    setDrawer(vendor);
    try {
      const r = await pApi.bills.list({ vendorId: vendor.id, limit: 10 });
      setDrawerBills(r.data.data);
    } catch { setDrawerBills([]); }
  };

  const activeVendors   = vendors.filter((v) => v.isActive).length;
  const inactiveVendors = vendors.filter((v) => !v.isActive).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Vendors</h1>
          <p className="page-subtitle">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''} · {activeVendors} active</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> New Vendor
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Vendors',    value: vendors.length,    color: 'bg-blue-100 text-blue-600',   icon: <Building2 className="w-5 h-5" /> },
          { label: 'Active',           value: activeVendors,     color: 'bg-green-100 text-green-600', icon: <CheckCircle2 className="w-5 h-5" /> },
          { label: 'Inactive',         value: inactiveVendors,   color: 'bg-gray-100 text-gray-500',   icon: <ToggleLeft className="w-5 h-5" /> },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search vendor name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['all','All'],['active','Active'],['inactive','Inactive']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setActiveFilter(k)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeFilter === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Vendor grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading vendors...
        </div>
      ) : vendors.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No vendors found</p>
          <p className="text-gray-400 text-sm mt-1">Add your first vendor to start recording bills</p>
          <button className="btn-primary mt-4" onClick={() => setModal('new')}>
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 sm:grid-cols-3 gap-4">
          {vendors.map((vendor) => (
            <div
              key={vendor.id}
              className={`card cursor-pointer group transition-all hover:shadow-md hover:border-blue-200 ${!vendor.isActive ? 'opacity-60' : ''}`}
              onClick={() => openDrawer(vendor)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Building2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 leading-tight group-hover:text-blue-700 transition-colors">{vendor.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{vendor.vendorCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`badge text-xs ${vendor.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {vendor.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-400 transition-colors ml-1" />
                  </div>
                </div>

                <div className="space-y-1.5 text-sm">
                  {vendor.tin && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-xs">TIN: {vendor.tin}</span>
                    </div>
                  )}
                  {vendor.contactName && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{vendor.contactName}</span>
                    </div>
                  )}
                  {vendor.phone && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{vendor.phone}</span>
                    </div>
                  )}
                  {vendor.email && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate text-xs">{vendor.email}</span>
                    </div>
                  )}
                  {vendor.address && (
                    <div className="flex items-start gap-2 text-gray-500">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span className="text-xs line-clamp-2">{vendor.address}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/50 rounded-b-xl">
                <span className="text-xs text-gray-400">Click to view details & bills</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setModal(vendor); }}
                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit vendor"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal && (
        <VendorModal
          vendor={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {/* Side drawer */}
      {drawer && (
        <VendorDrawer
          vendor={drawer}
          bills={drawerBills}
          onClose={() => setDrawer(null)}
          onEdit={() => { setModal(drawer); setDrawer(null); }}
        />
      )}
    </div>
  );
}
