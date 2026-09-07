'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { notifications as notifApi } from '@/lib/api';

const SEEN_KEY = 'notifLastSeen';

// Module (audit entity) → route + badge colour
const MODULE_META = {
  Invoice:        { route: '/receivable',             label: 'Invoices',     cls: 'bg-green-100 text-green-700' },
  Quotation:      { route: '/receivable/quotations',  label: 'Quotations',   cls: 'bg-emerald-100 text-emerald-700' },
  Customer:       { route: '/receivable/customers',   label: 'Customers',    cls: 'bg-teal-100 text-teal-700' },
  Bill:           { route: '/payable',                label: 'Bills',        cls: 'bg-blue-100 text-blue-700' },
  Vendor:         { route: '/payable/vendors',        label: 'Vendors',      cls: 'bg-indigo-100 text-indigo-700' },
  JournalEntry:   { route: '/journal',                label: 'General Ledger', cls: 'bg-purple-100 text-purple-700' },
  Account:        { route: '/accounts',               label: 'Accounts',     cls: 'bg-slate-100 text-slate-700' },
  Employee:       { route: '/payroll/employees',      label: 'Payroll',      cls: 'bg-orange-100 text-orange-700' },
  PayrollPeriod:  { route: '/payroll/periods',        label: 'Payroll',      cls: 'bg-orange-100 text-orange-700' },
  ExpenseVoucher: { route: '/expenses',               label: 'Expenses',     cls: 'bg-amber-100 text-amber-700' },
  PurchaseOrder:  { route: '/purchase-orders',        label: 'Purchase Orders', cls: 'bg-cyan-100 text-cyan-700' },
  InventoryItem:  { route: '/inventory/items',        label: 'Inventory',    cls: 'bg-lime-100 text-lime-700' },
  FixedAsset:     { route: '/assets',                 label: 'Fixed Assets', cls: 'bg-stone-100 text-stone-700' },
  Settings:       { route: '/settings',               label: 'Settings',     cls: 'bg-gray-100 text-gray-700' },
};
const metaFor = (m) => MODULE_META[m] || { route: '/audit', label: m, cls: 'bg-gray-100 text-gray-600' };

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60)    return 'just now';
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

export default function NotificationBell() {
  const router = useRouter();
  const [items, setItems]   = useState([]);
  const [open, setOpen]     = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const boxRef = useRef(null);

  useEffect(() => {
    setLastSeen(Number(localStorage.getItem(SEEN_KEY)) || 0);
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await notifApi.feed();
      setItems(data.data || []);
    } catch { /* silent — header must never break */ }
  }, []);

  // Initial load + poll every 45s
  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const unread = items.filter((n) => new Date(n.createdAt).getTime() > lastSeen).length;

  const markAllRead = () => {
    const now = Date.now();
    localStorage.setItem(SEEN_KEY, String(now));
    setLastSeen(now);
  };

  const openPanel = () => {
    setOpen((o) => !o);
    if (!open) load();
  };

  const go = (n) => {
    markAllRead();
    setOpen(false);
    router.push(metaFor(n.module).route);
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={openPanel}
        className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors dark:hover:text-gray-100 dark:hover:bg-gray-800"
        title="Notifications"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[92vw] bg-white border border-gray-200 rounded-xl shadow-xl z-40 dark:bg-gray-900 dark:border-gray-800">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="font-semibold text-gray-900 dark:text-gray-100">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">
                <Bell className="w-8 h-8 mx-auto mb-2 text-gray-200" />
                No notifications yet
              </div>
            ) : items.map((n) => {
              const meta = metaFor(n.module);
              const isUnread = new Date(n.createdAt).getTime() > lastSeen;
              return (
                <button
                  key={n.id} onClick={() => go(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors flex gap-3 dark:border-gray-800 dark:hover:bg-gray-800 ${isUnread ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}`}
                >
                  {isUnread
                    ? <span className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                    : <span className="w-2 h-2 mt-1.5 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">{n.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                      <span className="text-xs text-gray-400">by {n.user}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">{timeAgo(n.createdAt)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
