(function setUpF1CatalogBridge() {
  "use strict";

  // Client side of the F1 catalog bridge (see service/service.js for the why).
  //
  // On webOS builds whose Chromium enforces Cross-Origin-Resource-Policy
  // (Chrome 73+: webOS 6 = 79, webOS 22 = 87) the file:// app cannot read the
  // same-origin-locked F1 API directly. This shim starts the bundled JS service
  // over the Luna bus and rewrites F1 requests to the local proxy it exposes.
  //
  // Older webOS (e.g. the C9 on Chrome 53) does not enforce CORP and reaches the
  // API directly, so this shim leaves those builds completely untouched.

  var PROXY_ORIGIN = "http://127.0.0.1:18741";
  var SERVICE_URI = "luna://com.ravboni.raceweekend.service";
  var HOSTS = { "f1tv.formula1.com": 1, "api.formula1.com": 1, "id.formula1.com": 1 };

  var userAgent = navigator.userAgent || "";
  var chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  var chromeMajor = chromeMatch ? Number(chromeMatch[1]) : 0;
  var isWebOS = /Web0S|webOS/i.test(userAgent);
  var hasBridge = typeof window.PalmServiceBridge === "function";

  // CORP is enforced from Chromium 73 on; below that (e.g. the C9) go direct.
  if (!isWebOS || chromeMajor < 73 || !hasBridge) return;

  function isProxyableURL(value) {
    try {
      var u = new URL(String(value));
      return u.protocol === "https:" && !u.port && !u.username && !u.password && !!HOSTS[u.hostname];
    } catch (error) { /* not a URL we rewrite */ }
    return false;
  }

  function proxyURLFor(value, token) {
    if (!isProxyableURL(value) || !isSessionToken(token || sessionToken)) return null;
    try {
      var u = new URL(String(value));
      u.searchParams.append("__rwv_session", token || sessionToken);
      return PROXY_ORIGIN + "/" + u.hostname + u.pathname + u.search;
    } catch (error) { return null; }
  }

  function lunaCall(method, params, onResponse) {
    var bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = function (responseText) {
      var payload = {};
      try { payload = JSON.parse(responseText); } catch (error) { payload = {}; }
      if (onResponse) onResponse(payload);
    };
    bridge.call(SERVICE_URI + "/" + method, JSON.stringify(params || {}));
    return bridge; // keep a reference alive to hold subscriptions open
  }

  // Proxy state. Right after a TV power cycle webOS can take well over 4 s to
  // spawn the service, so a start that answers late must still switch the
  // proxy on, and a start that failed is retried by the next F1 request (so
  // "Try again" recovers without relaunching the app).
  var START_WAIT_MS = 20000;      // how long F1 requests wait for a pending start
  var RETRY_COOLDOWN_MS = 3000;   // minimum gap before retrying a failed start
  var proxyUp = false;
  var sessionToken = null;
  var startPending = false;       // a start call is outstanding (never overlap:
  var startDeadline = 0;          // each start rotates the service's token)
  var lastStartFailure = 0;
  var waiters = [];

  function isSessionToken(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

  function notifyWaiters(up) {
    var pending = waiters;
    waiters = [];
    pending.forEach(function (notify) { notify(up); });
  }

  // Hold a keepalive subscription for the app's lifetime so the service does
  // not idle-exit (webos-service quits ~5s after its activity count hits zero).
  var keepAlive = null;
  function requestStart() {
    if (proxyUp || startPending) return;
    startPending = true;
    startDeadline = Date.now() + START_WAIT_MS;
    lunaCall("start", {}, function (payload) {
      startPending = false;
      if (proxyUp) return;
      if (payload && payload.listening && payload.started && isSessionToken(payload.token)) {
        sessionToken = payload.token;
        proxyUp = true;
        keepAlive = lunaCall("keepalive", { subscribe: true }, function () {});
        notifyWaiters(true);
      } else {
        lastStartFailure = Date.now();
        notifyWaiters(false);
      }
    });
  }

  // Resolves to true once the proxy is listening, or false if it is not up
  // (then the request goes direct — no worse than no shim). Never waits past
  // the pending start's deadline, so a missing/broken service cannot hang
  // every F1 request forever.
  function whenProxyReady() {
    if (proxyUp) return Promise.resolve(true);
    if (!startPending && Date.now() - lastStartFailure >= RETRY_COOLDOWN_MS) requestStart();
    var remaining = startPending ? startDeadline - Date.now() : 0;
    if (remaining <= 0) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var done = false;
      function finish(up) { if (!done) { done = true; resolve(up); } }
      waiters.push(finish);
      setTimeout(function () { finish(false); }, remaining);
    });
  }

  requestStart();
  window.addEventListener("beforeunload", function () { keepAlive = null; });

  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    var isPlain = typeof input === "string" || input instanceof URL;
    if (!isPlain || !isProxyableURL(input)) return originalFetch.call(this, input, init);
    return whenProxyReady().then(function (up) {
      var target = up ? proxyURLFor(input, sessionToken) : null;
      return originalFetch.call(window, target || input, init);
    });
  };

  if (window.XMLHttpRequest && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open) {
    var originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function () {
      var args = Array.prototype.slice.call(arguments);
      if (proxyUp) {
        var rewritten = proxyURLFor(args[1]);
        if (rewritten) args[1] = rewritten;
      }
      return originalOpen.apply(this, args);
    };
  }

  // Catalog artwork is loaded through <img>, which uses neither fetch nor XHR.
  // The built app exposes a global imageUrl() helper; wrap it once it exists.
  document.addEventListener("DOMContentLoaded", function () {
    if (typeof window.imageUrl === "function") {
      var originalImageUrl = window.imageUrl;
      window.imageUrl = function () {
        var out = originalImageUrl.apply(this, arguments);
        return proxyURLFor(out) || out;
      };
    }
  });
})();
