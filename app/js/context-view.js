// Renders two context panels, each only if its host element exists:
//   <section id="practice"> (overview page): "Compared with current practice"
//   <section id="path">     (method page):   "Path to use"
// Styles: css/context.css. Every DOM access is guarded, so the module also imports in Node.
import { REFERRAL_LINES, DEFAULT_REFERRAL_LINE } from './weights.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// At a referral line p, each EMG referral is a true case with probability p, so a clinic
// accepts (1 - p) / p normal EMGs per case found.
export function normalEmgsPerCase(p) {
  return Math.round((1 - p) / p);
}

// The 5% line from weights.js (falls back to the default line if 5% is ever removed).
const LINE_5 = REFERRAL_LINES.find((l) => Math.abs(l.value - 0.05) < 1e-9)
  || REFERRAL_LINES.find((l) => l.value === DEFAULT_REFERRAL_LINE)
  || { value: DEFAULT_REFERRAL_LINE, label: `${Math.round(DEFAULT_REFERRAL_LINE * 100)}%` };

const PRACTICE_ROWS = [
  [
    'Someone has to suspect MND first and open the checklist. Each of Alex\'s clinicians saw one body part, and for 16 months none of them did; his physiotherapist finally raised it in February 2026.',
    'Runs on every letter that reaches the family doctor (the surgeon\'s and the physiotherapist\'s letters both went to Dr. Raman), so clues add up across clinicians.',
  ],
  [
    'The UK Red Flag tool was built from specialist interviews and had not been verified against clinical data (Mei et al. 2022).',
    'Every sign is quoted with its date and carries a published weight (an adjusted odds ratio from Mei et al. 2022).',
  ],
  [
    'Whether to refer is left to clinician judgement.',
    'An explicit referral line that the clinic chooses, with its cost in normal EMGs shown.',
  ],
  [
    'Change is tracked with a questionnaire every three months (how Alex is followed since his diagnosis).',
    'Objective weekly home tests for unclear cases. Today an unclear case usually waits for the next visit: Alex\'s surgeon wrote that a neurological opinion "may be helpful if symptoms progress".',
  ],
];

export function practiceHtml() {
  const rows = PRACTICE_ROWS.map(([now, adds]) => `<tr><td>${esc(now)}</td><td>${esc(adds)}</td></tr>`).join('');
  return `
    <div class="card ctx-card">
      <h2>Compared with current practice</h2>
      <p class="muted">Today: clinician judgement plus paper checklists, such as ALS Canada's ReferALS early referral tool and the UK MND Association / RCGP Red Flag tool (2014).</p>
      <div class="ctx-scroll"><table class="ctx-table">
        <thead><tr><th>Current practice</th><th>What this tool adds</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

export function pathItems() {
  const n = normalEmgsPerCase(LINE_5.value);
  return [
    ['Where it runs', 'Inside the family doctor\'s EMR inbox, so notes stay with the custodian. A phone web app for the home tests.'],
    ['Who acts', 'The family doctor confirms the referral. The tool recommends; it never refers on its own.'],
    ['Cost', `The visible cost is extra EMGs: about ${n} normal EMGs per case found at a ${LINE_5.label} line. Weigh that against Alex's 16 months of visits, an operation that did not help, and 18 physiotherapy sessions.`],
    ['Access', 'A phone or any browser; a clinic kiosk for people without a phone.'],
    ['Regulation', 'Likely software as a medical device in Canada, risk class to be confirmed with Health Canada. Validation needs a privacy impact assessment and a PHIPA data agreement.'],
  ];
}

const STEPS = ['Retrospective replay on linked records', 'Silent pilot in one family health team', 'Rollout'];

export function pathHtml() {
  const items = pathItems().map(([head, text]) => `<div class="ctx-item"><h3>${esc(head)}</h3><p>${esc(text)}</p></div>`).join('');
  const steps = STEPS.map((s) => `<li>${esc(s)}</li>`).join('');
  return `
    <div class="card ctx-card">
      <h2>Path to use</h2>
      <div class="grid grid-2 ctx-path">
        ${items}
        <div class="ctx-item"><h3>Steps</h3><ol class="ctx-steps">${steps}</ol></div>
      </div>
    </div>`;
}

if (typeof document !== 'undefined') {
  const practice = document.getElementById('practice');
  if (practice) practice.innerHTML = practiceHtml();
  const path = document.getElementById('path');
  if (path) path.innerHTML = pathHtml();
}
