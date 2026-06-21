/**
 * Polyfill google.script.run — GitHub Pages → Supabase Edge Functions
 */
(function() {
  if (typeof google !== 'undefined' && google.script && google.script.run &&
      google.script.run.__peaNative) {
    return;
  }

  var cfg = window.PEA_NEXUS_CONFIG || {};
  var API_URL = cfg.API_URL || '';
  var ANON_KEY = cfg.SUPABASE_ANON_KEY || '';

  function parseResponse(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
  }

  function callApi(fn, args, onSuccess, onFailure) {
    if (!API_URL) {
      var msg = 'ยังไม่ได้ตั้งค่า API_URL — deploy Supabase Edge Function ก่อน';
      if (onFailure) onFailure(msg);
      else console.error(msg);
      return;
    }
    fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ANON_KEY,
        'apikey': ANON_KEY
      },
      body: JSON.stringify({ fn: fn, args: args || [] })
    })
    .then(function(res) { return res.text(); })
    .then(function(text) {
      if (onSuccess) onSuccess(parseResponse(text));
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
          callApi(String(prop), args, handlers.success, handlers.failure);
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner();
  window.__PEA_SUPABASE__ = true;
})();
