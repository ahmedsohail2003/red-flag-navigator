// Overview hero: a full-bleed espresso band with the point-cloud figure, a two-tone
// headline, the tool's headline result and a live red-flag calculator. The calculator
// runs the real engine (the published odds ratios, the same 5,000-draw simulation and
// the same pattern rules as every other view) on a one-visit case built from the ticked
// flags, at the referral line chosen in the top bar. Ticking a flag lights its body
// region on the figure. Every number here is computed at run time.
import { esc, fmtDate, TIER, tierChip, assumeChip, ensureCss, pctAt } from '../../ui.js';
import { stateAt, evaluateState, monthsSaved, FINDINGS, PRIOR, SOURCES, formatPct } from '../../../engine.js';
import { REFERRAL_LINES } from '../../../weights.js';
import { ALEX } from '../../../alex.js';
import { EVIDENCE } from '../../../evidence.js';
import { createFigure } from '../../../fx/pointcloud.js';
import { scrambleCycle } from '../../../fx/scramble.js';

// The eight flags: label for people, engine id, body region on the figure, tag on the figure.
// The four that carry Alex's story come first; the other three sit under 'More red flags'.
const FLAGS = [
  { id: 'focal_weakness', label: 'Focal weakness', region: 'arm', tag: 'WEAKNESS' },
  { id: 'wasting', label: 'Muscle wasting', region: 'arm', tag: 'WASTING' },
  { id: 'cramp', label: 'Cramps', region: 'arm', tag: 'CRAMPS' },
  { id: 'foot_drop', label: 'Foot drop', region: 'leg', tag: 'FOOT DROP' },
  { id: 'fasciculations', label: 'Twitching (fasciculations)', region: 'arm', tag: 'TWITCHING', more: true },
  { id: 'dysarthria', label: 'Slurred speech (dysarthria)', region: 'bulbar', tag: 'SLURRED SPEECH', more: true },
  { id: 'dysphagia', label: 'Trouble swallowing (dysphagia)', region: 'bulbar', tag: 'SWALLOWING', more: true },
  { id: 'two_territory_wasting', label: 'Wasting in two nerve territories', region: 'arm', tag: 'TWO TERRITORIES', pattern: true },
];
const MORE = FLAGS.filter((f) => f.more);
const REGION_NAME = { arm: 'RIGHT HAND', leg: 'RIGHT FOOT', bulbar: 'THROAT', breathing: 'CHEST' };
const REGION_ORDER = ['bulbar', 'breathing', 'arm', 'leg']; // top to bottom on the figure
// Figure tags: the pattern sign first, then the strongest published weight.
const TAG_ORDER = [...FLAGS].sort((a, b) => (b.pattern ? 1e9 : FINDINGS[b.id].or) - (a.pattern ? 1e9 : FINDINGS[a.id].or));
// Signs recorded before the real referral (16 Feb 2026), in the order they appeared:
// hand weakness (14 Oct 2024), foot catching (21 Apr 2025), brisk reflexes including
// the right ankle (physiotherapist, 10 Feb 2026).
const WORDS = [
  { text: 'in his hand.', region: 'arm' },
  { text: 'in his foot.', region: 'leg' },
  { text: 'in his reflexes.', region: 'leg' },
];

// The preset is Alex's picture at the first visit where the notes show the pattern sign
// (the hand surgeon, 9 Dec 2024), read from the case file rather than typed in.
const PRESET_ENC = ALEX.encounters.find((e) => (e.findings || []).some((f) => f.id === 'two_territory_wasting')) || ALEX.encounters[0];
const PRESET_DATE = PRESET_ENC.date;
const PRESET_IDS = stateAt(ALEX, PRESET_DATE, { includeHomeTests: false }).ids;
const PRESET = new Set(FLAGS.filter((f) => PRESET_IDS.has(f.id)).map((f) => f.id));
let ticked = null; // the what-if survives moving between views in this session

// The headline result, from the engine: the visit at which every referral line calls for
// an EMG (notes only; the strictest line fires last) against the real referral.
const PER = REFERRAL_LINES.map((l) => monthsSaved(ALEX, { referralLine: l.value, includeHomeTests: false }));
const ALL_FIRED = PER.length > 0 && PER.every((m) => m.firstHigh && Number.isFinite(m.monthsVsReferral) && m.monthsVsReferral > 0);
const PROMPT = ALL_FIRED ? PER.map((m) => m.firstHigh).sort().at(-1) : null;
const GAIN = ALL_FIRED ? Math.floor(Math.min(...PER.map((m) => m.monthsVsReferral))) : null;
const DELAY = EVIDENCE.delay && EVIDENCE.delay.alsFocus;

const fmtOr = (or) => `×${or >= 10 ? or.toFixed(1) : or.toFixed(2)}`;
const lineLabel = (v) => REFERRAL_LINES.find((l) => l.value === v)?.label || formatPct(v);
const per10k = (p) => Math.round(p * 10000).toLocaleString('en-US');

// "5.2–20%": one unit at the end. Both ends always print, even when they round the same:
// a range, never one figure. An end that is not a plain number reads "98% to >99%".
function rangeText(r, line) {
  const a = pctAt(r.lo, line);
  const b = pctAt(r.hi, line);
  const plain = /^[0-9.]+%$/;
  if (!plain.test(a) || !plain.test(b)) return `${a} to ${b}`;
  return `${a.slice(0, -1)}–${b}`;
}

function evaluate(line) {
  const findings = FLAGS.filter((f) => ticked.has(f.id)).map((f) => ({ id: f.id, region: f.region, quote: f.label }));
  const caseFile = { patient: { name: 'What-if' }, encounters: [{ id: 'whatif', date: PRESET_DATE, setting: 'Family doctor', findings }], homeTests: [] };
  return evaluateState(stateAt(caseFile, PRESET_DATE, { includeHomeTests: false }), { referralLine: line });
}

function reasonText(ev) {
  const fired = ev.rulesFired || [];
  if (fired.length) return `Pattern rule: ${fired[0].label}${fired.length > 1 ? ` (and ${fired.length - 1} more)` : ''}.`;
  const l = lineLabel(ev.line);
  if (ev.tier === 'high') return `The whole range is above the ${l} referral line.`;
  if (ev.tier === 'low') return `The whole range is below the ${l} referral line.`;
  return `The range crosses the ${l} referral line.`;
}

function flagRow(f) {
  const F = FINDINGS[f.id];
  const weight = f.pattern
    ? '<span class="ovh-flag-w is-rule" title="Pattern sign: no odds ratio. It sends the case straight to High (Eisen and Kuwabara 2012).">→ High</span>'
    : `<span class="ovh-flag-w" title="Odds ratio ${F.or.toFixed(2)} (95% CI ${F.lo.toFixed(2)} to ${F.hi.toFixed(2)}), Mei et al. 2022">${fmtOr(F.or)}</span>`;
  return `<li><label class="ovh-flag" data-region="${f.region}">
      <input type="checkbox" data-id="${f.id}"${ticked.has(f.id) ? ' checked' : ''}>
      <span class="ovh-sw" aria-hidden="true"></span>
      <span class="ovh-flag-name">${esc(f.label)}</span>${weight}
    </label></li>`;
}

function proofHtml() {
  if (!PROMPT || GAIN == null) return '';
  const delay = DELAY && Number.isFinite(DELAY.medianMonths)
    ? ` People with ALS wait a median ${esc(String(DELAY.medianMonths))} months from first symptom to diagnosis (ALS Focus, ${esc(DELAY.n.toLocaleString('en-US'))} people).`
    : '';
  return `<p class="ovh-proof"><strong>At least ${GAIN} months earlier.</strong> Read together, his notes call for an EMG on ${fmtDate(PROMPT)} at every referral line; his real referral came on ${fmtDate(ALEX.actual.referral)}.${delay}</p>`;
}

function html() {
  const plain = FLAGS.filter((f) => !f.pattern && !f.more).map(flagRow).join('');
  const more = MORE.map(flagRow).join('');
  const pattern = FLAGS.filter((f) => f.pattern).map(flagRow).join('');
  const mei = SOURCES.mei2022;
  return `
    <canvas class="ovh-canvas" aria-hidden="true"></canvas>
    <div class="ovh-inner">
      <div class="ovh-copy">
        <p class="ovh-kicker"><span class="ovh-dot" aria-hidden="true"></span>Red-flag indicator · for family doctors</p>
        <h1 class="ovh-title">
          <span class="ovh-sr">The red flags for ALS were in his notes: in his hand, in his foot, in his reflexes.</span>
          <span class="ovh-title-vis" aria-hidden="true"><span class="ovh-l">The red flags for ALS</span><span class="ovh-l">were in his notes,</span><span class="ovh-l soft"><span class="ovh-cycle">${esc(WORDS[0].text)}</span></span></span>
        </h1>
        <p class="ovh-lede">${esc(ALEX.patient.name)} (a fictional BioHacks case) had hand weakness that was treated as carpal tunnel while red flags piled up, visit by visit. The indicator adds up the red flags from all his notes, each quoted from its sentence (picked out by hand, AI-assisted, for this demo), and says when a patient needs an EMG, using published odds ratios. It never diagnoses.</p>
        ${proofHtml()}
        <div class="ovh-actions">
          <a class="ovh-btn light" href="#indicator" data-go="indicator" data-alex="if-needed">Open ${esc(ALEX.patient.name.split(' ')[0])}'s indicator <span aria-hidden="true">→</span></a>
          <a class="ovh-btn ghost" href="#cases" data-go="cases">Analyse a case</a>
        </div>
      </div>
      <div class="ovh-stage" aria-hidden="true"></div>
      <section class="ovh-card panel" aria-labelledby="ovh-calc-h">
        <div class="ovh-card-head">
          <h2 class="ovh-card-title" id="ovh-calc-h">Red-flag calculator</h2>
          <button type="button" class="ovh-reset" data-k="reset" hidden>Reset to ${esc(ALEX.patient.name.split(' ')[0])}</button>
        </div>
        <p class="ovh-card-sub" data-k="sub"></p>
        <ul class="ovh-flags" aria-label="Red flags in the notes">${plain}</ul>
        <details class="ovh-more">
          <summary><span class="ovh-more-c" aria-hidden="true"></span>More red flags (${MORE.length})<span class="ovh-more-n" data-k="more-n"></span></summary>
          <ul class="ovh-flags" aria-label="More red flags">${more}</ul>
        </details>
        <p class="ovh-mini ovh-pattern-h">Pattern sign · straight to High</p>
        <ul class="ovh-flags" aria-label="Pattern sign">${pattern}</ul>
        <div class="ovh-result" aria-live="polite" aria-atomic="true">
          <div class="ovh-res-lbl">Chance of an MND (ALS) diagnosis within ${esc(String(PRIOR.horizonYears))} years · 95% range</div>
          <div class="ovh-result-top"><div class="ovh-big mono" data-k="big"></div><span class="chip" title="Plain arithmetic on published odds ratios. No AI model makes this number.">Arithmetic</span></div>
          <div class="ovh-verdict" data-k="verdict"></div>
          <p class="ovh-reason" data-k="reason"></p>
          <p class="ovh-line-ro" data-k="line"></p>
        </div>
        <p class="ovh-foot" data-k="foot">Starting rate ${per10k(PRIOR.lo)} to ${per10k(PRIOR.hi)} in 10,000 ${assumeChip()} · weights from <a href="${esc(mei.url)}" target="_blank" rel="noopener">Mei et al. 2022</a> · <span data-k="nsims">5,000</span> random draws</p>
      </section>
    </div>`;
}

export function mount(el, ctx) {
  ensureCss('css/views/overview-hero.css');
  let cur = ctx;
  if (!ticked) ticked = new Set(PRESET);
  el.classList.add('ovh');
  el.setAttribute('aria-labelledby', 'ovh-title-h');
  el.innerHTML = html();
  el.querySelector('.ovh-title').id = 'ovh-title-h';

  const canvas = el.querySelector('.ovh-canvas');
  const stageEl = el.querySelector('.ovh-stage');
  const $ = (k) => el.querySelector(`[data-k="${k}"]`);
  const fig = createFigure(canvas, { pointerTarget: el });

  // The figure stands in the free column between the copy and the card.
  const measure = () => {
    const c = canvas.getBoundingClientRect();
    const s = stageEl.getBoundingClientRect();
    if (!c.width || !s.width) return;
    fig.setStage({ x: s.left - c.left, y: s.top - c.top, w: s.width, h: s.height });
    if ($('big')?.textContent) fitBig();
  };
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  if (ro) { ro.observe(el); ro.observe(stageEl); } else window.addEventListener('resize', measure);
  measure();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure).catch(() => {});

  // The soft headline line cycles hand -> foot -> reflexes twice, then rests on 'hand'; the
  // figure lights that region softly. It runs only on screen, holds still while the pointer
  // or focus is in the copy or the calculator, and never moves under reduced motion.
  const cycleEl = el.querySelector('.ovh-cycle');
  const scr = scrambleCycle(cycleEl, WORDS.map((w) => w.text), {
    hold: 2800, passes: 2, pauseWithin: [el.querySelector('.ovh-copy'), el.querySelector('.ovh-card')],
  });
  const mo = new MutationObserver(() => {
    const w = WORDS.find((x) => x.text === cycleEl.textContent);
    if (w) fig.setSpot(w.region);
  });
  mo.observe(cycleEl, { childList: true, characterData: true, subtree: true });
  fig.setSpot(WORDS[0].region);

  // Fit the big number beside the chip: measure the text at 52px and scale it into the
  // width left in its row (an estimate per glyph overflowed on phones and the '%' was cut).
  // Run again on resize, because the stylesheet and fonts can arrive after mount. 16px at
  // the least, so a 12-character range (">99% to >99%") still fits at 320px.
  function fitBig() {
    const big = $('big');
    const chip = big.nextElementSibling;
    const room = big.parentElement.clientWidth - (chip ? chip.offsetWidth + 10 : 0);
    if (room <= 0) return;
    big.style.fontSize = '52px';
    const natural = big.scrollWidth;
    big.style.fontSize = `${Math.max(16, Math.min(52, Math.floor((52 * room) / Math.max(1, natural))))}px`;
  }

  function render() {
    const line = cur.state.line;
    const ev = evaluate(line);
    el.querySelectorAll('input[data-id]').forEach((i) => { i.checked = ticked.has(i.dataset.id); });
    const big = $('big');
    const txt = rangeText(ev.range, ev.line);
    big.textContent = txt;
    fitBig();
    $('verdict').innerHTML = `${tierChip(ev.tier)}<span class="ovh-act">${esc(TIER[ev.tier].action)}</span>`;
    $('reason').textContent = reasonText(ev);
    $('line').textContent = `At the ${lineLabel(line)} line · change it in the top bar`;
    $('nsims').textContent = ev.range.nSims.toLocaleString('en-US');
    const moreOn = MORE.filter((f) => ticked.has(f.id)).length;
    $('more-n').textContent = moreOn ? ` · ${moreOn} ticked` : '';
    const same = ticked.size === PRESET.size && [...ticked].every((id) => PRESET.has(id));
    $('reset').hidden = same;
    $('sub').textContent = same
      ? `Ticked: ${ALEX.patient.name}'s notes up to ${fmtDate(PRESET_ENC.date)}`
      : 'Your what-if. Tick what the notes say.';
    const flags = { arm: [], leg: [], bulbar: [], breathing: [] };
    for (const f of TAG_ORDER) if (ticked.has(f.id)) flags[f.region].push(f.tag);
    const joined = ev.rulesFired.some((r) => r.id === 'multi_region') ? REGION_ORDER.filter((k) => ev.state.motorRegions.has(k)) : [];
    fig.setFlags(flags, REGION_NAME, joined);
  }

  const onChange = (e) => {
    const input = e.target.closest('input[data-id]');
    if (!input) return;
    if (input.checked) ticked.add(input.dataset.id); else ticked.delete(input.dataset.id);
    render();
  };
  const onClick = (e) => {
    if (e.target.closest('[data-k="reset"]')) { ticked = new Set(PRESET); render(); el.querySelector('input[data-id]')?.focus(); return; }
    const go = e.target.closest('[data-go]');
    if (!go || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (go.dataset.alex && (cur.caseEntry?.id ?? 'alex') !== 'alex') cur.openCase('alex');
    cur.navigate(go.dataset.go);
  };
  // Hovering or focusing a flag shows where it is on the body.
  const onOver = (e) => { const row = e.target.closest('.ovh-flag'); fig.setPreview(row ? row.dataset.region : null); };
  const onOut = (e) => { if (!e.relatedTarget || !el.contains(e.relatedTarget) || !e.relatedTarget.closest('.ovh-flag')) fig.setPreview(null); };
  el.addEventListener('change', onChange);
  el.addEventListener('click', onClick);
  el.addEventListener('pointerover', onOver);
  el.addEventListener('pointerout', onOut);
  el.addEventListener('focusin', onOver);
  el.addEventListener('focusout', onOut);

  render();

  return {
    // Only the referral line changes the result, so other changes do not re-read the live region.
    update(next) { const was = cur.state.line; cur = next; if (next.state.line !== was) render(); },
    unmount() {
      scr.stop();
      mo.disconnect();
      if (ro) ro.disconnect(); else window.removeEventListener('resize', measure);
      fig.destroy();
      el.removeEventListener('change', onChange);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerover', onOver);
      el.removeEventListener('pointerout', onOut);
      el.removeEventListener('focusin', onOver);
      el.removeEventListener('focusout', onOut);
    },
  };
}
