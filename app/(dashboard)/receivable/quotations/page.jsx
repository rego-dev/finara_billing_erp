'use client';
import { useState, useEffect, useCallback } from 'react';
import { receivable as rApi, accounts as acctApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, Filter, X, FileText, Send, CheckCircle2,
  XCircle, Printer, Trash2, ArrowRightCircle, Edit2,
} from 'lucide-react';
import AccountSelect from '@/components/ui/AccountSelect';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import { formatCurrency, formatDate } from '@/lib/auth';
import CustomerSelect from '@/components/CustomerSelect';
import DescriptionInput, { rememberDescription } from '@/components/DescriptionInput';
import NumberInput from '@/components/NumberInput';

// ─── Constants ────────────────────────────────────────────────
const VAT_CODES = ['VAT', 'ZERO', 'EXEMPT'];
const STATUSES  = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'];
const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  ACCEPTED:  'badge-green',
  REJECTED:  'badge-red',
  EXPIRED:   'badge-yellow',
  CONVERTED: 'badge-green',
};

const computeVAT = (amount, code) =>
  code === 'VAT'
    ? { base: amount, vat: amount * 0.12, total: amount * 1.12 }
    : { base: amount, vat: 0, total: amount };

const todayStr  = () => new Date().toISOString().split('T')[0];
const plusDays  = (n) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
const fmtDateTime = (d) => {
  const dt = new Date(d);
  return `${formatDate(dt)} ${dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}`;
};

// ─── Create / Edit Quotation Modal ────────────────────────────
const emptyQtnLine = () => ({ itemName: '', itemId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' });

// ─── Convert to Invoice Modal ─────────────────────────────────
// A quotation carries no GL account — this is where revenue is classified,
// so nothing posts until every line has an account the user has seen.
function ConvertModal({ quotationId, preview, accounts, onClose, onDone }) {
  const [assign, setAssign] = useState(() =>
    Object.fromEntries(preview.lines.map((l) => [l.id, l.suggestedAccountId ? String(l.suggestedAccountId) : '']))
  );
  const [dueDate, setDueDate] = useState(plusDays(30));
  const [saving, setSaving]   = useState(false);

  const unassigned = preview.lines.filter((l) => !assign[l.id]).length;

  const submit = async () => {
    if (unassigned) { toast.error('Every line needs a revenue account'); return; }
    setSaving(true);
    try {
      const { data } = await rApi.quotations.convert(quotationId, {
        dueDate,
        accounts: preview.lines.map((l) => ({ lineId: l.id, accountId: Number(assign[l.id]) })),
      });
      toast.success(`Converted to invoice ${data.invoice.invoiceNo}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Conversion failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">Convert {preview.quotationNo} to Invoice</h3>
            <p className="text-xs text-gray-400">{preview.customer?.name} · {formatCurrency(preview.totalAmount)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        <div className="modal-body space-y-4">
          <div className="form-group max-w-xs">
            <label className="label">Due Date *</label>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>

          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Assign the revenue account for each line</h4>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th className="w-36 text-right">Amount</th>
                    <th className="w-64">Revenue Account</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div className="text-sm">{l.itemName || l.description}</div>
                        {l.itemName && <div className="text-xs text-gray-400">{l.description}</div>}
                      </td>
                      <td className="text-right text-sm">{formatCurrency(l.amount)}</td>
                      <td>
                        <AccountSelect
                          value={assign[l.id]}
                          onChange={(v) => setAssign((a) => ({ ...a, [l.id]: v }))}
                          accounts={accounts}
                          placeholder="— select revenue account —"
                        />
                        <p className="text-[10px] text-gray-400 mt-0.5">{l.suggestedFrom}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Creating the invoice posts <strong>DR 1100 Accounts Receivable</strong> against the
            revenue accounts chosen above.
          </p>
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving || unassigned > 0} className="btn-primary">
            {saving ? 'Converting…' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuotationModal({ quotation, customers, items, onClose, onSaved, onCustomerAdded }) {
  const isEdit = !!quotation?.id;
  const [form, setForm] = useState(
    quotation
      ? {
          customerId:    String(quotation.customerId),
          quotationDate: quotation.quotationDate?.split('T')[0] || todayStr(),
          validUntil:    quotation.validUntil?.split('T')[0] || plusDays(30),
          description:   quotation.description || '',
          notes:         quotation.notes || '',
          lines: quotation.lines?.length
            ? quotation.lines.map((l) => ({
                itemName: l.itemName || '', itemId: l.itemId ? String(l.itemId) : '',
                description: l.description,
                quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
              }))
            : [emptyQtnLine()],
        }
      : {
          customerId: '', quotationDate: todayStr(), validUntil: plusDays(30), description: '', notes: '',
          lines: [emptyQtnLine()],
        }
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) }));
  // Typing is free-form; if the text exactly matches a stocked item we remember
  // its id so the conversion can inherit that item's revenue account and price.
  const setItemName = (i, value) => {
    const match = items.find((it) => it.name === value);
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, itemName: value, itemId: match ? String(match.id) : '' };
        if (match && !l.unitPrice) next.unitPrice = String(match.sellingPrice);
        if (match && !l.description) next.description = match.name;
        return next;
      }),
    }));
  };

  const addLine = () =>
    setForm((f) => ({ ...f, lines: [...f.lines, emptyQtnLine()] }));
  const removeLine = (i) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const totals = form.lines.reduce(
    (acc, l) => {
      const amt = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      const v = computeVAT(amt, l.vatCode);
      acc.subtotal += v.base; acc.vat += v.vat; acc.total += v.total;
      return acc;
    },
    { subtotal: 0, vat: 0, total: 0 }
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.customerId) { toast.error('Select or add a customer'); return; }
    const validLines = form.lines.filter((l) => l.description && l.unitPrice);
    if (!validLines.length) { toast.error('Add at least one line item'); return; }
    validLines.forEach((l) => rememberDescription(l.description));
    setSaving(true);
    try {
      const payload = {
        customerId: Number(form.customerId),
        quotationDate: form.quotationDate,
        validUntil: form.validUntil,
        description: form.description,
        notes: form.notes,
        lines: validLines.map((l) => ({
          itemName:    l.itemName || null,
          itemId:      l.itemId ? Number(l.itemId) : null,
          description: l.description,
          quantity:    Number(l.quantity),
          unitPrice:   Number(l.unitPrice),
          vatCode:     l.vatCode,
        })),
      };
      if (isEdit) await rApi.quotations.update(quotation.id, payload);
      else        await rApi.quotations.create(payload);
      toast.success(isEdit ? 'Quotation updated' : 'Quotation created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save quotation');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-6xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Quotation' : 'New Quotation'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Customer *</label>
                <CustomerSelect
                  customers={customers}
                  value={form.customerId}
                  onChange={(id) => setForm((f) => ({ ...f, customerId: id }))}
                  onCustomerAdded={onCustomerAdded}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label">Description / Subject</label>
                <input className="input" value={form.description} onChange={set('description')}
                  placeholder="e.g. Proposal for July campaign" />
              </div>
              <div className="form-group">
                <label className="label">Quotation Date *</label>
                <input type="date" className="input" required value={form.quotationDate} onChange={set('quotationDate')} />
              </div>
              <div className="form-group">
                <label className="label">Valid Until *</label>
                <input type="date" className="input" required value={form.validUntil} onChange={set('validUntil')} />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Line Items</h4>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Line
                </button>
              </div>
              <datalist id="qtn-items">
                {items.map((it) => <option key={it.id} value={it.name}>{it.sku}</option>)}
              </datalist>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th className="w-56">Item</th>
                      <th>Description</th>
                      <th className="w-28">VAT</th>
                      <th className="w-32 text-right">Qty</th>
                      <th className="w-40 text-right">Unit Price (₱)</th>
                      <th className="w-44 text-right">Amount (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, i) => {
                      const amt = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                      const v = computeVAT(amt, line.vatCode);
                      return (
                        <tr key={i}>
                          <td>
                            <input
                              className="input text-xs"
                              list="qtn-items"
                              value={line.itemName}
                              onChange={(e) => setItemName(i, e.target.value)}
                              placeholder="Item or service…"
                            />
                            {line.itemId && (
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {items.find((it) => it.id === Number(line.itemId))?.sku} · revenue account carries to the invoice
                              </p>
                            )}
                          </td>
                          <td>
                            <DescriptionInput className="input text-xs" value={line.description}
                              onChange={(v) => setLine(i, 'description', v)} placeholder="Item / service" />
                          </td>
                          <td>
                            <select className="select text-xs" value={line.vatCode}
                              onChange={(e) => setLine(i, 'vatCode', e.target.value)}>
                              {VAT_CODES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            <NumberInput decimals={3} className="input text-xs text-right"
                              value={line.quantity} onChange={(v) => setLine(i, 'quantity', v)} />
                          </td>
                          <td>
                            <NumberInput className="input text-xs text-right"
                              value={line.unitPrice} onChange={(v) => setLine(i, 'unitPrice', v)} placeholder="0.00" />
                          </td>
                          <td className="text-right text-sm font-medium">
                            {formatCurrency(v.total)}
                            {line.vatCode === 'VAT' && amt > 0 && (
                              <div className="text-xs text-gray-400">incl. {formatCurrency(v.vat)} VAT</div>
                            )}
                          </td>
                          <td>
                            {form.lines.length > 1 && (
                              <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end mt-4">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(totals.subtotal)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(totals.vat)}</span></div>
                  <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-1"><span>Total</span><span>{formatCurrency(totals.total)}</span></div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Validity terms, scope notes…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Quotation')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────
function QuotationDetailModal({ quotation, onClose, onAction, onConvert, onEdit, onDelete }) {
  const q = quotation;
  const expired = new Date(q.validUntil) < new Date() && !['CONVERTED', 'REJECTED'].includes(q.status);
  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{q.quotationNo}</h3>
            <p className="text-sm text-gray-400">{q.customer?.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="flex gap-2 flex-wrap">
            <span className={`badge ${STATUS_BADGE[q.status]}`}>{q.status}</span>
            {expired && <span className="badge badge-yellow">Past validity</span>}
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">Quotation Date</span><div>{formatDate(q.quotationDate)}</div></div>
            <div><span className="text-gray-400">Valid Until</span><div>{formatDate(q.validUntil)}</div></div>
            {q.description && <div className="col-span-2"><span className="text-gray-400">Subject</span><div>{q.description}</div></div>}
            <div>
              <span className="text-gray-400">Created</span>
              <div>
                {fmtDateTime(q.createdAt)}
                {q.creator && <span className="text-gray-400"> by {q.creator.firstName} {q.creator.lastName}</span>}
              </div>
            </div>
            {q.updatedAt && fmtDateTime(q.updatedAt) !== fmtDateTime(q.createdAt) && (
              <div><span className="text-gray-400">Last Updated</span><div>{fmtDateTime(q.updatedAt)}</div></div>
            )}
            {q.notes && <div className="col-span-2"><span className="text-gray-400">Notes</span><div className="whitespace-pre-wrap">{q.notes}</div></div>}
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="table text-sm">
              <thead><tr><th>Item</th><th>Description</th><th className="text-center">VAT</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
              <tbody>
                {q.lines?.map((l) => (
                  <tr key={l.id}>
                    <td className="text-xs">{l.itemName || '—'}</td>
                    <td>{l.description}</td>
                    <td className="text-center"><span className={`badge text-xs ${l.vatCode === 'VAT' ? 'badge-blue' : 'badge-gray'}`}>{l.vatCode}</span></td>
                    <td className="text-right">{Number(l.quantity).toLocaleString()}</td>
                    <td className="text-right">{formatCurrency(l.unitPrice)}</td>
                    <td className="text-right">{formatCurrency(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(q.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">VAT (12%)</span><span>{formatCurrency(q.vatAmount)}</span></div>
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-1"><span>Total</span><span>{formatCurrency(q.totalAmount)}</span></div>
            </div>
          </div>

          {q.status === 'CONVERTED' && (
            <p className="text-sm text-green-600 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
              Converted to an AR invoice.
            </p>
          )}
        </div>
        <div className="modal-footer flex-wrap gap-2">
          {q.status === 'DRAFT' && <button onClick={() => onEdit(q)} className="btn-secondary btn-sm mr-auto"><Edit2 className="w-4 h-4" /> Edit</button>}
          {q.status === 'DRAFT' && <button onClick={() => onAction('send', q)} className="btn-primary btn-sm"><Send className="w-4 h-4" /> Mark Sent</button>}
          {['DRAFT', 'SENT'].includes(q.status) && <button onClick={() => onAction('accept', q)} className="btn-success btn-sm"><CheckCircle2 className="w-4 h-4" /> Accept</button>}
          {['DRAFT', 'SENT'].includes(q.status) && <button onClick={() => onAction('reject', q)} className="btn-danger btn-sm"><XCircle className="w-4 h-4" /> Reject</button>}
          {q.status !== 'CONVERTED' && <button onClick={() => onConvert(q)} className="btn-success btn-sm"><ArrowRightCircle className="w-4 h-4" /> Convert to Invoice</button>}
          {q.status !== 'CONVERTED' && <button onClick={() => onDelete(q)} className="btn-danger btn-sm"><Trash2 className="w-4 h-4" /> Delete</button>}
        </div>
      </div>
    </div>
  );
}

// ─── Main Quotations Page ─────────────────────────────────────
export default function QuotationsPage() {
  const [rows, setRows]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [filter, setFilter]       = useState({ status: '', customerId: '', from: '', to: '', search: '' });
  const [modal, setModal]         = useState(null);
  const LIMIT = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, ...filter };
      Object.keys(params).forEach((k) => !params[k] && delete params[k]);
      const r = await rApi.quotations.list(params);
      setRows(r.data.data);
      setTotal(r.data.total);
    } catch {
      toast.error('Failed to load quotations');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
    invApi.items.list({ limit: 500 })
      .then((r) => setItems(r.data.data || r.data || []))
      .catch(() => setItems([]));
  }, []);

  const openDetail = async (row) => {
    try {
      const { data } = await rApi.quotations.get(row.id);
      setModal({ type: 'detail', quotation: data });
    } catch { toast.error('Failed to load quotation'); }
  };

  const handleAction = async (mode, q) => {
    try {
      await rApi.quotations[mode](q.id);
      toast.success(`Quotation ${mode === 'send' ? 'marked sent' : mode + 'ed'}`);
      setModal(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Action failed'); }
  };

  // The revenue account is assigned during conversion, so open the dialog
  // rather than converting straight away.
  const handleConvert = async (q) => {
    try {
      const { data } = await rApi.quotations.convertPreview(q.id);
      setModal({ type: 'convert', quotationId: q.id, preview: data });
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to prepare the conversion'); }
  };

  const handleDelete = async (q) => {
    if (!confirm(`Delete quotation ${q.quotationNo}?`)) return;
    try {
      await rApi.quotations.remove(q.id);
      toast.success('Quotation deleted');
      setModal(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  const printQuotation = async (q) => {
    const full = q.lines ? q : (await rApi.quotations.get(q.id)).data;
    const linesHTML = (full.lines || []).map((l) => `
      <tr>
        <td>${l.description}</td>
        <td class="center">${badge(l.vatCode)}</td>
        <td class="right">${Number(l.quantity).toLocaleString()}</td>
        <td class="right mono">${phpFmt(l.unitPrice)}</td>
        <td class="right mono">${phpFmt(l.amount)}</td>
      </tr>`).join('');
    const body = `
      <h2 style="margin:0 0 4px">QUOTATION ${full.quotationNo}</h2>
      <p style="margin:0 0 12px;color:#6b7280">Valid until ${dateFmt(full.validUntil)}</p>
      <table style="width:100%;margin-bottom:12px"><tr>
        <td><strong>Customer:</strong> ${full.customer?.name || ''}</td>
        <td class="right"><strong>Date:</strong> ${dateFmt(full.quotationDate)}</td>
      </tr></table>
      ${full.description ? `<p><strong>Subject:</strong> ${full.description}</p>` : ''}
      <table>
        <thead><tr><th>Description</th><th class="center">VAT</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
        <tbody>${linesHTML}</tbody>
      </table>
      <div style="display:flex;justify-content:flex-end;margin-top:12px">
        <table style="width:260px">
          <tr><td>Subtotal</td><td class="right mono">${phpFmt(full.subtotal)}</td></tr>
          <tr><td>VAT (12%)</td><td class="right mono">${phpFmt(full.vatAmount)}</td></tr>
          <tr><td class="bold">Total</td><td class="right mono bold">${phpFmt(full.totalAmount)}</td></tr>
        </table>
      </div>
      <p style="margin-top:24px;font-size:11px;color:#6b7280">This is a quotation only and not a demand for payment. Prices valid until ${dateFmt(full.validUntil)}.</p>`;
    printDocument('Quotation', full.quotationNo, body);
  };

  const clearFilter = () => setFilter({ status: '', customerId: '', from: '', to: '', search: '' });
  const activeFilters = Object.values(filter).filter(Boolean).length;
  const pages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Quotations</h1>
          <p className="page-subtitle">Accounts Receivable — {total} quotation{total !== 1 ? 's' : ''} total</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ type: 'new' })}>
          <Plus className="w-4 h-4" /> New Quotation
        </button>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search quotation no., customer…"
              value={filter.search} onChange={(e) => { setPage(1); setFilter((f) => ({ ...f, search: e.target.value })); }} />
          </div>
          <select className="select w-40" value={filter.status} onChange={(e) => { setPage(1); setFilter((f) => ({ ...f, status: e.target.value })); }}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="select w-44" value={filter.customerId} onChange={(e) => { setPage(1); setFilter((f) => ({ ...f, customerId: e.target.value })); }}>
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {activeFilters > 0 && (
            <button className="btn-secondary" onClick={clearFilter}><X className="w-4 h-4" /> Clear</button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['Quotation No.', 'Customer', 'Date', 'Valid Until', 'Total', 'Status', 'Actions'].map((h) => (
                  <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase ${h === 'Total' ? 'text-right' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  <FileText className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  No quotations found.
                  <div className="mt-3"><button className="btn-primary btn-sm" onClick={() => setModal({ type: 'new' })}><Plus className="w-4 h-4" /> Create First Quotation</button></div>
                </td></tr>
              ) : rows.map((q) => (
                <tr key={q.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-green-700 cursor-pointer" onClick={() => openDetail(q)}>{q.quotationNo}</td>
                  <td className="px-4 py-3">{q.customer?.name}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(q.quotationDate)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(q.validUntil)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(q.totalAmount)}</td>
                  <td className="px-4 py-3"><span className={`badge ${STATUS_BADGE[q.status]}`}>{q.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button className="btn-secondary btn-sm" onClick={() => openDetail(q)} title="View"><Eye className="w-3 h-3" /></button>
                      <button className="btn-secondary btn-sm" onClick={() => printQuotation(q)} title="Print"><Printer className="w-3 h-3" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm">
            <span className="text-gray-500">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button>
              <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'new' && (
        <QuotationModal customers={customers} items={items}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'edit' && (
        <QuotationModal quotation={modal.quotation} customers={customers} items={items}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'convert' && (
        <ConvertModal quotationId={modal.quotationId} preview={modal.preview} accounts={accounts}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'detail' && (
        <QuotationDetailModal quotation={modal.quotation}
          onClose={() => setModal(null)}
          onAction={handleAction}
          onConvert={handleConvert}
          onDelete={handleDelete}
          onEdit={(q) => setModal({ type: 'edit', quotation: q })} />
      )}
    </div>
  );
}
