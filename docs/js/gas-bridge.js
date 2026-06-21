/**
 * Polyfill google.script.run สำหรับ GitHub Pages
 * เรียก GAS Web App ผ่าน fetch POST (JSON-RPC)
 */
(function() {
  if (typeof google !== 'undefined' && google.script && google.script.run &&
      google.script.run.__peaNative) {
    return;
  }

  var cfg = window.PEA_NEXUS_CONFIG || {};
  var GAS_URL = cfg.GAS_URL || '';

  function parseGasResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function callGas(fn, args, onSuccess, onFailure) {
    if (!GAS_URL || GAS_URL.indexOf('YOUR_DEPLOYMENT_ID') >= 0) {
      var msg = 'ยังไม่ได้ตั้งค่า GAS_URL ใน docs/js/config.js — deploy GAS แล้วใส่ URL /exec';
      if (onFailure) onFailure(msg);
      else console.error(msg);
      return;
    }
    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] })
    })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      var data = parseGasResponse(text);
      if (onSuccess) onSuccess(data);
    })
    .catch(function(err) {
      if (onFailure) onFailure(err && err.message ? err.message : String(err));
    });
  }

  function createRunner() {
    var handlers = { success: null, failure: null };
    var proxy = {};

    proxy.withSuccessHandler = function(fn) {
      handlers.success = fn;
      return proxy;
    };
    proxy.withFailureHandler = function(fn) {
      handlers.failure = fn;
      return proxy;
    };

    return new Proxy(proxy, {
      get: function(target, prop) {
        if (prop === 'withSuccessHandler' || prop === 'withFailureHandler') {
          return target[prop];
        }
        if (prop === '__peaRemote') return true;
        return function() {
          var args = Array.prototype.slice.call(arguments);
          callGas(String(prop), args, handlers.success, handlers.failure);
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner();
  window.__PEA_GAS_REMOTE__ = true;
})();
