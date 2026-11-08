// Shared app state for every view: referral line, simulated home data on/off,
// the visit being looked at, and findings the doctor has unticked (what-if).
// Persisted when the browser allows it; works in memory when it does not.
import { DEFAULT_REFERRAL_LINE } from '../engine.js';

const KEY = 'rfn.app';
// caseId: which patient every view shows (see ../cases.js). casesRev bumps when a
// user case is saved or deleted, so views re-read the case list.
const DEFAULTS = { line: DEFAULT_REFERRAL_LINE, includeHome: false, asOf: '2024-12-09', exclude: [], caseId: 'alex', casesRev: 0 };

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || typeof s !== 'object') return { ...DEFAULTS };
    const line = Number(s.line);
    return {
      ...DEFAULTS,
      line: line > 0 && line < 1 ? line : DEFAULTS.line,
      includeHome: s.includeHome === true,
      asOf: typeof s.asOf === 'string' ? s.asOf : DEFAULTS.asOf,
      exclude: Array.isArray(s.exclude) ? s.exclude.filter((x) => typeof x === 'string') : [],
      caseId: typeof s.caseId === 'string' && s.caseId ? s.caseId : DEFAULTS.caseId,
      casesRev: 0,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();
const subs = new Set();

export const getState = () => state;

export function setState(patch) {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    // keep the older pages in step
    localStorage.setItem('rfn.referralLine', String(state.line));
    localStorage.setItem('rfn.includeHomeTests', String(state.includeHome));
  } catch { /* storage blocked: keep in memory */ }
  for (const f of subs) { try { f(state); } catch (e) { console.error(e); } }
}

export function subscribe(f) { subs.add(f); return () => subs.delete(f); }

export function resetState() { setState({ ...DEFAULTS }); }

// Noise floors the team measured on the Monitoring page (10 repeats each), if any.
function measuredMdc() {
  try {
    const m = JSON.parse(localStorage.getItem('rfn.mdc') || 'null');
    if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
    const out = {};
    for (const [k, v] of Object.entries(m)) {
      const n = Number(v && typeof v === 'object' ? v.mdc : v);
      if (n > 0 && Number.isFinite(n)) out[k] = n;
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}

// Options for engine.js, from the current state.
export function engineOpts(s = state) {
  const o = { referralLine: s.line, includeHomeTests: s.includeHome, exclude: new Set(s.exclude) };
  const mdc = measuredMdc();
  if (mdc) o.mdc = mdc;
  return o;
}
