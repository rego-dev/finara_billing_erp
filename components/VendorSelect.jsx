'use client';
import { useState, useRef, useEffect } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Check, ChevronDown } from 'lucide-react';
import DropdownPanel from '@/components/ui/DropdownPanel';

/**
 * Type-to-search vendor combobox with inline quick-add.
 *
 * Props:
 *   vendors          — array of { id, vendorCode, name }
 *   value            — selected vendor id (string or number)
 *   onChange(id)     — called with the selected id (string), or '' when cleared
 *   onVendorAdded(v) — called with the newly created vendor so the parent can
 *                      add it to its list
 *   required, placeholder, disabled
 */
export default function VendorSelect({
  vendors = [], value, onChange, onVendorAdded,
  required = false, placeholder = 'Type vendor name…', disabled = false,
}) {
  const [text, setText]     = useState('');
  const [open, setOpen]     = useState(false);
  const [adding, setAdding] = useState(false);
  const boxRef   = useRef(null);
  const panelRef = useRef(null);

  // Fill the input with the selected vendor's name (edit mode / late-loaded list).
  // Guarded by `!text` so it never wipes what the user is typing.
  useEffect(() => {
    if (value && !text) {
      const sel = vendors.find((v) => String(v.id) === String(value));
      if (sel) setText(sel.name);
    }
  }, [vendors, value]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ? vendors.filter((v) =>
        v.name.toLowerCase().includes(q) || (v.vendorCode || '').toLowerCase().includes(q))
    : vendors;
  const exactMatch = vendors.some((v) => v.name.trim().toLowerCase() === q);

  const pick = (v) => {
    onChange(String(v.id));
    setText(v.name);
    setOpen(false);
  };

  const handleAdd = async () => {
    const name = text.trim();
    if (!name) return;
    setAdding(true);
    try {
      const { data } = await pApi.vendors.create({ name });
      toast.success(`Vendor "${data.name}" added (${data.vendorCode})`);
      onVendorAdded?.(data);
      onChange(String(data.id));
      setText(data.name);
      setOpen(false);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add vendor');
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
            if (value) onChange('');
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
            filtered.map((v) => (
              <button
                type="button" key={v.id} onClick={() => pick(v)}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center justify-between text-sm"
              >
                <span><span className="font-mono text-xs text-gray-400 mr-1">{v.vendorCode}</span>{v.name}</span>
                {String(v.id) === String(value) && <Check className="w-4 h-4 text-green-500" />}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-sm text-gray-400">No matching vendor</div>
          )}

          {q && !exactMatch && (
            <button
              type="button" onClick={handleAdd} disabled={adding}
              className="w-full text-left px-3 py-2 border-t border-gray-100 hover:bg-green-50 text-green-700 flex items-center gap-2 text-sm font-medium disabled:opacity-60"
            >
              <Plus className="w-4 h-4" />
              {adding ? 'Adding…' : <>Add &quot;{text.trim()}&quot; as new vendor</>}
            </button>
          )}
        </DropdownPanel>
      )}
    </div>
  );
}
