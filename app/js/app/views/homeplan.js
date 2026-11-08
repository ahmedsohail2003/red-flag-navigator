// Home plan (#plan): what to do at home this week for the case's situation, the tests
// runnable inline, the person's data by body region, device imports, and what actually
// detects anything. Everything runs alongside a referral, never instead of it.
// The plan comes from ../../home/protocol.js, every label and clinical number from
// ../../home/catalog.js, the weekly maths from ../../home/summary.js and series.js.
// Kit data is saved per case (person = the case id) in this browser only (home/store.js),
// and so are the answers that shape the plan (rfn.home.profile:<case id>).
// The older tests of hometests.js (rfn.homeResults) are read, never written.
// Only mount() touches the DOM, so Node can import this file. The pure helpers above
// mount() are exported for tests/home-plan-view.test.mjs.
import { esc, fmtDate, TIER, tierChip, simChip, assumeChip, ensureCss, el, plural } from '../ui.js';
import { evaluateAt, ACTIONS, UNCLEAR_DEADLINE_WEEKS } from '../../engine.js';
import { REGION_LABEL } from '../../cases.js';
import { getResults as getLegacyResults, PASSAGE, localDate, localTime, currentPerson } from '../../hometests.js';
import * as catalog from '../../home/catalog.js';
import * as protocol from '../../home/protocol.js';
import * as demoData from '../../home/demo.js';
import {
  getSamples, addSamples, removeSamples, getResults, addResult, removeResult, clearHomeData, subscribe, storageStatus,
} from '../../home/store.js';
import { micSupport, recordAudio, analyzeTask } from '../../home/audio.js';
import { PASSAGES, createTypingSession } from '../../home/typing.js';
import { importAppleHealth } from '../../home/import/applehealth.js';
import { csvToSamples, MANUAL_FIELDS, manualToSample, samplesToCsv } from '../../home/import/csv.js';
import { bluetoothSupport, connectHealthDevice, HEALTH_DEVICES } from '../../home/import/bluetooth.js';
import { summarize, checkThresholds, lastResult, lastSample, dueState, countAfter, CHIP_WORDS } from '../../home/summary.js';
import { calendarDate, weekStart } from '../../home/series.js';

// ---------- constants ----------
const PROFILE_KEY = 'rfn.home.profile'; // one key per case: rfn.home.profile:<case id>
// Shown when the page is framed (a hosted copy inside another page).
export const LOCAL = 'The microphone, Bluetooth and downloads work only when the app is opened on its own, not inside another page. You can still type readings in or import files.';
const HISTORY_WEEKS = 12; // imports keep the 12 weeks before the first visit, and everything after
const FALLS_DAYS = 91; // "fallen or nearly fallen in the last 3 months"
const URGENCY_WORD = { today: 'Today, the same day', now: 'Now' };
// The published noise figures that the engine's placeholder MDCs fall short of
// (docs/WEARABLES.md, "Our placeholder MDCs"). Words only: the placeholder still judges the row.
const PUBLISHED_MDC = {
  tap_right: 'about 18 taps per 10 s, provisional (WatchALS, computed in docs/WEARABLES.md)',
  tap_left: 'about 18 taps per 10 s, provisional (WatchALS, computed in docs/WEARABLES.md)',
  reading: '22 to 31 words a minute (WatchALS: 22.1 in ALS, 31.3 in controls)',
};
const APPLE_STEPS_URL = 'https://support.apple.com/en-ca/guide/iphone/iph5ede58c3d/ios'; // Apple Support, "Share your data in Health on iPhone"
const LEAD_S = 3; // the 3-2-1 before a recording; that part of the sound is dropped
const MIC = {
  ddk_rate: { task: 'ddk', seconds: 10, stop: false },
  mpt: { task: 'mpt', seconds: 40, stop: true },
  single_breath_count: { task: 'sbc', seconds: 40, stop: true },
  pause_pct: { task: 'reading', seconds: 90, stop: true },
};
const COUNT_S = 30; // the 30-second chair stand
const HR_SAVE_MS = 60000; // a heart rate strap sends about one reading a second: save one a minute
const KIND_WORD = { mic: 'Microphone', typing: 'Typing', stopwatch: 'Stopwatch', count: 'Counting', questionnaire: 'Questions', manual: 'Typed in' };
const CADENCE_WORD = { weekly: 'Weekly', every2weeks: 'Every 2 weeks', monthly: 'Monthly' };
const FEEDS_WORD = {
  'engine-candidate': 'A candidate for the indicator; not counted yet',
  context: 'Context only: never counts toward the score',
  'clinician-prompt': 'A prompt for the care team, not a score',
};
const GRADE_WORD = { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', 'not studied': 'Not studied', contradicted: 'Contradicted' };
const VERDICT_WORD = { detects: 'Could flag (via a clinician)', monitors: 'Monitors', context: 'Context only', 'no use': 'No use' };
const WALK = [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']];
const SOURCES_TO_REMOVE = [
  ['apple-health', 'Apple Health'], ['csv', 'CSV files'], ['manual', 'typed-in readings'], ['bluetooth', 'Bluetooth readings'],
];
// How units read beside a number. A count or a questionnaire score reads best as the bare number.
const UNIT_TEXT = { degC: '°C', '% predicted': '% of predicted', count: '', score: '' };
// A plan signal that a Monitoring page test also records (rfn.homeResults), for "last done".
const LEGACY_SIGNAL = { weight: 'weight' };

// ---------- small helpers (pure) ----------
const list = (x) => (Array.isArray(x) ? x : []);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const TESTS = () => (catalog.TESTS && typeof catalog.TESTS === 'object' ? catalog.TESTS : {});
const SIGNALS = () => (catalog.SIGNALS && typeof catalog.SIGNALS === 'object' ? catalog.SIGNALS : {});
const fixed = (v, d = 1) => (isNum(v) ? v.toFixed(d) : '–');
const round = (v, d) => (isNum(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
// 4 significant figures, no trailing zeros: 0.5, 12, 1.25
const short = (v) => (isNum(v) ? String(Number(v.toPrecision(4))) : '–');
function signed(v, d = 1) {
  if (!isNum(v)) return '–';
  const a = Math.abs(v).toFixed(d);
  return Number(a) === 0 ? a : `${v > 0 ? '+' : '−'}${a}`;
}
function withUnit(text, unit) {
  const u = UNIT_TEXT[unit] ?? unit ?? '';
  if (!u) return text;
  return u.startsWith('%') ? `${text}${u}` : `${text} ${u}`;
}
const unitText = (unit) => UNIT_TEXT[unit] ?? unit ?? '';
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return String(url || ''); }
}
// Only web addresses become links; anything else is shown as text.
function linkTo(url, label) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return u ? esc(u) : '';
  return `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(label || hostOf(u))}</a>`;
}
const sourcesHtml = (urls) => list(urls).map((u) => linkTo(u)).filter(Boolean).join(', ');
const validDay = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
function framed() {
  try { return typeof window !== 'undefined' && window.self !== window.top; } catch { return true; }
}
const chip = (cls, word, title = '') => `<span class="chip${cls ? ` ${cls}` : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(word)}</span>`;
const CHIP_HTML = {
  simulated: () => simChip(),
  imported: () => chip('', CHIP_WORDS.imported, 'From a device or a file you brought in'),
  entered: () => chip('', CHIP_WORDS.entered, 'A device reading typed in by hand'),
  real: () => chip('real', CHIP_WORDS.real, 'A test done here'),
  context: () => chip('', CHIP_WORDS.context, 'Never counts toward the score'),
  experimental: () => chip('assume', CHIP_WORDS.experimental, 'Our own timing tool, not yet validated'),
  assumption: () => assumeChip(),
};
const chipsHtml = (ids) => list(ids).map((c) => (CHIP_HTML[c] ? CHIP_HTML[c]() : '')).join('');
const labelOf = (kind, id) => (kind === 'signal' ? SIGNALS()[id]?.label : TESTS()[id]?.label) || SIGNALS()[id]?.label || TESTS()[id]?.label || id;
const msgHtml = (text) => `<p class="hp-msg" role="status">${esc(text)}</p>`;
// A full stop, unless the text already ends a sentence.
const stop = (text) => { const t = String(text ?? '').trim(); return /[.!?)]$/.test(t) ? t : `${t}.`; };
// "Weight down 5%" -> "weight down 5%" and "A swallowing score" -> "a swallowing score" inside a
// sentence; "EAT-10 of 8" and "ALS" stay as written.
const lowerFirst = (text) => { const t = String(text ?? '').trim(); return /^([A-Z][a-z]|A\s)/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
const isText = (x) => typeof x === 'string' && x.trim() !== '';
const isSim = (x) => Boolean(x) && (x.simulated === true || x.source === 'demo' || x.demoDate === true);
// A calendar date n days on (or back), never shifted by time zone.
function addDays(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(t) ? null : new Date(t + n * 86400000).toISOString().slice(0, 10);
}

// ---------- dates the data is cut at ----------
// Data counts up to the visit picked in the top bar; at the latest visit, results after
// it count too (up to today), because the tests are meant for between visits.
export function cutDateOf(visitDates, asOf, today) {
  const v = list(visitDates).filter(validDay).sort();
  const a = validDay(asOf) ? asOf : null;
  if (!v.length || !a || a >= v[v.length - 1]) return a && a > today ? a : today;
  return a;
}
// Your data and imports start 12 weeks before the case's first visit (or 12 weeks before
// today when there is no visit yet), so an old history cannot set the baseline. The start
// is the Monday of that week: summary.js keeps whole weeks, so imports and Your data agree.
export function importSince(visitDates, today) {
  const first = list(visitDates).filter(validDay).sort()[0] || (validDay(today) ? today : null);
  return first ? weekStart(addDays(first, -7 * HISTORY_WEEKS)) : null;
}
export const sinceWords = (since, hasVisits) => `${fmtDate(since)} (${HISTORY_WEEKS} weeks before ${hasVisits ? 'the first visit' : 'today, as there is no visit yet'})`;
// Your data: the summary from since up to the cut date (summarize leaves out the weeks before since).
export function regionsFor({ snap, cut, since, person, legacyPerson, includeDemo = false, measuredMdc } = {}) {
  const s = snap || {};
  try {
    return summarize({
      results: s.results, samples: s.samples, legacyResults: s.legacy, legacyPerson,
      catalog, asOf: cut, since, person, includeDemo, demo: s.demo, measuredMdc,
    });
  } catch (e) {
    console.error(e);
    return [];
  }
}
// How many of this case's shown items are dated before since: they stay saved, but Your data starts at since.
export function countBefore({ results = [], samples = [], legacy = [], demo = null } = {}, since, { person, legacyPerson = '', includeDemo = false } = {}) {
  if (!since) return 0;
  const old = (d) => Boolean(d) && d < since;
  const shown = (x) => x && (includeDemo || !isSim(x));
  const mine = (x) => shown(x) && x.person === person;
  return list(results).filter((r) => mine(r) && old(calendarDate(r.date))).length
    + list(samples).filter((s) => mine(s) && old(calendarDate(s.start))).length
    + list(legacy).filter((r) => shown(r) && !r.calibration && (r.person || '') === legacyPerson && old(calendarDate(r.date))).length
    + (demo && includeDemo ? list(demo.results).filter((r) => old(calendarDate(r && r.date))).length + list(demo.samples).filter((s) => old(calendarDate(s && s.start))).length : 0);
}
// CSV readings before they are stored: each is saved for the open case (a person column in
// the file is replaced), and readings from before since are left out.
export function prepareCsv(samples, { person, since } = {}) {
  let old = 0;
  const others = new Set();
  const out = [];
  for (const s of list(samples)) {
    if (!s || typeof s !== 'object') continue;
    const d = calendarDate(s.start);
    if (since && (!d || d < since)) { old += 1; continue; }
    if (isText(s.person) && s.person !== person) others.add(s.person);
    out.push({ ...s, person });
  }
  return { samples: out, old, others: [...others] };
}

// ---------- situation ----------
// The visit's evaluation, judged at the data date (cut): between visits the 8-week window
// moves on, and a diagnosis after the last visit counts.
export function situationAt({ caseFile, ev, cut, opts, answers = {} } = {}) {
  let s = null;
  try {
    if (typeof protocol.situationFrom === 'function' && ev) s = protocol.situationFrom({ caseFile, asOf: cut, evaluation: ev, opts, answers });
  } catch (e) { console.error(e); }
  if (!s || typeof s !== 'object') {
    s = { stage: ev?.tier || 'low', tier: ev?.tier || 'low', diagnosed: false, affectedRegions: [], otherRegions: [], weekInWindow: null, canWalkSafely: null, reasons: [] };
  }
  // The protocol already weighs the answer; this keeps it when the protocol could not run.
  if (typeof answers.canWalkSafely === 'boolean' && typeof s.canWalkSafely !== 'boolean') s = { ...s, canWalkSafely: answers.canWalkSafely };
  return s;
}
// Weeks into the 8-week window: the protocol's count up to the data date, else the engine's at the visit.
export const windowWeeks = (ev, sit) => (isNum(sit?.weekInWindow) ? sit.weekInWindow : isNum(ev?.weeksUnclear) ? ev.weeksUnclear : null);

// ---------- profile: devices and the questions that shape the plan, per case ----------
// Kept in memory too, at module level, so the answers outlive a visit to another page when
// storage is blocked.
const profileMemory = new Map(); // case id -> profile
export const profileKey = (caseId) => `${PROFILE_KEY}:${caseId}`;
function extraQuestions() {
  return list(protocol.QUESTIONS).filter((q) => q && q.id && q.id !== 'canWalkSafely' && list(q.options).length);
}
export function loadProfile(caseId) {
  let p = profileMemory.get(caseId) || null;
  if (!p) {
    try { p = JSON.parse(globalThis.localStorage?.getItem(profileKey(caseId)) || 'null'); } catch { p = null; }
  }
  const ids = new Set(list(protocol.DEVICES).map((d) => d && d.id));
  const devices = list(p && p.devices).filter((d) => ids.has(d));
  const walk = p && WALK.some(([v]) => v === p.walk) ? p.walk : null;
  // The protocol's other optional questions (falls, walking aid, ...), kept by question id.
  const answers = {};
  for (const q of extraQuestions()) {
    const v = p && p.answers ? p.answers[q.id] : undefined;
    if (list(q.options).some((o) => o.value === v)) answers[q.id] = v;
  }
  return { devices, walk, answers };
}
export function saveProfile(caseId, p) {
  profileMemory.set(caseId, p);
  try { globalThis.localStorage?.setItem(profileKey(caseId), JSON.stringify(p)); } catch { /* storage blocked: kept in memory */ }
}
// Every case's answers go, and the one key all cases shared before.
export function clearProfiles() {
  profileMemory.clear();
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    const keys = [];
    for (let i = 0; i < ls.length; i += 1) {
      const k = ls.key(i);
      if (k === PROFILE_KEY || (typeof k === 'string' && k.startsWith(`${PROFILE_KEY}:`))) keys.push(k);
    }
    for (const k of keys) ls.removeItem(k);
  } catch { /* storage blocked: only the copies in memory existed */ }
}

// ---------- falls ----------
// The latest fall or near-fall of this person in the 91 days up to cut: a falls-question
// answer of 1 or more, a near-fall, or a fall recorded by a watch. null when there is none.
export function recentFall({ results = [], samples = [], person, cut, includeDemo = false } = {}) {
  const to = calendarDate(cut);
  if (!to) return null;
  const from = addDays(to, -FALLS_DAYS);
  let latest = null;
  const take = (d) => { if (d && d >= from && d <= to && (!latest || d > latest)) latest = d; };
  const mine = (x) => x && x.person === person && (includeDemo || !isSim(x));
  for (const r of list(results)) {
    if (!mine(r) || r.test !== 'falls_week') continue;
    const d = r.detail && typeof r.detail === 'object' ? r.detail : {};
    if ((isNum(r.value) && r.value >= 1) || d.nearFall === true || Number(d.nearFalls) > 0) take(calendarDate(r.date));
  }
  for (const s of list(samples)) {
    if (mine(s) && s.signal === 'falls' && isNum(s.value) && s.value >= 1) take(calendarDate(s.start));
  }
  return latest;
}
// What planFor and situationFrom read: the walking answer, the optional answers, and a fall
// or near-fall recorded in the last 3 months while the falls question has no answer.
export function answersOf(p, fall = null) {
  const a = { ...(p && p.answers) };
  if (p && p.walk === 'yes') a.canWalkSafely = true;
  else if (p && p.walk === 'no') a.canWalkSafely = false;
  if (fall && typeof a.fallsRecently !== 'boolean') a.fallsRecently = true;
  return a;
}
// A fall or near-fall just reported here replaces an earlier "No" to the falls question.
export function clearNoFalls(p, { value, nearFall } = {}) {
  const fell = (isNum(value) && value >= 1) || nearFall === true;
  if (!fell || !p || !p.answers || p.answers.fallsRecently !== false) return p;
  const answers = { ...p.answers };
  delete answers.fallsRecently;
  return { ...p, answers };
}

// ---------- questionnaires and red flags ----------
// picks: [{ qid, opt }], opt the index of the chosen option. answers keeps each score;
// chosen keeps the option itself, so a near-fall is not saved as "no falls".
export function scoreAnswers(entry, picks) {
  const qs = list(entry && entry.questions).filter((q) => q && q.id && list(q.options).length);
  const answers = {};
  const chosen = {};
  let score = 0;
  let nearFall = false;
  for (const p of list(picks)) {
    const q = qs.find((x) => x.id === (p && p.qid));
    const o = q && q.options[Number(p.opt)];
    if (!o || q.id in answers) continue;
    const s = isNum(Number(o.score)) ? Number(o.score) : 0;
    answers[q.id] = s;
    chosen[q.id] = o.label;
    score += s;
    if (o.nearFall === true) nearFall = true;
  }
  const detail = { answers, chosen };
  if (nearFall) detail.nearFall = true;
  return { score, answered: Object.keys(answers).length, total: qs.length, answers, detail };
}
// The red flags a saved result raises: the total at or above entry.redFlag.atLeast, and
// every question with a redFlag answered yes. Each flag once.
export function redFlagsFor(entry, { value, answers } = {}) {
  const out = [];
  const add = (f) => { if (f && isText(f.text) && !out.some((x) => x.text === f.text)) out.push(f); };
  const total = entry && entry.redFlag;
  if (total && isNum(total.atLeast) && isNum(value) && value >= total.atLeast) add(total);
  for (const q of list(entry && entry.questions)) {
    if (q && q.id && q.redFlag && answers && Number(answers[q.id]) >= 1) add(q.redFlag);
  }
  return out;
}
// A box screen readers announce: each flag with its urgency in words and its source.
export function alertHtml(flags, title = '') {
  const fs = list(flags).filter((f) => f && isText(f.text));
  if (!fs.length) return '';
  const items = fs.map((f) => `<li>${URGENCY_WORD[f.urgency] ? `<b>${esc(URGENCY_WORD[f.urgency])}:</b> ` : ''}${esc(f.text)}${f.source ? ` <span class="note">Source: ${linkTo(f.source, f.sourceLabel)}</span>` : ''}</li>`).join('');
  return `<div class="hp-alert" role="alert">${title ? `<h3>${esc(title)}</h3>` : ''}<ul>${items}</ul></div>`;
}
// The plan's "act now" list, shown first in the plan.
export const actNowHtml = (actNow) => alertHtml(actNow, 'Act on this first');

// ---------- small pieces of markup ----------
// "Not validated" and "Context only", from the catalogue entry.
export const entryChipsHtml = (t) => `${t && t.implementation === 'experimental' ? CHIP_HTML.experimental() : ''}${t && t.feeds === 'context' ? CHIP_HTML.context() : ''}`;
// One "If ..., then ..." line. An app rule says so: it is built on a guideline, not one.
export function triggerHtml(t) {
  const src = t && t.source ? ` <span class="note">${t.basis === 'our rule' ? 'Our rule, built on: ' : 'Source: '}${linkTo(t.source, t.sourceLabel)}</span>` : '';
  return `<li><b>If</b> ${esc(lowerFirst(t.if))}, <b>then</b> ${esc(stop(lowerFirst(t.then)))}${src}</li>`;
}
export function lastText(last, decimals = 1) {
  if (!last) return 'Not done yet';
  const v = isNum(last.value2) ? `${fixed(last.value, 0)}/${fixed(last.value2, 0)}` : fixed(last.value, decimals);
  return `Last ${esc(fmtDate(last.date))}: ${esc(withUnit(v, last.unit))}${last.practice ? ' (practice)' : ''}`;
}
// "Last done" with the Simulated chip when the value is simulated.
export const lastHtml = (last, decimals = 1) => `${lastText(last, decimals)}${last && last.simulated ? ` ${simChip()}` : ''}`;
// The Alex note above Your data. "Never did home tests" only while he has no results of his own.
export function alexNoteHtml(includeHome, ownResults) {
  if (includeHome) return `<p class="note">Alex's simulated weekly data is on (Home data in the top bar). It is labelled ${simChip()} and never mixed with real results.</p>`;
  return ownResults
    ? '<p class="note">Alex\'s simulated weekly data is off. <button type="button" class="btn sm" data-act="home-on">Turn on Home data</button> to show it, labelled Simulated, beside the results saved in this browser.</p>'
    : '<p class="note">Alex never did home tests. <button type="button" class="btn sm" data-act="home-on">Turn on Home data</button> to see simulated weekly data, labelled Simulated.</p>';
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}

// The noise figure in words, with its source.
function mdcWords(m, unit) {
  if (!m || typeof m !== 'object' || !isNum(m.value)) return 'No published noise figure yet';
  const rel = m.unit && /%|percent/i.test(m.unit) && m.unit !== unit;
  const size = rel ? `${short(m.value)}% of your baseline` : withUnit(short(m.value), m.unit || unit);
  const text = m.text ? esc(m.text) : `A change smaller than ${esc(size)} is within normal test-to-test variation`;
  const who = m.population ? ` (${esc(m.population)})` : '';
  const ours = m.computedByUs ? ' Worked out by us from the published figures.' : '';
  const src = m.source ? ` Source: ${linkTo(m.source)}.` : '';
  return `${text}${who}.${ours}${src}`;
}
const evidenceChip = (t) => {
  const g = t.evidence && t.evidence.grade;
  return g ? chip('', `Evidence: ${GRADE_WORD[g] || g}`, t.evidence.text || '') : '';
};

// ---------- the noise figure of a data row ----------
// Who the MDC was measured in (mostly people without ALS), from the catalogue entry.
const mdcPopulation = (row) => (row && row.mdcInfo && isText(row.mdcInfo.population) ? row.mdcInfo.population.trim() : '');
// The note codes summary.js uses; any other text in row.mdcNote is printed as it is.
const NOTE_CODES = new Set(['', 'none', 'pending', 'unit', 'relative', 'placeholder', 'measured']);
function mdcNoteWords(row) {
  const n = row.mdcNote;
  if (n === 'placeholder') return PUBLISHED_MDC[row.id] ? `placeholder; published: ${PUBLISHED_MDC[row.id]}` : 'placeholder';
  if (n === 'measured') return 'measured by the team';
  return isText(n) && !NOTE_CODES.has(n) ? n.trim() : '';
}
// "±0.28 m/s (placeholder)" and the population, as text.
export function mdcText(row) {
  const d = row.decimals;
  const pop = mdcPopulation(row);
  if (!row.mdc) {
    // A share-of-baseline MDC (grip) waits for the baseline.
    if (row.mdcNote === 'pending' && isNum(row.mdcInfo?.value)) return { size: `${short(row.mdcInfo.value)}% of baseline, once the baseline is set`, population: pop };
    return { size: 'none published yet', population: '' };
  }
  // A share-of-baseline MDC (grip) is shown in the measure's unit, with the share it came from.
  const share = row.mdcNote === 'relative' && isNum(row.mdcInfo?.value) ? ` (${short(row.mdcInfo.value)}% of baseline)` : '';
  const mdcSize = row.mdcNote === 'relative' ? fixed(row.mdc, d) : short(row.mdc);
  const words = mdcNoteWords(row);
  return { size: `${withUnit(`±${mdcSize}`, row.unit)}${share}${words ? ` (${words})` : ''}`, population: pop };
}

// ---------- the small chart ----------
// One measure's weekly values against its own baseline, the band = baseline ± MDC.
function miniChart(row) {
  const pts = row.weekly;
  // A span, not a div: the chart sits inside a button.
  if (!pts.length) return '<span class="hp-chart-empty note">No weekly values yet</span>';
  const W = 300; const H = 116; const L = 40; const R = 10; const T = 10; const B = 20;
  const pw = W - L - R; const ph = H - T - B;
  const tt = (w) => Date.parse(`${w}T00:00:00Z`);
  const t0 = tt(pts[0].week); const t1 = tt(pts[pts.length - 1].week);
  const x = (w) => (t1 > t0 ? L + ((tt(w) - t0) / (t1 - t0)) * pw : L + pw / 2);
  const base = row.baseline ? row.baseline.value : null;
  const mdc = row.mdc;
  const vals = pts.map((p) => p.value);
  if (base !== null) vals.push(base);
  // Counts, scores and most measures cannot go below 0, so neither does their axis.
  const floor0 = vals.every((v) => v >= 0);
  if (base !== null && mdc) vals.push(base - mdc, base + mdc);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!(hi > lo)) { const pad = mdc || Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const step = niceStep((hi - lo) / 3);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (floor0 && lo < 0) lo = 0;
  if (!(hi > lo)) hi = lo + step;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
  const yIn = (v) => Math.min(T + ph, Math.max(T, y(v))); // kept inside the plot
  const f1 = (n) => n.toFixed(1);
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  let g = '';
  for (let v = lo; v <= hi + step / 1000; v += step) {
    g += `<line class="hp-grid" x1="${L}" x2="${L + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="hp-tick" x="${L - 6}" y="${f1(y(v) + 3.5)}" text-anchor="end">${v.toFixed(dec)}</text>`;
  }
  const ends = pts.length > 1 ? [[pts[0], 'start'], [pts[pts.length - 1], 'end']] : [[pts[0], 'middle']];
  for (const [p, anchor] of ends) g += `<text class="hp-tick" x="${f1(x(p.week))}" y="${H - 5}" text-anchor="${anchor}">${esc(fmtDate(p.week))}</text>`;
  let bands = '';
  if (base !== null) {
    if (mdc) bands += `<rect class="hp-band" x="${L}" y="${f1(yIn(base + mdc))}" width="${pw}" height="${f1(Math.max(1, yIn(base - mdc) - yIn(base + mdc)))}"/>`;
    bands += `<line class="hp-base" x1="${L}" x2="${L + pw}" y1="${f1(y(base))}" y2="${f1(y(base))}"/>`;
  }
  const first = (row.practiceWeeks || 0) + 2;
  const decline = row.assessment && row.assessment.firstDecline ? row.assessment.firstDecline.week : null;
  const worse = (v) => (row.higherIsBetter ? base - v : v - base);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(x(p.week))},${f1(y(p.value))}`).join('');
  let marks = pts.length > 1 ? `<path class="hp-line" d="${path}"/>` : '';
  pts.forEach((p, i) => {
    const out = base !== null && mdc && i >= first && worse(p.value) > mdc;
    const cls = p.week === decline ? ' confirm' : out ? ' worse' : '';
    marks += `<circle class="hp-pt${cls}" cx="${f1(x(p.week))}" cy="${f1(y(p.value))}" r="${p.week === decline ? 4.5 : 3.5}"/>`;
  });
  const d = row.decimals;
  const pop = mdc ? mdcPopulation(row) : '';
  const summary = `${row.label}: ${plural(pts.length, 'weekly value')} from ${fixed(pts[0].value, d)} to ${withUnit(fixed(pts[pts.length - 1].value, d), row.unit)}`
    + `${base !== null ? `, baseline ${fixed(base, d)}` : ''}${mdc ? `, normal variation ±${short(mdc)}${pop ? ` (measured in: ${pop})` : ''}` : ''}. ${stop(row.status.word)}`;
  return `<svg class="hp-svg tone-${row.simulated ? 'sim' : 'real'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(summary)}">${bands}${g}${marks}</svg>`;
}

function valuesTable(row, id) {
  if (!row.weekly.length) {
    const why = row.status && row.status.detail ? ` ${row.status.detail}` : '';
    return `<div class="hp-vals" id="${id}" hidden><p class="note">No weekly values yet.${esc(why)}</p></div>`;
  }
  const d = row.decimals;
  const base = row.baseline ? row.baseline.value : null;
  const two = row.weekly2 && row.weekly2.length;
  const second = two ? new Map(row.weekly2.map((w) => [w.week, w.value])) : null;
  const rows = row.weekly.slice().reverse().map((w) => `<tr><td>${esc(fmtDate(w.week))}</td><td class="num">${fixed(w.value, d)}</td>${two ? `<td class="num">${second.has(w.week) ? fixed(second.get(w.week), d) : '–'}</td>` : ''}<td class="num">${w.n}</td><td class="num">${base !== null ? signed(w.value - base, d) : '–'}</td></tr>`).join('');
  return `<div class="hp-vals" id="${id}" hidden><div class="table-wrap"><table class="tbl"><thead><tr><th>Week of</th><th class="num">${esc(two ? 'Top number' : unitText(row.unit) || 'Value')}</th>${two ? '<th class="num">Bottom number</th>' : ''}<th class="num">Readings</th><th class="num">vs baseline</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

// One measure under "Your data by body region". open: its values table is shown.
export function rowHtml(row, i, open = false) {
  const d = row.decimals;
  const vid = `hp-v-${i}`;
  // Blood pressure shows both numbers, top/bottom, for the latest week.
  const low = row.latest && row.weekly2 ? row.weekly2.find((w) => w.week === row.latest.week) : null;
  const latest = row.latest ? withUnit(low ? `${fixed(row.latest.value, d)}/${fixed(low.value, d)}` : fixed(row.latest.value, d), row.unit) : '–';
  const base = row.baseline ? withUnit(fixed(row.baseline.value, d), row.unit) : 'not set yet';
  const slope = isNum(row.slope) ? `${withUnit(signed(row.slope, Math.max(d, 1)), row.unit)} a month` : 'needs 3 weeks';
  const m = mdcText(row);
  const pop = m.population ? ` <span class="hp-pop">(measured in: ${esc(m.population)})</span>` : '';
  const note = row.legacy ? '<span class="note">From the Monitoring page tests.</span>' : '';
  const bp = row.weekly2 ? '<span class="note">Chart: the top number (systolic).</span>' : '';
  return `<div class="hp-row">
      <div class="hp-row-main">
        <div class="hp-row-title"><b>${esc(row.label)}</b>${chipsHtml(row.chips)}</div>
        <p class="hp-verdict ${esc(row.status.cls)}"><b>${esc(stop(row.status.word))}</b> ${esc(row.status.detail)}</p>
        <div class="hp-nums"><span>Latest week <b class="mono">${esc(latest)}</b></span><span>Baseline <b class="mono">${esc(base)}</b></span><span>Trend <b class="mono">${esc(slope)}</b></span><span>Normal variation <b class="mono">${esc(m.size)}</b>${pop}</span></div>
        ${note}${bp}${row.practice ? `<span class="note">${plural(row.practice, 'practice run')} not counted.</span>` : ''}
      </div>
      <button type="button" class="hp-chart" data-act="vals" data-key="${esc(row.key)}" aria-expanded="${open}" aria-controls="${vid}">${miniChart(row)}<span class="hp-chart-cap">${open ? 'Hide the values' : 'Show the values'}</span></button>
    </div>${valuesTable(row, vid).replace(' hidden>', open ? '>' : ' hidden>')}`;
}

// ---------- what actually detects anything ----------
export function verdictsHtml(verdicts) {
  const v = list(verdicts).filter((x) => x && x.item);
  const rows = v.map((x) => `<tr><td><b>${esc(x.item)}</b></td><td>${esc(REGION_LABEL[x.region] || x.region || '')}</td><td>${chip(x.verdict === 'detects' ? 'real' : '', VERDICT_WORD[x.verdict] || x.verdict || '–')}</td><td>${esc(GRADE_WORD[x.grade] || x.grade || '–')}</td><td>${esc(x.why || '')}</td><td>${sourcesHtml(x.sources) || '–'}</td></tr>`).join('');
  return `<div class="section-head"><h2>What actually detects anything</h2><span class="aside">Could flag, monitors, or context only</span></div>
      <p class="hp-lede">Nothing measured at home has been shown to detect undiagnosed ALS; every study enrolled people already diagnosed. <b>Could flag</b> means it can help a clinician document a red flag or progression before diagnosis.</p>
      ${v.length ? `<div class="table-wrap"><table class="tbl hp-verdict-tbl"><thead><tr><th>Item</th><th>Region</th><th>Verdict</th><th>Evidence</th><th>Why</th><th>Sources</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="card card-pad"><p class="note">The verdict table is not filled in yet.</p></div>'}
      <p class="note hp-gap">The full list of phone and wearable signals is on the <a href="#monitoring">Monitoring</a> page.</p>`;
}

// ---------- Bluetooth ----------
// Connect and Disconnect are drawn once; each reading rewrites only the live text beside them.
export const btKindHtml = (kind, label) => `<div class="hp-bt-kind"><div class="row hp-actions"><button type="button" class="btn" data-act="bt-connect" data-kind="${esc(kind)}">Connect a ${esc(label)}</button><button type="button" class="btn sm" data-act="bt-off" data-kind="${esc(kind)}" hidden>Disconnect</button></div><div class="hp-bt-live note" data-bt="${esc(kind)}" aria-live="polite"></div></div>`;
export const btStatusHtml = (st) => `${esc(st.status)}${st.last ? `<br>Latest: <b class="mono">${esc(st.last)}</b>` : ''}${st.saved ? `<br>${plural(st.saved, 'reading')} saved.` : ''}`;

// ---------- export ----------
// This case's readings and results only, as CSV in the generic format csv.js reads back.
export function exportCsv(person) {
  const results = getResults({ person }).map((r) => {
    const detail = { ...(r.detail && typeof r.detail === 'object' && !Array.isArray(r.detail) ? r.detail : {}), resultId: r.id };
    if (r.practice) detail.practice = true;
    return { signal: r.test, start: r.time ? `${r.date}T${r.time}` : r.date, value: r.value, unit: r.unit, person: r.person, source: 'home-test', simulated: r.simulated === true, detail };
  });
  return samplesToCsv([...getSamples({ person }), ...results]);
}

// ---------- the view ----------
export function mount(root, ctx0) {
  ensureCss('css/views/homeplan.css');
  let ctx = ctx0;
  let dead = false;
  const runs = new Map(); // test id -> the test being run
  const cards = new Map(); // test id -> its card element (kept while the page is open)
  const openVals = new Set(); // rows whose values table is open
  const arms = new Map(); // two-click buttons waiting for the second click
  const bt = new Map(); // Bluetooth kind -> connection state
  let appleRun = null;
  let csvPending = null;
  let manualSignal = Object.keys(MANUAL_FIELDS)[0];
  let renderTimer = 0;
  let actNowShown = null; // the act-now box is redrawn only when it changes, so it is announced once
  // Messages in boxes that re-render when the data changes, so the answer to a click stays.
  const said = { demo: '', rm: '', handling: '' };
  const SAY_SLOT = { demo: '[data-demo-out]', rm: '[data-rm-out]', handling: '[data-handling-out]' };
  function say(slot, html) {
    said[slot] = html;
    const o = root.querySelector(SAY_SLOT[slot]);
    if (o) o.innerHTML = html;
  }

  // ---- who and when ----
  const personId = () => String(ctx.caseEntry?.id || 'case');
  const isAlex = () => ctx.caseEntry?.id === 'alex';
  const demoOn = () => isAlex() && ctx.state.includeHome === true;
  const visits = () => list(ctx.caseFile?.encounters).map((e) => e && e.date).filter(validDay).sort();
  // Data counts up to the visit picked in the top bar (up to today at the latest visit).
  // The situation, the due state and Your data all use this one date.
  const cutDate = () => cutDateOf(visits(), ctx.state.asOf, localDate());
  // Your data and imports start here: 12 weeks before the first visit.
  const sinceDate = () => importSince(visits(), localDate());
  const sinceText = () => sinceWords(sinceDate(), visits().length > 0);
  function whoName() {
    const e = ctx.caseEntry || {};
    if (e.kind === 'demo') return `Demo case: ${e.name || 'look-alike'}`;
    return String(ctx.caseFile?.patient?.name || e.name || 'This case').trim() || 'This case';
  }

  // ---- profile: this case's devices and answers (this browser only) ----
  const profile = () => loadProfile(personId());
  const keepProfile = (p) => saveProfile(personId(), p);

  // ---- situation and plan ----
  function evaluation() {
    if (!visits().length || !validDay(ctx.state.asOf)) return null;
    try { return evaluateAt(ctx.caseFile, ctx.state.asOf, ctx.opts); } catch (e) { console.error(e); return null; }
  }
  function planOf(sit, p, answers) {
    let plan = null;
    try {
      if (typeof protocol.planFor === 'function') plan = protocol.planFor(sit, { devices: p.devices, answers });
    } catch (e) { console.error(e); }
    const pl = plan && typeof plan === 'object' ? plan : {};
    return {
      headline: pl.headline || '', stage: pl.stage || sit.stage, actNow: list(pl.actNow),
      weekly: list(pl.weekly), every2weeks: list(pl.every2weeks), monthly: list(pl.monthly), passive: list(pl.passive),
      triggers: list(pl.triggers), safety: list(pl.safety), notes: list(pl.notes), failed: !plan,
    };
  }
  const planTestIds = (plan) => [...new Set([...plan.weekly, ...plan.every2weeks, ...plan.monthly]
    .filter((i) => i && i.kind !== 'signal' && TESTS()[i.id]).map((i) => i.id))];

  // ---- data ----
  function demoBundle() {
    if (!demoOn()) return null;
    let samples = [];
    let results = [];
    try { samples = list(typeof demoData.demoSamples === 'function' ? demoData.demoSamples('alex') : []); } catch (e) { console.error(e); }
    try { results = list(typeof demoData.demoResults === 'function' ? demoData.demoResults('alex') : []); } catch (e) { console.error(e); }
    return { samples, results };
  }
  function legacyResults() {
    try { return list(getLegacyResults()); } catch { return []; }
  }
  function legacyName() {
    try { return currentPerson(); } catch { return ''; }
  }
  // One read of the stores per render: a big import is copied once, not once per row.
  let snap = { results: [], samples: [], legacy: [], demo: null };
  function takeSnap() {
    snap = { results: getResults(), samples: getSamples(), legacy: legacyResults(), demo: demoBundle() };
  }
  // Your data starts at since (12 weeks before the first visit) and runs to the cut date.
  const regionsNow = () => regionsFor({
    snap, cut: cutDate(), since: sinceDate(), person: personId(), legacyPerson: legacyName(),
    includeDemo: demoOn(), measuredMdc: ctx.opts && ctx.opts.mdc,
  });
  // The latest fall or near-fall in the last 3 months (Alex's simulated ones while they are shown).
  function fallNow() {
    const demo = snap.demo;
    const mine = (x) => ({ ...x, person: personId(), simulated: true });
    return recentFall({
      results: [...snap.results, ...(demo ? demo.results.map(mine) : [])],
      samples: [...snap.samples, ...(demo ? demo.samples.map(mine) : [])],
      person: personId(), cut: cutDate(), includeDemo: demoOn(),
    });
  }

  // ---- markup: header and the situation strip ----
  root.innerHTML = `<div class="hp">
    <header class="view-head reveal">
      <div class="micro dot" id="hp-who"></div>
      <h1 class="title two-tone">Home plan <span class="soft">what to do this week, and the data that matters.</span></h1>
      <p class="lede">A short list of home tests picked from this case's situation, and the device data worth keeping. The tests run alongside a referral, never instead of it: a change can move a referral sooner, but a normal result never cancels one. Nothing here diagnoses ALS.</p>
    </header>
    <section class="reveal d1" id="hp-situation" aria-label="Situation"></section>
    <section class="section reveal d2" id="hp-plan"></section>
    <section class="section" id="hp-tests">
      <div class="section-head"><h2>Tests</h2><span class="aside">Tests in the plan first. Results stay in this browser.</span></div>
      <div class="hp-tests-list" id="hp-tests-plan"></div>
      <details class="hp-more" id="hp-more"><summary><span class="micro dot">More tests</span> <span class="note" id="hp-more-n"></span></summary><div class="hp-tests-list" id="hp-tests-more"></div></details>
    </section>
    <section class="section" id="hp-data"></section>
    <section class="section" id="hp-import"></section>
    <section class="section" id="hp-verdicts"></section>
    <section class="section" id="hp-handling"></section>
  </div>`;
  const $ = (sel) => root.querySelector(sel);

  function renderSituation(ev, sit, plan, p, fall) {
    $('#hp-who').textContent = `Home plan · ${whoName()}`;
    let stage;
    if (!visits().length) {
      stage = '<div class="micro">Stage</div><div class="hp-strip-v">No visits yet</div><div class="note">The plan starts from the red flags quoted in a visit note. Add a visit on the <a href="#cases">Cases</a> page.</div>';
    } else if (sit.stage === 'diagnosed' || sit.diagnosed) {
      const dx = ctx.caseFile?.actual?.diagnosis;
      stage = `<div class="micro">Stage</div><div class="hp-strip-v">${chip('', 'Diagnosed')}<span>${validDay(dx) ? `Diagnosis recorded ${esc(fmtDate(dx))}` : 'Diagnosis recorded'}</span></div><div class="note">${esc(plan.headline || 'The tests now track change for the care team.')}</div>`;
    } else {
      const tier = TIER[sit.stage] ? sit.stage : TIER[sit.tier] ? sit.tier : 'low';
      stage = `<div class="micro">Stage</div><div class="hp-strip-v">${tierChip(tier)}<span>${esc(TIER[tier].action)}</span></div><div class="note">${esc(plan.headline || TIER[tier].patient)}</div>`;
    }
    const regionNames = (ids) => list(ids).map((r) => REGION_LABEL[r] || r).join(', ');
    const regions = `<div class="micro">Affected regions</div><div class="hp-strip-v">${esc(regionNames(sit.affectedRegions) || 'None recorded yet')}</div>${list(sit.otherRegions).length ? `<div class="note">Not affected so far: ${esc(regionNames(sit.otherRegions))}.</div>` : ''}`;
    // The protocol counts the weeks up to the data date, so the window moves on between visits.
    const weeks = windowWeeks(ev, sit);
    // Only an Unclear case runs the window (a diagnosed case never does, whatever the score says).
    const win = sit.stage === 'unclear' && weeks !== null
      ? `<div class="micro">8-week window</div><div class="hp-strip-v">Week ${Math.min(UNCLEAR_DEADLINE_WEEKS, Math.floor(weeks) + 1)} of ${UNCLEAR_DEADLINE_WEEKS}</div><div class="note">${ev?.unclearSince ? `Unclear since ${esc(fmtDate(ev.unclearSince))}. ` : ''}A confirmed decline escalates at once; no decline by week ${UNCLEAR_DEADLINE_WEEKS} steps down.</div>`
      : `<div class="micro">8-week window</div><div class="hp-strip-v">Not running</div><div class="note">It runs only while the tier is Unclear.</div>`;
    // The protocol's reasons already quote the engine's; its own reason is the fallback.
    const reasons = list(sit.reasons).length ? list(sit.reasons) : [ev?.reason ? stop(ev.reason) : ''].filter(Boolean);
    const why = `<div class="micro">Why</div>${reasons.length ? reasons.map((r) => `<div class="note">${esc(r)}</div>`).join('') : '<div class="note">No visit to judge yet.</div>'}`;
    const devs = list(protocol.DEVICES).filter((d) => d && d.id).map((d) => `<label class="hp-check"><input type="checkbox" data-dev="${esc(d.id)}"${p.devices.includes(d.id) ? ' checked' : ''}> ${esc(d.label || d.id)}</label>`).join('');
    // A fall saved here counts as "yes" to the falls question until it is answered.
    const fallNote = (q) => (q.id === 'fallsRecently' && fall && typeof p.answers.fallsRecently !== 'boolean'
      ? `<div class="note">Counted as yes: a fall or near-fall was recorded on ${esc(fmtDate(fall))}.</div>` : '');
    const extraOpen = Boolean($('#hp-situation .hp-extra')?.open); // stays open when the strip is redrawn
    $('#hp-situation').innerHTML = `
      <div class="panel hp-strip">
        <div class="hp-strip-cell">${stage}</div>
        <div class="hp-strip-cell">${regions}</div>
        <div class="hp-strip-cell">${win}</div>
        <div class="hp-strip-cell">${why}</div>
      </div>
      <div class="card hp-profile">
        <div class="hp-profile-cell"><div class="micro">Devices you have</div><div class="hp-devs">${devs || '<span class="note">The device list is not available yet.</span>'}</div></div>
        <div class="hp-profile-cell"><div class="micro" id="hp-walk-l">Can you walk safely without help?</div>
          <div class="seg" role="group" aria-labelledby="hp-walk-l">${WALK.map(([v, w]) => `<button type="button" data-walk="${v}" aria-pressed="${p.walk === v}">${w}</button>`).join('')}</div>
          <div class="note">Both answers shape the plan. Saved in this browser only, for this case.</div>
          ${extraQuestions().length ? `<details class="hp-extra"${extraOpen ? ' open' : ''}><summary class="note">More questions that shape the plan (optional)</summary>${extraQuestions().map((q) => `<div class="hp-extra-q"><div class="hp-extra-t" id="hp-q-${esc(q.id)}">${esc(q.text)}</div><div class="seg" role="group" aria-labelledby="hp-q-${esc(q.id)}">${q.options.map((o, j) => `<button type="button" data-ans="${esc(q.id)}" data-opt="${j}" aria-pressed="${p.answers[q.id] === o.value}">${esc(o.label)}</button>`).join('')}</div>${fallNote(q)}</div>`).join('')}</details>` : ''}</div>
      </div>`;
  }

  // ---- this week's plan ----
  function lastFor(item) {
    const opts = { asOf: cutDate(), includeDemo: demoOn() };
    const who = personId();
    const demo = snap.demo;
    if (item.kind === 'signal') {
      const pool = [...snap.samples.filter((x) => x.person === who), ...(demo ? demo.samples.map((x) => ({ ...x, simulated: true })) : [])];
      const s = lastSample(pool, item.id, opts);
      let found = s ? { date: String(s.start).slice(0, 10), value: s.value, value2: s.value2, unit: s.unit, simulated: s.simulated === true || s.source === 'demo' } : null;
      // A weighing on the Monitoring page counts too (the same name filter as Your data).
      // A simulated one or one saved under a demo date counts only while demo data is shown.
      const test = LEGACY_SIGNAL[item.id];
      if (test) {
        const name = legacyName();
        const mine = snap.legacy.filter((r) => r && !r.calibration && (r.person || '') === name && (demoOn() || !isSim(r)))
          .map((r) => ({ test: r.test, date: r.date, time: r.time, value: r.value, simulated: isSim(r) }));
        const l = lastResult(mine, test, { asOf: opts.asOf });
        if (l && (!found || l.date >= found.date)) found = { date: l.date, value: l.value, unit: SIGNALS()[item.id]?.unit || '', simulated: l.simulated === true };
      }
      return found;
    }
    // The person's own latest result wins over a simulated one from the same day or earlier.
    const own = lastResult(snap.results.filter((x) => x.person === who && !x.simulated), item.id, opts);
    const sim = lastResult([...snap.results.filter((x) => x.person === who && x.simulated), ...(demo ? demo.results.map((x) => ({ ...x, simulated: true })) : [])], item.id, opts);
    const r = own && (!sim || own.date >= sim.date) ? own : sim;
    return r ? { date: r.date, value: r.value, unit: r.unit, practice: r.practice, simulated: r.simulated === true } : null;
  }
  function planItemHtml(item, cadence) {
    const t = TESTS()[item.id];
    const s = SIGNALS()[item.id];
    const label = labelOf(item.kind, item.id);
    const last = lastFor(item);
    // Due or done as of the same date the data is cut at.
    const due = dueState(last && last.date, cadence, cutDate());
    const dueChip = due.due ? chip('watch', due.word) : chip('low', due.word);
    const decimals = (item.kind === 'signal' ? s : t)?.decimals ?? 1;
    let action = '';
    if (item.kind !== 'signal' && t) action = `<button type="button" class="btn sm primary" data-act="open-test" data-test="${esc(item.id)}">Start</button>`;
    else if (item.kind === 'signal' && MANUAL_FIELDS[item.id]) action = `<button type="button" class="btn sm" data-act="goto-manual" data-signal="${esc(item.id)}">Add a reading</button>`;
    else if (item.kind === 'signal') action = '<button type="button" class="btn sm" data-act="goto-import">Bring in data</button>';
    const practice = item.practice ? '<span class="note">Start with practice runs: the first weeks are left out of the baseline.</span>' : '';
    const safety = list(item.safety).length ? `<ul class="hp-safety">${item.safety.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    // The same "Not validated" and "Context only" chips as the test cards.
    const chips = entryChipsHtml(item.kind === 'signal' ? s : t);
    return `<li class="hp-item">
      <div class="hp-item-main"><div class="hp-item-title"><b>${esc(label)}</b>${chips}</div>${item.why ? `<span class="hp-why">${esc(item.why)}</span>` : ''}${practice}${safety}</div>
      <div class="hp-item-side"><span class="note">${lastText(last, decimals)}</span>${last && last.simulated ? simChip() : ''}${dueChip}${action}</div>
    </li>`;
  }
  function renderPlan(sit, plan) {
    const groups = [
      ['This week', plan.weekly, 'weekly'],
      ['Every 2 weeks', plan.every2weeks, 'every2weeks'],
      ['This month', plan.monthly, 'monthly'],
    ].filter(([, items]) => items.length);
    const passive = plan.passive.map((p) => {
      const last = lastFor({ kind: 'signal', id: p.signal });
      const ctxChip = p.contextOnly === true ? CHIP_HTML.context() : '';
      return `<li class="hp-item"><div class="hp-item-main"><div class="hp-item-title"><b>${esc(labelOf('signal', p.signal))}</b>${ctxChip}</div>${p.why ? `<span class="hp-why">${esc(p.why)}</span>` : ''}${p.device ? `<span class="note">From: ${esc(list(protocol.DEVICES).find((d) => d && d.id === p.device)?.label || p.device)}</span>` : ''}</div>
        <div class="hp-item-side"><span class="note">${lastText(last, SIGNALS()[p.signal]?.decimals ?? 1)}</span>${last && last.simulated ? simChip() : ''}<button type="button" class="btn sm" data-act="goto-import">Bring in data</button></div></li>`;
    }).join('');
    const empty = !groups.length && !plan.passive.length;
    const tier = TIER[sit.stage] ? sit.stage : 'low';
    const instead = plan.failed
      ? 'The plan could not be worked out for this case right now. Use the tests below as you and your doctor agree.'
      : sit.stage === 'diagnosed' || sit.diagnosed
        ? 'No home tests are planned for this situation. Keep to the plan your care team gave you, and tell them about any change.'
        : `Nothing to do at home for this situation. ${ACTIONS[tier]?.patient?.next || ''}`;
    const groupHtml = groups.map(([title, items, cadence]) => `<div class="card hp-group"><div class="card-head"><h3>${esc(title)}</h3><span class="aside micro">${plural(items.length, 'item')}</span></div><ul class="hp-items">${items.map((i) => planItemHtml(i, cadence)).join('')}</ul></div>`).join('');
    const passiveHtml = plan.passive.length ? `<div class="card hp-group"><div class="card-head"><h3>Automatic</h3><span class="aside micro">From your devices</span></div><ul class="hp-items">${passive}</ul></div>` : '';
    const triggers = plan.triggers.length ? `<div class="card card-pad stack"><h3>If this happens</h3><ul class="hp-triggers">${plan.triggers.map(triggerHtml).join('')}</ul></div>` : '';
    const safety = plan.safety.length ? `<div class="card card-pad stack"><h3>Safety</h3><ul class="hp-safety">${plan.safety.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const notes = plan.notes.length ? `<div class="hp-notes">${plan.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}</div>` : '';
    // The act-now box comes first, right under the heading. It sits in its own slot and is
    // redrawn only when its words change, so a screen reader announces it once.
    const box = $('#hp-plan');
    if (!box.querySelector('[data-plan-body]')) {
      box.innerHTML = '<div data-plan-head></div><div data-actnow></div><div data-plan-body></div>';
      actNowShown = null;
    }
    box.querySelector('[data-plan-head]').innerHTML = `<div class="section-head"><h2>This week's plan</h2><span class="aside">${esc(plan.headline || '')}</span></div>`;
    const act = actNowHtml(plan.actNow);
    if (act !== actNowShown) { box.querySelector('[data-actnow]').innerHTML = act; actNowShown = act; }
    box.querySelector('[data-plan-body]').innerHTML = `${empty ? `<div class="card card-pad"><p>${esc(instead)}</p></div>` : `<div class="hp-groups">${groupHtml}${passiveHtml}</div>`}
      ${triggers || safety ? `<div class="grid cols-2 hp-gap">${triggers}${safety}</div>` : ''}${notes}`;
  }

  // ---- the tests ----
  function safeConfirm(t) {
    const none = list(t.safety).length ? '' : ' The catalogue lists no safety notes for this test yet.';
    return `<label class="hp-check hp-safe"><input type="checkbox" data-safe="${esc(t.id)}"> I have read the safety notes, and it is safe for me to do this test now.${none}</label>`;
  }
  function fieldHtml(inp) {
    if (inp.choices) {
      return `<label class="hp-field"><span>${esc(inp.label)}</span><select class="select" data-in="${esc(inp.key)}"><option value="">Choose</option>${inp.choices.map((c) => `<option value="${esc(c)}">${esc(c.charAt(0).toUpperCase() + c.slice(1))}</option>`).join('')}</select></label>`;
    }
    return `<label class="hp-field"><span>${esc(inp.label)}${inp.optional ? ' (optional)' : ''}</span><span class="hp-inline"><input type="number" class="hp-input hp-num" data-in="${esc(inp.key)}" min="${inp.min}" max="${inp.max}" step="${inp.step}" inputmode="decimal"> ${esc(inp.unitText || '')}</span></label>`;
  }
  function runnerHtml(t) {
    const id = esc(t.id);
    const stage = (big, hint) => `<div class="panel hp-stage"><div class="hp-big mono" data-big aria-live="polite">${esc(big)}</div><div class="hp-meter" aria-hidden="true"><span data-meter></span></div><div class="hp-hint" data-hint>${esc(hint)}</div></div>`;
    if (t.kind === 'mic') {
      const m = MIC[t.id];
      if (!m) return msgHtml('This app has no recorder for this test yet.');
      const sup = micSupport();
      // On an insecure page the reason already says what to do; a framed page gets LOCAL.
      const off = sup.ok ? '' : msgHtml(`${sup.reason}${framed() ? ` ${LOCAL}` : ''}`);
      const length = m.stop ? `Records for up to ${m.seconds} seconds after a 3, 2, 1 countdown. Press Stop when you are done.` : `Records for ${m.seconds} seconds after a 3, 2, 1 countdown.`;
      return `${off}${t.id === 'pause_pct' ? `<div class="micro">Read this aloud</div><blockquote class="hp-passage">${esc(PASSAGE)}</blockquote>` : ''}
        ${stage('Ready', `${length} Stay quiet during 3, 2, 1: the app listens to the room. The sound stays in this browser and is dropped once it is scored.`)}
        ${t.id === 'single_breath_count' ? '<p class="note hp-pace-note"><span class="hp-pacer" data-pacer aria-hidden="true"></span>While recording, the dot flashes twice a second: say one number with each flash (the "click" in the steps above). It is silent so the microphone hears only you.</p>' : ''}
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="mic-start" data-test="${id}"${sup.ok ? '' : ' disabled'}>Start</button><button type="button" class="btn" data-act="mic-stop" data-test="${id}" hidden>Stop</button><button type="button" class="btn quiet" data-act="mic-cancel" data-test="${id}" hidden>Cancel</button></div>
        <div data-out></div>`;
    }
    if (t.kind === 'typing') {
      return `<div class="micro">Copy this sentence</div><blockquote class="hp-passage" data-target></blockquote>
        <textarea class="hp-input hp-textarea" data-typing="${id}" rows="3" autocomplete="off" autocorrect="off" spellcheck="false" aria-label="Type the sentence here"></textarea>
        <p class="note" data-paste hidden>Pasting is turned off here: the test times your own key presses, so pasted text cannot count.</p>
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="typing-finish" data-test="${id}">Finish</button><button type="button" class="btn quiet" data-act="typing-new" data-test="${id}">Another sentence</button></div>
        <p class="note">What you type stays in this page's memory and is dropped once it is scored; only the timing is saved.</p>
        <div data-out></div>`;
    }
    if (t.kind === 'stopwatch') {
      const walk = t.id === 'timed_walk_speed';
      return `${safeConfirm(t)}${walk ? '<label class="hp-field"><span>Distance walked</span><span class="hp-inline"><input type="number" class="hp-input hp-num" data-dist min="1" max="100" step="0.5" value="10" inputmode="decimal"> metres</span></label>' : ''}
        ${stage('0.0 s', walk ? 'Press Start as you set off and Stop as you pass the end mark.' : 'Press Start as you begin and Stop as you finish.')}
        <div class="row hp-actions"><button type="button" class="btn primary hp-xl" data-act="sw-start" data-test="${id}" disabled>Start</button><button type="button" class="btn hp-xl" data-act="sw-stop" data-test="${id}" disabled>Stop</button></div>
        <div data-out></div>`;
    }
    if (t.kind === 'count') {
      return `${safeConfirm(t)}${stage('0', `Press Start. After 3, 2, 1 the ${COUNT_S} seconds begin. Press +1 for each stand, or have someone press it. You can correct the count at the end.`)}
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="cnt-start" data-test="${id}" disabled>Start</button><button type="button" class="btn hp-xl hp-plus" data-act="cnt-plus" data-test="${id}" disabled>+1</button></div>
        <div data-out></div>`;
    }
    if (t.kind === 'questionnaire') {
      const qs = list(t.questions).filter((q) => q && q.id && list(q.options).length);
      if (qs.length) {
        return `<div class="hp-q" data-q="${id}">${qs.map((q, i) => `<fieldset class="hp-q-item"><legend>${i + 1}. ${esc(q.text)}</legend><div class="hp-q-opts">${q.options.map((o, j) => `<label class="hp-opt"><input type="radio" name="hp-${id}-${esc(q.id)}" value="${j}" data-qid="${esc(q.id)}" data-score="${isNum(Number(o.score)) ? Number(o.score) : 0}"> ${esc(o.label)}</label>`).join('')}</div></fieldset>`).join('')}</div>
          <div class="hp-q-score mono" data-qscore>Score: – (0 of ${qs.length} answered)</div>
          ${t.licence ? `<p class="note">${esc(t.licence)}</p>` : ''}
          <div class="row hp-actions"><button type="button" class="btn primary" data-act="q-save" data-test="${id}" disabled>Save</button><button type="button" class="btn quiet" data-act="q-clear" data-test="${id}">Clear answers</button></div>
          <div data-out></div>`;
      }
      const src = sourcesHtml(t.evidence && t.evidence.sources);
      return `<p class="hp-msg">The questions are not shown here. ${t.licence ? esc(t.licence) : 'The catalogue does not include them yet.'}</p>
        ${src ? `<p class="note">Where to read about the validated form: ${src}.</p>` : ''}
        <label class="hp-field"><span>Your ${t.unit === 'score' ? 'score from the form' : 'number'}</span><span class="hp-inline"><input type="number" class="hp-input hp-num" data-qmanual min="0" step="1" inputmode="numeric"> ${esc(unitText(t.unit))}</span></label>
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="q-manual" data-test="${id}">Save</button></div>
        <div data-out></div>`;
    }
    if (t.kind === 'manual') {
      const f = MANUAL_FIELDS[t.id];
      if (!f) return msgHtml('This app has no entry form for this test yet.');
      return `<div class="hp-form">${f.inputs.map(fieldHtml).join('')}</div>
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="mt-save" data-test="${id}">Save</button></div>
        <div data-out></div>`;
    }
    return msgHtml('This app cannot run this kind of test yet.');
  }
  function cardHtml(t) {
    const id = esc(t.id);
    const instr = list(t.instructions).length ? `<h4>How to do it</h4><ol class="hp-steps">${t.instructions.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>` : '<p class="note">The catalogue has no instructions for this test yet.</p>';
    const safety = list(t.safety).length ? `<h4>Safety</h4><ul class="hp-safety">${t.safety.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    const ev = t.evidence || {};
    // "How often" follows the plan when the test is in it (placeCards), else the catalogue.
    const facts = `<div class="kv"><span>How often</span><span class="v" data-cadence>${esc(CADENCE_WORD[t.cadence] || t.cadence || '–')}</span></div>`
      + `<div class="kv"><span>Time</span><span class="v">${esc(isNum(t.minutes) ? `About ${plural(t.minutes, 'minute')}` : '–')}</span></div>`;
    return `<details class="card hp-test" id="hp-test-${id}" data-test="${id}">
      <summary class="hp-test-sum">
        <span class="hp-test-title"><span class="micro">${esc(REGION_LABEL[t.region] || t.region || '')} · ${esc(KIND_WORD[t.kind] || t.kind || '')}</span><b>${esc(t.label || t.id)}</b></span>
        <span class="hp-test-chips"><span data-inplan></span>${evidenceChip(t)}${entryChipsHtml(t)}</span>
        <span class="hp-test-last note" data-last="${id}"></span>
      </summary>
      <div class="hp-test-body">
        <div class="hp-test-info">
          <div>${instr}${safety}</div>
          <div class="stack">
            <div>${facts}</div>
            <div class="hp-fact"><div class="micro">Normal variation (MDC)</div><p>${mdcWords(t.mdc, t.unit)}</p></div>
            <div class="hp-fact"><div class="micro">Evidence</div><p>${esc(GRADE_WORD[ev.grade] || ev.grade || 'Not graded')}${ev.text ? `: ${esc(ev.text)}` : ''}${list(ev.sources).length ? ` Sources: ${sourcesHtml(ev.sources)}.` : ''}</p></div>
            ${t.feeds ? `<div class="hp-fact"><div class="micro">Counts toward</div><p>${esc(FEEDS_WORD[t.feeds] || t.feeds)}</p></div>` : ''}
          </div>
        </div>
        ${t.kind === 'questionnaire' ? '' : `<label class="hp-check"><input type="checkbox" data-practice="${id}"> Practice run: saved, but left out of the baseline</label>`}
        <div class="hp-walk-warn note" data-walkwarn role="note" hidden></div>
        <div class="hp-run" data-run="${id}">${runnerHtml(t)}</div>
      </div>
    </details>`;
  }
  // Cards are made once and moved, so a test that is running keeps going when the plan changes.
  for (const t of Object.values(TESTS())) {
    if (!t || !t.id) continue;
    const card = el(cardHtml(t));
    cards.set(t.id, card);
    if (t.kind === 'typing') newSentence(t.id, card);
  }
  // A card already in its place is left there, so a press inside it keeps its focus when the
  // page is redrawn after a save.
  function putAt(box, card, i) {
    if (box.children[i] !== card) box.insertBefore(card, box.children[i] || null);
  }
  function placeCards(plan, sit, p) {
    const inPlan = planTestIds(plan);
    const planBox = $('#hp-tests-plan');
    const moreBox = $('#hp-tests-more');
    planBox.querySelectorAll(':scope > p.note').forEach((n) => n.remove());
    inPlan.filter((id) => cards.has(id)).forEach((id, i) => putAt(planBox, cards.get(id), i));
    // Walking and chair tests carry a warning when walking is not safe, or not known to be.
    const walk = p.walk;
    const walkWarn = walk === 'no'
      ? 'You said you cannot walk safely without help. Read the safety notes first, and do not do this test alone.'
      : sit.canWalkSafely === false
        ? 'Falls, foot drop or a wheelchair are recorded for this case, so the plan leaves this test out. If you do it, read the safety notes first and never do it alone.'
        : walk === 'unsure'
          ? 'You are not sure you can walk safely without help. Read the safety notes first, and do this test only with someone beside you.'
          : '';
    const cadenceOf = new Map();
    for (const [items, c] of [[plan.weekly, 'weekly'], [plan.every2weeks, 'every2weeks'], [plan.monthly, 'monthly']]) {
      for (const i of items) if (i && i.id && !cadenceOf.has(i.id)) cadenceOf.set(i.id, c);
    }
    let more = 0;
    for (const [id, card] of cards) {
      const yes = inPlan.includes(id);
      if (!yes) { putAt(moreBox, card, more); more += 1; }
      const slot = card.querySelector('[data-inplan]');
      if (slot) slot.innerHTML = yes ? chip('real', 'In your plan') : '';
      const cad = card.querySelector('[data-cadence]');
      if (cad) {
        const c = (yes && cadenceOf.get(id)) || TESTS()[id]?.cadence;
        cad.textContent = `${CADENCE_WORD[c] || c || '–'}${yes && cadenceOf.has(id) ? ' (your plan)' : ''}`;
      }
      const leg = TESTS()[id]?.region === 'leg' && ['stopwatch', 'count'].includes(TESTS()[id]?.kind);
      const warn = card.querySelector('[data-walkwarn]');
      if (warn) {
        warn.hidden = !(leg && walkWarn);
        warn.textContent = leg ? walkWarn : '';
      }
    }
    if (!inPlan.length) planBox.innerHTML = '<p class="note">No tests in the plan for this situation. All tests are under More tests.</p>';
    $('#hp-more-n').textContent = plural(more, 'test');
    $('#hp-more').hidden = more === 0;
  }
  function renderLast() {
    for (const [id, card] of cards) {
      const slot = card.querySelector('[data-last]');
      if (slot) slot.innerHTML = lastHtml(lastFor({ kind: 'test', id }), TESTS()[id]?.decimals ?? 1);
    }
  }
  const cardOf = (id) => cards.get(id) || null;
  const runBox = (id) => cardOf(id)?.querySelector('[data-run]') || null;
  const setOut = (id, html) => { const o = runBox(id)?.querySelector('[data-out]'); if (o) o.innerHTML = html; };
  const big = (box, text) => { const b = box?.querySelector('[data-big]'); if (b) b.textContent = text; };
  const hint = (box, text) => { const h = box?.querySelector('[data-hint]'); if (h) h.textContent = text; };
  const meter = (box, level) => { const m = box?.querySelector('[data-meter]'); if (m) m.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%`; };
  const show = (box, act, on) => { const b = box?.querySelector(`[data-act="${act}"]`); if (b) b.hidden = !on; };
  const enable = (box, act, on) => { const b = box?.querySelector(`[data-act="${act}"]`); if (b) b.disabled = !on; };
  function clearRun(run) {
    if (!run) return;
    for (const t of run.timers || []) { clearTimeout(t); clearInterval(t); }
    run.timers = [];
  }
  function resultHtml(id, pending, extra = '') {
    const t = TESTS()[id] || {};
    const v = withUnit(fixed(pending.value, t.decimals ?? 1), pending.unit || t.unit);
    return `<div class="hp-result"><div class="hp-result-v"><span class="stat-s">${esc(v)}</span></div>${extra}
      <div class="row hp-actions"><button type="button" class="btn primary" data-act="save" data-test="${esc(id)}">Save</button><button type="button" class="btn" data-act="discard" data-test="${esc(id)}">Discard</button></div></div>`;
  }
  // A real result is always dated today. extra: html shown after the Saved line (a red flag).
  function saveFor(id, pending, extra = '') {
    const t = TESTS()[id] || {};
    const practice = Boolean(cardOf(id)?.querySelector('[data-practice]')?.checked);
    const r = addResult({
      test: id, date: localDate(), time: localTime(), value: pending.value, unit: pending.unit || t.unit,
      detail: pending.detail, practice, person: personId(),
    });
    if (!r || r.ok === false) { setOut(id, msgHtml(r?.reason || 'The result could not be saved.')); return; }
    const run = runs.get(id);
    if (run) run.pending = null;
    // A fall or near-fall reported now replaces an earlier "No" to the falls question.
    let cleared = '';
    if (id === 'falls_week') {
      const p = profile();
      const next = clearNoFalls(p, { value: pending.value, nearFall: pending.detail?.nearFall === true });
      if (next !== p) { keepProfile(next); cleared = ' Your earlier "No" to the falls question was cleared, so the plan counts this.'; }
    }
    // Data after the visit picked in the top bar is hidden, so say where the result went.
    const where = r.date > cutDate() ? 'It is dated after the visit picked in the top bar: pick the latest visit to see it under Your data.' : 'It shows under Your data below.';
    setOut(id, `<p class="hp-ok" role="status"><b>Saved</b> for ${esc(fmtDate(r.date))}${practice ? ' as a practice run, left out of the baseline' : ''}. ${esc(where)}${esc(cleared)}</p>${extra}`);
  }

  // microphone tests
  function micStart(id) {
    const m = MIC[id];
    const box = runBox(id);
    if (!m || !box) return;
    const sup = micSupport();
    if (!sup.ok) { setOut(id, msgHtml(`${sup.reason}${framed() ? ` ${LOCAL}` : ''}`)); return; }
    for (const [other, r] of runs) if (r.mic && !r.finished && other !== id) micCancel(other); // one microphone at a time
    const run = { mic: true, ac: new AbortController(), timers: [], phase: 'asking', cancelled: false, finished: false };
    runs.set(id, run);
    setOut(id, '');
    show(box, 'mic-start', false); show(box, 'mic-cancel', true); show(box, 'mic-stop', false);
    big(box, 'Wait');
    hint(box, 'If the browser asks, allow the microphone.');
    const total = LEAD_S + m.seconds;
    recordAudio({
      seconds: total,
      abortSignal: run.ac.signal,
      onStart: () => {
        if (runs.get(id) !== run || dead) return;
        run.phase = 'countdown';
        big(box, '3');
        hint(box, 'Get ready.');
        run.timers.push(setTimeout(() => big(box, '2'), 1000), setTimeout(() => big(box, '1'), 2000));
        run.timers.push(setTimeout(() => {
          run.phase = 'recording';
          cardOf(id)?.querySelector('[data-pacer]')?.classList.add('on');
          big(box, 'Go');
          hint(box, m.stop ? 'Recording. Press Stop when you are done.' : 'Recording.');
          if (m.stop) show(box, 'mic-stop', true);
        }, LEAD_S * 1000));
      },
      onLevel: ({ level, elapsedS }) => {
        if (runs.get(id) !== run || dead) return;
        meter(box, level);
        const rec = elapsedS - LEAD_S;
        if (run.phase === 'recording' && rec > 0.8) big(box, m.stop ? `${Math.floor(rec)} s` : `${Math.max(0, Math.ceil(m.seconds - rec))} s left`);
      },
    }).then((res) => micDone(id, run, res, m), () => micDone(id, run, { ok: false, reason: 'The recording could not run in this browser.' }, m));
  }
  function micCancel(id) {
    const run = runs.get(id);
    if (!run || !run.mic || run.finished) return;
    run.cancelled = true;
    run.ac.abort();
  }
  function micStop(id) {
    const run = runs.get(id);
    if (!run || !run.mic || run.finished) return;
    run.ac.abort(); // keeps what was recorded: it is scored below
  }
  function micDone(id, run, res, m) {
    run.finished = true;
    clearRun(run);
    cardOf(id)?.querySelector('[data-pacer]')?.classList.remove('on');
    if (runs.get(id) !== run || dead) return;
    const box = runBox(id);
    show(box, 'mic-start', true); show(box, 'mic-stop', false); show(box, 'mic-cancel', false);
    meter(box, 0);
    const recorded = run.phase === 'recording';
    if (run.cancelled || (res && res.aborted && !recorded)) {
      big(box, 'Ready');
      hint(box, 'Cancelled. Nothing was saved.');
      return;
    }
    const got = res && res.samples && res.samples.length && isNum(res.sampleRate);
    if (!res || (!res.ok && !(res.aborted && got))) {
      big(box, 'Ready');
      setOut(id, msgHtml(`${res?.reason || 'The recording did not work.'}${framed() ? ` ${LOCAL}` : ''}`));
      return;
    }
    const skip = Math.min(res.samples.length, Math.round(LEAD_S * res.sampleRate));
    const a = analyzeTask(m.task, res.samples.subarray(skip), res.sampleRate);
    res.samples = null; // the sound is dropped here: only the numbers are kept
    big(box, 'Done');
    hint(box, 'Scored. The recording itself has been dropped.');
    const flags = a.flags.length
      ? `<ul class="hp-flags">${a.flags.map((f, i) => `<li><b>${esc(f.charAt(0).toUpperCase() + f.slice(1))}.</b> ${esc(a.tips[i] || '')}</li>`).join('')}</ul>`
      : '<p class="note">Recording quality: no problems found.</p>';
    if (id === 'single_breath_count') {
      // The catalogue asks for the last number said; the voice count is the check.
      run.audio = a;
      setOut(id, `${a.ok ? `<p>The microphone heard about <b>${esc(String(a.value))}</b> numbers.</p>` : msgHtml(a.reason)}${a.flags.length ? flags : ''}
        <label class="hp-field"><span>The last number you said</span><input type="number" class="hp-input hp-num" data-lastnum min="0" max="200" step="1" inputmode="numeric" value="${a.ok ? esc(String(a.value)) : ''}"></label>
        <div data-cnt-msg></div>
        <div class="row hp-actions"><button type="button" class="btn primary" data-act="sbc-save" data-test="${esc(id)}">Save</button><button type="button" class="btn" data-act="discard" data-test="${esc(id)}">Discard</button></div>`);
      return;
    }
    if (!a.ok) { setOut(id, `${msgHtml(a.reason)}${a.flags.length ? flags : ''}`); return; }
    const detail = { flags: a.flags };
    for (const [k, v] of Object.entries(a.detail || {})) {
      if (isNum(v)) detail[k] = round(v, 3);
      else if (typeof v === 'boolean') detail[k] = v;
    }
    run.pending = { value: a.value, unit: a.unit || TESTS()[id]?.unit, detail };
    setOut(id, resultHtml(id, run.pending, flags));
  }

  // typing
  function newSentence(id, card = cardOf(id)) {
    if (!card) return;
    const prev = runs.get(id)?.target;
    const pool = PASSAGES.filter((p) => p !== prev);
    const target = pool[Math.floor(Math.random() * pool.length)] || PASSAGES[0];
    const old = runs.get(id);
    if (old && old.session) old.session.reset();
    runs.set(id, { typing: true, target, session: createTypingSession(target), pending: null });
    const q = card.querySelector('[data-target]');
    if (q) q.textContent = target;
    const ta = card.querySelector('[data-typing]');
    if (ta) ta.value = '';
    const o = card.querySelector('[data-out]');
    if (o) o.innerHTML = '';
  }
  function typingFinish(id) {
    const run = runs.get(id);
    const ta = runBox(id)?.querySelector('[data-typing]');
    if (!run || !run.session || !ta) return;
    const r = run.session.finish(ta.value);
    ta.value = ''; // the typed text is dropped here
    run.session.reset();
    if (!r.ok) { setOut(id, msgHtml(r.reason)); return; }
    const keys = ['durationS', 'ikiMedianMs', 'ikiIqrMs', 'ikiCvPct', 'pausesOver2s', 'longPauses', 'backspaces', 'errors', 'accuracyPct', 'correctChars'];
    const detail = {};
    for (const k of keys) if (isNum(r[k])) detail[k] = round(r[k], 2);
    run.pending = { value: round(r.charsPerMin, 1), unit: TESTS()[id]?.unit || 'characters/min', detail };
    const facts = `<div class="hp-facts-row">
      <div class="kv"><span>Speed</span><span class="v">${fixed(r.charsPerMin, 0)} characters a minute</span></div>
      <div class="kv"><span>Rhythm (middle gap between keys)</span><span class="v">${fixed(r.ikiMedianMs, 0)} ms</span></div>
      <div class="kv"><span>Rhythm spread (CV)</span><span class="v">${fixed(r.ikiCvPct, 0)}%</span></div>
      <div class="kv"><span>Accuracy</span><span class="v">${fixed(r.accuracyPct, 0)}% (${plural(r.errors, 'error')})</span></div></div>`;
    setOut(id, resultHtml(id, run.pending, facts));
  }

  // stopwatch tests
  function swStart(id) {
    const box = runBox(id);
    if (!box) return;
    const run = { sw: true, t0: performance.now(), timers: [] };
    runs.set(id, run);
    setOut(id, '');
    run.timers.push(setInterval(() => big(box, `${((performance.now() - run.t0) / 1000).toFixed(1)} s`), 100));
    enable(box, 'sw-start', false);
    enable(box, 'sw-stop', true);
  }
  function swStop(id) {
    const run = runs.get(id);
    const box = runBox(id);
    if (!run || !run.sw || run.t0 === null || !box) return;
    const s = (performance.now() - run.t0) / 1000;
    run.t0 = null;
    clearRun(run);
    big(box, `${s.toFixed(2)} s`);
    enable(box, 'sw-stop', false);
    enable(box, 'sw-start', Boolean(cardOf(id)?.querySelector('[data-safe]')?.checked));
    if (s < 1) { setOut(id, msgHtml('That was under a second. Press Start as you begin and Stop as you finish, then try again.')); return; }
    const t = TESTS()[id] || {};
    if (id === 'timed_walk_speed') {
      const d = Number(box.querySelector('[data-dist]')?.value);
      if (!(d > 0 && d <= 100)) { setOut(id, msgHtml('Enter the distance walked in metres, for example 10.')); return; }
      run.pending = { value: round(d / s, 3), unit: t.unit || 'm/s', detail: { distanceM: d, timeS: round(s, 2) } };
      setOut(id, resultHtml(id, run.pending, `<p class="note">${esc(short(d))} m in ${esc(s.toFixed(2))} s.</p>`));
      return;
    }
    run.pending = { value: round(s, 2), unit: t.unit || 's', detail: { timeS: round(s, 2) } };
    setOut(id, resultHtml(id, run.pending));
  }

  // the 30-second count
  function cntStart(id) {
    const box = runBox(id);
    if (!box) return;
    clearRun(runs.get(id));
    const run = { cnt: true, n: 0, phase: 'lead', timers: [] };
    runs.set(id, run);
    setOut(id, '');
    enable(box, 'cnt-start', false);
    big(box, '3');
    hint(box, 'Get ready.');
    run.timers.push(setTimeout(() => big(box, '2'), 1000), setTimeout(() => big(box, '1'), 2000));
    run.timers.push(setTimeout(() => {
      run.phase = 'run';
      run.left = COUNT_S;
      big(box, '0');
      hint(box, `${COUNT_S} s left`);
      enable(box, 'cnt-plus', true);
      box.querySelector('[data-act="cnt-plus"]')?.focus();
      run.timers.push(setInterval(() => {
        run.left -= 1;
        hint(box, `${run.left} s left`);
        if (run.left <= 0) cntEnd(id, run);
      }, 1000));
    }, LEAD_S * 1000));
  }
  function cntEnd(id, run) {
    clearRun(run);
    run.phase = 'done';
    const box = runBox(id);
    enable(box, 'cnt-plus', false);
    enable(box, 'cnt-start', Boolean(cardOf(id)?.querySelector('[data-safe]')?.checked));
    hint(box, 'Time is up.');
    setOut(id, `<div data-cnt-msg></div><label class="hp-field"><span>Final count (correct it if needed)</span><input type="number" class="hp-input hp-num" data-final min="0" max="200" step="1" value="${run.n}" inputmode="numeric"></label>
      <div class="row hp-actions"><button type="button" class="btn primary" data-act="cnt-save" data-test="${esc(id)}">Save</button><button type="button" class="btn" data-act="discard" data-test="${esc(id)}">Discard</button></div>`);
  }

  // questionnaires: each radio's value is its option's index in the catalogue
  function qScore(id) {
    const q = runBox(id)?.querySelector('[data-q]');
    if (!q) return null;
    const picks = [...q.querySelectorAll('input[type="radio"]:checked')].map((p) => ({ qid: p.dataset.qid, opt: Number(p.value) }));
    return scoreAnswers(TESTS()[id], picks);
  }
  function qUpdate(id) {
    const s = qScore(id);
    const box = runBox(id);
    if (!s || !box) return;
    const out = box.querySelector('[data-qscore]');
    if (out) out.textContent = `Score: ${s.answered === s.total ? s.score : '–'} (${s.answered} of ${s.total} answered)`;
    enable(box, 'q-save', s.answered === s.total && s.total > 0);
  }

  // ---- your data by body region ----
  function thresholdsHtml(regions, sit) {
    if (!(sit.stage === 'diagnosed' || sit.diagnosed)) return '';
    const th = list(catalog.THRESHOLDS);
    if (!th.length) return '<div class="card card-pad hp-gap"><h3>After diagnosis: what the data would prompt</h3><p class="note">The catalogue has no action thresholds yet.</p></div>';
    const checked = checkThresholds(regions, th);
    const met = checked.filter((c) => c.met === true);
    const notMet = checked.filter((c) => c.met === false).length;
    const unknown = checked.filter((c) => c.met === null).length;
    const words = (c) => {
      const w = c.threshold.when;
      const label = c.row ? c.row.label : labelOf(w.kind, w.id);
      // A rule that needs the last 2 (or more) weekly values says so.
      const weeks = Number.isInteger(w.consecutive) && w.consecutive > 1 ? `, ${w.consecutive} weeks in a row` : '';
      if (w.rule === 'pctDropFromBaseline') return `${label} is ${fixed(c.value, 1)}% below its baseline (rule: a drop of ${short(w.value)}% or more${weeks})`;
      const rule = { below: 'below', above: 'above', atLeast: 'at least' }[w.rule] || w.rule;
      return `${label} is ${withUnit(fixed(c.value, c.row?.decimals ?? 1), c.row?.unit)} (rule: ${rule} ${withUnit(short(w.value), w.unit)}${weeks})`;
    };
    const items = met.map((c) => `<li><div><b>${esc(c.threshold.action || '')}</b>${c.row && c.row.simulated ? ` ${simChip()}` : ''}</div><div class="note">${esc(words(c))}.${c.threshold.patient ? ` For the patient: ${esc(c.threshold.patient)}` : ''} Source: ${linkTo(c.threshold.source, c.threshold.sourceLabel)}</div></li>`).join('');
    return `<div class="card card-pad stack hp-gap"><h3>After diagnosis: what the data would prompt</h3>
      ${met.length ? `<ul class="hp-actions-list">${items}</ul>` : `<p>No action threshold is met by the data so far${unknown ? ', but some checks do not have enough data to judge' : ''}.</p>`}
      <p class="note">${plural(checked.length, 'check')}: ${met.length} met, ${notMet} not met, ${unknown} without enough data. These are prompts for the care team, not decisions.</p></div>`;
  }
  function renderData(sit) {
    const regions = regionsNow();
    let after = countAfter({ results: snap.results, samples: snap.samples, asOf: cutDate(), person: personId(), includeDemo: demoOn() });
    // Alex's simulated data from demo.js, unless a loaded copy of it was just counted.
    const loaded = snap.samples.some((s) => s.person === personId() && s.simulated) || snap.results.some((r) => r.person === personId() && r.simulated);
    if (snap.demo && !loaded) after += countAfter({ results: snap.demo.results, samples: snap.demo.samples, asOf: cutDate(), includeDemo: true });
    const notes = [];
    if (isAlex()) {
      // "Alex never did home tests" only while no result of his own is saved here.
      const own = snap.results.some((r) => r && r.person === 'alex' && !isSim(r));
      notes.push(alexNoteHtml(ctx.state.includeHome === true, own));
    }
    if (after) notes.push(`<p class="note">${plural(after, 'reading or result', 'readings or results')} dated after ${esc(fmtDate(cutDate()))} ${after === 1 ? 'is' : 'are'} not shown, because that is the visit picked in the top bar. Pick the latest visit to see ${after === 1 ? 'it' : 'them'}.</p>`);
    const before = countBefore(snap, sinceDate(), { person: personId(), legacyPerson: legacyName(), includeDemo: demoOn() });
    if (before) notes.push(`<p class="note">${plural(before, 'reading or result', 'readings or results')} from before ${esc(sinceText())} ${before === 1 ? 'is' : 'are'} left out here, so an old history cannot set the baseline. ${before === 1 ? 'It stays' : 'They stay'} saved in this browser.</p>`);
    const legacyWho = legacyName();
    if (regions.some((g) => g.rows.some((r) => r.legacy))) notes.push(`<p class="note">Tapping, reading, weight and walking results from the Monitoring page are included${legacyWho ? `, for the name ${esc(legacyWho)}` : ', for results saved without a name'}.</p>`);
    let i = 0;
    const body = regions.length
      ? regions.map((g) => `<div class="card hp-region"><div class="card-head"><h3>${esc(REGION_LABEL[g.region] || g.region)}</h3><span class="aside micro">${plural(g.rows.length, 'measure')}</span></div><div class="hp-rows">${g.rows.map((r) => rowHtml(r, i++, openVals.has(r.key))).join('')}</div></div>`).join('')
      : '<div class="card card-pad"><p>No home data for this case yet. Run a test above, or bring in device data below.</p></div>';
    $('#hp-data').innerHTML = `<div class="section-head"><h2>Your data by body region</h2><span class="aside">Weekly values against your own baseline</span></div>
      ${notes.join('')}<div class="stack">${body}</div>${thresholdsHtml(regions, sit)}`;
  }

  // ---- bring in device data ----
  function manualFieldsHtml() {
    const f = MANUAL_FIELDS[manualSignal];
    return f ? f.inputs.map(fieldHtml).join('') : '';
  }
  function btHtml() {
    const sup = bluetoothSupport();
    if (!sup.ok) return msgHtml(`${sup.reason}${framed() ? ` ${LOCAL}` : ''}`);
    return `<div class="hp-bt">${Object.entries(HEALTH_DEVICES).map(([k, d]) => btKindHtml(k, d.label)).join('')}</div>
      <p class="note">Each reading is saved as it arrives (heart rate once a minute). Readings stay in this browser.</p>`;
  }
  function renderImport() {
    const manualOpts = Object.entries(MANUAL_FIELDS).map(([k, f]) => `<option value="${esc(k)}"${k === manualSignal ? ' selected' : ''}>${esc(f.label)}</option>`).join('');
    $('#hp-import').innerHTML = `<div class="section-head"><h2>Bring in device data</h2><span class="aside">Read here; nothing is uploaded</span></div>
      <div class="grid cols-2">
        <div class="card hp-drop" data-drop="apple">
          <div class="card-head"><h3>Apple Health export</h3><span class="aside micro">iPhone</span></div>
          <div class="card-body stack">
            <ol class="hp-steps"><li>On the iPhone, open the Health app and tap Summary.</li><li>Tap your picture or initials at the top right.</li><li>Tap Export All Health Data, then choose how to share it, and get the export onto this device.</li><li>Choose the export.zip below, or drop it on this box. An export.xml file works too.</li></ol>
            <p class="note">Steps from ${linkTo(APPLE_STEPS_URL, 'Apple Support')}. The file never leaves this browser: it is read here, and only the readings are kept.</p>
            <p class="note" data-since-note></p>
            <div class="row"><label class="btn hp-file-btn">Choose export.zip or export.xml<input type="file" class="hp-file" accept=".zip,.xml,application/zip,text/xml" data-file="apple"></label></div>
            <div class="hp-progress" data-apple-progress hidden><div class="hp-bar"><span data-apple-bar></span></div><span class="mono" data-apple-pct>0%</span><button type="button" class="btn sm" data-act="apple-cancel">Cancel</button></div>
            <div data-apple-out aria-live="polite"></div>
          </div>
        </div>
        <div class="card hp-drop" data-drop="csv">
          <div class="card-head"><h3>CSV file</h3><span class="aside micro">Any app that exports CSV</span></div>
          <div class="card-body stack">
            <p>A spreadsheet with a date, what was measured, a value and its unit. Drop it here or choose it.</p>
            <p class="note" data-since-note></p>
            <div class="row"><label class="btn hp-file-btn">Choose a CSV file<input type="file" class="hp-file" accept=".csv,text/csv,text/plain" data-file="csv"></label></div>
            <div data-csv-out aria-live="polite"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Type in a reading</h3><span class="aside micro">From any device</span></div>
          <div class="card-body stack">
            <label class="hp-field"><span>What</span><select class="select" data-manual-signal>${manualOpts}</select></label>
            <div class="hp-form" data-manual-fields>${manualFieldsHtml()}</div>
            <div class="hp-form"><label class="hp-field"><span>Date</span><input type="date" class="hp-input" data-man-date value="${esc(localDate())}"></label><label class="hp-field"><span>Time (optional)</span><input type="time" class="hp-input" data-man-time></label></div>
            <div class="row"><button type="button" class="btn primary" data-act="manual-save">Save the reading</button></div>
            <div data-manual-out aria-live="polite"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h3>Bluetooth device</h3><span class="aside micro">Standard health devices</span></div>
          <div class="card-body stack" id="hp-bt">${btHtml()}</div>
        </div>
      </div>
      <div class="grid cols-2 hp-gap">
        <div class="card card-pad stack" id="hp-demo"></div>
        <div class="card card-pad stack" id="hp-remove"></div>
      </div>`;
  }
  function armButton(key, idle, armedText) {
    return `<button type="button" class="btn sm" data-act="arm" data-key="${esc(key)}" data-idle="${esc(idle)}" data-armed="${esc(armedText)}">${esc(arms.has(key) ? armedText : idle)}</button>`;
  }
  function renderDemoAndRemove() {
    const demo = $('#hp-demo');
    if (demo) {
      if (isAlex()) {
        const stored = snap.samples.filter((s) => s.person === 'alex' && s.simulated).length + snap.results.filter((r) => r.person === 'alex' && r.simulated).length;
        demo.innerHTML = `<h3>Demo data</h3><p class="note">Simulated weekly data for Alex, shown while Home data (top bar) is on. It is written to this browser only if you press Load.</p>
          <div class="row"><button type="button" class="btn sm" data-act="demo-load">Load demo data for Alex (simulated)</button><button type="button" class="btn sm" data-act="demo-remove"${stored ? '' : ' disabled'}>Remove demo data</button></div>
          <p class="note">${stored ? `${plural(stored, 'simulated item')} saved in this browser.` : 'None saved in this browser.'}</p><div data-demo-out aria-live="polite">${said.demo}</div>`;
      } else {
        demo.innerHTML = '<h3>Demo data</h3><p class="note">Simulated home data exists only for Alex, the BioHacks case file.</p>';
      }
    }
    const rm = $('#hp-remove');
    if (rm) {
      const buttons = SOURCES_TO_REMOVE.map(([src, word]) => {
        const n = snap.samples.filter((s) => s.source === src || String(s.source).startsWith(`${src}:`)).length;
        return n ? armButton(`rm:${src}`, `Remove ${word} (${n})`, `Click again to remove ${plural(n, 'reading')}`) : `<button type="button" class="btn sm" disabled>No ${esc(word)}</button>`;
      }).join('');
      rm.innerHTML = `<h3>Remove by source</h3><p class="note">Removes those readings from this browser, for every case. Two clicks, so nothing goes by accident.</p><div class="row">${buttons}</div><div data-rm-out aria-live="polite">${said.rm}</div>`;
    }
  }
  async function appleImport(file) {
    if (appleRun) appleRun.ac.abort();
    const run = { ac: new AbortController() };
    appleRun = run;
    const prog = $('[data-apple-progress]');
    const out = $('[data-apple-out]');
    if (prog) prog.hidden = false;
    if (out) out.innerHTML = `<p class="note">Reading ${esc(file.name || 'the file')}…</p>`;
    // Only the 12 weeks before the first visit and after are read in: years of history
    // would set the baseline long before the visit.
    const since = sinceDate();
    const sinceNote = sinceText();
    const res = await importAppleHealth(file, {
      since: since || undefined,
      abortSignal: run.ac.signal,
      onProgress: (f) => {
        if (appleRun !== run) return;
        const bar = $('[data-apple-bar]');
        const pct = $('[data-apple-pct]');
        if (bar) bar.style.width = `${Math.round(f * 100)}%`;
        if (pct) pct.textContent = `${Math.round(f * 100)}%`;
      },
    });
    if (appleRun !== run || dead) return;
    appleRun = null;
    if (prog) prog.hidden = true;
    if (!res || !res.ok) {
      if (out) out.innerHTML = msgHtml(res?.aborted ? 'Import cancelled. Nothing was added.' : res?.reason || 'The file could not be read.');
      return;
    }
    const who = personId();
    const added = addSamples(list(res.samples).map((s) => ({ ...s, person: who })));
    const counts = Object.entries(res.counts || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    const warn = list(res.warnings);
    if (out) {
      out.innerHTML = `<p class="hp-ok" role="status"><b>Added ${plural(added.added, 'reading')}</b>${added.duplicates ? `; ${added.duplicates} were already here` : ''}${added.invalid ? `; ${added.invalid} could not be used` : ''}.${res.exportDate ? ` Export made ${esc(String(res.exportDate).slice(0, 10))}.` : ''}</p>
        ${since ? `<p class="note">Readings from before ${esc(sinceNote)} were left out, so an old history cannot set the baseline.</p>` : ''}
        ${counts.length ?`<div class="table-wrap"><table class="tbl"><thead><tr><th>Signal</th><th class="num">Readings found</th></tr></thead><tbody>${counts.map(([k, n]) => `<tr><td>${esc(labelOf('signal', k))}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">No readings this app uses were found.</p>'}
        ${warn.length ? `<ul class="hp-flags">${warn.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join('')}${warn.length > 8 ? `<li>…and ${warn.length - 8} more.</li>` : ''}</ul>` : ''}
        ${storageWarning()}`;
    }
  }
  async function csvRead(file) {
    const out = $('[data-csv-out]');
    let text = '';
    try { text = await file.text(); } catch { if (out) out.innerHTML = msgHtml('This file could not be read.'); return; }
    if (dead) return;
    const r = csvToSamples(text, { person: personId() });
    text = '';
    // Every reading is saved for this case (the view shows only this case's data), and
    // readings from before the history window are left out.
    const c = prepareCsv(r.samples, { person: personId(), since: sinceDate() });
    csvPending = c.samples.length ? c.samples : null;
    const warn = list(r.warnings);
    const preview = c.samples.slice(0, 5).map((s) => `<tr><td>${esc(String(s.start).replace('T', ' '))}</td><td>${esc(labelOf('signal', s.signal))}</td><td class="num">${esc(isNum(s.value2) ? `${short(s.value)}/${short(s.value2)}` : short(s.value))}</td><td>${esc(unitText(s.unit))}</td></tr>`).join('');
    const old = c.old ? `<p class="note">${plural(c.old, 'reading')} from before ${esc(sinceText())} ${c.old === 1 ? 'is' : 'are'} left out, so an old history cannot set the baseline.</p>` : '';
    const names = c.others.slice(0, 3).map((n) => `"${n}"`).join(', ') + (c.others.length > 3 ? ' and others' : '');
    const others = c.others.length ? `<p class="note">The file names another person (${esc(names)}). Its readings are saved for this case (${esc(whoName())}).</p>` : '';
    if (out) {
      out.innerHTML = `${c.samples.length ? `<p><b>${plural(c.samples.length, 'reading')}</b> found${r.format ? ` (format: ${esc(r.format)})` : ''}. The first ${Math.min(5, c.samples.length)}:</p>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th class="num">Value</th><th>Unit</th></tr></thead><tbody>${preview}</tbody></table></div>
        ${old}${others}
        <div class="row"><button type="button" class="btn primary" data-act="csv-import">Import ${plural(c.samples.length, 'reading')}</button><button type="button" class="btn quiet" data-act="csv-drop">Discard</button></div>` : `${msgHtml(r.samples.length ? 'Every reading in this file is from before the history window, so none can be imported.' : 'No readings could be read from this file.')}${old}`}
        ${warn.length ? `<ul class="hp-flags">${warn.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join('')}${warn.length > 8 ? `<li>…and ${warn.length - 8} more.</li>` : ''}</ul>` : ''}`;
    }
  }
  function manualSave() {
    const box = $('[data-manual-fields]');
    const out = $('[data-manual-out]');
    const values = {};
    box?.querySelectorAll('[data-in]').forEach((i) => { values[i.dataset.in] = i.value; });
    const r = manualToSample(manualSignal, { date: $('[data-man-date]')?.value, time: $('[data-man-time]')?.value, values, person: personId() });
    if (r.errors) { if (out) out.innerHTML = `<ul class="hp-flags">${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`; return; }
    const a = addSamples([r.sample]);
    const day = String(r.sample.start).slice(0, 10);
    const since = sinceDate();
    const early = since && day < since ? ` It is dated before ${sinceText()}, so it is kept but left out of Your data.` : '';
    if (out) out.innerHTML = a.added ? `<p class="hp-ok" role="status"><b>Saved</b> ${esc(MANUAL_FIELDS[manualSignal].label.toLowerCase())} for ${esc(fmtDate(day))}.${esc(early)}</p>${storageWarning()}` : msgHtml('That reading is already saved.');
    if (a.added) box?.querySelectorAll('input[data-in]').forEach((i) => { i.value = ''; });
  }
  function readingText(s) {
    if (!s) return '';
    if (s.signal === 'bp') return `${short(s.value)}/${short(s.value2)} mmHg`;
    if (s.signal === 'weight') return `${fixed(s.value, 1)} kg`;
    if (s.signal === 'spo2') return `${short(s.value)}% blood oxygen`;
    return withUnit(short(s.value), s.unit);
  }
  // Each reading rewrites only the live text; the Disconnect button stays put (shown while connected).
  function paintBt(kind) {
    const st = bt.get(kind);
    const box = root.querySelector(`[data-bt="${kind}"]`);
    const btn = root.querySelector(`[data-act="bt-connect"][data-kind="${kind}"]`);
    const off = root.querySelector(`[data-act="bt-off"][data-kind="${kind}"]`);
    if (!box || !st) return;
    box.innerHTML = btStatusHtml(st);
    if (btn) btn.disabled = Boolean(st.conn) || st.connecting;
    if (off) off.hidden = !st.conn;
  }
  function btConnect(kind) {
    const cur = bt.get(kind);
    if (cur && (cur.conn || cur.connecting)) return;
    const st = { kind, conn: null, connecting: true, last: '', saved: 0, status: 'Pick the device in the browser\'s list.', lastSavedAt: 0 };
    bt.set(kind, st);
    paintBt(kind);
    // Nothing is awaited before this call: the browser needs it to come straight from the press.
    connectHealthDevice(kind, {
      person: personId(),
      onReading: (reading, sample) => {
        if (dead || bt.get(kind) !== st) return;
        if (!sample) { st.last = 'a reading with no usable value (not saved)'; paintBt(kind); return; }
        st.last = readingText(sample);
        const now = Date.now();
        if (kind !== 'heart_rate' || now - st.lastSavedAt >= HR_SAVE_MS) {
          st.lastSavedAt = now;
          st.saved += addSamples([{ ...sample, person: personId() }]).added;
        }
        paintBt(kind);
      },
      onDisconnect: ({ reason }) => { if (bt.get(kind) !== st) return; st.conn = null; st.status = reason; paintBt(kind); },
      onError: ({ reason }) => { if (bt.get(kind) !== st) return; st.status = reason; paintBt(kind); },
    }).then((res) => {
      st.connecting = false;
      if (dead || bt.get(kind) !== st) { if (res && res.ok) res.disconnect(); return; }
      if (!res || !res.ok) { st.status = `${res?.reason || 'Bluetooth did not start.'}${framed() ? ` ${LOCAL}` : ''}`; paintBt(kind); return; }
      st.conn = res;
      st.status = `Connected to ${res.name}. Take a reading on the device.`;
      paintBt(kind);
    }, () => { st.connecting = false; st.status = 'Bluetooth did not start. Please try again.'; paintBt(kind); });
  }

  // ---- what actually detects anything ----
  function renderVerdicts() {
    $('#hp-verdicts').innerHTML = verdictsHtml(catalog.VERDICTS);
  }

  // ---- data handling ----
  function storageWarning() {
    try {
      const s = storageStatus();
      return s.warning ? msgHtml(s.warning) : '';
    } catch { return ''; }
  }
  function renderHandling() {
    const { samples, results } = snap;
    const mine = samples.filter((s) => s.person === personId()).length + results.filter((r) => r.person === personId()).length;
    const total = samples.length + results.length;
    $('#hp-handling').innerHTML = `<div class="section-head"><h2>Your data stays in this browser</h2></div>
      <div class="card card-pad stack">
        <p>Imports are read on this device, test recordings and typed text are dropped once they are scored, and nothing is sent anywhere. ${plural(samples.length, 'reading')} and ${plural(results.length, 'test result')} are kept here (${mine} for this case).</p>
        ${storageWarning()}
        <div class="row">
          <button type="button" class="btn" data-act="export-csv"${mine ? '' : ' disabled'}>Export this case's data (CSV)</button>
          <button type="button" class="btn" data-act="copy-csv"${mine ? '' : ' disabled'}>Copy this case's CSV</button>
          ${total ? armButton('delete-all', 'Delete all home data', `Click again to delete ${plural(samples.length, 'reading')} and ${plural(results.length, 'result')} (cannot be undone)`) : '<button type="button" class="btn sm" disabled>Delete all home data</button>'}
        </div>
        <p class="note">Export and Copy hold only this case's readings and results. Delete all removes this page's readings and results for every case, and every case's answers about devices and walking. Results of the Monitoring page's tests are kept; delete those there.</p>
        <div data-handling-out aria-live="polite">${said.handling}</div>
      </div>`;
  }
  const exportText = () => exportCsv(personId());
  function download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    } catch { return false; }
  }
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      say('handling', '<p class="hp-ok" role="status"><b>Copied.</b> Paste it into a spreadsheet or a text file.</p>');
    } catch {
      // Copying is refused in some hosted frames: the text is shown to copy by hand.
      say('handling', `${msgHtml('Copying is blocked here. Select the text below and copy it yourself.')}<textarea class="hp-input hp-textarea" rows="6" readonly data-copybox>${esc(text)}</textarea>`);
      const box = root.querySelector('[data-copybox]');
      if (box) { box.focus(); box.select(); }
    }
  }

  // ---- render everything ----
  // After any change the whole plan is rebuilt: a saved fall can switch the walking tests off.
  function renderAll() {
    if (renderTimer) { clearTimeout(renderTimer); renderTimer = 0; }
    if (dead) return;
    takeSnap();
    const ev = evaluation();
    const p = profile();
    const fall = fallNow();
    const answers = answersOf(p, fall);
    const sit = situationAt({ caseFile: ctx.caseFile, ev, cut: cutDate(), opts: ctx.opts, answers });
    const plan = planOf(sit, p, answers);
    renderSituation(ev, sit, plan, p, fall);
    renderPlan(sit, plan);
    placeCards(plan, sit, p);
    renderLast();
    renderData(sit);
    renderDemoAndRemove();
    renderHandling();
    const since = sinceDate();
    root.querySelectorAll('[data-since-note]').forEach((n) => {
      n.textContent = since ? `Readings from before ${sinceText()} are not brought in, so an old history cannot set the baseline.` : '';
    });
  }
  // Many changes in a row (an import, demo data) render once.
  const schedule = () => { if (!renderTimer && !dead) renderTimer = setTimeout(renderAll, 40); };

  renderImport();
  renderVerdicts();
  renderAll();
  const unsubscribe = subscribe(schedule);

  // ---- interactions (delegated, so re-rendered parts need no rewiring) ----
  function openTest(id) {
    const card = cardOf(id);
    if (!card) return;
    if (card.parentElement && card.parentElement.id === 'hp-tests-more') $('#hp-more').open = true;
    card.open = true;
    const smooth = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    const first = card.querySelector('.hp-run button:not([disabled]), .hp-run textarea, .hp-run input');
    if (first) first.focus({ preventScroll: true });
  }
  function arm(btn) {
    const key = btn.dataset.key;
    if (!arms.has(key)) {
      btn.textContent = btn.dataset.armed;
      // Disarm after 5 s. The button may have been redrawn since (new data), so find it again.
      arms.set(key, setTimeout(() => {
        arms.delete(key);
        const now = [...root.querySelectorAll('[data-act="arm"]')].find((x) => x.dataset.key === key);
        if (now) now.textContent = now.dataset.idle;
      }, 5000));
      return;
    }
    clearTimeout(arms.get(key));
    arms.delete(key);
    if (key === 'delete-all') {
      clearHomeData();
      clearProfiles(); // every case's device and walking answers are home data too
      say('handling', '<p class="hp-ok" role="status"><b>Deleted.</b> This page\'s home data and every case\'s answers are gone from this browser.</p>');
      renderAll();
    } else if (key.startsWith('rm:')) {
      const n = removeSamples({ source: key.slice(3) });
      say('rm', `<p class="hp-ok" role="status"><b>Removed ${plural(n, 'reading')}.</b></p>`);
    }
  }
  function onClick(e) {
    const b = e.target.closest && e.target.closest('[data-act], [data-walk], [data-ans]');
    if (!b || !root.contains(b)) return;
    if (b.dataset.ans) {
      const q = extraQuestions().find((x) => x.id === b.dataset.ans);
      const o = q && q.options[Number(b.dataset.opt)];
      if (!o) return;
      const p = profile();
      const answers = { ...p.answers };
      if (answers[q.id] === o.value) delete answers[q.id]; else answers[q.id] = o.value;
      keepProfile({ ...p, answers });
      renderAll();
      const again = root.querySelector(`[data-ans="${q.id}"][data-opt="${b.dataset.opt}"]`);
      if (again) { again.closest('details').open = true; again.focus(); }
      return;
    }
    if (b.dataset.walk) {
      const p = profile();
      keepProfile({ ...p, walk: p.walk === b.dataset.walk ? null : b.dataset.walk });
      renderAll();
      root.querySelector(`[data-walk="${b.dataset.walk}"]`)?.focus();
      return;
    }
    const act = b.dataset.act;
    const id = b.dataset.test;
    switch (act) {
      case 'open-test': openTest(id); break;
      case 'goto-manual': {
        if (MANUAL_FIELDS[b.dataset.signal]) {
          manualSignal = b.dataset.signal;
          const sel = $('[data-manual-signal]');
          if (sel) sel.value = manualSignal;
          const box = $('[data-manual-fields]');
          if (box) box.innerHTML = manualFieldsHtml();
        }
        $('[data-manual-signal]')?.closest('.card')?.scrollIntoView({ block: 'start' });
        $('[data-manual-fields] input')?.focus({ preventScroll: true });
        break;
      }
      case 'goto-import': $('#hp-import')?.scrollIntoView({ block: 'start' }); break;
      case 'home-on': ctx.setState({ includeHome: true }); break;
      case 'mic-start': micStart(id); break;
      case 'mic-stop': micStop(id); break;
      case 'mic-cancel': micCancel(id); break;
      case 'typing-finish': typingFinish(id); break;
      case 'typing-new': newSentence(id); break;
      case 'sw-start': swStart(id); break;
      case 'sw-stop': swStop(id); break;
      case 'cnt-start': cntStart(id); break;
      case 'cnt-plus': {
        const run = runs.get(id);
        if (run && run.cnt && run.phase === 'run') { run.n += 1; big(runBox(id), String(run.n)); }
        break;
      }
      case 'cnt-save': {
        const v = Number(runBox(id)?.querySelector('[data-final]')?.value);
        if (!(Number.isInteger(v) && v >= 0 && v <= 200)) {
          const m = runBox(id)?.querySelector('[data-cnt-msg]');
          if (m) m.innerHTML = msgHtml('Enter the count as a whole number from 0 to 200.');
          break;
        }
        saveFor(id, { value: v, unit: TESTS()[id]?.unit || 'repetitions', detail: { seconds: COUNT_S, tapped: runs.get(id)?.n ?? null } });
        break;
      }
      case 'sbc-save': {
        const v = Number(runBox(id)?.querySelector('[data-lastnum]')?.value);
        if (!(Number.isInteger(v) && v > 0 && v <= 200)) {
          const m = runBox(id)?.querySelector('[data-cnt-msg]');
          if (m) m.innerHTML = msgHtml('Enter the last number you said, as a whole number.');
          break;
        }
        const a = runs.get(id)?.audio;
        const detail = { entered: v, audioCount: a && a.ok ? a.value : null, flags: a ? a.flags : [] };
        if (a && a.detail && isNum(a.detail.breathS)) detail.breathS = round(a.detail.breathS, 2);
        saveFor(id, { value: v, unit: TESTS()[id]?.unit || 'count', detail });
        break;
      }
      case 'q-save': {
        // The chosen options are kept with the scores; a red-flag answer gets an alert box.
        const s = qScore(id);
        if (s && s.answered === s.total) {
          const flags = redFlagsFor(TESTS()[id], { value: s.score, answers: s.answers });
          saveFor(id, { value: s.score, unit: TESTS()[id]?.unit || 'score', detail: s.detail }, alertHtml(flags, 'Act on this'));
        }
        break;
      }
      case 'q-clear': runBox(id)?.querySelectorAll('input[type="radio"]').forEach((i) => { i.checked = false; }); qUpdate(id); setOut(id, ''); break;
      case 'q-manual': {
        const raw = runBox(id)?.querySelector('[data-qmanual]')?.value;
        const v = Number(raw);
        // A questionnaire total or a count is a whole number.
        const whole = ['score', 'count'].includes(TESTS()[id]?.unit);
        if (raw === '' || raw == null || !(Number.isFinite(v) && v >= 0) || (whole && !Number.isInteger(v))) {
          setOut(id, msgHtml(whole ? 'Enter the total as a whole number, 0 or more.' : 'Enter a number of 0 or more.'));
          break;
        }
        // A total at or above the catalogue's red-flag line (EAT-10: 3) gets an alert box.
        saveFor(id, { value: v, unit: TESTS()[id]?.unit || 'score', detail: { entered: 'by hand' } }, alertHtml(redFlagsFor(TESTS()[id], { value: v }), 'Act on this'));
        break;
      }
      case 'mt-save': {
        const values = {};
        runBox(id)?.querySelectorAll('[data-in]').forEach((i) => { values[i.dataset.in] = i.value; });
        const r = manualToSample(id, { date: localDate(), values });
        if (r.errors) { setOut(id, `<ul class="hp-flags">${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); break; }
        saveFor(id, { value: r.sample.value, unit: TESTS()[id]?.unit || r.sample.unit, detail: r.sample.detail });
        break;
      }
      case 'save': { const run = runs.get(id); if (run && run.pending) saveFor(id, run.pending); break; }
      case 'discard': { const run = runs.get(id); if (run) run.pending = null; setOut(id, '<p class="note">Discarded. Nothing was saved.</p>'); break; }
      case 'vals': {
        const key = b.dataset.key;
        const open = b.getAttribute('aria-expanded') !== 'true';
        if (open) openVals.add(key); else openVals.delete(key);
        b.setAttribute('aria-expanded', String(open));
        const cap = b.querySelector('.hp-chart-cap');
        if (cap) cap.textContent = open ? 'Hide the values' : 'Show the values';
        const t = root.querySelector(`#${b.getAttribute('aria-controls')}`);
        if (t) t.hidden = !open;
        break;
      }
      case 'apple-cancel': if (appleRun) appleRun.ac.abort(); break;
      case 'csv-import': {
        const out = $('[data-csv-out]');
        if (!csvPending) break;
        const a = addSamples(csvPending);
        csvPending = null;
        if (out) out.innerHTML = `<p class="hp-ok" role="status"><b>Imported ${plural(a.added, 'reading')}</b>${a.duplicates ? `; ${a.duplicates} were already here` : ''}${a.invalid ? `; ${a.invalid} could not be used` : ''}.</p>${storageWarning()}`;
        break;
      }
      case 'csv-drop': csvPending = null; { const out = $('[data-csv-out]'); if (out) out.innerHTML = '<p class="note">Discarded. Nothing was imported.</p>'; } break;
      case 'manual-save': manualSave(); break;
      case 'bt-connect': btConnect(b.dataset.kind); break;
      case 'bt-off': { const st = bt.get(b.dataset.kind); if (st && st.conn) st.conn.disconnect(); break; }
      case 'demo-load': {
        let samples = [];
        let results = [];
        try { samples = list(demoData.demoSamples?.('alex')); results = list(demoData.demoResults?.('alex')); } catch (err) { console.error(err); }
        if (!samples.length && !results.length) { say('demo', msgHtml('There is no demo data to load yet.')); break; }
        const a = addSamples(samples.map((s) => ({ ...s, source: 'demo', simulated: true, person: 'alex' })));
        const have = new Set(getResults({ person: 'alex' }).filter((r) => r.simulated).map((r) => JSON.stringify([r.test, r.date, r.time ?? null, r.value])));
        let addedResults = 0;
        for (const r of results) {
          const k = JSON.stringify([r.test, r.date, r.time ?? null, r.value]);
          if (have.has(k)) continue;
          const saved = addResult({ ...r, simulated: true, person: 'alex' });
          if (saved && saved.ok !== false) { addedResults += 1; have.add(k); }
        }
        say('demo', `<p class="hp-ok" role="status"><b>Loaded</b> ${plural(a.added, 'simulated reading')} and ${plural(addedResults, 'simulated result')}.${ctx.state.includeHome ? '' : ' Turn on Home data in the top bar to see them.'}</p>`);
        break;
      }
      case 'demo-remove': {
        const n = removeSamples({ person: 'alex', simulated: true });
        let m = 0;
        for (const r of getResults({ person: 'alex' })) if (r.simulated && removeResult(r.id)) m += 1;
        say('demo', `<p class="hp-ok" role="status"><b>Removed</b> ${plural(n, 'simulated reading')} and ${plural(m, 'simulated result')}.</p>`);
        break;
      }
      case 'arm': arm(b); break;
      case 'export-csv': {
        const text = exportText();
        const ok = download(`home-data-${personId()}-${localDate()}.csv`, text);
        say('handling', ok && !framed() ? '<p class="hp-ok" role="status"><b>Downloaded.</b> Look in your downloads folder.</p>'
          : msgHtml(framed() ? `${LOCAL} Use Copy CSV instead.` : 'If no file appears, downloads are blocked here: use Copy CSV.'));
        break;
      }
      case 'copy-csv': copyText(exportText()); break;
      default: break;
    }
  }
  function onChange(e) {
    const t = e.target;
    if (!(t instanceof Element) || !root.contains(t)) return;
    if (t.matches('[data-dev]')) {
      const p = profile();
      const set = new Set(p.devices);
      if (t.checked) set.add(t.dataset.dev); else set.delete(t.dataset.dev);
      // "none" and a real device cannot both be ticked
      if (t.checked && t.dataset.dev === 'none') for (const d of [...set]) if (d !== 'none') set.delete(d);
      if (t.checked && t.dataset.dev !== 'none') set.delete('none');
      keepProfile({ ...p, devices: [...set] });
      renderAll();
      root.querySelector(`[data-dev="${t.dataset.dev}"]`)?.focus();
      return;
    }
    if (t.matches('[data-safe]')) {
      const id = t.dataset.safe;
      const box = runBox(id);
      const run = runs.get(id);
      const busy = run && ((run.sw && run.t0 !== null && run.t0 !== undefined) || (run.cnt && run.phase !== 'done'));
      enable(box, 'sw-start', t.checked && !busy);
      enable(box, 'cnt-start', t.checked && !busy);
      return;
    }
    if (t.matches('[data-q] input[type="radio"]')) { qUpdate(t.closest('[data-run]')?.dataset.run); return; }
    if (t.matches('[data-man-date]')) { t.dataset.touched = '1'; return; }
    if (t.matches('[data-manual-signal]')) {
      manualSignal = t.value;
      const box = $('[data-manual-fields]');
      if (box) box.innerHTML = manualFieldsHtml();
      const out = $('[data-manual-out]');
      if (out) out.innerHTML = '';
      return;
    }
    if (t.matches('input[type="file"][data-file]')) {
      const f = t.files && t.files[0];
      if (f) { if (t.dataset.file === 'apple') appleImport(f); else csvRead(f); }
      t.value = '';
    }
  }
  // The typing test: the session gets the box's own key and input events.
  const sessionOf = (t) => (t instanceof Element && t.matches('[data-typing]') ? runs.get(t.dataset.typing)?.session || null : null);
  const onKeydown = (e) => { sessionOf(e.target)?.handleKeydown(e); };
  const onBeforeInput = (e) => { sessionOf(e.target)?.handleBeforeInput(e); };
  const onInput = (e) => { sessionOf(e.target)?.handleInput(e); };
  const onPaste = (e) => {
    if (!(e.target instanceof Element) || !e.target.matches('[data-typing]')) return;
    e.preventDefault(); // pasted text cannot be timed
    const note = e.target.parentElement?.querySelector('[data-paste]');
    if (note) note.hidden = false;
  };
  // Dropping a file on an import box works like choosing it.
  const dropZone = (e) => (e.target instanceof Element ? e.target.closest('[data-drop]') : null);
  const onDragOver = (e) => {
    const z = dropZone(e);
    if (!z) return;
    e.preventDefault();
    z.classList.add('hp-over');
  };
  const onDragLeave = (e) => { const z = dropZone(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('hp-over'); };
  const onDrop = (e) => {
    if (e.target instanceof Element && e.target.matches('[data-typing]')) { onPaste(e); return; }
    const z = dropZone(e);
    if (!z) return;
    e.preventDefault();
    z.classList.remove('hp-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (z.dataset.drop === 'apple') appleImport(f); else csvRead(f);
  };
  const listeners = [
    ['click', onClick], ['change', onChange], ['keydown', onKeydown], ['beforeinput', onBeforeInput], ['input', onInput],
    ['paste', onPaste], ['dragover', onDragOver], ['dragleave', onDragLeave], ['drop', onDrop],
  ];
  for (const [type, fn] of listeners) root.addEventListener(type, fn);

  return {
    update(next) {
      ctx = next;
      renderAll();
      const d = $('[data-man-date]');
      if (d && !d.dataset.touched) d.value = localDate();
    },
    unmount() {
      dead = true;
      clearTimeout(renderTimer);
      unsubscribe();
      for (const [type, fn] of listeners) root.removeEventListener(type, fn);
      for (const run of runs.values()) {
        clearRun(run);
        if (run.mic && !run.finished) { run.cancelled = true; run.ac.abort(); }
        if (run.session) run.session.reset(); // typed text leaves memory
      }
      runs.clear();
      if (appleRun) appleRun.ac.abort();
      for (const st of bt.values()) { try { if (st.conn) st.conn.disconnect(); } catch { /* already gone */ } }
      bt.clear();
      for (const t of arms.values()) clearTimeout(t);
      arms.clear();
      csvPending = null;
    },
  };
}
