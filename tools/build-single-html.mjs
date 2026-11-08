// Builds the whole app as ONE self-contained HTML file: dist/Red-Flag-Navigator.html.
// It opens by double-click (file://), offline, with every screen, number and case the
// hosted copy has. No libraries and no build step for the app itself:
// - every ES module the app can load (static and dynamic imports, from js/app/shell.js) is
//   embedded as a data: URL, and an import map wires the modules together;
// - css/app.css is inlined, and the view stylesheets that ensureCss() loads are embedded
//   and added as <style> elements instead of <link>s;
// - links to the old standalone method page point at the Evidence screen instead.
// Fonts still come from Google Fonts when online; offline the system fallbacks are used.
// Run from the project folder:  node tools/build-single-html.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const OUT_DIR = join(ROOT, 'dist');
const OUT = join(OUT_DIR, 'Red-Flag-Navigator.html');
const ENTRY = 'js/app/shell.js';
const read = (p) => readFileSync(join(APP, p), 'utf8');
const key = (p) => `@rfn/${p}`;
const fail = (msg) => { console.error(`build failed: ${msg}`); process.exit(1); };

// import statements at the start of a line (possibly over several lines), and import('...')
const STATIC_RE = /^(\s*import\s+(?:[^;'"]*?\s+from\s+)?)(['"])(\.{1,2}\/[^'"]+)\2/gm;
const EXPORT_FROM_RE = /^(\s*export\s+(?:\*|\{[^}]*\})\s+from\s+)(['"])(\.{1,2}\/[^'"]+)\2/gm;
const DYN_RE = /\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;
const resolve = (from, spec) => posix.normalize(posix.join(posix.dirname(from), spec));

// 1. walk the module graph from the entry
const seen = new Map(); // path -> source
const queue = [ENTRY];
while (queue.length) {
  const p = queue.shift();
  if (seen.has(p)) continue;
  let src;
  try { src = read(p); } catch { fail(`cannot read ${p}`); }
  seen.set(p, src);
  for (const re of [STATIC_RE, EXPORT_FROM_RE]) for (const m of src.matchAll(re)) queue.push(resolve(p, m[3]));
  for (const m of src.matchAll(DYN_RE)) queue.push(resolve(p, m[2]));
}

// 2. transform each module: specifiers to import-map keys, plus two small source patches
let patchedCss = false;
const map = {};
for (const [p, original] of seen) {
  let src = original;
  if (p === 'js/app/ui.js') {
    const anchor = 'export function ensureCss(href) {';
    if (!src.includes(anchor)) fail('ensureCss() not found in js/app/ui.js');
    src = src.replace(anchor, `${anchor}
  // single-file build: the stylesheet is embedded; add it as a <style> once
  const inl = typeof window !== 'undefined' && window.__RFN_CSS ? window.__RFN_CSS[href] : undefined;
  if (inl != null) {
    if (!document.querySelector(\`style[data-view-css="\${href}"]\`)) { const s = document.createElement('style'); s.dataset.viewCss = href; s.textContent = inl; document.head.appendChild(s); }
    return;
  }`);
    patchedCss = true;
  }
  src = src.replace(/href="method\.html"/g, 'href="#evidence"');
  src = src.replace(STATIC_RE, (m0, head, q, spec) => `${head}${q}${key(resolve(p, spec))}${q}`);
  src = src.replace(EXPORT_FROM_RE, (m0, head, q, spec) => `${head}${q}${key(resolve(p, spec))}${q}`);
  src = src.replace(DYN_RE, (m0, q, spec) => `import(${q}${key(resolve(p, spec))}${q})`);
  if (/(?:from\s+|import\(\s*|import\s+)['"]\.{1,2}\//.test(src)) fail(`a relative import was left in ${p}`);
  map[key(p)] = `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;
}
if (!patchedCss) fail('js/app/ui.js is not in the module graph');

// 3. stylesheets: app.css inline; every view stylesheet embedded for ensureCss()
const appCss = read('css/app.css');
if (/@import/.test(appCss)) fail('css/app.css uses @import');
const viewCss = {};
for (const f of readdirSync(join(APP, 'css', 'views'))) if (f.endsWith('.css')) viewCss[`css/views/${f}`] = read(`css/views/${f}`);
for (const p of seen.keys()) {
  for (const m of seen.get(p).matchAll(/['"](css\/views\/[a-z0-9_-]+\.css)['"]/g)) if (!(m[1] in viewCss)) fail(`${p} needs ${m[1]}, which does not exist`);
}
const safe = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');

// 4. the fallback banner: from disk this file works, so no "start the server" message
let fallback = read('js/fallback.js');
const fbAnchor = "if (location.protocol === 'file:') {";
if (!fallback.includes(fbAnchor)) fail('file: check not found in js/fallback.js');
fallback = fallback.replace(fbAnchor, "if (location.protocol === 'file:' && !window.RFN_SINGLE_FILE) {")
  .replace("show(location.protocol === 'file:' ? serverMsg :", "show(location.protocol === 'file:' && !window.RFN_SINGLE_FILE ? serverMsg :");

// 5. the page
let html = read('index.html');
const swap = (from, to) => { if (!html.includes(from)) fail(`index.html: not found: ${from}`); html = html.replace(from, () => to); };
const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
swap('<head>', `<head>\n  <!-- Red-Flag Navigator, single-file build ${stamp} UTC (node tools/build-single-html.mjs). ${seen.size} modules embedded. -->`);
swap('<link rel="stylesheet" href="css/app.css">', `<style data-file="css/app.css">\n${safe(appCss)}\n</style>`);
swap('<script src="js/fallback.js"></script>', `<script>window.RFN_SINGLE_FILE = true;</script>\n  <script>\n${safe(fallback)}\n</script>`);
swap('<script type="module" src="js/app/shell.js" onerror="rfnFail()"></script>',
  `<script>window.__RFN_CSS = ${safe(JSON.stringify(viewCss))};</script>
  <script type="importmap">${JSON.stringify({ imports: map })}</script>
  <script type="module">import '${key(ENTRY)}';</script>`);
swap('Run <code>python serve.py</code> and open http://localhost:8765.', 'Please allow JavaScript for this file.');

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html);
const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`wrote ${OUT}`);
console.log(`${seen.size} modules, ${Object.keys(viewCss).length} view stylesheets, ${kb(Buffer.byteLength(html))}`);
console.log([...seen.keys()].sort().join('\n'));
