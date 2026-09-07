'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** "1234567.5" -> "1,234,567.5" (keeps a trailing "." while it's being typed) */
export function groupThousands(raw) {
  if (raw === '' || raw === null || raw === undefined) return '';
  const str = String(raw);
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const dot = body.indexOf('.');
  const int = dot === -1 ? body : body.slice(0, dot);
  const dec = dot === -1 ? '' : body.slice(dot); // includes the "."
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + dec;
}

const stripCommas = (s) => String(s ?? '').replace(/,/g, '');

/**
 * Numeric text input that shows thousand separators while typing.
 * Emits the RAW unformatted string (e.g. "1234.50") via onChange, so form state
 * and Number()/parseFloat stay unchanged.
 *
 * Props: value, onChange(raw), decimals (max decimal places), allowNegative,
 *        className, ...rest (placeholder, required, disabled, ...)
 */
export default function NumberInput({
  value,
  onChange,
  decimals = 2,
  allowNegative = false,
  className = 'input text-right',
  ...rest
}) {
  const ref = useRef(null);
  const caret = useRef(null);
  const [text, setText] = useState(() => groupThousands(value));
  const emitted = useRef(stripCommas(groupThousands(value)));

  // Re-format when the parent changes the value from the outside (reset, prefill, ...)
  useEffect(() => {
    const incoming = value === '' || value === null || value === undefined ? '' : String(value);
    if (incoming !== emitted.current) {
      emitted.current = incoming;
      setText(groupThousands(incoming));
    }
  }, [value]);

  // Keep the caret where the user left it after commas shift the string
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current);
      caret.current = null;
    }
  });

  const handleChange = (e) => {
    const el = e.target;
    const raw = stripCommas(el.value);

    const pattern = allowNegative ? /^-?\d*\.?\d*$/ : /^\d*\.?\d*$/;
    if (!pattern.test(raw)) return;                       // ignore invalid keystrokes
    const dec = raw.split('.')[1];
    if (dec != null && dec.length > decimals) return;     // cap decimal places

    // Count the digits left of the caret so we can restore it after re-grouping
    const digitsBefore = (el.value.slice(0, el.selectionStart).match(/[\d.-]/g) || []).length;
    const formatted = groupThousands(raw);

    let seen = 0;
    let pos = formatted.length;
    for (let i = 0; i < formatted.length; i++) {
      if (/[\d.-]/.test(formatted[i])) seen++;
      if (seen === digitsBefore) { pos = i + 1; break; }
    }
    caret.current = digitsBefore === 0 ? 0 : pos;

    setText(formatted);
    emitted.current = raw;
    onChange(raw);
  };

  const handleBlur = (e) => {
    const current = stripCommas(text);
    const raw = current.replace(/\.$/, '');               // drop a dangling "."
    setText(groupThousands(raw));
    if (raw !== current) { emitted.current = raw; onChange(raw); }
    rest.onBlur?.(e);
  };

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
