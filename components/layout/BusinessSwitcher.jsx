'use client';
import { useState, useRef, useEffect } from 'react';
import { Building2, ChevronDown, Check } from 'lucide-react';
import { useBusiness } from '@/lib/businessContext';

export default function BusinessSwitcher() {
  const { businesses, activeBusiness, activeBusinessId, setActive, loading } = useBusiness();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Only render if there are 2+ businesses; if only one, show static label
  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-400 dark:text-gray-500">
        <Building2 className="w-4 h-4" />
        <span>Loading…</span>
      </div>
    );
  }

  if (!businesses.length) return null;

  if (businesses.length === 1) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-800">
        <Building2 className="w-4 h-4 text-blue-500" />
        <span className="max-w-[140px] truncate">{activeBusiness?.name || '—'}</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 lg:px-3 py-1.5 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        title="Switch active business"
      >
        <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="hidden sm:block max-w-[120px] truncate">{activeBusiness?.name || 'Select'}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 px-3 pt-2 pb-1">
            Switch Business
          </p>
          {businesses.map((biz) => (
            <button
              key={biz.id}
              onClick={() => { setOpen(false); if (biz.id !== activeBusinessId) setActive(biz.id); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                {biz.code?.slice(0, 2) || biz.name?.slice(0, 2)}
              </span>
              <span className="flex-1 truncate text-gray-700 dark:text-gray-200">{biz.name}</span>
              {biz.id === activeBusinessId && (
                <Check className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
