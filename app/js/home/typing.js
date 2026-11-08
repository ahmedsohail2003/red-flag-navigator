// Copy-typing test for the hand region: the person types a short sentence shown on
// screen, and we measure speed and rhythm. Pure functions, no DOM at import time:
// runs in the browser and in Node (tests/home-typing.test.mjs).
//
// Why typing: in nQiALS (Acien et al. 2024, Sci Rep) a copy task on people's own phones
// separated ALS from controls, and it kept key timing only, never the text. Their custom
// keyboard also saw how long each key was held. A web page cannot see that reliably on
// phone keyboards (on Android, keydown says "Unidentified", keyCode 229), so we use what
// browsers report reliably: the moment each character goes in or comes out.
//
// Wiring, for the view: a plain <textarea> with autocomplete, autocorrect and spellcheck
// off, empty at the start. Call handleKeydown, handleBeforeInput and handleInput from its
// keydown, beforeinput and input listeners, then finish(textarea.value) when the person
// is done. Characters are counted from the change in the box's text, so phone keyboards
// that resend the whole word being typed are not counted twice.
//
// Privacy: events hold times and kinds, never characters. The typed text stays in this
// session's memory until finish() or reset(); nothing here saves, sends or prints it.

const PAUSE_MS = 2000; // a gap over 2 s between key presses counts as a pause
const LONG_PAUSE_MS = 5000; // a gap over 5 s is left out of rhythm (see typingMetrics)

// Six everyday sentences of 48 or 49 characters. No punctuation, because many phone
// keyboards keep it on a second layer; the capital first letter is what phone keyboards
// type on their own at the start of a box.
export const PASSAGES = Object.freeze([
  'The garden looks bright after a warm summer rain',
  'Please bring a cup of tea and a book to the table',
  'The old dog sleeps on a soft blanket by the door',
  'Our friends came over for dinner late last night',
  'We made fresh bread and soup for the whole family',
  'A small bird sings in the tree outside my window',
]);

// ---------- text ----------
// Text as given, a number as written; anything else (missing, an object) counts as
// empty, so odd input cannot make String() throw.
const asText = (s) => (typeof s === 'string' ? s : typeof s === 'number' ? String(s) : '');
// Characters, not UTF-16 units, so an emoji counts once, not twice.
const chars = (s) => Array.from(asText(s));
// Compare the way a person would: same Unicode form, and a space or line break at either
// end is not an error.
const clean = (s) => asText(s).normalize('NFC').trim();

// Fewest-edits alignment of a against b. edits: the Levenshtein distance. matches:
// characters that line up unchanged; among alignments with the fewest edits, the one with
// the most matches wins. longer: the length of the longer text. The answer is the same
// either way round, so the two rows kept are as long as the shorter text, and nothing is
// made per cell: a pasted page against a sentence takes time in proportion to the page,
// but no table of page times sentence.
function align(a, b) {
  let x = chars(a);
  let y = chars(b);
  if (y.length > x.length) { const s = x; x = y; y = s; }
  const n = y.length;
  let d = new Int32Array(n + 1); // edits from the first i characters of x to the first j of y
  let m = new Int32Array(n + 1); // matches in that alignment
  let d2 = new Int32Array(n + 1);
  let m2 = new Int32Array(n + 1);
  for (let j = 0; j <= n; j++) d[j] = j;
  for (let i = 1; i <= x.length; i++) {
    const xi = x[i - 1];
    d2[0] = i;
    m2[0] = 0;
    for (let j = 1; j <= n; j++) {
      const same = xi === y[j - 1];
      let bestD = d[j - 1] + (same ? 0 : 1); // the two characters line up (match or swap)
      let bestM = m[j - 1] + (same ? 1 : 0);
      // or a character that is only in x, or only in y
      const upD = d[j] + 1;
      if (upD < bestD || (upD === bestD && m[j] > bestM)) { bestD = upD; bestM = m[j]; }
      const leftD = d2[j - 1] + 1;
      if (leftD < bestD || (leftD === bestD && m2[j - 1] > bestM)) { bestD = leftD; bestM = m2[j - 1]; }
      d2[j] = bestD;
      m2[j] = bestM;
    }
    let s = d; d = d2; d2 = s;
    s = m; m = m2; m2 = s;
  }
  return { edits: d[n], matches: m[n], longer: x.length };
}

// Levenshtein distance: the fewest single-character insertions, deletions and
// substitutions that turn a into b. Missing text counts as empty. Time grows with the
// two lengths multiplied, so keep one of them short (a sentence against what was typed).
export function editDistance(a, b) { return align(a, b).edits; }

// ---------- small statistics ----------
function mean(xs) { return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN; }
// Sample SD (divide by n - 1), as in hometests.js.
function sd(xs) {
  if (xs.length < 2) return NaN;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1));
}
// Quantile of sorted values by straight-line interpolation (the usual default, R type 7),
// so the median of an even count is the mean of the middle two.
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

// ---------- events ----------
// An event: { t (ms), type: 'insert' | 'delete', source, group, repeat? }, one per character
// (at most 1000 for one action, see MAX_CHARS_PER_ACTION).
// source 'key': the person typed or deleted it. 'paste': paste or drag-and-drop.
// 'auto': the keyboard or browser changed the text on its own (autocorrect, a tapped
// suggestion, an input method settling a word) or several characters at once (undo).
// group: characters changed by one action share it. repeat: true when a held key
// repeated by itself. Rows without source count as 'key'.
const TYPES = new Set(['insert', 'delete']);
const SOURCES = new Set(['key', 'paste', 'auto']);

function validEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .filter((e) => e && typeof e === 'object' && Number.isFinite(e.t) && TYPES.has(e.type)
      && (e.source === undefined || SOURCES.has(e.source)))
    .map((e) => ({ t: e.t, type: e.type, source: e.source ?? 'key', group: e.group, repeat: e.repeat === true }))
    .sort((a, b) => a.t - b.t); // stable: rows at the same moment keep their order
}

// One action is what one key press, paste or keyboard change did: rows from the same
// group and moment. Rows without a group (made by hand) are grouped by moment alone.
function toActions(evs) {
  const out = [];
  for (const e of evs) {
    const id = `${Number.isFinite(e.group) ? e.group : ''}|${e.t}|${e.source}`;
    let a = out[out.length - 1];
    if (!a || a.id !== id) {
      a = { id, t: e.t, source: e.source, repeat: e.repeat, inserts: 0, deletes: 0 };
      out.push(a);
    }
    if (e.type === 'insert') a.inserts += 1; else a.deletes += 1;
  }
  return out;
}

// ---------- the numbers ----------
// events: from a session (or built by hand); target: the sentence shown; finalText: what
// is in the box at the end.
export function typingMetrics(events, target, finalText) {
  const evs = validEvents(events);
  const actions = toActions(evs);
  const keys = actions.filter((a) => a.source === 'key');

  // Time runs from the first key press to the last. The lead-in, spent reading the
  // sentence before the first key, is not part of it.
  const durationS = keys.length ? (keys[keys.length - 1].t - keys[0].t) / 1000 : NaN;

  // Rhythm: the gaps from one key press to the next (inter-key intervals). Ignored when
  // computing rhythm: the lead-in before the first keystroke (it is not a gap between
  // keys), gaps longer than 5 s (the person stopped, which says nothing about the hand's
  // rhythm), repeats of a held key, and any gap with a paste or keyboard change inside it.
  // Long gaps still count as pauses below, and as time in the speed.
  const gaps = [];
  let prev = null;
  for (const a of actions) {
    if (a.source !== 'key') { prev = null; continue; }
    if (a.repeat) continue;
    if (prev !== null) gaps.push(a.t - prev);
    prev = a.t;
  }
  const rhythm = gaps.filter((g) => g <= LONG_PAUSE_MS).sort((p, q) => p - q);
  const rhythmMean = mean(rhythm);

  const shown = clean(target);
  const typed = clean(finalText);
  const { edits, matches, longer } = align(typed, shown);
  const pastedChars = evs.filter((e) => e.source === 'paste' && e.type === 'insert').length;
  const autoChars = evs.filter((e) => e.source === 'auto' && e.type === 'insert').length;
  // Pasted or keyboard-written characters can match the sentence, but the person did not
  // type them. (If they were later deleted this undercounts; the result is flagged anyway.)
  const correctChars = Math.max(0, matches - pastedChars - autoChars);

  return {
    durationS,
    // Correct characters per minute. The first key starts the clock, so its own time is
    // not measured: count one character less (the usual text-entry formula, MacKenzie).
    charsPerMin: durationS > 0 ? (Math.max(0, correctChars - 1) / durationS) * 60 : NaN,
    ikiMedianMs: quantile(rhythm, 0.5),
    ikiIqrMs: rhythm.length ? quantile(rhythm, 0.75) - quantile(rhythm, 0.25) : NaN,
    ikiCvPct: rhythmMean > 0 ? (sd(rhythm) / rhythmMean) * 100 : NaN,
    pausesOver2s: gaps.filter((g) => g > PAUSE_MS).length,
    longPauses: gaps.filter((g) => g > LONG_PAUSE_MS).length,
    backspaces: keys.filter((a) => a.deletes > 0).length, // presses that deleted something
    errors: edits,
    // 100 minus the minimum-string-distance error rate: errors over the longer of the two
    // texts, so it stays between 0 and 100 (Soukoreff and MacKenzie).
    accuracyPct: longer ? (1 - edits / longer) * 100 : NaN,
    correctChars,
    pasted: evs.some((e) => e.source === 'paste'),
    pastedChars,
    autoChars,
  };
}

// ---------- the session (browser events in, events out) ----------
const PASTE_TYPES = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertFromYank']);
// Changes the keyboard makes on its own, never one key press: autocorrect or a tapped
// suggestion (insertReplacementText), and Safari's input methods settling the word being
// composed (insertFromComposition, deleteByComposition).
const KEYBOARD_TYPES = new Set(['insertReplacementText', 'insertFromComposition', 'deleteByComposition']);
// One action records at most this many characters, so pasting or deleting a very long
// text cannot fill the memory with events (a sentence here is under 60). pastedChars
// then counts at most this many per paste; the paste is flagged either way.
const MAX_CHARS_PER_ACTION = 1000;

const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now() : Date.now());

// The box's text as characters, or null when the event has no text box.
const boxText = (e) => (e.target && typeof e.target.value === 'string' ? chars(e.target.value) : null);

// Characters removed and added between two versions of the text (same start and end
// trimmed off, the rest is the change).
function textChange(before, after) {
  let p = 0;
  while (p < before.length && p < after.length && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p
    && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  return { removed: before.length - p - s, added: after.length - p - s };
}

// Who made a change: one character in or out is one key press; several at once is the
// keyboard (autocorrect, a suggestion) unless it was a delete key (a word or a selection).
// Typing over a selected word also lands in 'auto'; that is rare in a copy task.
function sourceOf(inputType, removed, added) {
  if (PASTE_TYPES.has(inputType)) return 'paste';
  if (KEYBOARD_TYPES.has(inputType)) return 'auto';
  if (inputType.startsWith('delete') && added === 0) return 'key';
  return removed + added === 1 ? 'key' : 'auto';
}

// Keys that put a character in or take one out, so their keydown is the press time.
function isTypingKey(e) {
  const k = e.key;
  if (k === 'Backspace' || k === 'Delete' || k === 'Enter') return true;
  if (typeof k !== 'string' || chars(k).length !== 1) return false; // Shift, arrows, Dead ...
  // Ctrl or Cmd with a letter is a shortcut; Ctrl+Alt is AltGr on Windows, which types.
  return !((e.ctrlKey || e.metaKey) && !e.altKey);
}

// target: the sentence shown. now: a clock in ms (tests pass their own).
export function createTypingSession(target, options = {}) {
  const now = options && typeof options.now === 'function' ? options.now : defaultNow;
  const sentence = clean(target);
  let events, group, keyTime, keyRepeat, pending, text, composing, held;

  function reset() {
    events = [];
    group = 0;
    keyTime = null; // desktop: when the key that will cause the next input went down
    keyRepeat = false;
    pending = null; // what beforeinput saw, waiting for its input event
    text = []; // the box's text as last seen, in memory only
    composing = 0; // fallback only: length of the word a phone keyboard is composing
    held = null; // Safari: the box just before it took out the word being composed
  }
  reset();

  function record(t, removed, added, source, repeat) {
    if (!(removed > 0 || added > 0)) return;
    group += 1;
    const extra = repeat && source === 'key' ? { repeat: true } : {};
    const out = Math.min(removed, MAX_CHARS_PER_ACTION);
    const put = Math.min(added, MAX_CHARS_PER_ACTION);
    for (let i = 0; i < out; i++) events.push({ t, type: 'delete', source, group, ...extra });
    for (let i = 0; i < put; i++) events.push({ t, type: 'insert', source, group, ...extra });
  }

  // A held take-out that no final word followed (the composition was cancelled or
  // backspaced away): record it as the deletion it was.
  function flushHeld(current) {
    if (!held) return;
    const { removed, added } = textChange(held.before, current);
    record(held.t, removed, added, sourceOf('deleteCompositionText', removed, added), false);
    held = null;
  }

  function handleKeydown(e) {
    if (!e || typeof e !== 'object') return;
    // Phone keyboards and input methods give no usable key (229, "Unidentified",
    // "Process"): their timing comes from beforeinput instead. Keys that type nothing
    // (Shift, arrows, shortcuts) clear the time so a later input cannot borrow it.
    if (e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process' || !isTypingKey(e)) {
      keyTime = null;
      keyRepeat = false;
      return;
    }
    keyTime = now();
    keyRepeat = e.repeat === true;
  }

  // Fires before the box changes: note the time and the text as it was.
  function handleBeforeInput(e) {
    if (!e || typeof e !== 'object') return;
    pending = {
      t: keyTime ?? now(),
      repeat: keyTime !== null && keyRepeat,
      inputType: typeof e.inputType === 'string' ? e.inputType : '',
      data: typeof e.data === 'string' ? e.data : null,
      before: boxText(e),
    };
    keyTime = null;
    keyRepeat = false;
  }

  // Fires after the box changed: count what went in and out.
  function handleInput(e) {
    if (!e || typeof e !== 'object') return;
    const p = pending;
    pending = null;
    const t = p ? p.t : (keyTime ?? now()); // browsers without beforeinput: keydown or now
    const repeat = p ? p.repeat : keyTime !== null && keyRepeat;
    keyTime = null;
    keyRepeat = false;
    const inputType = typeof e.inputType === 'string' && e.inputType ? e.inputType : (p ? p.inputType : '');
    const data = typeof e.data === 'string' ? e.data : (p ? p.data : null);
    const composingType = inputType === 'insertCompositionText' || inputType === 'deleteCompositionText'
      || inputType === 'insertFromComposition';
    if (!composingType) composing = 0;

    const after = boxText(e);
    if (after) {
      let before = (p && p.before) || text;
      text = after;
      if (inputType === 'deleteCompositionText') {
        // Safari, as composing ends, takes the word out of the box and then puts the
        // final word in (insertFromComposition). Hold the take-out and count the two as
        // one change, so a word is not counted as deleted and typed again.
        if (!held) held = { t, before };
        return;
      }
      if (held && inputType === 'insertFromComposition') {
        before = held.before;
        held = null;
      } else flushHeld(before);
      const { removed, added } = textChange(before, after);
      record(t, removed, added, sourceOf(inputType, removed, added), repeat);
      return;
    }
    // No text box on the event: go by what the event says.
    flushHeld(text);
    const n = data === null ? 0 : chars(data).length;
    if (PASTE_TYPES.has(inputType)) {
      record(t, 0, Math.max(1, n), 'paste', false); // at least one, so a paste is always flagged
    } else if (inputType === 'deleteCompositionText') {
      // Safari takes the word out just before insertFromComposition puts it in: wait for that.
    } else if (composingType) {
      // Phone keyboards resend the whole word being composed: count only how it grew or
      // shrank. insertFromComposition is Safari's final word, which ends the composing.
      const change = n - composing;
      const settling = inputType === 'insertFromComposition';
      composing = settling ? 0 : n;
      record(t, Math.max(0, -change), Math.max(0, change), Math.abs(change) === 1 && !settling ? 'key' : 'auto', repeat);
    } else if (inputType.startsWith('delete')) {
      // how many went is unknown here; count one
      record(t, 1, 0, KEYBOARD_TYPES.has(inputType) ? 'auto' : 'key', repeat);
    } else if (inputType === 'insertLineBreak' || inputType === 'insertParagraph') {
      record(t, 0, 1, 'key', repeat);
    } else if (inputType.startsWith('insert')) {
      record(t, 0, n, n === 1 && !KEYBOARD_TYPES.has(inputType) ? 'key' : 'auto', repeat);
    }
    // anything else (undo, formatting) changes nothing we can count without the box
  }

  // finalText: the box's text at the end (defaults to the text last seen). Returns the
  // numbers plus the events (times only), with ok: false and a reason when the result
  // should not be saved. The typed text is dropped from memory here.
  function finish(finalText) {
    flushHeld(text);
    const typed = typeof finalText === 'string' ? finalText : text.join('');
    text = [];
    pending = null; // it can hold the box's text or pasted text too
    const metrics = typingMetrics(events, sentence, typed);
    const result = { ok: true, ...metrics, events: events.map((e) => ({ ...e })) };
    let reason = '';
    if (!sentence) reason = 'There is no sentence to copy. Go back and start the typing test again.';
    // A paste stays on record until reset(), so clearing the box by hand is not enough.
    else if (metrics.pasted) reason = 'Pasted text cannot be timed. Start the typing test again and type the sentence yourself.';
    else if (!events.some((e) => e.source === 'key')) reason = 'Nothing was typed yet. Type the sentence shown, then finish the test.';
    else if (!Number.isFinite(metrics.charsPerMin)) reason = 'Too little was typed to time. Type the whole sentence, then finish the test.';
    return reason ? { ...result, ok: false, reason } : result;
  }

  return { handleBeforeInput, handleInput, handleKeydown, finish, reset };
}
