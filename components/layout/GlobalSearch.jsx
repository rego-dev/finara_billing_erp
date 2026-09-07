'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { search as searchApi } from '@/lib/api';
import { Search, CornerDownLeft } from 'lucide-react';

export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Flatten groups into a single ordered list for keyboard navigation
  const flat = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })));

  // ⌘/Ctrl+K to open, Esc to close
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQ(''); setGroups([]); setActive(0); }
  }, [open]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchApi.query(q.trim())
        .then((r) => { setGroups(r.data.groups); setActive(0); })
        .catch(() => setGroups([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  const go = useCallback((item) => {
    if (!item) return;
    setOpen(false);
    router.push(item.href);
  }, [router]);

  const onInputKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(flat[active]); }
  };

  let idx = -1; // running index across groups to match `active`

  return (
    <>
      {/* Trigger — mimics the old quick-search box */}
      <button
        onClick={() => setOpen(true)}
        className="relative hidden md:flex items-center gap-2 pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-400 w-56 hover:bg-gray-200 transition-colors dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-500"
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="text-[10px] font-sans border border-gray-300 rounded px-1.5 py-0.5 text-gray-400 dark:border-gray-600">⌘K</kbd>
      </button>

      {/* Mobile icon trigger */}
      <button onClick={() => setOpen(true)} className="md:hidden p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg dark:hover:bg-gray-800">
        <Search className="w-5 h-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/40 dark:bg-black/60" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            {/* Input */}
            <div className="flex items-center gap-3 px-4 border-b border-gray-200 dark:border-gray-800">
              <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onInputKey}
                placeholder="Search accounts, journals, vendors, invoices, employees…"
                className="flex-1 py-4 bg-transparent outline-none text-sm text-gray-900 placeholder-gray-400 dark:text-gray-100"
              />
              {loading && <span className="text-xs text-gray-400">…</span>}
            </div>

            {/* Results */}
            <div className="max-h-96 overflow-y-auto py-2">
              {q.trim().length < 2 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">Type at least 2 characters to search.</p>
              ) : !loading && flat.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No results for "{q}".</p>
              ) : (
                groups.map((g) => (
                  <div key={g.label} className="mb-1">
                    <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.label}</div>
                    {g.items.map((item) => {
                      idx++;
                      const isActive = idx === active;
                      const myIdx = idx;
                      return (
                        <button
                          key={`${g.label}-${item.id}`}
                          onMouseEnter={() => setActive(myIdx)}
                          onClick={() => go(item)}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-2 text-left text-sm ${isActive ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                        >
                          <div className="min-w-0">
                            <div className="text-gray-900 truncate dark:text-gray-100">{item.label}</div>
                            {item.sub && <div className="text-xs text-gray-400 truncate">{item.sub}</div>}
                          </div>
                          {isActive && <CornerDownLeft className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2 border-t border-gray-200 text-[11px] text-gray-400 flex gap-4 dark:border-gray-800">
              <span><kbd className="font-sans">↑↓</kbd> navigate</span>
              <span><kbd className="font-sans">↵</kbd> open</span>
              <span><kbd className="font-sans">esc</kbd> close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
