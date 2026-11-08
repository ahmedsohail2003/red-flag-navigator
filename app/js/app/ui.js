// Small shared helpers for the app views. Pure functions; no DOM except el().
import { formatPct, SOURCES } from '../engine.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// '2024-12-09' -> '9 Dec 2024'; '2024-06' -> 'Jun 2024'
export function fmtDate(d, long = false) {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(d);
  if (!m) return esc(d);
  const mon = (long ? MON_LONG : MON)[Number(m[2]) - 1];
  return m[3] ? `${Number(m[3])} ${mon} ${m[1]}` : `${mon} ${m[1]}`;
}

export const pct = (p) => formatPct(p);
export const range = (r) => (r ? `${formatPct(r.lo)} to ${formatPct(r.hi)}` : '');

// A range end printed next to the referral line. When it would print the same as the
// line but sits on the other side (Alex's upper end 20.046% at the 20% line), it gets
// just enough decimals to show the side ("20.05%"), so the words agree with the tier.
export function pctAt(p, line) {
  const s = formatPct(p);
  // Compare the printed numbers, not the strings: "10.0%" and "10%" read as the same.
  if (line == null || p == null || !Number.isFinite(p) || p === line || !/^[\d.]+%$/.test(s) || parseFloat(s) !== parseFloat(formatPct(line))) return s;
  const v = p * 100;
  const w = line * 100;
  for (let d = 1; d <= 4; d += 1) { const a = v.toFixed(d); if (a !== w.toFixed(d)) return `${a}%`; }
  return s;
}
export const rangeAt = (r, line) => (r ? `${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}` : '');

// Tier words: always shown with the colour, never colour alone.
export const TIER = {
  high: { label: 'High', action: 'Refer for EMG', patient: 'A specialist test is next' },
  unclear: { label: 'Unclear', action: 'Track weekly for 8 weeks', patient: 'We are watching for change' },
  low: { label: 'Low', action: 'Routine care', patient: 'Nothing more needed now' },
};
export const tierChip = (tier) => `<span class="chip ${esc(tier)}">${esc(TIER[tier]?.label || tier)}</span>`;
export const simChip = () => '<span class="chip sim" title="Made-up values that show how the design works; not measured">Simulated</span>';
export const assumeChip = () => '<span class="chip assume" title="A team assumption until it is measured">Assumption</span>';

export function sourceLink(key) {
  const s = SOURCES[key];
  if (!s) return '';
  return s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.short)}</a>` : esc(s.short);
}

// Load a view's own stylesheet once (path relative to app/, e.g. 'css/views/indicator.css').
export function ensureCss(href) {
  if (typeof document === 'undefined' || document.querySelector(`link[data-view-css="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  l.dataset.viewCss = href;
  document.head.appendChild(l);
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// Months between two ISO dates, one decimal.
export function monthsBetween(a, b) {
  const t = (d) => Date.parse((d.length === 7 ? `${d}-01` : d) + 'T00:00:00Z');
  return Math.round(((t(b) - t(a)) / (30.4375 * 86400000)) * 10) / 10;
}
