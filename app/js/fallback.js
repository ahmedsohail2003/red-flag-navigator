// Classic (non-module) script, loaded first on every page. If the page is opened from
// disk (file://) or a module fails to load, it tells the reader how to start the demo
// instead of leaving "Loading..." boxes. Module tags call rfnFail() from onerror.
(function () {
  function show(html) {
    if (document.getElementById('rfn-fallback')) return;
    var d = document.createElement('div');
    d.id = 'rfn-fallback';
    d.setAttribute('role', 'alert');
    d.style.cssText = 'background:#fef3f2;border-bottom:2px solid #b42318;color:#101828;padding:12px 20px;font:15px/1.5 system-ui,sans-serif;position:sticky;top:0;z-index:100';
    d.innerHTML = html;
    (document.body || document.documentElement).prepend(d);
  }
  var serverMsg = 'This demo runs from a small local server. In the project folder run <code>python serve.py</code>, then open <a href="http://localhost:8765">http://localhost:8765</a>.';
  window.rfnFail = function () {
    var go = function () { show(location.protocol === 'file:' ? serverMsg : 'Part of this page did not load. Please reload; if it keeps happening, restart <code>python serve.py</code>.'); };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  };
  if (location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', function () { show(serverMsg); });
    return;
  }
  window.addEventListener('load', function () {
    setTimeout(function () { if (!document.querySelector('.rfn-nav, [data-app-ready]')) window.rfnFail(); }, 2500);
  });
})();
