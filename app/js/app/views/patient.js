// Patient app (#patient): what the patient in the chosen case sees on their phone after a
// visit, beside a short explanation for judges. It follows the case picked in the top bar
// (ctx.caseFile / ctx.caseEntry): Alex's case file, a look-alike demo, or a case built in
// this browser. The phone reads the SAME evaluation as the doctor's screen (the engine
// timeline with the shared state: visit, referral line, home-data switch, unticked
// findings) and only changes the words. Every number is computed at run time from the
// engine and the case file; none is typed in here.
import {
  timeline, evaluateState, stateAt, detectDecline, ACTIONS, FINDINGS, HOME_TESTS, PRIOR, SOURCES,
} from '../../engine.js';
import { REFERRAL_LINES } from '../../weights.js';
import { esc, fmtDate, pct, range, pctAt, rangeAt, TIER, tierChip, simChip, assumeChip, ensureCss, plural } from '../ui.js';

const VIEW_CSS = 'css/views/patient.css';
const AREA_ORDER = ['arm', 'leg', 'bulbar', 'breathing', 'general', 'cognitive', 'other'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const low1 = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : '');
const r1 = (x) => String(Math.round(x * 10) / 10);
const f2 = (x) => Number(x).toFixed(2);
const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || pct(v);
const measuredChip = () => '<span class="chip real" title="Measured by the team, 10 repeats each">Measured</span>';

// ---------- who the case is about ----------
// Demo cases are presentations, not people: they get a neutral "Hi there". So do cases
// still carrying the builder's placeholder name.
const PLACEHOLDER_NAMES = new Set(['', 'new patient', 'unnamed patient']);
const TITLE_WORD = /^(mr|mrs|ms|mx|miss|dr|prof)\.?$/i;
function whoIs(entry, caseFile) {
  const kind = entry?.kind || (entry?.id === 'alex' ? 'case-file' : 'user');
  const full = String(caseFile?.patient?.name || '').trim();
  const demo = kind === 'demo';
  const named = !demo && !PLACEHOLDER_NAMES.has(full.toLowerCase());
  const words = full.split(/\s+/).filter(Boolean);
  let first = named ? words[0] : '';
  if (named && TITLE_WORD.test(first) && words.length > 1) first = `${words[0]} ${words[words.length - 1]}`;
  const sex = String(caseFile?.patient?.sex || '').trim().toLowerCase();
  const his = sex === 'male' || sex === 'm' ? 'his' : sex === 'female' || sex === 'f' ? 'her' : 'their';
  return {
    kind, demo, named, his,
    full: full || 'Unnamed patient',
    caseName: entry?.name || full || 'This case',
    first,
    hello: named ? `Hi ${first}` : 'Hi there',
    who: named ? first : 'The patient', // start of a sentence
    whoMid: named ? first : 'the patient', // middle of a sentence
    initials: named ? words.filter((w) => !TITLE_WORD.test(w)).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() : '',
  };
}

// The noise floor the engine uses for a test: the team's measured one if any, else the placeholder.
function mdcFor(test, opts) {
  const m = Number(opts?.mdc?.[test]);
  if (Number.isFinite(m) && m > 0) return { value: m, measured: true };
  return { value: HOME_TESTS[test].placeholderMdc, measured: false };
}

// ---------- body areas, in the patient's words ----------
// The side comes from the quoted sentences: "both" / "all four" wins, else the side most quotes name.
function sideOf(quotes) {
  if (quotes.some((q) => /\b(both|bilateral|all four)\b/i.test(q))) return 'both';
  const right = quotes.filter((q) => /\bright\b/i.test(q)).length;
  const left = quotes.filter((q) => /\bleft\b/i.test(q)).length;
  if (right > left) return 'right';
  if (left > right) return 'left';
  return null;
}
function areaTitle(region, side) {
  if (region === 'arm') return side === 'both' ? 'your hands and arms' : side ? `your ${side} hand and arm` : 'your hand and arm';
  if (region === 'leg') return side === 'both' ? 'your legs' : side ? `your ${side} leg` : 'your leg';
  return {
    bulbar: 'your speech and swallowing',
    breathing: 'your breathing',
    general: 'your weight and energy',
    cognitive: 'your mood',
  }[region] || 'other things noted';
}
function groupByArea(instances) {
  const groups = new Map();
  for (const inst of instances) {
    const region = AREA_ORDER.includes(inst.region) ? inst.region : 'other';
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
  return [...groups.values()]
    .sort((a, b) => AREA_ORDER.indexOf(a.region) - AREA_ORDER.indexOf(b.region))
    .map((g) => ({
      region: g.region,
      title: areaTitle(g.region, sideOf(g.quotes)),
      items: [...g.items.values()].map((it) => ({ ...it, seen: it.seen.sort(byDate) })),
    }));
}
function seenText(it) {
  if (it.home) return `Weekly check-in, since ${fmtDate(it.seen[0].date)}`;
  const dates = [...new Set(it.seen.map((s) => s.date))];
  if (dates.length === 1) return `Noted ${fmtDate(dates[0])}${it.seen[0].setting ? ` · ${esc(it.seen[0].setting)}` : ''}`;
  return `Noted at ${dates.length} visits, first ${fmtDate(dates[0])}`;
}

// ---------- why, in calm words (one sentence per rule that fired) ----------
const PLAIN_RULE = {
  split_hand: 'The pattern of muscle loss in your hand does not fit one trapped nerve.',
  two_territory: 'The muscle loss in your hand is in two areas that one trapped nerve cannot explain.',
  unexplained_weakness: 'The test for the first suspected cause came back normal, but the weakness is still there.',
  umn_lmn: 'Some reflexes are livelier than expected in a limb that is also weak, thinner or twitching.',
  unclear_with_decline: 'Your weekly check-in dropped by more than normal variation, two weeks in a row.',
  multi_region: 'Changes have now been noted in more than one part of your body.',
};
function whyFor(ev) {
  if (ev.tier === 'high') {
    return {
      points: ev.rulesFired.length
        ? ev.rulesFired.map((r) => PLAIN_RULE[r.id] || r.label)
        : ['Taken together, the changes noted so far are above the level at which your doctor asks for a nerve and muscle test.'],
      calm: 'The same test also finds more common causes, like a trapped nerve. Being sent for it does not mean anything has been decided.',
    };
  }
  if (ev.tier === 'unclear') {
    return {
      points: ['Taken together, the changes are close to the level at which your doctor asks for a nerve and muscle test. A few weeks of short check-ins will show whether things are steady or changing.'],
      calm: 'Watching for a few weeks is a careful step. It does not mean anything has been decided.',
    };
  }
  return {
    points: [ev.state.instances.length
      ? (ev.steppedDown ? 'Your weekly check-ins stayed steady, with no drop bigger than normal week-to-week variation.' : 'The changes noted so far are below the level at which your doctor asks for a nerve and muscle test.')
      : 'Nothing has been noted yet that needs a closer look.'],
    calm: 'That can change if new symptoms appear, so it helps to know what to look out for.',
  };
}

// Low tier: the engine's safety-net line starts "If the weakness spreads". With no arm or leg
// weakness on file (twitching, cramps, falls or speech changes alone) the phone gives the same
// advice without assuming a weakness.
const LIMB_WEAKNESS = new Set(['focal_weakness', 'wasting', 'foot_drop', 'stairs', 'split_hand', 'two_territory_wasting']);
const LOW_NEXT_NO_WEAKNESS = 'If you notice new weakness, a change in your speech or swallowing, or a muscle shrinking or twitching in a new place, book an appointment.';
function nextFor(ev, act, instances) {
  const weak = instances.some((i) => LIMB_WEAKNESS.has(i.id) && (i.region === 'arm' || i.region === 'leg'));
  return ev.tier === 'low' && !weak ? LOW_NEXT_NO_WEAKNESS : act.patient.next;
}

// ---------- weekly check-ins ----------
const CHECKINS = [
  { key: 'tapping', name: 'Finger tapping', what: 'Taps in 10 seconds, each hand', tests: ['tap_right', 'tap_left'], region: 'arm', drop: 'slower than your start' },
  { key: 'reading', name: 'Reading aloud', what: 'Words per minute, same passage', tests: ['reading'], region: 'bulbar', drop: 'Reading slower than your start' },
  { key: 'walking', name: 'Walking', what: 'Walking speed over 10 m, timed by the phone', tests: ['gait_speed'], region: 'leg', drop: 'Walking slower than your start' },
  { key: 'weight', name: 'Weight', what: 'Same scale, same time of day', tests: ['weight'], region: 'general', drop: 'Weight lower than your start' },
];
const SIDE = { tap_right: 'Right', tap_left: 'Left' };
const SHORT_UNIT = { tap_right: 'taps', tap_left: 'taps', reading: 'words/min', walk: '%', weight: 'kg', gait_speed: 'm/s' };
const COL_NAME = { tap_right: 'Right hand', tap_left: 'Left hand', reading: 'Reading', walk: 'Walking', weight: 'Weight', gait_speed: 'Walking speed' };

function checkinModel(homeTests, asOf, includeHome, groups, tier, opts) {
  return CHECKINS.map((c) => {
    const tests = c.tests.map((test) => {
      const meta = HOME_TESTS[test];
      if (!meta || !includeHome) return null;
      const series = homeTests.filter((h) => h.test === test && h.date <= asOf).sort(byDate);
      if (!series.length) return null;
      const { value: mdc, measured } = mdcFor(test, opts);
      return {
        test, meta, series, mdc, measured,
        latest: series[series.length - 1],
        baseline: series.length >= 2 ? (series[0].value + series[1].value) / 2 : null,
        decline: detectDecline(series, { mdc, higherIsBetter: meta.higherIsBetter }),
        simulated: series.some((s) => s.simulated),
      };
    }).filter(Boolean);
    const group = groups.find((g) => g.region === c.region);
    let status;
    if (tests.length) {
      const down = tests.find((t) => t.decline);
      const n = Math.max(...tests.map((t) => t.series.length));
      if (down) status = { tone: 'down', word: `${SIDE[down.test] ? `${SIDE[down.test]} hand ${c.drop}` : c.drop}, 2 weeks running` };
      else if (!tests.some((t) => t.series.length >= 4)) status = { tone: 'wait', word: `Setting your starting point: ${plural(n, 'weekly result')} so far` };
      else status = { tone: 'ok', word: 'Steady: no change beyond normal variation' };
    } else if (group && tier !== 'low') {
      status = { tone: 'todo', word: `Suggested: changes noted in ${group.title}` };
    } else {
      status = { tone: 'none', word: tier === 'low' ? 'Not needed now' : 'Not needed yet' };
    }
    const chart = tests.find((t) => t.decline) || tests[0] || null;
    return { ...c, tests, status, chart, simulated: tests.some((t) => t.simulated) };
  });
}

// ---------- small charts (tokens only; values are always also printed as text) ----------
function sparkline(t, w = 88, h = 34) {
  const pts = t.series;
  if (pts.length < 2) return '';
  const pad = 5;
  const vals = pts.map((p) => p.value).concat(t.baseline != null ? [t.baseline] : []);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const x = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (h - 2 * pad);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const base = t.baseline != null
    ? `<line class="base" x1="${pad}" x2="${w - pad}" y1="${y(t.baseline).toFixed(1)}" y2="${y(t.baseline).toFixed(1)}"/>` : '';
  const last = pts[pts.length - 1];
  const unit = esc(t.meta.unit);
  const hits = pts.map((p, i) => `<circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="6"><title>${fmtDate(p.date)}: ${r1(p.value)} ${unit}</title></circle>`).join('');
  const label = `${esc(t.meta.label)}: ${pts.length} weekly results from ${fmtDate(pts[0].date)} to ${fmtDate(last.date)}, latest ${r1(last.value)} ${unit}${t.baseline != null ? `, starting point ${r1(t.baseline)}` : ''}`;
  return `<svg class="pv-spark${t.decline ? ' down' : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">${base}<path d="${d}"/><circle class="end" cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4"/>${hits}</svg>`;
}

// Log-scale range bar: 0.01% to 100%, the band is the middle 95%, the rule is the referral line.
const LOG_MIN = 1e-4;
const logPos = (p) => ((Math.log10(Math.min(1, Math.max(LOG_MIN, p))) - Math.log10(LOG_MIN)) / -Math.log10(LOG_MIN)) * 100;
const TICKS = [[1e-4, '0.01%'], [1e-3, '0.1%'], [1e-2, '1%'], [1e-1, '10%'], [1, '100%']];
function rangeBar(r, line, tier = '') {
  const l = logPos(r.lo);
  const h = logPos(r.hi);
  const x = logPos(line);
  return `<div class="pv-rbar${tier ? ` t-${esc(tier)}` : ''}" role="img" aria-label="Likelihood range ${esc(rangeAt(r, line))}, referral line ${esc(lineLabel(line))}, on a log scale">
    <div class="pv-rbar-track">
      <span class="pv-rbar-band" style="left:${l.toFixed(2)}%;width:${Math.max(1.5, h - l).toFixed(2)}%" title="Middle 95%: ${esc(rangeAt(r, line))}"></span>
      <span class="pv-rbar-line" style="left:${x.toFixed(2)}%" title="Referral line ${esc(lineLabel(line))}"><b>Line ${esc(lineLabel(line))}</b></span>
    </div>
    <div class="pv-rbar-ticks" aria-hidden="true">${TICKS.map(([v, t]) => `<span style="left:${logPos(v).toFixed(2)}%">${t}</span>`).join('')}</div>
  </div>`;
}

// ---------- the whole view as plain data ----------
// The timeline is cached per mount (the shell re-mounts the view when the case changes).
function timelineFor(caseFile, opts, cache, caseKey) {
  const key = JSON.stringify([caseKey, opts.referralLine, opts.includeHomeTests, [...(opts.exclude || [])].sort(), opts.mdc || null]);
  if (cache.key !== key) { cache.key = key; cache.tl = timeline(caseFile, opts); }
  return cache.tl;
}

function buildModel(ctx, cache) {
  const s = ctx.state;
  const opts = ctx.opts;
  const cf = ctx.caseFile || {};
  const who = whoIs(ctx.caseEntry, cf);
  const encs = (cf.encounters || []).filter((e) => e && e.date).sort(byDate);
  const homeAll = (cf.homeTests || []).filter((h) => h && HOME_TESTS[h.test] && Number.isFinite(h.value));
  const home = { any: homeAll.length > 0, simulated: homeAll.some((h) => h.simulated), entered: homeAll.some((h) => !h.simulated) };
  const base = { who, encs, home, includeHome: s.includeHome };
  if (!encs.length) return { ...base, empty: true };

  const dates = encs.map((e) => e.date);
  const asOf = s.asOf && s.asOf >= dates[0] ? s.asOf : dates[0];
  const visit = encs.filter((e) => e.date <= asOf).pop() || encs[0];
  const idx = encs.indexOf(visit);
  const tl = timelineFor(cf, opts, cache, `${ctx.caseEntry?.id}|${s.casesRev}`);
  // same as engine.evaluateAt: the latest evaluation on or before the date
  const ev = tl.filter((e) => e.asOf <= asOf).pop() || evaluateState(stateAt(cf, asOf, opts), opts);
  const act = ACTIONS[ev.tier];
  const instances = [...ev.state.instances].sort(byDate);
  const groups = groupByArea(instances);
  const negatives = encs.filter((e) => e.date <= asOf)
    .flatMap((e) => (e.negatives || []).map((n) => ({ date: e.date, setting: e.setting, label: n.label, quote: n.quote })));
  const homeRows = s.includeHome ? homeAll.filter((h) => h.date <= asOf) : [];
  return {
    ...base, asOf, visit, idx, ev, act, instances, groups, negatives, homeRows,
    next: nextFor(ev, act, instances),
    why: whyFor(ev),
    checkins: checkinModel(homeAll, asOf, s.includeHome, groups, ev.tier, opts),
    excluded: (s.exclude || []).length,
    simulatedInRange: instances.some((i) => i.simulated && FINDINGS[i.id]?.or != null),
    assumedInRange: instances.some((i) => FINDINGS[i.id]?.or != null && FINDINGS[i.id]?.source === 'assumption'),
    journey: tl.filter((e) => e.encounter),
    anyHappened: encs.some((e) => String(e.whatHappened || '').trim()),
  };
}

// ---------- rendering: the phone ----------
const ICON = {
  signal: '<svg width="17" height="11" viewBox="0 0 17 11" aria-hidden="true"><rect x="0" y="7" width="3" height="4" rx="1"/><rect x="4.5" y="5" width="3" height="6" rx="1"/><rect x="9" y="2.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="0" width="3" height="11" rx="1"/></svg>',
  wifi: '<svg width="15" height="11" viewBox="0 0 15 11" aria-hidden="true"><path d="M7.5 2.2c2.2 0 4.2.8 5.7 2.2l1.1-1.2A9.9 9.9 0 0 0 7.5.5 9.9 9.9 0 0 0 .7 3.2l1.1 1.2a8.2 8.2 0 0 1 5.7-2.2Zm0 3.3c1.3 0 2.5.5 3.4 1.3l1.1-1.2a6.6 6.6 0 0 0-9 0l1.1 1.2c.9-.8 2.1-1.3 3.4-1.3Zm0 3.2c.5 0 .9.2 1.2.5L7.5 10.6 6.3 9.2c.3-.3.7-.5 1.2-.5Z"/></svg>',
  battery: '<svg width="25" height="12" viewBox="0 0 25 12" aria-hidden="true"><rect x=".5" y=".5" width="21" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".4"/><rect x="2" y="2" width="16" height="8" rx="2"/><path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z" opacity=".45"/></svg>',
  left: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chev: '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  person: '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="5.4" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 13.6c.8-2.4 2.7-3.7 5-3.7s4.2 1.3 5 3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

function appBar(m) {
  const w = m.who;
  const avatar = w.initials
    ? `<span class="pv-avatar" aria-hidden="true">${esc(w.initials)}</span>`
    : `<span class="pv-avatar glyph" aria-hidden="true">${ICON.person}</span>`;
  return `<div class="pv-appbar">
      <span class="pv-appmark" aria-hidden="true">RF</span><span class="pv-appname">My care</span>
      <span class="pv-ab-right">${w.demo ? '<span class="chip" title="A constructed look-alike, not a real patient">Demo case</span>' : ''}${avatar}</span>
    </div>`;
}

function phoneEmpty(m) {
  return `${appBar(m)}
    <h2 class="pv-hello">${esc(m.who.hello)}</h2>
    <p class="pv-sub">Your care updates</p>
    <div class="pv-card pv-novisit">
      <div class="micro">No visits yet</div>
      <p>After each visit, your next step, the reason for it and what is being checked appear here, in plain words.</p>
    </div>`;
}

function checkinNote(m) {
  const w = m.who;
  if (!m.home.any) {
    return `<div class="pv-ci-demo"><p>${w.demo ? 'This demo case has no weekly check-in results.' : 'No weekly check-in results in this case yet.'}</p></div>`;
  }
  if (m.includeHome) return '';
  if (m.home.simulated && !m.home.entered) {
    const never = w.kind === 'case-file' && w.named ? ` ${esc(w.first)} never did check-ins.` : '';
    return `<div class="pv-ci-demo"><p>Demo:${never} Results here would be made up, so they are off.</p><button type="button" class="btn sm" data-action="sim-on" data-fk="sim-on">Show simulated results</button></div>`;
  }
  return `<div class="pv-ci-demo"><p>Home data is off, so the weekly results in this case are not shown or counted.</p><button type="button" class="btn sm" data-action="sim-on" data-fk="sim-on">Show home results</button></div>`;
}

function phoneMain(m) {
  const n = m.encs.length;
  const areas = m.groups.length
    ? m.groups.map((g) => `<div class="pv-area">
        <div class="pv-area-head"><span>${esc(cap(g.title))}</span><span class="pv-count mono">${g.items.length}</span></div>
        <ul class="pv-items">${g.items.map((it) => `<li><span class="pv-plain">${esc(it.plain)}${it.simulated ? ` ${simChip()}` : ''}</span><span class="pv-meta">${seenText(it)}</span></li>`).join('')}</ul>
      </div>`).join('')
    : '<p class="pv-empty">Nothing has been noted yet.</p>';
  const setting = String(m.visit.setting || '').trim();
  return `
    ${appBar(m)}
    <h2 class="pv-hello">${esc(m.who.hello)}</h2>
    <p class="pv-sub">Your care update · ${fmtDate(m.asOf)}${setting ? ` · after your ${esc(low1(setting))} visit` : ''}</p>

    <div class="pv-visitbar" role="group" aria-label="Choose a visit">
      <button type="button" data-go="-1" data-fk="prev"${m.idx <= 0 ? ' disabled' : ''}>${ICON.left}Earlier</button>
      <span class="pv-visit-pos">Visit ${m.idx + 1} of ${n}</span>
      <button type="button" data-go="1" data-fk="next"${m.idx >= n - 1 ? ' disabled' : ''}>Later${ICON.right}</button>
    </div>

    <section class="pv-next" aria-labelledby="pv-headline">
      <div class="pv-state"><i class="pv-dot ${esc(m.ev.tier)}"></i>${esc(TIER[m.ev.tier].patient)}</div>
      <h3 id="pv-headline">${esc(m.act.patient.headline)}</h3>
      <p>${esc(m.next)}</p>
    </section>

    <section class="pv-sec" aria-label="Why this step">
      <div class="pv-sec-head"><span class="micro">Why this step</span></div>
      <div class="pv-card pv-why">
        <ul>${m.why.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <p class="pv-calm">${esc(m.why.calm)}</p>
      </div>
    </section>

    <section class="pv-sec" aria-label="What we are checking">
      <div class="pv-sec-head"><span class="micro">What we are checking</span></div>
      <div class="pv-card">${areas}</div>
    </section>

    <section class="pv-sec" aria-label="Your weekly check-ins">
      <div class="pv-sec-head"><span class="micro">Your weekly check-ins</span></div>
      <div class="pv-card">
        ${m.checkins.map((c) => checkinRow(c, m.asOf)).join('')}
        ${checkinNote(m)}
        <div class="pv-ci-foot"><a class="btn sm primary" href="#monitoring" data-fk="mon">Open check-ins ${ICON.arrow}</a></div>
      </div>
    </section>`;
}

function checkinRow(c, asOf) {
  const t0 = c.tests[0];
  const vals = t0
    ? c.tests.map((t) => `${SIDE[t.test] ? `${SIDE[t.test]} ` : ''}${r1(t.latest.value)}`).join(' · ') + ` ${esc(SHORT_UNIT[t0.test] || t0.meta.unit)}`
      + (t0.latest.date !== asOf ? ` · last ${fmtDate(t0.latest.date)}` : '')
    : '';
  const mdc = t0 && t0.series.length >= 4
    ? `<div class="pv-ci-mdc">Normal variation ±${r1(t0.mdc)} ${esc(SHORT_UNIT[t0.test] || '')} ${t0.measured ? measuredChip() : assumeChip()}</div>` : '';
  return `<div class="pv-ci">
    <div class="pv-ci-top">
      <div class="pv-ci-main">
        <div class="pv-ci-name">${esc(c.name)}${c.simulated ? ` ${simChip()}` : ''}</div>
        <div class="pv-ci-what">${esc(c.what)}</div>
      </div>
      ${c.chart ? sparkline(c.chart) : ''}
    </div>
    <div class="pv-ci-state ${c.status.tone}"><i></i><span>${esc(c.status.word)}</span></div>
    ${vals ? `<div class="pv-ci-vals mono">${vals}</div>` : ''}
    ${mdc}
  </div>`;
}

function homeTableHtml(m) {
  const tests = Object.keys(HOME_TESTS).filter((t) => m.homeRows.some((h) => h.test === t));
  const dates = [...new Set(m.homeRows.map((h) => h.date))].sort();
  if (!dates.length) return '';
  const sim = m.homeRows.some((h) => h.simulated);
  const entered = m.homeRows.some((h) => !h.simulated);
  const cellFor = (d, t) => {
    const rows = m.homeRows.filter((x) => x.date === d && x.test === t);
    if (!rows.length) return '<td class="num"></td>';
    const v = rows.reduce((a, x) => a + x.value, 0) / rows.length;
    return `<td class="num">${r1(v)}${sim && entered && rows.some((x) => x.simulated) ? '<span class="pv-simmark" title="Simulated">*</span>' : ''}</td>`;
  };
  // units by test, grouped so two hands share one line
  const units = new Map();
  for (const t of tests) {
    const u = HOME_TESTS[t].unit;
    if (!units.has(u)) units.set(u, []);
    units.get(u).push(COL_NAME[t] || HOME_TESTS[t].label);
  }
  const unitText = [...units].map(([u, names]) => `${names.join(' and ')}: ${u}`).join('. ');
  const prov = sim && entered
    ? 'Values marked * are made up for the demo; the rest were entered in the case.'
    : sim ? (m.who.kind === 'case-file' && m.who.named ? `Made up for the demo: ${m.who.first} never had home tests.` : 'Made up for the demo.')
    : 'As entered in the case.';
  return `<div class="pv-dsec"><div class="micro">Weekly check-in results${sim ? ` ${simChip()}` : ''}</div>
      <div class="table-wrap"><table class="tbl pv-htbl"><thead><tr><th>Week of</th>${tests.map((t) => `<th class="num">${esc(COL_NAME[t] || HOME_TESTS[t].label)}</th>`).join('')}</tr></thead>
      <tbody>${dates.map((d) => `<tr><td class="mono">${fmtDate(d)}</td>${tests.map((t) => cellFor(d, t)).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="pv-small">${esc(unitText)}. ${esc(prov)}</p></div>`;
}

function phoneDetails(m, open) {
  const ev = m.ev;
  const rules = ev.rulesFired.length
    ? `<ul class="pv-rules">${ev.rulesFired.map((r) => `<li><b>${esc(r.label)}.</b> ${esc(r.why)} <span class="pv-src">${esc(SOURCES[r.source]?.short || r.source)}</span>${r.source === 'assumption' ? ` ${assumeChip()}` : ''}</li>`).join('')}</ul>`
    : '<p class="pv-small">No pattern rule applied on this date.</p>';
  const findings = m.instances.length
    ? `<ol class="pv-flist">${m.instances.map((i) => {
      const f = FINDINGS[i.id] || {};
      const weight = f.contextOnly ? 'context flag: shown to your doctor, adds no weight and sets off no rule'
        : f.or == null ? 'pattern sign: sets off a rule, adds no weight' : `odds ratio ${f2(f.or)} (95% CI ${f2(f.lo)} to ${f2(f.hi)})`;
      return `<li>
        <div class="pv-f-head"><b>${esc(f.label || i.id)}</b>${i.simulated ? ` ${simChip()}` : ''}${f.source === 'assumption' ? ` ${assumeChip()}` : ''}</div>
        <blockquote class="quote">${esc(i.quote)}</blockquote>
        <div class="pv-f-meta">${fmtDate(i.date)} · ${esc(i.setting || (i.kind === 'home' ? 'Weekly check-in' : ''))} · ${esc(weight)}</div>
      </li>`;
    }).join('')}</ol>`
    : '<p class="pv-small">No findings in the notes up to this date.</p>';
  const negatives = m.negatives.length
    ? `<div class="pv-dsec"><div class="micro">Checked and found normal</div><ul class="pv-neg">${m.negatives.map((n) => `<li><b>${esc(n.label)}</b> <span class="pv-f-meta">${fmtDate(n.date)} · ${esc(n.setting)}</span><q>${esc(n.quote)}</q></li>`).join('')}</ul></div>`
    : '';
  const byNumber = ev.byNumber !== ev.tier
    ? `<p class="pv-small">By the number alone this would be ${tierChip(ev.byNumber)}; ${ev.rulesFired.length ? 'a pattern rule moves it' : 'the 8-week review moves it'} to ${esc(TIER[ev.tier].label)}.</p>` : '';
  return `<details class="pv-card pv-more" id="pv-details"${open ? ' open' : ''}>
    <summary data-fk="details"><span>See everything your doctor sees</span>${ICON.chev}</summary>
    <div class="pv-more-body">
      <p class="pv-context">The conditions being checked include problems with the nerves that control muscles, such as ALS (amyotrophic lateral sclerosis, a type of motor neuron disease). More common problems, like a trapped nerve, can cause similar changes, and the same tests look for those too.</p>

      <div class="pv-dsec">
        <div class="micro">Your doctor's screen</div>
        <div class="pv-dres">${tierChip(ev.tier)}<b>${esc(TIER[ev.tier].action)}</b></div>
        <div class="pv-drange mono">${esc(rangeAt(ev.range, ev.line))}${m.simulatedInRange ? ` ${simChip()}` : ''}</div>
        ${rangeBar(ev.range, ev.line, ev.tier)}
        <p class="pv-small">The chance of a motor neuron disease diagnosis within ${esc(PRIOR.horizonYears)} years for someone with these findings, as a range: the middle 95% of ${esc(ev.range.nSims.toLocaleString('en-CA'))} simulations. Starting rate: ${esc(PRIOR.label)} ${assumeChip()}. The referral line, ${esc(lineLabel(ev.line))}, is chosen by the clinic.</p>
        <p class="pv-small"><b>Why:</b> ${esc(ev.reason)}.</p>
        ${byNumber}
      </div>

      <div class="pv-dsec"><div class="micro">Rules that applied</div>${rules}</div>
      <div class="pv-dsec"><div class="micro">Every finding, word for word · ${m.instances.length}</div>${findings}</div>
      ${negatives}
      ${homeTableHtml(m)}
      <p class="pv-rights">You can ask for a copy of your full record at any time. In Ontario, PHIPA gives you the right to see your own health records.</p>
    </div>
  </details>`;
}

function footHtml(m) {
  const w = m.who;
  if (w.kind === 'case-file') return `BioHacks case file: ${esc(w.full)} (fictional). ${esc(cap(w.his))} notes are quoted word for word.`;
  if (w.demo) return `Demo case: ${esc(w.caseName)}. A constructed look-alike, not a real patient.`;
  return `Built in this browser: ${esc(w.full)}. Quotes are as entered in the case.`;
}

// ---------- rendering: the explanation column ----------
function introHtml(m) {
  const w = m.who;
  const lede = w.demo
    ? `What a patient with this presentation would see on their phone after the visit. <b>${esc(w.caseName)}</b> is a constructed look-alike, not a real patient. The phone reads the same evaluation as the doctor's screen, for the visit, referral line and settings chosen above. Nothing is held back; only the words change.`
    : `After each visit ${esc(w.whoMid)} gets this update on ${w.his} phone. It reads the same evaluation as the doctor's screen, for the visit, referral line and settings chosen above. Nothing is held back; only the words change.`;
  return `<div class="micro dot">Patient app · ${esc(w.demo ? 'Demo case' : w.full)}</div>
    <h1 class="title two-tone pv-title">Same facts, <span class="soft">gentler words.</span></h1>
    <p class="lede">${lede}</p>`;
}

function explainEmpty(m) {
  return `<div class="card card-pad pv-empty-card">
      <div class="micro dot">No visits in this case</div>
      <h2 class="pv-empty-h">Add a visit to see ${esc(m.who.named ? `${m.who.first}'s` : 'the patient\'s')} update</h2>
      <p class="muted">The phone shows what the patient reads after a visit: the next step, why, and what is being checked, all worked out from the red flags quoted in the visit notes. ${m.who.named ? esc(m.who.full) : 'This case'} has no visits yet.</p>
      <div class="row"><button type="button" class="btn primary" data-nav="cases" data-fk="nav-cases">Add a visit in Cases</button></div>
    </div>`;
}

function explainHtml(m) {
  const ev = m.ev;
  const w = m.who;
  const homeWord = m.home.any ? `${m.home.simulated && !m.home.entered ? 'simulated home data' : 'home data'} ${m.includeHome ? 'on' : 'off'}` : 'no home data in this case';
  const facts = [
    `One evaluation for ${fmtDate(m.asOf)}`,
    `referral line ${lineLabel(ev.line)}`,
    homeWord,
    plural(m.instances.length, 'finding'),
  ];
  if (m.excluded) facts.push(`${m.excluded} unticked on the doctor's screen`);
  const journey = m.journey.map((j) => {
    const cur = j.asOf === m.visit.date;
    const happened = String(j.encounter.whatHappened || '').trim();
    return `<tr class="${cur ? 'is-current' : ''}">
      <td><button type="button" class="pv-j-btn" data-asof="${esc(j.asOf)}" data-fk="j-${esc(j.asOf)}"${cur ? ' aria-current="true"' : ''}><span class="mono">${fmtDate(j.asOf)}</span><span class="pv-j-set">${esc(j.encounter.setting)}</span></button></td>
      <td><div class="pv-j-tier">${tierChip(j.tier)}</div><div class="pv-j-head">${esc(ACTIONS[j.tier].patient.headline)}</div></td>
      ${m.anyHappened ? `<td class="pv-j-real">${happened ? esc(happened) : '<span class="faint">Not recorded</span>'}</td>` : ''}
    </tr>`;
  }).join('');
  return `
    <div class="pv-compare">
      <div class="panel grid-bg panel-pad pv-doc">
        <div class="micro dot">Doctor sees</div>
        <div class="pv-big mono">${esc(pctAt(ev.range.lo, ev.line))}<span class="pv-to"> to </span>${esc(pctAt(ev.range.hi, ev.line))}</div>
        <div class="pv-big-sub">middle 95% of ${esc(ev.range.nSims.toLocaleString('en-CA'))} simulations</div>
        ${m.simulatedInRange ? `<div class="pv-big-sub">${simChip()} includes made-up check-ins</div>` : ''}
        <div class="pv-big-sub">${assumeChip()} uses an assumed starting rate${m.assumedInRange ? ' and check-in weight' : ''}</div>
        ${rangeBar(ev.range, ev.line, ev.tier)}
        <div class="kv"><span>Tier</span>${tierChip(ev.tier)}</div>
        <div class="kv"><span>Action</span><span class="v">${esc(TIER[ev.tier].action)}</span></div>
        <div class="pv-doc-why">
          <div class="micro">${ev.rulesFired.length ? `Pattern ${ev.rulesFired.length === 1 ? 'rule' : 'rules'}` : 'Why'}</div>
          ${ev.rulesFired.length
            ? `<ul>${ev.rulesFired.map((r) => `<li>${esc(r.label)}</li>`).join('')}</ul>`
            : `<p>${esc(ev.reason)}</p>`}
        </div>
      </div>
      <div class="card pv-pat">
        <div class="micro dot">${esc(w.who)} sees</div>
        <p class="pv-pat-head">${esc(m.act.patient.headline)}</p>
        <div class="pv-pat-state"><i class="pv-dot ${esc(ev.tier)}"></i>${esc(TIER[ev.tier].patient)}</div>
        <p class="pv-pat-next">${esc(m.next)}</p>
        <p class="note pv-pat-foot">No percentage and no diagnosis on the first screen. The range, the tier and every quote are one tap away, under "See everything your doctor sees".</p>
      </div>
    </div>
    <p class="note pv-facts mono">${facts.map(esc).join(' · ')}</p>

    <section class="section">
      <div class="section-head"><h2>At each visit</h2><span class="aside">${m.journey.length > 1 ? 'Pick a visit to open it on the phone' : 'One visit in this case'}</span></div>
      <div class="table-wrap"><table class="tbl pv-journey${m.anyHappened ? '' : ' no-real'}">
        <thead><tr><th>Visit</th><th>${esc(w.who)} would have seen</th>${m.anyHappened ? '<th>What actually happened</th>' : ''}</tr></thead>
        <tbody>${journey}</tbody>
      </table></div>
    </section>

    <section class="section grid cols-2 pv-bottom">
      <div class="card card-pad pv-phipa">
        <div class="micro dot">Why nothing is hidden</div>
        <p>Ontario's Personal Health Information Protection Act, 2004 (PHIPA) gives patients a right of access to their own health records. So the patient view never hides a fact: the range, the tier and every quoted sentence sit under "See everything your doctor sees". It only changes the words, and the order they come in.</p>
      </div>
      <div class="card pv-rules-card">
        <div class="card-head"><h3>Four rules for the patient view</h3></div>
        <ol class="pv-design">
          <li><b>Next step first.</b> The headline says what happens next. It never names a diagnosis and never shows a percentage.</li>
          <li><b>Plain words, by body area.</b> "Small muscle twitches", not "fasciculations", grouped the way the patient feels them.</li>
          <li><b>Everything one tap away.</b> The doctor's range, tier and every quote with its date, with the Simulated and Assumption labels kept.</li>
          <li><b>Name it with context.</b> ALS is named only in the full view, beside the more common causes the same test also finds.</li>
        </ol>
      </div>
    </section>`;
}

// ---------- mount ----------
export function mount(root, ctx) {
  ensureCss(VIEW_CSS);
  let current = ctx;
  let detailsOpen = false;
  let lastAsOf = null;
  let first = true;
  const cache = { key: '', tl: null };

  const render = () => {
    const scroller = root.querySelector('.pv-scroll');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const det = root.querySelector('#pv-details');
    if (det) detailsOpen = det.open;
    const active = document.activeElement;
    const fk = active && root.contains(active) ? active.dataset.fk : null;
    let m;
    try {
      m = buildModel(current, cache);
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="error-card"><b>The patient app did not load.</b> ${esc(e.message || e)}</div>`;
      return;
    }
    const rv = (d) => (first ? ` reveal${d ? ` d${d}` : ''}` : '');
    const phoneLabel = `${m.who.named ? `${m.who.first}'s phone` : 'Patient phone'}: care update`;
    root.innerHTML = `<div class="pv">
      <div class="pv-intro${rv(0)}">${introHtml(m)}</div>
      <div class="pv-phone-wrap${rv(1)}">
        <div class="pv-phone">
          <div class="pv-screen">
            <div class="pv-statusbar" aria-hidden="true"><span class="pv-time">9:41</span><span class="pv-island"></span><span class="pv-sb-icons">${ICON.signal}${ICON.wifi}${ICON.battery}</span></div>
            <div class="pv-scroll" tabindex="0" aria-label="${esc(phoneLabel)}">
              ${m.empty ? phoneEmpty(m) : `${phoneMain(m)}${phoneDetails(m, detailsOpen)}`}
              <p class="pv-foot">${footHtml(m)}</p>
            </div>
            <span class="pv-homebar" aria-hidden="true"></span>
          </div>
        </div>
      </div>
      <div class="pv-explain${rv(2)}">${m.empty ? explainEmpty(m) : explainHtml(m)}</div>
    </div>`;
    const sc = root.querySelector('.pv-scroll');
    if (sc) sc.scrollTop = lastAsOf === null || lastAsOf === m.asOf ? scrollTop : 0;
    lastAsOf = m.asOf || null;
    first = false;
    if (fk) {
      const target = [...root.querySelectorAll('[data-fk]')].find((x) => x.dataset.fk === fk);
      const fallback = fk === 'prev' || fk === 'next' ? root.querySelector('[data-go]:not(:disabled)') : null;
      const el = target && !target.disabled ? target : fallback;
      if (el) el.focus({ preventScroll: true });
    }
  };

  const onClick = (e) => {
    const go = e.target.closest('[data-go]');
    if (go && root.contains(go)) {
      const encs = (current.caseFile?.encounters || []).filter((x) => x && x.date).sort(byDate);
      if (!encs.length) return;
      const at = (encs.filter((x) => x.date <= current.state.asOf).pop() || encs[0]).date;
      const i = encs.findIndex((x) => x.date === at);
      const next = encs[Math.min(encs.length - 1, Math.max(0, i + Number(go.dataset.go)))];
      if (next && next.date !== current.state.asOf) current.setState({ asOf: next.date });
      return;
    }
    const pick = e.target.closest('[data-asof]');
    if (pick && root.contains(pick)) {
      if (pick.dataset.asof !== current.state.asOf) current.setState({ asOf: pick.dataset.asof });
      return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav && root.contains(nav)) { current.navigate(nav.dataset.nav); return; }
    const act = e.target.closest('[data-action="sim-on"]');
    if (act && root.contains(act)) current.setState({ includeHome: true });
  };
  const onToggle = (e) => { if (e.target && e.target.id === 'pv-details') detailsOpen = e.target.open; };
  root.addEventListener('click', onClick);
  root.addEventListener('toggle', onToggle, true);
  render();
  return {
    update(c) { current = c; render(); },
    unmount() { root.removeEventListener('click', onClick); root.removeEventListener('toggle', onToggle, true); },
  };
}

// For tests in Node (no DOM needed).
export const _test = { whoIs, buildModel, checkinModel, mdcFor };
