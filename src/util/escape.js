// HTML and CSV escaping helpers. Pure (well, escapeHtml uses document for
// safety, but happy-dom and browsers both support that).

export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
