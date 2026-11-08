'use strict';
// Phone side: read the motion sensors through the browser and POST them to the laptop in small batches.
// Web API reference: DeviceMotionEvent (rotationRate in deg/s, accelerations in m/s²) and DeviceOrientationEvent.
(() => {
  const $ = (id) => document.getElementById(id);
  // At most one POST per MIN_GAP_MS (default 16 ms, about 60 a second); samples that arrive in between ride in the
  // next batch. Add ?gap=100 to the address to send fewer, bigger batches, for example through a metered tunnel.
  const MIN_GAP_MS = Math.max(16, Number(new URLSearchParams(location.search).get('gap')) || 16);
  const MAX_QUEUE = 600;   // ~10 s at 60 Hz; if the laptop is unreachable, old samples are dropped to stay live

  const st = {
    started: false, source: 'phone',
    queue: [], events: [], inFlight: false, timer: null, lastSend: 0,
    sent: 0, dropped: 0, errors: 0, ok: null, lastError: '',
    count: 0, hz: 0, winStart: 0, winCount: 0,
    ori: { a: null, b: null, g: null }, last: null,
  };
  window.__phone = st; // for debugging from the console

  const num = (v, digits) => (typeof v === 'number' && Number.isFinite(v)) ? Number(v.toFixed(digits)) : null;

  // ---------- setup screen
  $('source').value = localStorage.getItem('gyroStarter.source') || 'phone';
  if (!window.isSecureContext) {
    $('hint').textContent = 'This page is not HTTPS, so the browser will not give it motion data. ' +
      'Open it through the https:// address the server prints, a phone hotspot, or a tunnel (see README).';
    $('hint').className = 'warn';
  } else if (!('DeviceMotionEvent' in window)) {
    $('hint').textContent = 'This browser has no motion sensor API (DeviceMotionEvent).';
    $('hint').className = 'warn';
  } else {
    $('hint').textContent = 'Tap Start. On iPhone, tap Allow when Safari asks for Motion & Orientation access.';
  }

  function fail(message) {
    $('hint').textContent = message;
    $('hint').className = 'warn';
  }

  $('start').addEventListener('click', () => {
    st.source = ($('source').value || '').trim().slice(0, 20) || 'phone';
    localStorage.setItem('gyroStarter.source', st.source);
    // Safari on iPhone (and recent Chrome versions) expose requestPermission(); it only works when it runs
    // inside the tap itself, so it is called synchronously here, before anything else is awaited.
    let ask;
    try {
      ask = (window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function')
        ? DeviceMotionEvent.requestPermission()
        : Promise.resolve('granted'); // browsers without the permission API give motion data to HTTPS pages
    } catch (err) {
      return fail('Permission request failed: ' + err.message);
    }
    ask.then((answer) => {
      if (answer !== 'granted') {
        return fail('Motion access was denied. iPhone: Safari remembers that until it restarts, so swipe Safari ' +
          'away in the app switcher, reopen this page and tap Start again (or use a new tunnel address). ' +
          'Android: allow Motion sensors for this site in Chrome\'s site settings.');
      }
      // On iOS the orientation permission comes with the motion one; ask anyway, but do not fail without it.
      if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
      start();
    }, (err) => fail('Permission request failed: ' + ((err && err.message) || err) +
      (window.isSecureContext ? '' : ' (this page is not HTTPS)')));
  });

  function start() {
    if (st.started) return;
    st.started = true;
    st.winStart = performance.now();
    $('setup').hidden = true;
    $('live').hidden = false;
    window.addEventListener('devicemotion', onMotion);
    window.addEventListener('deviceorientation', onOrientation);
    keepAwake();
    setInterval(render, 250);
    setTimeout(() => {
      if (!st.count) {
        $('warn').dataset.sticky = 'No motion data yet. A laptop has no gyroscope; on a phone, check that motion ' +
          'access is allowed and that the address starts with https://.';
      }
    }, 2500);
    render();
  }

  // ---------- sensors
  function onOrientation(e) {
    st.ori = { a: e.alpha, b: e.beta, g: e.gamma };
  }

  function onMotion(e) {
    const r = e.rotationRate || {};
    const g = e.accelerationIncludingGravity || {};
    const a = e.acceleration || {};
    if (r.alpha == null && r.beta == null && r.gamma == null && g.x == null) return; // empty event: no sensor
    // rotationRate alpha, beta, gamma are the rates about the device x, y, z axes: W3C Device Orientation and
    // Motion, section 6.3.2, and Chrome, Safari and Firefox. MDN's DeviceMotionEventRotationRate pages still
    // say z, x, y, from the spec's pre-2019 wording. Only deviceorientation's angles are about z, x, y.
    const s = {
      t: num(e.timeStamp, 1),                                          // ms, this page's clock
      gx: num(r.alpha, 2), gy: num(r.beta, 2), gz: num(r.gamma, 2),    // deg/s around the device x, y, z axes
      ax: num(g.x, 3), ay: num(g.y, 3), az: num(g.z, 3),               // m/s², including gravity
      lx: num(a.x, 3), ly: num(a.y, 3), lz: num(a.z, 3),               // m/s², gravity removed (null on some phones)
      oa: num(st.ori.a, 1), ob: num(st.ori.b, 1), og: num(st.ori.g, 1) // degrees
    };
    st.last = s;
    st.count++;
    st.winCount++;
    st.queue.push(s);
    if (st.queue.length > MAX_QUEUE) {
      st.dropped += st.queue.length - MAX_QUEUE;
      st.queue.splice(0, st.queue.length - MAX_QUEUE);
    }
    schedule();
  }

  // ---------- sending: one POST in flight at a time; everything that arrives meanwhile goes in the next one
  function schedule() {
    if (!st.started || st.inFlight || st.timer) return;
    const wait = Math.max(0, MIN_GAP_MS - (performance.now() - st.lastSend));
    st.timer = setTimeout(() => { st.timer = null; send(); }, wait);
  }

  function send() {
    if (st.inFlight || (!st.queue.length && !st.events.length)) return;
    const samples = st.queue.splice(0);
    const events = st.events.splice(0);
    st.inFlight = true;
    st.lastSend = performance.now();
    fetch('ingest', {                       // relative URL: works on the LAN address and behind a tunnel
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: st.source, samples, events }),
      cache: 'no-store',
    }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      st.sent += samples.length;
      st.ok = true;
    }).catch((err) => {
      st.errors++;
      st.ok = false;
      st.lastError = String((err && err.message) || err);
      st.events.unshift(...events);            // keep button presses; drop stale samples
      st.lastSend = performance.now() + 500;   // back off for half a second
    }).finally(() => {
      st.inFlight = false;
      if (st.queue.length || st.events.length) schedule();
    });
  }

  // ---------- buttons
  function pushEvent(e) {
    st.events.push(Object.assign({ t: num(performance.now(), 1) }, e));
    schedule();
  }

  function bindPad(id, onDown, onUp) {
    const el = $(id);
    const down = (ev) => {
      ev.preventDefault();
      if (el.classList.contains('down')) return;
      el.classList.add('down');
      onDown();
    };
    const up = () => {
      if (!el.classList.contains('down')) return;
      el.classList.remove('down');
      if (onUp) onUp();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  bindPad('btnA',
    () => { pushEvent({ type: 'button', id: 'A', down: true }); if (navigator.vibrate) navigator.vibrate(12); },
    () => pushEvent({ type: 'button', id: 'A', down: false }));
  bindPad('btnB',
    () => pushEvent({ type: 'button', id: 'B', down: true }),
    () => pushEvent({ type: 'button', id: 'B', down: false }));
  bindPad('recenter', () => pushEvent({ type: 'recenter' }));

  // ---------- keep the screen on while streaming (the browser stops sensor events when the screen locks)
  async function keepAwake() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen');
    } catch (_) { /* unsupported or refused: the screen may dim and sleep */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (st.started && document.visibilityState === 'visible') keepAwake();
  });

  // ---------- display
  function render() {
    const now = performance.now();
    if (now - st.winStart >= 1000) {
      st.hz = st.winCount * 1000 / (now - st.winStart);
      st.winCount = 0;
      st.winStart = now;
    }
    const f = (v) => (v == null ? '–' : v.toFixed(1)).padStart(7);
    const s = st.last;
    if (s) {
      $('gyro').textContent = `x${f(s.gx)}\ny${f(s.gy)}\nz${f(s.gz)}`;
      $('acc').textContent = `x${f(s.ax)}\ny${f(s.ay)}\nz${f(s.az)}`;
      $('ori').textContent = `α${f(s.oa)}\nβ${f(s.ob)}\nγ${f(s.og)}`;
    }
    $('rate').textContent = `${st.hz.toFixed(0)} Hz\nsent ${st.sent}\nerrors ${st.errors}`;
    const pill = $('conn');
    pill.textContent = st.ok === null ? 'waiting' : st.ok ? 'streaming' : 'no laptop';
    pill.className = 'pill' + (st.ok === true ? ' ok' : st.ok === false ? ' bad' : '');
    $('warn').textContent = st.ok === false
      ? 'Cannot reach the laptop (' + st.lastError + '). Same network? Firewall allowed?'
      : (st.count ? '' : ($('warn').dataset.sticky || ''));
  }
})();
