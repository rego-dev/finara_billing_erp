// Lightweight client-side export helpers — no external dependencies.
// CSV opens directly in Excel/Google Sheets/Numbers.

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeCsv = (val) => {
  if (val == null) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Export an array of row objects to CSV.
 * @param {Array<Object>} rows
 * @param {Array<{key:string,label:string}>} columns
 * @param {string} filename  (without extension)
 */
export function exportToCSV(rows, columns, filename = 'export') {
  const header = columns.map((c) => escapeCsv(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCsv(typeof c.format === 'function' ? c.format(r[c.key], r) : r[c.key])).join(',')).join('\n');
  // BOM so Excel reads UTF-8 (peso sign etc.) correctly
  downloadBlob('﻿' + header + '\n' + body, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Export to a real .xls (SpreadsheetML) file that Excel opens with formatting.
 */
export function exportToExcel(rows, columns, filename = 'export', sheetName = 'Sheet1') {
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(typeof c.format === 'function' ? c.format(r[c.key], r) : r[c.key])}</td>`).join('')}</tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${esc(sheetName)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
    </x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    <style>th{background:#1e3a8a;color:#fff;font-weight:bold;padding:4px}td{padding:4px;border:1px solid #ddd}</style></head>
    <body><table>${`<tr>${head}</tr>`}${trs}</table></body></html>`;
  downloadBlob(html, `${filename}.xls`, 'application/vnd.ms-excel');
}
