'use client';
import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { STATUS } from '@/lib/orderStatus';

export default function BusinessDetailModal({ businessId, onClose }) {
  const [data, setData]       = useState(null);   // { business, orders }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    ordersApi.admin.businessDetail(businessId)
      .then(({ data }) => setData(data))
      .catch(() => { toast.error('Failed to load business details'); onClose(); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const viewProof = async (o) => {
    try {
      const { data } = await ordersApi.proofBlob(o.id);
      window.open(URL.createObjectURL(data), '_blank');
    } catch { toast.error('Could not open the proof'); }
  };

  const biz = data?.business;
  const ordersList = data?.orders || [];
  const creator = ordersList[0] || null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {biz ? biz.name : 'Business details'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : !biz ? null : (
          <div className="px-6 py-5 space-y-6">
            {/* ── Business profile ──────────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Business profile</h4>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div><dt className="text-xs text-gray-500">Code</dt><dd className="font-mono">{biz.code}</dd></div>
                <div><dt className="text-xs text-gray-500">Type</dt><dd>{biz.industry || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">TIN</dt><dd>{biz.tin || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Tax registration</dt><dd>{biz.taxType || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Phone</dt><dd>{biz.phone || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Email</dt><dd>{biz.email || '—'}</dd></div>
                <div className="col-span-2"><dt className="text-xs text-gray-500">Address</dt><dd>{biz.address || '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Status</dt><dd><span className={`badge ${biz.isActive ? 'badge-green' : 'badge-red'}`}>{biz.isActive ? 'Active' : 'Inactive'}</span></dd></div>
                <div><dt className="text-xs text-gray-500">Paid until</dt><dd>{biz.paidUntil ? formatDate(biz.paidUntil) : '—'}</dd></div>
                <div><dt className="text-xs text-gray-500">Books start date</dt><dd>{biz.booksStartDate ? formatDate(biz.booksStartDate) : '—'}</dd></div>
              </dl>
            </section>

            {/* ── Created by ─────────────────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Created by</h4>
              {creator ? (
                <p className="text-sm">
                  {creator.user.firstName} {creator.user.lastName} <span className="text-gray-500">({creator.user.email})</span>
                  {' '}via order <span className="font-mono text-xs">{creator.orderNo}</span>
                  {' '}— ordered {formatDate(creator.createdAt)}
                  {creator.reviewedAt && <>, approved {formatDate(creator.reviewedAt)}</>}
                </p>
              ) : (
                <p className="text-sm text-gray-500">Legacy business — no order on record</p>
              )}
            </section>

            {/* ── Order & payment history ────────────────────── */}
            <section>
              <h4 className="font-semibold mb-2 text-sm">Order &amp; payment history</h4>
              {ordersList.length === 0 ? <p className="text-sm text-gray-500">No orders yet.</p> : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-500 uppercase">
                    <th className="py-2">Order</th><th className="py-2">Period</th>
                    <th className="py-2 text-right">Amount</th><th className="py-2">Reference</th>
                    <th className="py-2">Status</th><th className="py-2">Ordered</th><th className="py-2">Approved</th><th className="py-2" />
                  </tr></thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {ordersList.map((o) => {
                      const s = STATUS[o.status] || STATUS.CANCELLED;
                      return (
                        <tr key={o.id}>
                          <td className="py-2.5 font-mono text-xs">{o.orderNo}</td>
                          <td className="py-2.5">{o.period === 'YEARLY' ? 'Yearly' : 'Monthly'}</td>
                          <td className="py-2.5 text-right tabular-nums">{formatCurrency(o.amount)}</td>
                          <td className="py-2.5">{o.referenceNo || '—'}</td>
                          <td className="py-2.5"><span className={`badge ${s.cls}`}>{s.label}</span></td>
                          <td className="py-2.5">{formatDate(o.createdAt)}</td>
                          <td className="py-2.5">{o.reviewedAt ? formatDate(o.reviewedAt) : '—'}</td>
                          <td className="py-2.5 text-right whitespace-nowrap">
                            {o.proofFileName && <button className="btn-secondary" onClick={() => viewProof(o)}>View proof</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
