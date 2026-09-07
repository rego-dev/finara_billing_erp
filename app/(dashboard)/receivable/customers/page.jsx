'use client';
import { useState, useEffect, useCallback } from 'react';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Edit2, Users, Phone, Mail, MapPin,
  Hash, ChevronRight, ToggleLeft, ToggleRight, X,
  CheckCircle2, TrendingUp, AlertCircle,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import Link from 'next/link';

// ─── Customer Form Modal ──────────────────────────────────────
function CustomerModal({ customer, onClose, onSaved }) {
  const isEdit = !!customer?.id;
  const [form, setForm] = useState(
    customer || { customerCode: '', name: '', tin: '', address: '', contactName: '', email: '', phone: '' }
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await rApi.customers.update(customer.id, form);
      else await rApi.customers.create(form);
      toast.success(isEdit ? 'Customer updated' : 'Customer created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Customer' : 'New Customer'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Customer Code</label>
                <input
                  className="input font-mono"
                  value={form.customerCode || ''} onChange={set('customerCode')}
                  placeholder="Auto-generated (CUS-001)"
                  disabled={isEdit}
                />
                {!isEdit && (
                  <p className="text-xs text-gray-400 mt-1">Leave blank to auto-generate the next code.</p>
                )}
              </div>
              <div className="form-group">
                <label className="label">TIN</label>
                <input
                  className="input font-mono"
                  value={form.tin || ''} onChange={set('tin')}
                  placeholder="000-000-000-000"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Customer / Company Name *</label>
              <input
                className="input" required
                value={form.name} onChange={set('name')}
                placeholder="e.g. XYZ Corporation"
              />
            </div>

            <div className="form-group">
              <label className="label">Address</label>
              <textarea
                className="input resize-none" rows={2}
                value={form.address || ''} onChange={set('address')}
                placeholder="Complete business address"
              />
            </div>

            <hr className="border-gray-100" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact Information</p>

            <div className="form-grid">
              <div className="form-group">
                <label className="label">Contact Person</label>
                <input
                  className="input"
                  value={form.contactName || ''} onChange={set('contactName')}
                  placeholder="Full name"
                />
              </div>
              <div className="form-group">
                <label className="label">Phone</label>
                <input
                  className="input"
                  value={form.phone || ''} onChange={set('phone')}
                  placeholder="e.g. 02-8765-4321"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Email Address</label>
              <input
                type="email" className="input"
                value={form.email || ''} onChange={set('email')}
                placeholder="customer@company.com"
              />
            </div>

            {isEdit && (
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">Active Status</p>
                  <p className="text-xs text-gray-500">Inactive customers won't appear in invoice creation</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, isActive: !f.isActive }))}
                  className={`transition-colors ${form.isActive !== false ? 'text-green-500' : 'text-gray-300'}`}
                >
                  {form.isActive !== false
                    ? <ToggleRight className="w-8 h-8" />
                    : <ToggleLeft  className="w-8 h-8" />}
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Customer')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Customer Detail Drawer ───────────────────────────────────
function CustomerDrawer({ customer, invoices, onClose, onEdit }) {
  const totalBilled      = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
  const totalCollected   = invoices.reduce((s, i) => s + Number(i.paidAmount), 0);
  const outstanding      = totalBilled - totalCollected;
  const openInvoices     = invoices.filter((i) => ['OPEN', 'PARTIAL', 'OVERDUE'].includes(i.status)).length;
  const overdueInvoices  = invoices.filter((i) => ['OPEN', 'PARTIAL'].includes(i.status) && new Date(i.dueDate) < new Date());
  const overdueAmount    = overdueInvoices.reduce((s, i) => s + Number(i.totalAmount) - Number(i.paidAmount), 0);
  const collectionRate   = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-green-600 to-emerald-600 text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg leading-tight">{customer.name}</h3>
                <p className="text-green-200 text-sm">{customer.customerCode}</p>
              </div>
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-2 flex-wrap">
            <span className={`badge text-xs ${customer.isActive ? 'bg-green-400/20 text-green-100' : 'bg-red-400/20 text-red-100'}`}>
              {customer.isActive ? 'Active' : 'Inactive'}
            </span>
            {customer.tin && (
              <span className="badge bg-white/10 text-green-100 text-xs font-mono">TIN: {customer.tin}</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* KPIs */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            {[
              { label: 'Total Billed',   value: formatCurrency(totalBilled),    color: 'text-gray-900' },
              { label: 'Outstanding',    value: formatCurrency(outstanding),     color: outstanding > 0 ? 'text-orange-600' : 'text-green-600' },
              { label: 'Open Invoices',  value: openInvoices,                   color: openInvoices > 0 ? 'text-blue-600' : 'text-green-600' },
            ].map((s) => (
              <div key={s.label} className="p-4 text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Collection rate */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-gray-500 font-medium">Collection Rate</span>
              <span className={`font-bold ${collectionRate >= 80 ? 'text-green-600' : collectionRate >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                {collectionRate.toFixed(1)}%
              </span>
            </div>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${collectionRate >= 80 ? 'bg-green-500' : collectionRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${Math.min(100, collectionRate)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>Collected: {formatCurrency(totalCollected)}</span>
              <span>Total: {formatCurrency(totalBilled)}</span>
            </div>
          </div>

          {/* Overdue alert */}
          {overdueAmount > 0 && (
            <div className="mx-5 mt-4 bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700">{formatCurrency(overdueAmount)} overdue</p>
                <p className="text-xs text-red-500">{overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} past due</p>
              </div>
            </div>
          )}

          {/* Contact info */}
          <div className="p-5 space-y-3 border-b border-gray-100 mt-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
            {[
              [MapPin,  customer.address,     'Address'],
              [Phone,   customer.phone,       'Phone'],
              [Mail,    customer.email,       'Email'],
              [Hash,    customer.contactName, 'Contact Person'],
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

          {/* Recent invoices */}
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Invoices</p>
              <Link href={`/receivable?customerId=${customer.id}`} className="text-xs text-green-600 hover:underline">
                View all
              </Link>
            </div>
            {invoices.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No invoices yet</p>
            ) : (
              <div className="space-y-2">
                {invoices.slice(0, 8).map((inv) => {
                  const isOverdue = ['OPEN', 'PARTIAL'].includes(inv.status) && new Date(inv.dueDate) < new Date();
                  return (
                    <div key={inv.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div>
                        <p className="text-sm font-mono font-medium text-green-700">{inv.invoiceNo}</p>
                        <p className="text-xs text-gray-400">
                          {formatDate(inv.invoiceDate)} · Due {formatDate(inv.dueDate)}
                          {isOverdue && <span className="text-red-500 ml-1">⚠</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{formatCurrency(inv.totalAmount)}</p>
                        <span className={`text-xs font-medium ${
                          inv.status === 'PAID'    ? 'text-green-600'
                          : inv.status === 'VOID'  ? 'text-gray-400'
                          : isOverdue              ? 'text-red-500'
                          : 'text-orange-500'
                        }`}>{inv.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 flex gap-2">
          <Link
            href={`/receivable/aging?search=${encodeURIComponent(customer.name)}`}
            className="btn-secondary flex-1 justify-center"
          >
            <TrendingUp className="w-4 h-4" /> View AR Aging
          </Link>
          <button onClick={onEdit} className="btn-primary flex-1 justify-center">
            <Edit2 className="w-4 h-4" /> Edit Customer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Customers Page ──────────────────────────────────────
export default function CustomersPage() {
  const [customers, setCustomers]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [activeFilter, setActiveFilter] = useState('all');
  const [modal, setModal]               = useState(null);
  const [drawer, setDrawer]             = useState(null);
  const [drawerInvoices, setDrawerInvoices] = useState([]);

  const load = useCallback(() => {
    setLoading(true);
    const params = { search };
    if (activeFilter !== 'all') params.active = activeFilter === 'active';
    rApi.customers.list(params)
      .then((r) => setCustomers(r.data))
      .catch(() => toast.error('Failed to load customers'))
      .finally(() => setLoading(false));
  }, [search, activeFilter]);

  useEffect(() => { load(); }, [load]);

  const openDrawer = async (customer) => {
    setDrawer(customer);
    try {
      const r = await rApi.invoices.list({ customerId: customer.id, limit: 10 });
      setDrawerInvoices(r.data.data);
    } catch { setDrawerInvoices([]); }
  };

  const activeCount   = customers.filter((c) => c.isActive).length;
  const inactiveCount = customers.filter((c) => !c.isActive).length;

  // Compute top customer by invoice count (from visible list)
  const topCustomer = customers.length > 0 ? customers[0] : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">{customers.length} customer{customers.length !== 1 ? 's' : ''} · {activeCount} active</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> New Customer
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Customers', value: customers.length,  color: 'bg-blue-100 text-blue-600',   icon: <Users className="w-5 h-5" /> },
          { label: 'Active',          value: activeCount,        color: 'bg-green-100 text-green-600', icon: <CheckCircle2 className="w-5 h-5" /> },
          { label: 'Inactive',        value: inactiveCount,      color: 'bg-gray-100 text-gray-500',   icon: <ToggleLeft className="w-5 h-5" /> },
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
              placeholder="Search customer name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([k, label]) => (
              <button
                key={k}
                onClick={() => setActiveFilter(k)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeFilter === k ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customer grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-green-500 border-t-transparent rounded-full animate-spin mr-3" />
          Loading customers...
        </div>
      ) : customers.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No customers found</p>
          <p className="text-gray-400 text-sm mt-1">Add your first customer to start creating invoices</p>
          <button className="btn-primary mt-4" onClick={() => setModal('new')}>
            <Plus className="w-4 h-4" /> Add Customer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 sm:grid-cols-3 gap-4">
          {customers.map((customer) => (
            <div
              key={customer.id}
              className={`card cursor-pointer group transition-all hover:shadow-md hover:border-green-200 ${!customer.isActive ? 'opacity-60' : ''}`}
              onClick={() => openDrawer(customer)}
            >
              <div className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {/* Avatar circle with initials */}
                    <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 font-bold text-sm">
                      {customer.name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 leading-tight group-hover:text-green-700 transition-colors">
                        {customer.name}
                      </p>
                      <p className="text-xs text-gray-400 font-mono">{customer.customerCode}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`badge text-xs ${customer.isActive ? 'badge-green' : 'badge-gray'}`}>
                      {customer.isActive ? 'Active' : 'Inactive'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-green-400 transition-colors ml-1" />
                  </div>
                </div>

                <div className="space-y-1.5 text-sm">
                  {customer.tin && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-xs">TIN: {customer.tin}</span>
                    </div>
                  )}
                  {customer.contactName && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Hash className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{customer.contactName}</span>
                    </div>
                  )}
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  {customer.email && (
                    <div className="flex items-center gap-2 text-gray-500">
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate text-xs">{customer.email}</span>
                    </div>
                  )}
                  {customer.address && (
                    <div className="flex items-start gap-2 text-gray-500">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                      <span className="text-xs line-clamp-2">{customer.address}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between bg-gray-50/50 rounded-b-xl">
                <span className="text-xs text-gray-400">Click to view invoices & details</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setModal(customer); }}
                  className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                  title="Edit customer"
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
        <CustomerModal
          customer={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {/* Side drawer */}
      {drawer && (
        <CustomerDrawer
          customer={drawer}
          invoices={drawerInvoices}
          onClose={() => setDrawer(null)}
          onEdit={() => { setModal(drawer); setDrawer(null); }}
        />
      )}
    </div>
  );
}
