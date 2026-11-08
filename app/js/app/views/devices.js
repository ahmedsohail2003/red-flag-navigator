// Devices and live data (#devices): whether AirPods, Apple Watch and phone data really
// arrive at this laptop and get saved. It talks to the one server (server/SPEC.md and
// server/README.md), on the same origin as the app:
//   GET /api/health       on mount; only a reply from "rfn-one-server" counts
//   GET /api/info         the phone and Sensor Logger addresses
//   GET /api/db/summary   every 2 s: devices with rates, row counts, newest sessions
//   GET /events           Server-Sent Events, one message per batch of samples
//   GET /api/db/samples   a device's last stored sample, when no live one has arrived
//   POST /record, POST /api/home-results
// Without the server (the static preview, the hosted copy) it shows a calm state with the
// command to run and no data at all: nothing on this page is ever made up.
// Honesty: every reading says whether it was measured (device name and time), simulated
// (names ending in "(simulated)") or imported (walk uploads). The red-flag indicator does
// not use device data, so it never changes the number.
import { esc, fmtDate, ensureCss, plural } from '../ui.js';
import { createEffect, palette, prefersReducedMotion, rgba, cssVar } from '../../fx/core.js';

const SERVER = 'rfn-one-server';
const POLL_MS = 2000;          // summary while the server answers
const RETRY_MS = 5000;         // summary while it does not
const TICK_MS = 250;           // ages, Live / Idle and the numbers (1 s with reduced motion)
const LIVE_MS = 3000;          // Live: a sample arrived in the last 3 s
const WINDOW_MS = 10000;       // the chart shows the last 10 s
const KEEP_MS = 12000;
const GAP_MS = 1000;           // a pause longer than this breaks a chart line
const SESSION_GAP_S = 20;      // the server's default: a stream session ends after 20 s without samples
const DEFAULT_PORT = 8765;
const HOME_CHUNK = 5000;       // rows per POST (the server takes at most 20000)
const KIND_WORD = { airpods: 'AirPods', watch: 'Watch', phone: 'Phone', other: 'Other' };
const SESSION_WORD = { stream: 'Live stream', walk: 'Walk upload', import: 'Import' };
// Home-test results kept in this browser: the working tests, and the home kit's results.
const HOME_KEYS = [['rfn.homeResults', 'the working tests'], ['rfn.home.results', 'the home kit']];
// Chart lines: the accent for the first device, ink tones for the others, each with its own
// dash pattern so colour is never the only difference. Never the red-flag colour.
const STYLES = [
  { key: 'panelAccent', css: '--panel-accent', dash: [], w: 2.2 },
  { key: 'panelInk', css: '--panel-ink', dash: [7, 4], w: 1.7 },
  { key: 'panelInk2', css: '--panel-ink-2', dash: [1.5, 4], w: 2.2 },
  { key: 'panelInk3', css: '--panel-ink-3', dash: [11, 4, 2, 4], w: 1.7 },
  { key: 'panelInk2', css: '--panel-ink-2', dash: [], w: 1.2 },
  { key: 'panelInk3', css: '--panel-ink-3', dash: [4, 4], w: 1.5 },
];

// ---------------- small helpers ----------------
const kindOf = (name) => {
  const n = String(name || '').toLowerCase(); // the server's rule, in the same order
  return n.includes('airpods') ? 'airpods' : n.includes('watch') ? 'watch' : n.includes('phone') ? 'phone' : 'other';
};
const isSimName = (name) => /\(simulated\)\s*$/i.test(String(name || ''));
const isWalkName = (name) => String(name || '').toLowerCase().startsWith('phone-walk');
const fin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const mag = (s) => {
  const x = fin(s && s.gx); const y = fin(s && s.gy); const z = fin(s && s.gz);
  return x == null || y == null || z == null ? null : Math.sqrt(x * x + y * y + z * z);
};
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-CA') : '–');
const gText = (v) => (!Number.isFinite(v) ? '–' : v >= 100 ? String(Math.round(v)) : v.toFixed(1));
const hzText = (hz) => (!Number.isFinite(hz) ? '–' : Number.isInteger(hz) ? String(hz) : hz.toFixed(1));
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// Wall-clock time of the laptop: '14:03:09', with the date when it is not today.
function clockOf(ms) {
  if (!Number.isFinite(ms)) return '–';
  const d = new Date(ms);
  const hms = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return dayKey(d) === dayKey(new Date()) ? hms : `${fmtDate(dayKey(d))}, ${hms}`;
}
// What the last Sensor Logger push held (SensorLoggerLog in server/app_server.py), so a missing
// AirPods or Watch stream is visible here instead of failing silently. Sensor names come from the
// network: every one is escaped.
function sensorLoggerLine(sl, nowMs) {
  const head = '<span class="micro">Last push</span> ';
  if (!sl || !sl.last) return `${head}None yet. In Sensor Logger, Tap to Test Pushing checks the address.`;
  const L = sl.last;
  const when = Number.isFinite(L.at) ? ago(Math.max(0, nowMs / 1000 - L.at)) : '';
  if (L.test) return `${head}${esc(when)}: a connection test, with no readings. The address works; start a recording to send data.`;
  const parts = (Array.isArray(L.sensors) ? L.sensors : []).map((s) => {
    const n = `${esc(s.name)} ${esc(int(s.count))}`;
    if (s.role === 'stored') return `${n} → ${esc(s.device)}`;
    if (s.role === 'unreadable') return `<span class="dv-warn">${n} not stored</span>: no turning speed in these readings (update Sensor Logger)`;
    if (s.role === 'helper') return `${n} (tilt for the phone)`;
    return `${n}, not read`;
  });
  return `${head}${esc(when)}${L.simulated ? ', simulated' : ''}: ${parts.join(' · ') || 'no sensor names'}.`;
}
function ago(sec) {
  if (!Number.isFinite(sec)) return 'never';
  if (sec < 1) return 'under a second ago';
  if (sec < 10) return `${sec.toFixed(1)} s ago`;
  if (sec < 90) return `${Math.round(sec)} s ago`;
  if (sec < 5400) return `${Math.round(sec / 60)} min ago`;
  if (sec < 172800) return `${plural(Math.round(sec / 3600), 'hour')} ago`;
  return `${plural(Math.round(sec / 86400), 'day')} ago`;
}
function span(sec) {
  if (!Number.isFinite(sec)) return '';
  if (sec < 90) return `${sec.toFixed(1)} s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}
function bytes(b) {
  if (!Number.isFinite(b) || b < 0) return ['–', ''];
  if (b < 1024) return [String(b), 'B'];
  if (b < 1048576) return [String(Math.round(b / 1024)), 'KB'];
  if (b < 1073741824) return [(b / 1048576).toFixed(1), 'MB'];
  return [(b / 1073741824).toFixed(2), 'GB'];
}
// "1, 1.5, 2, 3 ..." ceilings for the chart's top, and 1-2-5 steps for its gridlines.
function niceCeil(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * p >= v - 1e-9) return m * p;
  return 10 * p;
}
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const r = raw / p;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * p;
}
const failWord = (e) => (e && e.name === 'AbortError' ? 'the server did not answer in time'
  : e && e.message && !/fetch|network|load failed/i.test(e.message) ? e.message : 'no answer from the server');

// JSON request with a timeout. Resolves { ok, status, data } (data null when the reply is
// not JSON); rejects when nothing answers or the view's signal aborts.
async function request(url, { method = 'GET', body, signal, timeout = 4000 } = {}) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  const timer = setTimeout(stop, timeout);
  if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
  try {
    const init = { method, cache: 'no-store', signal: ctl.signal };
    if (body !== undefined) { init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    const res = await fetch(url, init);
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', stop);
  }
}

// Is the one server behind this page? { ok, health } or { ok: false, why }; null if aborted.
async function checkHealth(signal) {
  try {
    const r = await request('/api/health', { signal, timeout: 3500 });
    const h = r.data;
    if (r.ok && h && h.ok === true && h.server === SERVER) return { ok: true, health: h };
    if (h && typeof h.server === 'string' && h.server !== SERVER) return { ok: false, why: `A different server answered here (${h.server}), not the device server.` };
    if (r.status === 404) return { ok: false, why: 'This address serves the app, but no device server runs behind it: it is the app preview or a hosted copy.' };
    return { ok: false, why: `This address answered with code ${r.status}, not as the device server.` };
  } catch (e) {
    if (signal && signal.aborted) return null;
    return { ok: false, why: 'Nothing answered: the device server is not running, or this page cannot reach it.' };
  }
}

// This browser's home-test results. Storage can be missing or throw (private modes, sandboxed
// hosting): then blocked is true and nothing is read.
function readHome() {
  const out = { rows: [], parts: [], blocked: false };
  let ls = null;
  try { ls = window.localStorage; } catch { ls = null; }
  if (!ls) { out.blocked = true; return out; }
  for (const [key, label] of HOME_KEYS) {
    let raw = null;
    try { raw = ls.getItem(key); } catch { out.blocked = true; return out; }
    let rows = [];
    try { const v = raw ? JSON.parse(raw) : []; rows = Array.isArray(v) ? v.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) : []; } catch { rows = []; }
    if (rows.length) out.parts.push(`${rows.length} from ${label}`);
    out.rows.push(...rows);
  }
  return out;
}

const swatch = (i) => {
  const s = STYLES[i % STYLES.length];
  return `<svg class="dv-sw" viewBox="0 0 30 10" aria-hidden="true"><line x1="2" y1="5" x2="28" y2="5" style="stroke:var(${s.css});stroke-width:${s.w};stroke-linecap:round;stroke-dasharray:${s.dash.length ? s.dash.join(' ') : 'none'}"/></svg>`;
};
const provChip = (p) => (p === 'simulated'
  ? '<span class="chip sim" title="Made up by server/simulate.py to test the path; not a measurement">Simulated</span>'
  : p === 'imported'
    ? '<span class="chip" title="Uploaded in one piece (a walk test recording), not streamed live">Imported</span>'
    : '<span class="chip" title="Streamed from this device as it measured">Measured</span>');
// A command or address, wrapped at spaces and after slashes, never inside a flag such as
// --seconds. <wbr> and the spans add no characters, so Copy still gets the exact text.
const codeHtml = (text) => String(text).split(' ').map((w) => (w.startsWith('-')
  ? `<span class="dv-nb">${esc(w)}</span>`
  : esc(w).replace(/\//g, '/<wbr>'))).join(' ');
const copyRow = (text, label) => `<div class="dv-copy"><code class="dv-code">${codeHtml(text)}</code><button type="button" class="btn sm" data-act="copy" aria-label="Copy ${esc(label)}">Copy</button></div>`;

// ---------------- the calm state without the server ----------------
function offlineHtml(why, at) {
  return `<section class="card dv-off reveal d1" aria-labelledby="dv-off-h">
    <div class="dv-off-main">
      <div class="micro dot">Device server · not running here</div>
      <h2 id="dv-off-h" class="dv-off-title">Live device data needs the local server</h2>
      <p class="muted">This page shows AirPods, Apple Watch and phone data arriving at this laptop and being saved, but only when the app is opened from the server on the laptop itself. Start it from the project folder:</p>
      <div class="dv-cmd">${copyRow('python run.py', 'the command')}</div>
      <p class="note">Then open <span class="mono">http://localhost:8765/#devices</span>. The app preview (serve.py) uses port 8765 too: stop it first, or run <span class="mono">python run.py --port 8790 --https-port 8490</span> and open <span class="mono">http://localhost:8790/#devices</span>.</p>
      <div class="row dv-off-check">
        <button type="button" class="btn" data-act="recheck">Check again</button>
        <span class="note" data-k="off-why">${esc(why)} Checked at ${esc(clockOf(at))}.</span>
      </div>
    </div>
    <div class="dv-off-side">
      <div class="micro">What it unlocks</div>
      <ul class="list dv-unlock">
        <li>The phone motion stream and the 10 m walking test, opened on the phone over the laptop's Wi-Fi</li>
        <li>AirPods and Apple Watch motion, through the free Sensor Logger iPhone app</li>
        <li>Each device's rate, and a live chart of how fast it turns</li>
        <li>Everything that arrives, saved in a local database (data/rfn.sqlite) with a CSV per session</li>
      </ul>
      <p class="note">The hosted copy of this app is a static demo. Browsers stop it from reaching other addresses and refuse it the motion sensors, so it cannot show device data. While the server is off, this page shows no readings at all, real or made up.</p>
    </div>
  </section>`;
}

// ---------------- the connected page ----------------
function onlineHtml(health) {
  const port = Number(health.httpPort) || Number(location.port) || DEFAULT_PORT;
  const simCmd = port === DEFAULT_PORT ? 'python server/simulate.py --seconds 30 --walk'
    : `python server/simulate.py --url http://localhost:${port} --seconds 30 --walk`;
  const count = (k, label) => `<div class="dv-count"><span class="micro">${label}</span><span class="stat" data-k="n-${k}">–</span><span class="dv-delta" data-k="d-${k}"></span></div>`;
  return `
  <section class="panel grid-bg dv-strip reveal d1" aria-label="Server, phone pages and database">
    <div class="dv-cell"><span class="micro live" data-k="srv-l">Server live</span><span class="stat-s" data-k="srv-v">Answering</span><span class="dv-cell-s" data-k="srv-s"></span></div>
    <div class="dv-cell"><span class="micro">Phone pages (HTTPS)</span><span class="stat-s" data-k="tls-v"></span><span class="dv-cell-s" data-k="tls-s"></span></div>
    <div class="dv-cell"><span class="micro">Database file</span><span class="stat-s" data-k="db-v">–</span><span class="dv-cell-s" data-k="db-s"></span></div>
    <div class="dv-cell"><span class="micro">Newest sample</span><span class="stat-s" data-k="new-v">–</span><span class="dv-cell-s" data-k="new-s"></span></div>
  </section>

  <section class="section reveal d2" aria-labelledby="dv-live-h" data-k="live">
    <div class="section-head"><h2 id="dv-live-h" tabindex="-1">Live devices</h2><span class="aside">Live: a sample arrived in the last 3 s. Rate: samples stored in the last 5 s, divided by 5.</span></div>
    <div class="dv-devs" data-k="devs" hidden></div>
    <div class="card dv-empty" data-k="devs-empty" hidden>
      <div class="stack">
        <div class="micro dot">No device yet</div>
        <p class="muted">No device has sent data to this server yet. Connect one with the addresses below, or try the whole path with simulated devices.</p>
      </div>
      <div class="row">
        <button type="button" class="btn" data-act="to-connect">Connect a device</button>
        <button type="button" class="btn" data-act="to-sim">Test it without hardware</button>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="dv-chart-h" data-k="chart" hidden>
    <div class="section-head"><h2 id="dv-chart-h">Turning speed, last 10 seconds</h2><span class="aside">One line per device that is sending</span></div>
    <div class="panel grid-bg dv-chart">
      <div class="dv-chart-head"><span class="micro dot" data-k="chart-l">Live stream</span><span class="dv-chart-unit">|g| in deg/s</span></div>
      <canvas class="dv-canvas" aria-hidden="true"></canvas>
      <ul class="list dv-legend" data-k="legend" aria-label="Latest turning speed of each device"></ul>
    </div>
    <p class="note dv-gap">|g| = √(gx² + gy² + gz²): how fast the device is turning, whatever the direction, from its gyroscope. These values are here to check the connection; the red-flag indicator does not use them.</p>
  </section>

  <section class="section" aria-labelledby="dv-connect-h" data-k="connect-sec">
    <div class="section-head"><h2 id="dv-connect-h" tabindex="-1">Connect a device</h2><span class="aside">This laptop's addresses, as the server reports them</span></div>
    <div data-k="connect"><p class="loading">Reading the addresses…</p></div>
  </section>

  <section class="section" aria-labelledby="dv-rec-h">
    <div class="section-head"><h2 id="dv-rec-h">Recording</h2><span class="aside">Optional: the database keeps everything either way</span></div>
    <div class="card dv-rec">
      <div class="dv-rec-text">
        <span class="micro dot" data-k="rec-l">Not recording</span>
        <p class="muted">A recording copies every sample from every device into one CSV file, in the recordings folder next to the database, until you stop it. Use it to keep one take as a separate file.</p>
        <div class="dv-rec-d" data-k="rec-d"></div>
        <p class="dv-msg" data-k="rec-msg" role="status"></p>
      </div>
      <div class="dv-rec-act">
        <button type="button" class="btn primary" data-act="rec-start" data-k="rec-start">Start recording</button>
        <button type="button" class="btn" data-act="rec-stop" data-k="rec-stop" hidden>Stop recording</button>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="dv-db-h">
    <div class="section-head"><h2 id="dv-db-h">Database</h2><span class="aside" data-k="db-at"></span></div>
    <div class="panel dv-counts" aria-label="Rows in each table">
      ${count('samples', 'Samples')}${count('sessions', 'Sessions')}${count('walks', 'Walks')}${count('home_results', 'Home-test results')}
    </div>
    <p class="note dv-gap" data-k="db-more"></p>
    <div class="section-head dv-subhead"><h3>Newest sessions</h3><span class="aside">A stream session ends after 20 s without samples. Each CSV downloads from this server.</span></div>
    <div class="table-wrap"><table class="tbl dv-sess">
      <thead><tr><th>Device</th><th>Session</th><th>Started</th><th>Ended</th><th class="num">Samples</th><th>Source</th><th><span class="dv-sr">Download</span></th></tr></thead>
      <tbody data-k="sess"><tr><td colspan="7" class="dv-none">Reading the database…</td></tr></tbody>
    </table></div>
  </section>

  <section class="section" aria-labelledby="dv-home-h">
    <div class="section-head"><h2 id="dv-home-h">Home-test results</h2><span class="aside">From this browser to the laptop's database</span></div>
    <div class="card card-pad dv-home">
      <div class="stack">
        <p class="muted">The working home tests save their results in this browser only. This copies them into the database, next to the device data. Sending the same results again adds nothing.</p>
        <p class="note" data-k="home-n"></p>
        <div class="row"><button type="button" class="btn primary" data-act="home-save" data-k="home-btn">Save this browser's home-test results to the database</button></div>
        <p class="dv-msg" data-k="home-msg" role="status"></p>
      </div>
    </div>
  </section>

  <section class="section" aria-labelledby="dv-sim-h" data-k="sim">
    <div class="section-head"><h2 id="dv-sim-h" tabindex="-1">Test it without hardware</h2><span class="aside">Simulated devices, through the same addresses real ones use</span></div>
    <div class="card dv-sim">
      <div class="dv-sim-cmd stack">
        <p class="muted">With this server running, open a second terminal in the project folder and run:</p>
        <div class="dv-cmd">${copyRow(simCmd, 'the simulator command')}</div>
        <p class="note">Every name it sends ends in (simulated), and every reading it makes is labelled Simulated here and in the database.</p>
      </div>
      <div class="dv-sim-exp">
        <div class="micro">What to expect</div>
        <ul class="list dv-expect">
          <li>One simulated 10 m walk arrives first: phone-walk (simulated), 816 samples, and Walks goes up by one.</li>
          <li>For 30 seconds, three simulated devices appear under Live devices: airpods (simulated) at about 25 Hz, watch (simulated) at about 50 Hz and phone (simulated) at about 60 Hz, each with its line on the chart.</li>
          <li>The database counts grow every 2 seconds, about 135 samples a second in all. When the run ends, the devices turn Idle and their rows stay, labelled simulated.</li>
        </ul>
      </div>
    </div>
  </section>`;
}

function connectHtml(info, health) {
  const httpsOn = Boolean(health.https) && info.httpsPort != null;
  const noHttps = 'HTTPS is off, so the phone pages get no motion data. Restart the server without --no-https.';
  const noLan = 'No network address found for this laptop. Join it to Wi-Fi or to the phone\'s hotspot, then restart python run.py.';
  const urls = (list, label, empty) => (Array.isArray(list) && list.length
    ? `<div class="list dv-urls">${list.map((u) => copyRow(String(u), label)).join('')}</div>`
    : `<p class="dv-msg warn">${esc(empty)}</p>`);
  const ports = [info.httpPort, httpsOn ? info.httpsPort : null].filter((p) => p != null).join(',');
  return `<div class="grid cols-12 dv-conn">
      <div class="span-5 stack dv-conn-left">
        <article class="card">
          <div class="card-head"><h3>Phone motion stream</h3><span class="aside micro dot" data-k="c-stream">Nothing yet</span></div>
          <div class="card-body stack">
            <p class="muted">Open this on the phone. It streams the phone's own gyroscope and accelerometer, about 60 times a second.</p>
            ${urls(info.gyroPhoneUrls, 'the phone motion address', httpsOn ? noLan : noHttps)}
            <p class="note">Tap Start motion sensors, then Allow on an iPhone.</p>
          </div>
        </article>
        <article class="card">
          <div class="card-head"><h3>Phone walking test</h3><span class="aside micro dot" data-k="c-walk">No walk yet</span></div>
          <div class="card-body stack">
            <p class="muted">The 10 m walking test, on the phone. Each walk arrives as one upload with its recording, so here it counts as Imported.</p>
            ${urls(info.phoneUrls, 'the walking test address', httpsOn ? noLan : noHttps)}
            <p class="note">To count a walk as this week's result, open <a href="/motion/receive.html">the walk results page</a> on this laptop and save it under the patient's name. Monitoring then charts it against the normal variation.</p>
          </div>
        </article>
      </div>
      <article class="card span-7">
        <div class="card-head"><h3>AirPods and Apple Watch, through Sensor Logger</h3><span class="aside micro dot" data-k="c-logger">Nothing yet</span></div>
        <div class="card-body stack">
          <p class="muted">Sensor Logger, a free iPhone app, reads the AirPods' head motion and the Watch's wrist motion and pushes them to this address. It uses plain HTTP, so it needs no certificate.</p>
          ${urls(info.sensorLoggerUrls, 'the Sensor Logger push address', noLan)}
          <ol class="list dv-steps" role="list">
            <li><b>Install Sensor Logger</b> from the App Store on the iPhone.</li>
            <li><b>Turn on a sensor.</b> Headphone, with the AirPods connected, for the AirPods. Wrist Motion for the Watch: pick the Phone &amp; Watch mode and keep the Watch app open.</li>
            <li><b>Settings, HTTP Push.</b> Turn it on, paste the address above as the push URL, then tap Tap to Test Pushing. A test push stores no samples.</li>
            <li><b>Start a recording.</b> The devices appear under Live devices as airpods, watch and phone (Sensor Logger).</li>
          </ol>
          <p class="note">The free version pushes about once a second, so its lines move in one-second steps.</p>
          <p class="dv-sl" data-k="c-logger-last"></p>
        </div>
      </article>
    </div>
    <ul class="list dv-tips" aria-label="If a device cannot connect">
      <li><b>Same network.</b> Put the phone and the laptop on the same Wi-Fi. Venue Wi-Fi often stops devices from reaching each other: then join the laptop to the phone's hotspot.</li>
      <li><b>Certificate.</b> The phone pages use this laptop's own certificate, so the phone warns once. Accept it: on an iPhone, Show Details, then visit this website; in Android Chrome, Advanced, then Proceed.</li>
      <li class="dv-tip-fw"><span><b>Windows Firewall.</b> Allow Python when Windows asks, on Public networks too (venue Wi-Fi and hotspots are often marked Public). If you dismissed it, run this in PowerShell as administrator:</span>
        ${copyRow(`New-NetFirewallRule -DisplayName "RFN one server" -Direction Inbound -Protocol TCP -LocalPort ${ports || DEFAULT_PORT} -Action Allow`, 'the firewall command')}</li>
    </ul>`;
}

// ---------------- mount ----------------
export function mount(root) {
  ensureCss('css/views/devices.css');
  let dead = false;
  const ac = new AbortController(); // every request of this view stops with it
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => { timers.delete(id); if (!dead) fn(); }, ms);
    timers.add(id);
    return id;
  };

  root.innerHTML = `<div class="dv">
    <header class="view-head reveal">
      <div class="micro dot">Devices · this laptop's server and database</div>
      <h1 class="title two-tone">Devices <span class="soft">and live data.</span></h1>
      <p class="lede">Check that AirPods, Apple Watch and phone data really arrive at this laptop and are saved in its database. Device data stays on the laptop, apart from the case file, and the red-flag indicator does not use it: it never changes the number.</p>
    </header>
    <div data-k="body"><p class="loading">Looking for the device server…</p></div>
    <p class="dv-sr" aria-live="polite" data-k="announce"></p>
  </div>`;
  const body = root.querySelector('[data-k="body"]');
  const announceEl = root.querySelector('[data-k="announce"]');
  const announce = (t) => { announceEl.textContent = t; };

  // ---- state ----
  const S = {
    phase: 'checking', health: null, info: null, sum: null, sumWall: 0, prevWall: 0, deltas: null,
    ok: true, lastOkWall: 0, sse: 'off',
    rec: { on: false, path: '', rows: 0, last: null, busy: false, msg: null },
    home: { busy: false, msg: null },
  };
  const devs = new Map();   // device id -> what is known about it
  const series = new Map(); // device id -> { style, pts: [{ x, v }], off }: chart data, last 12 s
  let R = {};               // data-k -> element, for the connected page
  let fx = null;
  let es = null;
  let tickId = 0;
  let lastWork = 0;
  const shown = new WeakMap(); // element -> what was last written, so unchanged parts are left alone
  const put = (el, value, asHtml = false) => {
    if (!el) return;
    const k = asHtml ? 'h' : 't';
    const c = shown.get(el) || {};
    if (c[k] === value) return;
    c[k] = value;
    shown.set(el, c);
    if (asHtml) el.innerHTML = value; else el.textContent = value;
  };
  const cls = (el, c) => { if (el && el.className !== c) el.className = c; };

  function dev(id) {
    let d = devs.get(id);
    if (!d) {
      d = { id, kind: kindOf(id), sim: isSimName(id), imported: isWalkName(id), stored: null, rate: null, lastP: -Infinity, g: null, dbFor: -1, el: null, f: null };
      devs.set(id, d);
    }
    return d;
  }
  const provOf = (d) => (d.sim ? 'simulated' : d.imported ? 'imported' : 'measured');
  // Live: a sample arrived in the last 3 s. A walk upload lands all at once, so it is never "Live".
  const isLive = (d, now) => !d.imported && now - d.lastP < LIVE_MS;

  // ---- the live stream (Server-Sent Events) ----
  function openStream() {
    if (es || dead || S.phase !== 'online') return;
    try { es = new EventSource('/events'); } catch { es = null; S.sse = 'off'; return; }
    S.sse = 'connecting';
    es.onopen = () => { S.sse = 'open'; paintServer(); };
    es.onerror = () => {
      if (!es) return;
      if (!S.ok) closeStream(); // the summary already says the server is gone
      else if (es.readyState === 2) { es = null; S.sse = 'off'; } else S.sse = 'retrying'; // 2: CLOSED
      paintServer();
    };
    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'batch') onBatch(msg);
      else if (msg.type === 'record') onRecordEvent(msg);
    };
  }
  function closeStream() {
    if (es) { es.onopen = null; es.onerror = null; es.onmessage = null; es.close(); es = null; }
    S.sse = 'off';
  }

  function pickStyle() {
    const used = new Set([...series.values()].map((s) => s.style));
    for (let i = 0; i < STYLES.length; i++) if (!used.has(i)) return i;
    return series.size % STYLES.length;
  }
  function trimSeries(now) {
    const cut = now - KEEP_MS;
    for (const [id, s] of series) {
      let i = 0;
      while (i < s.pts.length && s.pts[i].x < cut) i++;
      if (i) s.pts.splice(0, i);
      if (!s.pts.length) series.delete(id); // its style is free for the next device
    }
  }

  // One batch from one device. Samples carry the device's own clock (t, ms); the newest one is
  // pinned to the moment the batch arrived, and the offset keeps the fastest arrival seen, so
  // the line stays smooth however the batches bunch up on the network.
  function onBatch(msg) {
    const id = String(msg.source || 'unknown');
    const samples = Array.isArray(msg.samples) ? msg.samples.filter((s) => s && typeof s === 'object') : [];
    if (!samples.length) return;
    const now = performance.now();
    const d = dev(id);
    d.lastP = now;
    const pts = [];
    const tLast = fin(samples[samples.length - 1].t);
    let ser = series.get(id);
    let off = ser ? ser.off : null;
    if (tLast != null) {
      const est = now - tLast;
      if (off == null || est < off || est - off > 3000) off = est; // first batch, a faster one, or a clock jump
    }
    let latest = null;
    samples.forEach((s, i) => {
      const v = mag(s);
      if (v == null) return;
      const t = fin(s.t);
      const x = t != null && off != null ? Math.min(now, t + off) : now - (samples.length - 1 - i) * 16;
      pts.push({ x, v });
      latest = v;
    });
    if (latest == null) return; // no gyroscope in this batch: still counts as a sample for Live
    if (!ser) { ser = { style: pickStyle(), pts: [], off }; series.set(id, ser); }
    ser.off = off;
    for (const p of pts) ser.pts.push(p);
    d.g = { v: latest, p: now, wall: Date.now(), src: 'live' };
  }

  function onRecordEvent(msg) {
    if (msg.on) { S.rec.on = true; if (msg.path) S.rec.path = String(msg.path); }
    else {
      S.rec.on = false;
      if (msg.path) S.rec.last = { path: String(msg.path), rows: Number(msg.rows) || 0, seconds: Number(msg.seconds) || 0 };
    }
    paintRec();
  }

  // ---- the database summary, every 2 s ----
  async function poll() {
    let ok = false;
    try {
      const r = await request('/api/db/summary', { signal: ac.signal, timeout: 4500 });
      if (dead) return;
      if (r.ok && r.data && r.data.ok) { applySummary(r.data); ok = true; }
    } catch { if (dead) return; }
    if (ok) {
      if (!S.ok) announce('The device server is answering again.');
      S.ok = true;
      S.lastOkWall = Date.now();
      openStream();
      if (!S.info) loadInfo();
    } else {
      if (S.ok) announce('The device server stopped answering.');
      S.ok = false;
      closeStream(); // no retrying stream (one failed request a second) until the server answers again
    }
    paintAll();
    later(poll, ok ? POLL_MS : RETRY_MS);
  }

  function applySummary(sum) {
    const now = performance.now();
    if (S.sum && S.sum.counts && sum.counts) {
      S.deltas = {};
      for (const k of Object.keys(sum.counts)) S.deltas[k] = (Number(sum.counts[k]) || 0) - (Number(S.sum.counts[k]) || 0);
      S.prevWall = S.sumWall;
    }
    S.sum = sum;
    S.sumWall = Date.now();
    const sessKinds = new Map();
    for (const s of Array.isArray(sum.sessions) ? sum.sessions : []) {
      if (!s || typeof s.device_id !== 'string') continue;
      if (!sessKinds.has(s.device_id)) sessKinds.set(s.device_id, new Set());
      sessKinds.get(s.device_id).add(s.kind);
    }
    for (const x of Array.isArray(sum.devices) ? sum.devices : []) {
      if (!x || typeof x.id !== 'string') continue;
      const d = dev(x.id);
      d.kind = KIND_WORD[x.kind] ? x.kind : kindOf(x.id);
      d.sim = Boolean(x.simulated) || isSimName(x.id);
      if (Number.isFinite(x.samples)) d.stored = x.samples;
      d.rate = Number.isFinite(x.rate_hz) ? x.rate_hz : null;
      if (Number.isFinite(x.seconds_since_last)) d.lastP = Math.max(d.lastP, now - x.seconds_since_last * 1000);
      const k = sessKinds.get(x.id);
      d.imported = isWalkName(x.id) || Boolean(k && !k.has('stream') && (k.has('walk') || k.has('import')));
    }
    const rec = sum.stream && sum.stream.recording;
    if (rec && typeof rec === 'object') {
      S.rec.on = true;
      S.rec.path = String(rec.path || S.rec.path || '');
      S.rec.rows = Number(rec.rows) || 0;
    } else if (sum.stream && !S.rec.busy) S.rec.on = false;
    loadLastStored();
  }

  // A device with stored samples but no live value (a walk upload, a device from an earlier
  // run, or a stream this browser does not receive): show its newest stored sample instead.
  let loadingLast = false;
  async function loadLastStored() {
    if (loadingLast) return;
    loadingLast = true;
    try {
      const now = performance.now();
      const want = [...devs.values()].filter((d) => d.stored > 0 && d.dbFor !== d.stored
        && (!d.g || d.g.src === 'db' || (now - d.g.p > LIVE_MS && isLive(d, now)))).slice(0, 4);
      for (const d of want) {
        const r = await request(`/api/db/samples?device=${encodeURIComponent(d.id)}&limit=1`, { signal: ac.signal, timeout: 4000 });
        if (dead) return;
        d.dbFor = d.stored;
        const rows = r.ok && r.data && Array.isArray(r.data.samples) ? r.data.samples : [];
        const s = rows[rows.length - 1];
        const v = s ? mag(s) : null;
        const fresh = d.g && d.g.src === 'live' && performance.now() - d.g.p < LIVE_MS;
        if (v != null && !fresh) d.g = { v, p: -Infinity, wall: Number(s.received_at) * 1000, src: 'db' };
      }
    } catch { /* the next summary tries again */ } finally { loadingLast = false; }
  }

  async function loadInfo() {
    if (S.loadingInfo) return;
    S.loadingInfo = true;
    try {
      const r = await request('/api/info', { signal: ac.signal, timeout: 4000 });
      if (dead) return;
      if (r.ok && r.data && typeof r.data === 'object') {
        S.info = r.data;
        put(R.connect, connectHtml(S.info, S.health), true);
        Object.assign(R, keysIn(R.connect));
        paintConnect(performance.now());
      } else put(R.connect, '<p class="dv-msg warn">The server did not list its addresses. Trying again with the next update.</p>', true);
    } catch {
      if (!dead) put(R.connect, '<p class="dv-msg warn">The server did not list its addresses. Trying again with the next update.</p>', true);
    } finally { S.loadingInfo = false; }
  }

  // ---- painting ----
  const keysIn = (el) => { const o = {}; if (el) el.querySelectorAll('[data-k]').forEach((n) => { o[n.dataset.k] = n; }); return o; };

  function paintServer() {
    if (S.phase !== 'online') return;
    const h = S.health;
    cls(R['srv-l'], S.ok ? 'micro live' : 'micro dot');
    put(R['srv-l'], S.ok ? 'Server live' : 'Server');
    put(R['srv-v'], S.ok ? 'Answering' : '<span class="dv-warn">Not answering</span>', true);
    const stream = { open: 'connected', connecting: 'connecting', retrying: '<span class="dv-warn">reconnecting</span>', off: '<span class="dv-warn">off</span>' }[S.sse];
    put(R['srv-s'], S.ok
      ? `${esc(h.server)}, version ${esc(h.version)}. Live stream ${stream}.`
      : `Last answer at ${esc(clockOf(S.lastOkWall))}. Is python run.py still running? Trying again every ${RETRY_MS / 1000} s.`, true);
    const live = S.ok && S.sse === 'open';
    cls(R['chart-l'], live ? 'micro live' : 'micro dot');
    put(R['chart-l'], live ? 'Live stream' : S.sse === 'connecting' ? 'Live stream connecting' : 'Live stream <span class="dv-warn">not connected</span>', true);
  }

  function paintStatic() {
    const h = S.health;
    const info = S.info || {};
    const httpPort = info.httpPort ?? h.httpPort ?? (Number(location.port) || DEFAULT_PORT);
    const httpsPort = info.httpsPort ?? h.httpsPort;
    put(R['tls-v'], h.https ? `On <span class="stat-unit">port ${esc(httpsPort)}</span>` : '<span class="dv-warn">Off</span>', true);
    put(R['tls-s'], h.https
      ? `Phones open the motion pages over HTTPS. Plain HTTP on port ${esc(httpPort)} for this laptop and Sensor Logger.`
      : `Phones give motion data only to secure pages, so the phone pages cannot stream. Plain HTTP on port ${esc(httpPort)} still takes Sensor Logger.`, true);
  }

  function paintDb() {
    const sum = S.sum;
    if (!sum) return;
    const db = sum.db || {};
    const total = (Number(db.bytes) || 0) + (Number(db.wal_bytes) || 0);
    const [n, unit] = bytes(total);
    put(R['db-v'], `${esc(n)} <span class="stat-unit">${esc(unit)}</span>`, true);
    const wal = Number(db.wal_bytes) || 0;
    const errs = Number(sum.stream && sum.stream.db_errors) || 0;
    put(R['db-s'], `<span class="dv-path">${esc(db.path || '')}</span>${wal > 0 ? ` Includes ${esc(bytes(wal).join(' '))} of write-ahead log, folded into the file when the server stops.` : ''}${errs ? ` <span class="dv-warn">${esc(plural(errs, 'write'))} failed</span>${sum.stream.last_db_error ? `: ${esc(sum.stream.last_db_error)}` : ''}.` : ''}`, true);

    const c = sum.counts || {};
    const secs = S.prevWall ? Math.max(1, Math.round((S.sumWall - S.prevWall) / 1000)) : 0;
    for (const k of ['samples', 'sessions', 'walks', 'home_results']) {
      put(R[`n-${k}`], int(Number(c[k])));
      const dlt = S.deltas ? S.deltas[k] : null;
      const el = R[`d-${k}`];
      cls(el, dlt > 0 ? 'dv-delta up' : 'dv-delta');
      put(el, dlt == null ? 'First count' : dlt > 0 ? `+${int(dlt)} in the last ${secs} s` : dlt < 0 ? `${int(dlt)} in the last ${secs} s` : 'No change');
    }
    const cleared = (Number(c.walks) || 0) - (Number(sum.walks_not_cleared) || 0);
    put(R['db-more'], `Also stored: ${plural(Number(c.devices) || 0, 'device')} and ${plural(Number(c.events) || 0, 'event')} (button presses from the phone page).${cleared > 0 ? ` ${plural(cleared, 'walk')} cleared from the walk list, still stored.` : ''}`);
    put(R['db-at'], S.ok ? `Counted at ${clockOf(S.sumWall)}, every 2 s` : `Last counted at ${clockOf(S.sumWall)}`);
  }

  const sessRows = new Map(); // session id -> { tr, f }
  function paintSessions() {
    const tb = R.sess;
    if (!tb || !S.sum) return;
    const list = (Array.isArray(S.sum.sessions) ? S.sum.sessions : []).filter((s) => s && typeof s.id === 'string');
    if (!list.length) {
      sessRows.clear();
      put(tb, '<tr><td colspan="7" class="dv-none">No sessions yet. A session starts with a device\'s first sample.</td></tr>', true);
      return;
    }
    if (!sessRows.size) { tb.innerHTML = ''; shown.delete(tb); }
    const keep = new Set(list.map((s) => s.id));
    for (const [id, row] of sessRows) if (!keep.has(id)) { row.tr.remove(); sessRows.delete(id); }
    const now = Number(S.sum.time);
    let ref = tb.firstElementChild;
    for (const s of list) {
      let row = sessRows.get(s.id);
      if (!row) {
        const tr = document.createElement('tr');
        const d = devs.get(s.device_id);
        const sim = (d && d.sim) || isSimName(s.device_id);
        const prov = sim ? 'simulated' : s.kind === 'walk' || s.kind === 'import' ? 'imported' : 'measured';
        const href = typeof s.csv_url === 'string' && s.csv_url.startsWith('/api/db/sessions/') ? s.csv_url : `/api/db/sessions/${encodeURIComponent(s.id)}.csv`;
        tr.innerHTML = `<td><span class="dv-mono">${esc(s.device_id)}</span><span class="dv-sub">${esc(KIND_WORD[(d && d.kind) || kindOf(s.device_id)])}</span></td>
          <td>${esc(SESSION_WORD[s.kind] || s.kind || 'Session')}<span class="dv-sub dv-mono">${esc(s.id)}</span></td>
          <td class="dv-nowrap">${esc(clockOf(Number(s.started_at) * 1000))}</td>
          <td class="dv-nowrap" data-f="end"></td>
          <td class="num" data-f="n"></td>
          <td>${provChip(prov)}</td>
          <td><a href="${esc(href)}" download="${esc(s.id)}.csv" aria-label="Download session ${esc(s.id)} as CSV">CSV</a></td>`;
        row = { tr, f: keysF(tr) };
        sessRows.set(s.id, row);
      }
      const ongoing = s.kind === 'stream' && Number.isFinite(now) && now - Number(s.ended_at) <= SESSION_GAP_S;
      put(row.f.end, ongoing ? '<span class="micro live">Ongoing</span>'
        : `${esc(clockOf(Number(s.ended_at) * 1000))}<span class="dv-sub">${esc(span(Number(s.seconds)))}</span>`, true);
      put(row.f.n, int(Number(s.samples)));
      if (row.tr === ref) ref = ref.nextElementSibling;
      else tb.insertBefore(row.tr, ref);
    }
  }
  const keysF = (el) => { const o = {}; el.querySelectorAll('[data-f]').forEach((n) => { o[n.dataset.f] = n; }); return o; };

  function devCard(d) {
    const el = document.createElement('article');
    el.className = 'panel dv-dev';
    el.innerHTML = `
      <div class="dv-dev-top">
        <div class="dv-dev-id"><div class="dv-dev-name" data-f="name"></div><div class="micro" data-f="kind"></div></div>
        <span data-f="chip"></span>
      </div>
      <div class="dv-dev-state"><span class="micro dot" data-f="state">Idle</span><span class="dv-dev-ago" data-f="ago"></span></div>
      <div class="dv-dev-g"><span class="stat"><span data-f="g">–</span><span class="stat-unit">deg/s</span></span></div>
      <p class="dv-dev-gl" data-f="gl"></p>
      <div class="dv-dev-kvs">
        <div class="kv"><span>Rate, last 5 s</span><span class="v" data-f="rate">–</span></div>
        <div class="kv"><span>In the database</span><span class="v" data-f="stored">–</span></div>
      </div>`;
    d.el = el;
    d.f = keysF(el);
  }

  function paintDev(d, now) {
    const live = isLive(d, now);
    const prov = provOf(d);
    const f = d.f;
    put(f.name, d.id);
    put(f.kind, KIND_WORD[d.kind] || 'Other');
    put(f.chip, provChip(prov), true);
    cls(f.state, live ? 'micro live' : 'micro dot');
    put(f.state, live ? 'Live' : 'Idle');
    if (d.el.dataset.live !== String(live)) d.el.dataset.live = String(live);
    put(f.ago, d.imported ? (Number.isFinite(d.lastP) ? `last upload ${ago((now - d.lastP) / 1000)}` : 'no upload yet')
      : live ? 'receiving now' : Number.isFinite(d.lastP) ? `last sample ${ago((now - d.lastP) / 1000)}` : 'no samples yet');
    put(f.g, d.g ? gText(d.g.v) : '–');
    let gl = 'Turning speed |g|: no sample with a gyroscope reading yet.';
    if (d.g) {
      const what = prov === 'simulated' ? 'Simulated' : prov === 'imported' ? 'Imported walk upload' : `Measured by ${d.id}`;
      const when = d.g.src === 'db' ? `last stored ${clockOf(d.g.wall)}` : `${live && now - d.g.p < LIVE_MS ? 'received' : 'last received'} ${clockOf(d.g.wall)}`;
      gl = `Turning speed |g|. ${what}, ${when}.`;
    }
    put(f.gl, gl);
    // an upload's samples all land at once, so "samples in the last 5 s" is not a sensor rate
    put(f.rate, d.imported ? 'one upload' : !S.ok || d.rate == null ? (live ? 'measuring' : '–') : `${hzText(d.rate)} Hz`);
    put(f.stored, d.stored == null ? (live ? 'counting' : '–') : `${int(d.stored)} samples`);
  }

  function paintDevices(now) {
    const wrap = R.devs;
    if (!wrap) return;
    const list = [...devs.values()];
    list.sort((a, b) => {
      const la = isLive(a, now); const lb = isLive(b, now);
      if (la !== lb) return la ? -1 : 1;
      if (!la && a.lastP !== b.lastP) return b.lastP > a.lastP ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
    wrap.hidden = !list.length;
    R['devs-empty'].hidden = list.length > 0 || !S.sum; // not before the first count: no flash of "No device"
    R.chart.hidden = !list.length; // the chart appears with the first device
    let ref = wrap.firstElementChild;
    for (const d of list) {
      if (!d.el) devCard(d);
      paintDev(d, now);
      if (d.el === ref) ref = ref.nextElementSibling;
      else wrap.insertBefore(d.el, ref);
    }
  }

  let legendKey = null;
  function paintLegend(now) {
    const ul = R.legend;
    if (!ul) return;
    const items = [...series.entries()].sort((a, b) => a[1].style - b[1].style);
    const key = items.map(([id, s]) => `${s.style}:${id}`).join('|');
    if (key !== legendKey) {
      legendKey = key;
      ul.innerHTML = items.length
        ? items.map(([id, s]) => {
          const d = devs.get(id);
          return `<li class="dv-leg" data-id="${esc(id)}">${swatch(s.style)}<span class="dv-leg-name">${esc(id)}</span><span class="micro">${esc(KIND_WORD[d ? d.kind : kindOf(id)])}</span>${provChip(d ? provOf(d) : isSimName(id) ? 'simulated' : 'measured')}<span class="dv-leg-v" data-f="v"></span><span class="dv-leg-t" data-f="t"></span></li>`;
        }).join('')
        : '<li class="dv-leg-none">No live samples in the last 10 seconds. A line appears for each device as soon as it sends.</li>';
    }
    for (const li of ul.querySelectorAll('li[data-id]')) {
      const d = devs.get(li.dataset.id);
      if (!d || !d.g) continue;
      const f = keysF(li);
      put(f.v, `${gText(d.g.v)} deg/s`);
      put(f.t, `${isLive(d, now) ? 'received' : 'last received'} ${clockOf(d.g.wall)}`);
    }
  }

  function paintNewest(now) {
    let best = null;
    for (const d of devs.values()) if (Number.isFinite(d.lastP) && (!best || d.lastP > best.lastP)) best = d;
    if (!best) {
      put(R['new-v'], 'None yet');
      put(R['new-s'], 'Nothing has arrived. Connect a device below, or run the simulator.');
      return;
    }
    const age = (now - best.lastP) / 1000;
    const who = `${best.id}${best.sim && !isSimName(best.id) ? ' (simulated)' : ''}`;
    put(R['new-v'], age < 1 ? 'Just now' : ago(age));
    put(R['new-s'], best.imported ? `From ${who}, in one upload.` : `From ${who}${isLive(best, now) ? ', arriving now' : ''}.`);
  }

  function paintConnect(now) {
    if (!R['c-stream']) return;
    const groups = { stream: [], logger: [] };
    for (const d of devs.values()) {
      if (isWalkName(d.id)) continue;
      const n = d.id.toLowerCase();
      groups[n.includes('sensor logger') || d.kind === 'airpods' || d.kind === 'watch' ? 'logger' : 'stream'].push(d);
    }
    const word = (el, list) => {
      if (!list.length) { cls(el, 'aside micro dot'); put(el, 'Nothing yet'); return; }
      const newest = list.reduce((a, b) => (b.lastP > a.lastP ? b : a));
      const live = isLive(newest, now);
      cls(el, live ? 'aside micro live' : 'aside micro dot');
      put(el, live ? `Arriving now${newest.sim ? ', simulated' : ''}` : Number.isFinite(newest.lastP) ? `Last data ${ago((now - newest.lastP) / 1000)}` : 'Seen, no samples');
    };
    word(R['c-stream'], groups.stream);
    word(R['c-logger'], groups.logger);
    if (R['c-logger-last']) put(R['c-logger-last'], sensorLoggerLine(S.sum && S.sum.sensorLogger, Date.now()), true);
    const w = S.sum && S.sum.newest_walk;
    const at = w && Date.parse(w.receivedAt);
    put(R['c-walk'], w ? `Newest walk ${Number.isFinite(at) ? clockOf(at) : ''}${w.simulated ? ', simulated' : ''}` : 'No walk yet');
  }

  function paintRec() {
    if (S.phase !== 'online' || !R['rec-l']) return;
    const r = S.rec;
    cls(R['rec-l'], r.on ? 'micro live' : 'micro dot');
    put(R['rec-l'], r.on ? 'Recording' : 'Not recording');
    let d = '';
    if (r.on) d = `<div class="kv"><span>File</span><span class="v dv-path-v">${esc(r.path || 'starting')}</span></div><div class="kv"><span>Rows so far</span><span class="v">${esc(int(r.rows))}</span></div>`;
    else if (r.last) d = `<div class="kv"><span>Last recording</span><span class="v">${esc(plural(r.last.rows, 'row'))} in ${esc(span(r.last.seconds))}</span></div><div class="kv"><span>Saved to</span><span class="v dv-path-v">${esc(r.last.path)}</span></div>`;
    put(R['rec-d'], d, true);
    R['rec-start'].hidden = r.on;
    R['rec-stop'].hidden = !r.on;
    R['rec-start'].disabled = r.busy || !S.ok;
    R['rec-stop'].disabled = r.busy || !S.ok;
    cls(R['rec-msg'], `dv-msg${r.msg && r.msg.tone ? ` ${r.msg.tone}` : ''}`);
    put(R['rec-msg'], r.msg ? r.msg.text : '');
  }

  function paintHome() {
    if (S.phase !== 'online' || !R['home-n']) return;
    const h = readHome();
    const inDb = S.sum ? Number(S.sum.home_results) : NaN;
    const dbText = Number.isFinite(inDb) ? ` The database holds ${plural(inDb, 'home-test result')}.` : '';
    put(R['home-n'], h.blocked
      ? `This browser is not letting the app read its saved results (privacy settings or a sandboxed page), so there is nothing to send.${dbText}`
      : h.rows.length
        ? `This browser holds ${plural(h.rows.length, 'home-test result')}: ${h.parts.join(', ')}.${dbText}`
        : `This browser holds no home-test results yet. Run a test on the Monitoring page first.${dbText}`);
    R['home-btn'].disabled = S.home.busy || h.blocked || !h.rows.length || !S.ok;
    cls(R['home-msg'], `dv-msg${S.home.msg && S.home.msg.tone ? ` ${S.home.msg.tone}` : ''}`);
    put(R['home-msg'], S.home.msg ? S.home.msg.text : '');
  }

  function paintAll() {
    if (S.phase !== 'online') return;
    const now = performance.now();
    paintServer();
    paintDb();
    paintSessions();
    paintRec();
    paintHome();
    paintTick(now);
  }
  function paintTick(now) {
    paintDevices(now);
    paintLegend(now);
    paintNewest(now);
    paintConnect(now);
  }

  function tick() {
    if (dead || S.phase !== 'online') return;
    const now = performance.now();
    const reduced = prefersReducedMotion();
    if (reduced && now - lastWork < 950) return; // calmer: once a second
    lastWork = now;
    trimSeries(now);
    paintTick(now);
    if (fx && fx.state.reduced) fx.renderOnce(); // no animation loop: one still frame a second
  }

  // ---- the chart (createEffect: DPR sizing, draws only while on screen, still with reduced motion) ----
  function chartSetup(c, st) {
    const p = palette();
    st.data.col = STYLES.map((s) => p[s.key] || p.panelInk);
    st.data.grid = rgba(p.panelInk || '#F6EEE5', 0.08);
    st.data.tick = p.panelInk3;
    st.data.text = p.panelInk2;
    st.data.mono = cssVar('--font-mono') || 'monospace';
    st.data.sans = cssVar('--font-sans') || 'sans-serif';
  }
  function chartDraw(c, st) {
    const d = st.data;
    const w = st.w; const h = st.h;
    c.clearRect(0, 0, w, h);
    const now = performance.now();
    const L = 42; const R0 = 12; const T = 10; const B = 24;
    const pw = Math.max(10, w - L - R0); const ph = Math.max(10, h - T - B);
    const x0 = now - WINDOW_MS;
    const X = (x) => L + ((x - x0) / WINDOW_MS) * pw;
    const list = [...series.values()].sort((a, b) => a.style - b.style);
    let top = 0;
    for (const s of list) for (const p of s.pts) if (p.x >= x0 && p.v > top) top = p.v;
    const target = niceCeil(Math.max(20, top * 1.12));
    if (!d.ymax || st.reduced || !st.frame) d.ymax = target;
    else d.ymax += (target - d.ymax) * Math.min(1, st.dt * 4); // ease the scale, never jump
    const ymax = d.ymax;
    const Y = (v) => T + (1 - Math.min(v, ymax) / ymax) * ph;

    c.lineWidth = 1;
    c.strokeStyle = d.grid;
    c.fillStyle = d.tick;
    c.font = `500 10.5px ${d.mono}`;
    c.textAlign = 'right';
    c.textBaseline = 'middle';
    const step = niceStep(ymax / 4);
    for (let v = 0; v <= ymax + 1e-6; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      c.beginPath(); c.moveTo(L, y); c.lineTo(L + pw, y); c.stroke();
      c.fillText(String(Math.round(v)), L - 8, y);
    }
    for (let k = 0; k <= 10; k++) { // a faint line per second, stronger at 10 s, 5 s and now
      const x = Math.round(L + (k / 10) * pw) + 0.5;
      c.globalAlpha = k % 5 === 0 ? 1 : 0.4;
      c.beginPath(); c.moveTo(x, T); c.lineTo(x, T + ph); c.stroke();
    }
    c.globalAlpha = 1;
    c.textBaseline = 'alphabetic';
    c.textAlign = 'left'; c.fillText('10 s ago', L, h - 6);
    c.textAlign = 'center'; c.fillText('5 s ago', L + pw / 2, h - 6);
    c.textAlign = 'right'; c.fillText('now', L + pw, h - 6);

    c.save();
    c.beginPath(); c.rect(L, T - 3, pw + 4, ph + 6); c.clip();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    for (const s of list) {
      const sty = STYLES[s.style % STYLES.length];
      const col = d.col[s.style % STYLES.length];
      c.strokeStyle = col;
      c.lineWidth = sty.w;
      c.setLineDash(sty.dash);
      c.beginPath();
      let prev = null;
      for (const p of s.pts) {
        if (p.x < x0 - GAP_MS) continue;
        const px = X(p.x); const py = Y(p.v);
        if (!prev || p.x - prev.x > GAP_MS) c.moveTo(px, py); else c.lineTo(px, py);
        prev = p;
      }
      c.stroke();
      if (prev && now - prev.x < LIVE_MS) { // the newest point of a device that is still sending
        c.setLineDash([]);
        c.fillStyle = col;
        c.beginPath(); c.arc(X(prev.x), Y(prev.v), 2.8, 0, Math.PI * 2); c.fill();
      }
    }
    c.restore();
    c.setLineDash([]);
    if (!list.length) {
      c.fillStyle = d.text;
      c.font = `500 13px ${d.sans}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(S.ok ? 'Waiting for live samples' : 'The server is not answering', L + pw / 2, T + ph / 2);
    }
  }

  // ---- actions ----
  async function copyFrom(btn) {
    const code = btn.closest('.dv-copy') && btn.closest('.dv-copy').querySelector('code');
    const text = code ? code.textContent.trim() : '';
    if (!text) return;
    let done = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); done = true; }
    } catch { done = false; }
    if (dead) return;
    if (!done) { // no clipboard here (plain HTTP on another device, a refused permission): select it instead
      try {
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        done = document.execCommand('copy');
      } catch { done = false; }
    }
    btn.textContent = done ? 'Copied' : 'Selected';
    announce(done ? 'Copied.' : 'Selected: press Ctrl+C to copy it.');
    later(() => { btn.textContent = 'Copy'; }, 1800);
  }

  async function recheck(btn) {
    btn.disabled = true;
    const why = root.querySelector('[data-k="off-why"]');
    if (why) why.textContent = 'Checking…';
    const r = await checkHealth(ac.signal);
    if (dead || !r) return;
    if (r.ok) { announce('The device server answered.'); goOnline(r.health); return; }
    goOffline(r.why);
    const again = root.querySelector('[data-act="recheck"]');
    if (again) again.focus();
    announce('Still no device server.');
  }

  async function setRecording(on) {
    if (S.rec.busy) return;
    S.rec.busy = true;
    S.rec.msg = null;
    paintRec();
    try {
      const r = await request('/record', { method: 'POST', body: { on }, signal: ac.signal, timeout: 6000 });
      if (dead) return;
      const j = r.data || {};
      if (!r.ok) throw new Error(j.error || `the server answered ${r.status}`);
      if (on) {
        S.rec.on = true;
        S.rec.path = String(j.path || '');
        S.rec.rows = 0;
        S.rec.msg = { tone: 'ok', text: 'Recording started.' };
      } else {
        S.rec.on = false;
        const res = j.result;
        if (res && res.path) {
          S.rec.last = { path: String(res.path), rows: Number(res.rows) || 0, seconds: Number(res.seconds) || 0 };
          S.rec.msg = { tone: 'ok', text: `Saved ${plural(S.rec.last.rows, 'row')} to the CSV file.` };
        } else S.rec.msg = { tone: '', text: 'No recording was running.' };
      }
      // rec-msg is a role="status" region, so the message is read once without announce()
    } catch (e) {
      if (dead) return;
      S.rec.msg = { tone: 'warn', text: `Could not ${on ? 'start' : 'stop'} the recording: ${failWord(e)}.` };
    } finally {
      if (!dead) { S.rec.busy = false; paintRec(); }
    }
  }

  async function saveHome() {
    if (S.home.busy) return;
    const h = readHome();
    if (h.blocked || !h.rows.length) { paintHome(); return; }
    S.home.busy = true;
    S.home.msg = { tone: '', text: `Sending ${plural(h.rows.length, 'result')}…` };
    paintHome();
    let stored = 0; let fresh = 0; let skipped = 0; let total = null;
    try {
      for (let i = 0; i < h.rows.length; i += HOME_CHUNK) {
        const r = await request('/api/home-results', { method: 'POST', body: { rows: h.rows.slice(i, i + HOME_CHUNK) }, signal: ac.signal, timeout: 15000 });
        if (dead) return;
        if (!r.ok || !r.data || !r.data.ok) throw new Error((r.data && r.data.error) || `the server answered ${r.status}`);
        stored += Number(r.data.stored) || 0;
        fresh += Number(r.data.new) || 0;
        skipped += Number(r.data.skipped) || 0;
        total = Number(r.data.total);
      }
      S.home.msg = { tone: 'ok', text: `Stored ${stored} of ${plural(h.rows.length, 'result')} (${fresh} new${skipped ? `, ${skipped} skipped` : ''}). The database now holds ${plural(total, 'home-test result')} in total.` };
      if (S.sum) S.sum.home_results = total;
    } catch (e) {
      if (dead) return;
      S.home.msg = { tone: 'warn', text: `The results were not saved: ${failWord(e)}.` };
    } finally {
      if (!dead) { S.home.busy = false; paintHome(); } // home-msg is a role="status" region: read once
    }
  }

  function jumpTo(k) {
    const sec = R[k];
    if (!sec) return;
    sec.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    const h2 = sec.querySelector('h2');
    if (h2) h2.focus({ preventScroll: true });
  }

  const onClick = (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-act]') : null;
    if (!b || !root.contains(b) || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'copy') copyFrom(b);
    else if (act === 'recheck') recheck(b);
    else if (act === 'rec-start') setRecording(true);
    else if (act === 'rec-stop') setRecording(false);
    else if (act === 'home-save') saveHome();
    else if (act === 'to-sim') jumpTo('sim');
    else if (act === 'to-connect') jumpTo('connect-sec');
  };
  root.addEventListener('click', onClick);
  const onStorage = () => paintHome(); // results saved in another tab
  window.addEventListener('storage', onStorage);

  // ---- phases ----
  function goOffline(why) {
    S.phase = 'offline';
    body.innerHTML = offlineHtml(why, Date.now());
  }
  function goOnline(health) {
    S.phase = 'online';
    S.health = health;
    S.ok = true;
    S.lastOkWall = Date.now();
    body.innerHTML = onlineHtml(health);
    R = keysIn(body);
    fx = createEffect(body.querySelector('.dv-canvas'), { interactive: false, setup: chartSetup, draw: chartDraw });
    paintStatic();
    paintServer();
    paintAll();
    loadInfo();
    poll();
    tickId = setInterval(tick, TICK_MS);
  }

  (async () => {
    const r = await checkHealth(ac.signal);
    if (dead || !r) return;
    if (r.ok) goOnline(r.health); else goOffline(r.why);
  })();

  return {
    update() { /* device data belongs to the laptop, not to the case picked in the top bar */ },
    unmount() {
      dead = true;
      ac.abort();
      closeStream();
      clearInterval(tickId);
      for (const id of timers) clearTimeout(id);
      timers.clear();
      if (fx) { fx.destroy(); fx = null; }
      root.removeEventListener('click', onClick);
      window.removeEventListener('storage', onStorage);
    },
  };
}
