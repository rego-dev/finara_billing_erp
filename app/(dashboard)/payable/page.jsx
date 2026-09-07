'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { payable as pApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, CreditCard, Ban, ChevronDown, ChevronUp,
  Filter, X, Check, AlertCircle, Clock, CheckCircle2, FileText,
  Printer, Download, Pencil
} from 'lucide-react';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import { formatCurrency, formatDate, scopedKey } from '@/lib/auth';
import VendorSelect from '@/components/VendorSelect';
import DescriptionInput, { rememberDescription } from '@/components/DescriptionInput';
import NumberInput from '@/components/NumberInput';
import AccountSelect from '@/components/ui/AccountSelect';
import { useDraftGuard } from '@/lib/useDraftGuard';
import { loadDraft, listDraftKeys, clearDraft } from '@/lib/draftStorage';

// ─── Constants ────────────────────────────────────────────────
const VAT_CODES  = ['VAT', 'ZERO', 'EXEMPT'];
const STATUSES   = ['OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'];
const PAY_METHODS = ['Cash', 'Check', 'Bank Transfer', 'Online Banking', 'GCash', 'Maya'];

const STATUS_BADGE = {
  OPEN:    'badge-blue',
  PARTIAL: 'badge-yellow',
  PAID:    'badge-green',
  OVERDUE: 'badge-red',
  VOID:    'badge-gray',
};
const STATUS_ICON = {
  OPEN:    <Clock className="w-3 h-3" />,
  PARTIAL: <AlertCircle className="w-3 h-3" />,
  PAID:    <CheckCircle2 className="w-3 h-3" />,
  OVERDUE: <AlertCircle className="w-3 h-3" />,
  VOID:    <Ban className="w-3 h-3" />,
};

// ─── Helpers ──────────────────────────────────────────────────
const computeVAT = (amount, code) =>
  code === 'VAT' ? { base: amount, vat: amount * 0.12, total: amount * 1.12 }
                 : { base: amount, vat: 0, total: amount };

// ─── Bill Detail Modal ────────────────────────────────────────
function BillDetailModal({ bill, onClose, onPayment, onVoid, onEdit, onEditPayment }) {
  const balance = Number(bill.totalAmount) - Number(bill.paidAmount);
  const pct = bill.totalAmount > 0 ? (Number(bill.paidAmount) / Number(bill.totalAmount)) * 100 : 0;

  const handlePrint = () => {
    const linesHTML = (bill.lines || []).map((l) => `
      <tr>
        <td class="mono blue small">${l.account?.accountCode || '—'}</td>
        <td>${l.description || '—'}</td>
        <td class="center"><span class="badge ${l.vatCode === 'VAT' ? 'b-blue' : l.vatCode === 'ZERO' ? 'b-gray' : 'b-yellow'}">${l.vatCode}</span></td>
        <td class="right">${Number(l.quantity).toLocaleString()}</td>
        <td class="right mono">${phpFmt(l.unitPrice)}</td>
        <td class="right mono bold">${phpFmt(l.amount)}</td>
      </tr>`).join('');

    const paymentsHTML = (bill.payments || []).length > 0 ? `
      <div class="section-title">Payment History</div>
      <table>
        <thead><tr><th>Date</th><th>Reference</th><th>Method</th><th class="right">Amount</th></tr></thead>
        <tbody>${bill.payments.map((p) => `
          <tr>
            <td>${dateFmt(p.paymentDate)}</td>
            <td class="mono small">${p.reference || '—'}</td>
            <td>${p.paymentMethod}</td>
            <td class="right mono green bold">${phpFmt(p.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';

    const body = `
      <div class="info-grid">
        <div class="info-box"><div class="info-lbl">Bill No.</div><div class="info-val mono">${bill.billNo}</div></div>
        <div class="info-box"><div class="info-lbl">Vendor</div><div class="info-val">${bill.vendor?.name || '—'}</div></div>
        <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${badge(bill.status)}</div></div>
        <div class="info-box"><div class="info-lbl">Bill Date</div><div class="info-val">${dateFmt(bill.billDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(bill.dueDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Vendor TIN</div><div class="info-val mono small">${bill.vendor?.tin || '—'}</div></div>
      </div>
      ${bill.description ? `<div class="desc-box">${bill.description}</div>` : ''}
      <div class="section-title">Line Items</div>
      <table>
        <thead><tr><th>Account</th><th>Description</th><th class="center">VAT</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
        <tbody>${linesHTML}</tbody>
      </table>
      <div class="totals-block" style="max-width:320px;margin-left:auto;margin-top:12px;">
        <div class="totals-row"><span class="gray">Subtotal (ex-VAT)</span><span class="mono">${phpFmt(bill.subtotal)}</span></div>
        <div class="totals-row"><span class="gray">VAT (12%)</span><span class="mono">${phpFmt(bill.vatAmount)}</span></div>
        <div class="totals-divider"></div>
        <div class="totals-row totals-total"><span>Total Amount</span><span class="mono">${phpFmt(bill.totalAmount)}</span></div>
        <div class="totals-row green"><span>Amount Paid</span><span class="mono">(${phpFmt(bill.paidAmount)})</span></div>
        <div class="totals-row ${balance > 0 ? 'red' : 'green'} bold"><span>Balance Due</span><span class="mono">${phpFmt(balance)}</span></div>
      </div>
      ${paymentsHTML}`;

    printDocument(`Bill — ${bill.billNo}`, `${bill.vendor?.name || ''} · ${dateFmt(bill.billDate)}`, body);
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{bill.billNo}</h3>
            <p className="text-sm text-gray-500">{bill.vendor?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`${STATUS_BADGE[bill.status]} flex items-center gap-1`}>
              {STATUS_ICON[bill.status]} {bill.status}
            </span>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          {/* Header info */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div><span className="text-gray-500 block">Bill Date</span><span className="font-medium">{formatDate(bill.billDate)}</span></div>
            <div><span className="text-gray-500 block">Due Date</span>
              <span className={`font-medium ${new Date(bill.dueDate) < new Date() && bill.status !== 'PAID' ? 'text-red-600' : ''}`}>
                {formatDate(bill.dueDate)}
              </span>
            </div>
            <div><span className="text-gray-500 block">TIN</span><span className="font-mono text-xs">{bill.vendor?.tin || '—'}</span></div>
          </div>

          {bill.description && (
            <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">{bill.description}</div>
          )}

          {/* Line items */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Line Items</h4>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th><th>Description</th><th>VAT</th>
                    <th className="text-right">Qty</th><th className="text-right">Unit Price</th><th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lines?.map((l, i) => (
                    <tr key={i}>
                      <td className="text-xs font-mono text-blue-700">{l.account?.accountCode || '—'}</td>
                      <td className="text-sm">{l.description}</td>
                      <td><span className={l.vatCode === 'VAT' ? 'badge-blue' : l.vatCode === 'ZERO' ? 'badge-gray' : 'badge-yellow'}>{l.vatCode}</span></td>
                      <td className="text-right">{Number(l.quantity).toLocaleString()}</td>
                      <td className="text-right">{formatCurrency(l.unitPrice)}</td>
                      <td className="text-right font-medium">{formatCurrency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span>{formatCurrency(bill.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-600">VAT (12%)</span><span>{formatCurrency(bill.vatAmount)}</span></div>
            <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2"><span>Total Amount</span><span>{formatCurrency(bill.totalAmount)}</span></div>
            <div className="flex justify-between text-green-600"><span>Amount Paid</span><span>({formatCurrency(bill.paidAmount)})</span></div>
            <div className={`flex justify-between font-bold text-base pt-1 ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              <span>Balance Due</span><span>{formatCurrency(balance)}</span>
            </div>
          </div>

          {/* Progress bar */}
          {bill.totalAmount > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Payment Progress</span><span>{pct.toFixed(1)}% paid</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          )}

          {/* Payment history */}
          {bill.payments?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Payment History</h4>
              <div className="space-y-2">
                {bill.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-green-50 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-800">{formatCurrency(p.amount)}</span>
                      <span className="text-gray-500 ml-2">via {p.paymentMethod}</span>
                      {p.reference && <span className="text-gray-400 ml-2 text-xs">Ref: {p.reference}</span>}
                      {p.clearingStatus && (
                        <span className={`badge ml-2 ${
                          p.clearingStatus === 'OUTSTANDING' ? 'badge-yellow' :
                          p.clearingStatus === 'CLEARED'     ? 'badge-green'  : 'badge-red'
                        }`}>
                          {p.clearingStatus}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-xs">{formatDate(p.paymentDate)}</span>
                      {bill.status !== 'VOID' && (!p.clearingStatus || p.clearingStatus === 'OUTSTANDING') && (
                        <button onClick={() => onEditPayment(p)} className="text-gray-400 hover:text-blue-600" title="Edit payment">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {bill.status === 'VOID' ? (
            <span className="text-gray-400 text-sm">This bill has been voided.</span>
          ) : (
            <>
              {bill.paidAmount === 0 && (
                <button onClick={onVoid} className="btn-danger btn-sm mr-auto">
                  <Ban className="w-4 h-4" /> Void Bill
                </button>
              )}
              {bill.status !== 'PAID' && (
                <button onClick={onEdit} className="btn-secondary">
                  <Pencil className="w-4 h-4" /> Edit
                </button>
              )}
              {bill.status !== 'PAID' && (
                <button onClick={onPayment} className="btn-success">
                  <CreditCard className="w-4 h-4" /> Record Payment
                </button>
              )}
            </>
          )}
          <button onClick={handlePrint} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Payment Modal ────────────────────────────────────────────
function PaymentModal({ bill, onClose, onPaid }) {
  const balance = Number(bill.totalAmount) - Number(bill.paidAmount);
  const [form, setForm] = useState({
    paymentDate: new Date().toISOString().split('T')[0],
    amount: balance.toFixed(2),
    paymentMethod: 'Bank Transfer',
    reference: '',
    notes: '',
    checkDate: '',
  });
  const [saving, setSaving] = useState(false);
  const draftKey = scopedKey(`payment:new:${bill.id}`);
  const { clearDraft: clearPaymentDraft } = useDraftGuard(draftKey, form, setForm);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!(Number(form.amount) > 0)) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    if (form.paymentMethod === 'Check' && !form.checkDate) {
      toast.error('Check date is required for a Check payment');
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.payment(bill.id, { ...form, amount: Number(form.amount) });
      toast.success('Payment recorded successfully');
      clearPaymentDraft();
      onPaid();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { clearPaymentDraft(); onClose(); };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Record Payment</h3>
          <button onClick={handleClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            {/* Bill info */}
            <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Bill</span><span className="font-medium">{bill.billNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Vendor</span><span>{bill.vendor?.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Total Amount</span><span className="font-medium">{formatCurrency(bill.totalAmount)}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Already Paid</span><span className="text-green-600">{formatCurrency(bill.paidAmount)}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1 text-base"><span>Balance Due</span><span className="text-red-600">{formatCurrency(balance)}</span></div>
            </div>

            <div className="form-group">
              <label className="label">Payment Date *</label>
              <input type="date" className="input" required value={form.paymentDate} onChange={set('paymentDate')} />
            </div>

            <div className="form-group">
              <label className="label">Amount (₱) *</label>
              <NumberInput className="input" required placeholder="0.00"
                value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              <p className="text-xs text-gray-400 mt-1">Max: {formatCurrency(balance)}</p>
            </div>

            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            {form.paymentMethod === 'Check' && (
              <div className="form-group">
                <label className="label">Check Date *</label>
                <input type="date" className="input" required value={form.checkDate} onChange={set('checkDate')} />
                <p className="text-xs text-gray-400 mt-1">The date printed on the cheque — tracked separately on the new Cheques page until it clears.</p>
              </div>
            )}

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>

            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-success">
              <CreditCard className="w-4 h-4" />
              {saving ? 'Processing...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Payment Modal ───────────────────────────────────────
function EditPaymentModal({ bill, payment, onClose, onSaved }) {
  const otherPaid = Number(bill.paidAmount) - Number(payment.amount);
  const balance = Number(bill.totalAmount) - otherPaid;
  const [form, setForm] = useState({
    paymentDate: payment.paymentDate.slice(0, 10),
    amount: String(payment.amount),
    paymentMethod: payment.paymentMethod,
    reference: payment.reference || '',
    notes: payment.notes || '',
    checkDate: payment.checkDate ? payment.checkDate.slice(0, 10) : '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (Number(form.amount) < 0) {
      toast.error('Amount cannot be negative');
      return;
    }
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds balance of ${formatCurrency(balance)}`);
      return;
    }
    if (form.paymentMethod === 'Check' && !form.checkDate) {
      toast.error('Check date is required for a Check payment');
      return;
    }
    setSaving(true);
    try {
      await pApi.bills.editPayment(bill.id, payment.id, { ...form, amount: Number(form.amount) });
      toast.success('Payment updated successfully');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Edit Payment</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="bg-blue-50 rounded-xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-600">Bill</span><span className="font-medium">{bill.billNo}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Vendor</span><span>{bill.vendor?.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Total Amount</span><span className="font-medium">{formatCurrency(bill.totalAmount)}</span></div>
              <div className="flex justify-between font-bold border-t border-blue-200 pt-1 text-base"><span>Max for this payment</span><span className="text-red-600">{formatCurrency(balance)}</span></div>
            </div>

            <div className="form-group">
              <label className="label">Payment Date *</label>
              <input type="date" className="input" required value={form.paymentDate} onChange={set('paymentDate')} />
            </div>

            <div className="form-group">
              <label className="label">Amount (₱) *</label>
              <NumberInput className="input" required placeholder="0.00"
                value={form.amount} onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
              <p className="text-xs text-gray-400 mt-1">Max: {formatCurrency(balance)}</p>
            </div>

            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            {form.paymentMethod === 'Check' && (
              <div className="form-group">
                <label className="label">Check Date *</label>
                <input type="date" className="input" required value={form.checkDate} onChange={set('checkDate')} />
                <p className="text-xs text-gray-400 mt-1">The date printed on the cheque — tracked separately on the new Cheques page until it clears.</p>
              </div>
            )}

            <div className="form-group">
              <label className="label">Reference No.</label>
              <input className="input" value={form.reference} onChange={set('reference')} placeholder="Check no., transaction ID..." />
            </div>

            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-success">
              <Pencil className="w-4 h-4" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Bill Modal ────────────────────────────────────────
function CreateBillModal({ vendors, accounts, bill, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(() => {
    if (bill) return {
      vendorId:    String(bill.vendorId),
      billDate:    bill.billDate.slice(0, 10),
      dueDate:     bill.dueDate.slice(0, 10),
      description: bill.description || '',
      notes:       bill.notes || '',
      lines: bill.lines.map((l) => ({
        accountId: String(l.accountId), description: l.description,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
      })),
    };
    const billDate = new Date().toISOString().split('T')[0];
    const due = new Date(billDate);
    due.setDate(due.getDate() + 30);
    return {
      vendorId: '',
      billDate,
      dueDate: due.toISOString().split('T')[0],
      description: '',
      notes: '',
      lines: [
        { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
      ],
    };
  });
  const [saving, setSaving] = useState(false);
  const draftKey = scopedKey(bill?.id ? `bill:edit:${bill.id}` : 'bill:new');
  const { clearDraft: clearBillDraft } = useDraftGuard(draftKey, form, setForm);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) => setForm((f) => ({
    ...f,
    lines: f.lines.map((l, idx) => idx === i ? { ...l, [k]: v } : l),
  }));
  const addLine = () => setForm((f) => ({
    ...f,
    lines: [...f.lines, { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' }],
  }));
  const removeLine = (i) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  // Auto due date: vendor bill date + 30 days
  useEffect(() => {
    if (form.billDate && !form.dueDate) {
      const d = new Date(form.billDate);
      d.setDate(d.getDate() + 30);
      setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
    }
  }, [form.billDate]);

  const expenseAccounts = accounts.filter((a) => ['EXPENSE', 'ASSET'].includes(a.accountType));

  // Contra-expense accounts (Purchase Discounts, Purchase Returns & Allowances —
  // normalBalance CREDIT) reduce the total instead of adding to it.
  const lineSign = (accountId) => {
    const acct = accounts.find((a) => a.id === Number(accountId));
    return acct?.normalBalance === 'CREDIT' ? -1 : 1;
  };

  // Compute totals
  const totals = form.lines.reduce(
    (s, l) => {
      const amt = lineSign(l.accountId) * (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      const v = computeVAT(amt, l.vatCode);
      return { subtotal: s.subtotal + v.base, vat: s.vat + v.vat, total: s.total + v.total };
    },
    { subtotal: 0, vat: 0, total: 0 }
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.vendorId) { toast.error('Select or add a vendor'); return; }
    const validLines = form.lines.filter((l) => l.accountId && l.description && l.unitPrice);
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    validLines.forEach((l) => rememberDescription(l.description));
    setSaving(true);
    try {
      const payload = {
        ...form,
        vendorId: Number(form.vendorId),
        lines: validLines.map((l) => ({
          accountId: Number(l.accountId),
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          vatCode: l.vatCode,
        })),
      };
      if (bill) {
        await pApi.bills.update(bill.id, payload);
        toast.success('Bill updated successfully');
      } else {
        await pApi.bills.create(payload);
        toast.success('Bill created successfully');
      }
      clearBillDraft();
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to ${bill ? 'update' : 'create'} bill`);
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => { clearBillDraft(); onClose(); };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-6xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{bill ? 'Edit Bill' : 'New Bill / Purchase Invoice'}</h3>
          <button onClick={handleClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-5">
            {/* Header */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Vendor *</label>
                <VendorSelect
                  vendors={vendors}
                  value={form.vendorId}
                  onChange={(id) => setForm((f) => ({ ...f, vendorId: id }))}
                  onVendorAdded={onVendorAdded}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label">Description / Memo</label>
                <input className="input" value={form.description} onChange={set('description')} placeholder="e.g. Office supplies purchase" />
              </div>
              <div className="form-group">
                <label className="label">Bill Date *</label>
                <input type="date" className="input" required value={form.billDate} onChange={set('billDate')} />
              </div>
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
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

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table table-compact">
                  <thead>
                    <tr>
                      <th className="w-56">Account (Expense)</th>
                      <th>Description</th>
                      <th className="w-28">VAT</th>
                      <th className="w-32 text-right">Qty</th>
                      <th className="w-40 text-right">Unit Price (₱)</th>
                      <th className="w-44 text-right">Amount (₱)</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, i) => {
                      const amt = lineSign(line.accountId) * (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                      const v = computeVAT(amt, line.vatCode);
                      return (
                        <tr key={i} className="align-top">
                          <td>
                            <AccountSelect
                              value={line.accountId}
                              onChange={(val) => setLine(i, 'accountId', val)}
                              accounts={expenseAccounts}
                              placeholder="Select..."
                            />
                          </td>
                          <td>
                            <DescriptionInput
                              className="input text-xs"
                              value={line.description}
                              onChange={(v) => setLine(i, 'description', v)}
                              placeholder="Item description"
                            />
                          </td>
                          <td>
                            <select
                              className="select text-xs"
                              value={line.vatCode}
                              onChange={(e) => setLine(i, 'vatCode', e.target.value)}
                            >
                              {VAT_CODES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td>
                            <NumberInput
                              decimals={3}
                              className="input text-xs text-right"
                              value={line.quantity}
                              onChange={(v) => setLine(i, 'quantity', v)}
                            />
                          </td>
                          <td>
                            <NumberInput
                              className="input text-xs text-right"
                              value={line.unitPrice}
                              onChange={(v) => setLine(i, 'unitPrice', v)}
                              placeholder="0.00"
                            />
                          </td>
                          <td>
                            <div className="text-right text-sm font-medium text-gray-700 py-1.5">
                              {formatCurrency(v.total)}
                            </div>
                            {line.vatCode === 'VAT' && amt > 0 && (
                              <div className="text-right text-xs text-gray-400">
                                Base: {formatCurrency(amt)}<br />VAT: {formatCurrency(v.vat)}
                              </div>
                            )}
                          </td>
                          <td>
                            {form.lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeLine(i)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                              >
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
            </div>

            {/* Totals summary */}
            <div className="flex justify-end">
              <div className="w-72 space-y-2 text-sm bg-gray-50 rounded-xl p-4">
                <div className="flex justify-between"><span className="text-gray-600">Subtotal</span><span className="font-medium">{formatCurrency(totals.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600">VAT (12%)</span><span className="font-medium">{formatCurrency(totals.vat)}</span></div>
                <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
                  <span>Total Amount</span>
                  <span className="text-blue-700">{formatCurrency(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <div className="footer-notes">
              <label className="label mb-0 whitespace-nowrap text-xs text-gray-500">Notes</label>
              <input className="input" placeholder="Internal remarks, PO ref, delivery terms…"
                value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <button type="button" onClick={handleClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <FileText className="w-4 h-4" />
              {saving ? (bill ? 'Saving...' : 'Creating Bill...') : (bill ? 'Save Changes' : 'Create Bill')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Bills Page ──────────────────────────────────────────

export default function BillsPage() {
  const [bills, setBills]         = useState([]);
  const [vendors, setVendors]     = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [summary, setSummary]     = useState({ open: 0, overdue: 0, paid: 0, openCount: 0 });

  const [filter, setFilter] = useState({ status: '', vendorId: '', from: '', to: '', search: '' });
  const [showFilter, setShowFilter] = useState(false);

  const [modal, setModal] = useState(null); // 'create' | { bill: ... } | { pay: ... }
  const autoOpenedRef = useRef(false);
  const LIMIT = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, ...filter };
      Object.keys(params).forEach((k) => !params[k] && delete params[k]);
      const r = await pApi.bills.list(params);
      setBills(r.data.data);
      setTotal(r.data.total);

      // Compute quick summary from current data
      const all = r.data.data;
      const today = new Date();
      let open = 0, overdue = 0, paid = 0, openCount = 0;
      all.forEach((b) => {
        if (b.status === 'PAID') { paid += Number(b.totalAmount); }
        if (['OPEN','PARTIAL'].includes(b.status)) {
          const remaining = Number(b.totalAmount) - Number(b.paidAmount);
          open += remaining; openCount++;
          if (new Date(b.dueDate) < today) overdue += remaining;
        }
      });
      setSummary({ open, overdue, paid, openCount });
    } catch (err) {
      toast.error('Failed to load bills');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    pApi.vendors.list({ active: true }).then((r) => setVendors(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
  }, []);

  useEffect(() => {
    if (autoOpenedRef.current || loading || typeof window === 'undefined') return;
    autoOpenedRef.current = true;

    if (loadDraft(window.localStorage, scopedKey('bill:new'))) { setModal({ type: 'create' }); return; }

    const billEditKeys = listDraftKeys(window.localStorage, scopedKey('bill:edit:'));
    if (billEditKeys.length) {
      const id = Number(billEditKeys[0].split(':').pop());
      if (Number.isFinite(id)) {
        pApi.bills.get(id)
          .then(({ data }) => setModal({ type: 'edit', bill: data }))
          .catch(() => clearDraft(window.localStorage, billEditKeys[0]));
        return;
      }
      clearDraft(window.localStorage, billEditKeys[0]);
    }

    const paymentKeys = listDraftKeys(window.localStorage, scopedKey('payment:new:'));
    if (paymentKeys.length) {
      const billId = Number(paymentKeys[0].split(':').pop());
      if (Number.isFinite(billId)) {
        pApi.bills.get(billId)
          .then(({ data }) => setModal({ type: 'payment', bill: data }))
          .catch(() => clearDraft(window.localStorage, paymentKeys[0]));
        return;
      }
      clearDraft(window.localStorage, paymentKeys[0]);
    }
  }, [loading]);

  const handleVoid = async (bill) => {
    if (!confirm(`Void bill ${bill.billNo}? This cannot be undone.`)) return;
    try {
      await pApi.bills.void(bill.id);
      toast.success('Bill voided');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cannot void this bill');
    }
  };

  const openBill = async (bill) => {
    try {
      const { data } = await pApi.bills.get(bill.id);
      setModal({ type: 'detail', bill: data });
    } catch { toast.error('Failed to load bill details'); }
  };

  const clearFilter = () => setFilter({ status: '', vendorId: '', from: '', to: '', search: '' });
  const activeFilters = Object.values(filter).filter(Boolean).length;

  // Prints every bill matching the current filters (not just the visible page).
  const handlePrintList = async () => {
    try {
      const params = { ...filter, limit: 1000 };
      Object.keys(params).forEach((k) => !params[k] && delete params[k]);
      const { data } = await pApi.bills.list(params);
      const all = data.data;
      if (!all.length) { toast.error('No bills to print'); return; }

      const rows = all.map((b) => {
        const balance = Number(b.totalAmount) - Number(b.paidAmount);
        return `<tr>
          <td class="mono blue small">${b.billNo}</td>
          <td>${b.vendor?.name || ''}</td>
          <td>${dateFmt(b.billDate)}</td>
          <td>${dateFmt(b.dueDate)}</td>
          <td class="right mono">${phpFmt(b.totalAmount)}</td>
          <td class="right mono">${phpFmt(b.paidAmount)}</td>
          <td class="right mono">${phpFmt(balance)}</td>
          <td class="center">${badge(b.status)}</td>
        </tr>`;
      }).join('');

      const nonVoid       = all.filter((b) => b.status !== 'VOID');
      const totalAmt      = nonVoid.reduce((s, b) => s + Number(b.totalAmount), 0);
      const totalPaid     = nonVoid.reduce((s, b) => s + Number(b.paidAmount), 0);
      const totalBalance  = totalAmt - totalPaid;

      const subtitle = [
        filter.status   && `Status: ${filter.status}`,
        filter.vendorId && `Vendor: ${vendors.find((v) => String(v.id) === String(filter.vendorId))?.name || ''}`,
        filter.from     && `From: ${dateFmt(filter.from)}`,
        filter.to       && `To: ${dateFmt(filter.to)}`,
      ].filter(Boolean).join('  ·  ') || `All bills — ${all.length} total`;

      const body = `
        <table>
          <thead>
            <tr>
              <th>Bill No.</th><th>Vendor</th><th>Bill Date</th><th>Due Date</th>
              <th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th class="center">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" class="right">TOTAL (${nonVoid.length} bill${nonVoid.length !== 1 ? 's' : ''})</td>
              <td class="right mono">${phpFmt(totalAmt)}</td>
              <td class="right mono">${phpFmt(totalPaid)}</td>
              <td class="right mono">${phpFmt(totalBalance)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>`;

      printDocument('Bills', subtitle, body);
    } catch {
      toast.error('Failed to prepare print list');
    }
  };

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Bills</h1>
          <p className="page-subtitle">Accounts Payable — {total} bill{total !== 1 ? 's' : ''} total</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={handlePrintList}>
            <Printer className="w-4 h-4" /> Print List
          </button>
          <button className="btn-primary" onClick={() => setModal({ type: 'create' })}>
            <Plus className="w-4 h-4" /> New Bill
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Open Payables',    value: formatCurrency(summary.open),    sub: `${summary.openCount} bills`,   color: 'bg-blue-100 text-blue-600',   icon: <Clock className="w-5 h-5" /> },
          { label: 'Overdue',          value: formatCurrency(summary.overdue),  sub: 'Past due date',                color: 'bg-red-100 text-red-600',     icon: <AlertCircle className="w-5 h-5" /> },
          { label: 'Page Subtotal',    value: formatCurrency(bills.filter((b) => b.status !== 'VOID').reduce((s,b) => s+Number(b.totalAmount),0)), sub: 'shown records', color: 'bg-gray-100 text-gray-600', icon: <FileText className="w-5 h-5" /> },
          { label: 'Page Paid',        value: formatCurrency(bills.filter((b) => b.status !== 'VOID').reduce((s,b) => s+Number(b.paidAmount),0)),  sub: 'collected',    color: 'bg-green-100 text-green-600', icon: <CheckCircle2 className="w-5 h-5" /> },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-900">{s.value}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search bill no., vendor..."
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>

          <select className="select w-36" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>

          <select className="select w-48" value={filter.vendorId} onChange={(e) => setFilter((f) => ({ ...f, vendorId: e.target.value }))}>
            <option value="">All Vendors</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <button
            className="btn-secondary"
            onClick={() => setShowFilter(!showFilter)}
          >
            <Filter className="w-4 h-4" />
            Date Range
            {activeFilters > 0 && <span className="ml-1 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">{activeFilters}</span>}
          </button>

          {activeFilters > 0 && (
            <button onClick={clearFilter} className="btn-secondary text-red-500 hover:text-red-600">
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>

        {showFilter && (
          <div className="px-6 pb-4 flex gap-3 border-t border-gray-100 pt-3">
            <div className="form-group">
              <label className="label">From</label>
              <input type="date" className="input" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">To</label>
              <input type="date" className="input" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
            </div>
          </div>
        )}
      </div>

      {/* Bills table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Bill No.</th>
                <th>Vendor</th>
                <th>Bill Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    Loading bills...
                  </div>
                </td></tr>
              ) : bills.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3 text-gray-400">
                    <FileText className="w-10 h-10 text-gray-200" />
                    <p>No bills found.</p>
                    <button className="btn-primary btn-sm" onClick={() => setModal({ type: 'create' })}>
                      <Plus className="w-3 h-3" /> Create First Bill
                    </button>
                  </div>
                </td></tr>
              ) : bills.map((bill) => {
                const balance = Number(bill.totalAmount) - Number(bill.paidAmount);
                const isOverdue = ['OPEN','PARTIAL'].includes(bill.status) && new Date(bill.dueDate) < new Date();
                return (
                  <tr key={bill.id} className="cursor-pointer hover:bg-blue-50/50 transition-colors" onClick={() => openBill(bill)}>
                    <td>
                      <span className="font-mono font-medium text-blue-700 text-sm">{bill.billNo}</span>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{bill.vendor?.name}</div>
                      <div className="text-xs text-gray-400">{bill.vendor?.vendorCode}</div>
                    </td>
                    <td className="text-gray-600 text-sm">{formatDate(bill.billDate)}</td>
                    <td>
                      <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                        {formatDate(bill.dueDate)}
                        {isOverdue && <span className="block text-xs">⚠ Overdue</span>}
                      </span>
                    </td>
                    <td className="text-right font-medium">{formatCurrency(bill.totalAmount)}</td>
                    <td className="text-right text-green-600">{formatCurrency(bill.paidAmount)}</td>
                    <td className="text-right">
                      <span className={`font-semibold ${balance > 0 ? 'text-gray-900' : 'text-green-600'}`}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td>
                      <span className={`${STATUS_BADGE[bill.status]} flex items-center gap-1 w-fit`}>
                        {STATUS_ICON[bill.status]} {bill.status}
                      </span>
                    </td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openBill(bill)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {bill.status !== 'PAID' && bill.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await pApi.bills.get(bill.id);
                              setModal({ type: 'edit', bill: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit bill"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {bill.status !== 'PAID' && bill.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await pApi.bills.get(bill.id);
                              setModal({ type: 'payment', bill: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Record payment"
                          >
                            <CreditCard className="w-4 h-4" />
                          </button>
                        )}
                        {bill.paidAmount == 0 && bill.status !== 'VOID' && (
                          <button
                            onClick={() => handleVoid(bill)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Void bill"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {Math.min((page - 1) * LIMIT + 1, total)}–{Math.min(page * LIMIT, total)} of {total} bills
          </p>
          <div className="flex items-center gap-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">
              ← Previous
            </button>
            <span className="text-sm text-gray-600 px-2">Page {page} of {Math.ceil(total / LIMIT) || 1}</span>
            <button disabled={page * LIMIT >= total} onClick={() => setPage((p) => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal?.type === 'create' && (
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onVendorAdded={(v) => setVendors((prev) => [v, ...prev])}
        />
      )}
      {modal?.type === 'edit' && (
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          bill={modal.bill}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
          onVendorAdded={(v) => setVendors((prev) => [v, ...prev])}
        />
      )}
      {modal?.type === 'detail' && (
        <BillDetailModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPayment={() => setModal({ type: 'payment', bill: modal.bill })}
          onVoid={() => { handleVoid(modal.bill); setModal(null); }}
          onEdit={() => setModal({ type: 'edit', bill: modal.bill })}
          onEditPayment={(payment) => setModal({ type: 'editPayment', bill: modal.bill, payment })}
        />
      )}
      {modal?.type === 'payment' && (
        <PaymentModal
          bill={modal.bill}
          onClose={() => setModal(null)}
          onPaid={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'editPayment' && (
        <EditPaymentModal
          bill={modal.bill}
          payment={modal.payment}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
