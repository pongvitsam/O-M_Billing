/**
 * Polyfill google.script.run สำหรับ GitHub Pages → GAS Web App
 */
(function() {
  if (typeof google !== 'undefined' && google.script && google.script.run &&
      google.script.run.__peaNative) {
    return;
  }

  var cfg = window.PEA_NEXUS_CONFIG || {};
  var GAS_URL = cfg.GAS_URL || '';

  function notifyFailure(onFailure, msg) {
    if (!onFailure) return;
    if (msg && typeof msg === 'object' && msg.message) {
      onFailure(msg);
      return;
    }
    onFailure({ message: String(msg || 'Unknown error') });
  }

  function parseGasResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  function callGas(fn, args, onSuccess, onFailure) {
    if (!GAS_URL || GAS_URL.indexOf('YOUR_DEPLOYMENT_ID') >= 0) {
      notifyFailure(onFailure, 'ยังไม่ได้ตั้งค่า GAS_URL ใน docs/js/config.js — deploy GAS แล้วใส่ URL /exec');
      return;
    }
    fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] })
    })
    .then(function(res) {
      return res.text().then(function(text) {
        return { text: text, status: res.status, ok: res.ok };
      });
    })
    .then(function(result) {
      if (!result.ok && !result.text) {
        notifyFailure(onFailure, 'HTTP ' + result.status);
        return;
      }
      var data = parseGasResponse(result.text);
      if (!data) {
        notifyFailure(onFailure, 'Invalid response from server (HTTP ' + result.status + ')');
        return;
      }
      // เหมือน google.script.run จริง: ส่ง JSON ทั้งหมดไป success handler
      if (onSuccess) onSuccess(data);
    })
    .catch(function(err) {
      notifyFailure(onFailure, err && err.message ? err.message : String(err));
    });
  }

  function createRunner() {
    var handlers = { success: null, failure: null };
    var target = {};

    target.withSuccessHandler = function(fn) {
      handlers.success = fn;
      return runner;
    };
    target.withFailureHandler = function(fn) {
      handlers.failure = fn;
      return runner;
    };

    var runner = new Proxy(target, {
      get: function(_t, prop) {
        if (prop === 'withSuccessHandler') return target.withSuccessHandler;
        if (prop === 'withFailureHandler') return target.withFailureHandler;
        if (prop === '__peaRemote') return true;
        if (prop === 'then' || prop === 'catch' || typeof prop === 'symbol') return undefined;
        return function() {
          var args = Array.prototype.slice.call(arguments);
          callGas(String(prop), args, handlers.success, handlers.failure);
        };
      }
    });

    return runner;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner();
  window.__PEA_GAS_REMOTE__ = true;
})();
