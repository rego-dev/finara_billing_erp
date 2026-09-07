'use client';
import { useState, useEffect, useId } from 'react';

const KEY = 'lineDescriptionHistory';
const MAX = 300;

function loadHistory() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

// Remember a description so it auto-suggests next time. Exported so forms can
// also persist on submit (in case the field never lost focus).
export function rememberDescription(desc) {
  const d = (desc || '').trim();
  if (!d || typeof window === 'undefined') return;
  try {
    let list = JSON.parse(localStorage.getItem(KEY) || '[]');
    list = list.filter((x) => x.toLowerCase() !== d.toLowerCase()); // dedupe (case-insensitive)
    list.unshift(d);                                                 // most-recent first
    if (list.length > MAX) list = list.slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* ignore quota/parse errors */ }
}

/**
 * Text input with a remembered-descriptions autocomplete (native <datalist>).
 * Typing a value and leaving the field stores it for future suggestions.
 *
 * Props: value, onChange(text), className, placeholder, ...rest
 */
export default function DescriptionInput({
  value, onChange, className = 'input text-xs', placeholder = 'Item / service description', ...rest
}) {
  const [history, setHistory] = useState([]);
  const listId = useId();

  useEffect(() => { setHistory(loadHistory()); }, []);

  return (
    <>
      <input
        className={className}
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => { rememberDescription(e.target.value); setHistory(loadHistory()); }}
        {...rest}
      />
      <datalist id={listId}>
        {history.map((h, i) => <option key={i} value={h} />)}
      </datalist>
    </>
  );
}
