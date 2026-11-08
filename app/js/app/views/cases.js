// Cases: any patient, the same red-flag rules. The case library (Alex, cases built in
// this browser, look-alike demos), an in-page case builder with the keyword note
// helper (plain rules, not AI), and import / export as JSON. Every tier and range on
// this page is computed now by engine.js from what is on file; nothing types a number.
import { esc, fmtDate, TIER, tierChip, simChip, ensureCss, plural, pctAt, monthsBetween } from '../ui.js';
import { timeline, monthsSaved, formatPct, FINDINGS, HOME_TESTS } from '../../engine.js';
import { REFERRAL_LINES } from '../../weights.js';
import {
  listCases, getCase, normalizeCase, saveUserCase, deleteUserCase, exportCase, importCase,
  newCaseTemplate, defaultVisit, REGIONS, REGION_LABEL, SETTINGS,
} from '../../cases.js';
import { suggestFindings, measureOnAlex, measureOnDemos } from '../../suggest.js';

const CSS = 'css/views/cases.css';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d) => typeof d === 'string' && ISO.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const slug = (k) => String(k).replace(/[^a-z0-9]/gi, '-');
const lineLabel = (v) => (REFERRAL_LINES.find((l) => l.value === v) || {}).label || formatPct(v);
// Always both ends, even when they print the same ('>99% to >99%'): a range, never one figure.
const rangeText = (r, line) => `${pctAt(r.lo, line)} to ${pctAt(r.hi, line)}`;
const at = (list, d) => { let last = null; for (const e of list) if (e.asOf <= d) last = e; return last; };
const SEXES = [['', 'Not stated'], ['female', 'Female'], ['male', 'Male'], ['other', 'Another sex or gender']];
const GROUPS = [['case-file', 'Case file', 'From the BioHacks 2026 package, word for word'], ['user', 'My cases', 'Built or imported in this browser'], ['demo', 'Look-alike demos', 'Constructed presentations, not real patients']];

let uid = 0;
const key = () => `k${(++uid).toString(36)}`;
// Survive the re-mount the shell does after a save, delete or import, and keep an
// unsaved draft if the patient is switched from the top bar mid-edit.
let flash = null; // { tone: 'ok' | 'warn', html }
let mem = null; // { draft, editId, origin, sugg, touched, tried }

// ---------- draft <-> case file ----------
function toDraft(cf, copy = false) {
  const c = JSON.parse(JSON.stringify(cf || newCaseTemplate()));
  const p = c.patient || {};
  return {
    patient: { name: `${p.name || ''}${copy ? ' (copy)' : ''}`, ageAtFirstVisit: p.ageAtFirstVisit ?? '', sex: p.sex || '', summary: p.summary || '' },
    encounters: (c.encounters || []).map((e, i) => ({
      _k: key(), id: e.id || `v${i + 1}`, date: e.date || '', setting: e.setting || 'Family doctor', clinician: e.clinician || '',
      title: e.title || '', note: e.note || '', whatHappened: e.whatHappened || '',
      findings: (e.findings || []).filter((f) => FINDINGS[f.id]).map((f) => ({ _k: key(), id: f.id, region: f.region || FINDINGS[f.id].region || '', quote: f.quote || '' })),
      negatives: (e.negatives || []).map((n) => ({ _k: key(), label: n.label || '', quote: n.quote || '' })),
    })),
    actual: { ...(c.actual || {}) },
    homeTests: (c.homeTests || []).map((h) => ({ _k: key(), date: h.date || '', test: h.test, value: h.value, simulated: h.simulated === true })),
  };
}
function fromDraft(d) {
  const actual = { ...d.actual };
  if (!actual.referral) delete actual.referral;
  return {
    patient: { ...d.patient, name: String(d.patient.name || '').trim() },
    encounters: d.encounters.map(({ _k, findings, negatives, ...e }) => ({
      ...e,
      findings: findings.map(({ _k: k, ...f }) => ({ ...f, quote: String(f.quote || '').trim() })),
      negatives: negatives.filter((n) => String(n.label || '').trim()).map(({ _k: k, ...n }) => n),
    })),
    actual,
    measurements: [],
    homeTests: d.homeTests.map(({ _k, ...h }) => h),
  };
}
function newVisit(d) {
  const last = d.encounters[d.encounters.length - 1];
  const used = new Set(d.encounters.map((e) => e.id));
  let n = d.encounters.length + 1;
  while (used.has(`v${n}`)) n++;
  return { _k: key(), id: `v${n}`, date: today(), setting: last ? last.setting : 'Family doctor', clinician: last ? last.clinician : '', title: '', note: '', whatHappened: '', findings: [], negatives: [] };
}

// ---------- validation (inline messages; errors block Save, warnings do not) ----------
function validate(d) {
  const err = {};
  const warn = {};
  if (!String(d.patient.name || '').trim()) err['p:name'] = 'Add a name, initials or a case label.';
  const age = d.patient.ageAtFirstVisit;
  if (age !== '' && age != null && !(Number(age) >= 0 && Number(age) <= 120)) err['p:age'] = 'Enter an age from 0 to 120, or leave it empty.';
  if (!d.encounters.length) err.visits = 'Add at least one visit.';
  const byDate = {};
  for (const e of d.encounters) {
    if (!validDate(e.date)) err[`v:${e._k}:date`] = 'Enter the visit date.';
    else (byDate[e.date] = byDate[e.date] || []).push(e);
    for (const f of e.findings) {
      if (!REGIONS.includes(f.region)) err[`f:${f._k}:region`] = 'Choose the body region.';
      const q = String(f.quote || '').trim();
      if (!q) warn[`f:${f._k}:quote`] = 'Add the words from the note.';
      else if (e.note.trim() && !e.note.includes(q)) warn[`f:${f._k}:quote`] = 'Not found word for word in this visit’s note.';
    }
  }
  for (const list of Object.values(byDate)) if (list.length > 1) for (const e of list) err[`v:${e._k}:date`] = 'Two visits share this date. Give each visit its own date.';
  if (d.actual.referral && !validDate(d.actual.referral)) err['a:referral'] = 'Enter a full date, or clear it.';
  for (const h of d.homeTests) {
    if (!validDate(h.date)) err[`h:${h._k}:date`] = 'Enter the date.';
    if (h.value === '' || h.value == null || !Number.isFinite(Number(h.value))) err[`h:${h._k}:value`] = 'Enter a number.';
    if (!HOME_TESTS[h.test]) err[`h:${h._k}:test`] = 'Choose a test.';
  }
  return { err, warn };
}

// ---------- engine results ----------
function latestResult(cf, opts) {
  const encs = (cf.encounters || []).filter((e) => validDate(e.date));
  if (!encs.length) return null;
  const tl = timeline({ ...cf, encounters: encs }, opts);
  const last = encs[encs.length - 1];
  return { ev: at(tl, last.date), last, n: encs.length };
}
function liveModel(d, opts) {
  const { caseFile } = normalizeCase(fromDraft(d));
  const encs = caseFile.encounters.filter((e) => validDate(e.date));
  const homeTests = caseFile.homeTests || [];
  if (!encs.length) return { empty: true };
  const cf = { ...caseFile, encounters: encs };
  const tl = timeline(cf, opts);
  const steps = encs.map((e) => ({ e, ev: at(tl, e.date) }));
  const cur = steps[steps.length - 1].ev;
  const ms = cf.actual.referral ? monthsSaved(cf, { ...opts, includeHomeTests: false }) : null;
  // The look back is notes only: the visit behind its first High, and the first pattern rule.
  const notes = !ms ? [] : opts.includeHomeTests === false ? tl : timeline(cf, { ...opts, includeHomeTests: false });
  const firstEv = ms && ms.firstHigh ? notes.find((e) => e.asOf === ms.firstHigh) || null : null;
  const ruleEv = notes.find((e) => e.rulesFired.length) || null;
  return { cf, steps, cur, ms, firstEv, ruleEv, homeTests };
}

// ---------- pieces of HTML ----------
const regionOptions = (sel) => `${sel && REGIONS.includes(sel) ? '' : '<option value="" selected>Choose a region</option>'}${REGIONS.map((r) => `<option value="${r}"${r === sel ? ' selected' : ''}>${esc(REGION_LABEL[r])}</option>`).join('')}`;
const weightNote = (f) => (f.or != null ? `aOR ${f.or} (${f.lo}–${f.hi})` : f.contextOnly ? 'Context flag: shown, not scored' : 'Pattern sign: goes straight to a rule');

function pickerOptions(q) {
  const qq = String(q || '').trim().toLowerCase();
  const groups = new Map();
  for (const [id, f] of Object.entries(FINDINGS)) {
    if (id === 'home_decline') continue; // computed from weekly tests, never typed
    const hay = `${f.label} ${f.plain} ${f.group} ${id.replace(/_/g, ' ')}`.toLowerCase();
    if (qq && !qq.split(/\s+/).every((w) => hay.includes(w))) continue;
    const g = f.contextOnly ? 'Context flags · shown, not scored' : f.or == null ? 'Pattern signs · go straight to a rule' : f.group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(`<option value="${id}">${esc(f.label)}${f.contextOnly ? ' · context flag' : f.or == null ? ' · pattern sign' : ''}</option>`);
  }
  if (!groups.size) return '<option value="">No red flag matches that search</option>';
  return [...groups].map(([g, opts]) => `<optgroup label="${esc(g)}">${opts.join('')}</optgroup>`).join('');
}

function msg(k) { return `<p class="cs-msg" id="m-${slug(k)}" data-msg="${esc(k)}"></p>`; }

function visitHtml(d, e, i, s) {
  const k = e._k;
  const sg = s.sugg[k];
  const armed = s.armed === `visit:${k}`;
  const flags = e.findings.length
    ? `<ul class="list cs-flag-list">${e.findings.map((f) => {
        const meta = FINDINGS[f.id];
        return `<li class="cs-flag">
          <div class="cs-flag-l"><b>${esc(meta.label)}</b><div class="note">${esc(weightNote(meta))}</div></div>
          <div class="cs-field cs-flag-r"><label class="micro" for="rg-${f._k}">Body region</label>
            <select class="select cs-wide" id="rg-${f._k}" data-bind="f.${k}.${f._k}.region" data-msgkey="f:${f._k}:region" data-fk="rg-${f._k}" aria-describedby="m-${slug(`f:${f._k}:region`)}">${regionOptions(f.region)}</select>${msg(`f:${f._k}:region`)}</div>
          <button type="button" class="btn sm quiet cs-flag-x" data-act="rm-flag" data-v="${k}" data-fl="${f._k}" data-fk="rmf-${f._k}" aria-label="Remove ${esc(meta.label)}">Remove</button>
          <div class="cs-field cs-flag-q"><label class="micro" for="q-${f._k}">Words from the note</label>
            <textarea class="cs-input cs-quote" id="q-${f._k}" rows="2" data-bind="f.${k}.${f._k}.quote" data-msgkey="f:${f._k}:quote" data-fk="q-${f._k}" aria-describedby="m-${slug(`f:${f._k}:quote`)}">${esc(f.quote)}</textarea>${msg(`f:${f._k}:quote`)}</div>
        </li>`;
      }).join('')}</ul>`
    : '<div class="cs-empty-flags">No red flags yet. Run the helper on the note, or add one below.</div>';

  let suggHtml = '';
  if (sg) {
    const stale = sg.note !== e.note;
    const have = new Set(e.findings.map((f) => `${f.id}|${f.region}`));
    const pending = sg.list.filter((x) => x.state === 'pending' && !have.has(`${x.id}|${x.region}`)).length;
    suggHtml = `
      <div class="cs-sugg">
        <div class="cs-sugg-h">
          <span class="micro">Suggested from the note · ${sg.list.length}</span>
          ${stale ? '<span class="note">The note changed since; run the helper again to refresh.</span>' : ''}
          <span class="spacer"></span>
          ${pending > 1 ? `<button type="button" class="btn sm" data-act="sg-all" data-v="${k}" data-fk="sga-${k}">Accept all ${pending}</button>` : ''}
          <button type="button" class="btn sm quiet" data-act="sg-close" data-v="${k}" data-fk="sgc-${k}">Close</button>
        </div>
        ${sg.list.length ? `<ul class="list cs-sugg-list">${sg.list.map((x, j) => {
          const meta = FINDINGS[x.id];
          const dup = x.state === 'pending' && have.has(`${x.id}|${x.region}`);
          const why = `Matched “${esc(x.match)}”${x.regionFrom === 'words' ? `; body region from “${esc(x.regionWord)}”` : x.regionFrom === 'heading' ? '; body region from the exam heading above it' : x.regionFrom === 'none' ? '; no body part named, so check the region' : ''}`;
          const acts = x.state === 'accepted' ? '<span class="cs-sg-state">Added</span>'
            : x.state === 'dismissed' ? `<span class="cs-sg-state">Dismissed</span><button type="button" class="btn sm quiet" data-act="sg-undo" data-v="${k}" data-i="${j}" data-fk="sgu-${k}-${j}">Undo</button>`
            : dup ? '<span class="cs-sg-state">Already listed</span>'
            : `<button type="button" class="btn sm" data-act="sg-accept" data-v="${k}" data-i="${j}" data-fk="sgy-${k}-${j}">Accept</button><button type="button" class="btn sm quiet" data-act="sg-dismiss" data-v="${k}" data-i="${j}" data-fk="sgn-${k}-${j}">Dismiss</button>`;
          return `<li class="cs-sg${x.state !== 'pending' || dup ? ' is-done' : ''}">
            <div class="cs-sg-main">
              <div class="cs-sg-t"><b>${esc(meta.label)}</b><span class="faint">${esc(REGION_LABEL[x.region] || x.region)}</span></div>
              <blockquote class="quote">“${esc(x.quote)}”</blockquote>
              <div class="note">${why}</div>
            </div>
            <div class="cs-sg-acts">${acts}</div>
          </li>`;
        }).join('')}</ul>` : '<p class="cs-sugg-none">The keyword rules found no red flags in this note. Add any it describes with Add red flag.</p>'}
      </div>`;
  }

  const negs = e.negatives;
  return `
    <article class="card cs-visit" data-vk="${k}">
      <div class="card-head cs-visit-head">
        <span class="mono cs-vn">Visit ${String(i + 1).padStart(2, '0')}</span>
        <b data-vhead="${k}">${esc(validDate(e.date) ? fmtDate(e.date) : 'Date not set')} · ${esc(e.setting)}</b>
        <div class="aside row">
          ${armed
            ? `<span class="note">Remove this visit and its red flags?</span><button type="button" class="btn sm" data-act="rm-visit" data-v="${k}" data-fk="rmv-${k}">Confirm remove</button><button type="button" class="btn sm quiet" data-act="disarm" data-fk="keep-${k}">Keep</button>`
            : `<button type="button" class="btn sm quiet" data-act="arm-visit" data-v="${k}" data-fk="rmv-${k}">Remove visit</button>`}
        </div>
      </div>
      <div class="card-body cs-visit-body">
        <div class="cs-fields cs-f3">
          <div class="cs-field"><label class="micro" for="d-${k}">Visit date</label>
            <input type="date" class="cs-input" id="d-${k}" value="${esc(e.date)}" data-bind="v.${k}.date" data-msgkey="v:${k}:date" data-fk="d-${k}" aria-describedby="m-${slug(`v:${k}:date`)}" required>${msg(`v:${k}:date`)}</div>
          <div class="cs-field"><label class="micro" for="s-${k}">Setting</label>
            <select class="select cs-wide" id="s-${k}" data-bind="v.${k}.setting" data-fk="s-${k}">${[...new Set([...SETTINGS, e.setting])].map((x) => `<option${x === e.setting ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
          <div class="cs-field"><label class="micro" for="c-${k}">Clinician</label>
            <input class="cs-input" id="c-${k}" value="${esc(e.clinician)}" data-bind="v.${k}.clinician" data-fk="c-${k}" autocomplete="off"></div>
        </div>
        <div class="cs-field"><label class="micro" for="t-${k}">Short title <span class="cs-opt">optional</span></label>
          <input class="cs-input" id="t-${k}" value="${esc(e.title)}" data-bind="v.${k}.title" data-fk="t-${k}" autocomplete="off"></div>
        <div class="cs-field"><label class="micro" for="n-${k}">Clinic note</label>
          <textarea class="cs-input cs-note" id="n-${k}" rows="6" data-bind="v.${k}.note" data-fk="n-${k}" aria-describedby="nh-${k}">${esc(e.note)}</textarea>
          <p class="note cs-hint" id="nh-${k}">Paste or type the note as written. Red flags quote it word for word.</p></div>
        <div class="cs-helper-row">
          <button type="button" class="btn sm" data-act="suggest" data-v="${k}" data-fk="sg-${k}"${e.note.trim() ? '' : ' disabled'}>Suggest red flags</button>
          <span class="note">Keyword helper, not AI: a clinician confirms every red flag.</span>
        </div>
        ${suggHtml}
        <div class="cs-sub-h"><h4>Red flags at this visit</h4><span class="note">${esc(plural(e.findings.length, 'red flag'))}</span></div>
        ${flags}
        <div class="cs-pick">
          <div class="cs-field"><label class="micro" for="pq-${k}">Find a red flag</label>
            <input type="search" class="cs-input" id="pq-${k}" data-pick-q="${k}" data-fk="pq-${k}" value="${esc(s.pickQ[k] || '')}" autocomplete="off" aria-controls="ps-${k}"></div>
          <div class="cs-field cs-grow"><label class="micro" for="ps-${k}">Red flag to add</label>
            <select class="select cs-wide" id="ps-${k}" data-pick="${k}" data-fk="ps-${k}">${pickerOptions(s.pickQ[k])}</select></div>
          <button type="button" class="btn sm" data-act="add-flag" data-v="${k}" data-fk="af-${k}">Add red flag</button>
        </div>
        <details class="cs-negs"${negs.length || s.openNegs.has(k) ? ' open' : ''} data-negs="${k}">
          <summary>Recorded but not weighted <span class="faint">${negs.length ? `· ${negs.length}` : '· optional'}</span></summary>
          <p class="note">Things the note rules out (“No numbness”). Shown for context; they never change the number.</p>
          ${negs.length ? `<div class="cs-negs-list">${negs.map((n) => `
            <div class="cs-neg">
              <div class="cs-field"><label class="micro" for="nl-${n._k}">What was ruled out</label><input class="cs-input" id="nl-${n._k}" value="${esc(n.label)}" data-bind="n.${k}.${n._k}.label" data-fk="nl-${n._k}" autocomplete="off"></div>
              <div class="cs-field cs-grow"><label class="micro" for="nq-${n._k}">Words from the note</label><input class="cs-input" id="nq-${n._k}" value="${esc(n.quote)}" data-bind="n.${k}.${n._k}.quote" data-fk="nq-${n._k}" autocomplete="off"></div>
              <button type="button" class="btn sm quiet" data-act="rm-neg" data-v="${k}" data-ng="${n._k}" data-fk="rmn-${n._k}" aria-label="Remove ${esc(n.label || 'this negative')}">Remove</button>
            </div>`).join('')}</div>` : ''}
          <button type="button" class="btn sm" data-act="add-neg" data-v="${k}" data-fk="an-${k}">Add a negative</button>
        </details>
        <div class="cs-field"><label class="micro" for="w-${k}">What actually happened <span class="cs-opt">optional</span></label>
          <input class="cs-input" id="w-${k}" value="${esc(e.whatHappened)}" data-bind="v.${k}.whatHappened" data-fk="w-${k}" autocomplete="off"></div>
      </div>
    </article>`;
}

function editorHtml(s) {
  const d = s.draft;
  const title = s.origin === 'edit' ? 'Editing' : s.origin === 'duplicate' ? 'Copy, not saved yet' : 'New case, not saved yet';
  const tests = d.homeTests.length
    ? `<div class="table-wrap"><table class="tbl cs-tests">
        <thead><tr><th scope="col">Date</th><th scope="col">Test</th><th scope="col">Value</th><th scope="col"><span class="cs-sr">Remove</span></th></tr></thead>
        <tbody>${d.homeTests.map((h) => `<tr>
          <td><label class="cs-sr" for="hd-${h._k}">Test date</label><input type="date" class="cs-input" id="hd-${h._k}" value="${esc(h.date)}" data-bind="h.${h._k}.date" data-msgkey="h:${h._k}:date" data-fk="hd-${h._k}" aria-describedby="m-${slug(`h:${h._k}:date`)}">${msg(`h:${h._k}:date`)}</td>
          <td><label class="cs-sr" for="ht-${h._k}">Test</label><select class="select cs-wide" id="ht-${h._k}" data-bind="h.${h._k}.test" data-msgkey="h:${h._k}:test" data-fk="ht-${h._k}">${Object.entries(HOME_TESTS).map(([id, t]) => `<option value="${id}"${id === h.test ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>${msg(`h:${h._k}:test`)}</td>
          <td><label class="cs-sr" for="hv-${h._k}">Value, ${esc(HOME_TESTS[h.test]?.unit || '')}</label><div class="cs-val"><input type="number" step="any" class="cs-input cs-num" id="hv-${h._k}" value="${esc(h.value ?? '')}" data-bind="h.${h._k}.value" data-msgkey="h:${h._k}:value" data-fk="hv-${h._k}" aria-describedby="m-${slug(`h:${h._k}:value`)}"><span class="note" data-unit="${h._k}">${esc(HOME_TESTS[h.test]?.unit || '')}</span>${h.simulated ? simChip() : ''}</div>${msg(`h:${h._k}:value`)}</td>
          <td><button type="button" class="btn sm quiet" data-act="rm-test" data-h="${h._k}" data-fk="rmt-${h._k}" aria-label="Remove this test value">Remove</button></td>
        </tr>`).join('')}</tbody></table></div>`
    : '<div class="cs-empty-flags">No weekly test values. They are optional.</div>';
  return `
    <section class="cs-editor reveal" aria-labelledby="cs-ed-name">
      <div class="cs-ed-head">
        <div><div class="micro dot">${esc(title)}</div><h2 id="cs-ed-name" class="cs-ed-name">${esc(d.patient.name || 'Unnamed patient')}</h2></div>
        <div class="row cs-ed-btns"><button type="button" class="btn quiet" data-act="cancel" data-fk="cancel-top">Cancel</button><button type="button" class="btn primary" data-act="save" data-fk="save-top">Save case</button></div>
      </div>
      <div class="cs-summary" data-summary role="alert"></div>
      <div class="cs-ed-grid">
        <div class="cs-ed-form">
          <section class="card cs-sec" aria-labelledby="cs-p-h">
            <div class="card-head"><h3 id="cs-p-h">Patient</h3><span class="aside note">Use initials or a label if this is a real patient</span></div>
            <div class="card-body">
              <div class="cs-fields cs-f3">
                <div class="cs-field cs-span2"><label class="micro" for="p-name">Name or case label</label><input class="cs-input" id="p-name" value="${esc(d.patient.name)}" data-bind="p.name" data-msgkey="p:name" data-fk="p-name" aria-describedby="m-p-name" autocomplete="off" required>${msg('p:name')}</div>
                <div class="cs-field"><label class="micro" for="p-age">Age at first visit</label><input type="number" min="0" max="120" step="1" class="cs-input cs-num" id="p-age" value="${esc(d.patient.ageAtFirstVisit ?? '')}" data-bind="p.ageAtFirstVisit" data-msgkey="p:age" data-fk="p-age" aria-describedby="m-p-age">${msg('p:age')}</div>
              </div>
              <div class="cs-fields cs-f3">
                <div class="cs-field"><label class="micro" for="p-sex">Sex</label><select class="select cs-wide" id="p-sex" data-bind="p.sex" data-fk="p-sex">${SEXES.map(([v, l]) => `<option value="${v}"${v === d.patient.sex ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
                <div class="cs-field cs-span2"><label class="micro" for="p-sum">One-line summary <span class="cs-opt">optional</span></label><input class="cs-input" id="p-sum" value="${esc(d.patient.summary)}" data-bind="p.summary" data-fk="p-sum" autocomplete="off"></div>
              </div>
            </div>
          </section>

          <section class="cs-sec" aria-labelledby="cs-v-h">
            <div class="cs-sec-h"><h3 id="cs-v-h">Visits</h3><span class="note">${esc(plural(d.encounters.length, 'visit'))} · kept in date order</span></div>
            ${msg('visits')}
            <div class="cs-visits">${d.encounters.map((e, i) => visitHtml(d, e, i, s)).join('')}</div>
            <button type="button" class="btn" data-act="add-visit" data-fk="add-visit">Add a visit</button>
          </section>

          <section class="card cs-sec" aria-labelledby="cs-r-h">
            <div class="card-head"><h3 id="cs-r-h">Real referral <span class="cs-opt">optional</span></h3></div>
            <div class="card-body">
              <div class="cs-fields cs-f3">
                <div class="cs-field"><label class="micro" for="a-ref">Date of the real EMG or neurology referral</label><input type="date" class="cs-input" id="a-ref" value="${esc(d.actual.referral || '')}" data-bind="a.referral" data-msgkey="a:referral" data-fk="a-ref" aria-describedby="m-a-referral a-ref-h">${msg('a:referral')}</div>
              </div>
              <p class="note" id="a-ref-h">For a look back: the live result compares the tool’s first High with this date, referral to referral.</p>
            </div>
          </section>

          <section class="card cs-sec" aria-labelledby="cs-h-h">
            <div class="card-head"><h3 id="cs-h-h">Weekly test values <span class="cs-opt">optional</span></h3><span class="aside note">Counted only when Home data is on (top bar)</span></div>
            <div class="card-body">
              ${tests}
              <button type="button" class="btn sm cs-add-test" data-act="add-test" data-fk="add-test">Add a test value</button>
            </div>
          </section>

          <div class="cs-ed-foot"><button type="button" class="btn quiet" data-act="cancel" data-fk="cancel-bottom">Cancel</button><button type="button" class="btn primary" data-act="save" data-fk="save-bottom">Save case</button><span class="note">Saved in this browser only. Export it from the library to share.</span></div>
        </div>
        <aside class="panel grid-bg cs-live" aria-labelledby="cs-live-h" data-live></aside>
      </div>
    </section>`;
}

function liveHtml(m, s) {
  const head = `<div class="micro dot" id="cs-live-h">Live result · ${esc(lineLabel(s.line))} referral line</div>`;
  if (m.empty) return `<div class="panel-pad">${head}<p class="cs-live-empty">Add a visit with a date to see the tier.</p></div>`;
  const cur = m.cur;
  const tier = cur.tier;
  const simUsed = cur.state.instances.some((i) => i.simulated);
  const reason = cur.steppedDown ? cur.reason
    : cur.rulesFired.length ? `${plural(cur.rulesFired.length, 'pattern rule')} fired, so it goes straight to High.`
    : `${cur.reason} of ${lineLabel(cur.line)}.`;
  const weighted = [...cur.state.ids].filter((id) => FINDINGS[id] && FINDINGS[id].or != null).length;
  let ref = '';
  if (m.ms) {
    const { firstHigh, referral, monthsVsReferral: mo } = m.ms;
    const verdict = !firstHigh ? 'The tool never reaches High with these visits.'
      : mo > 0 ? `${mo === 1 ? '1 month' : `${mo} months`} earlier than the real referral.`
      : mo === 0 ? 'Same day as the real referral.' : 'Not earlier than the real referral.';
    // A first High from the number alone moves with the line: say so, as the indicator does.
    let why = '';
    if (m.firstEv && !m.firstEv.rulesFired.length) {
      const { line } = m.firstEv;
      const lo = m.firstEv.range.lo;
      const r = m.ruleEv;
      const rmo = r && r.asOf < referral ? monthsBetween(r.asOf, referral) : 0;
      why = `From the number alone, so it moves with the referral line: lowest end ${pctAt(lo, line)} against the ${lineLabel(line)} line${lo < line * 1.5 ? ', only just above it' : ''}. ${r ? `A pattern rule, which does not depend on the line, fires on ${fmtDate(r.asOf)}${rmo > 0 ? ` (${rmo === 1 ? '1 month' : `${rmo} months`} before the real referral)` : ''}.` : 'No pattern rule fires at any visit.'}`;
    }
    ref = `
      <hr>
      <div class="micro">Look back · from the notes only</div>
      <div class="kv"><span>Tool’s first High</span><span class="v">${esc(firstHigh ? fmtDate(firstHigh) : 'none')}</span></div>
      <div class="kv"><span>Real referral</span><span class="v">${esc(fmtDate(referral))}</span></div>
      <p class="cs-live-verdict">${esc(verdict)}</p>${why ? `
      <p class="cs-live-reason">${esc(why)}</p>` : ''}`;
  }
  return `
    <div class="panel-pad">
      ${head}
      <div class="cs-live-tier t-${esc(tier)}" aria-live="polite">${esc(TIER[tier].label)}<span class="cs-sr"> at the latest visit, ${esc(fmtDate(cur.asOf))}</span></div>
      <div class="cs-live-act">${tierChip(tier)}<span>${esc(TIER[tier].action)}</span></div>
      <p class="cs-live-reason">${esc(reason)}</p>
      <div class="cs-live-kvs">
        <div class="kv"><span>Latest visit</span><span class="v">${esc(fmtDate(m.steps[m.steps.length - 1].e.date))}</span></div>
        <div class="kv"><span>95% range${simUsed ? ` ${simChip()}` : ''}</span><span class="v">${esc(rangeText(cur.range, cur.line))}</span></div>
        <div class="kv"><span>Red flags weighted</span><span class="v">${weighted}</span></div>
        <div class="kv"><span>Pattern rules fired</span><span class="v">${cur.rulesFired.length}</span></div>
      </div>
      ${cur.rulesFired.length ? `<ul class="cs-live-rules">${cur.rulesFired.map((r) => `<li>${esc(r.label)}</li>`).join('')}</ul>` : ''}
      <hr>
      <div class="micro">Tier at each visit</div>
      <ol class="cs-live-strip">${m.steps.map(({ e, ev }, i) => `<li><span class="mono cs-ls-n">${String(i + 1).padStart(2, '0')}</span><span class="mono cs-ls-d">${esc(fmtDate(e.date))}</span>${ev ? tierChip(ev.tier) : ''}</li>`).join('')}</ol>
      ${ref}
      <p class="note cs-live-note">Computed now from what you typed${s.includeHome ? ', with weekly test values' : ''}. Nothing is saved until you press Save.</p>
    </div>`;
}

function caseRowHtml(c, s, opts) {
  const res = latestResult(c.caseFile, opts);
  const cur = c.id === s.caseId;
  const ev = res && res.ev;
  const sim = ev && ev.state.instances.some((i) => i.simulated);
  const armed = s.armed === `case:${c.id}`;
  const open = s.exportOpen === c.id;
  const user = c.kind === 'user';
  // the case name for screen readers ("Open Alex Chen"); the visible word stays first
  const nm = `<span class="cs-sr"> ${esc(c.name)}</span>`;
  let exp = '';
  if (open) {
    let json = '';
    try { json = exportCase(c.id); } catch (e) { json = ''; }
    exp = `
      <div class="cs-export" data-export="${esc(c.id)}">
        <label class="micro" for="ex-${slug(c.id)}">Case file as JSON</label>
        <textarea class="cs-input cs-json" id="ex-${slug(c.id)}" rows="7" readonly>${esc(json)}</textarea>
        <div class="row">
          <button type="button" class="btn sm" data-act="copy" data-id="${esc(c.id)}" data-fk="cp-${slug(c.id)}">Copy JSON</button>
          <button type="button" class="btn sm" data-act="download" data-id="${esc(c.id)}" data-fk="dl-${slug(c.id)}">Download .json</button>
          <button type="button" class="btn sm quiet" data-act="export-close" data-fk="xc-${slug(c.id)}">Close</button>
          <span class="note" data-copy-msg="${esc(c.id)}" role="status">If a download is blocked here, use Copy JSON.</span>
        </div>
      </div>`;
  }
  return `
    <article class="cs-case${cur ? ' is-current' : ''}" data-case="${esc(c.id)}">
      <div class="cs-case-top">
        <div class="cs-case-main">
          <div class="cs-case-t"><b>${esc(c.name)}</b>${cur ? '<span class="micro dot cs-current">Open now</span>' : ''}</div>
          <div class="cs-case-sub">${esc(c.subtitle)}</div>
          <div class="cs-case-meta mono">${res ? `${esc(plural(res.n, 'visit'))} · latest ${esc(fmtDate(res.last.date))}` : 'No visits yet'}</div>
        </div>
        <div class="cs-case-tier">${ev ? `${tierChip(ev.tier)}<span class="mono cs-case-range">${esc(rangeText(ev.range, ev.line))}</span>${ev.rulesFired.length ? `<span class="note">${esc(plural(ev.rulesFired.length, 'rule'))} fired</span>` : ''}${sim ? simChip() : ''}` : '<span class="note">No result yet</span>'}</div>
        <div class="cs-case-acts">
          <button type="button" class="btn sm" data-act="open" data-id="${esc(c.id)}" data-fk="op-${slug(c.id)}">Open${nm}</button>
          ${user ? `<button type="button" class="btn sm" data-act="edit" data-id="${esc(c.id)}" data-fk="ed-${slug(c.id)}">Edit${nm}</button>` : ''}
          <button type="button" class="btn sm quiet" data-act="duplicate" data-id="${esc(c.id)}" data-fk="du-${slug(c.id)}">Duplicate${nm}</button>
          <button type="button" class="btn sm quiet" data-act="export" data-id="${esc(c.id)}" data-fk="ex-${slug(c.id)}" aria-expanded="${open}">Export${nm}</button>
          ${user ? (armed
            ? `<button type="button" class="btn sm cs-danger" data-act="delete" data-id="${esc(c.id)}" data-fk="de-${slug(c.id)}">Confirm delete${nm}</button><button type="button" class="btn sm quiet" data-act="disarm" data-fk="dk-${slug(c.id)}">Keep</button>`
            : `<button type="button" class="btn sm quiet" data-act="arm-delete" data-id="${esc(c.id)}" data-fk="de-${slug(c.id)}">Delete${nm}</button>`) : ''}
        </div>
      </div>
      ${armed ? '<p class="cs-confirm note">Deletes this case from this browser. It cannot be undone; export it first to keep a copy.</p>' : ''}
      ${exp}
    </article>`;
}

function libraryHtml(s, opts) {
  const all = listCases();
  return `
    <section class="section cs-lib reveal d1" aria-labelledby="cs-lib-h">
      <div class="section-head"><h2 id="cs-lib-h">Case library</h2><span class="aside">Latest visit at the ${esc(lineLabel(s.line))} referral line${s.includeHome ? ', home data on' : ''}</span></div>
      <div class="cs-groups">${GROUPS.map(([kind, label, sub]) => {
        const items = all.filter((c) => c.kind === kind);
        const body = items.length ? items.map((c) => caseRowHtml(c, s, opts)).join('')
          : `<div class="cs-empty"><p><b>No cases of your own yet.</b> Start one, duplicate a demo to change it, or import a JSON file someone shared.</p><div class="row"><button type="button" class="btn sm" data-act="new" data-fk="new-empty">New case</button><button type="button" class="btn sm quiet" data-act="import" data-fk="import-empty">Import a case</button></div></div>`;
        return `<div class="card cs-group" data-group="${kind}"><div class="card-head"><h3>${esc(label)}</h3><span class="note">${esc(sub)}</span><span class="aside mono cs-count">${items.length}</span></div><div class="cs-rows">${body}</div></div>`;
      }).join('')}</div>
    </section>`;
}

function importHtml(s) {
  return `
    <section class="card cs-import reveal" aria-labelledby="cs-imp-h">
      <div class="card-head"><h3 id="cs-imp-h">Import a case</h3><span class="aside note">Paste a case file exported from this app</span></div>
      <div class="card-body">
        <div class="cs-field"><label class="micro" for="imp-text">Case file JSON</label>
          <textarea class="cs-input cs-json" id="imp-text" rows="8" data-fk="imp-text" aria-describedby="imp-msg" spellcheck="false">${esc(s.importText)}</textarea>
          <div class="cs-msg cs-imp-msg" id="imp-msg" data-imp-msg>${s.importErrors.length ? `<b>Not imported.</b><ul>${s.importErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div></div>
        <div class="row"><button type="button" class="btn primary" data-act="import-go" data-fk="imp-go">Import and open</button><button type="button" class="btn quiet" data-act="import-close" data-fk="imp-close">Cancel</button><span class="note">Unknown red flags are dropped and listed; nothing leaves this browser.</span></div>
      </div>
    </section>`;
}

const fname = (k) => FINDINGS[k.split('|')[0]]?.label || k;
const rname = (k) => REGION_LABEL[k.split('|')[1]] || k.split('|')[1];
function helperHtml() {
  let a;
  let d;
  try { a = measureOnAlex(); d = measureOnDemos(); } catch (e) { return ''; }
  const p = (x) => (x == null ? '–' : `${Math.round(100 * x)}%`);
  const rows = a.perVisit.filter((v) => v.missed.length || v.extra.length).map((v) => `
    <li><span class="mono">${esc(v.id)} · ${esc(fmtDate(v.date))}</span>
      ${v.missed.length ? `<div><b>Missed:</b> ${v.missed.map((k) => `${esc(fname(k))} (${esc(rname(k))})`).join('; ')}</div>` : ''}
      ${v.extra.length ? `<div><b>Not in the hand labels:</b> ${v.extra.map((k) => `${esc(fname(k))} (${esc(rname(k))})`).join('; ')}</div>` : ''}</li>`).join('');
  return `
    <section class="section reveal d2" aria-labelledby="cs-help-h">
      <div class="section-head"><h2 id="cs-help-h">How the note helper did on Alex’s notes</h2><span class="aside">Keyword helper, not AI: a clinician confirms every red flag.</span></div>
      <div class="card cs-helper">
        <div class="cs-helper-stats">
          <div class="cs-hs"><span class="micro">Found</span><span class="stat-s">${a.found} of ${a.labelled}</span><span class="note">red flags picked by hand in the ${esc(plural(a.visits, 'note'))} (recall ${p(a.recall)})</span></div>
          <div class="cs-hs"><span class="micro">Matched</span><span class="stat-s">${a.found} of ${a.suggested}</span><span class="note">suggestions match a hand pick (precision ${p(a.precision)})</span></div>
          <div class="cs-hs"><span class="micro">Look-alike stories</span><span class="stat-s">${d.found} of ${d.labelled}</span><span class="note">found, ${d.found} of ${d.suggested} matched (${esc(plural(d.visits, 'short story', 'short stories'))})</span></div>
        </div>
        <div class="cs-helper-body">
          <p class="note">Compared visit by visit, by red flag and body region. The rules were written while reading these same notes, so this is a best case, not a validation. The hand labels list each sign once per visit, so many extra suggestions are real mentions (for example “Right calf wasting.”); the clinician decides.</p>
          ${rows ? `<details class="cs-helper-d"><summary>What it missed and what it added, by visit</summary><ul class="list">${rows}</ul></details>` : ''}
        </div>
      </div>
    </section>`;
}

// ---------- mount ----------
export function mount(root, ctx) {
  ensureCss(CSS);
  let c = ctx;
  const s = {
    mode: mem ? 'edit' : 'library',
    draft: mem ? mem.draft : null,
    editId: mem ? mem.editId : null,
    origin: mem ? mem.origin : null,
    sugg: mem ? mem.sugg : {},
    touched: mem ? mem.touched : new Set(),
    tried: mem ? mem.tried : false,
    pickQ: {},
    openNegs: new Set(),
    armed: null,
    exportOpen: null,
    importOpen: false,
    importText: '',
    importErrors: [],
    line: c.state.line, includeHome: c.state.includeHome, caseId: c.state.caseId,
  };
  const keep = () => { mem = s.mode === 'edit' ? { draft: s.draft, editId: s.editId, origin: s.origin, sugg: s.sugg, touched: s.touched, tried: s.tried } : null; };
  let liveTimer = null;
  const opts = () => ({ ...c.opts, exclude: new Set() });

  root.innerHTML = `
    <div class="cs">
      <header class="view-head reveal">
        <div class="micro dot">Workspace · Cases</div>
        <h1 class="title two-tone">Cases <span class="soft">Any patient, the same red-flag rules.</span></h1>
        <p class="lede">Enter the visits and red flags from any patient’s notes, and the indicator, patient app and monitoring update for that patient. Cases are saved in this browser only; export one to share it.</p>
      </header>
      <div class="cs-bar" data-part="bar"></div>
      <div data-part="flash"></div>
      <div data-part="main"></div>
      <div data-part="helper">${helperHtml()}</div>
    </div>`;
  const part = (k) => root.querySelector(`[data-part="${k}"]`);
  const wrap = root.querySelector('.cs');
  const css = document.querySelector(`link[data-view-css="${CSS}"]`);
  if (css && !css.sheet) {
    wrap.style.visibility = 'hidden';
    const show = () => { wrap.style.visibility = ''; };
    css.addEventListener('load', show, { once: true });
    css.addEventListener('error', show, { once: true });
    setTimeout(show, 2500);
  }

  function renderBar() {
    const mine = listCases().filter((x) => x.kind === 'user').length;
    part('bar').innerHTML = s.mode === 'edit' ? '' : `
      <button type="button" class="btn primary" data-act="new" data-fk="new">New case</button>
      <button type="button" class="btn" data-act="import" data-fk="import" aria-expanded="${s.importOpen}">Import a case</button>
      <span class="note">${esc(plural(mine, 'case'))} of yours, saved in this browser</span>`;
  }
  function renderFlash() {
    if (flash) flash.shown = true;
    part('flash').innerHTML = flash ? `<div class="cs-flash ${flash.tone === 'warn' ? 'is-warn' : ''}" role="status"><div>${flash.html}</div><button type="button" class="btn sm quiet" data-act="flash-close" data-fk="flash-close">Dismiss</button></div>` : '';
  }
  function render() {
    const fk = root.contains(document.activeElement) ? document.activeElement.getAttribute('data-fk') : null;
    renderBar();
    renderFlash();
    if (s.mode === 'edit') {
      part('main').innerHTML = editorHtml(s);
      part('helper').hidden = true;
      refreshLive();
      refreshMessages();
    } else {
      part('main').innerHTML = `${s.importOpen ? importHtml(s) : ''}${libraryHtml(s, opts())}`;
      part('helper').hidden = false;
    }
    if (fk) {
      const t = root.querySelector(`[data-fk="${CSS_escape(fk)}"]`);
      if (t && !t.disabled) t.focus({ preventScroll: true });
    }
  }
  const CSS_escape = (x) => (window.CSS && CSS.escape ? CSS.escape(x) : String(x).replace(/["\\]/g, '\\$&'));

  function refreshLive() {
    const box = root.querySelector('[data-live]');
    if (!box) return;
    let html;
    try { html = liveHtml(liveModel(s.draft, opts()), s); } catch (e) { console.error(e); html = `<div class="panel-pad"><p class="cs-live-empty">The result could not be computed: ${esc(e.message || e)}</p></div>`; }
    box.innerHTML = html;
  }
  function scheduleLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { refreshLive(); refreshMessages(); }, 250);
  }
  function refreshMessages() {
    if (s.mode !== 'edit') return;
    const { err, warn } = validate(s.draft);
    root.querySelectorAll('[data-msg]').forEach((m) => {
      const k = m.dataset.msg;
      const show = s.tried || s.touched.has(k);
      const e = show ? err[k] : null;
      const w = warn[k];
      m.textContent = e || w || '';
      m.className = `cs-msg${e ? ' is-err' : w ? ' is-warn' : ''}`;
    });
    root.querySelectorAll('[data-msgkey]').forEach((inp) => {
      const k = inp.dataset.msgkey;
      if ((s.tried || s.touched.has(k)) && err[k]) inp.setAttribute('aria-invalid', 'true');
      else inp.removeAttribute('aria-invalid');
    });
    const sum = root.querySelector('[data-summary]');
    if (sum) {
      const list = Object.values(err);
      sum.innerHTML = s.tried && list.length ? `<b>Fix ${esc(plural(list.length, 'thing'))} before saving.</b><ul>${[...new Set(list)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
      sum.hidden = !(s.tried && list.length);
    }
  }

  // ---------- editor actions ----------
  const visit = (k) => s.draft.encounters.find((e) => e._k === k);
  function startEdit(draft, editId, origin) {
    s.mode = 'edit';
    s.draft = draft;
    s.editId = editId;
    s.origin = origin;
    s.sugg = {};
    s.touched = new Set();
    s.tried = false;
    s.armed = null;
    s.importOpen = false;
    flash = null;
    keep();
    render();
    const head = root.querySelector('.cs-editor');
    if (head) { head.scrollIntoView({ block: 'start' }); const f = root.querySelector('#p-name'); if (f) f.focus({ preventScroll: true }); }
  }
  function stopEdit() {
    s.mode = 'library';
    s.draft = null;
    mem = null;
    render();
    window.scrollTo(0, 0);
  }
  function sortVisits() {
    const before = s.draft.encounters.map((e) => e._k).join();
    s.draft.encounters.sort((a, b) => (validDate(a.date) ? a.date : '9999').localeCompare(validDate(b.date) ? b.date : '9999'));
    return before !== s.draft.encounters.map((e) => e._k).join();
  }
  function save() {
    s.tried = true;
    sortVisits();
    const { err } = validate(s.draft);
    if (Object.keys(err).length) {
      render();
      const first = Object.keys(err)[0];
      const inp = root.querySelector(`[data-msgkey="${CSS_escape(first)}"]`) || root.querySelector('[data-summary]');
      if (inp) { inp.scrollIntoView({ block: 'center' }); if (inp.focus) inp.focus({ preventScroll: true }); }
      return;
    }
    const check = normalizeCase(fromDraft(s.draft));
    if (check.errors.length) {
      const sum = root.querySelector('[data-summary]');
      if (sum) { sum.hidden = false; sum.innerHTML = `<b>Not saved.</b><ul>${check.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; sum.scrollIntoView({ block: 'center' }); }
      return;
    }
    const res = saveUserCase(fromDraft(s.draft), s.editId);
    const name = res.caseFile.patient.name;
    flash = { tone: res.errors.length ? 'warn' : 'ok', html: `<b>Saved ${esc(name)}.</b> It is now the open patient: the indicator, patient app and monitoring show this case. <a href="#indicator">Open the indicator</a>${res.errors.length ? `<ul>${res.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` };
    mem = null;
    s.mode = 'library';
    c.setState({ casesRev: (c.state.casesRev || 0) + 1, caseId: res.id, asOf: defaultVisit(res.caseFile) || c.state.asOf, exclude: [] });
  }

  function onClick(e) {
    const b = e.target.closest('button[data-act]');
    if (!b || !root.contains(b) || b.disabled) return;
    const act = b.dataset.act;
    const k = b.dataset.v;
    const id = b.dataset.id;
    if (act === 'new') { const d = toDraft(newCaseTemplate()); d.encounters.push(newVisit(d)); startEdit(d, null, 'new'); return; }
    if (act === 'import') { s.importOpen = true; s.importErrors = []; render(); const t = root.querySelector('#imp-text'); if (t) t.focus(); return; }
    if (act === 'import-close') { s.importOpen = false; s.importText = ''; s.importErrors = []; render(); return; }
    if (act === 'import-go') { doImport(); return; }
    if (act === 'flash-close') { flash = null; renderFlash(); return; }
    if (act === 'open') { c.openCase(id); c.navigate('indicator'); return; }
    if (act === 'edit') { const entry = getCase(id); startEdit(toDraft(entry.caseFile), id, 'edit'); return; }
    if (act === 'duplicate') { const entry = getCase(id); startEdit(toDraft(entry.caseFile, true), null, 'duplicate'); return; }
    if (act === 'export') { s.exportOpen = s.exportOpen === id ? null : id; s.armed = null; render(); return; }
    if (act === 'export-close') { s.exportOpen = null; render(); return; }
    if (act === 'copy') { copyJson(id); return; }
    if (act === 'download') { downloadJson(id); return; }
    if (act === 'arm-delete') { s.armed = `case:${id}`; render(); return; }
    if (act === 'disarm') { s.armed = null; render(); return; }
    if (act === 'delete') {
      const entry = getCase(id);
      deleteUserCase(id);
      flash = { tone: 'ok', html: `<b>Deleted ${esc(entry.name)}</b> from this browser.` };
      const patch = { casesRev: (c.state.casesRev || 0) + 1 };
      if (c.state.caseId === id) Object.assign(patch, { caseId: 'alex', asOf: '2024-12-09', exclude: [] });
      c.setState(patch);
      return;
    }
    if (s.mode !== 'edit') return;
    // editor
    if (act === 'cancel') { stopEdit(); return; }
    if (act === 'save') { save(); return; }
    if (act === 'add-visit') {
      const v = newVisit(s.draft);
      s.draft.encounters.push(v);
      sortVisits();
      keep(); render();
      const t = root.querySelector(`#d-${v._k}`);
      if (t) { t.scrollIntoView({ block: 'center' }); t.focus({ preventScroll: true }); }
      return;
    }
    if (act === 'arm-visit') { s.armed = `visit:${k}`; render(); return; }
    if (act === 'rm-visit') { s.draft.encounters = s.draft.encounters.filter((x) => x._k !== k); delete s.sugg[k]; s.armed = null; keep(); render(); return; }
    if (act === 'suggest') {
      const v = visit(k);
      s.sugg[k] = { note: v.note, list: suggestFindings(v.note).map((x) => ({ ...x, state: 'pending' })) };
      keep(); render();
      return;
    }
    if (act === 'sg-close') { delete s.sugg[k]; keep(); render(); return; }
    if (act === 'sg-accept' || act === 'sg-all') {
      const v = visit(k);
      const sg = s.sugg[k];
      const have = new Set(v.findings.map((f) => `${f.id}|${f.region}`));
      const pick = act === 'sg-all' ? sg.list.filter((x) => x.state === 'pending') : [sg.list[Number(b.dataset.i)]];
      for (const x of pick) {
        if (!x) continue;
        if (!have.has(`${x.id}|${x.region}`)) { v.findings.push({ _k: key(), id: x.id, region: x.region, quote: x.quote }); have.add(`${x.id}|${x.region}`); }
        x.state = 'accepted';
      }
      keep(); render();
      return;
    }
    if (act === 'sg-dismiss') { s.sugg[k].list[Number(b.dataset.i)].state = 'dismissed'; keep(); render(); return; }
    if (act === 'sg-undo') { s.sugg[k].list[Number(b.dataset.i)].state = 'pending'; keep(); render(); return; }
    if (act === 'add-flag') {
      const sel = root.querySelector(`[data-pick="${CSS_escape(k)}"]`);
      const fid = sel && sel.value;
      if (!fid || !FINDINGS[fid]) return;
      const f = { _k: key(), id: fid, region: FINDINGS[fid].region || '', quote: '' };
      visit(k).findings.push(f);
      keep(); render();
      const t = root.querySelector(`#${f.region ? 'q' : 'rg'}-${f._k}`);
      if (t) t.focus();
      return;
    }
    if (act === 'rm-flag') { const v = visit(k); v.findings = v.findings.filter((f) => f._k !== b.dataset.fl); keep(); render(); return; }
    if (act === 'add-neg') { const n = { _k: key(), label: '', quote: '' }; visit(k).negatives.push(n); s.openNegs.add(k); keep(); render(); const t = root.querySelector(`#nl-${n._k}`); if (t) t.focus(); return; }
    if (act === 'rm-neg') { const v = visit(k); v.negatives = v.negatives.filter((n) => n._k !== b.dataset.ng); keep(); render(); return; }
    if (act === 'add-test') {
      const last = s.draft.homeTests[s.draft.homeTests.length - 1];
      const lastVisit = s.draft.encounters[s.draft.encounters.length - 1];
      const h = { _k: key(), date: last ? last.date : (lastVisit && validDate(lastVisit.date) ? lastVisit.date : today()), test: last ? last.test : 'tap_right', value: '', simulated: false };
      s.draft.homeTests.push(h);
      keep(); render();
      const t = root.querySelector(`#hv-${h._k}`);
      if (t) t.focus();
      return;
    }
    if (act === 'rm-test') { s.draft.homeTests = s.draft.homeTests.filter((h) => h._k !== b.dataset.h); keep(); render(); }
  }

  function setBound(path, value) {
    const p = path.split('.');
    const d = s.draft;
    if (p[0] === 'p') { d.patient[p[1]] = value; if (p[1] === 'name') { const h = root.querySelector('#cs-ed-name'); if (h) h.textContent = value.trim() || 'Unnamed patient'; } return; }
    if (p[0] === 'a') { d.actual[p[1]] = value; return; }
    if (p[0] === 'v') {
      const v = visit(p[1]);
      if (!v) return;
      v[p[2]] = value;
      if (p[2] === 'date' || p[2] === 'setting') { const h = root.querySelector(`[data-vhead="${CSS_escape(p[1])}"]`); if (h) h.textContent = `${validDate(v.date) ? fmtDate(v.date) : 'Date not set'} · ${v.setting}`; }
      if (p[2] === 'note') { const btn = root.querySelector(`[data-act="suggest"][data-v="${CSS_escape(p[1])}"]`); if (btn) btn.disabled = !value.trim(); }
      return;
    }
    if (p[0] === 'f') { const v = visit(p[1]); const f = v && v.findings.find((x) => x._k === p[2]); if (f) f[p[3]] = value; return; }
    if (p[0] === 'n') { const v = visit(p[1]); const n = v && v.negatives.find((x) => x._k === p[2]); if (n) n[p[3]] = value; return; }
    if (p[0] === 'h') {
      const h = s.draft.homeTests.find((x) => x._k === p[1]);
      if (!h) return;
      h[p[2]] = value;
      if (p[2] === 'test') { const u = root.querySelector(`[data-unit="${CSS_escape(p[1])}"]`); if (u) u.textContent = HOME_TESTS[value]?.unit || ''; }
    }
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset && t.dataset.pickQ) {
      s.pickQ[t.dataset.pickQ] = t.value;
      const sel = root.querySelector(`[data-pick="${CSS_escape(t.dataset.pickQ)}"]`);
      if (sel) sel.innerHTML = pickerOptions(t.value);
      return;
    }
    if (t.id === 'imp-text') { s.importText = t.value; return; }
    if (s.mode !== 'edit' || !t.dataset || !t.dataset.bind) return;
    setBound(t.dataset.bind, t.value);
    if (t.dataset.msgkey && e.type === 'change') s.touched.add(t.dataset.msgkey);
    keep();
    scheduleLive();
  }
  function onFocusOut(e) {
    const t = e.target;
    if (s.mode !== 'edit' || !t.dataset) return;
    if (t.dataset.msgkey) { s.touched.add(t.dataset.msgkey); refreshMessages(); }
    if (/^v\.[^.]+\.date$/.test(t.dataset.bind || '') && sortVisits()) {
      keep();
      // let focus land on its next target before the cards move
      setTimeout(() => render(), 0);
    }
  }
  function onKey(e) {
    const t = e.target;
    if (e.key === 'Enter' && t.dataset && t.dataset.pickQ) {
      e.preventDefault();
      const btn = root.querySelector(`[data-act="add-flag"][data-v="${CSS_escape(t.dataset.pickQ)}"]`);
      if (btn) btn.click();
    }
  }
  function onToggle(e) {
    const d = e.target;
    if (d && d.matches && d.matches('details[data-negs]')) { if (d.open) s.openNegs.add(d.dataset.negs); else s.openNegs.delete(d.dataset.negs); }
  }

  // ---------- import / export ----------
  function doImport() {
    const text = (root.querySelector('#imp-text') || {}).value || '';
    s.importText = text;
    let data;
    try { data = JSON.parse(text); } catch { s.importErrors = ['That is not valid JSON. Paste the whole file, starting with { and ending with }.']; render(); return; }
    const { caseFile, errors } = normalizeCase(data);
    const blocking = errors.filter((x) => !/unknown red flag/.test(x));
    if (blocking.length || !caseFile.encounters.length) { s.importErrors = blocking.length ? blocking : ['The file has no visits.']; render(); return; }
    const res = importCase(text);
    if (!res.id) { s.importErrors = res.errors.length ? res.errors : ['The case could not be imported.']; render(); return; }
    const saved = getCase(res.id);
    flash = { tone: errors.length ? 'warn' : 'ok', html: `<b>Imported ${esc(saved.name)}</b> and opened it in the app. <a href="#indicator">Open the indicator</a>${errors.length ? `<div>Dropped while importing:</div><ul>${errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}` };
    c.setState({ casesRev: (c.state.casesRev || 0) + 1, caseId: res.id, asOf: defaultVisit(saved.caseFile) || c.state.asOf, exclude: [] });
  }
  function setCopyMsg(id, text) {
    const m = root.querySelector(`[data-copy-msg="${CSS_escape(id)}"]`);
    if (m) m.textContent = text;
  }
  function copyJson(id) {
    const ta = root.querySelector(`#ex-${slug(id)}`);
    const text = ta ? ta.value : exportCase(id);
    const fallback = () => {
      try {
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        setCopyMsg(id, ok ? 'Copied.' : 'Copy is blocked here: the text is selected, press Ctrl+C.');
      } catch { setCopyMsg(id, 'Copy is blocked here: select the text and copy it.'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => setCopyMsg(id, 'Copied.'), fallback);
    else fallback();
  }
  function downloadJson(id) {
    try {
      const entry = getCase(id);
      const blob = new Blob([exportCase(id)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug(entry.name).toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '') || 'case'}.rfn-case.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setCopyMsg(id, 'Download started. If nothing arrives, use Copy JSON.');
    } catch { setCopyMsg(id, 'Download is blocked here: use Copy JSON.'); }
  }

  function measureBar() {
    const bar = document.querySelector('.topbar');
    const h = bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
    wrap.style.setProperty('--cs-sticky', `${h + 16}px`);
  }
  measureBar();
  window.addEventListener('resize', measureBar);

  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('focusout', onFocusOut);
  root.addEventListener('keydown', onKey);
  root.addEventListener('toggle', onToggle, true);
  render();

  return {
    update(next) {
      c = next;
      const changed = s.line !== c.state.line || s.includeHome !== c.state.includeHome;
      s.line = c.state.line; s.includeHome = c.state.includeHome; s.caseId = c.state.caseId;
      if (!changed) return;
      if (s.mode === 'edit') refreshLive();
      else render();
    },
    unmount() {
      clearTimeout(liveTimer);
      window.removeEventListener('resize', measureBar);
      if (flash && flash.shown) flash = null;
      keep();
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onInput);
      root.removeEventListener('focusout', onFocusOut);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('toggle', onToggle, true);
    },
  };
}
