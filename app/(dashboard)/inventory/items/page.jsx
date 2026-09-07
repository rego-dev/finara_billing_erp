'use client';
import { useState, useEffect, useCallback } from 'react';
import { inventory as inventoryApi, accounts as accountsApi } from '@/lib/api';
import { printDocument, phpFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Package, Plus, Search, RefreshCw, Printer, Edit2,
  Trash2, Tag, ChevronDown, X, Check, AlertTriangle,
  Layers, Warehouse,
} from 'lucide-react';

const UNITS = ['pcs', 'box', 'pack', 'set', 'kg', 'g', 'L', 'mL', 'sheet', 'roll', 'ream', 'pair', 'unit', 'lot'];
const TYPE_LABELS = { PRODUCT: 'Product', MATERIAL: 'Material', SUPPLY: 'Supply', ASSET: 'Asset' };
const TYPE_COLORS = { PRODUCT: 'badge-blue', MATERIAL: 'badge-yellow', SUPPLY: 'badge-green', ASSET: 'badge-red' };

const BLANK_ITEM = {
  sku: '', name: '', description: '', categoryId: '',
  unit: 'pcs', costPrice: '', sellingPrice: '', reorderLevel: '',
  warehouseLocation: '', inventoryAccountId: '', cogsAccountId: '', revenueAccountId: '',
};

const BLANK_CAT = { name: '', type: 'PRODUCT', description: '' };

// ── Category Modal ────────────────────────────────────────────────────────────
function CategoryModal({ cat, onClose, onSaved }) {
  const isEdit = !!cat?.id;
  const [form, setForm] = useState(cat || BLANK_CAT);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await inventoryApi.categories.update(cat.id, form);
      else        await inventoryApi.categories.create(form);
      toast.success(isEdit ? 'Category updated' : 'Category created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-md shadow-2xl flex flex-col" style={{borderRadius:'0 0 1rem 1rem',maxHeight:'88vh',animation:'topDrawerIn .28s cubic-bezier(.4,0,.2,1)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Edit Category' : 'New Category'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="label">Name <span className="text-red-500">*</span></label>
            <input className="input w-full" value={form.name} onChange={set('name')} required placeholder="e.g. Retail Products" />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input w-full" value={form.type} onChange={set('type')}>
              <option value="PRODUCT">Product (retail goods for sale)</option>
              <option value="MATERIAL">Material (advertising / production)</option>
              <option value="SUPPLY">Supply (consumables)</option>
              <option value="ASSET">Asset (promotional / display)</option>
            </select>
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input w-full" rows={2} value={form.description} onChange={set('description')} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Item Modal ────────────────────────────────────────────────────────────────
function ItemModal({ item, categories, accounts, onClose, onSaved }) {
  const isEdit = !!item?.id;
  const [form, setForm] = useState(item ? {
    sku:               item.sku,
    name:              item.name,
    description:       item.description || '',
    categoryId:        item.categoryId || '',
    unit:              item.unit,
    costPrice:         item.costPrice,
    sellingPrice:      item.sellingPrice,
    reorderLevel:      item.reorderLevel,
    warehouseLocation: item.warehouseLocation || '',
    inventoryAccountId: item.inventoryAccountId || '',
    cogsAccountId:      item.cogsAccountId || '',
    revenueAccountId:   item.revenueAccountId || '',
  } : BLANK_ITEM);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const assetAccounts   = accounts.filter((a) => a.accountType === 'ASSET');
  const expenseAccounts = accounts.filter((a) => a.accountType === 'EXPENSE');
  const revenueAccounts = accounts.filter((a) => a.accountType === 'REVENUE');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isEdit) await inventoryApi.items.update(item.id, form);
      else        await inventoryApi.items.create(form);
      toast.success(isEdit ? 'Item updated' : 'Item created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-2xl shadow-2xl flex flex-col" style={{borderRadius:'0 0 1rem 1rem',maxHeight:'88vh',animation:'topDrawerIn .28s cubic-bezier(.4,0,.2,1)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">{isEdit ? 'Edit Item' : 'New Inventory Item'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 gap-4">
            {/* Basic Info */}
            <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-blue-600 mb-1 flex items-center gap-1">
              <Package className="w-3.5 h-3.5" /> Basic Information
            </div>

            <div>
              <label className="label">SKU / Item Code</label>
              <input className="input w-full font-mono" value={form.sku} onChange={set('sku')} placeholder="Auto-generated (SKU-0001)" disabled={isEdit} />
              {!isEdit && <p className="text-xs text-gray-400 mt-1">Leave blank to auto-generate.</p>}
            </div>
            <div>
              <label className="label">Item Name <span className="text-red-500">*</span></label>
              <input className="input w-full" value={form.name} onChange={set('name')} required placeholder="Full item name" />
            </div>

            <div>
              <label className="label">Category</label>
              <select className="input w-full" value={form.categoryId} onChange={set('categoryId')}>
                <option value="">— Select Category —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name} ({TYPE_LABELS[c.type]})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unit of Measure</label>
              <select className="input w-full" value={form.unit} onChange={set('unit')}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className="col-span-2">
              <label className="label">Description</label>
              <textarea className="input w-full" rows={2} value={form.description} onChange={set('description')} />
            </div>

            <div>
              <label className="label">Warehouse / Location</label>
              <input className="input w-full" value={form.warehouseLocation} onChange={set('warehouseLocation')} placeholder="e.g. Shelf A-3, Stockroom 2" />
            </div>
            <div>
              <label className="label">Reorder Level</label>
              <input className="input w-full" type="number" min="0" step="0.001" value={form.reorderLevel} onChange={set('reorderLevel')} placeholder="0" />
            </div>

            {/* Pricing */}
            <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-blue-600 mt-2 mb-1 flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" /> Pricing
            </div>
            <div>
              <label className="label">Cost Price</label>
              <input className="input w-full" type="number" min="0" step="0.01" value={form.costPrice} onChange={set('costPrice')} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Selling Price</label>
              <input className="input w-full" type="number" min="0" step="0.01" value={form.sellingPrice} onChange={set('sellingPrice')} placeholder="0.00" />
            </div>

            {/* COA Linking */}
            <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-blue-600 mt-2 mb-1 flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" /> Chart of Accounts
            </div>
            <div>
              <label className="label">Inventory Asset Account</label>
              <select className="input w-full" value={form.inventoryAccountId} onChange={set('inventoryAccountId')}>
                <option value="">— Select Account —</option>
                {assetAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">COGS Account</label>
              <select className="input w-full" value={form.cogsAccountId} onChange={set('cogsAccountId')}>
                <option value="">— Select Account —</option>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Revenue / Sales Account</label>
              <select className="input w-full" value={form.revenueAccountId} onChange={set('revenueAccountId')}>
                <option value="">— Select Account —</option>
                {revenueAccounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 mt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : isEdit ? 'Update Item' : 'Create Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ItemsPage() {
  const [items,      setItems]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [filter,     setFilter]     = useState({ search: '', categoryId: '', type: '', isActive: 'true' });
  const [loading,    setLoading]    = useState(true);
  const [modal,      setModal]      = useState(null); // null | { type:'item'|'cat', data }
  const [catPanel,   setCatPanel]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { isActive: filter.isActive };
      if (filter.categoryId) params.categoryId = filter.categoryId;
      if (filter.type)       params.type        = filter.type;
      const [itemsRes, catsRes, accsRes] = await Promise.all([
        inventoryApi.items.list(params),
        inventoryApi.categories.list(),
        accountsApi.list(),
      ]);
      setItems(itemsRes.data);
      setCategories(catsRes.data);
      setAccounts(accsRes.data);
    } catch { toast.error('Failed to load items'); }
    finally { setLoading(false); }
  }, [filter.isActive, filter.categoryId, filter.type]);

  useEffect(() => { load(); }, [load]);

  const filtered = items.filter((i) => {
    if (!filter.search) return true;
    const s = filter.search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s);
  });

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this item?')) return;
    try {
      await inventoryApi.items.remove(id);
      toast.success('Item deactivated');
      load();
    } catch { toast.error('Failed'); }
  };

  const handlePrint = async () => {
    const rows = filtered.map((i) => `
      <tr>
        <td class="mono">${i.sku}</td>
        <td class="bold">${i.name}</td>
        <td>${i.category ? `<span class="badge ${i.category.type === 'PRODUCT' ? 'b-blue' : i.category.type === 'MATERIAL' ? 'b-yellow' : i.category.type === 'SUPPLY' ? 'b-green' : 'b-red'}">${i.category.name}</span>` : '—'}</td>
        <td class="center">${i.unit}</td>
        <td class="right">${Number(i.currentStock).toLocaleString('en-PH')}</td>
        <td class="right">${Number(i.reorderLevel).toLocaleString('en-PH')}</td>
        <td class="right">${phpFmt(i.costPrice)}</td>
        <td class="right">${phpFmt(i.sellingPrice)}</td>
        <td>${i.inventoryAccount ? i.inventoryAccount.accountCode : '—'}</td>
        <td>${i.cogsAccount ? i.cogsAccount.accountCode : '—'}</td>
      </tr>`).join('');

    const body = `
      <table>
        <thead><tr>
          <th>SKU</th><th>Name</th><th>Category</th><th class="center">Unit</th>
          <th class="right">Stock</th><th class="right">Reorder</th>
          <th class="right">Cost</th><th class="right">Price</th>
          <th>Inv. Acct</th><th>COGS Acct</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    await printDocument('Item Master List', `${filtered.length} items`, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Item Master</h1>
          <p className="page-subtitle">Manage inventory items & categories</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCatPanel(true)} className="btn-secondary flex items-center gap-2">
            <Tag className="w-4 h-4" /> Categories
          </button>
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={() => setModal({ type: 'item', data: null })} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Item
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Search SKU or name…"
                value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
            </div>
            <select className="input w-44" value={filter.categoryId}
              onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value }))}>
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input w-36" value={filter.type}
              onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}>
              <option value="">All Types</option>
              <option value="PRODUCT">Product</option>
              <option value="MATERIAL">Material</option>
              <option value="SUPPLY">Supply</option>
              <option value="ASSET">Asset</option>
            </select>
            <select className="input w-32" value={filter.isActive}
              onChange={(e) => setFilter((f) => ({ ...f, isActive: e.target.value }))}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
              <option value="all">All</option>
            </select>
            <button onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Unit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Stock</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Accounts</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">No items found</td></tr>
              ) : filtered.map((item) => (
                <tr key={item.id} className={`hover:bg-gray-50 ${!item.isActive ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.warehouseLocation && <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5"><Warehouse className="w-3 h-3" />{item.warehouseLocation}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {item.category
                      ? <span className={`badge ${TYPE_COLORS[item.category.type]}`}>{item.category.name}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{item.unit}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${item.isOutOfStock ? 'text-red-600' : item.isLowStock ? 'text-yellow-600' : 'text-gray-900'}`}>
                    {Number(item.currentStock).toLocaleString('en-PH')}
                    {item.isLowStock && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{phpFmt(item.costPrice)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{phpFmt(item.sellingPrice)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {item.inventoryAccount && <div>Inv: {item.inventoryAccount.accountCode}</div>}
                    {item.cogsAccount      && <div>COGS: {item.cogsAccount.accountCode}</div>}
                    {item.revenueAccount   && <div>Rev: {item.revenueAccount.accountCode}</div>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.isActive
                      ? <span className="badge badge-green">Active</span>
                      : <span className="badge badge-gray">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => setModal({ type: 'item', data: item })}
                        className="text-blue-500 hover:text-blue-700 p-1">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(item.id)}
                        className="text-red-400 hover:text-red-600 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {modal?.type === 'item' && (
        <ItemModal
          item={modal.data}
          categories={categories}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'cat' && (
        <CategoryModal
          cat={modal.data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}

      {/* Category Side Panel */}
      {catPanel && (
        <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
          <div className="bg-white w-80 h-full overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white z-10">
              <h2 className="font-bold text-gray-900">Categories</h2>
              <div className="flex gap-2">
                <button onClick={() => setModal({ type: 'cat', data: null })} className="btn-primary py-1 px-3 text-sm">
                  <Plus className="w-3.5 h-3.5 inline mr-1" /> New
                </button>
                <button onClick={() => setCatPanel(false)}><X className="w-5 h-5 text-gray-400" /></button>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {categories.length === 0 && <p className="text-gray-400 text-sm text-center py-8">No categories yet</p>}
              {categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50">
                  <div>
                    <div className="font-medium text-sm text-gray-900">{c.name}</div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`badge ${TYPE_COLORS[c.type]}`}>{TYPE_LABELS[c.type]}</span>
                      <span className="text-xs text-gray-400">{c._count?.items || 0} items</span>
                    </div>
                  </div>
                  <button onClick={() => setModal({ type: 'cat', data: c })}
                    className="text-blue-500 hover:text-blue-700 p-1">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
