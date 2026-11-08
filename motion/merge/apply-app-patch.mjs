// Adds the phone walking test (gait_speed) to the app. Usage, from the project folder:
//   node motion/merge/apply-app-patch.mjs <path to an app folder> [--dry-run]
// Every edit is anchored to text that exists today. If an anchor has moved, nothing is
// written and the script names the edit to make by hand (see motion/MERGE.md).
// Running it twice is safe: edits already present are skipped.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const appDir = args.find((a) => !a.startsWith('--'));
if (!appDir) {
  console.error('Give the app folder, for example: node motion/merge/apply-app-patch.mjs app --dry-run');
  process.exit(2);
}
const root = resolve(appDir);
if (!existsSync(join(root, 'js', 'engine.js'))) {
  console.error(`No js/engine.js under ${root}: is that the app folder?`);
  process.exit(2);
}

const GAIT_LINE = "  gait_speed: { label: 'Walking speed, 10 m walk (phone motion sensors)', unit: 'm/s', region: 'leg', higherIsBetter: true, placeholderMdc: 0.28 },";

// Each edit: file, a name, a test that says it is already done, and a regex + replacement.
const EDITS = [
  {
    file: 'js/engine.js', name: 'HOME_TESTS gets gait_speed (m/s, legs, higher is better, MDC 0.28)',
    done: (s) => /HOME_TESTS = \{[\s\S]*?gait_speed:[\s\S]*?\n\};/.test(s),
    find: /(export const HOME_TESTS = \{[\s\S]*?\n)(\};)/,
    replace: (m, body, end) => `${body}${GAIT_LINE}\n${end}`,
  },
  {
    file: 'js/hometests.js', name: 'SHORT label for gait_speed',
    done: (s) => /export const SHORT = \{[^\n]*gait_speed/.test(s),
    find: /(export const SHORT = \{[^\n]*?)\s*\};/,
    replace: (m, body) => `${body}, gait_speed: 'Walking speed' };`,
  },
  {
    file: 'js/hometests.js', name: 'UNIT for gait_speed',
    done: (s) => /export const UNIT = \{[^\n]*gait_speed/.test(s),
    find: /(export const UNIT = \{[^\n]*?)\s*\};/,
    replace: (m, body) => `${body}, gait_speed: 'm/s' };`,
  },
  {
    file: 'js/hometests.js', name: 'Legs row on the home-tests page: gait_speed, working',
    done: (s) => /region: 'Legs', tests: \['gait_speed'\]/.test(s),
    find: /\{ region: 'Legs', tests: \['walk'\], name: '[^']*', status: 'mock',/,
    replace: () => "{ region: 'Legs', tests: ['gait_speed'], name: 'Walking speed, 10 m walk (phone motion sensors)', status: 'working',",
  },
  {
    file: 'js/app/views/monitoring.js', name: 'Coverage table: the walking test is working',
    // 'built' too: on 8 Nov the merged app relabelled it "Built, not yet tried on a phone" until a real phone run
    done: (s) => /home: \['Walking speed, 10 m walk \(phone motion sensors\)', '(working|built)'\]/.test(s),
    find: /home: \['Walking test, phone motion sensor', 'mock'\]/,
    replace: () => "home: ['Walking speed, 10 m walk (phone motion sensors)', 'working']",
  },
  // INT-2: demo-date and simulated walks must stay marked once they reach the app.
  // weeklySeries drops those marks, so the next four edits read them from the saved rows.
  {
    // done() looks for the INT-2 mark, not just the 2 decimals, so this edit still
    // applies over an app that already has the first version of this patch.
    file: 'js/app/views/monitoring.js', name: 'Results that join a case keep 2 decimals for m/s and stay marked simulated when any row that day is a demo date or simulated',
    done: (s) => /simulated: results\.some\(\(r\) => r && !r\.calibration && r\.test === test && r\.date === p\.date/.test(s),
    find: /add\.push\(\{ date: p\.date, test, value: (?:round1\(p\.value\)|test === 'gait_speed' \? Math\.round\(p\.value \* 100\) \/ 100 : round1\(p\.value\)), simulated: false \}\)/,
    replace: () => "add.push({ date: p.date, test, value: test === 'gait_speed' ? Math.round(p.value * 100) / 100 : round1(p.value), simulated: results.some((r) => r && !r.calibration && r.test === test && r.date === p.date && (r.person || '') === person && (r.simulated === true || r.demoDate === true)) })",
  },
  {
    file: 'js/app/views/monitoring.js', name: 'A case value counts as already added only when its simulated mark matches too',
    done: (s) => /&& !!h\.simulated === !!a\.simulated && Math\.abs\(h\.value - a\.value\) < 0\.05/.test(s),
    find: /&& !h\.simulated && Math\.abs\(h\.value - a\.value\) < 0\.05/,
    replace: () => '&& !!h.simulated === !!a.simulated && Math.abs(h.value - a.value) < 0.05',
  },
  {
    file: 'js/app/views/monitoring.js', name: 'Weekly result card says "Demo dates", not "Real", when any of its rows is a demo date or simulated',
    done: (s) => /Demo dates<\/span>' : realChip\(\)/.test(s),
    find: /<h3>\$\{esc\(SHORT\[test\] \|\| test\)\}<\/h3><span class="aside">\$\{realChip\(\)\}<\/span>/,
    replace: () => '<h3>${esc(SHORT[test] || test)}</h3><span class="aside">${results.some((r) => r && !r.calibration && r.test === test && (r.person || \'\') === person && (r.simulated === true || r.demoDate === true)) ? \'<span class="chip sim" title="Saved with a demo date or from a simulated walk. Not a real weekly history.">Demo dates</span>\' : realChip()}</span>',
  },
  {
    file: 'js/app/views/monitoring.js', name: 'Section head drops its "Real" chip when any saved row is a demo date or simulated',
    done: (s) => /'Saved with no name'\}\$\{results\.some\(/.test(s),
    find: /'Saved with no name'\}\$\{realChip\(\)\}/,
    replace: () => "'Saved with no name'}${results.some((r) => r && !r.calibration && (r.person || '') === person && (r.simulated === true || r.demoDate === true)) ? '' : realChip()}",
  },
  {
    file: 'js/app/views/patient.js', name: 'Patient check-in: walking is speed over 10 m',
    done: (s) => /key: 'walking'[^\n]*tests: \['gait_speed'\]/.test(s),
    find: /\{ key: 'walking', name: 'Walking', what: '[^']*', tests: \['walk'\], region: 'leg', drop: '[^']*' \}/,
    replace: () => "{ key: 'walking', name: 'Walking', what: 'Walking speed over 10 m, timed by the phone', tests: ['gait_speed'], region: 'leg', drop: 'Walking slower than your start' }",
  },
  {
    file: 'js/app/views/patient.js', name: 'Patient short unit for gait_speed',
    done: (s) => /const SHORT_UNIT = \{[^\n]*gait_speed/.test(s),
    find: /(const SHORT_UNIT = \{[^\n]*?)\s*\};/,
    replace: (m, body) => `${body}, gait_speed: 'm/s' };`,
  },
  {
    file: 'js/app/views/patient.js', name: 'Patient column name for gait_speed',
    done: (s) => /const COL_NAME = \{[^\n]*gait_speed/.test(s),
    find: /(const COL_NAME = \{[^\n]*?)\s*\};/,
    replace: (m, body) => `${body}, gait_speed: 'Walking speed' };`,
  },
  {
    file: 'js/engine.js', name: 'Decline quote keeps 2 decimals below 10 (m/s), so it never reads like 1.0 vs 1.3 beyond 0.3',
    done: (s) => /const round1 = \(x\) => \(Math\.abs\(x\) < 10/.test(s),
    find: /const round1 = \(x\) => Math\.round\(x \* 10\) \/ 10;/,
    replace: () => 'const round1 = (x) => (Math.abs(x) < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10); // 2 decimals below 10 (walking speed in m/s), 1 above',
  },
  {
    file: 'js/app/views/monitoring.js', name: 'Monitoring rounding keeps 2 decimals below 10',
    done: (s) => /const round1 = \(x\) => \(Math\.abs\(x\) < 10/.test(s),
    find: /const round1 = \(x\) => Math\.round\(x \* 10\) \/ 10;/,
    replace: () => 'const round1 = (x) => (Math.abs(x) < 10 ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10); // 2 decimals below 10 (walking speed in m/s), 1 above',
  },
  {
    file: 'js/app/views/monitoring.js', name: 'Monitoring numbers show 2 decimals below 10',
    done: (s) => /const num = \(x\) => \(Number\.isFinite\(x\) \? \(Number\.isInteger\(x\) \? String\(x\) : Math\.abs\(x\) < 10/.test(s),
    find: /const num = \(x\) => \(Number\.isFinite\(x\) \? \(Number\.isInteger\(x\) \? String\(x\) : x\.toFixed\(1\)\) : '–'\);/,
    replace: () => "const num = (x) => (Number.isFinite(x) ? (Number.isInteger(x) ? String(x) : Math.abs(x) < 10 ? String(Math.round(x * 100) / 100) : x.toFixed(1)) : '–');",
  },
];

const texts = new Map();
const report = [];
let missing = 0;
for (const e of EDITS) {
  const path = join(root, e.file);
  if (!existsSync(path)) { report.push(`MISSING FILE  ${e.file}: ${e.name}`); missing++; continue; }
  const s = texts.has(path) ? texts.get(path) : readFileSync(path, 'utf8');
  if (e.done(s)) { report.push(`already done  ${e.file}: ${e.name}`); texts.set(path, s); continue; }
  if (!e.find.test(s)) { report.push(`ANCHOR MOVED  ${e.file}: ${e.name} (make this edit by hand; see motion/MERGE.md)`); missing++; texts.set(path, s); continue; }
  const next = s.replace(e.find, e.replace);
  if (!e.done(next)) { report.push(`CHECK FAILED  ${e.file}: ${e.name} (the edit did not take)`); missing++; texts.set(path, s); continue; }
  texts.set(path, next);
  report.push(`${dry ? 'would apply' : 'applied'}     ${e.file}: ${e.name}`);
}
console.log(report.join('\n'));
if (missing) {
  console.error(`\n${missing} edit(s) could not be made. Nothing was written.`);
  process.exit(1);
}
if (!dry) {
  for (const [path, s] of texts) writeFileSync(path, s, 'utf8');
  console.log('\nWritten. Run npm test, then reload the app.');
} else {
  console.log('\nDry run: nothing written.');
}
