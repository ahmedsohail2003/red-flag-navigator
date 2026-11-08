// Home data store (app/js/home/store.js): localStorage with a memory fallback.
// Runs with a minimal fake localStorage defined here, and with none at all.
// Run: node --test "tests/home-store.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KEYS, getSamples, addSamples, removeSamples, getResults, addResult, removeResult,
  clearHomeData, subscribe, storageStatus,
} from '../app/js/home/store.js';

const STORE_URL = new URL('../app/js/home/store.js', import.meta.url).href;

// A minimal localStorage: strings in a Map. `limit` caps the characters it holds
// (keys and values) and throws QuotaExceededError past it, as browsers do.
function fakeStorage({ limit = Infinity } = {}) {
  const data = new Map();
  const size = () => { let n = 0; for (const [k, v] of data) n += k.length + v.length; return n; };
  return {
    data,
    limit,
    calls: 0,
    getItem(k) { this.calls += 1; return data.has(k) ? data.get(k) : null; },
    setItem(k, v) {
      this.calls += 1;
      const value = String(v);
      const next = size() - (data.has(k) ? k.length + data.get(k).length : 0) + k.length + value.length;
      if (next > this.limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      data.set(k, value);
    },
    removeItem(k) { this.calls += 1; data.delete(k); },
    size,
  };
}
const useStorage = (s) => Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
const noStorage = () => { delete globalThis.localStorage; };
// Each test starts empty. clearHomeData() also drops anything held in memory.
function fresh(s) {
  if (s) useStorage(s); else noStorage();
  clearHomeData();
  return s;
}

const hr = (start, value, extra = {}) => ({ signal: 'heart_rate', start, value, unit: 'bpm', source: 'apple-health', ...extra });
const bp = (start, sys, dia, extra = {}) => ({ signal: 'bp', start, value: sys, value2: dia, unit: 'mmHg', source: 'bluetooth', ...extra });
const grip = (date, value, extra = {}) => ({ test: 'grip', date, value, unit: 'kg', ...extra });

test('KEYS are the agreed storage keys, and cannot be changed by a caller', () => {
  assert.deepEqual(KEYS, { samples: 'rfn.home.samples', results: 'rfn.home.results' });
  assert.throws(() => { KEYS.samples = 'elsewhere'; }, TypeError);
  assert.equal(KEYS.samples, 'rfn.home.samples');
});

test('importing the store touches no storage', async () => {
  const s = fakeStorage();
  useStorage(s);
  await import(`${STORE_URL}?import-check`);
  assert.equal(s.calls, 0);
});

// ---------- samples ----------
test('samples are saved as JSON under KEYS.samples and come back sorted by start', () => {
  const s = fresh(fakeStorage());
  const r = addSamples([hr('2026-11-03T08:00:00-05:00', 64), hr('2026-11-02T08:00:00-05:00', 61)]);
  assert.deepEqual(r, { added: 2, skipped: 0, duplicates: 0, invalid: 0 });
  assert.deepEqual(getSamples().map((x) => x.value), [61, 64]);
  assert.deepEqual(JSON.parse(s.data.get(KEYS.samples)).map((x) => x.value).sort(), [61, 64]);
});

test('saved data is still there after a reload', async () => {
  const s = fresh(fakeStorage());
  addSamples([hr('2026-11-02T08:00:00-05:00', 61)]);
  addResult(grip('2026-11-02', 31));
  const reloaded = await import(`${STORE_URL}?reload`); // a new copy of the module reads the same storage
  assert.deepEqual(reloaded.getSamples().map((x) => x.value), [61]);
  assert.deepEqual(reloaded.getResults().map((x) => x.value), [31]);
  assert.equal(s.data.has(KEYS.results), true);
});

test('exact duplicates are skipped, within a batch and across imports', () => {
  fresh(fakeStorage());
  const a = hr('2026-11-02T08:00:00-05:00', 61);
  assert.deepEqual(addSamples([a, { ...a }]), { added: 1, skipped: 1, duplicates: 1, invalid: 0 });
  assert.deepEqual(addSamples([a]), { added: 0, skipped: 1, duplicates: 1, invalid: 0 });
  // a difference in signal, start, value, value2 or source makes a new sample
  const r = addSamples([
    { ...a, value: 62 }, { ...a, start: '2026-11-02T09:00:00-05:00' }, { ...a, source: 'csv' }, { ...a, signal: 'resting_hr' },
    bp('2026-11-02T08:00:00-05:00', 128, 82), bp('2026-11-02T08:00:00-05:00', 128, 84),
  ]);
  assert.deepEqual(r, { added: 6, skipped: 0, duplicates: 0, invalid: 0 });
  // other fields do not: the same reading with a note, a name or an empty value2 is a duplicate
  assert.equal(addSamples([{ ...a, detail: { note: 'again' } }, { ...a, person: 'alex' }, { ...a, value2: null }]).duplicates, 3);
  assert.equal(getSamples().length, 7);
});

test('malformed samples are skipped and counted, never stored', () => {
  const s = fresh(fakeStorage());
  const good = hr('2026-11-02T08:00:00-05:00', 61);
  const loop = {};
  loop.self = loop;
  const bad = [
    null, 'heart_rate', 42, [], {},
    { ...good, signal: '' }, { ...good, signal: undefined },
    { ...good, start: '2026-11-31' }, { ...good, start: '11/02/2026' }, { ...good, start: '2026-11-02 08:00' }, { ...good, start: undefined },
    { ...good, value: NaN }, { ...good, value: Infinity }, { ...good, value: '61' }, { ...good, value: null },
    { ...good, value2: NaN }, { ...good, value2: '80' },
    { ...good, unit: '' }, { ...good, source: undefined },
    { ...good, end: 'later' }, { ...good, end: '2026-11-02T07:00:00-05:00' }, // ends before it starts
    { ...good, simulated: 'yes' }, { ...good, person: 7 }, { ...good, detail: loop },
  ];
  assert.deepEqual(addSamples(bad), { added: 0, skipped: bad.length, duplicates: 0, invalid: bad.length });
  assert.equal(s.data.has(KEYS.samples), false);
  // nothing to add is not an error
  assert.deepEqual(addSamples([]), { added: 0, skipped: 0, duplicates: 0, invalid: 0 });
  assert.deepEqual(addSamples(undefined), { added: 0, skipped: 0, duplicates: 0, invalid: 0 });
  // a single sample on its own is accepted, and good rows still go in beside bad ones
  assert.equal(addSamples(good).added, 1);
  assert.deepEqual(addSamples([null, hr('2026-11-03', 62)]), { added: 1, skipped: 1, duplicates: 0, invalid: 1 });
});

test('whether a sample ends before it starts is judged the same in every time zone', () => {
  const sleep = (start, end) => ({ signal: 'sleep_minutes', start, end, value: 420, unit: 'min', source: 'csv' });
  const cases = [ // [sample, kept?]
    // one time with an offset and one without: no zone guess, so not compared
    [sleep('2026-11-02T08:00:00-05:00', '2026-11-02T08:30:00'), true],
    // no offsets: the clock times as written. Toronto skips 02:00 to 03:00 that night,
    // which must not turn 45 minutes later into "before".
    [sleep('2026-03-08T02:30', '2026-03-08T03:15'), true],
    [sleep('2026-11-02T08:30', '2026-11-02T08:00'), false],
    // both with offsets: the moments. 12:30 UTC is before 13:00 UTC; 03:00 UTC is after
    // 01:00 UTC, though the clock reads earlier (a flight west).
    [sleep('2026-11-02T08:00:00-05:00', '2026-11-02T13:30:00+01:00'), false],
    [sleep('2026-11-02T20:00:00-05:00', '2026-11-02T19:00:00-08:00'), true],
    // a date against a time: the dates written
    [sleep('2026-11-02', '2026-11-01T23:00:00-05:00'), false],
    [sleep('2026-11-02', '2026-11-02T06:00'), true],
    [sleep('2026-11-02T22:00', '2026-11-03'), true],
    [sleep('2026-11-02T22:00', '2026-11-01'), false],
  ];
  const original = process.env.TZ;
  const home = Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    for (const zone of ['UTC', 'America/Toronto', 'Asia/Tokyo', 'America/St_Johns', 'Pacific/Kiritimati']) {
      process.env.TZ = zone; // Node applies a new TZ at once
      fresh(fakeStorage());
      cases.forEach(([s, kept], i) => assert.equal(addSamples([s]).added, kept ? 1 : 0, `case ${i} in ${zone}`));
    }
  } finally {
    process.env.TZ = home; // back to this machine's zone, then as it was
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test('a stored sample keeps only the agreed fields', () => {
  fresh(fakeStorage());
  addSamples([{ ...bp('2026-11-02', 128, 82), end: '2026-11-02', person: 'alex', simulated: true, detail: { device: 'cuff' }, extra: 'dropped' }]);
  assert.deepEqual(getSamples(), [{
    signal: 'bp', start: '2026-11-02', end: '2026-11-02', value: 128, value2: 82, unit: 'mmHg', source: 'bluetooth',
    person: 'alex', simulated: true, detail: { device: 'cuff' },
  }]);
  addSamples([hr('2026-11-03', 62, { simulated: false })]);
  assert.equal('simulated' in getSamples({ signal: 'heart_rate' })[0], false);
});

test('getSamples filters by signal, person and source; a plain source covers its formats', () => {
  fresh(fakeStorage());
  addSamples([
    hr('2026-11-02T08:00:00-05:00', 61, { person: 'alex' }),
    hr('2026-11-03T08:00:00-05:00', 63, { source: 'csv:withings' }),
    hr('2026-11-04T08:00:00-05:00', 65, { source: 'csv' }),
    bp('2026-11-02T08:00:00-05:00', 128, 82, { person: 'alex' }),
  ]);
  assert.deepEqual(getSamples({ signal: 'bp' }).map((x) => x.value), [128]);
  assert.deepEqual(getSamples({ person: 'alex' }).map((x) => x.signal).sort(), ['bp', 'heart_rate']);
  assert.deepEqual(getSamples({ source: 'csv' }).map((x) => x.value), [63, 65]);
  assert.deepEqual(getSamples({ source: 'csv:withings' }).map((x) => x.value), [63]);
  assert.deepEqual(getSamples({ source: 'cs' }), []); // a family is the part before the colon, not any prefix
  assert.deepEqual(getSamples({ signal: 'heart_rate', person: 'alex' }).map((x) => x.value), [61]);
  assert.equal(getSamples(null).length, 4);
  assert.equal(getSamples({}).length, 4);
});

test('removeSamples removes what matches and says how many; with no criteria it removes nothing', () => {
  fresh(fakeStorage());
  addSamples([
    hr('2026-11-02T08:00:00-05:00', 61, { source: 'demo', simulated: true }),
    hr('2026-11-03T08:00:00-05:00', 62, { source: 'demo', simulated: true }),
    hr('2026-11-04T08:00:00-05:00', 63),
    bp('2026-11-02T08:00:00-05:00', 128, 82),
  ]);
  assert.equal(removeSamples(), 0);
  assert.equal(removeSamples({}), 0);
  assert.equal(removeSamples(null), 0);
  assert.equal(getSamples().length, 4);
  assert.equal(removeSamples({ simulated: true }), 2);
  assert.equal(removeSamples({ source: 'demo' }), 0);
  assert.equal(removeSamples({ signal: 'bp' }), 1);
  assert.equal(removeSamples({ source: 'apple-health', signal: 'bp' }), 0); // every criterion must match
  assert.equal(removeSamples({ source: 'apple-health' }), 1);
  assert.deepEqual(getSamples(), []);
  // simulated: false removes real data and keeps the simulated
  addSamples([hr('2026-11-02', 61, { source: 'demo', simulated: true }), hr('2026-11-03', 63)]);
  assert.equal(removeSamples({ simulated: false }), 1);
  assert.deepEqual(getSamples().map((x) => x.simulated), [true]);
});

// ---------- results ----------
test('addResult stores a result with a new id; getResults filters and sorts by date and time', () => {
  const s = fresh(fakeStorage());
  const a = addResult({ test: 'ddk_rate', date: '2026-11-03', time: '09:15', value: 5.8, unit: 'syllables/s', detail: { syllables: 58 } });
  const b = addResult({ test: 'ddk_rate', date: '2026-11-03', time: '08:05', value: 5.6, unit: 'syllables/s', practice: true });
  const c = addResult({ test: 'sts30', date: '2026-11-02', value: 12, unit: 'repetitions', person: 'alex', simulated: true });
  for (const r of [a, b, c]) assert.ok(typeof r.id === 'string' && r.id.length > 0);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.deepEqual(a, { id: a.id, test: 'ddk_rate', date: '2026-11-03', time: '09:15', value: 5.8, unit: 'syllables/s', detail: { syllables: 58 } });
  assert.deepEqual(getResults().map((r) => r.id), [c.id, b.id, a.id]);
  assert.deepEqual(getResults({ test: 'ddk_rate' }).map((r) => r.id), [b.id, a.id]);
  assert.deepEqual(getResults({ person: 'alex' }).map((r) => r.id), [c.id]);
  assert.deepEqual(getResults()[0], { id: c.id, test: 'sts30', date: '2026-11-02', value: 12, unit: 'repetitions', person: 'alex', simulated: true });
  assert.equal(getResults({ test: 'ddk_rate' })[0].practice, true);
  assert.equal(JSON.parse(s.data.get(KEYS.results)).length, 3);
  // the id is always generated, even if the caller brings one
  assert.notEqual(addResult({ ...grip('2026-11-04', 30), id: a.id }).id, a.id);
  assert.notEqual(addResult({ ...grip('2026-11-05', 30), id: 'my-own-id' }).id, 'my-own-id');
});

test('results get unique ids where crypto.randomUUID is missing (a page on plain http)', () => {
  fresh(fakeStorage());
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true, writable: true });
  try {
    const ids = Array.from({ length: 50 }, (_, i) => addResult(grip('2026-11-02', 30 + i)).id);
    assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
    assert.equal(new Set(ids).size, 50);
  } finally {
    Object.defineProperty(globalThis, 'crypto', real);
  }
});

test('addResult refuses a result it cannot use, with a reason in plain words', () => {
  fresh(fakeStorage());
  const ok = { test: 'mpt', date: '2026-11-02', value: 14.2, unit: 's' };
  const loop = {};
  loop.self = loop;
  const bad = [null, 'mpt', [], { ...ok, test: '' }, { ...ok, date: '2026-11-31' }, { ...ok, date: '2026-11-02T10:00:00Z' },
    { ...ok, date: undefined }, { ...ok, time: '9:15' }, { ...ok, time: '24:00' }, { ...ok, value: NaN }, { ...ok, value: '14.2' },
    { ...ok, unit: undefined }, { ...ok, person: 3 }, { ...ok, simulated: 'no' }, { ...ok, practice: 'yes' }, { ...ok, detail: loop }];
  bad.forEach((r, i) => {
    const out = addResult(r);
    assert.equal(out.ok, false, `bad result ${i}`);
    assert.ok(typeof out.reason === 'string' && out.reason.length > 20, `bad result ${i}: ${out.reason}`);
  });
  assert.deepEqual(getResults(), []);
});

test('removeResult removes by id and says whether it was there', () => {
  fresh(fakeStorage());
  const a = addResult({ test: 'tug_time', date: '2026-11-02', value: 9.1, unit: 's' });
  const b = addResult({ test: 'tug_time', date: '2026-11-09', value: 9.4, unit: 's' });
  assert.equal(removeResult(a.id), true);
  assert.equal(removeResult(a.id), false);
  assert.equal(removeResult('no-such-id'), false);
  assert.equal(removeResult(undefined), false);
  assert.deepEqual(getResults().map((r) => r.id), [b.id]);
});

test('clearHomeData removes both lists and nothing else', () => {
  const s = fresh(fakeStorage());
  addSamples([hr('2026-11-02T08:00:00-05:00', 61)]);
  addResult(grip('2026-11-02', 31));
  s.data.set('rfn.referralLine', '0.1'); // another part of the app
  clearHomeData();
  assert.deepEqual(getSamples(), []);
  assert.deepEqual(getResults(), []);
  assert.equal(s.data.has(KEYS.samples) || s.data.has(KEYS.results), false);
  assert.equal(s.data.get('rfn.referralLine'), '0.1');
});

// ---------- notifications ----------
test('subscribers hear every change, and nothing when nothing changed', () => {
  fresh(fakeStorage());
  const calls = [];
  const stop = subscribe((e) => calls.push(e));
  const sample = hr('2026-11-02T08:00:00-05:00', 61);
  addSamples([sample]); // change
  addSamples([sample]); // only a duplicate: no change
  removeSamples({ signal: 'bp' }); // nothing matched
  const r = addResult(grip('2026-11-02', 31)); // change
  addResult(grip('bad', 31)); // refused
  removeResult(r.id); // change
  removeResult(r.id); // already gone
  removeSamples({ signal: 'heart_rate' }); // change
  clearHomeData(); // both lists already empty
  assert.deepEqual(calls, [
    { key: KEYS.samples, external: false },
    { key: KEYS.results, external: false },
    { key: KEYS.results, external: false },
    { key: KEYS.samples, external: false },
  ]);
  stop();
  stop(); // a second call is harmless
  addSamples([sample]);
  assert.equal(calls.length, 4);
  const later = [];
  const stop2 = subscribe((e) => later.push(e));
  clearHomeData();
  assert.deepEqual(later, [{ key: null, external: false }]);
  stop2();
  // something that is not a function cannot subscribe, but gets a harmless unsubscribe
  const none = subscribe(null);
  assert.equal(typeof none, 'function');
  none();
});

test('one failing listener does not stop the others or the change', () => {
  fresh(fakeStorage());
  const seen = [];
  const original = console.error;
  console.error = () => {};
  try {
    const a = subscribe(() => { throw new Error('broken listener'); });
    const b = subscribe((e) => seen.push(e.key));
    assert.equal(addSamples([hr('2026-11-02T08:00:00-05:00', 61)]).added, 1);
    assert.deepEqual(seen, [KEYS.samples]);
    assert.equal(getSamples().length, 1);
    a();
    b();
  } finally {
    console.error = original;
  }
});

test("subscribers hear other tabs through window 'storage' events, for these keys only", () => {
  fresh(fakeStorage());
  const target = new EventTarget(); // stands in for window
  let attached = 0; // 'storage' listeners on the window right now
  globalThis.addEventListener = (type, fn) => { if (type === 'storage') attached += 1; target.addEventListener(type, fn); };
  globalThis.removeEventListener = (type, fn) => { if (type === 'storage') attached -= 1; target.removeEventListener(type, fn); };
  const fire = (key) => {
    const e = new Event('storage');
    e.key = key;
    target.dispatchEvent(e);
  };
  try {
    const heard = [];
    const stop = subscribe((e) => heard.push(e));
    const stopOther = subscribe(() => {});
    assert.equal(attached, 1); // one window listener, however many subscribers
    fire(KEYS.samples);
    fire('rfn.referralLine');
    fire(KEYS.results);
    fire(null); // another tab cleared all storage
    assert.deepEqual(heard, [
      { key: KEYS.samples, external: true },
      { key: KEYS.results, external: true },
      { key: null, external: true },
    ]);
    stop();
    fire(KEYS.samples);
    assert.equal(heard.length, 3);
    assert.equal(attached, 1);
    stopOther();
    assert.equal(attached, 0); // nobody listening: the window listener is gone too
  } finally {
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
  }
});

// ---------- status and fallbacks ----------
test('storageStatus: saved data is persistent, with its size in bytes', () => {
  const s = fresh(fakeStorage());
  assert.deepEqual(storageStatus(), { persistent: true, bytesUsed: 0 });
  addSamples([hr('2026-11-02T08:00:00-05:00', 61)]);
  addResult(grip('2026-11-02', 31));
  // about 2 bytes a character (browsers keep UTF-16), the keys included
  let chars = 0;
  for (const k of Object.values(KEYS)) chars += k.length + s.data.get(k).length;
  assert.deepEqual(storageStatus(), { persistent: true, bytesUsed: 2 * chars });
  assert.deepEqual([...s.data.keys()].sort(), [KEYS.results, KEYS.samples].sort()); // no test key left behind
});

test('a full quota keeps new data in memory, says so, and saves it once there is room', () => {
  const s = fresh(fakeStorage({ limit: 1200 }));
  const r = addResult(grip('2026-11-02', 31)); // small: fits
  const many = Array.from({ length: 20 }, (_, i) => hr(`2026-11-${String(i + 1).padStart(2, '0')}T08:00:00-05:00`, 60 + i, { source: i < 3 ? 'manual' : 'apple-health' }));
  assert.equal(addSamples(many).added, 20); // about 2,100 characters: over the limit
  assert.equal(getSamples().length, 20); // still here for this visit
  assert.equal(s.data.has(KEYS.samples), false); // but not saved
  assert.deepEqual(getResults().map((x) => x.id), [r.id]); // the list that was saved is still readable
  const st = storageStatus();
  assert.equal(st.persistent, false);
  assert.match(st.warning, /full/);
  assert.ok(st.bytesUsed > 2 * 2000);
  // removing most of the import makes room, so the rest is saved and the warning goes
  assert.equal(removeSamples({ source: 'apple-health' }), 17);
  assert.equal(JSON.parse(s.data.get(KEYS.samples)).length, 3);
  const after = storageStatus();
  assert.equal(after.persistent, true);
  assert.equal('warning' in after, false);
});

test('a list that storage refused is saved by the next write that frees space', () => {
  const s = fresh(fakeStorage());
  addSamples(Array.from({ length: 6 }, (_, i) => hr(`2026-11-0${i + 1}T08:00:00-05:00`, 60 + i, { source: i < 5 ? 'csv' : 'manual' })));
  s.limit = s.size() + 40; // nearly full
  const r = addResult(grip('2026-11-02', 31)); // does not fit
  assert.equal(s.data.has(KEYS.results), false);
  assert.deepEqual(getResults().map((x) => x.id), [r.id]);
  assert.equal(storageStatus().persistent, false);
  removeSamples({ source: 'csv' }); // frees space; the waiting result is saved too
  assert.deepEqual(JSON.parse(s.data.get(KEYS.results)).map((x) => x.id), [r.id]);
  assert.equal(storageStatus().persistent, true);
});

test('storageStatus saves waiting data once the browser has room again', () => {
  const s = fresh(fakeStorage({ limit: 300 }));
  addSamples(Array.from({ length: 5 }, (_, i) => hr(`2026-11-0${i + 1}T08:00:00-05:00`, 60 + i))); // about 550 characters
  assert.equal(s.data.has(KEYS.samples), false);
  assert.equal(storageStatus().persistent, false);
  s.limit = Infinity; // room was made somewhere else
  assert.deepEqual(storageStatus().persistent, true);
  assert.equal(JSON.parse(s.data.get(KEYS.samples)).length, 5);
});

test('storage that is full but holds everything: saved, with a heads-up', () => {
  const s = fresh(fakeStorage());
  addResult(grip('2026-11-02', 31));
  s.limit = s.size(); // not one more character fits
  const st = storageStatus();
  assert.equal(st.persistent, true);
  assert.match(st.warning, /may not be saved/);
});

test('storage whose reads throw reads as empty instead of breaking the page', () => {
  const s = fresh(fakeStorage());
  addSamples([hr('2026-11-02T08:00:00-05:00', 61)]);
  s.getItem = () => { throw new DOMException('Reading is not allowed.', 'SecurityError'); };
  assert.deepEqual(getSamples(), []);
  assert.deepEqual(getResults(), []);
  assert.equal(typeof storageStatus().persistent, 'boolean');
});

test('storage that refuses every write: data is kept in memory with a warning', () => {
  const s = fakeStorage();
  s.setItem = () => { throw new DOMException('Writing is not allowed.', 'SecurityError'); };
  fresh(s);
  assert.equal(addSamples([hr('2026-11-02T08:00:00-05:00', 61)]).added, 1);
  assert.equal(getSamples().length, 1);
  const st = storageStatus();
  assert.equal(st.persistent, false);
  assert.match(st.warning, /not letting the app save/);
});

test('with no localStorage at all, everything works for this visit', () => {
  fresh(null);
  assert.equal(globalThis.localStorage, undefined);
  assert.equal(addSamples([hr('2026-11-02T08:00:00-05:00', 61), hr('2026-11-02T08:00:00-05:00', 61)]).duplicates, 1);
  const r = addResult(grip('2026-11-02', 31));
  assert.deepEqual(getSamples().map((x) => x.value), [61]);
  assert.deepEqual(getResults().map((x) => x.id), [r.id]);
  assert.equal(removeSamples({ signal: 'heart_rate' }), 1);
  const st = storageStatus();
  assert.equal(st.persistent, false);
  assert.match(st.warning, /only until this page is closed/);
  assert.ok(st.bytesUsed > 0); // the result is held in memory
  const heard = [];
  const stop = subscribe((e) => heard.push(e.key));
  clearHomeData();
  stop();
  assert.deepEqual(heard, [null]);
  assert.deepEqual(getResults(), []);
  assert.equal(storageStatus().bytesUsed, 0);
});

test('a localStorage that throws when touched counts as no storage', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  try {
    clearHomeData();
    assert.equal(addSamples([hr('2026-11-02T08:00:00-05:00', 61)]).added, 1);
    assert.equal(getSamples().length, 1);
    assert.equal(storageStatus().persistent, false);
  } finally {
    fresh(null);
  }
});

test('changing what the store handed out does not change what is stored', () => {
  fresh(fakeStorage());
  addSamples([bp('2026-11-02T08:00:00-05:00', 128, 82, { detail: { device: 'cuff' } })]);
  const added = addResult(grip('2026-11-02', 31, { detail: { hand: 'right' } }));
  const s = getSamples()[0];
  s.value = 0;
  s.detail.device = 'changed';
  const r = getResults()[0];
  r.value = 0;
  r.detail.hand = 'changed';
  added.value = -1;
  added.detail.hand = 'changed too';
  getSamples().push({ signal: 'x' });
  assert.equal(getSamples().length, 1);
  assert.equal(getSamples()[0].value, 128);
  assert.equal(getSamples()[0].detail.device, 'cuff');
  assert.equal(getResults()[0].value, 31);
  assert.equal(getResults()[0].detail.hand, 'right');
});

test('reads after this page\'s own writes do not parse the stored lists again (big imports stay fast)', () => {
  fresh(fakeStorage());
  addSamples(Array.from({ length: 50 }, (_, i) => hr(`2026-11-02T08:${String(i).padStart(2, '0')}:00-05:00`, 60 + i)));
  addResult(grip('2026-11-02', 31));
  const parse = JSON.parse;
  let parses = 0;
  JSON.parse = (...args) => { parses += 1; return parse(...args); };
  try {
    assert.equal(getSamples().length, 50);
    assert.equal(addSamples([hr('2026-11-03T08:00:00-05:00', 70)]).added, 1);
    assert.equal(getSamples().length, 51);
    assert.equal(removeSamples({ signal: 'heart_rate' }), 51);
    assert.deepEqual(getSamples(), []);
    addResult(grip('2026-11-03', 32));
    assert.equal(getResults().length, 2);
  } finally {
    JSON.parse = parse;
  }
  assert.equal(parses, 0);
});

test('a change another tab wrote shows on the next read', () => {
  const s = fresh(fakeStorage());
  addSamples([hr('2026-11-02T08:00:00-05:00', 61)]);
  assert.equal(getSamples().length, 1);
  const theirs = JSON.parse(s.data.get(KEYS.samples)); // the other tab adds a sample
  theirs.push(hr('2026-11-03T08:00:00-05:00', 62));
  s.data.set(KEYS.samples, JSON.stringify(theirs));
  assert.deepEqual(getSamples().map((x) => x.value), [61, 62]);
  assert.equal(addSamples([hr('2026-11-04T08:00:00-05:00', 63)]).added, 1); // and new data goes on top of theirs
  assert.deepEqual(getSamples().map((x) => x.value), [61, 62, 63]);
  s.data.delete(KEYS.samples); // the other tab cleared it
  assert.deepEqual(getSamples(), []);
});

test('corrupt or foreign data in storage reads as empty instead of throwing', () => {
  const s = fresh(fakeStorage());
  s.data.set(KEYS.samples, '{not json');
  s.data.set(KEYS.results, '{"a":1}');
  assert.deepEqual(getSamples(), []);
  assert.deepEqual(getResults(), []);
  s.data.set(KEYS.samples, JSON.stringify([hr('2026-11-02T08:00:00-05:00', 61), { signal: 'x' }, null]));
  assert.deepEqual(getSamples().map((x) => x.value), [61]); // the broken entries are left out
  assert.equal(addSamples([hr('2026-11-03T08:00:00-05:00', 62)]).added, 1);
  assert.deepEqual(getSamples().map((x) => x.value), [61, 62]);
});
