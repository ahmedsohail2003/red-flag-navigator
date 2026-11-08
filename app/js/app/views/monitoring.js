// Monitoring (#monitoring): home tests and phone or wearable signals by body region,
// run between visits and alongside the referral (never instead of it).
// The trend charts follow the case picked in the top bar (ctx.caseFile): Alex's weekly
// values are SIMULATED (he never had home tests); a case built in this browser shows the
// values entered in it. The working tests save real results in this browser only; their
// logic and maths live in ../../hometests.js. The coverage matrix and the phone and
// wearable signals are the same for every case.
import { esc, fmtDate, TIER, tierChip, simChip, assumeChip, ensureCss, plural } from '../ui.js';
import { engineOpts } from '../store.js';
import { getCase, saveUserCase } from '../../cases.js';
import { HOME_TESTS, FINDINGS, UNCLEAR_DEADLINE_WEEKS, detectDecline, evaluateAt, stateAt } from '../../engine.js';
import { WEARABLES } from '../../wearables.js';
import { ALEX } from '../../alex.js';
import { createEffect, palette } from '../../fx/core.js';
import {
  initHomeTests, getResults, weeklySeries, mdcInUse, currentPerson, unitFor, UNIT, SHORT, TAP_SECONDS, CALIB_TRIALS,
} from '../../hometests.js';

const round1 = (x) => (Math.abs(x) < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10); // 2 decimals below 10 (walking speed in m/s), 1 above
const num = (x) => (Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : Math.abs(x) < 10 ? String(Math.round(x * 100) / 100) : x.toFixed(1)) : '–');
const f1 = (n) => n.toFixed(1);
const byDate = (a, b) => a.date.localeCompare(b.date);
const realChip = () => '<span class="chip real" title="Saved in this browser by the working test">Real</span>';
const enteredChip = () => '<span class="chip" title="Typed into the case file">Entered</span>';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const mdcChip = (measured) => (measured ? '<span class="chip real" title="Measured by the team, 10 repeats each">Measured</span>' : assumeChip());
// built: the code is done and passes its tests on simulated input, but has not been tried on the real device yet
const STATUS = { working: ['st-working', 'Working'], built: ['st-mock', 'Built, not yet tried on a phone'], mock: ['st-mock', 'Mockup'], research: ['st-research', 'Research'] };
const statusChip = (s) => `<span class="chip ${STATUS[s][0]}">${STATUS[s][1]}</span>`;
const measurementIn = (caseFile, prefix) => ((caseFile && caseFile.measurements) || []).find((m) => String(m.label || '').startsWith(prefix)) || null;

// Who the case is about, for headings. Demo cases are presentations, not people.
const PLACEHOLDER_NAMES = new Set(['', 'new patient', 'unnamed patient']);
function whoOf(ctx) {
  const entry = ctx.caseEntry || {};
  const kind = entry.kind || (entry.id === 'alex' ? 'case-file' : 'user');
  const full = String(ctx.caseFile?.patient?.name || '').trim();
  const named = kind !== 'demo' && !PLACEHOLDER_NAMES.has(full.toLowerCase());
  const sex = String(ctx.caseFile?.patient?.sex || '').trim().toLowerCase();
  // same rule as the Patient app: "Dr. Jane Smith" is "Dr. Smith", never "Dr."
  const words = full.split(/\s+/).filter(Boolean);
  let first = named ? words[0] || '' : '';
  if (named && /^(mr|mrs|ms|mx|miss|dr|prof)\.?$/i.test(first) && words.length > 1) first = `${words[0]} ${words[words.length - 1]}`;
  return {
    kind, named, demo: kind === 'demo', full: full || 'Unnamed patient', caseName: entry.name || full || 'This case',
    first,
    his: sex === 'male' || sex === 'm' ? 'his' : sex === 'female' || sex === 'f' ? 'her' : 'their',
  };
}

// The case's own weekly values, and where they came from.
function caseHome(caseFile) {
  const all = ((caseFile && caseFile.homeTests) || []).filter((h) => h && HOME_TESTS[h.test] && typeof h.date === 'string' && Number.isFinite(h.value));
  return { all, any: all.length > 0, simulated: all.some((h) => h.simulated), entered: all.some((h) => !h.simulated) };
}

// The date the charts and the strip read to. Normally the visit picked in the top bar; at
// the latest visit, weekly results after it count too (that is what the tests are for).
function cutFor(ctx, info) {
  const dates = ((ctx.caseFile && ctx.caseFile.encounters) || []).map((e) => e && e.date).filter(Boolean).sort();
  const lastHome = info.all.map((h) => h.date).sort().pop() || null;
  if (!dates.length) return { visits: 0, asOf: null, cut: lastHome || '9999-12-31', later: 0 };
  const asOf = dates.includes(ctx.state.asOf) ? ctx.state.asOf : dates[dates.length - 1];
  const atLast = asOf === dates[dates.length - 1];
  const cut = ctx.state.includeHome && atLast && lastHome && lastHome > asOf ? lastHome : asOf;
  const later = cut > asOf ? new Set(info.all.filter((h) => h.date > asOf && h.date <= cut).map((h) => h.date)).size : 0;
  return { visits: dates.length, asOf, cut, later };
}

// What watches each body region today. Status words: Working (try it below), Mockup
// (designed, not built), Research (being checked). No evidence claims here.
const COVERAGE = [
  { region: 'Hand and arm', alex: 'Grip strength', home: ['Finger tapping, each hand', 'working'], phone: ['Typing speed', 'research'], wear: null },
  { region: 'Legs and walking', alex: '10-metre walk', home: ['Walking speed, 10 m walk (phone motion sensors)', 'built'], phone: ['Walking speed and step length (iPhone)', 'research'], wear: ['Daily steps and active minutes', 'research'] },
  { region: 'Speech and swallowing', alex: 'Speaking rate', home: ['Reading a fixed passage aloud', 'working'], phone: ['Voice from the phone microphone', 'research'], wear: null },
  { region: 'Breathing', alex: 'Forced vital capacity', home: null, phone: null, wear: ['Night-time breathing rate and blood oxygen', 'research'] },
  { region: 'Whole body', alex: 'Weight', home: ['Body weight, typed in weekly', 'working'], phone: null, wear: ['Weight from a smart scale', 'research'] },
];

// Shown while the wearables research is still running: names only, no numbers or evidence.
const CANDIDATES = [
  { signal: 'Walking speed and step length', from: 'iPhone carried in a pocket', region: 'Legs and walking' },
  { signal: 'Daily steps and active minutes', from: 'Apple Watch, Fitbit and similar watches', region: 'Legs and walking' },
  { signal: 'Night-time breathing rate and blood oxygen', from: 'A watch or ring worn in bed', region: 'Breathing' },
  { signal: 'Typing speed', from: 'Phone keyboard', region: 'Hand and arm' },
  { signal: 'Voice', from: 'Phone microphone', region: 'Speech and swallowing' },
  { signal: 'Weight', from: 'Smart scale', region: 'Whole body' },
];

// ---------------- verdict in words (detectDecline from the engine) ----------------
function verdictFor(series, test, mdc) {
  const meta = HOME_TESTS[test];
  const u = (v) => unitFor(test, v);
  if (series.length < 2) {
    return { cls: '', text: `<b>Baseline not set yet.</b> ${series.length ? '1 week so far' : 'No weeks yet'}; the first two weekly results set it.` };
  }
  const base = (series[0].value + series[1].value) / 2;
  if (series.length < 4) {
    return { cls: '', text: `<b>Baseline ${num(round1(base))} ${esc(UNIT[test])}</b> from the first two weeks. ${plural(series.length, 'week')} so far; a drop can count from week 4, once two results in a row beat the MDC.` };
  }
  const d = detectDecline(series, { mdc, higherIsBetter: meta.higherIsBetter });
  const latest = series[series.length - 1].value;
  const worse = meta.higherIsBetter ? base - latest : latest - base;
  const side = meta.higherIsBetter ? 'below' : 'above';
  if (d) {
    const i = series.findIndex((p) => p.date === d.date);
    const prev = series[i - 1];
    return {
      cls: 'decline', d,
      text: `<b>Decline confirmed on ${fmtDate(d.date)}.</b> Two results in a row (${num(prev.value)} on ${fmtDate(prev.date)}, then ${num(d.latest)}) were more than ${num(mdc)} ${esc(u(mdc))} ${side} the baseline of ${num(round1(d.baseline))}. A reason to look sooner, not a diagnosis.`,
    };
  }
  if (worse > mdc) {
    return { cls: 'once', text: `<b>Beyond normal variation once.</b> Latest ${num(latest)} against a baseline of ${num(round1(base))}; one more like it would confirm a decline.` };
  }
  return { cls: 'ok', text: `<b>Within normal variation.</b> Baseline ${num(round1(base))}, latest ${num(latest)}, MDC ±${num(mdc)} ${esc(u(mdc))}.` };
}

// The noise floor for tapping, next to Alex's tapping trend. Since 8 Nov the engine's default
// is the published weekly-home figure (the signals list below), so his simulated drop no
// longer counts; the box also shows what the old 6-tap placeholder would have said. With a
// team-measured MDC it compares the two. Every verdict is worked out here, at run time, by
// the engine's own rule on ALEX's tap_right series. Nothing in them is typed.
function tapFloorHtml(w) {
  const pub = (signalsList() || []).find((s) => s && s.id === 'phone_finger_tapping');
  const big = Number(pub && pub.mdc && pub.mdc.value);
  const series = ((ALEX && ALEX.homeTests) || []).filter((h) => h && h.test === 'tap_right').sort(byDate);
  if (!(big > 0) || series.length < 4) return '';
  const { value: small, measured } = mdcInUse('tap_right');
  const OLD = 6; // the placeholder the engine used until 8 Nov, when it took the published figure
  const said = (m, lead = true) => {
    const d = detectDecline(series, { mdc: m, higherIsBetter: HOME_TESTS.tap_right.higherIsBetter });
    const head = lead ? `with ±${num(m)} it` : 'it';
    if (!d) return `${head} <b>would not count as a decline</b>`;
    const prev = series[series.findIndex((p) => p.date === d.date) - 1];
    return `${head} <b>counts as a decline</b>, confirmed ${fmtDate(d.date)} (${num(prev.value)}, then ${num(d.latest)}, against a baseline of ${num(round1(d.baseline))})`;
  };
  const unit = asText(pub.mdc.unit) || 'taps';
  const how = [
    /provisional/i.test(asText(pub.mdc.text)) ? 'provisional' : '',
    pub.mdc.computed_by_us === true ? 'scaled by the research from the 20-second WatchALS test, whose units are ambiguous' : '',
  ].filter(Boolean).join(', ');
  const who = esc(w.named ? w.first : 'this case');
  const pubText = `about ${num(big)} ${esc(unit)}${how ? ` (${esc(how)})` : ''}`;
  const same = !measured && Math.abs(small - big) < 1e-9; // the engine's default is the published figure
  if (same) {
    return `<div class="inset mon-floor">
    <div class="micro dot">Noise floor for tapping</div>
    <p>The engine uses the published weekly-home figure from the signals list below, ${pubText} ${assumeChip()}, until the team measures its own.</p>
    <p>For ${who}'s simulated right-hand drop, ${said(big)}. Under the old placeholder of ±${OLD}, used until 8 Nov, ${said(OLD, false)}: about a fifth to a third of stable people per hand would be flagged like that within 8 weeks.</p>
  </div>`;
  }
  return `<div class="inset mon-floor">
    <div class="micro dot">Two noise floors for tapping</div>
    <p>${measured
    ? `The engine uses the team's measured MDC of ±${num(small)} taps ${mdcChip(true)}.`
    : `The engine uses an MDC of ±${num(small)} taps ${assumeChip()} until the team measures its own.`}
    The published weekly-home figure, in the signals list below, is ${pubText}.</p>
    <p>For ${who}'s simulated right-hand drop, ${Math.abs(small - big) < 0.5 ? said(small) : `${said(small)}; ${said(big)}`}.</p>
  </div>`;
}

// ---------------- small line chart (SVG, drawn with the tokens) ----------------
const CHARTS = new Map(); // id -> { W, pts, unitOf }
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}
const tt = (d) => Date.parse(`${d}T00:00:00Z`);

// points: the person's weekly values (sorted); domain: points that fix the x axis;
// yRange: [lo, hi] shared across small multiples; tone: 'sim' or 'real'.
function chartSvg(id, { points, domain, yRange, mdc, test, tone, W, title }) {
  const meta = HOME_TESTS[test];
  const narrow = W < 420;
  const H = narrow ? 210 : 226;
  const L = 38; const R = narrow ? 92 : 104; const T = 24; const B = 30;
  const pw = W - L - R; const ph = H - T - B;
  const dom = domain && domain.length ? domain : points;
  const t0 = dom.length ? tt(dom[0].date) : 0;
  const t1 = dom.length ? tt(dom[dom.length - 1].date) : 0;
  const x = (d) => (t1 > t0 ? L + ((tt(d) - t0) / (t1 - t0)) * pw : L + pw / 2);
  const base = points.length >= 2 ? (points[0].value + points[1].value) / 2 : null;
  let [lo, hi] = yRange || (() => {
    const vals = dom.map((p) => p.value).concat(base != null ? [base - mdc, base + mdc] : []);
    return [Math.min(...vals), Math.max(...vals)];
  })();
  // one value only: open the axis by the MDC, so whole-number tests keep whole-number ticks
  if (!(hi > lo)) { const pad = mdc > 0 ? mdc : 1; lo -= pad; hi += pad; }
  const step = niceStep((hi - lo) / 4);
  lo = Math.floor((lo - step * 0.5) / step) * step;
  hi = Math.ceil((hi + step * 0.25) / step) * step;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * ph;
  const tick = (v) => (step >= 1 ? String(Math.round(v)) : v.toFixed(1));

  let g = '';
  for (let v = lo; v <= hi + step / 1000; v += step) {
    g += `<line class="gridline" x1="${L}" x2="${L + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="tick" x="${L - 8}" y="${f1(y(v) + 4)}" text-anchor="end">${tick(v)}</text>`;
  }
  // x labels: first, middle and last (first and last only when narrow, so they never collide)
  const xl = dom.length > 4 && !narrow ? [dom[0], dom[Math.floor((dom.length - 1) / 2)], dom[dom.length - 1]] : dom.length > 1 ? [dom[0], dom[dom.length - 1]] : dom;
  xl.forEach((p, i) => {
    const anchor = xl.length === 1 ? 'middle' : i === 0 ? 'start' : i === xl.length - 1 ? 'end' : 'middle';
    g += `<text class="tick" x="${f1(x(p.date))}" y="${H - 8}" text-anchor="${anchor}">${esc(fmtDate(p.date))}</text>`;
  });

  let bands = '';
  let side = '';
  if (base != null) {
    // the two baseline weeks
    const bx0 = Math.max(L, x(points[0].date) - 10);
    const bx1 = Math.min(L + pw, x(points[1].date) + 10);
    bands += `<rect class="base-wk" x="${f1(bx0)}" y="${T}" width="${f1(Math.max(4, bx1 - bx0))}" height="${ph}" rx="3"/>`;
    bands += `<text class="lbl" x="${f1(bx0)}" y="${T - 8}">Baseline weeks</text>`;
    // normal variation: baseline ± MDC
    const yTop = y(base + mdc); const yBot = y(base - mdc);
    bands += `<rect class="band" x="${L}" y="${f1(yTop)}" width="${pw}" height="${f1(yBot - yTop)}"/>`;
    const edge = meta.higherIsBetter ? base - mdc : base + mdc;
    bands += `<line class="edge-line" x1="${L}" x2="${L + pw}" y1="${f1(y(edge))}" y2="${f1(y(edge))}"/>`;
    bands += `<line class="base-line" x1="${L}" x2="${L + pw}" y1="${f1(y(base))}" y2="${f1(y(base))}"/>`;
    const lx = L + pw + 10;
    if (Math.abs(y(base) - y(edge)) < 14) {
      side += `<text class="lbl" x="${lx}" y="${f1(y(base) + 4)}">Baseline ${num(round1(base))} ±${num(mdc)}</text>`;
    } else {
      side += `<text class="lbl" x="${lx}" y="${f1(y(base) + 4)}">Baseline ${num(round1(base))}</text>`;
      side += `<text class="lbl" x="${lx}" y="${f1(y(edge) + 4)}">MDC ${meta.higherIsBetter ? '−' : '+'}${num(mdc)}</text>`;
    }
  }

  const d = base != null && points.length >= 4 ? detectDecline(points, { mdc, higherIsBetter: meta.higherIsBetter }) : null;
  const pts = points.map((p, i) => {
    const delta = base != null ? p.value - base : null;
    const worse = base != null && i >= 2 && (meta.higherIsBetter ? base - p.value : p.value - base) > mdc;
    return { cx: x(p.date), cy: y(p.value), date: p.date, value: p.value, delta, worse, confirm: !!(d && p.date === d.date) };
  });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p.cx)},${f1(p.cy)}`).join('');
  let marks = pts.length > 1 ? `<path class="series" d="${path}"/>` : '';
  for (const p of pts) {
    marks += `<circle class="pt${p.worse ? ' worse' : ''}${p.confirm ? ' confirm' : ''}" cx="${f1(p.cx)}" cy="${f1(p.cy)}" r="${p.confirm ? 5 : 4}"/>`;
  }
  const c = pts.find((p) => p.confirm);
  if (c) {
    // place the label where it covers no point and no stretch of the line (any shape of data)
    const LW = 104; const LH = 13;
    const probes = [];
    pts.forEach((p, i) => { probes.push([p.cx, p.cy]); if (i) for (const t of [0.25, 0.5, 0.75]) probes.push([pts[i - 1].cx + (p.cx - pts[i - 1].cx) * t, pts[i - 1].cy + (p.cy - pts[i - 1].cy) * t]); });
    const clear = (x0, y0) => x0 >= L - 2 && x0 + LW <= L + pw + R - 6 && y0 >= T - 2 && y0 + LH <= T + ph + 2
      && !probes.some(([px, py]) => px > x0 - 5 && px < x0 + LW + 5 && py > y0 - 5 && py < y0 + LH + 5);
    const cands = [
      [c.cx + 8, c.cy + 9, 'start'], [c.cx - 8 - LW, c.cy + 9, 'end'], [c.cx + 8, c.cy - 9 - LH, 'start'], [c.cx - 8 - LW, c.cy - 9 - LH, 'end'],
      [c.cx - LW / 2, c.cy + 14, 'middle'], [c.cx - LW / 2, c.cy - 14 - LH, 'middle'],
    ];
    const pick = cands.find(([x0, y0]) => clear(x0, y0)) || (c.cy + 20 < T + ph - 2 ? cands[4] : cands[5]);
    const [x0, y0, anchor] = pick;
    const tx = anchor === 'start' ? x0 : anchor === 'end' ? x0 + LW : x0 + LW / 2;
    marks += `<text class="lbl-strong" x="${f1(tx)}" y="${f1(y0 + LH - 3)}" text-anchor="${anchor}">Decline confirmed</text>`;
  }

  CHARTS.set(id, { W, pts, unitOf: (v) => unitFor(test, v) });
  const summary = `${title}: ${points.length ? `${plural(points.length, 'weekly value')} from ${num(points[0].value)} to ${num(points[points.length - 1].value)} ${UNIT[test]}` : 'no values yet'}${base != null ? `, baseline ${num(round1(base))}, normal variation ±${num(mdc)}` : ''}${d ? `, decline confirmed ${fmtDate(d.date)}` : ''}.`;
  return `<div class="mon-chart">
    <svg class="mon-svg tone-${tone}" data-chart="${id}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(summary)}">
      ${bands}${g}${side}${marks}
      <line class="xhair" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>
      <circle class="focus-ring" cx="0" cy="0" r="7" visibility="hidden"/>
      <rect class="hit" x="${L}" y="${T}" width="${pw}" height="${ph}"/>
    </svg>
    <div class="mon-tip" hidden></div>
  </div>`;
}

function valuesTable(points, test) {
  if (!points.length) return '';
  const base = points.length >= 2 ? (points[0].value + points[1].value) / 2 : null;
  const rows = points.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${fmtDate(p.date)}</td><td class="num">${num(p.value)}</td><td class="num">${base != null ? `${p.value - base >= 0 ? '+' : '−'}${num(Math.abs(round1(p.value - base)))}` : '–'}</td></tr>`).join('');
  return `<details class="mon-values"><summary>Show the values</summary>
    <div class="table-wrap"><table class="tbl"><thead><tr><th class="num">Week</th><th>Date</th><th class="num">${esc(UNIT[test])}</th><th class="num">vs baseline</th></tr></thead><tbody>${rows}</tbody></table></div>
  </details>`;
}

// ---------------- sections ----------------
function statusHtml(ctx, info, at) {
  const s = ctx.state;
  const cf = ctx.caseFile;
  const prov = (sim) => (sim ? ` ${simChip()}` : info.any ? ` ${enteredChip()}` : '');
  let indicator;
  let ev = null;
  if (!at.visits) {
    indicator = `<div class="micro">Indicator</div><div class="mon-strip-v">No visits yet</div><div class="note">The indicator starts from the red flags quoted in a visit note. Add a visit on the <a href="#cases">Cases</a> page.</div>`;
  } else {
    ev = evaluateAt(cf, at.cut, ctx.opts);
    const label = at.later ? `Indicator now · results to ${fmtDate(at.cut)}` : `Indicator at ${fmtDate(at.asOf)}`;
    const extra = at.later ? ` Includes ${plural(at.later, 'weekly result')} after the last visit (${fmtDate(at.asOf)}).` : '';
    indicator = `<div class="micro">${label}</div><div class="mon-strip-v">${tierChip(ev.tier)}<span>${esc(TIER[ev.tier]?.action || '')}</span></div><div class="note">${esc(ev.reason)}.${esc(extra)}</div>`;
  }
  const declines = (ev && ev.state && ev.state.homeDeclines) || [];
  // declines in the data even if the doctor unticked them in the indicator
  const found = s.includeHome && info.any ? stateAt(cf, at.cut, { ...ctx.opts, exclude: new Set() }).homeDeclines : [];
  const list = (xs) => xs.map((x) => `${esc(SHORT[x.test] || x.test)}, confirmed ${fmtDate(x.date)}`).join('; ');
  const offWord = info.simulated && !info.entered ? 'Simulated home data' : 'Home data';
  let home;
  if (!info.any) {
    home = `<div class="mon-strip-v">No home results</div><div class="note">This case has no weekly home-test values, so the indicator uses the visit notes only.</div>`;
  } else if (!s.includeHome) {
    home = `<div class="mon-strip-v">Not counted</div><div class="note">${offWord} is off, so the indicator uses the visit notes only.</div>`;
  } else if (!at.visits) {
    home = found.length
      ? `<div class="mon-strip-v">Decline in the data${prov(found.some((x) => x.simulated))}</div><div class="note">${list(found)}. It counts once the case has a visit.</div>`
      : `<div class="mon-strip-v">No confirmed decline${prov(info.simulated)}</div><div class="note">Nothing beyond normal variation so far.</div>`;
  } else if (declines.length) {
    home = `<div class="mon-strip-v">Decline counted${prov(declines.some((x) => x.simulated))}</div><div class="note">${list(declines)}.</div>`;
  } else if (found.length) {
    home = `<div class="mon-strip-v">Decline left out${prov(found.some((x) => x.simulated))}</div><div class="note">Unticked in the indicator: ${list(found)}.</div>`;
  } else {
    home = `<div class="mon-strip-v">No confirmed decline${prov(info.simulated)}</div><div class="note">Nothing beyond normal variation by ${fmtDate(at.cut)}.</div>`;
  }
  return `<div class="card mon-strip">
    <div class="mon-strip-cell">${indicator}</div>
    <div class="mon-strip-cell"><div class="micro">Home-test decline</div>${home}</div>
    <div class="mon-strip-cell"><div class="micro">When the tier is Unclear</div><div class="mon-strip-v">Weekly tests for ${UNCLEAR_DEADLINE_WEEKS} weeks</div><div class="note">A confirmed decline escalates to an EMG referral straight away; no decline by week ${UNCLEAR_DEADLINE_WEEKS} steps down.</div></div>
  </div>`;
}

function caseHtml(ctx, W, info, at) {
  const s = ctx.state;
  const w = whoOf(ctx);
  for (const k of [...CHARTS.keys()]) if (k.startsWith('c-')) CHARTS.delete(k);
  const tests = Object.keys(HOME_TESTS).filter((t) => info.all.some((h) => h.test === t));
  const onlyTap = tests.length > 0 && tests.every((t) => t.startsWith('tap_'));
  const what = onlyTap ? 'weekly tapping' : 'weekly home tests';
  const title = w.named ? `${w.first}'s ${what}` : `${cap(what)} in this ${w.demo ? 'demo case' : 'case'}`;
  const aside = !info.any ? ''
    : info.simulated && !info.entered ? (w.kind === 'case-file' && w.named ? `Made up for the demo: ${w.first} never had home tests` : 'Made up for the demo')
    : info.simulated ? 'Some values made up for the demo, some entered in the case'
    : 'Entered in the case file';
  const head = `<div class="section-head"><h2>${esc(title)}</h2><span class="aside">${esc(aside)}</span></div>`;
  if (!info.any) {
    const text = w.demo
      ? 'This look-alike demo has no weekly home-test values, so there is no trend to chart. The working tests below save real results in this browser, apart from any case.'
      : w.kind === 'user'
        ? `${w.named ? esc(w.full) : 'This case'} has no weekly home-test values yet. Run the working tests below; the saved results can then be added to this case, where they count in the indicator when Home data is on.`
        : 'This case has no weekly home-test values, so there is no trend to chart.';
    return `${head}<div class="card card-pad mon-off">
      <div class="stack">
        <div class="micro dot">No weekly results in this case</div>
        <p class="muted">${text}</p>
      </div>
      <button type="button" class="btn" data-act="to-tests">Go to the working tests</button>
    </div>`;
  }
  if (!s.includeHome) {
    const simOnly = info.simulated && !info.entered;
    const n = new Set(info.all.map((h) => h.date)).size;
    // Promise a confirmed decline only when the engine's rule, at the engine's noise floor, finds one
    // in this case's values. Since 8 Nov (±18 taps) Alex's simulated drop never counts.
    const floorOf = (t) => (Number(ctx.opts?.mdc?.[t]) > 0 ? Number(ctx.opts.mdc[t]) : HOME_TESTS[t].placeholderMdc);
    const declines = tests.some((t) => detectDecline(info.all.filter((h) => h.test === t), { mdc: floorOf(t), higherIsBetter: HOME_TESTS[t].higherIsBetter }));
    const floors = [...new Set(tests.map((t) => `±${num(floorOf(t))} ${unitFor(t, floorOf(t))}`))];
    const none = (they) => ` At the engine's normal variation${floors.length === 1 ? ` of ${esc(floors[0])}` : onlyTap ? ' for each hand' : ' for each test'} ${they ? 'they show' : 'it shows'} no confirmed decline, so ${they ? 'they add' : 'it adds'} no red flag to the indicator.`;
    const text = simOnly
      ? (w.kind === 'case-file' && w.named
        ? `${esc(w.first)} never had home tests. Turn on the simulated weekly ${onlyTap ? 'tapping' : 'results'} to see what ${onlyTap ? 'it' : 'they'} would have shown between ${w.his} visits${declines ? ', and how a confirmed decline feeds the indicator.' : `.${none(!onlyTap)}`}`
        : `The weekly values in this case are made up for the demo. ${declines ? 'Turn them on to see how a confirmed decline feeds the indicator.' : `Turn them on to chart them against the baseline.${none(true)}`}`)
      : `This case has weekly results on ${plural(n, 'day')}. Turn on home data to chart them against the baseline${declines ? ' and let a confirmed decline count in the indicator.' : `.${none(true)}`}`;
    return `${head}<div class="card card-pad mon-off">
      <div class="stack">
        <div class="micro dot">${simOnly ? 'Simulated home data is off' : 'Home data is off'}</div>
        <p class="muted">${text}</p>
      </div>
      <button type="button" class="btn primary" data-act="sim-on">${simOnly ? 'Turn on simulated home data' : 'Turn on home data'}</button>
    </div>`;
  }
  // one y scale per unit (both hands share one), so charts of the same test compare at a glance
  const yRanges = new Map();
  for (const unit of new Set(tests.map((t) => HOME_TESTS[t].unit))) {
    const same = tests.filter((t) => HOME_TESTS[t].unit === unit);
    const ys = info.all.filter((h) => same.includes(h.test)).map((h) => h.value);
    for (const t of same) {
      const ser = info.all.filter((h) => h.test === t).sort(byDate);
      if (ser.length >= 2) { const b = (ser[0].value + ser[1].value) / 2; const m = mdcInUse(t).value; ys.push(b - m, b + m); }
    }
    yRanges.set(unit, [Math.min(...ys), Math.max(...ys)]);
  }
  const by = at.visits ? `by ${fmtDate(at.cut)}` : 'so far';
  const cards = tests.map((test) => {
    const meta = HOME_TESTS[test];
    const full = info.all.filter((h) => h.test === test).sort(byDate);
    const series = full.filter((h) => h.date <= at.cut);
    const sim = full.some((h) => h.simulated);
    const typed = full.some((h) => !h.simulated);
    const { value: mdc, measured } = mdcInUse(test);
    const v = verdictFor(series, test, mdc);
    const key = `home:${test}`;
    const excluded = s.exclude.includes(key) || s.exclude.includes('home_decline');
    const fw = FINDINGS.home_decline;
    let counted = '';
    if (v.d && at.visits) {
      counted = excluded
        ? `<div class="mon-count"><span class="mon-count-t">Left out of the indicator: unticked by the doctor.</span><button type="button" class="btn sm" data-act="include" data-key="${key}">Count it again</button></div>`
        : `<div class="mon-count"><span class="mon-count-t">Counts in the indicator as a home-test decline: odds ratio ${fw.or.toFixed(1)} (${fw.lo.toFixed(1)} to ${fw.hi.toFixed(1)}) ${assumeChip()}</span><button type="button" class="btn sm" data-act="exclude" data-key="${key}">Leave it out</button></div>`;
      const engineMdc = Number(ctx.opts?.mdc?.[test]) > 0 ? Number(ctx.opts.mdc[test]) : meta.placeholderMdc;
      if (Math.abs(engineMdc - mdc) > 1e-9) counted += `<p class="note">The indicator uses ±${num(engineMdc)} for this test; this chart uses ±${num(mdc)}.</p>`;
    }
    const chart = series.length
      ? chartSvg(`c-${test}`, { points: series, domain: full, yRange: yRanges.get(meta.unit), mdc, test, tone: sim ? 'sim' : 'entered', W, title: `${w.named ? w.first : 'This case'}, ${meta.label.toLowerCase()}, ${sim && typed ? 'partly simulated, partly entered' : sim ? 'simulated' : 'entered'}` })
      : `<div class="inset mon-nochart note">No weekly results yet ${by}.</div>`;
    return `<article class="card mon-chart-card">
      <div class="card-head"><h3>${esc(meta.label)}</h3><span class="aside">${sim ? simChip() : ''}${sim && typed ? ' ' : ''}${typed ? enteredChip() : ''}</span></div>
      <div class="card-body stack">
        <div class="mon-meta"><span class="micro">Normal variation</span><span class="mono">±${num(mdc)} ${esc(unitFor(test, mdc))}</span>${mdcChip(measured)}<span class="spacer"></span><span class="note">${series.length} of ${full.length} weeks ${by}</span></div>
        ${chart}
        <p class="mon-verdict ${v.cls}">${v.text}</p>
        ${counted}
        ${valuesTable(series, test)}
      </div>
    </article>`;
  }).join('');
  const laterNote = at.later ? `<p class="note mon-gap">Showing ${plural(at.later, 'weekly result')} after the last visit (${fmtDate(at.asOf)}): between visits the tests keep running, and a confirmed decline can escalate the indicator on its own.</p>` : '';
  const floor = ctx.caseEntry?.id === 'alex' && tests.includes('tap_right') ? tapFloorHtml(w) : '';
  return `${head}<div class="grid cols-2 mon-pair">${cards}</div>${floor}${laterNote}`;
}

// Saved results that would go into a user case: one value per day and test.
function realForCase(results, person, caseFile) {
  const add = [];
  for (const test of Object.keys(HOME_TESTS)) {
    for (const p of weeklySeries(results, test, person)) add.push({ date: p.date, test, value: test === 'gait_speed' ? Math.round(p.value * 100) / 100 : round1(p.value), simulated: results.some((r) => r && !r.calibration && r.test === test && r.date === p.date && (r.person || '') === person && (r.simulated === true || r.demoDate === true)) });
  }
  const have = (caseFile && caseFile.homeTests) || [];
  const fresh = add.filter((a) => !have.some((h) => h.test === a.test && h.date === a.date && !!h.simulated === !!a.simulated && Math.abs(h.value - a.value) < 0.05));
  return { add, fresh };
}

let flash = null; // { caseId, text, undo } shown after the view re-mounts with the saved case

function bridgeHtml(ctx, results, person) {
  const w = whoOf(ctx);
  if (w.kind !== 'user') return '';
  const { add, fresh } = realForCase(results, person, ctx.caseFile);
  if (!add.length) return '';
  const tests = [...new Set(fresh.map((a) => SHORT[a.test] || a.test))];
  const who = person ? esc(person) : 'no name';
  const btn = fresh.length
    ? `<button type="button" class="btn primary" data-act="add-real">Add ${plural(fresh.length, 'result')} to ${esc(w.full)}</button>`
    : '<button type="button" class="btn" disabled>Already in this case</button>';
  return `<div class="card mon-bridge">
    <div class="mon-bridge-t">
      <div class="micro dot">Use them in this case</div>
      <p>${fresh.length
        ? `${plural(fresh.length, 'weekly value')} saved under ${who} (${esc(tests.join('; '))}) can go into ${esc(w.full)}'s case file. A value on the same day for the same test is replaced. They count in the indicator when Home data is on.`
        : `Every result saved under ${who} is already in ${esc(w.full)}'s case file.`}</p>
    </div>
    ${btn}
  </div>`;
}

function flashHtml(ctx) {
  if (!flash || flash.caseId !== ctx.caseEntry?.id) return '';
  return `<div class="card mon-flash" role="status">
    <span class="mon-flash-t">${esc(flash.text)}</span>
    ${flash.undo ? '<button type="button" class="btn sm" data-act="undo-add">Undo</button>' : ''}
    <button type="button" class="btn sm quiet" data-act="flash-close">Dismiss</button>
  </div>`;
}

function realHtml(W, ctx) {
  for (const k of [...CHARTS.keys()]) if (k.startsWith('r-')) CHARTS.delete(k);
  const person = currentPerson();
  const results = getResults();
  const tests = Object.keys(HOME_TESTS).filter((t) => weeklySeries(results, t, person).length);
  const who = person ? esc(person) : 'results saved with no name';
  const head = `<div class="section-head mon-subhead"><h3>Your weekly results</h3><span class="aside mon-aside">${person ? `Saved under ${who}` : 'Saved with no name'}${results.some((r) => r && !r.calibration && (r.person || '') === person && (r.simulated === true || r.demoDate === true)) ? '' : realChip()}</span></div>`;
  if (!tests.length) {
    return `${head}${flashHtml(ctx)}<div class="card card-pad mon-real-empty"><p class="muted">No weekly results ${person ? `for ${who} ` : ''}yet. Run a test above and it appears here against your own baseline. Calibration trials are kept apart and never count as weekly results.</p></div>`;
  }
  const cards = tests.map((test) => {
    const series = weeklySeries(results, test, person);
    const { value: mdc, measured } = mdcInUse(test);
    const v = verdictFor(series, test, mdc);
    return `<article class="card mon-chart-card">
      <div class="card-head"><h3>${esc(SHORT[test] || test)}</h3><span class="aside">${results.some((r) => r && !r.calibration && r.test === test && (r.person || '') === person && (r.simulated === true || r.demoDate === true)) ? '<span class="chip sim" title="Saved with a demo date or from a simulated walk. Not a real weekly history.">Demo dates</span>' : realChip()}</span></div>
      <div class="card-body stack">
        <div class="mon-meta"><span class="micro">Normal variation</span><span class="mono">±${num(mdc)} ${esc(unitFor(test, mdc))}</span>${mdcChip(measured)}<span class="spacer"></span><span class="note">${plural(series.length, 'day')} with results</span></div>
        ${chartSvg(`r-${test}`, { points: series, mdc, test, tone: 'real', W, title: `${person || 'No name'}, ${SHORT[test]}` })}
        <p class="mon-verdict ${v.cls}">${v.text}</p>
        ${valuesTable(series, test)}
      </div>
    </article>`;
  }).join('');
  return `${head}${flashHtml(ctx)}${bridgeHtml(ctx, results, person)}<div class="grid cols-2 mon-pair">${cards}</div><p class="note mon-gap">One value per day: several runs on the same day are averaged.</p>`;
}

function coverageHtml(ctx) {
  const w = whoOf(ctx);
  const cell = (c, label) => (c
    ? `<td data-label="${label}"><div class="mon-cell"><span>${esc(c[0])}</span>${statusChip(c[1])}</div></td>`
    : `<td data-label="${label}"><span class="mon-none">Nothing yet</span></td>`);
  const rows = COVERAGE.map((r) => {
    const m = measurementIn(ctx.caseFile, r.alex);
    return `<tr><td class="mon-region-cell"><div class="mon-region">${esc(r.region)}</div>${m ? `<div class="mon-alex">${esc(w.named ? w.first : 'This case')}, ${fmtDate(m.date)}: ${esc(m.label)}, ${esc(m.value)}</div>` : ''}</td>${cell(r.home, 'Home test')}${cell(r.phone, 'Phone sensor')}${cell(r.wear, 'Wearable')}</tr>`;
  }).join('');
  return `<div class="section-head"><h2>Coverage by body region</h2><span class="aside">Working: try it below. Built: checked on simulated walks, not yet on a phone. Mockup: designed, not built. Research: being checked.</span></div>
    <div class="table-wrap"><table class="tbl mon-matrix"><thead><tr><th>Body region</th><th>Home test</th><th>Phone sensor</th><th>Wearable</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function testsHtml() {
  // a fixed lesson from Alex's case file (the only file with clinic measurements), shown for every case
  const speak = measurementIn(getCase('alex').caseFile, 'Speaking rate');
  return `<div class="section-head"><h2>Working home tests</h2><span class="aside">Saved in this browser only. Nothing is sent anywhere.</span></div>
    <div class="card mon-who">
      <label class="micro" for="person">Who is testing</label>
      <input id="person" class="mon-input" type="text" placeholder="Name (needed for team calibration)" autocomplete="off" maxlength="40">
      <span class="note">Results are saved under this name and compared only with this person's own earlier results.</span>
    </div>
    <div class="grid cols-12">
      <article class="panel grid-bg span-7 mon-tap" id="tap-card">
        <div class="panel-pad mon-tap-in">
          <div class="mon-tap-head">
            <div><div class="micro dot">Hand and arm · Finger tapping</div><h3>Tap as fast as you can for ${TAP_SECONDS} seconds</h3></div>
            ${statusChip('working')}
          </div>
          <p class="muted">One index finger on the pad, or the Space bar on a laptop. Each hand is tested on its own, so a change on one side is not hidden by the other.</p>
          <div class="calib-banner" id="tap-calib" hidden></div>
          <div class="seg" id="hand-seg" role="group" aria-label="Hand">
            <button type="button" data-test="tap_right" aria-pressed="true">Right hand</button>
            <button type="button" data-test="tap_left" aria-pressed="false">Left hand</button>
          </div>
          <div id="tap-pad" class="panel-inset mon-pad" tabindex="0" role="button" aria-label="Tapping pad: tap here, or press Space">
            <canvas class="mon-pad-fx" aria-hidden="true"></canvas>
            <div class="micro" data-hand-label>Right hand</div>
            <div class="stat-l mon-pad-big" id="tap-big" aria-live="off">Ready</div>
            <div class="mon-pad-small" id="tap-small">Press Start, then tap here</div>
            <div class="mon-pad-bar"><span id="tap-bar"></span></div>
          </div>
          <p class="mon-sr" id="tap-say" aria-live="assertive" aria-atomic="true"></p>
          <div class="row">
            <button type="button" class="btn light" id="tap-start">Start</button>
            <button type="button" class="btn" id="tap-cancel" hidden>Stop without saving</button>
          </div>
          <div id="tap-result" class="mon-result" aria-live="polite"></div>
        </div>
      </article>
      <div class="span-5 stack mon-side">
        <article class="card" id="read-card">
          <div class="card-head"><div class="micro dot">Speech · Reading rate</div><span class="aside">${statusChip('working')}</span></div>
          <div class="card-body stack">
            <p class="muted">Read the passage aloud at your normal pace. Press Start on the first word and Stop after the last.</p>
            <div class="calib-banner" id="read-calib" hidden></div>
            <blockquote class="mon-passage" id="passage"></blockquote>
            <p class="note" id="passage-count"></p>
            <div class="row">
              <button type="button" class="btn primary" id="read-start">Start</button>
              <button type="button" class="btn" id="read-stop" disabled>Stop</button>
              <span class="spacer"></span>
              <span class="stat-s" id="read-timer" aria-live="off">0.0 s</span>
            </div>
            <div id="read-result" class="mon-result" aria-live="polite"></div>
            ${speak ? `<p class="note">Same time of day every week: in Alex's file (${fmtDate(speak.date)}), ${esc(speak.label.toLowerCase())}: ${esc(speak.value)}. The clock alone can look like a decline, or hide one.</p>` : ''}
          </div>
        </article>
        <article class="card" id="weight-card">
          <div class="card-head"><div class="micro dot">Whole body · Body weight</div><span class="aside">${statusChip('working')}</span></div>
          <div class="card-body stack">
            <div class="row">
              <label for="weight-input" class="micro">Weight (kg)</label>
              <input id="weight-input" class="mon-input mon-num" type="number" inputmode="decimal" step="0.1" min="20" max="400">
              <button type="button" class="btn" id="weight-save">Save weight</button>
            </div>
            <div id="weight-result" class="mon-result" aria-live="polite"></div>
            <p class="note" id="weight-why"></p>
          </div>
        </article>
        <article class="card" id="walk-card">
          <div class="card-head"><div class="micro dot">Legs · Walking speed</div><span class="aside">${statusChip('built')}</span></div>
          <div class="card-body stack">
            <p class="muted">A 10 m walk at your usual pace, timed by the phone's motion sensors. It runs on the phone, not on this page.</p>
            <p class="note">With <code>python run.py</code> running, the phone address is in <a href="#devices">Devices and data</a>. Each walk then arrives on <a href="/motion/receive.html">the walk results page</a> on this laptop. Save it there as this week's result; that page uses the same name as "Who is testing" above, and the result appears here.</p>
          </div>
        </article>
      </div>
    </div>
    <div class="section mon-real" id="mon-real"></div>
    <article class="card section" id="calib-card">
      <div class="card-head"><h3>Team calibration</h3><span class="aside note">How big a change is real?</span></div>
      <div class="card-body">
        <div class="grid cols-12">
          <div class="span-7 stack">
            <p class="muted">Every test wobbles a little from one run to the next, even for a healthy person on the same evening. Before a drop is trusted, the team measures that wobble: each teammate does one test ${CALIB_TRIALS} times in a row. This measures the wobble within one sitting, which is smaller than from week to week, so a measured value below the published weekly figure brings false alarms back.</p>
            <div class="row">
              <label class="micro" for="calib-test">Test</label>
              <select id="calib-test" class="select"></select>
              <button type="button" class="btn primary" id="calib-start">Start ${CALIB_TRIALS} trials</button>
              <span class="note" id="calib-hint" aria-live="polite"></span>
            </div>
            <div id="calib-summary" class="stack"></div>
          </div>
          <div class="span-5">
            <div class="inset mon-formula">
              <div class="micro dot">The formula in plain words</div>
              <ol>
                <li><b>Each person's spread.</b> The standard deviation (SD) of each teammate's own trials. Everyone is compared only with themselves.</li>
                <li><b>Pool it.</b> Average the squared spreads across teammates and take the square root: the pooled within-person SD.</li>
                <li><b>Turn it into a change.</b> MDC = 1.96 × √2 × pooled SD. The √2 because a change compares two results, each with its own wobble; the 1.96 covers 95% of normal ups and downs.</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </article>
    <article class="card section mon-history" id="history-card">
      <div class="card-head">
        <h3>Saved results</h3><span class="note" id="history-count"></span>
        <div class="aside row mon-actions">
          <button type="button" class="btn sm" id="csv-btn">Download CSV</button>
          <button type="button" class="btn sm" id="csv-copy-btn">Copy CSV</button>
          <button type="button" class="btn sm quiet mon-danger" id="delete-btn">Delete all results</button>
        </div>
      </div>
      <div class="mon-scroll"><table class="tbl" id="history-table"></table></div>
      <p class="note card-pad" id="history-empty">No results yet. Run a test above; each result is saved in this browser.</p>
    </article>`;
}

// ---------------- phone and wearable signals ----------------
function signalsList() {
  if (Array.isArray(WEARABLES)) return WEARABLES;
  if (WEARABLES && Array.isArray(WEARABLES.signals)) return WEARABLES.signals;
  return null;
}
const asText = (v) => {
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ');
  if (v == null) return '';
  if (typeof v === 'object') return asText(v.name ?? v.label ?? v.title ?? v.text ?? '');
  return String(v);
};
function passiveText(p) {
  if (p === true) return 'Passive';
  if (p === false) return 'Active';
  const s = asText(p);
  return s ? s[0].toUpperCase() + s.slice(1) : '–';
}
// One short MDC per row: the value and its unit from the research's mdc object. A unit
// the source never stated reads as words, never as if it were a unit.
const mdcNum = (v) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 3 });
function mdcShort(m) {
  if (m == null || m === '') return '';
  if (typeof m !== 'object' || Array.isArray(m)) return asText(m);
  if (m.value == null || m.value === '' || !Number.isFinite(Number(m.value))) return '';
  const unit = asText(m.unit).trim();
  return !unit || /not\s+(stated|given|reported)|unknown|unclear/i.test(unit)
    ? `${mdcNum(m.value)} (units not stated in the source)`
    : `${mdcNum(m.value)} ${unit}`;
}
const urlLabel = (u) => String(u).replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
function sourcesHtml(src) {
  const arr = Array.isArray(src) ? src : src ? [src] : [];
  return arr.map((s) => {
    const url = typeof s === 'string' ? s : (s && (s.url || s.link || s.href)) || '';
    const safe = /^https?:\/\//i.test(url) ? url : '';
    const label = (typeof s === 'object' && s && (s.title || s.label || s.name || s.cite || s.short)) || (safe ? urlLabel(safe) : url);
    return `<li>${safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label)}</li>`;
  }).join('');
}

// Body regions in the coverage matrix's order, keyed by the research's own region names.
const SIG_GROUPS = [
  ['hand/arm', 'Hand and arm'], ['leg', 'Leg and walking'], ['speech/swallowing', 'Speech and swallowing'],
  ['breathing', 'Breathing'], ['whole body', 'Whole body'],
];

// A row shows four short things; the paragraphs wait in its expander, so none of them
// sets the height of the row.
function signalRow(s, region) {
  const name = asText(s.signal) || 'Signal';
  const grade = asText(s.evidence_grade);
  const short = mdcShort(s.mdc);
  const m = s.mdc && typeof s.mdc === 'object' && !Array.isArray(s.mdc) ? s.mdc : null;
  const devices = (Array.isArray(s.devices_apis) ? s.devices_apis : [s.devices_apis]).map(asText).filter(Boolean);
  const src = sourcesHtml(s.sources);
  const mSrc = m && /^https?:\/\//i.test(String(m.source || '')) ? String(m.source) : '';
  const mdcMore = m
    ? `<p>${esc(asText(m.text) || short || 'No note.')}</p>
        ${m.population ? `<p class="note">Population: ${esc(asText(m.population))}.</p>` : ''}
        ${mSrc ? `<p class="note">Source: <a href="${esc(mSrc)}" target="_blank" rel="noopener">${esc(urlLabel(mSrc))}</a>${m.computed_by_us === true ? '. The value is worked out by the research from this source, not quoted from it.' : ''}</p>` : ''}`
    : '<p>Not known: the research found no published MDC for this signal.</p>';
  return `<details class="mon-sg-row">
      <summary>
        <span class="mon-sg-name"><span class="mon-sg-t">${esc(name)}</span>${s.demo === true ? '<span class="mon-sg-demo" title="One of the research\'s picks for this demo">In the demo</span>' : ''}</span>
        <span class="mon-sg-grade">${grade ? `<span class="chip" title="Evidence in ALS: ${esc(grade)}"><span class="mon-sr">Evidence in ALS: </span>${esc(grade)}</span>` : '<span class="faint">–</span>'}</span>
        <span class="mon-sg-meta">
          <span class="mon-sg-region">${esc(region)}</span>
          <span class="mon-sg-kind">${esc(passiveText(s.passive))}</span>
          <span class="mon-sg-mdc"><span class="mon-sr">MDC: </span>${short ? esc(short) : '<span class="faint">Not known</span>'}</span>
        </span>
      </summary>
      <div class="mon-sg-more">
        <div><div class="micro">Devices and APIs</div>${devices.length ? `<ul class="mon-src">${devices.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '<p>Not recorded.</p>'}</div>
        <div><div class="micro">Access</div><p>${esc(asText(s.access)) || 'Not recorded.'}</p></div>
        <div><div class="micro">MDC</div>${mdcMore}</div>
        <div><div class="micro">Evidence in ALS</div><p>${esc(asText(s.als_evidence)) || 'Not recorded.'}</p></div>
        ${src ? `<div class="mon-sg-wide"><div class="micro">Sources</div><ul class="mon-src">${src}</ul></div>` : ''}
      </div>
    </details>`;
}

function signalsHtml() {
  const list = signalsList();
  const head = `<div class="section-head"><h2>Phone and wearable signals</h2><span class="aside">Alongside the referral; none of them changes the number</span></div>`;
  if (!list || !list.length) {
    return `${head}<div class="card mon-research">
      <div class="card-pad stack">
        <div class="micro dot">Research in progress</div>
        <h3 class="mon-h3">Which phone and watch data are worth using</h3>
        <p class="muted">A research session is checking each candidate: what the device records, how an app can read it, which body region it reflects and what is known in ALS. Its findings appear here when it finishes. Until then, nothing from a phone or watch is used.</p>
      </div>
      <div class="mon-cands"><div class="micro mon-cands-head">Candidates being checked</div>${CANDIDATES.map((c) => `<div class="mon-cand"><div><div class="mon-cand-name">${esc(c.signal)}</div><div class="note">${esc(c.from)}</div></div><span class="mon-cand-region">${esc(c.region)}</span></div>`).join('')}</div>
    </div>`;
  }
  const known = new Set(SIG_GROUPS.map(([k]) => k));
  const groups = SIG_GROUPS.map(([k, label]) => [label, list.filter((s) => s && s.region === k)]);
  const other = list.filter((s) => s && !known.has(s.region));
  if (other.length) groups.push(['Other', other]);
  const shown = groups.filter(([, xs]) => xs.length);
  const n = shown.reduce((a, [, xs]) => a + xs.length, 0);
  const nPassive = shown.reduce((a, [, xs]) => a + xs.filter((s) => s.passive === true).length, 0);
  const nDemo = shown.reduce((a, [, xs]) => a + xs.filter((s) => s.demo === true).length, 0);
  const body = shown.map(([label, xs], gi) => `<div class="mon-sg-group" role="group" aria-labelledby="mon-sg-h${gi}">
      <h3 class="mon-sg-h" id="mon-sg-h${gi}">${esc(label)}<span class="mon-sg-n">${plural(xs.length, 'signal')}</span></h3>
      ${xs.map((s) => signalRow(s, label)).join('')}
    </div>`).join('');
  return `${head}
    <p class="note mon-sg-sum">${plural(n, 'signal')} in ${plural(shown.length, 'body region')}: ${nPassive} passive (recorded in the background), ${n - nPassive} active (a short task). The chip grades the evidence in ALS; the MDC is the smallest change beyond run-to-run noise.${nDemo ? ` ${nDemo} marked In the demo are the research's picks for this demo.` : ''} Open a signal for its devices and APIs, access, the full MDC note and the sources.</p>
    <div class="mon-sg">
      <div class="mon-sg-cols" aria-hidden="true"><span>Signal</span><span>Passive or active</span><span>Evidence in ALS</span><span>MDC</span></div>
      ${body}
    </div>`;
}

// ---------------- tapping pad ripples (decorative, aria-hidden) ----------------
// Each tap sends a ring out from the point it landed (Space taps from the middle of the
// pad). Only taps that count ring bright: the pad's running state, the primary button,
// one finger at a time (the rules hometests.js counts by). A tap on the idle pad or in
// the 3-2-1 countdown rings dim. Frames are drawn on demand, only while a ring is still
// fading, and stop until the next tap. With reduced motion nothing moves: a counted tap
// leaves one still ring, cleared when the run ends.
const RIPPLE_S = 0.95;
const RIPPLE_DIM = 0.35;
function rippleEffect(canvas, pad) {
  const counting = () => pad.classList.contains('running');
  const clock = () => performance.now() / 1000;
  let raf = 0;
  let fx = null;
  const kick = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; fx.renderOnce(); }); };
  const addRing = (d, x, y, k) => {
    d.rings.push({ x, y, t0: clock(), k });
    if (k === 1) d.still = { x, y };
  };
  fx = createEffect(canvas, {
    pointerTarget: pad,
    setup(ctx, st) {
      st.data.col = palette().panelAccent || '#8EC6E8';
      if (!st.data.rings) st.data.rings = [];
    },
    draw(ctx, st) {
      const d = st.data;
      for (const c of st.clicks) addRing(d, c.x, c.y, c.k ?? (counting() ? 1 : RIPPLE_DIM));
      st.clicks.length = 0; // consumed here: the effect's own loop, which would clear them, is off
      ctx.clearRect(0, 0, st.w, st.h);
      ctx.strokeStyle = d.col;
      ctx.fillStyle = d.col;
      if (st.reduced) { // no animation: at most one still ring, at the latest counted tap
        d.rings.length = 0;
        if (!counting()) d.still = null;
        if (d.still) {
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(d.still.x, d.still.y, 28, 0, Math.PI * 2); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        return;
      }
      d.still = null;
      const now = clock();
      const reach = Math.min(170, Math.max(90, Math.max(st.w, st.h) * 0.3));
      let n = 0;
      for (const r of d.rings) {
        const a = (now - r.t0) / RIPPLE_S;
        if (a >= 1) continue;
        d.rings[n++] = r;
        const e = 1 - (1 - a) ** 3; // ease out
        if (a < 0.22) { // a soft press under the finger
          ctx.globalAlpha = (1 - a / 0.22) * 0.14 * r.k;
          ctx.beginPath(); ctx.arc(r.x, r.y, 10 + e * 26, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = (1 - a) ** 1.7 * 0.6 * r.k;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(r.x, r.y, 8 + e * reach, 0, Math.PI * 2); ctx.stroke();
        if (a > 0.1) { // a second, fainter ring trailing the first
          const b = (a - 0.1) / 0.9;
          ctx.globalAlpha = (1 - b) ** 2 * 0.3 * r.k;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(r.x, r.y, 6 + (1 - (1 - b) ** 3) * reach * 0.62, 0, Math.PI * 2); ctx.stroke();
        }
      }
      d.rings.length = n;
      ctx.globalAlpha = 1;
      if (n) kick(); // a next frame only while a ring is fading; an idle pad costs no frames
    },
  });
  // createEffect would otherwise redraw at 60 fps whenever the pad is on screen, rings or
  // not. 'still' is its on-demand mode: its own loop stays off, and a tap asks it for one
  // frame (renderOnce), which starts kick() above until the rings have faded.
  fx.state.quality = 'still';
  // Tag each tap as it lands (this listener runs right after the effect's own), by the
  // rules the test counts by: the primary button, one finger at a time, while running.
  const fingers = new Set();
  const onDown = (e) => {
    const primary = !(e.pointerType === 'mouse' && e.button !== 0);
    if (primary) fingers.add(e.pointerId);
    const c = fx.state.clicks[fx.state.clicks.length - 1];
    if (c) c.k = counting() && primary && fingers.size === 1 ? 1 : RIPPLE_DIM;
  };
  const onUp = (e) => { fingers.delete(e.pointerId); };
  pad.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  // Space taps (the pad's keyboard route) ring out from the middle, a little off-centre each time
  let flip = 1;
  const onKey = (e) => {
    if ((e.code !== 'Space' && e.key !== ' ') || e.repeat) return;
    if (!counting() && !pad.classList.contains('armed')) return; // Space does nothing on the idle pad
    const st = fx.state;
    flip = -flip;
    addRing(st.data, st.w / 2 + flip * 10, st.h / 2 + 8, counting() ? 1 : RIPPLE_DIM);
    if (st.reduced) fx.renderOnce(); else kick();
  };
  document.addEventListener('keydown', onKey);
  // reduced motion: the still ring goes when the run ends (the pad's class changes)
  const mo = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { if (fx.state.data.still && !counting()) fx.renderOnce(); })
    : null;
  if (mo) mo.observe(pad, { attributes: true, attributeFilter: ['class'] });
  return {
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (mo) mo.disconnect();
      pad.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.removeEventListener('keydown', onKey);
      fx.destroy();
    },
  };
}

// ---------------- mount ----------------
export function mount(root, ctx0) {
  ensureCss('css/views/monitoring.css');
  let ctx = ctx0;
  if (flash && flash.caseId !== ctx.caseEntry?.id) flash = null;
  if (flash) flash.fresh = false; // shown on this mount, gone after the next
  const w0 = whoOf(ctx);
  root.innerHTML = `<div class="mon">
    <header class="view-head reveal">
      <div class="micro dot">Monitoring · weekly · ${esc(w0.demo ? 'Demo case' : w0.full)}</div>
      <h1 class="title two-tone">Monitoring <span class="soft">between visits, alongside the referral.</span></h1>
      <p class="lede">Once a week, at the same time of day, each person is compared with their own baseline. A drop counts only when it beats the test's minimal detectable change (MDC) twice in a row. The tests run alongside the EMG referral and never delay it.</p>
    </header>
    <div class="reveal d1" id="mon-status"></div>
    <section class="section reveal d2" id="mon-case"></section>
    <section class="section" id="mon-coverage">${coverageHtml(ctx)}</section>
    <section class="section" id="mon-tests">${testsHtml()}</section>
    <section class="section" id="mon-signals">${signalsHtml()}</section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  // chart width in SVG units = the card's inner width, so text stays at its real size
  const chartW = () => {
    const sec = $('#mon-case') || root;
    const one = typeof matchMedia === 'function' && matchMedia('(max-width: 860px)').matches;
    const w = one ? sec.clientWidth : (sec.clientWidth - 16) / 2;
    return Math.max(300, Math.min(640, Math.round(w - 38)));
  };
  // engine options read fresh, so a noise floor just measured in Team calibration counts at once
  let mdcKey = '';
  const renderTop = () => {
    const live = { ...ctx, opts: engineOpts(ctx.state) };
    mdcKey = JSON.stringify(live.opts.mdc || null);
    const info = caseHome(live.caseFile);
    const at = cutFor(live, info);
    $('#mon-status').innerHTML = statusHtml(live, info, at);
    $('#mon-case').innerHTML = caseHtml(live, chartW(), info, at);
  };
  const renderReal = () => { const el = $('#mon-real'); if (el) el.innerHTML = realHtml(chartW(), ctx); };
  const onTests = () => {
    renderReal();
    if (JSON.stringify(engineOpts(ctx.state).mdc || null) !== mdcKey) renderTop();
  };
  renderTop();

  // ---- interactions (delegated, so re-rendered parts need no rewiring) ----
  let tip = null;
  const hideTip = () => {
    if (!tip) return;
    tip.tip.hidden = true;
    tip.svg.querySelector('.xhair')?.setAttribute('visibility', 'hidden');
    tip.svg.querySelector('.focus-ring')?.setAttribute('visibility', 'hidden');
    tip = null;
  };
  const onMove = (e) => {
    const svg = e.target.closest && e.target.closest('svg[data-chart]');
    if (!svg) { hideTip(); return; }
    const c = CHARTS.get(svg.dataset.chart);
    if (!c || !c.pts.length) return;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * c.W;
    let p = c.pts[0];
    for (const q of c.pts) if (Math.abs(q.cx - sx) < Math.abs(p.cx - sx)) p = q;
    if (tip && tip.svg !== svg) hideTip();
    const box = svg.parentElement.querySelector('.mon-tip');
    const xh = svg.querySelector('.xhair');
    xh.setAttribute('x1', f1(p.cx)); xh.setAttribute('x2', f1(p.cx)); xh.setAttribute('visibility', 'visible');
    const ring = svg.querySelector('.focus-ring');
    ring.setAttribute('cx', f1(p.cx)); ring.setAttribute('cy', f1(p.cy)); ring.setAttribute('visibility', 'visible');
    const delta = p.delta == null ? '' : ` · ${p.delta >= 0 ? '+' : '−'}${num(Math.abs(round1(p.delta)))} vs baseline`;
    box.innerHTML = `<b>${esc(num(p.value))}</b> ${esc(c.unitOf(p.value))}<div class="faint">${esc(fmtDate(p.date))}${esc(delta)}</div>`;
    const scale = r.width / c.W;
    box.style.left = `${Math.max(80, Math.min(r.width - 80, p.cx * scale))}px`;
    box.style.top = `${p.cy * scale}px`;
    box.hidden = false;
    tip = { svg, tip: box };
  };
  const onClick = (e) => {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const s = ctx.state;
    const act = b.dataset.act;
    if (act === 'to-tests') {
      const sec = $('#mon-tests');
      const smooth = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
      if (sec) sec.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
      const p = $('#person');
      if (p) p.focus({ preventScroll: true });
      return;
    }
    if (act === 'add-real') {
      const w = whoOf(ctx);
      const { fresh } = realForCase(getResults(), currentPerson(), ctx.caseFile);
      if (w.kind !== 'user' || !fresh.length) return;
      const prev = ctx.caseFile;
      const keep = (prev.homeTests || []).filter((h) => !fresh.some((a) => a.test === h.test && a.date === h.date));
      const next = { ...prev, homeTests: [...keep, ...fresh].sort((a, c) => a.date.localeCompare(c.date) || a.test.localeCompare(c.test)) };
      const r = saveUserCase(next, ctx.caseEntry.id);
      flash = {
        caseId: r.id, fresh: true, undo: { id: r.id, caseFile: prev },
        text: `Added ${plural(fresh.length, 'result')} to ${w.full}'s case file.${s.includeHome ? ' They now count in the indicator.' : ' Turn on Home data to chart them and count them in the indicator.'}`,
      };
      ctx.setState({ casesRev: (s.casesRev || 0) + 1, caseId: r.id });
      return;
    }
    if (act === 'undo-add') {
      if (!flash || !flash.undo) return;
      const r = saveUserCase(flash.undo.caseFile, flash.undo.id);
      flash = { caseId: r.id, fresh: true, undo: null, text: 'Undone: the case file is back as it was.' };
      ctx.setState({ casesRev: (s.casesRev || 0) + 1, caseId: r.id });
      return;
    }
    if (act === 'flash-close') { flash = null; renderReal(); return; }
    if (act === 'sim-on') ctx.setState({ includeHome: true });
    else if (b.dataset.act === 'exclude') ctx.setState({ exclude: [...new Set([...s.exclude, b.dataset.key])] });
    else if (b.dataset.act === 'include') ctx.setState({ exclude: s.exclude.filter((k) => k !== b.dataset.key && k !== 'home_decline') });
  };
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerleave', hideTip);
  root.addEventListener('click', onClick);
  let rz = 0;
  let lastW = chartW();
  const onResize = () => {
    clearTimeout(rz);
    rz = setTimeout(() => { const w = chartW(); if (Math.abs(w - lastW) > 24) { lastW = w; renderTop(); renderReal(); } }, 150);
  };
  window.addEventListener('resize', onResize);

  // the working tests (real results, this browser only)
  const ht = initHomeTests(root, { skin: 'app', onChange: onTests });
  const pad = $('#tap-pad');
  const padFx = pad && pad.querySelector('.mon-pad-fx') ? rippleEffect(pad.querySelector('.mon-pad-fx'), pad) : null;
  // a screen reader hears when a run starts and ends (the pad's big number is aria-live off)
  const say = $('#tap-say');
  let was = '';
  const sayMo = pad && say && typeof MutationObserver === 'function' ? new MutationObserver(() => {
    const now = pad.classList.contains('running') ? 'running' : pad.classList.contains('armed') ? 'armed' : '';
    if (now === was) return;
    const n = Number($('#tap-big')?.textContent);
    say.textContent = now === 'armed' ? (n > 0 ? `Get ready: tapping starts in ${plural(n, 'second')}.` : 'Get ready: tapping starts after the countdown.')
      : now === 'running' ? `Go: tap for ${TAP_SECONDS} seconds.`
      : $('#tap-small')?.textContent || ''; // "Done. Press Start to go again." or "Stopped. Nothing was saved."
    was = now;
  }) : null;
  if (sayMo) sayMo.observe(pad, { attributes: true, attributeFilter: ['class'] });

  return {
    update(next) { ctx = next; hideTip(); renderTop(); },
    unmount() {
      if (flash && !flash.fresh) flash = null;
      if (sayMo) sayMo.disconnect();
      if (padFx) padFx.destroy();
      ht.destroy();
      window.removeEventListener('resize', onResize);
      clearTimeout(rz);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', hideTip);
      root.removeEventListener('click', onClick);
    },
  };
}
