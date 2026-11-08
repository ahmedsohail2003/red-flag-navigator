// Doctor dashboard builders, run in Node on Alex's real case file.
// Run: node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALEX } from '../app/js/alex.js';
import { REFERRAL_LINES } from '../app/js/weights.js';
import {
  DEFAULT_DATE, computeView, dateOptions, pickDate, readStore, weightText, fmtDate, pct, rangeText,
  renderLede, renderBanner, renderRange, renderFindings, renderReplay, renderHome, renderMeasures, renderFoot,
} from '../app/js/doctor.js';

const base = (over = {}) => ({ line: 0.05, includeHome: true, mdc: null, homeResults: [], exclude: new Set(), asOf: DEFAULT_DATE, ...over });
const all = (ctx) => [renderLede, renderBanner, renderRange, renderFindings, renderReplay, renderHome, renderMeasures, renderFoot].map((f) => f(ctx)).join('\n');

test('weights are shown as in the paper: aOR 31.0 (19.5 to 49.4)', () => {
  assert.equal(weightText({ or: 31.02, lo: 19.46, hi: 49.44 }), 'aOR 31.0 (19.5 to 49.4)');
  assert.equal(weightText({ or: null }), null);
  assert.equal(fmtDate('2024-12-09'), '9 Dec 2024');
  assert.equal(fmtDate('2024-06'), 'Jun 2024');
});

test('a probability is never shown as 100%', () => {
  assert.equal(pct(0.9996), '>99%');
  assert.equal(rangeText({ lo: 0.996, hi: 0.9999 }), 'above 99%');
  assert.equal(pct(0.05), '5.0%');
});

test('the stepper lists every timeline date; default is the 9 Dec 2024 hand-surgeon visit', () => {
  const ctx = computeView(ALEX, base());
  assert.equal(ctx.asOf, '2024-12-09');
  assert.equal(ctx.ev.encounter.id, 'e2');
  const opts = dateOptions(ctx.tl);
  assert.equal(opts.length, ctx.tl.length);
  for (const e of ALEX.encounters) assert.ok(opts.some((o) => o.date === e.date && o.label.includes(e.setting)));
  assert.ok(opts.some((o) => o.kind === 'home' && o.label.endsWith('home test')));
  const noHome = dateOptions(computeView(ALEX, base({ includeHome: false })).tl);
  assert.equal(noHome.length, new Set(ALEX.encounters.map((e) => e.date)).size);
});

test('pickDate falls back to the latest earlier date', () => {
  assert.equal(pickDate(['2024-01-01', '2024-02-01'], '2024-01-15'), '2024-01-01');
  assert.equal(pickDate(['2024-01-01'], '2023-01-01'), '2024-01-01');
});

test('shared state is read safely', () => {
  const fake = (o) => ({ getItem: (k) => (k in o ? o[k] : null) });
  // simulated home tests are off by default; only the exact string 'true' switches them on
  assert.deepEqual(readStore(fake({})), { line: 0.05, includeHome: false, mdc: null, homeResults: [] });
  assert.equal(readStore(fake({ 'rfn.includeHomeTests': 'true' })).includeHome, true);
  const st = readStore(fake({ 'rfn.referralLine': '0.1', 'rfn.includeHomeTests': 'false', 'rfn.mdc': '{"tap_right":4.2,"bogus":3}', 'rfn.homeResults': '[{"date":"2026-11-07","test":"tap_right","value":"52","trial":1},{"test":"x"}]' }));
  assert.equal(st.line, 0.1);
  assert.equal(st.includeHome, false);
  assert.deepEqual(st.mdc, { tap_right: 4.2 });
  assert.equal(st.homeResults.length, 1);
  assert.equal(readStore(fake({ 'rfn.mdc': 'not json' })).mdc, null);
});

test('what-if: leaving out a finding recomputes the range', () => {
  const a = computeView(ALEX, base({ includeHome: false, asOf: '2024-10-14' }));
  const key = a.ev.state.instances.find((i) => i.id === 'wasting').key;
  const b = computeView(ALEX, base({ includeHome: false, asOf: '2024-10-14', exclude: new Set([key]) }));
  assert.ok(b.ev.range.median < a.ev.range.median);
  assert.ok(renderFindings(b).includes('1 finding left out'));
  assert.equal(b.full.instances.length, a.full.instances.length, 'excluded rows stay listed so they can be ticked again');
});

test('every date, line and home-test setting renders with no undefined or NaN, and every quote is shown', () => {
  for (const line of REFERRAL_LINES.map((l) => l.value)) {
    for (const includeHome of [true, false]) {
      const dates = computeView(ALEX, base({ line, includeHome })).dates;
      for (const asOf of dates) {
        const ctx = computeView(ALEX, base({ line, includeHome, asOf }));
        const html = all(ctx);
        assert.ok(!/undefined|NaN|\[object/.test(html), `${line} ${includeHome} ${asOf}: ${(html.match(/.{60}(undefined|NaN|\[object).{20}/) || [])[0]}`);
        for (const inst of ctx.full.instances) assert.ok(html.includes(inst.quote.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')), `quote missing: ${inst.quote}`);
      }
    }
  }
});

test('replay headline uses the notes only and matches monthsSaved', () => {
  const ctx = computeView(ALEX, base());
  assert.ok(ctx.ms.firstHigh);
  // the gain counts to Alex's real referral (16 Feb 2026): the waiting list applies either way
  assert.equal(ctx.ms.referral, '2026-02-16');
  assert.ok(Number.isFinite(ctx.ms.monthsVsReferral));
  assert.ok(renderReplay(ctx).includes(`About ${Math.round(ctx.ms.monthsVsReferral)} months earlier referral`));
});
