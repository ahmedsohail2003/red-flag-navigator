// Phone page checks (motion/web/walk.js and walk.html), run in a small fake browser. No npm packages.
// Owner: phone builder. Each test opens a fresh copy of the page (walk.js?page=N), so state never leaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WEB = new URL('../web/', import.meta.url);
const HTML = readFileSync(new URL('walk.html', WEB), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const JS = readFileSync(new URL('walk.js', WEB), 'utf8');

function parseTags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : a[2];
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}
const TAGS = parseTags(HTML);
const HTML_IDS = new Set(TAGS.filter((t) => t.attrs.id).map((t) => t.attrs.id));
// Visible words only: no tags, no script or style.
const HTML_TEXT = HTML.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.id = attrs.id || '';
    this.hidden = 'hidden' in attrs;
    this.checked = 'checked' in attrs;
    this.disabled = 'disabled' in attrs;
    this.value = attrs.value ?? '';
    this.className = attrs.class ?? '';
    this.href = attrs.href ?? '';
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this._text = '';
    const cls = new Set();
    this.classList = {
      toggle: (c, on) => { if (on ?? !cls.has(c)) cls.add(c); else cls.delete(c); },
      add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
    };
  }
  get textContent() { return [this._text, ...this.children.map((c) => c.textContent)].filter(Boolean).join(' '); }
  set textContent(v) { this._text = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, ev = {}) { for (const fn of this.listeners[type] || []) fn(ev); }
  focus() {}
  scrollIntoView() {}
}

function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true, enumerable: true });
}

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
const STILL = () => ({});
const WALKING = (t) => ({ ay: 9.81 + 2 * Math.sin(2 * Math.PI * 2 * t / 1000) }); // 2 steps a second

let pageN = 0;
async function openPage(opts = {}) {
  const { secure = true, protocol = 'https:', hostname = '192.168.1.5', audioSession, queue, fetchImpl } = opts;
  const els = new Map();
  for (const t of TAGS) if (t.attrs.id) els.set(t.attrs.id, new El(t.tag, t.attrs));
  const dots = els.get('todayDots');
  for (let i = 0; i < 3; i++) dots.appendChild(new El('li'));
  const radios = [...els.values()].filter((e) => e.tagName === 'INPUT' && e.attrs.name === 'placement');

  const document = {
    getElementById: (id) => els.get(id) || null,
    querySelectorAll: (sel) => (sel === 'input[name="placement"]' ? radios : []),
    querySelector: (sel) => (sel === 'input[name="placement"]:checked' ? radios.find((r) => r.checked) || null : null),
    createElement: (tag) => new El(tag),
    body: { dataset: {} },
    documentElement: { dataset: {} },
    visibilityState: 'visible',
    addEventListener: () => {},
  };
  const store = new Map();
  if (queue) store.set('rfn.motion.queue', JSON.stringify(queue));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const clock = { now: 1000 };
  const intervals = new Map();
  let nextId = 1;
  const navigator = { userAgent: 'walk-test' };
  if (audioSession) navigator.audioSession = audioSession;
  const audio = { contexts: [], oscillators: [] };
  class FakeAudioContext {
    constructor() {
      let type;
      try { type = navigator.audioSession ? navigator.audioSession.type : undefined; } catch (_) { type = 'unreadable'; }
      audio.contexts.push({ sessionTypeAtCreate: type });
      this.state = 'running'; this.currentTime = 0; this.destination = {};
    }
    createOscillator() {
      const o = { type: 'sine', frequency: { value: 440 }, connect() {}, start() {}, stop() {} };
      audio.oscillators.push(o);
      return o;
    }
    createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
    resume() { return Promise.resolve(); }
  }
  const winListeners = {};
  const window = {
    localStorage,
    DeviceMotionEvent: function DeviceMotionEvent() {}, // Android style: no requestPermission
    AudioContext: FakeAudioContext,
    isSecureContext: secure,
    crypto: globalThis.crypto,
    URL,
    addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
    scrollTo() {},
  };
  setGlobal('window', window);
  setGlobal('document', document);
  setGlobal('navigator', navigator);
  setGlobal('performance', { now: () => clock.now });
  setGlobal('location', { hostname, protocol, pathname: '/motion/walk.html', search: '' });
  setGlobal('fetch', fetchImpl || (async () => ({ ok: true, status: 201, json: async () => ({ ok: true, id: 'x' }) })));
  setGlobal('setInterval', (fn, ms) => { const id = nextId++; intervals.set(id, { id, fn, ms, next: clock.now + ms }); return id; });
  setGlobal('clearInterval', (id) => { intervals.delete(id); });

  await import(new URL(`walk.js?page=${++pageN}`, WEB).href);
  await flush();

  const motionEvent = (s = {}) => ({
    timeStamp: clock.now,
    accelerationIncludingGravity: { x: s.ax ?? 0, y: s.ay ?? 9.81, z: s.az ?? 0 },
    acceleration: { x: 0, y: 0, z: 0 },
    rotationRate: { alpha: s.alpha ?? 0, beta: s.beta ?? 0, gamma: s.gamma ?? 0 },
  });
  const fireMotion = (s) => { for (const fn of winListeners.devicemotion || []) fn(motionEvent(s)); };
  // Steps the fake clock in 20 ms steps: one motion event each step (50 a second), and the page's tickers.
  async function advance(ms, motion = STILL) {
    const end = clock.now + ms;
    while (clock.now < end - 1e-9) {
      clock.now = Math.round((clock.now + 20) * 100) / 100;
      if (motion) fireMotion(motion(clock.now));
      for (const iv of [...intervals.values()]) {
        if (intervals.has(iv.id) && clock.now >= iv.next) { iv.next += iv.ms; iv.fn(); }
      }
    }
    await flush();
  }
  const tap = async (id) => { els.get(id).fire('pointerdown'); els.get(id).fire('click'); await flush(); };
  const choose = (p) => { for (const r of radios) r.checked = (r.attrs.value === p); };
  const beeps = () => audio.oscillators.filter((o) => o.frequency.value === 880).length;
  return { els, st: window.__walk, clock, audio, navigator, store, advance, tap, choose, fireMotion, beeps };
}

// A walk that stops by itself: 3 s countdown, 2.5 s of walking, then standing still.
async function autoStoppedWalk(p) {
  await p.tap('startBtn');
  await p.advance(3100);
  assert.equal(p.st.phase, 'walking');
  await p.advance(2500, WALKING);
  await p.advance(4000, STILL);
  return p;
}

test('every element id walk.js uses is in walk.html', () => {
  const used = new Set([...JS.matchAll(/\$\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  const views = JS.match(/const VIEWS = \[([^\]]*)\]/);
  for (const m of (views ? views[1] : '').matchAll(/'([A-Za-z0-9_-]+)'/g)) used.add(m[1]);
  const focus = JS.match(/const focusId = \{([^}]*)\}/);
  for (const m of (focus ? focus[1] : '').matchAll(/:\s*'([A-Za-z0-9_-]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 40, `found only ${used.size} ids`);
  const missing = [...used].filter((id) => !HTML_IDS.has(id));
  assert.deepEqual(missing, []);
});

test('gyro: gx, gy, gz are rotationRate alpha, beta, gamma (rates about device x, y, z)', async () => {
  const p = await openPage();
  await p.tap('startBtn');
  await p.advance(100);
  p.clock.now += 20; // a sample at the same time as the last one is dropped, so move the clock on
  const before = p.st.rec.samples.length;
  p.fireMotion({ alpha: 11, beta: 22, gamma: 33 });
  assert.equal(p.st.rec.samples.length, before + 1);
  const s = p.st.rec.samples.at(-1);
  assert.deepEqual([s.gx, s.gy, s.gz], [11, 22, 33]);
});

test('iPhone Silent mode: the Start tap sets audioSession to playback before audio starts', async () => {
  const session = { type: 'auto' };
  const p = await openPage({ audioSession: session });
  assert.equal(session.type, 'auto', 'not changed before the tap');
  await p.tap('startBtn');
  assert.equal(session.type, 'playback');
  assert.equal(p.audio.contexts.length, 1);
  assert.equal(p.audio.contexts[0].sessionTypeAtCreate, 'playback');
});

test('an audioSession that refuses the type does not stop the GO beep', async () => {
  const session = { get type() { return 'auto'; }, set type(_) { throw new Error('refused'); } };
  const p = await openPage({ audioSession: session });
  await p.tap('startBtn');
  assert.equal(p.st.phase, 'countdown');
  await p.advance(3100);
  assert.equal(p.st.phase, 'walking');
  assert.equal(p.beeps(), 1);
});

test('beeps at GO and again when the walk stops by itself', async () => {
  const p = await autoStoppedWalk(await openPage());
  assert.equal(p.st.phase, 'done');
  assert.equal(p.st.rec.stopBy, 'auto');
  assert.equal(p.beeps(), 2);
});

test('beeps again when the walk stops at the 60 s limit', async () => {
  const p = await openPage();
  await p.tap('startBtn');
  await p.advance(3100);
  assert.equal(p.beeps(), 1);
  await p.advance(60200, STILL);
  assert.equal(p.st.rec.stopBy, 'timeout');
  assert.equal(p.beeps(), 2);
});

test('no second beep when the person taps Stop', async () => {
  const p = await openPage();
  await p.tap('startBtn');
  await p.advance(3100);
  await p.advance(2000, WALKING);
  await p.tap('stopBtn');
  assert.equal(p.st.rec.stopBy, 'tap');
  assert.equal(p.beeps(), 1);
});

test('pocket gets a 6 s countdown and its own title; waist keeps 3 s', async () => {
  const p = await openPage();
  p.choose('pocket');
  await p.tap('startBtn');
  assert.equal(p.st.phase, 'countdown');
  assert.match(p.els.get('countTitle').textContent, /pocket/i);
  assert.equal(p.els.get('countNum').textContent, '6');
  await p.advance(3200);
  assert.equal(p.st.phase, 'countdown', 'still counting at 3.2 s');
  await p.advance(2900);
  assert.equal(p.st.phase, 'walking');
  assert.equal(p.st.rec.placement, 'pocket');
  const firstT = p.st.rec.samples[0].t;
  assert.ok(p.st.rec.goT - firstT > 5800, `GO came ${p.st.rec.goT - firstT} ms after the first reading`);

  const w = await openPage();
  w.choose('waist');
  await w.tap('startBtn');
  assert.equal(w.els.get('countTitle').textContent, 'Stand still at the start line');
  assert.equal(w.els.get('countNum').textContent, '3');
  await w.advance(3100);
  assert.equal(w.st.phase, 'walking');
});

test('cancelling a pocket countdown and choosing waist gives the waist countdown', async () => {
  const p = await openPage();
  p.choose('pocket');
  await p.tap('startBtn');
  await p.advance(500);
  await p.tap('cancelBtn');
  assert.equal(p.st.phase, 'setup');
  p.choose('waist');
  await p.tap('startBtn');
  assert.equal(p.els.get('countTitle').textContent, 'Stand still at the start line');
  assert.equal(p.els.get('countNum').textContent, '3');
  await p.advance(3100);
  assert.equal(p.st.phase, 'walking');
});

const HOTSPOT_STEPS = (text) => {
  assert.match(text, /join the laptop to this phone's hotspot/i);
  assert.match(text, /restart the server/i);
  assert.match(text, /new address/i);
  assert.doesNotMatch(text, /use a phone hotspot/i);
};

test('help on a page opened over http says: join the laptop to the hotspot, restart, new address', async () => {
  const p = await openPage({ secure: false, protocol: 'http:' });
  assert.equal(p.els.get('startBtn').disabled, true);
  HOTSPOT_STEPS(p.els.get('help').textContent);
});

test('help after a failed send says the same hotspot steps', async () => {
  const queued = { v: 1, kind: 'rfn-walk', id: 'w-20261108T050000-abcd', createdAt: '2026-11-08T10:00:00.000Z', distance_m: 10, placement: 'waist', device: { ua: 'x' }, result: { ok: true } };
  const p = await openPage({ queue: [queued], fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  const text = p.els.get('queueStatus').textContent;
  assert.match(text, /Could not reach the laptop/);
  HOTSPOT_STEPS(text);
});

test('patient page: safety line, no ALS, no flag, does not diagnose', () => {
  assert.doesNotMatch(HTML_TEXT, /\bALS\b/);
  assert.doesNotMatch(HTML_TEXT, /\bflag/i);
  assert.match(HTML_TEXT, /walking aid/i);
  assert.match(HTML_TEXT, /fall/i);
  assert.match(HTML_TEXT, /unsteady/i);
  assert.match(HTML_TEXT, /does not diagnose any illness/i);
  // Stop wording: stand still at the line until it beeps.
  assert.match(HTML_TEXT, /stand still until it beeps/i);
});

test('the patient sees no left-right or step-time numbers, and no flag wording', async () => {
  const p = await autoStoppedWalk(await openPage());
  const labels = p.els.get('exploratory').children.map((div) => div.children[0].textContent);
  assert.ok(labels.length > 0);
  assert.ok(!labels.some((l) => /left-right|step-time/i.test(l)), labels.join(' | '));
  assert.ok(labels.includes('Steps per minute, from the turning sensor'), labels.join(' | '));
  const shown = ['viewResult', 'help', 'nextText', 'sendStatus'].map((id) => p.els.get(id).textContent).join(' ');
  assert.doesNotMatch(shown, /\bflag|\bALS\b/i);
});
