/**
 * print.js — Company letterhead print utility
 * Usage: import { printDocument } from '@/lib/print';
 *        await printDocument('Invoice', 'INV-000001', bodyHTML);
 */
import { settings as settingsApi } from './api';

// ── Company profile cache ─────────────────────────────────────
let _company = null;

export async function getCompanyProfile() {
  if (_company) return _company;
  try {
    const { data } = await settingsApi.getAll();
    _company = data;
  } catch {
    _company = { companyName: 'Company', currency: 'PHP' };
  }
  return _company;
}

// Clear cache (call after saving settings)
export function clearCompanyCache() { _company = null; }

// ── Currency helper for print window (no React context) ───────
export function phpFmt(n) {
  const num = Number(n) || 0;
  return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dateFmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Core: build full HTML page ────────────────────────────────
export function buildPrintPage(company = {}, title = '', subtitle = '', bodyHTML = '', origin = '') {
  const {
    companyName    = '',
    companyAddress = '',
    companyCity    = '',
    companyProvince= '',
    companyZip     = '',
    companyPhone   = '',
    companyEmail   = '',
    companyWebsite = '',
    companyTin     = '',
    companyLogo    = '',
    vatRegistered  = 'true',
  } = company;

  const addr = [companyAddress, companyCity, companyProvince, companyZip].filter(Boolean).join(', ');
  const now  = new Date().toLocaleString('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const fallbackLogo = origin ? `${origin}/finara-icon.svg` : '';
  const logoHTML = companyLogo
    ? `<img src="${companyLogo}" class="logo-img" alt="Logo" />`
    : fallbackLogo
      ? `<img src="${fallbackLogo}" class="logo-img" alt="Finara" />`
      : `<div class="logo-mono">${(companyName || 'C').slice(0, 2).toUpperCase()}</div>`;

  const tinLine = [
    companyTin   ? `TIN: ${companyTin}`            : '',
    vatRegistered === 'true' ? 'VAT Registered'    : '',
    companyWebsite            ? companyWebsite      : '',
  ].filter(Boolean).join('  ·  ');

  const contactLine = [
    companyPhone  ? `Tel: ${companyPhone}`  : '',
    companyEmail  ? companyEmail            : '',
  ].filter(Boolean).join('  ·  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}${companyName ? ' — ' + companyName : ''}</title>
<style>
  /* ── Reset ── */
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }
  .page { padding: 12mm 15mm 10mm; }

  /* ── Letterhead ── */
  .letterhead { display: flex; align-items: flex-start; gap: 14px; padding-bottom: 10px; border-bottom: 3px solid #1d4ed8; margin-bottom: 14px; }
  .logo-img   { width: 64px; height: 64px; object-fit: contain; border-radius: 6px; flex-shrink: 0; }
  .logo-mono  { width: 64px; height: 64px; background: #1d4ed8; border-radius: 10px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 24px; font-weight: 900; letter-spacing: -1px; flex-shrink: 0; }
  .co-block   { flex: 1; min-width: 0; }
  .co-name    { font-size: 17px; font-weight: 900; color: #1d4ed8; line-height: 1.1; margin-bottom: 3px; }
  .co-meta    { font-size: 8.5px; color: #555; line-height: 1.75; }
  .doc-block  { text-align: right; flex-shrink: 0; }
  .doc-title  { font-size: 14px; font-weight: 800; color: #111; }
  .doc-sub    { font-size: 9px; color: #555; margin-top: 4px; line-height: 1.6; }

  /* ── Summary boxes ── */
  .sum-row  { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
  .sum-box  { flex: 1; min-width: 90px; border: 1px solid #d1daf0; border-radius: 6px; padding: 7px 10px; }
  .sum-lbl  { font-size: 8px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .sum-val  { font-size: 15px; font-weight: 800; color: #1d4ed8; margin-top: 2px; white-space: nowrap; }
  .sum-sub  { font-size: 8px; color: #9ca3af; }
  .sum-green  { border-color: #bbf7d0; } .sum-green  .sum-val { color: #15803d; }
  .sum-red    { border-color: #fecaca; } .sum-red    .sum-val { color: #b91c1c; }
  .sum-yellow { border-color: #fde68a; } .sum-yellow .sum-val { color: #92400e; }
  .sum-gray   { border-color: #e2e8f0; } .sum-gray   .sum-val { color: #475569; }

  /* ── Table ── */
  table          { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; }
  thead th       { background: #1d4ed8; color: #fff; padding: 5px 7px; text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
  tbody tr:nth-child(even) { background: #f8faff; }
  tbody td       { padding: 4.5px 7px; border-bottom: 1px solid #e8ecf0; vertical-align: top; }
  tfoot td       { padding: 5px 7px; font-weight: 700; border-top: 2px solid #1d4ed8; background: #eff6ff; font-size: 10px; }
  .section-row td { background: #e8efff; font-weight: 700; color: #1d4ed8; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; padding: 5px 7px; }
  .right  { text-align: right; }
  .center { text-align: center; }
  .mono   { font-family: 'Courier New', monospace; }
  .bold   { font-weight: 700; }
  .green  { color: #15803d; }
  .red    { color: #b91c1c; }
  .blue   { color: #1d4ed8; }
  .gray   { color: #6b7280; }
  .small  { font-size: 8.5px; }

  /* ── Section title ── */
  .section-title { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #1d4ed8; margin: 14px 0 6px; }

  /* ── Info grid ── */
  .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 10px 0; }
  .info-box  { border: 1px solid #e8ecf0; border-radius: 5px; padding: 6px 10px; }
  .info-lbl  { font-size: 8px; color: #6b7280; text-transform: uppercase; letter-spacing: .04em; }
  .info-val  { font-size: 11px; font-weight: 600; color: #111; margin-top: 2px; }

  /* ── Totals block ── */
  .totals-block { background: #f8faff; border: 1px solid #d1daf0; border-radius: 6px; padding: 10px 14px; margin-top: 10px; font-size: 11px; }
  .totals-row   { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals-divider { border-top: 1px solid #d1daf0; margin: 4px 0; }
  .totals-total { font-weight: 800; font-size: 13px; }

  /* ── Badge ── */
  .badge   { display: inline-block; padding: 1px 6px; border-radius: 20px; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .b-blue   { background: #dbeafe; color: #1e40af; }
  .b-green  { background: #dcfce7; color: #166534; }
  .b-yellow { background: #fef9c3; color: #854d0e; }
  .b-red    { background: #fee2e2; color: #991b1b; }
  .b-gray   { background: #f1f5f9; color: #475569; }

  /* ── Description box ── */
  .desc-box { background: #f8faff; border: 1px solid #d1daf0; border-radius: 5px; padding: 8px 12px; font-size: 10px; color: #374151; margin: 8px 0; }

  /* ── Footer ── */
  .footer { margin-top: 16px; padding-top: 7px; border-top: 1px solid #d1d5db; display: flex; justify-content: space-between; font-size: 8px; color: #9ca3af; }

  /* ── Print ── */
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    @page { size: A4; margin: 10mm 12mm; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Letterhead -->
  <div class="letterhead">
    <div>${logoHTML}</div>
    <div class="co-block">
      <div class="co-name">${companyName || 'Company'}</div>
      <div class="co-meta">
        ${addr       ? `${addr}<br>` : ''}
        ${contactLine? `${contactLine}<br>` : ''}
        ${tinLine    ? tinLine : ''}
      </div>
    </div>
    <div class="doc-block">
      <div class="doc-title">${title}</div>
      <div class="doc-sub">${subtitle ? subtitle + '<br>' : ''}Printed: ${now}</div>
    </div>
  </div>

  <!-- Body -->
  ${bodyHTML}

  <!-- Footer -->
  <div class="footer">
    <span>${companyName}${title ? ' — ' + title : ''}</span>
    <span>Printed: ${now}</span>
  </div>
</div>
<script>
  window.onload = function () { setTimeout(function () { window.print(); }, 450); };
</script>
</body>
</html>`;
}

// ── Main entry point ──────────────────────────────────────────
// Opens the window FIRST, synchronously, in the same tick as the click that
// triggered this — browsers only allow window.open() without a popup block
// when it happens inside the original user-gesture call stack. Awaiting the
// company profile fetch before opening (the old order) loses that gesture,
// so popups got silently blocked on anything but an instant-cached profile.
export async function printDocument(title, subtitle, bodyHTML) {
  const win = window.open('', '_blank', 'width=950,height=720,scrollbars=yes');
  if (!win) {
    alert('Pop-ups are blocked. Please allow pop-ups for this page to enable printing.');
    return;
  }
  win.document.write('<p style="font-family:sans-serif;padding:40px;color:#888;">Preparing document…</p>');
  win.document.close();

  const company = await getCompanyProfile();
  const origin  = typeof window !== 'undefined' ? window.location.origin : '';
  const html    = buildPrintPage(company, title, subtitle, bodyHTML, origin);
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ── Badge HTML helpers ────────────────────────────────────────
const BADGE_CLASS = {
  OPEN: 'b-blue', PARTIAL: 'b-yellow', PAID: 'b-green',
  OVERDUE: 'b-red', VOID: 'b-gray', VOIDED: 'b-gray',
  DRAFT: 'b-yellow', POSTED: 'b-green',
  OPEN_STATUS: 'b-blue', COMPUTED: 'b-yellow', APPROVED: 'b-blue', PAID_STATUS: 'b-green',
};
export function badge(status) {
  return `<span class="badge ${BADGE_CLASS[status] || 'b-gray'}">${status}</span>`;
}
