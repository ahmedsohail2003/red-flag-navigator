// Note helper: proposes red flags from the free text of a clinic note.
// Plain keyword rules anyone can read (NOT AI: no model, no network, no training).
// Each suggestion quotes the note word for word (an exact substring, so the quote
// check still holds) and a clinician accepts or dismisses every one. It will miss
// things and it never decides anything; the indicator only counts what is accepted.
import { FINDINGS } from './engine.js';
import { ALEX } from './alex.js';
import { LOOKALIKES } from './lookalikes.js';

// ---------- words that point to a body region ----------
const REGION_WORDS = [
  ['arm', /\b(?:hands?|thumbs?|fingers?|wrists?|forearms?|arms?|shoulders?|elbows?|thenar|hypothenar|interosse\w*|grip|pinch|handwriting|writing|deltoids?|biceps|triceps|palms?|upper limbs?|upper extremit\w*|cervical)\b/gi],
  ['leg', /\b(?:foot|feet|ankles?|legs?|thighs?|calf|calves|knees?|hips?|stairs|toes?|heels?|shins?|quadriceps|quads|hamstrings?|peroneal|lumbar|lower limbs?|lower extremit\w*|gait|walking|walk|running|plantars?|dorsiflexion|curbs?|kerbs?)\b/gi],
  ['bulbar', /\b(?:speech|speak\w*|voice|swallow\w*|tongue|saliva|jaw|palate|mouth|throat|chew\w*|talking)\b/gi],
  ['breathing', /\b(?:breath\w*|air|lying flat|lie flat|pillows?|chest|lungs?|respiratory)\b/gi],
];
// Short heading sentences in structured exam notes ("Upper limbs.") set the region
// for the sentences under them that name no body part.
const HEADINGS = [
  [/^(?:upper limbs?|upper extremit\w*|arms?)\W*$/i, 'arm'],
  [/^(?:lower limbs?|lower extremit\w*|legs?|gait)\W*$/i, 'leg'],
  [/^(?:cranial nerves?|bulbar|speech|swallow\w*)\W*$/i, 'bulbar'],
  [/^(?:respiratory|breathing|chest)\W*$/i, 'breathing'],
];

// ---------- the rules: one line of words per red flag ----------
const TWITCH = /\b(?:fascicul\w*|twitch\w*|flicker\w*|rippl\w*|quiver\w*)/gi;
const WASTE_WORD = /\b(?:wast(?:ing|ed)|atroph\w*|flatter|flattening|thinning|hollowing)\b/gi;
const MEDIAN = /\b(?:thenar|thumbs?)\b/i;
const ULNAR = /\b(?:first dorsal interosse\w*|1st dorsal interosse\w*|dorsal interosse\w*|FDI|between (?:the )?thumb and (?:the )?index(?: finger)?|(?:first )?web space)\b/i;
const SPARED = /\bhypothenar\b[^.]{0,60}?\b(?:spar\w*|preserv\w*|normal|intact)|\b(?:spar\w*|preserv\w*)\b[^.]{0,60}?\bhypothenar\b/i;
const TEST_WORD = /\b(?:nerve conduction(?: stud(?:y|ies))?|conduction stud(?:y|ies)|NCS|NCV|nerve stud(?:y|ies)|wrist stud(?:y|ies)|EMG|electromyogra\w*|MRI|CT|scans?|ultrasound|x-?rays?|imaging|blood tests?|bloods)\b/gi;
const NORMAL_RESULT = /\b(?:normal|unremarkable|no (?:nerve root )?compression|no slowing|no abnormalit\w*|no cause)\b/i;

const all = (re, s) => { re.lastIndex = 0; return [...s.matchAll(re)].map((m) => ({ index: m.index, length: m[0].length, text: m[0] })); };

// id, re (global), and optional: need (must also be in the sentence), unless (skip the
// sentence), noNeg (the sign is itself about a normal result), find (custom matcher).
export const HELPER_RULES = [
  { id: 'split_hand', find: (s) => (MEDIAN.test(s) && ULNAR.test(s) && SPARED.test(s) ? all(WASTE_WORD, s) : []),
    words: 'wasting of the thumb muscles and first dorsal interosseous (or between thumb and index finger) with the little-finger side spared' },
  { id: 'two_territory_wasting', find: (s) => (MEDIAN.test(s) && ULNAR.test(s) && !SPARED.test(s) ? all(WASTE_WORD, s) : []),
    words: 'wasting of the thumb muscles and first dorsal interosseous (or between thumb and index finger)' },
  { id: 'umn_signs',
    re: /\b(?:reflex\w*|jerks?)\b[^.;:]{0,30}?\bbrisk\b|\bbrisk\b[^.;:]{0,30}?\b(?:reflex\w*|jerks?)\b|\bhyper-?reflexi\w*|\bhoffmann?'?s?\b|\bclonus\b|\bbabinski\w*|\b(?:upgoing|up-going|extensor)\s+plantars?\b|\bplantars?\b[^.;:]{0,25}?\b(?:upgoing|up-going|extensor)\b|\bspastic\w*|\b(?:increased|raised|high)\s+tone\b|\btone\b[^.;:]{0,15}?\b(?:increased|raised)\b/gi,
    words: 'brisk reflexes or jerks, Hoffmann, clonus, Babinski, upgoing or extensor plantar, spastic, increased tone' },
  { id: 'mimic_test_normal', noNeg: true,
    find: (s) => {
      if (/\bnot\s+(?:normal|unremarkable)\b/i.test(s)) return [];
      return all(TEST_WORD, s).filter((m) => NORMAL_RESULT.test(s.slice(Math.max(0, m.index - 60), m.index + m.length + 90)));
    },
    words: 'a nerve study, EMG, MRI or scan reported normal, unremarkable or with no compression' },
  // speech and swallowing
  { id: 'dysarthria',
    re: /\bdysarthri\w*|\bslurr\w*|\bslurs?\b|\b(?:slow|slower|slowed|thick|unclear|nasal|strained|effortful|spastic)\s+speech\b|\bspeech\b[^.;:]{0,25}?\b(?:slow|slower|slowed|slurred|thick|unclear|changed|spastic|nasal|effortful|strained)\b|\b(?:trouble|difficulty|problems?)\s+(?:speaking|talking)\b/gi,
    words: 'slurred, slow, thick or changed speech, dysarthria' },
  { id: 'dysphagia',
    re: /\bdysphagi\w*|\b(?:difficulty|trouble|problems?|hard)\s+(?:with\s+)?swallow\w*|\bswallow\w*\b[^.;:]{0,20}?\b(?:difficult\w*|hard|harder|problem\w*|trouble)\b|\b(?:cough\w*|chok\w*|splutter\w*)\b[^.;:]{0,30}?\b(?:drink\w*|eat\w*|swallow\w*|liquids?|fluids?|water|food|meals?)\b|\bfood\s+(?:sticks|sticking|gets stuck)\b/gi,
    words: 'trouble swallowing, coughing or choking when drinking or eating' },
  { id: 'sialorrhoea', re: /\bdrool\w*|\bsialorrh\w*|\bexcess(?:ive)?\s+saliva\b|\bsaliva\b[^.;:]{0,20}?\b(?:excess|more|pool\w*|too much)\b/gi, words: 'drooling, excess saliva' },
  { id: 'hoarseness', re: /\bhoarse\w*|\bcroaky\b|\braspy\b/gi, words: 'hoarse, croaky or raspy voice' },
  { id: 'dysphasia', re: /\bdysphasi\w*|\baphasi\w*|\bword[- ]finding\b|\b(?:trouble|difficulty)\s+finding\s+(?:the\s+)?words\b/gi, words: 'trouble finding words' },
  { id: 'tongue_fasciculations', re: TWITCH, need: /\btongue\b/i, words: 'twitching or fasciculations in a sentence about the tongue' },
  // limbs
  { id: 'fasciculations', re: TWITCH, unless: /\btongue\b/i, words: 'twitching, fasciculations, rippling under the skin' },
  { id: 'wasting',
    re: /\bwast(?:ing|ed)\b|\batroph\w*|\b(?:thinner|thinning|flatter|flattening|hollowing|hollowed|shrunken|shrinking|shrunk)\b|\bloss of (?:muscle )?bulk\b|\b(?:circumference|girth|bulk)\b[^.;:]{0,45}?\b(?:smaller|reduced|decreased|less)\b|\b(?:smaller|reduced|decreased)\s+(?:circumference|girth|bulk)\b/gi,
    words: 'wasting, atrophy, a muscle flatter, thinner or smaller than the other side' },
  { id: 'foot_drop',
    re: /\bfoot[- ]drop\b|\bdrop(?:ped)?[- ]foot\b|\bfoot\b[^.;:]{0,25}?\b(?:catch\w*|drag\w*|slap\w*)|\b(?:catch\w*|drag\w*|slap\w*)\b[^.;:]{0,20}?\b(?:foot|feet|toes?)\b|\btrip(?:s|ping|ped)?\s+(?:over|on)\b|\bhigh[- ]stepping\b|\bunable to walk on (?:his |her |their |the )?heels?\b|\bdorsiflexion\b[^.;:]{0,40}?\b[0-4][+-]?\s*(?:\/|out of)\s*5\b|\bweak\w*\s+(?:ankle\s+)?dorsiflex\w*/gi,
    words: 'foot drop, a foot that catches, drags or slaps, tripping, weak ankle dorsiflexion' },
  { id: 'focal_weakness',
    re: /\bweak(?:ness|er|ened|ening)?\b|\b(?:loss of|reduced|decreased|poor|lost)\s+(?:grip|power|strength)\b|(?<![\d/])\b[0-4][+-]?\s*(?:\/|out of)\s*5\b(?![/\d])|\b(?:legs?|arms?|hands?|foot|feet|limbs?)\b[^.;:]{0,30}?\b(?:felt|feels?|feeling)\s+heavy\b|\bdrop(?:s|ping|ped)\s+(?:things|objects|items|his|her|their)\b/gi,
    words: 'weak, weaker, weakness, a power grade below 5 out of 5, a limb that feels heavy, dropping things' },
  { id: 'falls', re: /\b(?<!(?:the|this|last|next|in)\s)fall(?:s|ing|en)?\b(?!\s+(?:asleep|ill|pregnant))|\bfell\b(?!\s+(?:asleep|ill|pregnant))/gi, words: 'falls, fell, fallen' },
  { id: 'cramp', re: /\b(?<!(?:menstrual|period|stomach|abdominal|tummy)\s)cramp\w*/gi, words: 'cramp, cramps, cramping' },
  { id: 'stiffness', re: /\b(?:muscles?|legs?|arms?|limbs?|hands?|calf|calves|thighs?)\b[^.;:]{0,15}?\bstiff\w*|\bstiff\w*\b[^.;:]{0,15}?\b(?:muscles?|legs?|arms?|limbs?|walking|gait)\b/gi, words: 'stiff muscles or limbs' },
  { id: 'stairs', re: /\b(?:difficulty|trouble|struggl\w*|hard|harder)\b[^.;:]{0,25}?\bstairs\b|\bstairs\b[^.;:]{0,15}?\b(?:difficult|hard|harder|struggle)\b/gi, words: 'difficulty with stairs' },
  { id: 'ataxia', re: /\bataxi\w*|\bunsteady\b|\bunsteadiness\b|\bpoor balance\b|\boff balance\b/gi, words: 'unsteady, poor balance, ataxia' },
  // breathing and whole body
  { id: 'short_breath',
    re: /\bshort(?:ness)?\s+of\s+(?:breath|air)\b|\bbreathless\w*|\bout of breath\b|\borthopn\w*|\bsleep\w*\s+(?:on|with)\s+(?:two|three|2|3|more|extra)\s+pillows\b|\bcan(?:not|'t)\s+lie\s+flat\b/gi,
    words: 'short of breath or air, breathless, needs extra pillows to lie flat' },
  { id: 'dyspnoea', re: /\bdyspn\w*/gi, words: 'dyspnoea' },
  { id: 'wheeze', re: /\bwheez\w*/gi, words: 'wheeze' },
  { id: 'sleep_problems', re: /\binsomnia\b|\b(?:poor|disturbed|broken)\s+sleep\b|\b(?:trouble|difficulty)\s+sleeping\b/gi, words: 'insomnia, poor sleep' },
  { id: 'weight_loss',
    re: /\bweight loss\b|\b(?:lost|losing|lose|loss of|dropped)\s+(?:about\s+|around\s+|approximately\s+|nearly\s+|almost\s+|over\s+|more than\s+|some\s+)?(?:\d+(?:\.\d+)?\s*(?:kg|kgs|kilos?|kilograms?|lbs?|pounds|stone)\b|weight\b)/gi,
    words: 'weight loss, lost a number of kg or pounds' },
  { id: 'appetite_loss', re: /\b(?:poor|reduced|decreased|loss of)\s+appetite\b|\bappetite\b[^.;:]{0,15}?\b(?:poor|reduced|down|less|gone)\b/gi, words: 'poor or reduced appetite' },
  { id: 'tiredness', re: /\btiredness\b|\bfatigue\b(?!\s+(?:in|of)\s+(?:the|his|her|their)\b)|\b(?:feels?|feeling|felt|always|very|constantly)\s+(?:tired|exhausted|fatigued)\b|\bexhaustion\b/gi,
    unless: /\b(?:put (?:it )?down to|attribut\w*|blamed? (?:it )?on)\b/i, words: 'tiredness, fatigue' },
  { id: 'family_history',
    re: /\bfamily history\b[^.;]{0,40}?\b(?:ALS|MND|motor neurone? disease|amyotrophic|Lou Gehrig\w*)\b|\b(?:mother|father|brother|sister|parent|sibling|aunt|uncle|cousin|grand(?:mother|father|parent)|son|daughter)\b[^.;]{0,30}?\b(?:had|has|with|died|diagnosed)\b[^.;]{0,25}?\b(?:ALS|MND|motor neurone? disease|amyotrophic|Lou Gehrig\w*)\b/gi,
    words: 'a relative with ALS or MND' },
  // thinking and mood
  { id: 'depression', re: /\bdepress(?:ed|ion|ive)\b|\blow mood\b|\bmood\s+(?:is\s+|has been\s+|was\s+)?low\b|\bfeeling down\b|\bhopeless\w*/gi, words: 'low mood, depression' },
  { id: 'confusion', re: /\bconfus(?:ed|ion)\b/gi, words: 'confusion' },
  { id: 'hallucinations', re: /\bhallucinat\w*/gi, words: 'hallucinations' },
  { id: 'emotional_lability', re: /\bemotional(?:ly)?\s+labil\w*|\bpseudobulbar affect\b|\b(?:uncontrollable|inappropriate)\s+(?:laughing|crying|laughter)\b/gi, words: 'emotional lability' },
  // other signs in the published model
  { id: 'constipation', re: /\bconstipat\w*/gi, words: 'constipation' },
  { id: 'urinary_incontinence', re: /\b(?<!(?:faecal|fecal|bowel)\s)(?:urinary\s+)?incontinen\w*|\bbladder\s+leak\w*/gi, words: 'incontinence, bladder leaks' },
  { id: 'nocturia', re: /\bnocturia\b|\b(?:passing|pass|passes)\s+urine\s+at\s+night\b/gi, words: 'nocturia' },
  { id: 'urinary_retention', re: /\burinary retention\b|\b(?:trouble|difficulty)\s+passing\s+urine\b/gi, words: 'urinary retention' },
  { id: 'urinary_frequency', re: /\burinary frequency\b|\b(?:passing urine|urinating)\s+more\s+often\b/gi, words: 'urinary frequency' },
  { id: 'dry_mouth', re: /\bdry mouth\b|\bxerostomia\b/gi, words: 'dry mouth' },
].filter((r) => FINDINGS[r.id]);

// ---------- negation ----------
// A mention is skipped when a negation cue sits shortly before it in the same clause
// ("No numbness or tingling", "denies weakness"), carries over a short list
// ("No weakness, wasting or twitching"), or follows it ("Babinski negative").
const CUE = /\b(?:no|not|without|denies|denied|deny|denying|negative for|free of|absence of|never|nil|nor|normal|unremarkable)\b/gi;
const LIST_CUE = /\b(?:no|not|without|denies|denied|deny|negative for|free of|absence of|nil|nor)\b/i;
const PSEUDO = /\b(?:no longer|not only|no improvement|no better|not improv\w*|not better|no benefit|not help\w*|no further|not respond\w*|no response|no relief|not resolv\w*)\b/gi;
const HARD = /[;:()]|\b(?:but|however|although|though|whereas|except|apart from|aside from|yet|which|who)\b|\band (?:he|she|they|his|her|their)\b/gi;
const POST = /^[^,;:.]{0,24}?\b(?:absent|negative|not (?:present|seen|elicited|found|detected)|none|nil|ruled out)\b/i;
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

function hasCueNear(prefix, maxWords) {
  const clean = prefix.replace(PSEUDO, (m) => '_'.repeat(m.length));
  let last = null;
  CUE.lastIndex = 0;
  for (const m of clean.matchAll(CUE)) last = m;
  if (!last) return false;
  return words(clean.slice(last.index + last[0].length)) <= maxWords;
}

export function isNegated(sentence, start, end) {
  const pre = sentence.slice(0, start);
  let cut = 0;
  HARD.lastIndex = 0;
  for (const m of pre.matchAll(HARD)) cut = m.index + m[0].length;
  const scope = pre.slice(cut);
  const items = scope.split(',');
  const cur = items[items.length - 1];
  if (hasCueNear(cur, 5)) return true;
  // list carry-over: "No weakness, wasting or twitching"
  if (items.length > 1 && words(cur) <= 3) {
    for (let k = items.length - 2, n = 0; k >= 0 && n < 4; k--, n++) {
      const it = items[k].replace(PSEUDO, (m) => '_'.repeat(m.length));
      if (LIST_CUE.test(it) && words(it) <= 6) return true;
      if (words(it) > 4) break;
    }
  }
  return POST.test(sentence.slice(end));
}

// ---------- sentences and clauses ----------
const ABBR = /(?:\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St|vs|approx|incl|e\.g|i\.e|cf|Fig)|\b[A-Z])\.$/;
function splitSentences(text) {
  const out = [];
  const push = (a, b) => {
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push({ start: a, end: b, text: text.slice(a, b) });
  };
  const re = /[.!?]+(?=["'”’)\]]*(?:\s|$))|\n+/g;
  let start = 0;
  let m;
  while ((m = re.exec(text))) {
    let end = m.index + m[0].length;
    if (m[0][0] !== '\n') {
      if (ABBR.test(text.slice(start, end))) continue;
      while (end < text.length && /["'”’)\]]/.test(text[end])) end++;
    }
    push(start, end);
    start = end;
  }
  push(start, text.length);
  return out;
}
// clause spans [a, b) inside a sentence, split at , ; : and dashes
function clauses(s) {
  const out = [];
  let a = 0;
  const re = /[,;:]|\s[–—-]\s/g;
  let m;
  while ((m = re.exec(s))) { out.push([a, m.index]); a = m.index + m[0].length; }
  out.push([a, s.length]);
  return out;
}
const clauseAt = (cl, i) => cl.find(([a, b]) => i >= a && i <= b) || [0, Infinity];

function regionWords(s) {
  const out = [];
  for (const [region, re] of REGION_WORDS) for (const m of all(re, s)) out.push({ region, index: m.index, end: m.index + m.length, word: m.text });
  return out;
}
function nearest(list, a, b) {
  let best = null;
  let bestD = Infinity;
  for (const w of list) {
    const d = w.end <= a ? a - w.end : w.index >= b ? w.index - b : 0;
    if (d < bestD) { best = w; bestD = d; }
  }
  return best;
}

// The quote: the whole sentence when it is short, else the clauses that hold the
// matched words and the body-part word used for the region.
function quoteSpan(s, cl, a, b, rw) {
  if (s.length <= 170) return [0, s.length];
  let [qa, qb] = clauseAt(cl, a);
  const [, eb] = clauseAt(cl, b);
  qb = Math.max(qb, eb);
  if (rw) {
    const [ra, rb] = clauseAt(cl, rw.index);
    qa = Math.min(qa, ra);
    qb = Math.max(qb, rb);
  }
  return [qa, Math.min(qb, s.length)];
}
function trimSpan(s, a, b) {
  while (a < b && /[\s,;:]/.test(s[a])) a++;
  while (b > a && /[\s,;:]/.test(s[b - 1])) b--;
  return [a, b];
}

// ---------- the helper ----------
// suggestFindings(noteText) -> [{ id, region, quote, sentence, match, regionWord, regionFrom }]
// region: fixed for region-specific signs (a dropped foot is always the leg); for the
// others, the body-part word nearest the match in the same clause, then sentence,
// then the exam heading above it ("Upper limbs."); 'other' when nothing says.
export function suggestFindings(noteText) {
  const text = String(noteText || '');
  const sentences = splitSentences(text);
  const cands = [];
  let section = null;
  for (const sen of sentences) {
    const s = sen.text;
    const cl = clauses(s);
    const rws = regionWords(s);
    let any = false;
    for (const rule of HELPER_RULES) {
      if (rule.need && !rule.need.test(s)) continue;
      if (rule.unless && rule.unless.test(s)) continue;
      const ms = rule.find ? rule.find(s) : all(rule.re, s);
      for (const m of ms) {
        const a = m.index;
        const b = m.index + m.length;
        if (!rule.noNeg) {
          if (isNegated(s, a, b)) continue;
          if (hasCueNear(s.slice(a, b), 99)) continue; // "reflexes are not brisk"
        }
        any = true;
        const f = FINDINGS[rule.id];
        let region = f.region;
        let regionFrom = 'usual';
        let rw = null;
        if (!region) {
          const [ca, cb] = clauseAt(cl, a);
          rw = nearest(rws.filter((w) => w.index >= ca && w.end <= cb), a, b) || nearest(rws, a, b);
          if (rw) { region = rw.region; regionFrom = 'words'; }
          else if (section) { region = section; regionFrom = 'heading'; }
          else { region = 'other'; regionFrom = 'none'; }
        }
        const [qa0, qb0] = quoteSpan(s, cl, a, b, rw);
        const [qa, qb] = trimSpan(s, qa0, qb0);
        cands.push({
          id: rule.id, region, quote: s.slice(qa, qb), sentence: s, match: m.text || s.slice(a, b),
          regionWord: rw ? rw.word : null, regionFrom, pos: sen.start + a,
        });
      }
    }
    // headings set the region for what follows; other short sentences end the section
    const h = HEADINGS.find(([re]) => re.test(s));
    if (h) section = h[1];
    else if (!any && words(s) <= 3) section = null;
  }
  cands.sort((x, y) => x.pos - y.pos);
  // a mention with no body part, for a sign already found with one, is a repeat
  const placed = new Set(cands.filter((c) => c.regionFrom !== 'none').map((c) => c.id));
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    if (c.regionFrom === 'none' && placed.has(c.id)) continue;
    const k = `${c.id}|${c.region}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const { pos, ...rest } = c;
    out.push(rest);
  }
  return out;
}

// ---------- how well it does against hand-picked red flags ----------
// Compared per visit at the level of red flag + body region. The rules were written
// while reading these notes, so these are best-case numbers, not a validation.
export function measureOn(visits) {
  let labelled = 0;
  let suggested = 0;
  let found = 0;
  const perVisit = [];
  for (const v of visits) {
    const truth = new Set((v.findings || []).map((f) => `${f.id}|${f.region || FINDINGS[f.id]?.region || 'other'}`));
    const got = new Set(suggestFindings(v.note).map((s) => `${s.id}|${s.region}`));
    const hit = [...truth].filter((k) => got.has(k));
    perVisit.push({
      id: v.id, date: v.date || null, labelled: truth.size, suggested: got.size, found: hit.length,
      missed: [...truth].filter((k) => !got.has(k)), extra: [...got].filter((k) => !truth.has(k)),
    });
    labelled += truth.size;
    suggested += got.size;
    found += hit.length;
  }
  return {
    visits: visits.length, labelled, suggested, found,
    recall: labelled ? found / labelled : null,
    precision: suggested ? found / suggested : null,
    perVisit,
  };
}
export function measureOnAlex() {
  // Context flags (shown, not scored) are not red flags the helper looks for.
  return measureOn(ALEX.encounters.map((e) => ({ id: e.id, date: e.date, note: e.note, findings: e.findings.filter((f) => !FINDINGS[f.id]?.contextOnly) })));
}
export function measureOnDemos() {
  return measureOn(LOOKALIKES.map((v) => ({ id: v.id, note: v.story, findings: v.caseFile.encounters[0].findings })));
}
