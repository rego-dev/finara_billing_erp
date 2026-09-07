'use client';
/**
 * AccountSelect — searchable combobox for COA account pickers.
 * Replaces plain <select> lists that grow too long to scroll.
 *
 * Props:
 *   value      – currently selected accountId (number | '' | null)
 *   onChange   – fn(accountId: number | '') called on selection
 *   accounts   – [{ id, accountCode, accountName, accountType }]
 *   placeholder – string shown when nothing is selected
 *   className  – extra classes on the wrapper div
 *   disabled   – disable the trigger
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import DropdownPanel from './DropdownPanel';

export default function AccountSelect({
  value,
  onChange,
  accounts = [],
  placeholder = '— COA Account —',
  className = '',
  disabled = false,
}) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState('');
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const selected = value ? accounts.find((a) => a.id === Number(value)) : null;

  const filtered = search.trim()
    ? accounts.filter((a) =>
        a.accountCode.includes(search) ||
        a.accountName.toLowerCase().includes(search.toLowerCase())
      )
    : accounts;

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      // the panel is portalled out of wrapRef, so test it separately
      if (wrapRef.current && !wrapRef.current.contains(e.target) &&
          !panelRef.current?.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    setSearch('');
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [disabled]);

  const handleSelect = useCallback((acct) => {
    onChange(acct ? acct.id : '');
    setOpen(false);
    setSearch('');
  }, [onChange]);

  // Keyboard: Escape to close
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setSearch(''); }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`input w-full flex items-center justify-between text-left gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate text-sm ${selected ? 'text-gray-900' : 'text-gray-400'}`}>
          {selected
            ? <><span className="font-mono text-gray-500 mr-1">{selected.accountCode}</span>{selected.accountName}</>
            : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel — portalled so modal/table overflow can't clip it */}
      {open && (
        <DropdownPanel
          anchorRef={wrapRef}
          panelRef={panelRef}
          minHeight={280}
          maxHeight={320}
          minWidth={240}
          className="bg-white border border-gray-200 rounded-xl shadow-xl"
        >
          {/* Search bar */}
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="text"
                className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                placeholder="Search by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-2 text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Option list — the portalled panel owns the scrolling */}
          <div className="py-1">
            {/* Clear / none option */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-50 italic"
            >
              {placeholder}
            </button>

            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-xs text-gray-400 text-center">No accounts match "{search}"</p>
            ) : (
              filtered.map((acct) => (
                <button
                  key={acct.id}
                  type="button"
                  onClick={() => handleSelect(acct)}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-baseline gap-2 hover:bg-blue-50 hover:text-blue-700 transition-colors ${
                    acct.id === Number(value)
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-gray-700'
                  }`}
                >
                  <span className="font-mono text-gray-400 flex-shrink-0 w-10">{acct.accountCode}</span>
                  <span className="truncate">{acct.accountName}</span>
                </button>
              ))
            )}
          </div>
        </DropdownPanel>
      )}
    </div>
  );
}
