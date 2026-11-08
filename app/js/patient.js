// Patient view (patient.html): what Alex would see on his phone for a chosen visit date.
// It carries the same facts as the doctor dashboard: one engine call (evaluateAt) with
// the same shared settings (localStorage rfn.*), in gentler words. Every number on the
// page comes from engine.js, weights.js or alex.js at run time; none is typed in here.
import {
  evaluateAt, detectDecline, formatPct,
  ACTIONS, FINDINGS, SOURCES, PRIOR, HOME_TESTS, DEFAULT_REFERRAL_LINE, UNCLEAR_DEADLINE_WEEKS,
} from './engine.js';
import { REFERRAL_LINES } from './weights.js';

export const DEFAULT_DATE = '2024-12-09';
export const TIER_NAME = { high: 'High', unclear: 'Unclear', low: 'Low' };
const DAY = 86400000;
const AREAS = ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtDate = (d, month = 'short') => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month, year: 'numeric', timeZone: 'UTC' });
export const addWeeks = (d, w) => new Date(Date.parse(`${d}T00:00:00Z`) + w * 7 * DAY).toISOString().slice(0, 10);
export const pctRange = (r) => `${formatPct(r.lo)} to ${formatPct(r.hi)}`;
const fmtLine = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || formatPct(v);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const r1 = (x) => String(Math.round(x * 10) / 10);
const SIM = '<span class="sim-tag">SIMULATED</span>';
const ASSUME = '<span class="assume-tag">ASSUMPTION</span>';

// ---------- shared settings (the same keys the doctor dashboard writes) ----------
export function readSettings(storage) {
  const get = (k) => { try { return storage ? storage.getItem(k) : null; } catch { return null; } };
  // Same parsing rules as the doctor dashboard (doctor.js readStore), so both views
  // always evaluate with identical settings: the line is a fraction between 0 and 1.
  const lineRaw = parseFloat(get('rfn.referralLine'));
  const referralLine = Number.isFinite(lineRaw) && lineRaw > 0 && lineRaw < 1 ? lineRaw : DEFAULT_REFERRAL_LINE;
  // Simulated home tests are off unless the doctor dashboard switched them on.
  const includeHomeTests = get('rfn.includeHomeTests') === 'true';
  const mdc = {};
  try {
    const raw = JSON.parse(get('rfn.mdc') || '{}');
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v && typeof v === 'object' ? v.mdc : v);
        if (HOME_TESTS[k] && Number.isFinite(n) && n > 0) mdc[k] = n;
      }
    }
  } catch { /* no measured values yet: the engine uses its placeholders */ }
  return { referralLine, includeHomeTests, mdc };
}

// ---------- body areas, in the patient's words ----------
// The side comes from the quoted sentences themselves: the side most quotes name,
// unless any quote says both sides ("both forearms", "all four limbs").
export function sideOf(quotes) {
  if (quotes.some((q) => /\b(both|bilateral|all four)\b/i.test(q))) return null;
  const right = quotes.filter((q) => /\bright\b/i.test(q)).length;
  const left = quotes.filter((q) => /\bleft\b/i.test(q)).length;
  if (right > left) return 'right';
  if (left > right) return 'left';
  return null;
}

export function areaTitle(region, side) {
  if (region === 'arm') return side ? `Your ${side} hand and arm` : 'Your hands and arms';
  if (region === 'leg') return side ? `Your ${side} leg and foot` : 'Your legs and feet';
  return {
    bulbar: 'Your speech and swallowing',
    breathing: 'Your breathing',
    general: 'Your general health',
    cognitive: 'Your mood and thinking',
  }[region] || 'Other things your doctors noted';
}

export function groupByArea(instances) {
  const groups = new Map();
  for (const inst of instances) {
    const region = AREAS.includes(inst.region) ? inst.region : 'other';
    if (!groups.has(region)) groups.set(region, { region, quotes: [], items: new Map() });
    const g = groups.get(region);
    g.quotes.push(inst.quote || '');
    if (!g.items.has(inst.id)) {
      const f = FINDINGS[inst.id] || {};
      g.items.set(inst.id, { id: inst.id, plain: cap(f.plain || f.label || inst.id), seen: [], simulated: false, home: false });
    }
    const it = g.items.get(inst.id);
    it.seen.push({ date: inst.date, setting: inst.setting || '' });
    if (inst.simulated) it.simulated = true;
    if (inst.kind === 'home') it.home = true;
  }
  const order = [...AREAS, 'other'];
  return [...groups.values()]
    .sort((a, b) => order.indexOf(a.region) - order.indexOf(b.region))
    .map((g) => ({
      region: g.region,
      title: areaTitle(g.region, sideOf(g.quotes)),
      items: [...g.items.values()].map((it) => ({ ...it, seen: it.seen.sort((a, b) => a.date.localeCompare(b.date)) })),
    }));
}

// ---------- why, in calm and honest words (one sentence per rule that fired) ----------
const PLAIN_RULE = {
  split_hand: 'The pattern of muscle loss in your hand does not fit one trapped nerve.',
  unexplained_weakness: 'The test for the first suspected cause came back normal, but the weakness is still there.',
  umn_lmn: 'Some reflexes are livelier than expected in a limb that is also weak, thinner or twitching.',
  multi_region: 'Changes have now been noted in more than one part of your body.',
};

export function whyFor(ev) {
  const inst = ev.state.instances;
  const visits = new Set(inst.filter((i) => i.kind === 'note').map((i) => i.encounterId)).size;
  if (ev.tier === 'high') {
    return {
      intro: `Each of these changes can have everyday causes. Together${visits > 1 ? ', and noted at more than one visit' : ''}, they are worth a closer look.`,
      points: ev.rulesFired.length
        ? ev.rulesFired.map((r) => PLAIN_RULE[r.id] || r.label)
        : ['Taken together, the changes noted so far are above the level at which your doctor asks for a nerve and muscle test.'],
      calm: 'The nerve and muscle test (called an EMG) also finds the more common causes, like a trapped nerve. Being sent for it does not mean anything has been decided.',
    };
  }
  if (ev.tier === 'unclear') {
    return {
      intro: 'Some of these changes are worth watching for a few weeks.',
      points: ['Taken together, they are close to the level at which your doctor asks for a nerve and muscle test. A few weeks of short check-ins will show whether things are steady or changing.'],
      calm: 'Watching for a few weeks is a careful step. It does not mean anything has been decided.',
    };
  }
  return {
    intro: !inst.length ? 'Nothing has been noted yet that needs a closer look.'
      : ev.steppedDown ? `Your weekly check-ins stayed steady for ${UNCLEAR_DEADLINE_WEEKS} weeks, with no drop bigger than normal week-to-week variation.`
      : 'The changes noted so far are below the level at which your doctor asks for a nerve and muscle test.',
    points: [],
    calm: 'That can change if new symptoms appear, so it helps to know what to look out for.',
  };
}

// ---------- what happens next ----------
export function stepsFor(ev, asOf) {
  if (ev.tier === 'high') {
    return [
      { when: 'Now', text: 'Your doctor sends a referral for an EMG, a nerve and muscle test, and an assessment by a nerve and muscle specialist.' },
      { when: 'Every week while you wait', text: 'A short check-in on your phone, at the same time of day. If a result gets worse by more than normal variation two weeks in a row, your doctor sees it, and the referral can be moved up.' },
      { when: 'At the appointment', text: 'The specialist does the EMG and looks at your check-ins.' },
      { when: 'Afterwards', text: 'Your doctor goes through the results with you, and what they mean for you.' },
    ];
  }
  if (ev.tier === 'unclear') {
    const by = addWeeks(ev.unclearSince || asOf, UNCLEAR_DEADLINE_WEEKS);
    return [
      { when: 'Now', text: 'Short weekly check-ins start on your phone, and your doctor orders a nerve conduction study (a test of how well your nerves carry signals).' },
      { when: `By ${fmtDate(by)} (week ${UNCLEAR_DEADLINE_WEEKS})`, text: 'You and your doctor look at the trend together and decide: more tests, or none needed.' },
      { when: 'Sooner, if things change', text: 'If a check-in gets worse by more than normal variation two weeks in a row, or a change appears in another part of your body, the referral goes ahead straight away.' },
    ];
  }
  return [
    { when: 'Now', text: 'Nothing to book.' },
    { when: 'Any time', text: ACTIONS.low.patient.next },
  ];
}

// ---------- weekly check-ins ----------
export function checkins(caseFile, asOf, opts = {}) {
  const byTest = {};
  for (const h of caseFile.homeTests || []) {
    if (h.date <= asOf && HOME_TESTS[h.test]) (byTest[h.test] = byTest[h.test] || []).push(h);
  }
  return Object.keys(HOME_TESTS).filter((t) => byTest[t]).map((test) => {
    const series = [...byTest[test]].sort((a, b) => a.date.localeCompare(b.date));
    const meta = HOME_TESTS[test];
    const measured = opts.mdc && opts.mdc[test];
    const mdc = measured || meta.placeholderMdc;
    const decline = detectDecline(series, { mdc, higherIsBetter: meta.higherIsBetter });
    const baseline = series.length >= 2 ? (series[0].value + series[1].value) / 2 : null;
    return {
      test, meta, series, n: series.length, latest: series[series.length - 1], baseline, mdc,
      measured: !!measured, decline, simulated: series.some((s) => s.simulated),
    };
  });
}

// ---------- the whole view as plain data (testable in Node) ----------
export function buildModel(caseFile, asOf, opts = {}) {
  const ev = evaluateAt(caseFile, asOf, opts);
  const encs = [...(caseFile.encounters || [])].sort((a, b) => a.date.localeCompare(b.date));
  const visit = encs.filter((e) => e.date <= asOf).pop() || null;
  const act = ACTIONS[ev.tier];
  const instances = [...ev.state.instances].sort((a, b) => a.date.localeCompare(b.date));
  return {
    asOf, ev, tier: ev.tier, visit,
    headline: act.patient.headline,
    next: act.patient.next,
    areas: groupByArea(instances),
    why: whyFor(ev),
    steps: stepsFor(ev, asOf),
    checkins: checkins(caseFile, asOf, opts),
    includeHomeTests: opts.includeHomeTests !== false,
    firstHomeTest: (caseFile.homeTests || []).map((h) => h.date).sort()[0] || null,
    details: {
      range: ev.range, line: ev.line, reason: ev.reason,
      tierName: TIER_NAME[ev.tier], byNumberName: TIER_NAME[ev.byNumber], byNumber: ev.byNumber,
      rules: ev.rulesFired.map((r) => ({ id: r.id, label: r.label, why: r.why, source: SOURCES[r.source]?.short || r.source, assumption: r.source === 'assumption' })),
      findings: instances.map((i) => {
        const f = FINDINGS[i.id] || {};
        return {
          key: i.key, date: i.date, kind: i.kind, quote: i.quote, simulated: !!i.simulated,
          setting: i.setting || (i.kind === 'home' ? 'Weekly check-in' : ''),
          label: f.label || i.id,
          source: SOURCES[f.source]?.short || '',
          assumption: f.source === 'assumption',
          weight: f.or == null ? 'pattern sign: sets off a rule, adds no weight' : `odds ratio ${f.or} (95% CI ${f.lo} to ${f.hi})`,
        };
      }),
      negatives: encs.filter((e) => e.date <= asOf).flatMap((e) => (e.negatives || []).map((n) => ({ date: e.date, setting: e.setting, label: n.label, quote: n.quote }))),
      prior: PRIOR.label, horizonYears: PRIOR.horizonYears, nSims: ev.range.nSims,
      // true when a SIMULATED check-in result carries weight in the range (Alex's demo data)
      simulatedInRange: ev.state.instances.some((i) => i.simulated && FINDINGS[i.id]?.or != null),
    },
    judge: { doctor: `${pctRange(ev.range)}, ${TIER_NAME[ev.tier]}`, patient: act.patient.headline },
  };
}

// ---------- rendering ----------
const LOG_MIN = 1e-4; // 0.01%
const TICKS = [[1e-4, '0.01%'], [1e-3, '0.1%'], [1e-2, '1%'], [1e-1, '10%'], [1, '100%']];
const logPos = (p) => {
  const v = Math.min(1, Math.max(LOG_MIN, p));
  return ((Math.log10(v) - Math.log10(LOG_MIN)) / (0 - Math.log10(LOG_MIN))) * 100;
};

export function rangeBar(range, line) {
  const l = logPos(range.lo);
  const r = logPos(range.hi);
  return `<div class="rbar" role="img" aria-label="Range ${esc(pctRange(range))}, referral line ${esc(fmtLine(line))}">
    <div class="rbar-track">
      <div class="rbar-range" style="left:${l.toFixed(2)}%;width:${Math.max(1, r - l).toFixed(2)}%"></div>
      <div class="rbar-line" style="left:${logPos(line).toFixed(2)}%"><span>referral line ${esc(fmtLine(line))}</span></div>
    </div>
    <div class="rbar-ticks">${TICKS.map(([v, t]) => `<span style="left:${logPos(v).toFixed(2)}%">${t}</span>`).join('')}</div>
    <div class="rbar-caption">Estimate: <b>${esc(pctRange(range))}</b> <small>(log scale)</small></div>
  </div>`;
}

function seenText(it) {
  if (it.home) return `Weekly check-in, from ${fmtDate(it.seen[0].date)}`;
  const dates = [...new Set(it.seen.map((s) => s.date))];
  if (dates.length === 1) return `Noted ${fmtDate(dates[0])}${it.seen[0].setting ? ` · ${esc(it.seen[0].setting)}` : ''}`;
  return `Noted at ${dates.length} visits, first on ${fmtDate(dates[0])}`;
}

function sparkline(c) {
  const pts = c.series;
  if (pts.length < 2) return '';
  const w = 132; const h = 40; const pad = 4;
  const vals = pts.map((p) => p.value).concat(c.baseline != null ? [c.baseline] : []);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / span) * (h - 2 * pad);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const base = c.baseline != null ? `<line class="spark-base" x1="${pad}" x2="${w - pad}" y1="${y(c.baseline).toFixed(1)}" y2="${y(c.baseline).toFixed(1)}"/>` : '';
  const last = pts[pts.length - 1];
  return `<svg class="spark ${c.decline ? 'down' : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">${base}<polyline points="${line}"/><circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="3"/></svg>`;
}

function checkinStatus(c) {
  const unit = esc(c.meta.unit);
  const variation = `±${r1(c.mdc)} ${unit}${c.measured ? ' (measured by the team)' : ` ${ASSUME} placeholder until the team measures it`}`;
  if (c.decline) {
    return { cls: 'down', text: `Worse than your starting point by more than normal variation, two weeks in a row (since ${fmtDate(c.decline.date)}). Your doctor can see this. <small>Normal variation: ${variation}</small>` };
  }
  if (c.n < 4) {
    return { cls: 'wait', text: `Setting your starting point: ${c.n} weekly result${c.n === 1 ? '' : 's'} so far. Changes are counted from the 4th result.` };
  }
  return { cls: 'ok', text: `Steady: no change bigger than normal variation. <small>Normal variation: ${variation}</small>` };
}

function renderCheckins(m) {
  const off = m.includeHomeTests ? '' : '<p class="pv-off">Check-ins are switched off in the doctor dashboard settings, so they are not counted in the result above.</p>';
  if (!m.checkins.length) {
    const later = m.firstHomeTest && m.firstHomeTest > m.asOf ? ` In this demo, Alex's simulated check-ins start on ${fmtDate(m.firstHomeTest)}.` : '';
    return `${off}<p>No check-ins yet. Your doctor sets them up when they are needed.${later}</p>`;
  }
  const rows = m.checkins.map((c) => {
    const s = checkinStatus(c);
    const latest = `Latest: <b>${r1(c.latest.value)}</b> ${esc(c.meta.unit)} on ${fmtDate(c.latest.date)}${c.baseline != null ? ` · starting point ${r1(c.baseline)}` : ''}`;
    return `<li class="ci ${s.cls}">
      <div class="ci-text"><div class="ci-name">${esc(c.meta.label)} ${c.simulated ? SIM : ''}</div>
        <div class="ci-latest">${latest}</div>
        <div class="ci-status">${s.text}</div></div>
      ${sparkline(c)}
    </li>`;
  }).join('');
  return `${off}<ul class="ci-list">${rows}</ul>`;
}

function renderDetails(m) {
  const d = m.details;
  const rules = d.rules.length
    ? `<ul class="pv-rules">${d.rules.map((r) => `<li><b>${esc(r.label)}.</b> ${esc(r.why)} <small class="muted">Source: ${esc(r.source)}</small> ${r.assumption ? ASSUME : ''}</li>`).join('')}</ul>`
    : '<p class="muted">No pattern rule applied on this date.</p>';
  const findings = d.findings.length
    ? `<ul class="pv-flist">${d.findings.map((f) => `<li>
        <div class="pv-fhead"><b>${esc(f.label)}</b> ${f.simulated ? SIM : ''} ${f.assumption ? ASSUME : ''}</div>
        <blockquote class="quote">${esc(f.quote)}</blockquote>
        <small class="muted">${fmtDate(f.date)}${f.setting ? ` · ${esc(f.setting)}` : ''} · ${esc(f.source)}: ${esc(f.weight)}</small>
      </li>`).join('')}</ul>`
    : '<p class="muted">No findings in the notes up to this date.</p>';
  const negatives = d.negatives.length
    ? `<h4>Checked and found normal</h4><ul class="pv-neg">${d.negatives.map((n) => `<li><b>${esc(n.label)}</b> <span class="muted">(${fmtDate(n.date)}, ${esc(n.setting)})</span><br><span class="pv-negq">“${esc(n.quote)}”</span></li>`).join('')}</ul>`
    : '';
  const byNumber = d.byNumber !== m.tier
    ? `<p class="muted">By the number alone this would be <span class="tier ${esc(d.byNumber)}">${esc(d.byNumberName)}</span>; a pattern rule moves it to ${esc(d.tierName)}.</p>`
    : '';
  return `<details class="pv-card pv-details" id="pv-details">
    <summary>See everything your doctor sees</summary>
    <p class="pv-note">The conditions being checked include problems with the nerves that control muscles, such as ALS (amyotrophic lateral sclerosis, a type of motor neuron disease). More common problems, like a trapped nerve, can cause similar changes, and the same tests look for those too.</p>
    <h4>Your doctor's screen</h4>
    <p>Result: <span class="tier ${esc(m.tier)}">${esc(d.tierName)}</span> <span class="muted">${esc(d.reason)}</span></p>
    ${byNumber}
    ${rangeBar(d.range, d.line)}
    ${d.simulatedInRange ? `<p class="muted">${SIM} This range includes a simulated weekly check-in result (Alex never had check-ins). With home tests not counted on the doctor dashboard, it uses the notes alone.</p>` : ''}
    <p>This is the estimated chance of a motor neuron disease diagnosis within ${esc(d.horizonYears)} years for someone with these findings: <b>${esc(pctRange(d.range))}</b>. It is a range, not one number: the middle 95% of ${esc(d.nSims.toLocaleString('en-CA'))} simulations that carry the uncertainty in the published studies. Starting point: ${esc(d.prior)}. The referral line, ${esc(fmtLine(d.line))}, is a values choice your doctor can change, not a statistic.</p>
    <h4>Rules that applied</h4>
    ${rules}
    <h4>Every finding, with the sentence it came from</h4>
    ${findings}
    ${negatives}
    <p class="pv-rights">You can ask for a copy of your full record at any time. In Ontario, PHIPA gives you the right to see your own health records.</p>
  </details>`;
}

export function renderPhone(m, caseFile) {
  const first = (caseFile.patient?.name || '').split(' ')[0] || 'there';
  const visitLine = m.visit
    ? (m.visit.date === m.asOf ? `After your visit: ${esc(m.visit.setting)}` : `Since your last visit on ${fmtDate(m.visit.date)}`)
    : '';
  const areas = m.areas.length
    ? m.areas.map((a) => `<div class="pv-area area-${esc(a.region)}"><h4>${esc(a.title)}</h4><ul>${a.items.map((it) => `<li><span class="pv-plain">${esc(it.plain)}</span> ${it.simulated ? SIM : ''}<small>${seenText(it)}</small></li>`).join('')}</ul></div>`).join('')
    : '<p>Nothing has been noted yet.</p>';
  const main = `
    <div class="ph-top">
      <div class="ph-hello">Hello ${esc(first)}</div>
      <div class="ph-date">Your care update · ${fmtDate(m.asOf, 'long')}</div>
      ${visitLine ? `<div class="ph-visit">${visitLine}</div>` : ''}
    </div>
    <section class="pv-card pv-hero ${esc(m.tier)}">
      <div class="pv-eyebrow">Your next step</div>
      <h2 id="pv-headline">${esc(m.headline)}</h2>
      <p>${esc(m.next)}</p>
    </section>
    <section class="pv-card"><h3>What we are checking</h3>${areas}</section>
    <section class="pv-card"><h3>Why</h3>
      <p>${esc(m.why.intro)}</p>
      ${m.why.points.length ? `<ul class="pv-points">${m.why.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
      <p class="pv-calm">${esc(m.why.calm)}</p>
    </section>
    <section class="pv-card"><h3>What happens next</h3>
      <ol class="pv-steps">${m.steps.map((s) => `<li><b>${esc(s.when)}</b><span>${esc(s.text)}</span></li>`).join('')}</ol>
    </section>`;
  const checks = `<section class="pv-card"><h3>Your weekly check-ins ${caseFile.homeTests?.some((h) => h.simulated) ? SIM : ''}</h3>
      ${renderCheckins(m)}
      <p class="pv-link"><a href="hometests.html">Open the check-in tests</a> <span class="muted">(finger tapping works in this browser)</span></p>
    </section>`;
  return { main, checks, details: renderDetails(m) };
}

export function renderJudge(m, settings) {
  return `<div class="card judge-card">
    <div class="judge-head"><b>Same facts, two views</b> <span class="muted">a note for judges</span></div>
    <div class="judge-grid">
      <div class="jn"><div class="jn-label">Doctor sees</div><div class="jn-val" id="jn-doctor">${esc(pctRange(m.details.range))}, <span class="tier ${esc(m.tier)}">${esc(m.details.tierName)}</span>${m.details.simulatedInRange ? ` ${SIM}` : ''}</div><div class="muted jn-sub">${esc(m.details.reason)}</div></div>
      <div class="jn"><div class="jn-label">Patient sees</div><div class="jn-val" id="jn-patient">“${esc(m.headline)}”</div><div class="muted jn-sub">The range, the tier and every quote are one tap away, under “See everything your doctor sees”.</div></div>
    </div>
    <p class="jn-foot muted">Doctor sees: ${esc(m.judge.doctor)}. Patient sees: ${esc(m.judge.patient)}. Both come from one engine call for ${fmtDate(m.asOf)} with the same settings: referral line ${esc(fmtLine(settings.referralLine))}, home tests ${settings.includeHomeTests ? 'counted' : 'not counted'}.${m.details.simulatedInRange ? ' The range includes a simulated check-in result.' : ''}</p>
  </div>`;
}

// ---------- page wiring ----------
async function main() {
  const phone = document.getElementById('phone');
  const select = document.getElementById('pv-date');
  const judge = document.getElementById('judge');
  let ALEX;
  try {
    ({ ALEX } = await import('./alex.js'));
    if (!ALEX || !Array.isArray(ALEX.encounters) || !ALEX.encounters.length) throw new Error('ALEX has no encounters');
  } catch (err) {
    console.error(err);
    phone.innerHTML = '<p class="muted">Alex\'s case file (js/alex.js) is not available yet, so there is nothing to show. Reload once it is in place.</p>';
    select.innerHTML = '<option>Case file pending</option>';
    return;
  }

  const encs = [...ALEX.encounters].sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(encs.map((e) => e.date))];
  select.innerHTML = dates.map((d) => {
    const here = encs.filter((e) => e.date === d).map((e) => e.setting).join(' + ');
    return `<option value="${d}">${fmtDate(d)} · ${esc(here)}</option>`;
  }).join('');

  const fromUrl = new URLSearchParams(location.search).get('date');
  let current = dates.includes(fromUrl) ? fromUrl : dates.includes(DEFAULT_DATE) ? DEFAULT_DATE : dates[0];
  let detailsOpen = new URLSearchParams(location.search).get('details') === 'open';

  const render = () => {
    const settings = readSettings((() => { try { return window.localStorage; } catch { return null; } })());
    const m = buildModel(ALEX, current, settings);
    const parts = renderPhone(m, ALEX);
    const wasOpen = document.getElementById('pv-details')?.open;
    if (wasOpen !== undefined) detailsOpen = wasOpen;
    phone.innerHTML = parts.main + parts.checks + parts.details;
    if (detailsOpen) document.getElementById('pv-details').open = true;
    judge.innerHTML = renderJudge(m, settings);
    select.value = current;
    const i = dates.indexOf(current);
    document.getElementById('pv-prev').disabled = i <= 0;
    document.getElementById('pv-next').disabled = i >= dates.length - 1;
    document.getElementById('pv-settings').innerHTML = `Shared with the doctor dashboard: referral line <b>${esc(fmtLine(settings.referralLine))}</b> · home tests <b>${settings.includeHomeTests ? 'counted' : 'not counted'}</b>${Object.keys(settings.mdc).length ? ' · measured normal variation in use' : ''}. Change them on the <a href="doctor.html">doctor dashboard</a>.`;
  };

  const go = (d) => {
    current = d;
    const url = new URL(location.href);
    url.searchParams.set('date', d);
    history.replaceState(null, '', url);
    render();
  };
  select.addEventListener('change', () => go(select.value));
  document.getElementById('pv-prev').addEventListener('click', () => { const i = dates.indexOf(current); if (i > 0) go(dates[i - 1]); });
  document.getElementById('pv-next').addEventListener('click', () => { const i = dates.indexOf(current); if (i < dates.length - 1) go(dates[i + 1]); });
  window.addEventListener('storage', (e) => { if (!e.key || e.key.startsWith('rfn.')) render(); });
  render();
}

if (typeof document !== 'undefined' && document.getElementById('phone')) main();
