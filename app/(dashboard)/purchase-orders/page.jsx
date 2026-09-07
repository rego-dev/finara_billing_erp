'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { purchaseOrders as poApi, payable, accounts as acctApi, poScanner, poForm as poFormApi, inventory as invApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Plus, Send, PackageCheck, FileText, XCircle, Trash2,
  Eye, Printer, Edit2, Search, ChevronDown, CheckCircle2,
  ScanLine, Download, Loader2, CheckCircle, AlertCircle, Banknote,
} from 'lucide-react';
import VendorSelect from '@/components/VendorSelect';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

// ─── Constants ────────────────────────────────────────────────
const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  PARTIAL:   'badge-yellow',
  RECEIVED:  'badge-green',
  BILLED:    'badge-green',
  CANCELLED: 'badge-red',
};
const STATUS_LABEL = {
  DRAFT: 'Draft', SENT: 'Sent', PARTIAL: 'Partially Received',
  RECEIVED: 'Received', BILLED: 'Billed', CANCELLED: 'Cancelled',
};
const ALL_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'BILLED', 'CANCELLED'];
const emptyLine = () => ({ description: '', quantity: 1, unitPrice: 0, accountId: '' });

// ─── Print helper ─────────────────────────────────────────────
async function printPO(po) {
  const lineRows = (po.lines || []).map((l) => `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:8px 10px;">${l.description || ''}</td>
      <td style="padding:8px 10px;text-align:right;">${Number(l.quantity).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;">${phpFmt(l.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:600;">${phpFmt(Number(l.quantity) * Number(l.unitPrice))}</td>
    </tr>`).join('');

  const receivedRows = (po.lines || []).some((l) => Number(l.receivedQty) > 0)
    ? `<div style="margin-top:24px;">
        <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Receipt Status</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:6px 10px;text-align:left;color:#374151;">Item</th>
            <th style="padding:6px 10px;text-align:right;color:#374151;">Ordered</th>
            <th style="padding:6px 10px;text-align:right;color:#374151;">Received</th>
          </tr></thead>
          <tbody>${(po.lines || []).map((l) => `
            <tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:6px 10px;">${l.description}</td>
              <td style="padding:6px 10px;text-align:right;">${Number(l.quantity).toFixed(2)}</td>
              <td style="padding:6px 10px;text-align:right;color:${Number(l.receivedQty) >= Number(l.quantity) ? '#16a34a' : '#d97706'};">${Number(l.receivedQty).toFixed(2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  const body = `
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1d4ed8;display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <p style="margin:0;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Purchase Order</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#1d4ed8;">${po.poNumber}</p>
      </div>
      <div style="text-align:right;font-size:12px;color:#374151;">
        <p style="margin:0;"><strong>Status:</strong> <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-weight:600;">${STATUS_LABEL[po.status] || po.status}</span></p>
        <p style="margin:4px 0 0;"><strong>Order Date:</strong> ${dateFmt(po.orderDate)}</p>
        ${po.expectedDate ? `<p style="margin:2px 0 0;"><strong>Expected:</strong> ${dateFmt(po.expectedDate)}</p>` : ''}
      </div>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">Bill To / Vendor</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">${po.vendor?.name || '—'}</p>
      ${po.vendor?.tin ? `<p style="margin:3px 0 0;font-size:12px;color:#475569;">TIN: ${po.vendor.tin}</p>` : ''}
      ${po.vendor?.address ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.address}</p>` : ''}
      ${po.vendor?.contactName ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">Attn: ${po.vendor.contactName}</p>` : ''}
      ${po.vendor?.email ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.email}</p>` : ''}
      ${po.vendor?.phone ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.phone}</p>` : ''}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
      <thead>
        <tr style="background:#1d4ed8;color:#fff;">
          <th style="padding:9px 10px;text-align:left;border-radius:6px 0 0 6px;">Description</th>
          <th style="padding:9px 10px;text-align:right;width:70px;">Qty</th>
          <th style="padding:9px 10px;text-align:right;width:110px;">Unit Price</th>
          <th style="padding:9px 10px;text-align:right;width:110px;border-radius:0 6px 6px 0;">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr>
        <td style="width:55%"></td>
        <td style="padding:5px 10px;color:#6b7280;border-top:1px solid #e5e7eb;">Subtotal</td>
        <td style="padding:5px 10px;text-align:right;border-top:1px solid #e5e7eb;">${phpFmt(po.subtotal)}</td>
      </tr>
      <tr>
        <td></td>
        <td style="padding:5px 10px;color:#6b7280;">Tax / VAT</td>
        <td style="padding:5px 10px;text-align:right;">${phpFmt(po.taxAmount)}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td></td>
        <td style="padding:9px 10px;font-weight:700;color:#1e3a8a;border-top:2px solid #1d4ed8;">TOTAL</td>
        <td style="padding:9px 10px;text-align:right;font-weight:800;font-size:15px;color:#1d4ed8;border-top:2px solid #1d4ed8;">${phpFmt(po.total)}</td>
      </tr>
    </table>

    ${po.notes ? `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:20px;background:#fefce8;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;">Notes / Terms</p>
      <p style="margin:0;font-size:13px;color:#374151;">${po.notes}</p>
    </div>` : ''}

    ${receivedRows}

    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;font-size:12px;">
      ${['Prepared by', 'Checked by', 'Approved by'].map((label) => `
        <div>
          <p style="font-weight:700;color:#111827;margin:0 0 36px;">${label}:</p>
          <div style="border-top:1px solid #374151;padding-top:4px;color:#6b7280;">Signature / Date</div>
        </div>`).join('')}
    </div>`;

  await printDocument(`Purchase Order — ${po.poNumber}`, `Vendor: ${po.vendor?.name || ''}`, body);
}

// ─── View Modal ───────────────────────────────────────────────
function POViewModal({ po, onClose, onEdit, onSend, onReceive, onConvert, onPettyCash, onCancel }) {
  const subtotal = (po.lines || []).reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-bold text-blue-700">{po.poNumber}</h3>
              <span className={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status] || po.status}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => printPO(po)} className="btn-secondary btn-sm flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            {['DRAFT', 'SENT'].includes(po.status) && (
              <button onClick={onEdit} className="btn-secondary btn-sm flex items-center gap-1.5">
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl ml-1">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          {/* Meta info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Vendor', value: po.vendor?.name },
              { label: 'Order Date', value: formatDate(po.orderDate) },
              { label: 'Expected Date', value: po.expectedDate ? formatDate(po.expectedDate) : '—' },
              { label: 'Created', value: formatDate(po.createdAt) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 font-medium">{label}</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">{value || '—'}</p>
              </div>
            ))}
          </div>

          {po.vendor && (
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold text-blue-900">{po.vendor.name}</p>
              {po.vendor.tin && <p className="text-blue-700 text-xs mt-0.5">TIN: {po.vendor.tin}</p>}
              {po.vendor.address && <p className="text-blue-600 text-xs">{po.vendor.address}</p>}
              {po.vendor.contactName && <p className="text-blue-600 text-xs">Attn: {po.vendor.contactName} {po.vendor.email ? `· ${po.vendor.email}` : ''}</p>}
            </div>
          )}

          {/* Line items */}
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-right w-20">Qty</th>
                  <th className="text-right w-28">Unit Price</th>
                  <th className="text-right w-28">Amount</th>
                  <th className="text-right w-24 text-green-700">Received</th>
                </tr>
              </thead>
              <tbody>
                {(po.lines || []).map((l, i) => {
                  const amount = Number(l.quantity) * Number(l.unitPrice);
                  const recv   = Number(l.receivedQty || 0);
                  const full   = recv >= Number(l.quantity);
                  return (
                    <tr key={i}>
                      <td className="font-medium">{l.description}</td>
                      <td className="text-right font-mono">{Number(l.quantity).toFixed(2)}</td>
                      <td className="text-right font-mono">{formatCurrency(l.unitPrice)}</td>
                      <td className="text-right font-mono font-semibold">{formatCurrency(amount)}</td>
                      <td className={`text-right font-mono text-xs ${full ? 'text-green-600 font-semibold' : recv > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {recv > 0 ? `${recv.toFixed(2)}` : '—'}
                        {full && <CheckCircle2 className="inline w-3 h-3 ml-1 mb-0.5" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span className="font-mono">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Tax / VAT</span><span className="font-mono">{formatCurrency(po.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
                <span>Total</span><span className="font-mono text-blue-700">{formatCurrency(po.total)}</span>
              </div>
            </div>
          </div>

          {po.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold text-xs text-amber-600 mb-1">NOTES</p>
              {po.notes}
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="modal-footer flex-wrap gap-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <div className="flex gap-2 flex-wrap">
            {po.status === 'DRAFT' && (
              <button onClick={onSend} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                <Send className="w-3.5 h-3.5" /> Mark as Sent
              </button>
            )}
            {['SENT', 'PARTIAL'].includes(po.status) && (
              <button onClick={onReceive} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                <PackageCheck className="w-3.5 h-3.5" /> Receive Goods
              </button>
            )}
            {['SENT', 'PARTIAL', 'RECEIVED'].includes(po.status) && (
              <button onClick={onConvert} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700">
                <FileText className="w-3.5 h-3.5" /> Convert to Bill
              </button>
            )}
            {['SENT', 'PARTIAL', 'RECEIVED'].includes(po.status) && (
              <button onClick={onPettyCash} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
                <Banknote className="w-3.5 h-3.5" /> Pay from Petty Cash
              </button>
            )}
            {!['BILLED', 'CANCELLED'].includes(po.status) && (
              <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-medium hover:bg-red-200">
                <XCircle className="w-3.5 h-3.5" /> Cancel PO
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────
function POModal({ po, vendors, accounts, items, initialData, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(po ? {
    vendorId:     po.vendorId,
    orderDate:    po.orderDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    expectedDate: po.expectedDate?.split('T')[0] || '',
    notes:        po.notes || '',
    taxAmount:    po.taxAmount || 0,
    lines:        po.lines?.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId || '' })) || [emptyLine()],
  } : initialData ? {
    // Pre-filled from scanned form
    vendorId:     initialData.vendorId || '',
    orderDate:    initialData.orderDate || new Date().toISOString().split('T')[0],
    expectedDate: initialData.expectedDate || '',
    notes:        initialData.notes || '',
    taxAmount:    initialData.taxAmount || 0,
    lines:        initialData.lines?.length > 0
                    ? initialData.lines
                    : [emptyLine(), emptyLine()],
  } : {
    vendorId: '', orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '', notes: '', taxAmount: 0, lines: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);

  const subtotal = form.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const total    = subtotal + Number(form.taxAmount || 0);

  const setLine = (i, f, v) => setForm((p) => ({ ...p, lines: p.lines.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, emptyLine()] }));
  const rmLine  = (i) => setForm((p) => ({ ...p, lines: p.lines.filter((_, idx) => idx !== i) }));

  // Typing is free-form; if the text exactly matches a stocked inventory item,
  // pull its cost price and inventory asset account so buying stock doesn't
  // require re-typing what's already set up in Inventory > Items.
  const setDescription = (i, value) => {
    const match = items.find((it) => it.name === value);
    setForm((p) => ({
      ...p,
      lines: p.lines.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, description: value };
        if (match) {
          if (!Number(l.unitPrice)) next.unitPrice = String(match.costPrice);
          if (!l.accountId && match.inventoryAccountId) next.accountId = String(match.inventoryAccountId);
        }
        return next;
      }),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const lines = form.lines.filter((l) => l.description && Number(l.quantity) > 0);
    if (!form.vendorId) return toast.error('Select a vendor');
    if (!lines.length)  return toast.error('Add at least one line item');
    setSaving(true);
    try {
      const payload = { ...form, lines, vendorId: Number(form.vendorId) };
      if (po?.id) await poApi.update(po.id, payload);
      else         await poApi.create(payload);
      toast.success(po?.id ? 'Purchase order updated' : 'Purchase order created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-6xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{po?.id ? `Edit — ${po.poNumber}` : 'New Purchase Order'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="form-group sm:col-span-1">
                <label className="label">Vendor *</label>
                <VendorSelect vendors={vendors} value={form.vendorId} onChange={(id) => setForm((f) => ({ ...f, vendorId: id }))} onVendorAdded={onVendorAdded} required />
              </div>
              <div className="form-group">
                <label className="label">Order Date *</label>
                <input type="date" className="input" value={form.orderDate} onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="label">Expected Delivery Date</label>
                <input type="date" className="input" value={form.expectedDate || ''} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Line Items</label>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Line</button>
              </div>
              <datalist id="po-items">
                {items.map((it) => <option key={it.id} value={it.name}>{it.sku}</option>)}
              </datalist>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="table table-compact text-sm">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-32 text-right">Qty</th>
                      <th className="w-40 text-right">Unit Price</th>
                      <th className="w-56">Expense Account</th>
                      <th className="w-40 text-right">Amount</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, i) => (
                      <tr key={i}>
                        <td><input className="input w-full text-xs" list="po-items" placeholder="Item description" value={l.description} onChange={(e) => setDescription(i, e.target.value)} /></td>
                        <td><NumberInput decimals={3} className="input w-full text-right text-xs" value={l.quantity} onChange={(v) => setLine(i, 'quantity', v)} /></td>
                        <td><NumberInput className="input w-full text-right text-xs" value={l.unitPrice} onChange={(v) => setLine(i, 'unitPrice', v)} /></td>
                        <td>
                          <AccountSelect
                            value={l.accountId || ''}
                            onChange={(val) => setLine(i, 'accountId', val)}
                            accounts={accounts}
                            placeholder="-- for billing --"
                          />
                        </td>
                        <td className="text-right font-mono text-xs font-medium">
                          {formatCurrency(Number(l.quantity || 0) * Number(l.unitPrice || 0))}
                        </td>
                        <td>
                          {form.lines.length > 1 && (
                            <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-6 mt-3 text-sm items-center">
                <span className="text-gray-500">Subtotal: <span className="font-mono font-medium text-gray-800">{formatCurrency(subtotal)}</span></span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 whitespace-nowrap">Tax / VAT:</span>
                  <NumberInput className="input w-32 text-right text-sm"
                    value={form.taxAmount} onChange={(v) => setForm((f) => ({ ...f, taxAmount: v }))} />
                </div>
                <span className="font-bold text-base">Total: <span className="font-mono text-blue-700">{formatCurrency(total)}</span></span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Payment terms, delivery instructions…"
                value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : po?.id ? 'Update PO' : 'Create PO'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Receive Goods Modal ──────────────────────────────────────
function ReceiveModal({ po, onClose, onSaved }) {
  const [lines, setLines] = useState(
    po.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), receivedQty: Number(l.receivedQty || 0) }))
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const over = lines.find((l) => l.receivedQty > l.quantity);
    if (over) {
      toast.error(`"${over.description}" — received qty exceeds the ${over.quantity} ordered`);
      return;
    }
    setSaving(true);
    try {
      await poApi.receive(po.id, { lines: lines.map((l) => ({ id: l.id, receivedQty: l.receivedQty })) });
      toast.success('Goods received updated');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">Receive Goods</h3>
            <p className="text-xs text-gray-400">{po.poNumber} · {po.vendor?.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-3">
          <p className="text-xs text-gray-500">Enter the quantity actually received for each line item.</p>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="table table-compact text-sm">
              <thead><tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right w-36">Qty Received</th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const pct = l.quantity > 0 ? (l.receivedQty / l.quantity) * 100 : 0;
                  return (
                    <tr key={l.id}>
                      <td>
                        <p className="font-medium text-sm">{l.description}</p>
                        <div className="h-1 bg-gray-100 rounded-full mt-1 w-24">
                          <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                      <td className="text-right font-mono">{l.quantity.toFixed(2)}</td>
                      <td>
                        <NumberInput decimals={3} className="input w-full text-right"
                          value={l.receivedQty}
                          onChange={(v) => setLines((p) => p.map((x, idx) => idx === i ? { ...x, receivedQty: Number(v) || 0 } : x))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-4 text-xs text-gray-500 pt-1">
            <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, receivedQty: l.quantity })))}
              className="text-green-600 hover:underline">Mark All Received</button>
            <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, receivedQty: 0 })))}
              className="text-red-500 hover:underline">Clear All</button>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5">
            <PackageCheck className="w-4 h-4" /> {saving ? 'Saving…' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Convert to Bill Modal ────────────────────────────────────
function ConvertModal({ po, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const [billDate, setBillDate] = useState(today);
  const [dueDate,  setDueDate]  = useState(due30);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await poApi.toBill(po.id, { billDate, dueDate });
      toast.success(data.message || 'Bill created successfully');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Conversion failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="font-semibold">Convert to AP Bill</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-sm text-purple-800">
            <p className="font-semibold">{po.poNumber} → {po.vendor?.name}</p>
            <p className="text-xs mt-1 text-purple-600">Total: <strong>{formatCurrency(po.total)}</strong></p>
          </div>
          <p className="text-xs text-gray-500">This will create an AP Bill and post the journal entry to the General Ledger.</p>
          <div className="form-group">
            <label className="label">Bill Date *</label>
            <input type="date" className="input" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Due Date *</label>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">Make sure all line items have an expense account before converting.</p>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-60">
            <FileText className="w-4 h-4" /> {saving ? 'Converting…' : 'Convert to Bill'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pay from Petty Cash Modal ───────────────────────────────
function PettyCashPayModal({ po, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  const [paidDate,         setPaidDate]         = useState(today);
  const [paidBy,           setPaidBy]           = useState('');
  const [receiptNo,        setReceiptNo]        = useState('');
  const [notes,            setNotes]            = useState('');
  const [fundAccountCode,  setFundAccountCode]  = useState('1011');
  const [saving,           setSaving]           = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await poApi.pettyCash(po.id, { paidDate, paidBy, receiptNo, notes, fundAccountCode });
      toast.success(data.message || 'Petty cash payment recorded');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="font-semibold flex items-center gap-2">
            <Banknote className="w-5 h-5 text-amber-500" /> Pay from Petty Cash
          </h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-800">
            <p className="font-semibold">{po.poNumber} — {po.vendor?.name}</p>
            <p className="text-xs mt-1 text-amber-600">Amount: <strong>{formatCurrency(po.total)}</strong></p>
          </div>
          <p className="text-xs text-gray-500">
            This will create an Expense Voucher (Petty Cash) and post the GL entry:
            <br/>Dr Expense accounts → Cr Petty Cash Fund (1011)
          </p>
          <div className="form-group">
            <label className="label">Fund Source *</label>
            <div className="flex gap-2">
              <button type="button"
                onClick={() => setFundAccountCode('1011')}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${fundAccountCode === '1011' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-400'}`}
              >
                💵 Cash (1011)
              </button>
              <button type="button"
                onClick={() => setFundAccountCode('1012')}
                className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${fundAccountCode === '1012' ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}
              >
                📱 GCash (1012)
              </button>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Payment Date *</label>
            <input type="date" className="input" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Paid By</label>
            <input type="text" className="input" placeholder="Cashier / Petty Cash custodian" value={paidBy} onChange={(e) => setPaidBy(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Receipt / OR No.</label>
            <input type="text" className="input" placeholder="Official receipt number" value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <input type="text" className="input" placeholder="Optional remarks" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">
            Make sure all PO lines have an expense account assigned. The voucher will appear in today&apos;s Daily Remittance Report.
          </p>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-60">
            <Banknote className="w-4 h-4" /> {saving ? 'Processing…' : 'Confirm Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Download Blank Form Button ───────────────────────────────
function DownloadFormButton() {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const res = await poFormApi.downloadBlank();
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      a.href     = url;
      a.download = 'PO_BlankForm.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error('Could not generate form');
    } finally { setBusy(false); }
  };

  return (
    <button
      onClick={download}
      disabled={busy}
      className="btn-secondary flex items-center gap-1.5 text-sm"
      title="Download blank PO form with company letterhead"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
      {busy ? 'Generating…' : 'Blank Form'}
    </button>
  );
}

// ─── Scan Modal ───────────────────────────────────────────────
function ScanModal({ vendors, accounts, onClose, onImport }) {
  const fileRef  = useRef(null);
  const [step,   setStep]   = useState('upload'); // upload | scanning | review
  const [preview, setPreview] = useState(null);
  const [result,  setResult]  = useState(null);
  const [editData, setEditData] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setStep('scanning');
    try {
      const fd = new FormData();
      fd.append('image', file);
      const { data } = await poScanner.scan(fd);
      if (!data.success) throw new Error(data.error || 'OCR failed');
      setResult(data);
      // Pre-fill editable form
      setEditData({
        vendorName:   data.vendor?.name   || '',
        orderDate:    data.orderDate       || new Date().toISOString().split('T')[0],
        expectedDate: data.expectedDate    || '',
        notes:        data.notes           || '',
        taxAmount:    data.taxAmount       || 0,
        lines: (data.lines || []).length > 0
          ? data.lines.map(l => ({
              description: l.description || '',
              quantity:    l.quantity    || 1,
              unitPrice:   l.unitPrice   || 0,
              accountId:   '',
            }))
          : [{ description: '', quantity: 1, unitPrice: 0, accountId: '' }],
      });
      setStep('review');
    } catch (e) {
      toast.error(e.response?.data?.error || e.message || 'OCR failed');
      setStep('upload');
    }
  };

  const setLine = (i, f, v) =>
    setEditData(p => ({ ...p, lines: p.lines.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () =>
    setEditData(p => ({ ...p, lines: [...p.lines, { description: '', quantity: 1, unitPrice: 0, accountId: '' }] }));
  const rmLine = (i) =>
    setEditData(p => ({ ...p, lines: p.lines.filter((_, idx) => idx !== i) }));

  const subtotal = editData?.lines?.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0) || 0;
  const total    = subtotal + Number(editData?.taxAmount || 0);

  const handleImport = () => {
    if (!editData) return;
    // Match vendor by name (best-effort)
    const matchedVendor = vendors.find(v =>
      v.name.toLowerCase().includes(editData.vendorName.toLowerCase()) ||
      editData.vendorName.toLowerCase().includes(v.name.toLowerCase())
    );
    onImport({
      vendorId:     matchedVendor?.id || '',
      orderDate:    editData.orderDate,
      expectedDate: editData.expectedDate,
      notes:        editData.notes,
      taxAmount:    editData.taxAmount,
      lines:        editData.lines.filter(l => l.description),
      _scannedVendorName: editData.vendorName,
      _vendorMatched: !!matchedVendor,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <div className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Scan Purchase Order Form</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        <div className="modal-body space-y-4">
          {/* Step: Upload */}
          {step === 'upload' && (
            <div>
              <div
                className="border-2 border-dashed border-blue-200 rounded-2xl p-12 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
              >
                <ScanLine className="w-12 h-12 mx-auto text-blue-300 mb-3" />
                <p className="text-gray-600 font-medium">Click or drag & drop a scanned PO image</p>
                <p className="text-xs text-gray-400 mt-1">Supports JPG, PNG, TIFF · Max 20 MB</p>
                <p className="text-xs text-blue-500 mt-3">
                  Best results: scan at 200+ DPI, straight alignment, good lighting
                </p>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />

              <div className="mt-4 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                <strong>Tips for best OCR accuracy:</strong> Use the official blank form (Download Blank Form button).
                Fill fields clearly in print letters. Scan flat, avoid shadows. Min 200 DPI.
              </div>
            </div>
          )}

          {/* Step: Scanning */}
          {step === 'scanning' && (
            <div className="flex flex-col items-center py-16 gap-4">
              {preview && (
                <img src={preview} alt="Scanned PO" className="max-h-48 rounded-xl border border-gray-200 shadow mb-2" />
              )}
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-gray-600 font-medium">Running OCR… please wait</p>
              <p className="text-xs text-gray-400">This usually takes 5–20 seconds</p>
            </div>
          )}

          {/* Step: Review */}
          {step === 'review' && editData && (
            <div className="space-y-4">
              {/* Confidence summary */}
              <div className={`rounded-xl px-4 py-3 flex items-start gap-3 text-sm ${
                result.confidence.lineCount > 0 ? 'bg-green-50 border border-green-100 text-green-800'
                  : 'bg-amber-50 border border-amber-100 text-amber-800'
              }`}>
                {result.confidence.lineCount > 0
                  ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                <div>
                  <strong>OCR complete.</strong>{' '}
                  Found {result.confidence.lineCount} line item(s),{' '}
                  {result.confidence.hasVendor ? 'vendor name detected' : 'vendor not detected'},{' '}
                  {result.confidence.hasTotal ? `total ₱${Number(result.total).toLocaleString()}` : 'total not found'}.
                  {' '}<span className="opacity-70">Review and correct any errors before importing.</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Preview image */}
                {preview && (
                  <div>
                    <p className="text-xs text-gray-400 font-medium mb-1">Scanned Image</p>
                    <img src={preview} alt="Scanned PO" className="rounded-xl border border-gray-200 w-full object-contain max-h-52" />
                  </div>
                )}
                {/* Header fields */}
                <div className="space-y-3">
                  <div>
                    <label className="label text-xs">Vendor Name (detected)</label>
                    <input className="input text-sm" value={editData.vendorName}
                      onChange={e => setEditData(p => ({ ...p, vendorName: e.target.value }))} />
                    {editData.vendorName && !vendors.find(v =>
                      v.name.toLowerCase().includes(editData.vendorName.toLowerCase()) ||
                      editData.vendorName.toLowerCase().includes(v.name.toLowerCase())
                    ) && (
                      <p className="text-xs text-amber-600 mt-0.5">
                        ⚠ No matching vendor found — you'll need to select one after import
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="label text-xs">Order Date</label>
                      <input type="date" className="input text-sm" value={editData.orderDate}
                        onChange={e => setEditData(p => ({ ...p, orderDate: e.target.value }))} />
                    </div>
                    <div>
                      <label className="label text-xs">Expected Date</label>
                      <input type="date" className="input text-sm" value={editData.expectedDate || ''}
                        onChange={e => setEditData(p => ({ ...p, expectedDate: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="label text-xs">Notes</label>
                    <input className="input text-sm" value={editData.notes}
                      onChange={e => setEditData(p => ({ ...p, notes: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label text-xs">Tax / VAT Amount</label>
                    <NumberInput className="input text-sm" value={editData.taxAmount}
                      onChange={v => setEditData(p => ({ ...p, taxAmount: v }))} />
                  </div>
                </div>
              </div>

              {/* Line items review */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0 text-sm">Line Items (edit as needed)</label>
                  <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Row</button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="table table-compact text-sm">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th className="w-32 text-right">Qty</th>
                        <th className="w-40 text-right">Unit Price</th>
                        <th className="w-48">Account</th>
                        <th className="w-40 text-right">Amount</th>
                        <th className="w-6"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editData.lines.map((l, i) => (
                        <tr key={i}>
                          <td>
                            <input className="input w-full text-xs" value={l.description}
                              onChange={e => setLine(i, 'description', e.target.value)} />
                          </td>
                          <td>
                            <NumberInput decimals={3} className="input w-full text-right text-xs"
                              value={l.quantity} onChange={v => setLine(i, 'quantity', v)} />
                          </td>
                          <td>
                            <NumberInput className="input w-full text-right text-xs"
                              value={l.unitPrice} onChange={v => setLine(i, 'unitPrice', v)} />
                          </td>
                          <td>
                            <AccountSelect value={l.accountId || ''}
                              onChange={v => setLine(i, 'accountId', v)}
                              accounts={accounts} placeholder="-- (optional) --" />
                          </td>
                          <td className="text-right font-mono text-xs font-medium">
                            {formatCurrency(Number(l.quantity || 0) * Number(l.unitPrice || 0))}
                          </td>
                          <td>
                            {editData.lines.length > 1 && (
                              <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600">&times;</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-6 mt-2 text-sm text-gray-500">
                  <span>Subtotal: <strong className="font-mono text-gray-800">{formatCurrency(subtotal)}</strong></span>
                  <span>Tax: <strong className="font-mono text-gray-800">{formatCurrency(editData.taxAmount)}</strong></span>
                  <span className="font-bold text-gray-900">Total: <span className="font-mono text-blue-700">{formatCurrency(total)}</span></span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 'review' ? (
            <>
              <button onClick={() => { setStep('upload'); setPreview(null); setResult(null); }}
                className="btn-secondary">Rescan</button>
              <button onClick={handleImport} className="btn-primary flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> Import to New PO
              </button>
            </>
          ) : (
            <button onClick={onClose} className="btn-secondary">Cancel</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function PurchaseOrdersPage() {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [vendors,  setVendors]  = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [items,    setItems]    = useState([]);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('');

  // Modal states
  const [viewPO,    setViewPO]    = useState(null);
  const [editPO,    setEditPO]    = useState(null);
  const [newPO,     setNewPO]     = useState(false);
  const [newPOInit, setNewPOInit] = useState(null);  // pre-filled from scan
  const [receivePO, setReceivePO] = useState(null);
  const [convertPO,   setConvertPO]   = useState(null);
  const [pettyCashPO, setPettyCashPO] = useState(null);
  const [scanOpen,    setScanOpen]    = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    poApi.list({ status: filter, limit: 200 })
      .then((r) => setRows(r.data.data))
      .catch(() => toast.error('Failed to load purchase orders'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    payable.vendors.list().then((r) => setVendors(r.data.data || r.data)).catch(() => {});
    acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {});
    invApi.items.list({ limit: 500 }).then((r) => setItems(r.data.data || r.data || [])).catch(() => setItems([]));
  }, []);

  const doSend = async (po) => {
    try { await poApi.send(po.id); toast.success(`${po.poNumber} marked as sent`); load(); if (viewPO?.id === po.id) setViewPO(null); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const doCancel = async (po) => {
    if (!confirm(`Cancel ${po.poNumber}? This cannot be undone.`)) return;
    try { await poApi.cancel(po.id); toast.success('PO cancelled'); load(); setViewPO(null); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const doDelete = async (po) => {
    if (!confirm(`Permanently delete ${po.poNumber}?`)) return;
    try { await poApi.remove(po.id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  // Filtered list
  const displayed = rows.filter((po) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return po.poNumber?.toLowerCase().includes(q) || po.vendor?.name?.toLowerCase().includes(q);
  });

  // Status counts
  const counts = ALL_STATUSES.reduce((acc, s) => ({ ...acc, [s]: rows.filter((r) => r.status === s).length }), {});

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-subtitle">{rows.length} total orders</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {/* Download blank PO form (dynamic — includes company logo & details) */}
          <DownloadFormButton />
          {/* Scan filled form */}
          <button
            className="btn-secondary flex items-center gap-1.5 text-sm"
            onClick={() => setScanOpen(true)}
            title="Scan a filled PO form and auto-import data"
          >
            <ScanLine className="w-4 h-4" /> Scan & Import
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={() => { setNewPOInit(null); setNewPO(true); }}>
            <Plus className="w-4 h-4" /> New PO
          </button>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!filter ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
        >
          All <span className="ml-1 opacity-70">{rows.length}</span>
        </button>
        {ALL_STATUSES.map((s) => (
          <button key={s}
            onClick={() => setFilter(filter === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filter === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
          >
            {STATUS_LABEL[s]} {counts[s] > 0 && <span className="ml-1 opacity-70">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {/* Search + table */}
      <div className="card">
        <div className="card-body py-3 border-b border-gray-100">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            <input className="input pl-9 text-sm" placeholder="Search PO number or vendor…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Vendor</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">
                  {search ? `No results for "${search}"` : 'No purchase orders yet.'}
                </td></tr>
              ) : displayed.map((po) => (
                <tr key={po.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setViewPO(po)}>
                  <td>
                    <span className="font-mono font-semibold text-blue-700">{po.poNumber}</span>
                  </td>
                  <td className="font-medium">{po.vendor?.name}</td>
                  <td className="text-gray-500 text-sm">{formatDate(po.orderDate)}</td>
                  <td className="text-gray-400 text-sm">{po.expectedDate ? formatDate(po.expectedDate) : '—'}</td>
                  <td className="text-right font-mono font-semibold">{formatCurrency(po.total)}</td>
                  <td><span className={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status]}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewPO(po)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="View">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => printPO(po)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                      {['DRAFT', 'SENT'].includes(po.status) && (
                        <button onClick={() => { setEditPO(po); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {['DRAFT', 'CANCELLED'].includes(po.status) && (
                        <button onClick={() => doDelete(po)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {scanOpen && (
        <ScanModal
          vendors={vendors}
          accounts={accounts}
          onClose={() => setScanOpen(false)}
          onImport={(data) => {
            setScanOpen(false);
            setNewPOInit(data);
            setNewPO(true);
            if (!data._vendorMatched && data._scannedVendorName) {
              toast(`Vendor "${data._scannedVendorName}" not matched — please select manually`, { icon: '⚠️' });
            }
          }}
        />
      )}
      {newPO && (
        <POModal
          vendors={vendors}
          accounts={accounts}
          items={items}
          initialData={newPOInit}
          onClose={() => { setNewPO(false); setNewPOInit(null); }}
          onSaved={() => { setNewPO(false); setNewPOInit(null); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
      {editPO && (
        <POModal po={editPO} vendors={vendors} accounts={accounts} items={items}
          onClose={() => setEditPO(null)}
          onSaved={() => { setEditPO(null); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
      {viewPO && (
        <POViewModal
          po={viewPO}
          onClose={() => setViewPO(null)}
          onEdit={() => { setEditPO(viewPO); setViewPO(null); }}
          onSend={() => doSend(viewPO)}
          onReceive={() => { setReceivePO(viewPO); setViewPO(null); }}
          onConvert={() => { setConvertPO(viewPO); setViewPO(null); }}
          onPettyCash={() => { setPettyCashPO(viewPO); setViewPO(null); }}
          onCancel={() => doCancel(viewPO)}
        />
      )}
      {receivePO && (
        <ReceiveModal po={receivePO}
          onClose={() => setReceivePO(null)}
          onSaved={() => { setReceivePO(null); load(); }} />
      )}
      {convertPO && (
        <ConvertModal po={convertPO}
          onClose={() => setConvertPO(null)}
          onSaved={() => { setConvertPO(null); load(); }} />
      )}
      {pettyCashPO && (
        <PettyCashPayModal po={pettyCashPO}
          onClose={() => setPettyCashPO(null)}
          onSaved={() => { setPettyCashPO(null); load(); }} />
      )}
    </div>
  );
}
