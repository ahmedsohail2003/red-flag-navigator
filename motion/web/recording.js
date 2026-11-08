// recording.js: read a walk recorded by another tool and turn it into the walk recording of
// motion/CONTRACT.md section 2, with samples in section 1 units:
//   t in ms (increasing), ax/ay/az with gravity and lx/ly/lz without it in m/s^2, gx/gy/gz in deg/s.
// Pure ES module with no imports. It runs in the browser and in Node, and it never throws:
// bad input gives { ok: false, error } with the error in plain words.
//
// Formats are detected from the content (the header row or the JSON shape). The file name is only used
// to tell Sensor Logger's per-sensor files apart, because they all share the same columns.
//
//   rfn-json           our own recording JSON (kind "rfn-walk-recording"), checked and passed through.
//                      A saved walk record (kind "rfn-walk", from GET /api/walks/<id>) is unwrapped.
//   gyro-starter-csv   gyro-starter/server.py recordings. Header (server.py FIELDS):
//                      server_time,source,kind,t,gx,gy,gz,ax,ay,az,lx,ly,lz,oa,ob,og,event
//                      Rows have kind "sample" or "event"; an event row holds the button press as JSON in
//                      the event column. Units are already ms, deg/s and m/s^2.
//   sensor-logger-csv  Sensor Logger "CSV in Zip File" export, unzipped: one file per sensor with the columns
//                      time (UTC epoch ns), seconds_elapsed (s), x, y, z (read by name, so order does not matter).
//                      Accelerometer.csv has no gravity, TotalAcceleration.csv (Android) has it, Gravity.csv
//                      is separate, all in m/s^2; Gyroscope.csv is in rad/s.
//                      Source: github.com/tszheichoi/awesome-sensor-logger/blob/main/UNITS.md
//   phyphox-csv        phyphox CSV export ("Raw Data.csv"). Header labels from phyphox's own experiment files
//                      (github.com/phyphox/phyphox-experiments): "Time (s)", "Acceleration x (m/s^2)" (with g),
//                      "Linear Acceleration x (m/s^2)" (without g), "Gyroscope x (rad/s)". The writer
//                      (phyphox-android DataExport.java) quotes each header, uses "0.000000000E0" numbers,
//                      writes NaN for empty cells, and offers comma, tab or semicolon separators with a
//                      decimal point or (tab and semicolon only) a decimal comma.

const RAD_TO_DEG = 180 / Math.PI;
const STANDARD_GRAVITY = 9.80665;
const MAX_ROWS = 200000;
// Sensor files are merged onto the acceleration file's times by LINEAR INTERPOLATION between the two readings
// either side, but only when those two are at most MERGE_MAX_SPAN_MS apart (a longer wait is a dropout, which
// gives null). Before the first or after the last reading, the nearest one is used if it is within MERGE_EDGE_MS.
const MERGE_MAX_SPAN_MS = 250;
const MERGE_EDGE_MS = 10;
// A start or end mark more than this far outside the readings is on another clock, so it is dropped.
const MARKER_SLACK_MS = 5000;

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const STOP_BY = ['tap', 'auto', 'timeout'];
const PLACEMENTS = ['waist', 'pocket', 'hand'];
const FORMATS = ['rfn-json', 'gyro-starter-csv', 'sensor-logger-csv', 'phyphox-csv']; // priority when mixed
const LABEL = {
  'rfn-json': 'walk recording (.json)',
  'gyro-starter-csv': 'gyro-starter',
  'sensor-logger-csv': 'Sensor Logger',
  'phyphox-csv': 'phyphox',
};
const ID_PREFIX = { 'rfn-json': 'js', 'gyro-starter-csv': 'gs', 'sensor-logger-csv': 'sl', 'phyphox-csv': 'px' };
const KIND_LABEL = { total: 'acceleration with gravity', linear: 'acceleration', gravity: 'gravity', gyro: 'gyroscope' };
const ACCEPTS = 'a walk saved by this page (.json), a gyro-starter recording (.csv), ' +
  'Sensor Logger CSV files (unzipped), or a phyphox CSV export';

const PHYPHOX_TIME = /^(time|t)\s*\((s|ms)\)$/;
const PHYPHOX_DATA = /^(linear acceleration|acceleration|gyroscope)\s*([xyz])\s*\(([^)]*)\)$/;

/**
 * files: [{ name, text }] (text is the file's contents as a string).
 * Returns { ok, recording, format, warnings: [], error }.
 */
export function parseRecording(files) {
  const warnings = [];
  try {
    return parseFiles(files, warnings);
  } catch (_) {
    return failed(warnings, 'Could not read these files. Choose ' + ACCEPTS + '.');
  }
}

function failed(warnings, error, format = null) {
  return { ok: false, recording: null, format, warnings, error };
}

function parseFiles(files, warnings) {
  const input = Array.isArray(files) ? files : (files && typeof files === 'object' ? [files] : []);
  const list = [];
  for (const f of input) {
    if (!f || typeof f !== 'object' || typeof f.text !== 'string') continue;
    list.push({ name: baseName(typeof f.name === 'string' ? f.name : ''), text: f.text });
  }
  if (!list.length) {
    return failed(warnings, (input.length ? 'Could not read the chosen file as text.' : 'No file was chosen.') +
      ' Choose ' + ACCEPTS + '.');
  }

  const seen = list.map(sniff);
  const known = seen.filter((s) => s.format);
  if (!known.length) {
    const why = seen.slice(0, 3).map((s) => (seen.length > 1 && s.file.name ? s.file.name + ': ' : '') + s.why);
    return failed(warnings, why.join(' ') + ' Choose ' + ACCEPTS + '.');
  }
  const format = FORMATS.find((f) => known.some((s) => s.format === f));
  const chosen = known.filter((s) => s.format === format);
  if (known.length > chosen.length) {
    warnings.push(`These files are in different formats. Only the ${LABEL[format]} files were used.`);
  }
  const unused = seen.filter((s) => s.format !== format);
  if (unused.length) warnings.push('Not used: ' + unused.map((s) => s.file.name || 'a file with no name').join(', ') + '.');
  for (const s of chosen) {
    if (s.table && s.table.truncated) {
      warnings.push(`${s.file.name || 'This file'} has more than ${MAX_ROWS} rows. Only the first ${MAX_ROWS} were read.`);
    }
  }

  let out;
  if (format === 'rfn-json') out = fromRfn(chosen, warnings);
  else if (format === 'gyro-starter-csv') out = fromGyroStarter(chosen, warnings);
  else if (format === 'sensor-logger-csv') out = fromSensorLogger(chosen, warnings);
  else out = fromPhyphox(chosen, warnings);
  if (out.error) return failed(warnings, out.error, format);

  const samples = cleanSamples(out.samples, warnings);
  if (!samples.length) return failed(warnings, 'This file has no motion readings.', format);

  const usedFiles = chosen.map((s) => s.file);
  const recording = {
    v: 1,
    kind: 'rfn-walk-recording',
    id: out.id || makeId(format, usedFiles),
    createdAt: out.createdAt || null,
    device: out.device || { ua: '', importedFrom: format, files: usedFiles.map((f) => f.name) },
    distance_m: out.distance_m == null ? null : out.distance_m, // the laptop page asks for it when null
    placement: out.placement || null,
    goT: out.goT == null ? null : out.goT,
    stopT: out.stopT == null ? null : out.stopT,
    stopBy: out.stopBy || null,
    samples,
  };
  if (out.truth) recording.truth = out.truth;
  if (out.simulated) recording.simulated = true;
  checkMarkers(recording, warnings);
  return { ok: true, recording, format, warnings, error: null };
}

// ---------------------------------------------------------------- detection

function sniff(file) {
  let text = file.text;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (!text.trim()) return { file, format: null, why: 'This file is empty.' };
  if (text.startsWith('PK\u0003\u0004')) {
    return { file, format: null, why: 'This is a zip file. Unzip it first, then choose the CSV files inside.' };
  }
  if (looksBinary(text)) return { file, format: null, why: 'This is not a text file.' };

  const start = text.trimStart();
  if (start[0] === '{' || start[0] === '[') {
    let obj;
    try {
      obj = JSON.parse(start);
    } catch (_) {
      return { file, format: null, why: 'This JSON file could not be read. It may be cut off.' };
    }
    if (isRfn(obj)) return { file, format: 'rfn-json', rec: obj, wrapper: null };
    if (obj && typeof obj === 'object' && obj.kind === 'rfn-walk' && isRfn(obj.recording)) {
      return { file, format: 'rfn-json', rec: obj.recording, wrapper: obj };
    }
    return { file, format: null, why: 'This JSON file is not a walk recording.' };
  }

  // CSV. Old Mac files end lines with \r only.
  if (text.indexOf('\n') < 0 && text.indexOf('\r') >= 0) text = text.replace(/\r/g, '\n');
  const nl = text.indexOf('\n');
  const firstLine = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, '');
  const sep = detectSeparator(firstLine);
  const table = parseCsv(text, sep);
  const header = (table.header || []).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const has = (...names) => names.every((n) => lower.includes(n));
  let format = null;
  if (has('server_time', 'source', 'kind', 't')) {
    format = 'gyro-starter-csv';
  } else if (has('seconds_elapsed') || (has('time', 'x', 'y', 'z') && firstValue(table, lower.indexOf('time')) > 1e15)) {
    format = 'sensor-logger-csv';
  } else if (lower.some((h) => PHYPHOX_TIME.test(h)) && lower.some((h) => PHYPHOX_DATA.test(h))) {
    format = 'phyphox-csv';
  }
  if (!format) {
    const hasTime = lower.some((h) => /(^|[^a-z])(t|time|timestamp)([^a-z]|$)/.test(h));
    return {
      file, format: null,
      why: hasTime ? 'This CSV file is not in a layout this page knows.' : 'This CSV file has no time column.',
    };
  }
  return { file, format, sep, header, lower, table };
}

function isRfn(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) &&
    obj.kind === 'rfn-walk-recording' && Array.isArray(obj.samples);
}

function looksBinary(text) {
  const n = Math.min(text.length, 4096);
  let bad = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0) return true;
    if ((c < 32 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffd) bad++;
  }
  return bad > n * 0.02;
}

function firstValue(table, col) {
  if (col < 0) return null;
  for (const r of table.rows) {
    const v = num(r[col]);
    if (v !== null) return v;
  }
  return null;
}

// ---------------------------------------------------------------- CSV

function detectSeparator(line) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const c of line) {
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  let best = ',';
  for (const c of [';', '\t']) if (counts[c] > counts[best]) best = c;
  return best;
}

// RFC 4180: a field may be quoted, a doubled "" inside quotes is one ", and a quoted field may hold a line
// break. Reads at most MAX_ROWS data rows after the header and skips blank lines.
// No field in these formats spans many lines, so a quote still open after MAX_JOIN_LINES more lines is a stray
// quote: that line is then read on its own. (Review fix: joining to the end of the file swallowed every later
// row into one field, and re-counting quotes over the growing line made a big file freeze the page.)
const MAX_JOIN_LINES = 50;
function parseCsv(text, sep) {
  const rows = [];
  let header = null;
  let truncated = false;
  let pos = 0;
  const n = text.length;
  while (pos < n) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = n;
    let line = text.slice(pos, end);
    pos = end + 1;
    if (line.indexOf('"') >= 0) {
      let quotes = countQuotes(line);
      if (quotes % 2 === 1) {
        let joined = line, p = pos;
        for (let k = 0; quotes % 2 === 1 && p < n && k < MAX_JOIN_LINES; k++) {
          let e2 = text.indexOf('\n', p);
          if (e2 < 0) e2 = n;
          const next = text.slice(p, e2);
          joined += '\n' + next;
          quotes += countQuotes(next);
          p = e2 + 1;
        }
        if (quotes % 2 === 0) {
          line = joined;
          pos = p;
        }
      }
    }
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line.trim()) continue;
    const fields = line.indexOf('"') >= 0 ? splitQuoted(line, sep) : line.split(sep);
    if (header === null) {
      header = fields;
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      truncated = true;
      break;
    }
    rows.push(fields);
  }
  return { header, rows, truncated };
}

function countQuotes(s) {
  let k = 0;
  for (let i = s.indexOf('"'); i >= 0; i = s.indexOf('"', i + 1)) k++;
  return k;
}

function splitQuoted(line, sep) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// A number from a CSV cell; empty, "NaN" and text give null. decimalComma accepts "1,25E-3".
function num(cell, decimalComma = false) {
  if (cell == null) return null;
  let s = String(cell).trim();
  if (!s) return null;
  if (decimalComma) s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

// A number from JSON: finite numbers, or numeric strings.
function toNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return num(v);
  return null;
}

// ---------------------------------------------------------------- rfn-json

function fromRfn(chosen, warnings) {
  if (chosen.length > 1) warnings.push('Choose one walk at a time. Only the first one was used.');
  const { rec, wrapper } = chosen[0];
  if (wrapper) warnings.push('Used the recording saved inside this walk.');
  if (rec.v !== 1) warnings.push('This recording is from another version of this page, so it may not read correctly.');
  let skipped = 0;
  const samples = [];
  for (const s of rec.samples) {
    if (!s || typeof s !== 'object') {
      skipped++;
      continue;
    }
    samples.push({
      t: toNum(s.t),
      ax: toNum(s.ax), ay: toNum(s.ay), az: toNum(s.az),
      gx: toNum(s.gx), gy: toNum(s.gy), gz: toNum(s.gz),
      lx: toNum(s.lx), ly: toNum(s.ly), lz: toNum(s.lz),
    });
  }
  if (skipped) warnings.push(`${skipped} readings were not readable and were left out.`);

  let distance = toNum(rec.distance_m);
  if (distance === null && wrapper) distance = toNum(wrapper.distance_m);
  if (distance !== null && !(distance >= 1 && distance <= 100)) {
    warnings.push('The walk distance in this file is not between 1 and 100 m, so it was left blank.');
    distance = null;
  }
  let id = typeof rec.id === 'string' && ID_RE.test(rec.id) ? rec.id : null;
  if (!id) warnings.push('This recording had no usable name, so it was given a new one.');
  const out = {
    samples,
    id,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : null,
    device: rec.device && typeof rec.device === 'object' && !Array.isArray(rec.device) ? rec.device : { ua: '' },
    distance_m: distance,
    placement: PLACEMENTS.includes(rec.placement) ? rec.placement : null,
    goT: toNum(rec.goT),
    stopT: toNum(rec.stopT),
    stopBy: STOP_BY.includes(rec.stopBy) ? rec.stopBy : null,
  };
  if (rec.truth && typeof rec.truth === 'object') out.truth = rec.truth;
  if (rec.simulated === true) out.simulated = true;
  return out;
}

// ---------------------------------------------------------------- gyro-starter-csv

function fromGyroStarter(chosen, warnings) {
  if (chosen.length > 1) warnings.push('Choose one gyro-starter recording at a time. Only the first one was used.');
  const { lower, table } = chosen[0];
  const col = (k) => lower.indexOf(k);
  const iSource = col('source'), iKind = col('kind'), iEvent = col('event'), iServer = col('server_time');
  const iField = {};
  for (const k of ['t', 'ax', 'ay', 'az', 'gx', 'gy', 'gz', 'lx', 'ly', 'lz']) iField[k] = col(k);
  const cell = (row, k) => (iField[k] >= 0 ? num(row[iField[k]]) : null);

  const bySource = new Map(); // source name -> { samples, presses }
  let firstServer = null;
  for (const row of table.rows) {
    const source = String(row[iSource] || '').trim() || 'unknown';
    const kind = String(row[iKind] || '').trim();
    if (firstServer === null && iServer >= 0) firstServer = num(row[iServer]);
    let g = bySource.get(source);
    if (!g) bySource.set(source, (g = { samples: [], presses: [] }));
    if (kind === 'sample') {
      g.samples.push({
        t: cell(row, 't'),
        ax: cell(row, 'ax'), ay: cell(row, 'ay'), az: cell(row, 'az'),
        gx: cell(row, 'gx'), gy: cell(row, 'gy'), gz: cell(row, 'gz'),
        lx: cell(row, 'lx'), ly: cell(row, 'ly'), lz: cell(row, 'lz'),
      });
    } else if (kind === 'event' && iEvent >= 0) {
      let e = null;
      try {
        e = JSON.parse(row[iEvent]);
      } catch (_) { /* not JSON: ignore the event */ }
      if (e && typeof e === 'object' && e.type === 'button' && e.id === 'A' && e.down === true) {
        const t = toNum(e.t) !== null ? toNum(e.t) : cell(row, 't'); // event t is the phone's page clock
        if (t !== null) g.presses.push(t);
      }
    }
  }

  const ranked = [...bySource.entries()].filter(([, g]) => g.samples.length)
    .sort((a, b) => b[1].samples.length - a[1].samples.length);
  if (!ranked.length) return { error: 'This gyro-starter file has no motion readings.' };
  const [name, g] = ranked[0];
  if (ranked.length > 1) {
    const list = ranked.map(([n, s]) => `"${n}" (${s.samples.length} readings)`).join(', ');
    warnings.push(`This file has motion from ${ranked.length} devices: ${list}. Used "${name}", which has the most.`);
  }

  // Trial marks: the first press of A starts the walk and the next press ends it.
  const presses = g.presses.slice().sort((a, b) => a - b).filter((t, i, a) => i === 0 || t > a[i - 1]);
  let goT = null, stopT = null, stopBy = null;
  if (presses.length >= 2) {
    goT = presses[0];
    stopT = presses[1];
    stopBy = 'tap';
    if (presses.length > 2) {
      warnings.push(`A was pressed ${presses.length} times. The first two presses were used as the start and end of the walk.`);
    }
  } else if (presses.length === 1) {
    warnings.push('A was pressed only once, so the start and end of the walk are not known.');
  }
  return { samples: g.samples, goT, stopT, stopBy, createdAt: isoFromMs(firstServer === null ? null : firstServer * 1000) };
}

// ---------------------------------------------------------------- sensor-logger-csv

function sensorLoggerKind(name) {
  const n = String(name).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z]/g, '');
  if (/uncalibrated|watch|wrist|headphone/.test(n)) return null; // other devices, or raw readings we do not need
  if (n.includes('totalacceleration')) return 'total';
  if (n.includes('accelerometer')) return 'linear'; // Sensor Logger's Accelerometer excludes gravity
  if (n.includes('gravity')) return 'gravity';
  if (n.includes('gyroscope')) return 'gyro';
  return null;
}

function fromSensorLogger(chosen, warnings) {
  const files = [];
  const skipped = [];
  for (const s of chosen) {
    const kind = sensorLoggerKind(s.file.name);
    const ix = s.lower.indexOf('x'), iy = s.lower.indexOf('y'), iz = s.lower.indexOf('z');
    if (!kind || ix < 0 || iy < 0 || iz < 0) {
      skipped.push(s.file.name || 'a file with no name');
      continue;
    }
    const iTime = s.lower.indexOf('time'), iEl = s.lower.indexOf('seconds_elapsed');
    const ns = s.table.rows.map((r) => (iTime >= 0 ? num(r[iTime]) : null));
    const el = s.table.rows.map((r) => (iEl >= 0 ? num(r[iEl]) : null));
    files.push({ s, kind, ix, iy, iz, iTime, ns, el, nsOk: clockUsable(ns, 1e15), elOk: clockUsable(el, -1) });
  }
  if (skipped.length) warnings.push('Not used (not a sensor the walking test needs): ' + skipped.join(', ') + '.');
  if (!files.length) {
    return {
      error: 'No motion sensor file was found. Choose TotalAcceleration.csv or Accelerometer.csv from a ' +
        'Sensor Logger export, with Gyroscope.csv and Gravity.csv if you have them. Keep the file names Sensor Logger gives them.',
    };
  }

  // One clock for all files: time (epoch ns) when every file has it, else seconds_elapsed. Files that have
  // neither are dropped. t = (time - first time) / 1e6 ms, or seconds_elapsed x 1000.
  const byNs = files.filter((f) => f.nsOk), byEl = files.filter((f) => f.elOk);
  const useNs = byNs.length >= byEl.length;
  const kept = useNs ? byNs : byEl;
  if (kept.length < files.length) {
    const lost = files.filter((f) => !kept.includes(f)).map((f) => f.s.file.name);
    warnings.push('Not used (its time column could not be read): ' + lost.join(', ') + '.');
  }
  if (!kept.length) return { error: 'The time columns in these Sensor Logger files could not be read.' };
  // Epoch ns (about 1.8e18) does not fit a double exactly, so it is split into whole ms and the ns left over.
  let ms0 = Infinity, ns0 = 0;
  for (const f of kept) {
    f.abs = f.s.table.rows.map((r, i) => {
      if (!useNs) return f.el[i] === null ? null : { ms: f.el[i] * 1000, ns: 0 };
      const p = f.ns[i] === null ? null : splitNs(r[f.iTime], f.ns[i]);
      if (p && (p.ms < ms0 || (p.ms === ms0 && p.ns < ns0))) {
        ms0 = p.ms;
        ns0 = p.ns;
      }
      return p;
    });
  }
  if (!useNs) {
    ms0 = 0; // seconds_elapsed already counts from the start of the recording
    ns0 = 0;
  }

  const streams = kept.map((f) => {
    const st = { kind: f.kind, name: f.s.file.name, t: [], x: [], y: [], z: [] };
    const scale = f.kind === 'gyro' ? RAD_TO_DEG : 1;
    f.s.table.rows.forEach((r, i) => {
      const p = f.abs[i];
      if (p === null) return;
      st.t.push((p.ms - ms0) + (p.ns - ns0) / 1e6);
      st.x.push(scaled(num(r[f.ix]), scale));
      st.y.push(scaled(num(r[f.iy]), scale));
      st.z.push(scaled(num(r[f.iz]), scale));
    });
    return st;
  });

  // Units say m/s^2, but convert if gravity looks like it is in g (as gyro-starter's push conversion does).
  const inG = (st) => {
    const m = median(st.t.map((_, i) => mag(st.x[i], st.y[i], st.z[i])).filter((v) => v !== null));
    return m !== null && m > 0.3 && m < 3;
  };
  // Accelerometer (no gravity) cannot show its unit, so it follows Gravity's.
  const grav = streams.find((st) => st.kind === 'gravity');
  const total = streams.find((st) => st.kind === 'total');
  const gravityInG = !!grav && inG(grav);
  const totalInG = !!total && inG(total);
  let converted = false;
  for (const st of streams) {
    const toMs2 = st.kind === 'total' ? totalInG : st.kind === 'gyro' ? false : gravityInG;
    if (toMs2) {
      for (const k of ['x', 'y', 'z']) st[k] = st[k].map((v) => scaled(v, STANDARD_GRAVITY));
      converted = true;
    }
  }
  if (converted) warnings.push('Acceleration looked like it was in g, so it was changed to m/s².');

  const merged = mergeStreams(streams, warnings);
  if (merged.error) return merged;
  return { samples: merged.samples, createdAt: useNs ? isoFromMs(ms0 + ns0 / 1e6) : null };
}

// "1794139923012345678" -> { ms: 1794139923012, ns: 345678 }, exact. Other spellings fall back to the number.
function splitNs(cell, value) {
  const s = String(cell).trim();
  if (/^\d{7,}$/.test(s)) return { ms: Number(s.slice(0, -6)), ns: Number(s.slice(-6)) };
  const ms = Math.floor(value / 1e6);
  return { ms, ns: value - ms * 1e6 };
}

function clockUsable(values, min) {
  let finite = 0, steps = 0, up = 0, prev = null;
  for (const v of values) {
    if (v === null || !(v > min)) continue;
    finite++;
    if (prev !== null) {
      steps++;
      if (v > prev) up++;
    }
    prev = v;
  }
  return finite > 0 && finite >= 0.9 * values.length && (steps === 0 || up >= 0.9 * steps);
}

// ---------------------------------------------------------------- phyphox-csv

function unitScale(kind, unit) {
  const u = unit.replace(/\s+/g, '');
  if (kind === 'gyro') {
    if (u === 'rad/s') return RAD_TO_DEG;
    if (u === 'deg/s' || u === '°/s') return 1;
    return null;
  }
  if (u === 'm/s^2' || u === 'm/s²' || u === 'm/s2') return 1;
  if (u === 'g') return STANDARD_GRAVITY;
  return null;
}

function fromPhyphox(chosen, warnings) {
  const streams = [];
  for (const s of chosen) {
    const decimalComma = s.sep !== ','; // phyphox only writes a decimal comma with tab or semicolon separators
    // Each data column belongs to the nearest time column on its left (custom experiments can have several).
    const groups = new Map();
    let ti = -1, tScale = 1000;
    s.lower.forEach((h, i) => {
      const tm = PHYPHOX_TIME.exec(h);
      if (tm) {
        ti = i;
        tScale = tm[2] === 'ms' ? 1 : 1000;
        return;
      }
      const m = PHYPHOX_DATA.exec(h);
      if (!m || ti < 0) return;
      const kind = m[1] === 'gyroscope' ? 'gyro' : m[1] === 'linear acceleration' ? 'linear' : 'total';
      const scale = unitScale(kind, m[3]);
      if (scale === null) {
        warnings.push(`Not used: the column "${s.header[i]}", because its unit is not known.`);
        return;
      }
      const key = ti + '|' + kind;
      if (!groups.has(key)) groups.set(key, { kind, ti, tScale, cols: {} });
      groups.get(key).cols[m[2]] = [i, scale];
    });
    for (const g of groups.values()) {
      if (!g.cols.x || !g.cols.y || !g.cols.z) continue;
      const st = { kind: g.kind, name: s.file.name, t: [], x: [], y: [], z: [] };
      for (const r of s.table.rows) {
        const t = num(r[g.ti], decimalComma);
        if (t === null) continue;
        st.t.push(t * g.tScale);
        for (const k of ['x', 'y', 'z']) st[k].push(scaled(num(r[g.cols[k][0]], decimalComma), g.cols[k][1]));
      }
      streams.push(st);
    }
  }
  if (chosen.length > 1) {
    warnings.push('These phyphox files were lined up by their time columns. Use files from the same run.');
  }
  const merged = mergeStreams(streams, warnings);
  if (merged.error) return merged;
  return { samples: merged.samples, createdAt: null };
}

// ---------------------------------------------------------------- merging per-sensor streams

// streams: [{ kind: 'total'|'linear'|'gravity'|'gyro', name, t: [ms], x, y, z }] already in section 1 units.
// The acceleration stream (with gravity if there is one) gives the sample times; the others are interpolated
// onto those times. ax/ay/az: TotalAcceleration, else Accelerometer + Gravity, else null.
// lx/ly/lz: Accelerometer, else TotalAcceleration - Gravity, else null. gx/gy/gz: Gyroscope, else null.
function mergeStreams(streams, warnings) {
  const pick = (kind) => {
    const c = streams.filter((s) => s.kind === kind && s.t.length);
    if (c.length > 1) warnings.push(`More than one ${KIND_LABEL[kind]} file was found. The longest one was used.`);
    c.sort((a, b) => b.t.length - a.t.length);
    return c.length ? sortStream(c[0]) : null;
  };
  const total = pick('total'), linear = pick('linear'), gravity = pick('gravity'), gyro = pick('gyro');
  const base = total || linear;
  if (!base) {
    return {
      error: 'These files have no acceleration readings, which the walking test needs. ' +
        'Add the accelerometer file from the same recording.',
    };
  }
  const T = base.t;
  const lin = linear ? (linear === base ? linear : resample(linear, T)) : null;
  const grav = gravity ? resample(gravity, T) : null;
  const gyr = gyro ? resample(gyro, T) : null;
  const samples = new Array(T.length);
  for (let i = 0; i < T.length; i++) {
    let ax = null, ay = null, az = null, lx = null, ly = null, lz = null;
    if (total) {
      ax = total.x[i]; ay = total.y[i]; az = total.z[i];
      if (lin) {
        lx = lin.x[i]; ly = lin.y[i]; lz = lin.z[i];
      } else if (grav) {
        lx = sub(ax, grav.x[i]); ly = sub(ay, grav.y[i]); lz = sub(az, grav.z[i]);
      }
    } else {
      lx = lin.x[i]; ly = lin.y[i]; lz = lin.z[i];
      if (grav) {
        ax = add(lx, grav.x[i]); ay = add(ly, grav.y[i]); az = add(lz, grav.z[i]);
      }
    }
    samples[i] = {
      t: round(T[i], 3),
      ax: round(ax, 6), ay: round(ay, 6), az: round(az, 6),
      gx: gyr ? round(gyr.x[i], 6) : null, gy: gyr ? round(gyr.y[i], 6) : null, gz: gyr ? round(gyr.z[i], 6) : null,
      lx: round(lx, 6), ly: round(ly, 6), lz: round(lz, 6),
    };
  }
  return { samples };
}

function sortStream(st) {
  let sorted = true;
  for (let i = 1; i < st.t.length; i++) if (st.t[i] < st.t[i - 1]) { sorted = false; break; }
  if (!sorted) {
    const order = st.t.map((_, i) => i).sort((a, b) => st.t[a] - st.t[b] || a - b);
    for (const k of ['t', 'x', 'y', 'z']) st[k] = order.map((i) => st[k][i]);
  }
  return st;
}

// Linear interpolation of src at the times T (both increasing). See MERGE_MAX_SPAN_MS and MERGE_EDGE_MS.
function resample(src, T) {
  const n = T.length, m = src.t.length;
  const out = { x: new Array(n).fill(null), y: new Array(n).fill(null), z: new Array(n).fill(null) };
  if (!m) return out;
  const st = src.t;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = T[i];
    while (j + 1 < m && st[j + 1] <= t) j++;
    let k0 = -1, k1 = -1, w = 0;
    if (t < st[0]) {
      if (st[0] - t <= MERGE_EDGE_MS) k0 = 0;
    } else if (j + 1 >= m) {
      if (t - st[m - 1] <= MERGE_EDGE_MS) k0 = m - 1;
    } else if (t === st[j]) {
      k0 = j;
    } else if (st[j + 1] - st[j] <= MERGE_MAX_SPAN_MS) {
      k0 = j; k1 = j + 1; w = (t - st[j]) / (st[j + 1] - st[j]);
    } else if (t - st[j] <= MERGE_EDGE_MS) {
      k0 = j;
    } else if (st[j + 1] - t <= MERGE_EDGE_MS) {
      k0 = j + 1;
    }
    if (k0 < 0) continue;
    for (const k of ['x', 'y', 'z']) {
      const a = src[k][k0];
      if (k1 < 0) out[k][i] = a;
      else {
        const b = src[k][k1];
        out[k][i] = a === null || b === null ? null : a + w * (b - a);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- shared checks

function cleanSamples(list, warnings) {
  let out = [];
  let noTime = 0;
  for (const s of list) {
    if (s && Number.isFinite(s.t)) out.push(s);
    else noTime++;
  }
  if (noTime) warnings.push(`${noTime} readings had no time and were left out.`);
  for (let i = 1; i < out.length; i++) {
    if (out[i].t < out[i - 1].t) {
      out = out.map((s, k) => [s, k]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map((p) => p[0]);
      warnings.push('Some readings were out of time order, so they were put in order.');
      break;
    }
  }
  const unique = [];
  for (const s of out) if (!unique.length || s.t > unique[unique.length - 1].t) unique.push(s);
  if (unique.length < out.length) {
    warnings.push(`${out.length - unique.length} readings repeated an earlier time and were left out.`);
  }
  if (unique.length > MAX_ROWS) {
    warnings.push(`This recording has more than ${MAX_ROWS} readings. Only the first ${MAX_ROWS} were used.`);
    unique.length = MAX_ROWS;
  }
  return unique;
}

function checkMarkers(rec, warnings) {
  const first = rec.samples[0].t, last = rec.samples[rec.samples.length - 1].t;
  const inside = (v) => v >= first - MARKER_SLACK_MS && v <= last + MARKER_SLACK_MS;
  if (rec.goT !== null && !inside(rec.goT)) {
    warnings.push('The start mark is outside the recording, so it was not used.');
    rec.goT = null;
  }
  if (rec.stopT !== null && !inside(rec.stopT)) {
    warnings.push('The end mark is outside the recording, so it was not used.');
    rec.stopT = null;
    rec.stopBy = null;
  }
  if (rec.goT !== null && rec.stopT !== null && rec.stopT <= rec.goT) {
    warnings.push('The end mark comes before the start mark, so it was not used.');
    rec.stopT = null;
    rec.stopBy = null;
  }
}

// ---------------------------------------------------------------- small helpers

function baseName(name) {
  return name.split(/[\\/]/).pop();
}

function scaled(v, k) {
  return v === null ? null : v * k;
}

function add(a, b) {
  return a === null || b === null ? null : a + b;
}

function sub(a, b) {
  return a === null || b === null ? null : a - b;
}

function mag(x, y, z) {
  return x === null || y === null || z === null ? null : Math.sqrt(x * x + y * y + z * z);
}

function median(values) {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}

function round(v, digits) {
  if (v === null || v === undefined) return null;
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}

function isoFromMs(ms) {
  if (ms === null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  return y >= 2000 && y <= 2100 ? d.toISOString() : null;
}

// Same files give the same id, so importing a file twice does not make two walks (the server keeps the first).
function makeId(format, files) {
  let h = 0x811c9dc5;
  const feed = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  feed(format);
  for (const f of files) {
    feed(f.name);
    feed(String(f.text.length));
    feed(f.text.slice(0, 4096));
    feed(f.text.slice(-4096));
  }
  return 'imp-' + ID_PREFIX[format] + '-' + h.toString(16).padStart(8, '0');
}
