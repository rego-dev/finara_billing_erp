'use client';
import { useState, useRef, useEffect } from 'react';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Check, ChevronDown } from 'lucide-react';
import DropdownPanel from '@/components/ui/DropdownPanel';

/**
 * Type-to-search customer combobox with inline quick-add.
 *
 * Props:
 *   customers        — array of { id, customerCode, name }
 *   value            — selected customer id (string or number)
 *   onChange(id)     — called with the selected id (string), or '' when cleared
 *   onCustomerAdded(c) — called with the newly created customer so the parent can
 *                        add it to its list
 *   required, placeholder, disabled
 */
export default function CustomerSelect({
  customers = [], value, onChange, onCustomerAdded,
  required = false, placeholder = 'Type customer name…', disabled = false,
}) {
  const [text, setText]   = useState('');
  const [open, setOpen]   = useState(false);
  const [adding, setAdding] = useState(false);
  const boxRef   = useRef(null);
  const panelRef = useRef(null);

  // Fill the input with the selected customer's name (e.g. edit mode / late-loaded list).
  // Guarded by `!text` so it never wipes what the user is typing.
  useEffect(() => {
    if (value && !text) {
      const sel = customers.find((c) => String(c.id) === String(value));
      if (sel) setText(sel.name);
    }
  }, [customers, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdown on outside click
  useEffect(() => {
    // the panel is portalled out of boxRef, so test it separately
    const h = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target) &&
          !panelRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const q = text.trim().toLowerCase();
  const filtered = q
    ? customers.filter((c) =>
        c.name.toLowerCase().includes(q) || (c.customerCode || '').toLowerCase().includes(q))
    : customers;
  const exactMatch = customers.some((c) => c.name.trim().toLowerCase() === q);

  const pick = (c) => {
    onChange(String(c.id));
    setText(c.name);
    setOpen(false);
  };

  const handleAdd = async () => {
    const name = text.trim();
    if (!name) return;
    setAdding(true);
    try {
      const { data } = await rApi.customers.create({ name });
      toast.success(`Customer "${data.name}" added (${data.customerCode})`);
      onCustomerAdded?.(data);
      onChange(String(data.id));
      setText(data.name);
      setOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add customer');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className="relative">
        <input
          className="input pr-8"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (value) onChange(''); // typing invalidates the previous selection
          }}
        />
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {open && !disabled && (
        <DropdownPanel
          anchorRef={boxRef}
          panelRef={panelRef}
          minWidth={260}
          className="bg-white border border-gray-200 rounded-xl shadow-lg"
        >
          {filtered.length > 0 ? (
            filtered.map((c) => (
              <button
                type="button" key={c.id} onClick={() => pick(c)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between text-sm"
              >
                <span><span className="font-mono text-xs text-gray-400 mr-1">{c.customerCode}</span>{c.name}</span>
                {String(c.id) === String(value) && <Check className="w-4 h-4 text-green-500" />}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-400">No matching customer</div>
          )}

          {/* Quick-add when the typed name isn't already a customer */}
          {q && !exactMatch && (
            <button
              type="button" onClick={handleAdd} disabled={adding}
              className="w-full text-left px-3 py-2 border-t border-gray-100 hover:bg-green-50 text-green-700 flex items-center gap-2 text-sm font-medium disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Adding…' : <>Add &quot;{text.trim()}&quot; as new customer</>}
            </button>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}
