// Overview section: the Ice Bucket Challenge, respectful and factual. A dark espresso band
// with three sourced facts over an interactive water surface (fx/ripples.js): the pointer
// leaves ripples, a click on the water drops an ice cube. The point it makes: awareness
// raised the money; earlier referral needs the red flags noticed in time.
// Every figure here is quoted from the linked source; none is computed or rounded.
// The canvas is decorative (aria-hidden); the text carries all the information.
import { esc, ensureCss } from '../../ui.js';
import { createRipples } from '../../../fx/ripples.js';
import { ALEX } from '../../../alex.js';

const SOURCES = {
  als: { label: 'ALS Association', url: 'https://www.als.org/ibc-how-it-started' },
  qz: { label: 'Quartz, 2016', url: 'https://qz.com/743231/the-ice-bucket-challenge-worked-theres-been-a-breakthrough-in-als-research' },
  abc7: { label: 'ABC7, 2016', url: 'https://abc7.com/ice-bucket-challenge-als-lou-gehrigs-disease-amyotrophic-lateral-sclerosis/1445646/' },
  cnn: { label: 'CNN via WTKR, 2015', url: 'https://www.wtkr.com/2015/07/15/one-year-later-your-als-ice-bucket-money-goes-to' },
};

// Wording follows the sources. $115 million is what the ALS Association alone received
// (more went to other ALS charities worldwide): the Association's own Ice Bucket Challenge
// page says the challenge raised $115 million for the Association, and its later pages say
// "more than"; "$115 million in six weeks" (Quartz, the only source for the period);
// "2.5 million people donated $115 million to the ALS Association" and "$77 million for
// research" (CNN, 2015; no period given); "$1 million of that helped fund ... Project MinE",
// which identified NEK1 (ABC7, Quartz). als.org sits behind a bot check, so its wording was
// read from search results, not fetched; it did not turn up the $77 million, so that row
// keeps CNN alone.
const FACTS = [
  { label: 'Donated to the ALS Association in about six weeks', value: '$115M+', src: ['als', 'qz', 'cnn'] },
  { label: 'Of that, set aside for research', value: '$77M', src: ['cnn'] },
  { label: 'Went to Project MinE, whose researchers identified NEK1 as an ALS gene in 2016. One funder among many, so the link is partly indirect.', value: '$1M', src: ['qz', 'abc7'] },
];

const srcLinks = (keys) => keys.map((k) => `<a href="${esc(SOURCES[k].url)}" target="_blank" rel="noopener">${esc(SOURCES[k].label)}</a>`).join('<span aria-hidden="true"> · </span>');

// The button opens the case that is open in the app (the hero's always opens Alex), so its
// label names that case.
function btnLabel(c) {
  const e = c && c.caseEntry;
  return !e || e.id === 'alex' ? `Open ${String(ALEX.patient.name).split(' ')[0]}'s indicator` : `Open the indicator for ${e.name}`;
}

function html(ctx) {
  const rows = FACTS.map((f) => `
    <div class="kv ovi-kv">
      <div class="ovi-k"><span>${esc(f.label)}</span><span class="ovi-src">Source: ${srcLinks(f.src)}</span></div>
      <span class="v ovi-v">${esc(f.value)}</span>
    </div>`).join('');
  return `
    <section class="ovi panel grid-bg ov-fill" aria-labelledby="ovi-title">
      <canvas class="ovi-canvas" aria-hidden="true"></canvas>
      <div class="ovi-copy">
        <div class="micro dot ovi-eyebrow">The Ice Bucket Challenge · 2014</div>
        <h2 class="ovi-title two-tone" id="ovi-title">In 2014, millions poured ice water over their heads. <span class="soft">The ALS Association alone received more than $115 million.</span></h2>
        <div class="ovi-facts" role="list" aria-label="What the challenge raised">${rows.replace(/<div class="kv ovi-kv">/g, '<div class="kv ovi-kv" role="listitem">')}</div>
        <p class="ovi-bridge two-tone">Awareness raised the money. <span class="soft">Earlier referral needs the red flags noticed in time.</span></p>
        <div class="ovi-cta"><a class="btn light ovi-btn" href="#indicator"><span class="ovi-btn-l">${esc(btnLabel(ctx))}</span> <span aria-hidden="true">&rarr;</span></a></div>
      </div>
      <div class="ovi-hint micro dot" aria-hidden="true">Click the water to drop ice</div>
    </section>`;
}

export function mount(el, ctx) {
  ensureCss('css/views/overview-ice.css');
  let cur = ctx;
  el.innerHTML = html(ctx);
  const band = el.querySelector('.ovi');
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
    el.querySelector('.ovi-hint').textContent = 'Tap the water to drop ice';
  }
  const canvas = el.querySelector('.ovi-canvas');
  let water = null;
  try {
    const copy = el.querySelector('.ovi-copy');
    const cta = el.querySelector('.ovi-cta');
    water = createRipples(canvas, {
      pointerTarget: band,
      noDrop: 'a,button,input,select,textarea,label,summary',
      // A tap on the text column (down to the button) drops nothing. The copy box itself
      // runs on below the button, over the water (on a phone the whole water strip sits
      // in its bottom padding), so a tap there still drops ice.
      canDrop: (e) => {
        const c = copy.getBoundingClientRect(), b = cta.getBoundingClientRect();
        return !(e.clientX >= c.left && e.clientX <= c.right && e.clientY <= b.bottom + 12);
      },
      // the water is quieter under the text, up to the copy's right edge
      textEdge: () => copy.getBoundingClientRect().right - canvas.getBoundingClientRect().left,
    });
  } catch (e) {
    console.error(e); // the band still reads well without the water
  }
  // Route links go through the app's router (shell.js listens for #route clicks).
  const btn = el.querySelector('.ovi-btn');
  const onBtn = (e) => {
    if (cur && typeof cur.navigate === 'function' && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      cur.navigate('indicator');
    }
  };
  btn.addEventListener('click', onBtn);
  return {
    // only the button's label depends on the shared state (the open case)
    update(c) { cur = c; btn.querySelector('.ovi-btn-l').textContent = btnLabel(c); },
    unmount() {
      btn.removeEventListener('click', onBtn);
      if (water) water.destroy();
      water = null;
    },
  };
}
