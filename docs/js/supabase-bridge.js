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

  function parseResponse(text, httpStatus) {
    if (!text) return { status: 'error', message: 'Empty response (HTTP ' + httpStatus + ')' };
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { return { status: 'error', message: text }; }
    if (httpStatus >= 400 && (!parsed || parsed.status !== 'success')) {
      return {
        status: 'error',
        message: (parsed && (parsed.message || parsed.error || parsed.code)) || ('HTTP ' + httpStatus),
      };
    }
    return parsed;
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
    .then(function(res) {
      return res.text().then(function(text) {
        return { text: text, status: res.status, ok: res.ok };
      });
    })
    .then(function(result) {
      var data = parseResponse(result.text, result.status);
      if (data && data.status === 'error') {
        if (onFailure) onFailure(data.message || 'API error');
        else if (onSuccess) onSuccess(data);
        return;
      }
      if (onSuccess) onSuccess(data);
    })
    .catch(function(err) {
      if (onFailure) onFailure(err && err.message ? err.message : String(err));
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
          callApi(String(prop), args, handlers.success, handlers.failure);
        };
      }
    });

    return runner;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunner();
  window.__PEA_SUPABASE__ = true;
})();
