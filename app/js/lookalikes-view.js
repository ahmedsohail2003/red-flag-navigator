// Renders the look-alike check into <section id="lookalikes"> on whichever page has it.
import { LOOKALIKES } from './lookalikes.js';
import { evaluateAt, formatPct, FINDINGS, DEFAULT_REFERRAL_LINE } from './engine.js';

const host = document.getElementById('lookalikes');
if (host) {
  let stored = NaN;
  try { stored = Number(localStorage.getItem('rfn.referralLine')); } catch { /* storage blocked: use the default */ }
  const line = stored > 0 && stored < 1 ? stored : DEFAULT_REFERRAL_LINE;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = LOOKALIKES.map((v) => {
    const ev = evaluateAt(v.caseFile, v.caseFile.encounters[0].date, { referralLine: line });
    const signs = [...new Set(v.caseFile.encounters[0].findings.map((f) => FINDINGS[f.id].label))].join('; ');
    const verdict = v.expect === 'not-high'
      ? (ev.tier !== 'high' ? '<span class="la-ok">As expected: no EMG on its own</span>' : '<span class="la-bad">Escalated: needs review</span>')
      : `<span class="muted">${esc(v.note || 'No expectation set')}</span>`;
    return `<tr>
      <td><strong>${esc(v.title)}</strong><br><small class="muted">${esc(v.story)}</small></td>
      <td><small>${esc(signs)}</small></td>
      <td style="white-space:nowrap">${formatPct(ev.range.lo)} to ${formatPct(ev.range.hi)}</td>
      <td><span class="tier ${ev.tier}">${ev.tier}</span></td>
      <td><small>${verdict}</small></td>
    </tr>`;
  }).join('');
  host.innerHTML = `
    <div class="card">
      <h2>Does it flag everyone with a weak hand? A look-alike check</h2>
      <p class="lede">Seven <strong>constructed</strong> cases (not real patients), scored at the current referral line (${formatPct(line)}). For the five common benign look-alikes we wrote down "should not trigger an EMG on its own" <em>before</em> running the scorer; an automated test keeps it that way. Two more are shown because they are hard cases.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Case</th><th>Signs the scorer counts</th><th>95% range</th><th>Tier</th><th>Result</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="muted" style="margin-top:10px">Numbness, tingling and neck pain carry no weight because the published model found sensory symptoms were not associated with MND. Weak spot: a case that starts with speech alone can sit in "unclear", where the weekly reading-rate test has to show the change. Validation on real records would measure this properly.</p>
    </div>`;
}
