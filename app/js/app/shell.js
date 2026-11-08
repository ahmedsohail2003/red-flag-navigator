// App shell: sidebar, top bar with the global controls, and a hash router.
// Each view is a module in ./views/ exporting mount(root, ctx) that returns
// { update(ctx)?, unmount()? }. Routes are plain #names so they survive hosting.
// ctx.caseEntry / ctx.caseFile is the patient every patient view shows (any case,
// not only Alex): see ../cases.js.
import { getState, setState, subscribe, engineOpts } from './store.js';
import { esc, fmtDate } from './ui.js';
import { listCases, getCase, defaultVisit } from '../cases.js';
import { REFERRAL_LINES } from '../weights.js';

export const ROUTES = [
  { id: 'overview', label: 'Overview', group: 'Workspace', title: 'Overview' },
  { id: 'cases', label: 'Cases', group: 'Workspace', title: 'Cases' },
  { id: 'indicator', label: 'Red-flag indicator', group: 'patient', title: 'Red-flag indicator', patient: true },
  { id: 'patient', label: 'Patient app', group: 'patient', title: 'Patient app', patient: true },
  { id: 'monitoring', label: 'Monitoring', group: 'patient', title: 'Home and wearable monitoring', patient: true },
  { id: 'plan', label: 'Home plan', group: 'patient', title: 'Home plan and device data', patient: true },
  { id: 'devices', label: 'Devices and data', group: 'patient', title: 'Devices and live data', patient: true },
  { id: 'evidence', label: 'Evidence', group: 'Method', title: 'Evidence and method' },
  { id: 'datasets', label: 'Datasets', group: 'Method', title: 'What the datasets show' },
];
const loaders = {
  overview: () => import('./views/overview.js'),
  cases: () => import('./views/cases.js'),
  indicator: () => import('./views/indicator.js'),
  patient: () => import('./views/patient.js'),
  monitoring: () => import('./views/monitoring.js'),
  plan: () => import('./views/homeplan.js'),
  devices: () => import('./views/devices.js'),
  evidence: () => import('./views/evidence.js'),
  datasets: () => import('./views/datasets.js'),
};

const root = document.getElementById('app');

const currentCase = () => getCase(getState().caseId);

function navHtml(active, entry) {
  const groups = [];
  for (const r of ROUTES) {
    const name = r.group === 'patient' ? `Patient · ${entry.caseFile.patient.name}` : r.group;
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(r);
  }
  return groups.map((g) => `<div class="nav-group"><div class="micro">${esc(g.name)}</div>${g.items.map((r) =>
    `<a class="nav-item${r.id === active ? ' active' : ''}" href="#${r.id}" data-route="${r.id}"${r.id === active ? ' aria-current="page"' : ''}><span class="dot"></span>${esc(r.label)}</a>`).join('')}</div>`).join('');
}

function caseOptions(s) {
  const groups = [
    ['case-file', 'Case file'],
    ['user', 'My cases'],
    ['demo', 'Look-alike demos'],
  ];
  const all = listCases();
  return groups.map(([kind, label]) => {
    const items = all.filter((c) => c.kind === kind);
    if (!items.length) return '';
    return `<optgroup label="${esc(label)}">${items.map((c) => `<option value="${esc(c.id)}"${c.id === s.caseId ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`;
  }).join('');
}

function controlsHtml(s, entry) {
  const encs = entry.caseFile.encounters || [];
  const visits = encs.length
    ? encs.map((e) => `<option value="${esc(e.date)}"${e.date === s.asOf ? ' selected' : ''}>${fmtDate(e.date)} · ${esc(e.setting)}</option>`).join('')
    : '<option value="">No visits yet</option>';
  const lines = REFERRAL_LINES.map((l) => `<button type="button" class="mono" data-line="${l.value}" aria-pressed="${l.value === s.line}" title="${esc(l.note)}">${esc(l.label)}</button>`).join('');
  return `
    <label class="ctrl"><span class="micro">Case</span><select class="select" id="ctl-case" aria-label="Patient case">${caseOptions(s)}</select></label>
    <label class="ctrl"><span class="micro">Visit</span><select class="select" id="ctl-visit" aria-label="Visit to look at"${encs.length ? '' : ' disabled'}>${visits}</select></label>
    <div class="ctrl"><span class="micro" id="line-lbl">Referral line</span><div class="seg" role="group" aria-labelledby="line-lbl">${lines}</div></div>
    <label class="switch" title="Count this case's weekly home-test values: simulated for the demo case, entered for your own cases"><input type="checkbox" id="ctl-sim"${s.includeHome ? ' checked' : ''}><span class="track"></span>Home data</label>`;
}

const crumbsHtml = (r, entry) => `${r.patient ? `<span>Patients</span><span class="sep">/</span><span>${esc(entry.caseFile.patient.name)}</span><span class="sep">/</span>` : ''}<b>${esc(r.title)}</b>`;

function bindControls() {
  root.querySelector('#ctl-case').addEventListener('change', (e) => openCase(e.target.value));
  const v = root.querySelector('#ctl-visit');
  if (v) v.addEventListener('change', (e) => e.target.value && setState({ asOf: e.target.value }));
  root.querySelectorAll('[data-line]').forEach((b) => b.addEventListener('click', () => setState({ line: Number(b.dataset.line) })));
  root.querySelector('#ctl-sim').addEventListener('change', (e) => setState({ includeHome: e.target.checked }));
}

function frame(routeId) {
  const r = ROUTES.find((x) => x.id === routeId) || ROUTES[0];
  const s = getState();
  const entry = currentCase();
  root.innerHTML = `
    <a class="skip-link" href="#view">Skip to content</a>
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><path d="M4 14.5V2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.6 2.6h7.6l-1.9 3 1.9 3H4.6z" fill="currentColor"/></svg></div><div><div class="brand-name">Red-Flag Navigator</div><div class="brand-sub">Earlier EMG referral for possible ALS</div></div></div>
      <nav aria-label="Main">${navHtml(r.id, entry)}</nav>
      <div class="sidebar-foot">BioHacks 2026 · Detection and Diagnostics<br>Decision support for clinicians. It never diagnoses.</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="crumbs">${crumbsHtml(r, entry)}</div>
        <div class="topbar-controls">${controlsHtml(s, entry)}</div>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
    </div>`;
  bindControls();
}

// Views whose update() takes a change of patient in place: the overview's sections update
// themselves, the evidence page re-renders its parts, and the datasets page does not depend on
// the case. Switching the case there redraws only the sidebar and the top bar, so the reader
// keeps their place in a long page instead of jumping back to the top.
const CASE_UPDATES_IN_PLACE = new Set(['overview', 'evidence', 'datasets']);
function refreshChrome(routeId) {
  const r = ROUTES.find((x) => x.id === routeId) || ROUTES[0];
  const entry = currentCase();
  const was = document.activeElement;
  const keepId = was && FRAME_CONTROL_IDS.includes(was.id) ? was.id : null;
  const nav = root.querySelector('.sidebar nav');
  const crumbs = root.querySelector('.topbar .crumbs');
  const controls = root.querySelector('.topbar-controls');
  if (!nav || !crumbs || !controls) return false;
  nav.innerHTML = navHtml(r.id, entry);
  crumbs.innerHTML = crumbsHtml(r, entry);
  controls.innerHTML = controlsHtml(getState(), entry);
  bindControls();
  if (keepId) root.querySelector(`#${keepId}`)?.focus();
  return true;
}

// Switch the whole app to another patient: newest visit, no what-if exclusions.
export function openCase(id) {
  const entry = getCase(id);
  const asOf = entry.id === 'alex' ? '2024-12-09' : (defaultVisit(entry.caseFile) || getState().asOf);
  setState({ caseId: entry.id, asOf, exclude: [] });
}

// Keep the selected visit valid for the current case.
function ensureValidVisit() {
  const s = getState();
  const entry = currentCase();
  const dates = (entry.caseFile.encounters || []).map((e) => e.date);
  if (entry.id !== s.caseId) { setState({ caseId: entry.id }); return true; }
  if (dates.length && !dates.includes(s.asOf)) {
    const before = dates.filter((d) => d <= s.asOf);
    setState({ asOf: before.length ? before[before.length - 1] : dates[dates.length - 1] });
    return true;
  }
  return false;
}

const ctx = () => {
  const entry = currentCase();
  return { state: getState(), setState, opts: engineOpts(), navigate: (id) => go(id), caseEntry: entry, caseFile: entry.caseFile, openCase };
};

let current = null; // { id, handle }
let seq = 0;
let lastCaseKey = '';

// Keyboard focus. Every show() redraws the sidebar and the top bar, which used to drop focus to <body>:
// the next Tab went back to "Overview", 16 stops from the view. Now a route change moves focus to the
// view (main#view, tabindex -1), and a top-bar control the user was on (the Case menu) keeps it.
const FRAME_CONTROL_IDS = ['ctl-case', 'ctl-visit', 'ctl-sim'];
function focusView(scroll = false) {
  const v = root.querySelector('#view');
  if (!v) return;
  try { v.focus({ preventScroll: !scroll }); } catch { v.focus(); }
}
// The skip link's look lives here so the shell needs no stylesheet change: hidden until it has focus.
if (!document.getElementById('shell-a11y-css')) {
  const css = document.createElement('style');
  css.id = 'shell-a11y-css';
  css.textContent = '.skip-link{position:absolute;left:12px;top:-60px;z-index:100;padding:8px 14px;border-radius:8px;'
    + 'background:var(--surface-3,#fff);color:var(--ink,#231B16);border:1px solid var(--line-2,rgba(0,0,0,.18));'
    + 'font:500 14px/1.4 var(--font-sans,system-ui,sans-serif);text-decoration:none}.skip-link:focus{top:12px}'
    + '#view:focus{outline:none}';
  document.head.appendChild(css);
}

async function show(routeId, { focus } = {}) {
  const id = loaders[routeId] ? routeId : 'overview';
  const my = ++seq;
  const was = document.activeElement;
  const keepId = was && FRAME_CONTROL_IDS.includes(was.id) ? was.id : null;
  const wasInView = Boolean(was && was.closest && was.closest('#view'));
  if (current?.handle?.unmount) { try { current.handle.unmount(); } catch (e) { console.error(e); } }
  current = null;
  frame(id);
  if (keepId) root.querySelector(`#${keepId}`)?.focus();
  lastCaseKey = `${getState().caseId}|${getState().casesRev}`;
  const view = root.querySelector('#view');
  view.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const mod = await loaders[id]();
    if (my !== seq) return;
    view.innerHTML = '';
    const handle = mod.mount(view, ctx()) || {};
    current = { id, handle };
  } catch (e) {
    console.error(e);
    if (my !== seq) return;
    view.innerHTML = `<div class="error-card"><b>This view did not load.</b> ${esc(e.message || e)}</div>`;
  }
  document.title = `${ROUTES.find((r) => r.id === id)?.title || 'Overview'} · Red-Flag Navigator`;
  if (focus === 'view' || (!keepId && wasInView)) focusView();
  window.scrollTo(0, 0);
}

function syncControls(s) {
  const v = root.querySelector('#ctl-visit');
  if (v && s.asOf && v.value !== s.asOf) v.value = s.asOf;
  root.querySelectorAll('[data-line]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.line) === s.line)));
  const sim = root.querySelector('#ctl-sim');
  if (sim) sim.checked = s.includeHome;
}

subscribe((s) => {
  if (ensureValidVisit()) return; // setState re-enters with a valid visit
  const key = `${s.caseId}|${s.casesRev}`;
  if (!current) return;
  if (key !== lastCaseKey) {
    // new patient: views that take it in place keep their scroll position; others are rebuilt
    if (CASE_UPDATES_IN_PLACE.has(current.id) && current.handle.update && refreshChrome(current.id)) {
      lastCaseKey = key;
      current.handle.update(ctx());
      return;
    }
    show(current.id);
    return;
  }
  syncControls(s);
  if (current.handle.update) current.handle.update(ctx());
  else show(current.id);
});

function route() { return (location.hash || '').replace(/^#/, '') || 'overview'; }

// Switch views in the app itself. Some hosts (a sandboxed frame such as a claude.ai
// artifact) never deliver hash changes to the page, so links cannot rely on them.
// The address is updated where the host allows it, for bookmarks and reloads.
export function go(id) {
  if (!loaders[id] || current?.id === id) return;
  show(id, { focus: 'view' });
  try { if (location.hash.replace(/^#/, '') !== id) history.replaceState(null, '', `#${id}`); } catch { /* host refuses: fine */ }
}
// Any internal link to a route (#cases, #indicator, ...) goes through go().
// Links to in-page sections (#ev-weights and so on) are left alone.
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
  if (!a) return;
  if (a.classList.contains('skip-link')) { e.preventDefault(); focusView(true); return; } // keep the route in the address
  const id = a.getAttribute('href').slice(1);
  if (loaders[id]) { e.preventDefault(); go(id); }
});
// Back/forward and typed addresses: only known routes switch the view.
window.addEventListener('hashchange', () => { const r = route(); if (loaders[r] && r !== current?.id) show(r, { focus: 'view' }); });
document.documentElement.setAttribute('data-app-ready', '');
ensureValidVisit();
show(route());
