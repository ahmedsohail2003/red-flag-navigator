// Copy-typing test (app/js/home/typing.js). Expected numbers are worked out by hand
// from the definitions in the task, not copied from the code's output.
// Run: node --test "tests/home-typing.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PASSAGES, createTypingSession, typingMetrics, editDistance } from '../app/js/home/typing.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} vs ${b}`);
const nan = (x, what = 'value') => assert.ok(Number.isNaN(x), `${what}: expected NaN, got ${x}`);

// A fake browser: one text box, a clock we set by hand, and the events a browser
// sends. beforeinput sees the box before the change, input sees it after.
function rig(target) {
  let clock = 0;
  const field = { value: '' };
  const s = createTypingSession(target, { now: () => clock });
  const at = (t) => { clock = t; };
  const change = (t, inputType, data, value, withTarget = true) => {
    at(t); s.handleBeforeInput({ inputType, data, target: withTarget ? field : undefined });
    field.value = value;
    at(t + 1); s.handleInput({ inputType, data, target: withTarget ? field : undefined });
  };
  const g = {
    s, field, at, change,
    // Desktop: keydown first, then beforeinput and input a few ms later.
    key(ch, t, { lag = 3, repeat = false } = {}) {
      at(t); s.handleKeydown({ key: ch, keyCode: ch.toUpperCase().charCodeAt(0), repeat });
      change(t + lag, 'insertText', ch, field.value + ch);
    },
    backspace(t, { lag = 3, repeat = false } = {}) {
      at(t); s.handleKeydown({ key: 'Backspace', keyCode: 8, repeat });
      change(t + lag, 'deleteContentBackward', null, field.value.slice(0, -1));
    },
    type(text, t0, gap) { [...text].forEach((ch, k) => g.key(ch, t0 + gap * k)); },
    // Phone: keydown has no key ("Unidentified", keyCode 229); beforeinput comes 5 ms later.
    phone(t, inputType, data, value, withTarget = true) {
      at(t); s.handleKeydown({ key: 'Unidentified', keyCode: 229 });
      change(t + 5, inputType, data, value, withTarget);
    },
    paste(text, t, { withTarget = true, data = text, inputType = 'insertFromPaste' } = {}) {
      at(t); s.handleKeydown({ key: 'v', keyCode: 86, ctrlKey: true });
      change(t + 2, inputType, data, field.value + text, withTarget);
    },
  };
  return g;
}

// ---------- editDistance ----------
test('editDistance: Levenshtein distance on classic pairs', () => {
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('abc', ''), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('flaw', 'lawn'), 2);
  assert.equal(editDistance('sunday', 'saturday'), 3);
  assert.equal(editDistance('saturday', 'sunday'), 3);
  assert.equal(editDistance('Cat', 'cat'), 1, 'capital letters count');
  assert.equal(editDistance(PASSAGES[0], PASSAGES[0]), 0);
});

test('editDistance: missing text counts as empty, and an emoji is one character', () => {
  assert.equal(editDistance(null, 'ab'), 2);
  assert.equal(editDistance(undefined, undefined), 0);
  assert.equal(editDistance('a\u{1F600}', 'ab'), 1);
});

test('editDistance: a long text against a short one, either way round', () => {
  const long = 'x'.repeat(3000);
  assert.equal(editDistance(long, 'abc'), 3000); // 3 swaps and 2997 extra characters
  assert.equal(editDistance('abc', long), 3000);
  const mid = 'x'.repeat(1000);
  assert.equal(editDistance('ab' + mid, mid + 'ab'), 4); // 2 out at the front, 2 in at the end
  // A pasted page against a sentence with no x in it: every character is wrong or extra.
  const r = typingMetrics([{ t: 0, type: 'insert' }, { t: 100, type: 'insert' }], PASSAGES[0], 'x'.repeat(20000));
  assert.equal(r.errors, 20000);
  assert.equal(r.accuracyPct, 0);
});

// ---------- PASSAGES ----------
test('PASSAGES: six different sentences of 40 to 60 characters, letters and single spaces only', () => {
  assert.equal(PASSAGES.length, 6);
  assert.equal(new Set(PASSAGES).size, 6);
  for (const p of PASSAGES) {
    assert.equal(typeof p, 'string');
    const n = [...p].length;
    assert.ok(n >= 40 && n <= 60, `${n} characters: ${p}`);
    assert.match(p, /^[A-Z][a-z]*( [a-z]+)+$/, 'capital first letter, then lowercase words, no punctuation');
  }
});

// ---------- steady typist, desktop keyboard ----------
test('steady typist: speed and rhythm, timed from keydown, lead-in ignored', () => {
  const target = PASSAGES[0];
  const n = [...target].length;
  const g = rig(target);
  // 3 s reading before the first key, then one key every 200 ms. The gap between
  // keydown and the browser's input events varies (1 or 7 ms): timing must use keydown.
  [...target].forEach((ch, k) => g.key(ch, 3000 + 200 * k, { lag: k % 2 ? 7 : 1 }));
  const r = g.s.finish(g.field.value);
  assert.equal(r.ok, true);
  assert.equal(r.events.length, n, 'one event per character');
  r.events.forEach((e, k) => {
    assert.equal(e.type, 'insert');
    assert.equal(e.source, 'key');
    assert.equal(e.t, 3000 + 200 * k, 'keydown time, not beforeinput or input time');
  });
  close(r.durationS, ((n - 1) * 200) / 1000); // first key to last key: the 3 s lead-in is not in it
  assert.equal(r.correctChars, n);
  close(r.charsPerMin, ((n - 1) / r.durationS) * 60); // the first key starts the clock, so n - 1
  close(r.charsPerMin, 300);
  assert.equal(r.ikiMedianMs, 200);
  assert.equal(r.ikiIqrMs, 0);
  close(r.ikiCvPct, 0);
  assert.equal(r.pausesOver2s, 0);
  assert.equal(r.backspaces, 0);
  assert.equal(r.errors, 0);
  assert.equal(r.accuracyPct, 100);
  assert.equal(r.pasted, false);
});

// ---------- slow typist with long pauses ----------
test('slow typist: pauses over 2 s are counted, gaps over 5 s are left out of rhythm', () => {
  const target = 'abcdefghij';
  const gaps = [500, 500, 2500, 500, 7000, 500, 500, 3000, 500];
  const times = gaps.reduce((ts, gap) => [...ts, ts[ts.length - 1] + gap], [1000]);
  const g = rig(target);
  [...target].forEach((ch, k) => g.key(ch, times[k]));
  const r = g.s.finish(g.field.value);
  assert.equal(r.ok, true);
  close(r.durationS, 15.5); // 16500 - 1000 ms: the long pause is real time and stays in the speed
  close(r.charsPerMin, (9 / 15.5) * 60);
  // Rhythm uses the 8 gaps up to 5 s: 500 x6, 2500, 3000 (the 7000 is left out).
  assert.equal(r.ikiMedianMs, 500);
  close(r.ikiIqrMs, 500); // Q1 500, Q3 = 500 + 0.25 x 2000 = 1000; with the 7 s gap kept it would be 2000
  const mean = 8500 / 8;
  close(r.ikiCvPct, (Math.sqrt(7718750 / 7) / mean) * 100, 1e-6);
  assert.equal(r.pausesOver2s, 3);
  assert.equal(r.longPauses, 1);
  assert.equal(r.errors, 0);
});

test('pause limits: 2 s and 5 s exactly are not "over"', () => {
  const ev = [0, 2000, 4001, 9001, 14002].map((t) => ({ t, type: 'insert' }));
  const r = typingMetrics(ev, 'abcde', 'abcde');
  assert.equal(r.pausesOver2s, 3); // 2001, 5000, 5001
  assert.equal(r.longPauses, 1); // 5001
  assert.equal(r.ikiMedianMs, 2001); // rhythm keeps 2000, 2001, 5000
});

// ---------- corrections ----------
test('typist with corrections: a fixed typo costs a backspace but no error', () => {
  const g = rig('The cat');
  g.at(950); g.s.handleKeydown({ key: 'Shift', keyCode: 16 }); // Shift alone changes nothing
  g.key('T', 1000); g.key('h', 1250); g.key('w', 1500);
  g.backspace(1750);
  g.key('e', 2000); g.key(' ', 2250); g.key('c', 2500); g.key('a', 2750); g.key('t', 3000);
  const r = g.s.finish(g.field.value);
  assert.equal(g.field.value, 'The cat');
  assert.equal(r.events.length, 9);
  assert.equal(r.events.filter((e) => e.type === 'delete').length, 1);
  assert.equal(r.backspaces, 1);
  assert.equal(r.errors, 0);
  assert.equal(r.accuracyPct, 100);
  close(r.durationS, 2);
  close(r.charsPerMin, (6 / 2) * 60); // 7 correct characters
  assert.equal(r.ikiMedianMs, 250);
  assert.equal(r.ikiIqrMs, 0);
  close(r.ikiCvPct, 0);
});

test('an uncorrected typo is an error and does not count as a correct character', () => {
  const g = rig('The cat');
  g.type('Thw cat', 0, 250);
  const r = g.s.finish(g.field.value);
  assert.equal(r.errors, 1);
  close(r.accuracyPct, (1 - 1 / 7) * 100);
  assert.equal(r.correctChars, 6);
  close(r.durationS, 1.5);
  close(r.charsPerMin, (5 / 1.5) * 60);
});

test('a held Backspace: every deletion counts, but auto-repeats are not rhythm', () => {
  const g = rig('ab');
  g.type('abxy', 0, 300); // keys at 0, 300, 600, 900
  g.backspace(1200);
  g.backspace(1230, { repeat: true }); // the key repeats by itself 30 ms later
  const r = g.s.finish(g.field.value);
  assert.equal(g.field.value, 'ab');
  assert.equal(r.events.length, 6);
  assert.equal(r.events[5].repeat, true);
  assert.equal(r.backspaces, 2);
  assert.equal(r.ikiMedianMs, 300);
  assert.equal(r.ikiIqrMs, 0);
  close(r.ikiCvPct, 0); // a 30 ms repeat gap would make this far from 0
  close(r.durationS, 1.23);
  assert.equal(r.errors, 0);
});

test('a word deleted in one press is one backspace and one rhythm step', () => {
  const g = rig('a dog');
  g.type('a cat', 0, 200); // 0 .. 800
  g.at(1000); g.s.handleKeydown({ key: 'Backspace', keyCode: 8, ctrlKey: true });
  g.change(1002, 'deleteWordBackward', null, 'a ');
  g.type('dog', 1200, 200);
  const r = g.s.finish(g.field.value);
  assert.equal(r.events.filter((e) => e.type === 'delete').length, 3, 'one event per deleted character');
  assert.equal(r.backspaces, 1);
  assert.equal(r.ikiMedianMs, 200);
  close(r.ikiCvPct, 0); // the 3 deletions share one moment; no 0 ms gaps
  close(r.durationS, 1.6);
  close(r.charsPerMin, (4 / 1.6) * 60);
});

// ---------- phone keyboards ----------
// Android keyboards say "Unidentified" (keyCode 229) on keydown and resend the whole
// word being composed with each key.
const composeTheCat = (g, withTarget = true) => {
  const steps = [
    ['insertCompositionText', 'T', 'T'], ['insertCompositionText', 'Th', 'Th'],
    ['insertCompositionText', 'The', 'The'], ['insertText', ' ', 'The '],
    ['insertCompositionText', 'c', 'The c'], ['insertCompositionText', 'ca', 'The ca'],
    ['insertCompositionText', 'cat', 'The cat'],
  ];
  steps.forEach(([type, data, value], k) => g.phone(1000 + 300 * k, type, data, value, withTarget));
};

test('soft keyboard without key codes: one event per character, timed at beforeinput', () => {
  const g = rig('The cat');
  composeTheCat(g);
  const r = g.s.finish(g.field.value);
  assert.equal(r.events.length, 7, 'not 13: the resent word must not be counted again');
  r.events.forEach((e, k) => {
    assert.equal(e.type, 'insert');
    assert.equal(e.source, 'key');
    assert.equal(e.t, 1000 + 300 * k + 5, 'beforeinput time');
  });
  close(r.durationS, 1.8);
  close(r.charsPerMin, (6 / 1.8) * 60);
  assert.equal(r.ikiMedianMs, 300);
  assert.equal(r.errors, 0);
  assert.equal(r.ok, true);
});

test('soft keyboard events with no text box attached still count each character', () => {
  const g = rig('The cat');
  composeTheCat(g, false);
  const r = g.s.finish('The cat');
  assert.equal(r.events.length, 7);
  close(r.durationS, 1.8);
  assert.equal(r.ikiMedianMs, 300);
  assert.equal(r.errors, 0);
});

test('no text box: a delete counts one character, a line break one insert', () => {
  const g = rig('ab');
  g.phone(0, 'insertText', 'a', 'a', false);
  g.phone(300, 'insertText', 'b', 'ab', false);
  g.phone(600, 'deleteContentBackward', null, 'a', false);
  g.phone(900, 'insertLineBreak', null, 'a\n', false);
  const r = g.s.finish('a');
  assert.deepEqual(r.events.map((e) => e.type), ['insert', 'insert', 'delete', 'insert']);
  assert.equal(r.backspaces, 1);
  assert.equal(r.ikiMedianMs, 300);
});

test('soft keyboard: backspace inside a word being composed is a deletion', () => {
  const g = rig('The');
  g.phone(0, 'insertCompositionText', 'T', 'T');
  g.phone(300, 'insertCompositionText', 'Th', 'Th');
  g.phone(600, 'insertCompositionText', 'Thw', 'Thw');
  g.phone(900, 'insertCompositionText', 'Th', 'Th'); // the keyboard resends the shorter word
  g.phone(1200, 'insertCompositionText', 'The', 'The');
  const r = g.s.finish(g.field.value);
  assert.equal(r.events.length, 5);
  assert.equal(r.backspaces, 1);
  assert.equal(r.errors, 0);
  assert.equal(r.ikiMedianMs, 300);
});

test('autocorrect changes are the keyboard\'s, not typing: left out of speed, rhythm and backspaces', () => {
  const g = rig('The cat');
  g.phone(1000, 'insertCompositionText', 'T', 'T');
  g.phone(1300, 'insertCompositionText', 'Te', 'Te');
  g.phone(1600, 'insertCompositionText', 'Teh', 'Teh');
  // One press of the space bar: the keyboard swaps "Teh" for "The", then adds the space.
  g.at(1900); g.s.handleKeydown({ key: 'Unidentified', keyCode: 229 });
  g.change(1905, 'insertCompositionText', 'The', 'The');
  g.change(1905, 'insertText', ' ', 'The ');
  g.phone(2200, 'insertCompositionText', 'c', 'The c');
  g.phone(2500, 'insertCompositionText', 'ca', 'The ca');
  g.phone(2800, 'insertCompositionText', 'cat', 'The cat');
  const r = g.s.finish(g.field.value);
  assert.equal(r.autoChars, 2);
  assert.equal(r.events.filter((e) => e.source === 'auto').length, 4); // 2 removed, 2 added
  assert.equal(r.backspaces, 0);
  assert.equal(r.errors, 0);
  assert.equal(r.correctChars, 5); // 7 matching, minus the 2 the keyboard wrote
  close(r.durationS, 1.8);
  close(r.charsPerMin, (4 / 1.8) * 60);
  assert.equal(r.ikiMedianMs, 300);
  assert.equal(r.ok, true);
});

test('a one-letter change by a tapped suggestion or autocorrect is the keyboard\'s, not a key press', () => {
  const g = rig('The cat');
  g.type('The ca', 0, 300); // keys at 0 .. 1500
  g.change(1800, 'insertReplacementText', 'cat', 'The cat'); // the suggestion "cat" tapped: no keydown
  const r = g.s.finish(g.field.value);
  assert.equal(r.events[r.events.length - 1].source, 'auto');
  assert.equal(r.autoChars, 1);
  assert.equal(r.correctChars, 6);
  close(r.durationS, 1.5); // the clock stops at the last key the person pressed
  close(r.charsPerMin, (5 / 1.5) * 60);
  assert.equal(r.errors, 0);
});

// Safari ends a composition (an input method, or a dead key such as Option+E on a Mac)
// by taking the word out of the box (deleteCompositionText) and putting the final word
// in (insertFromComposition); Chrome and Firefox do neither. Seen in WebKit bug 166889.
const safariCat = (g, withTarget = true) => {
  g.type('The ', 0, 300); // desktop keys at 0, 300, 600, 900
  g.phone(1195, 'insertCompositionText', 'c', 'The c', withTarget); // beforeinput at 1200
  g.phone(1495, 'insertCompositionText', 'ca', 'The ca', withTarget);
  g.phone(1795, 'insertCompositionText', 'cat', 'The cat', withTarget);
  g.change(1810, 'deleteCompositionText', null, 'The ', withTarget);
  g.change(1812, 'insertFromComposition', 'cat', 'The cat', withTarget);
};

test('Safari: a word taken out and put back as composing ends is counted once, with no backspace', () => {
  const g = rig('The cat');
  safariCat(g);
  const r = g.s.finish(g.field.value);
  assert.equal(r.events.length, 7, 'one event per character typed, none for the take-out and put-back');
  assert.ok(r.events.every((e) => e.type === 'insert' && e.source === 'key'));
  assert.equal(r.backspaces, 0);
  assert.equal(r.autoChars, 0);
  assert.equal(r.correctChars, 7);
  close(r.durationS, 1.8);
  assert.equal(r.ikiMedianMs, 300);
  close(r.ikiCvPct, 0); // no near-0 ms gaps from the take-out and put-back
  // The same events with no text box attached.
  const g2 = rig('The cat');
  safariCat(g2, false);
  const r2 = g2.s.finish('The cat');
  assert.equal(r2.events.length, 7);
  assert.equal(r2.backspaces, 0);
  assert.equal(r2.autoChars, 0);
});

test('Safari: a composed letter taken out and not put back still counts as a deletion', () => {
  const g = rig('ab');
  g.key('a', 0);
  g.phone(295, 'insertCompositionText', 'x', 'ax'); // a wrong letter, still being composed (300)
  g.phone(595, 'deleteCompositionText', null, 'a'); // Backspace empties the word being composed (600)
  g.key('b', 900);
  const r = g.s.finish(g.field.value);
  assert.deepEqual(r.events.map((e) => [e.t, e.type, e.source]),
    [[0, 'insert', 'key'], [300, 'insert', 'key'], [600, 'delete', 'key'], [900, 'insert', 'key']]);
  assert.equal(r.backspaces, 1);
  assert.equal(r.errors, 0);
  // and when the test is finished straight after it
  const g2 = rig('a');
  g2.key('a', 0);
  g2.phone(295, 'insertCompositionText', 'x', 'ax');
  g2.phone(595, 'deleteCompositionText', null, 'a');
  const r2 = g2.s.finish(g2.field.value);
  assert.deepEqual(r2.events.map((e) => e.type), ['insert', 'insert', 'delete']);
  assert.equal(r2.backspaces, 1);
});

test('a stale desktop keydown is not used for a later phone-style input', () => {
  const g = rig('ab');
  g.at(100); g.s.handleKeydown({ key: 'a', keyCode: 65 }); // no input followed (box full, say)
  g.phone(5000, 'insertText', 'a', 'a');
  g.at(5200); g.s.handleKeydown({ key: 'ArrowLeft', keyCode: 37 });
  g.change(5400, 'insertText', 'b', 'ab'); // no keydown of its own
  const r = g.s.finish(g.field.value);
  assert.deepEqual(r.events.map((e) => e.t), [5005, 5400]);
});

test('browsers without beforeinput: keydown time on desktop, input time on phones', () => {
  const g = rig('ab');
  g.at(100); g.s.handleKeydown({ key: 'a', keyCode: 65 });
  g.field.value = 'a';
  g.at(104); g.s.handleInput({ inputType: 'insertText', data: 'a', target: g.field });
  g.at(500); g.s.handleKeydown({ key: 'Unidentified', keyCode: 229 });
  g.field.value = 'ab';
  g.at(507); g.s.handleInput({ inputType: 'insertText', data: 'b', target: g.field });
  const r = g.s.finish(g.field.value);
  assert.deepEqual(r.events.map((e) => e.t), [100, 507]);
  assert.equal(r.errors, 0);
});

test('with no clock given, the session uses the browser clock, or Date.now when there is none', () => {
  const typeA = (s) => {
    const field = { value: '' };
    s.handleBeforeInput({ inputType: 'insertText', data: 'a', target: field });
    field.value = 'a';
    s.handleInput({ inputType: 'insertText', data: 'a', target: field });
    return s.finish('a').events[0].t;
  };
  assert.ok(Number.isFinite(typeA(createTypingSession('a'))));
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  try {
    Object.defineProperty(globalThis, 'performance', { value: undefined, configurable: true, writable: true });
    const t = typeA(createTypingSession('a', null));
    assert.ok(Math.abs(t - Date.now()) < 60000, `Date.now fallback, got ${t}`);
  } finally {
    Object.defineProperty(globalThis, 'performance', saved);
  }
});

test('Ctrl shortcuts give no key timing; AltGr characters (Ctrl+Alt on Windows) do', () => {
  const g = rig('a@');
  g.at(0); g.s.handleKeydown({ key: 'z', keyCode: 90, ctrlKey: true }); // a shortcut, not typing
  g.change(800, 'insertText', 'a', 'a'); // arrives with no keydown of its own
  g.at(1000); g.s.handleKeydown({ key: '@', keyCode: 50, ctrlKey: true, altKey: true });
  g.change(1003, 'insertText', '@', 'a@');
  const r = g.s.finish(g.field.value);
  assert.deepEqual(r.events.map((e) => e.t), [800, 1000]);
});

// ---------- empty input and malformed rows ----------
test('empty input: no crash, a reason for the person, nothing timed', () => {
  const s = createTypingSession(PASSAGES[0]);
  const r = s.finish('');
  assert.equal(r.ok, false);
  assert.ok(typeof r.reason === 'string' && r.reason.length > 10);
  nan(r.durationS, 'durationS'); nan(r.charsPerMin, 'charsPerMin');
  nan(r.ikiMedianMs, 'ikiMedianMs'); nan(r.ikiIqrMs, 'ikiIqrMs'); nan(r.ikiCvPct, 'ikiCvPct');
  assert.equal(r.pausesOver2s, 0);
  assert.equal(r.backspaces, 0);
  assert.equal(r.errors, [...PASSAGES[0]].length);
  assert.equal(r.accuracyPct, 0);
  assert.deepEqual(r.events, []);
});

test('typingMetrics with nothing at all returns NaN, not an exception', () => {
  const r = typingMetrics(undefined, undefined, undefined);
  assert.equal(r.errors, 0);
  nan(r.accuracyPct, 'accuracy of empty against empty');
  nan(r.durationS); nan(r.charsPerMin);
  const r2 = typingMetrics([], 'abc', '');
  assert.equal(r2.errors, 3);
  assert.equal(r2.accuracyPct, 0);
});

test('one keystroke: zero duration, no speed, no rhythm', () => {
  const r = typingMetrics([{ t: 5, type: 'insert' }], 'a', 'a');
  assert.equal(r.durationS, 0);
  nan(r.charsPerMin); nan(r.ikiMedianMs); nan(r.ikiCvPct);
  assert.equal(r.errors, 0);
  assert.equal(r.accuracyPct, 100);
});

test('malformed rows are skipped and rows out of order are sorted', () => {
  const rows = [null, 'x', 7, { t: NaN, type: 'insert' }, { t: 10, type: 'jump' }, { t: 20 },
    { type: 'insert' }, { t: 30, type: 'insert', source: 'robot' },
    { t: 400, type: 'insert' }, { t: 0, type: 'insert' }, { t: 200, type: 'insert' }];
  const r = typingMetrics(rows, 'abc', 'abc');
  close(r.durationS, 0.4);
  assert.equal(r.ikiMedianMs, 200);
  assert.equal(r.ikiIqrMs, 0);
  close(r.charsPerMin, (2 / 0.4) * 60);
});

test('session handlers ignore junk events without throwing', () => {
  const s = createTypingSession('ab', { now: () => 1 });
  for (const e of [undefined, null, {}, { target: null }, { inputType: 5, data: 9 }, { key: 3 }]) {
    s.handleKeydown(e); s.handleBeforeInput(e); s.handleInput(e);
  }
  const r = s.finish('');
  assert.equal(r.ok, false);
});

test('no sentence to copy gives a reason, not an exception', () => {
  const r = createTypingSession(undefined).finish('abc');
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 10);
});

test('odd inputs (an object with no prototype, a number) never throw', () => {
  const odd = Object.create(null); // String() of this throws
  assert.doesNotThrow(() => typingMetrics([], odd, odd));
  assert.equal(typingMetrics([], odd, 'ab').errors, 2, 'an object counts as no text');
  assert.equal(editDistance(12, '12'), 0, 'a number counts as written');
  const r = createTypingSession(odd).finish('abc');
  assert.equal(r.ok, false);
  assert.ok(r.reason.length > 10);
});

test('extra and missing characters: errors, accuracy and correct characters', () => {
  const ev = [0, 100, 200, 300, 400, 500].map((t) => ({ t, type: 'insert' }));
  const extra = typingMetrics(ev, 'abc', 'abcxyz');
  assert.equal(extra.errors, 3);
  assert.equal(extra.accuracyPct, 50); // 3 errors out of the longer string's 6
  assert.equal(extra.correctChars, 3);
  const missing = typingMetrics(ev.slice(0, 2), 'abcd', 'ab');
  assert.equal(missing.errors, 2);
  assert.equal(missing.accuracyPct, 50);
  assert.equal(missing.correctChars, 2);
});

test('swapped letters: two errors, and the letters that still line up count as correct', () => {
  const ev = [0, 100, 200].map((t) => ({ t, type: 'insert' }));
  // "teh" for "the": two edits either way; the alignment keeping t and e beats two swaps.
  const r = typingMetrics(ev, 'the', 'teh');
  assert.equal(r.errors, 2);
  assert.equal(r.correctChars, 2);
  const r2 = typingMetrics(ev.slice(0, 2), 'ba', 'ab');
  assert.equal(r2.errors, 2);
  assert.equal(r2.correctChars, 1);
});

test('a letter that still lines up counts as correct, with the stray letter in front or behind', () => {
  const ev = [0, 100].map((t) => ({ t, type: 'insert' }));
  // "ab" for "ca": the c missed, a b added; the a still lines up (two swaps would keep none)
  const r = typingMetrics(ev, 'ca', 'ab');
  assert.equal(r.errors, 2);
  assert.equal(r.correctChars, 1);
  // "ab" for "bc": an extra a in front, the c missing; the b still lines up
  const r2 = typingMetrics(ev, 'bc', 'ab');
  assert.equal(r2.errors, 2);
  assert.equal(r2.correctChars, 1);
});

test('a space or line break at either end is not an error', () => {
  const ev = [{ t: 0, type: 'insert' }, { t: 100, type: 'insert' }];
  assert.equal(typingMetrics(ev, 'The cat', ' The cat \n').errors, 0);
});

test('an accent typed as a separate mark matches the same letter written as one character', () => {
  const ev = [0, 100, 200, 300].map((t) => ({ t, type: 'insert' }));
  assert.equal(typingMetrics(ev, 'café', 'café').errors, 0);
});

test('reset() starts over: no events and no text left', () => {
  const g = rig('ab');
  g.type('ab', 0, 200);
  g.s.reset();
  const r = g.s.finish(); // no text given: the session must not remember "ab"
  assert.deepEqual(r.events, []);
  assert.equal(r.errors, 2);
});

test('finish() with no text uses the box as last seen', () => {
  const g = rig('The cat');
  g.type('The cat', 0, 200);
  assert.equal(g.s.finish().errors, 0);
});

// ---------- paste ----------
test('pasted sentence: flagged, one event per pasted character, nothing counted as typing', () => {
  const target = PASSAGES[1];
  const n = [...target].length;
  const g = rig(target);
  g.paste(target, 1000);
  const r = g.s.finish(g.field.value);
  assert.equal(r.ok, false);
  assert.match(r.reason, /past/i);
  assert.equal(r.pasted, true);
  assert.equal(r.pastedChars, n);
  assert.equal(r.events.length, n);
  assert.ok(r.events.every((e) => e.source === 'paste' && e.type === 'insert'));
  assert.equal(r.correctChars, 0);
  nan(r.charsPerMin); nan(r.durationS); nan(r.ikiMedianMs);
  assert.equal(r.backspaces, 0);
});

test('half typed, half pasted: only the typed half counts', () => {
  const g = rig('The cat sat');
  g.type('The ', 0, 200); // 0 .. 600
  g.paste('cat sat', 800);
  const r = g.s.finish(g.field.value);
  assert.equal(r.ok, false);
  assert.equal(r.pastedChars, 7);
  assert.equal(r.correctChars, 4); // would be 11 if the paste counted
  close(r.durationS, 0.6);
  close(r.charsPerMin, (3 / 0.6) * 60);
});

test('the gap around a paste is not a typing gap', () => {
  const g = rig('The cat sat');
  g.type('The', 0, 200); // 0, 200, 400
  g.paste(' cat', 600);
  g.type(' sat', 800, 200); // 800 .. 1400
  const r = g.s.finish(g.field.value);
  assert.equal(r.ikiMedianMs, 200);
  assert.equal(r.ikiIqrMs, 0);
  close(r.ikiCvPct, 0); // the 400 ms from "e" to " " spans the paste and is left out
  assert.equal(r.pastedChars, 4);
});

test('a paste stays flagged after the box is cleared by hand, so the reason asks for a fresh start', () => {
  const g = rig('abc');
  g.paste('abc', 0);
  g.at(500); g.s.handleKeydown({ key: 'Backspace', keyCode: 8 });
  g.change(503, 'deleteContentBackward', null, ''); // all of it selected and deleted
  g.type('abc', 1000, 200);
  const r = g.s.finish(g.field.value);
  assert.equal(r.ok, false);
  assert.match(r.reason, /again/i, 'clearing the box does not clear the paste; only starting again does');
  g.s.reset();
  g.field.value = '';
  g.type('abc', 3000, 200);
  const r2 = g.s.finish(g.field.value);
  assert.equal(r2.ok, true);
  assert.equal(r2.pasted, false);
});

test('a very long paste is flagged without one event per pasted character', () => {
  const g = rig(PASSAGES[0]);
  g.type('The ', 0, 200);
  g.paste('x'.repeat(200000), 1000);
  g.at(2000); g.s.handleKeydown({ key: 'Backspace', keyCode: 8 });
  g.change(2003, 'deleteContentBackward', null, ''); // all of it selected and deleted at once
  g.type(PASSAGES[0], 3000, 200);
  const r = g.s.finish(g.field.value);
  assert.equal(r.pasted, true);
  assert.equal(r.ok, false);
  assert.ok(r.events.length < 10000, `${r.events.length} events kept for a 200,000-character paste`);
  assert.ok(r.pastedChars > 0);
  assert.equal(r.backspaces, 1);
  assert.equal(r.errors, 0);
});

test('paste is flagged even when the browser gives no text box or data, and drop counts as paste', () => {
  const g = rig('abc');
  g.paste('abc', 0, { withTarget: false, data: null });
  assert.equal(g.s.finish('abc').pasted, true);
  const g2 = rig('abc');
  g2.paste('abc', 0, { inputType: 'insertFromDrop' });
  const r2 = g2.s.finish(g2.field.value);
  assert.equal(r2.pasted, true);
  assert.equal(r2.pastedChars, 3);
});

// ---------- privacy ----------
test('the typed text is kept nowhere but memory: events and results hold no text', () => {
  const g = rig(PASSAGES[0]);
  g.type(PASSAGES[0], 0, 180);
  const r = g.s.finish(g.field.value);
  const json = JSON.stringify(r);
  for (const word of PASSAGES[0].split(' ').filter((w) => w.length >= 4)) {
    assert.ok(!json.includes(word), `"${word}" leaked into the result`);
  }
  for (const e of r.events) {
    for (const k of Object.keys(e)) assert.ok(['t', 'type', 'source', 'group', 'repeat'].includes(k), k);
  }
  // finish() dropped the text: asked again with no text, nothing of the sentence is left.
  assert.equal(g.s.finish().errors, [...PASSAGES[0]].length);
  g.s.reset();
  assert.deepEqual(g.s.finish('').events, []);
});

test('finish() also forgets a beforeinput that never got its input event', () => {
  const s = createTypingSession('ab', { now: () => 1 });
  s.handleBeforeInput({ inputType: 'insertFromPaste', data: 'ab', target: { value: '' } });
  s.finish('');
  s.handleInput({}); // a stray input event afterwards must not bring the paste back
  assert.equal(s.finish('').pasted, false);
});

test('the module never stores, sends or logs anything', () => {
  const src = readFileSync(new URL('../app/js/home/typing.js', import.meta.url), 'utf8');
  for (const bad of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'console.', 'document.', 'window.']) {
    assert.ok(!src.includes(bad), `typing.js uses ${bad}`);
  }
});
