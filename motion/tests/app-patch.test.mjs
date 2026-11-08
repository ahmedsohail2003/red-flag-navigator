// Tests for motion/merge/apply-app-patch.mjs, the script that merges the walking test into
// app/. Each test patches a fresh copy of app/js in a temp folder; the real app/ is only read.
// Works before the merge (app/ unpatched) and after it (app/ already patched).
// To test another copy of the script (for example the one before a fix), set APP_PATCH_SCRIPT.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = resolve(process.env.APP_PATCH_SCRIPT || join(project, 'motion', 'merge', 'apply-app-patch.mjs'));
const APP_JS = join(project, 'app', 'js');
const TOUCHED = ['js/engine.js', 'js/hometests.js', 'js/app/views/monitoring.js', 'js/app/views/patient.js'];
const LINE = /^(applied|already done|would apply|ANCHOR MOVED|MISSING FILE|CHECK FAILED)\s/;
const MIN_EDITS = 15;

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

function freshApp() {
  const dir = mkdtempSync(join(tmpdir(), 'rfn-app-patch-'));
  temps.push(dir);
  cpSync(APP_JS, join(dir, 'js'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
  return dir;
}

function runPatch(dir, ...extra) {
  const r = spawnSync(process.execPath, [SCRIPT, dir, ...extra], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}`, lines: r.stdout.split(/\r?\n/).filter((l) => LINE.test(l)) };
}

const monPath = (dir) => join(dir, 'js', 'app', 'views', 'monitoring.js');
const imp = (dir, rel) => import(pathToFileURL(join(dir, rel)).href);

async function patchedApp() {
  const dir = freshApp();
  const r = runPatch(dir);
  assert.equal(r.status, 0, r.out);
  return { dir, engine: await imp(dir, 'js/engine.js'), ht: await imp(dir, 'js/hometests.js'), mon: readFileSync(monPath(dir), 'utf8') };
}

// realForCase, lifted verbatim from the patched monitoring.js (it is not exported).
function liftRealForCase(mon, engine, ht) {
  const src = mon.match(/function realForCase\(results, person, caseFile\) \{[\s\S]*?\n\}/);
  assert.ok(src, 'realForCase is in monitoring.js');
  const round1 = mon.match(/const round1 = [^\n]*/)[0];
  return new Function('HOME_TESTS', 'weeklySeries', `${round1}\n${src[0]}\nreturn realForCase;`)(engine.HOME_TESTS, ht.weeklySeries);
}

// The weekly card head and the section head, lifted verbatim from realHtml.
function liftChips(mon, ht) {
  const realChip = new Function(`${mon.match(/const realChip = [^\n]*/)[0]}\nreturn realChip;`)();
  const lines = mon.split('\n');
  const cardLine = lines.find((l) => l.includes('<div class="card-head"><h3>${esc(SHORT[test] || test)}</h3>'));
  const headLine = lines.find((l) => l.includes('<h3>Your weekly results</h3>'));
  assert.ok(cardLine && headLine, 'card head and section head are in monitoring.js');
  const esc = (s) => String(s);
  const card = new Function('results', 'test', 'person', 'esc', 'SHORT', 'realChip', 'return `' + cardLine.trim() + '`;');
  const head = new Function('results', 'person', 'who', 'realChip', `${headLine.trim()}\nreturn head;`);
  return {
    card: (results, t, person = '') => card(results, t, person, esc, ht.SHORT, realChip),
    head: (results, person = '') => head(results, person, person || 'results saved with no name', realChip),
  };
}

// Rows as receive.html saves them (motion/CONTRACT.md section 6).
const row = (date, value, extra = {}) => ({
  date, time: '05:40', test: 'gait_speed', value, trial: 1, person: '', calibration: false, source: 'phone-motion',
  walkId: `w-${date}`, timing: 'motion', steps: 14, cadence: 104, distance_m: 10, quality: 'good', ...extra,
});
// The demo path: 4 weeks under demo dates, the last one a simulated walk; a decline by week 4.
const STAGED = [
  row('2026-10-11', 1.33, { demoDate: true }),
  row('2026-10-18', 1.35, { demoDate: true }),
  row('2026-10-25', 0.96, { demoDate: true }),
  row('2026-11-01', 0.92, { demoDate: true, simulated: true }),
];
const REAL = STAGED.map(({ demoDate, simulated, ...r }) => r);
const REAL_CHIP = />Real</;

test('the patch makes every edit on a fresh copy of the app, and a second run skips them all', () => {
  const dir = freshApp();
  const first = runPatch(dir);
  assert.equal(first.status, 0, first.out);
  assert.ok(first.lines.length >= MIN_EDITS, `expected at least ${MIN_EDITS} edits:\n${first.out}`);
  const kinds = new Set(first.lines.map((l) => l.match(LINE)[1]));
  assert.ok(kinds.size === 1 && (kinds.has('applied') || kinds.has('already done')),
    `app/ has only part of the patch. Run: node motion/merge/apply-app-patch.mjs app\n${first.out}`);
  const second = runPatch(dir);
  assert.equal(second.status, 0, second.out);
  assert.equal(second.lines.length, first.lines.length);
  for (const l of second.lines) assert.match(l, /^already done/);
  for (const f of TOUCHED) {
    const c = spawnSync(process.execPath, ['--check', join(dir, f)], { encoding: 'utf8' });
    assert.equal(c.status, 0, `${f} does not parse after the patch:\n${c.stderr}`);
  }
});

test('a dry run reports every edit and writes nothing', () => {
  const dir = freshApp();
  const before = TOUCHED.map((f) => readFileSync(join(dir, f), 'utf8'));
  const r = runPatch(dir, '--dry-run');
  assert.equal(r.status, 0, r.out);
  assert.ok(r.lines.length >= MIN_EDITS, r.out);
  for (const l of r.lines) assert.match(l, /^(would apply|already done)/);
  assert.match(r.out, /Dry run: nothing written\./);
  TOUCHED.forEach((f, i) => assert.equal(readFileSync(join(dir, f), 'utf8'), before[i], `${f} changed in a dry run`));
});

test('INT-2: demo-date and simulated walks stay simulated when they join a case, so the engine says [SIMULATED DATA]', async () => {
  const { engine, ht, mon } = await patchedApp();
  const realForCase = liftRealForCase(mon, engine, ht);
  const { add, fresh } = realForCase(STAGED, '', { homeTests: [] });
  assert.deepEqual(add.map((a) => [a.date, a.value, a.simulated]), [
    ['2026-10-11', 1.33, true], ['2026-10-18', 1.35, true], ['2026-10-25', 0.96, true], ['2026-11-01', 0.92, true],
  ]);
  const st = engine.stateAt({ encounters: [], homeTests: fresh }, '2026-11-08', { includeHomeTests: true });
  const d = st.homeDeclines.find((h) => h.test === 'gait_speed');
  assert.ok(d, 'the staged drop is still a decline');
  assert.equal(d.simulated, true);
  assert.match(d.quote, /\[SIMULATED DATA\]/);
  // Once added, the same rows are "already in this case", so the button does not offer them again.
  const caseAfter = { homeTests: fresh };
  assert.equal(realForCase(STAGED, '', caseAfter).fresh.length, 0);
});

test('INT-2: real walks still join a case as real, with 2 decimals, and one person\'s demo rows never mark another\'s', async () => {
  const { engine, ht, mon } = await patchedApp();
  const realForCase = liftRealForCase(mon, engine, ht);
  const { add, fresh } = realForCase(REAL, '', { homeTests: [] });
  assert.deepEqual(add.map((a) => [a.value, a.simulated]), [[1.33, false], [1.35, false], [0.96, false], [0.92, false]]);
  const d = engine.stateAt({ encounters: [], homeTests: fresh }, '2026-11-08', { includeHomeTests: true }).homeDeclines[0];
  assert.equal(d.simulated, false);
  assert.doesNotMatch(d.quote, /SIMULATED/);
  const mixed = [...REAL, ...STAGED.map((r) => ({ ...r, person: 'Sam' }))];
  assert.ok(realForCase(mixed, '', { homeTests: [] }).add.every((a) => a.simulated === false));
  assert.ok(realForCase(mixed, 'Sam', { homeTests: [] }).add.every((a) => a.simulated === true));
  // A day with one real and one simulated walk is marked simulated: over-labelling is the safe side.
  const sameDay = [row('2026-11-08', 1.2), row('2026-11-08', 1.0, { simulated: true })];
  assert.deepEqual(realForCase(sameDay, '', { homeTests: [] }).add.map((a) => a.simulated), [true]);
  // A calibration trial never marks the weekly value.
  const calib = [...REAL, row('2026-11-01', 1.1, { calibration: true, demoDate: true })];
  assert.ok(realForCase(calib, '', { homeTests: [] }).add.every((a) => a.simulated === false));
});

test('INT-2: the Monitoring card says "Demo dates" for staged rows and "Real" for real ones', async () => {
  const { ht, mon } = await patchedApp();
  const { card, head } = liftChips(mon, ht);
  assert.match(card(STAGED, 'gait_speed'), /Demo dates/);
  assert.doesNotMatch(card(STAGED, 'gait_speed'), REAL_CHIP);
  assert.doesNotMatch(head(STAGED), REAL_CHIP);
  assert.match(card(REAL, 'gait_speed'), REAL_CHIP);
  assert.doesNotMatch(card(REAL, 'gait_speed'), /Demo dates/);
  assert.match(head(REAL), REAL_CHIP);
  // Another person's demo rows leave this person's real card alone.
  const mixed = [...REAL, ...STAGED.map((r) => ({ ...r, person: 'Sam' }))];
  assert.match(card(mixed, 'gait_speed', ''), REAL_CHIP);
  assert.match(head(mixed, ''), REAL_CHIP);
  assert.match(card(mixed, 'gait_speed', 'Sam'), /Demo dates/);
  assert.doesNotMatch(head(mixed, 'Sam'), REAL_CHIP);
  // A real tapping card next to staged walking rows stays "Real"; the section head does not.
  const tapping = [...STAGED, { ...REAL[0], test: 'tap_right', value: 60 }];
  assert.match(card(tapping, 'tap_right'), REAL_CHIP);
  assert.doesNotMatch(head(tapping), REAL_CHIP);
});

test('INT-2: over an app that already has the first version of the patch, the marking edit still applies', () => {
  const dir = freshApp();
  assert.equal(runPatch(dir).status, 0);
  const p = monPath(dir);
  const OLD = "add.push({ date: p.date, test, value: test === 'gait_speed' ? Math.round(p.value * 100) / 100 : round1(p.value), simulated: false })";
  writeFileSync(p, readFileSync(p, 'utf8').replace(/add\.push\(\{ date: p\.date, test, [^\n]*\}\)(?=;)/, () => OLD), 'utf8');
  assert.ok(readFileSync(p, 'utf8').includes(OLD));
  const r = runPatch(dir);
  assert.equal(r.status, 0, r.out);
  assert.ok(r.lines.some((l) => /^applied/.test(l)), r.out);
  const s = readFileSync(p, 'utf8');
  assert.ok(!s.includes(OLD), 'the first-version line is gone');
  assert.match(s, /simulated: results\.some\(\(r\) => r && !r\.calibration && r\.test === test && r\.date === p\.date/);
});
