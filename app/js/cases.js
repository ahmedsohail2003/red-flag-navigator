// Case registry: Alex (the BioHacks case file), seven constructed look-alike demo cases,
// and cases built in the app (saved in this browser, exportable as JSON).
// Every case has the same shape as alex.js, so engine.js works on all of them unchanged.
import { ALEX } from './alex.js';
import { LOOKALIKES } from './lookalikes.js';
import { FINDINGS, HOME_TESTS } from './engine.js';

const KEY = 'rfn.cases';
export const REGIONS = ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive', 'other'];
export const REGION_LABEL = {
  arm: 'Hand and arm', leg: 'Leg and walking', bulbar: 'Speech and swallowing', breathing: 'Breathing',
  general: 'Whole body', cognitive: 'Thinking and mood', other: 'Other',
};
export const SETTINGS = ['Family doctor', 'Walk-in clinic', 'Emergency department', 'Hand surgeon', 'Orthopaedics', 'Physiotherapy', 'Neurology', 'Other specialist', 'Other'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d) => typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));

function demoCaseFile(v) {
  const enc = v.caseFile.encounters[0];
  return {
    patient: { name: v.title, ageAtFirstVisit: null, sex: '', summary: v.story },
    encounters: [{ ...enc, title: v.title, clinician: '', note: v.story, negatives: [], whatHappened: v.note || '' }],
    actual: {},
    measurements: [],
    homeTests: [],
  };
}

export const BUILTIN = [
  { id: 'alex', kind: 'case-file', name: 'Alex Chen', subtitle: 'BioHacks case file: ALS diagnosed July 2026', caseFile: ALEX },
  ...LOOKALIKES.map((v) => ({
    id: `demo-${v.id}`, kind: 'demo', name: v.title, subtitle: 'Constructed look-alike, not a real patient',
    expect: v.expect, caseFile: demoCaseFile(v),
  })),
];

// Clean a case so the engine and views can trust it. Returns { caseFile, errors }.
export function normalizeCase(input) {
  const errors = [];
  const c = input && typeof input === 'object' ? input : {};
  const patient = c.patient && typeof c.patient === 'object' ? c.patient : {};
  const name = String(patient.name || '').trim() || 'Unnamed patient';
  const age = patient.ageAtFirstVisit === '' || patient.ageAtFirstVisit == null ? null : Number(patient.ageAtFirstVisit);
  const encounters = (Array.isArray(c.encounters) ? c.encounters : []).map((e, i) => {
    const id = String(e && e.id ? e.id : `v${i + 1}`);
    if (!validDate(e && e.date)) errors.push(`Visit ${i + 1}: the date must be YYYY-MM-DD.`);
    const findings = (Array.isArray(e && e.findings) ? e.findings : []).filter((f) => {
      const ok = f && FINDINGS[f.id];
      if (!ok) errors.push(`Visit ${i + 1}: unknown red flag "${f && f.id}".`);
      return ok;
    }).map((f) => ({
      id: f.id,
      region: REGIONS.includes(f.region) ? f.region : (FINDINGS[f.id].region || 'other'),
      // Never invent a quote: an empty one stays empty and views say "no words entered".
      quote: String(f.quote || '').trim(),
    }));
    return {
      id, date: e && e.date, setting: String((e && e.setting) || 'Family doctor'), clinician: String((e && e.clinician) || ''),
      title: String((e && e.title) || ''), note: String((e && e.note) || ''), findings,
      negatives: (Array.isArray(e && e.negatives) ? e.negatives : []).filter((n) => n && n.label).map((n) => ({ label: String(n.label), quote: String(n.quote || n.label) })),
      whatHappened: String((e && e.whatHappened) || ''),
    };
  }).filter((e) => validDate(e.date)) // a visit without a real date cannot be placed on the timeline
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const seen = new Set();
  for (const e of encounters) { if (seen.has(e.id)) e.id = `${e.id}-${seen.size}`; seen.add(e.id); }
  const homeTests = (Array.isArray(c.homeTests) ? c.homeTests : []).filter((h) => h && HOME_TESTS[h.test] && validDate(h.date) && Number.isFinite(Number(h.value)))
    .map((h) => ({ date: h.date, test: h.test, value: Number(h.value), simulated: h.simulated === true }));
  const actual = {};
  if (c.actual && validDate(c.actual.referral)) actual.referral = c.actual.referral;
  for (const k of ['firstNeurology', 'firstNeuromuscular', 'diagnosis']) if (c.actual && validDate(c.actual[k])) actual[k] = c.actual[k];
  if (!encounters.length) errors.push('Add at least one visit.');
  return {
    caseFile: {
      patient: { name, ageAtFirstVisit: Number.isFinite(age) ? age : null, sex: String(patient.sex || ''), summary: String(patient.summary || '') },
      encounters, actual, measurements: [], homeTests,
    },
    errors,
  };
}

function readUser() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a.filter((x) => x && typeof x.id === 'string' && x.caseFile) : [];
  } catch { return []; }
}
let memory = null; // used when storage is blocked
function userCases() { return memory || readUser(); }
function writeUser(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); memory = null; } catch { memory = list; }
}

export function listCases() {
  return [...BUILTIN, ...userCases().map((u) => ({ id: u.id, kind: 'user', name: u.caseFile.patient.name, subtitle: u.subtitle || 'Built in this browser', caseFile: u.caseFile }))];
}
export function getCase(id) {
  return listCases().find((c) => c.id === id) || BUILTIN[0];
}
export function newCaseTemplate() {
  return { patient: { name: 'New patient', ageAtFirstVisit: null, sex: '', summary: '' }, encounters: [], actual: {}, measurements: [], homeTests: [] };
}
// Errors that make a case unusable: refuse to save these rather than store a broken case.
const BLOCKING = /date must be|at least one visit/i;

// Save a user case (new when id is missing). Returns { id, errors, caseFile };
// id is null and nothing is saved when the case has a bad date or no visits.
export function saveUserCase(caseFile, id = null) {
  const { caseFile: clean, errors } = normalizeCase(caseFile);
  if (errors.some((e) => BLOCKING.test(e))) return { id: null, errors, caseFile: clean };
  const list = userCases();
  const newId = id && list.some((u) => u.id === id) ? id : `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id: newId, subtitle: 'Built in this browser', caseFile: clean };
  writeUser([...list.filter((u) => u.id !== newId), entry]);
  return { id: newId, errors, caseFile: clean };
}
export function deleteUserCase(id) { writeUser(userCases().filter((u) => u.id !== id)); }
export function exportCase(id) {
  const c = getCase(id);
  return JSON.stringify({ format: 'red-flag-navigator-case', version: 1, ...c.caseFile }, null, 2);
}
export function importCase(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { id: null, errors: ['That is not valid JSON.'] }; }
  return saveUserCase(data);
}
// The visit to show when a case is opened: the latest one.
export function defaultVisit(caseFile) {
  const e = caseFile.encounters || [];
  return e.length ? e[e.length - 1].date : null;
}
