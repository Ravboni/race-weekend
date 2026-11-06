"use strict";

// Race Weekend F1 catalog bridge — webOS JS service.
//
// Why this exists: the F1 TV API (f1tv.formula1.com, id.formula1.com,
// api.formula1.com) is served same-origin only. It returns no
// Access-Control-Allow-Origin for any cross-origin caller and sets
// `Cross-Origin-Resource-Policy: same-origin`. A webOS web app runs from a
// file:// origin, so on webOS builds whose Chromium enforces CORP (webOS 6 =
// Chrome 79, webOS 22 = Chrome 87) the catalog request is blocked with
// net::ERR_BLOCKED_BY_RESPONSE (corp-not-same-origin). webOS already launches
// app renderers with --disable-cors, so CORS is not the blocker — CORP is, and
// that flag does not cover it. No client-only (fetch mode / worker) change can
// read a response the server refuses cross-origin, so a local reverse proxy
// that re-emits permissive CORP/CORS headers is required.
//
// This service is that proxy, packaged inside the app's own IPK:
//   * installs unprivileged with the app (no root, no Homebrew init.d hook),
//   * runs as the app's non-root service user,
//   * is started on demand by the app over the Luna bus (see bridge.js),
//   * listens only on 127.0.0.1 and forwards only an allowlist of F1 paths
//     over normal TLS, adding no credentials and persisting no session state.
//
// webOS 4 uses Node 0.12 and webOS 6 uses Node 8. This service uses ES5
// and node-compat for the API differences; it is runtime-tested on both.

var Service = require("webos-service");
var http = require("http");
var https = require("https");
var crypto = require("crypto");
var compat = require("./node-compat");
var URL = compat.URL;

var PORT = 18741;
var APP_ID = "com.ravboni.raceweekend";
var APP_ORIGIN = "file://com.ravboni.raceweekend-webos";
var TOKEN_PARAM = "__rwv_session";
var pip = require("./pip-service")({ appId: APP_ID, port: PORT });

// host -> allowed path prefixes. Mirrors the documented catalog/auth/image
// endpoints the app needs (3.0 is the PLAY API that serves the 4K profile);
// everything else is refused.
var ALLOWED = {
  "f1tv.formula1.com": /^\/(?:[1234]\.0\/|image-resizer\/)/,
  "api.formula1.com": /^\/static\/jwks\.json$/,
  "id.formula1.com": /^\/as\/(?:device_authorization|token)$/
};

function upstreamURL(raw, token) {
  var match = /^\/([^/]+)(\/[^#]*)$/.exec(raw);
  if (!match || !ALLOWED[match[1]]) return null;
  var u;
  try { u = new URL("https://" + match[1] + match[2]); } catch (_error) { return null; }
  if (u.hostname !== match[1] || u.port || u.username || u.password || !ALLOWED[u.hostname].test(u.pathname)) {
    return null;
  }
  var sessionTokens = u.searchParams.getAll(TOKEN_PARAM);
  if (sessionTokens.length !== 1 || !safeTokenEqual(sessionTokens[0], token)) return null;
  u.searchParams.delete(TOKEN_PARAM);
  return u;
}

function safeTokenEqual(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(candidate) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  var a = new Buffer(candidate, "hex");
  var b = new Buffer(expected, "hex");
  if (typeof crypto.timingSafeEqual === "function") return crypto.timingSafeEqual(a, b);
  // Both inputs have already been constrained to exactly 32 bytes. Node 0.12
  // lacks timingSafeEqual; compare every byte, without an early mismatch exit.
  var mismatch = 0;
  for (var i = 0; i < a.length; i += 1) mismatch |= a[i] ^ b[i];
  return mismatch === 0;
}

function requestOriginAllowed(origin) {
  return origin === undefined || origin === APP_ORIGIN;
}

function addCorsHeaders(req, res) {
  var origin = req.headers.origin;
  if (origin === APP_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "accept, content-type, ascendontoken, entitlementtoken, customdata, range, x-f1-device-info, x-f1-override-video-stream");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  }
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

var sessionToken = null;

function createProxy() {
  return http.createServer(function (req, res) {
    var origin = req.headers.origin;
    if (!requestOriginAllowed(origin)) {
      res.writeHead(403); res.end(); return;
    }
    if (pip.handle(req, res)) return;
    var url = upstreamURL(req.url, sessionToken);
    if (!url || ["GET", "HEAD", "POST", "OPTIONS"].indexOf(req.method) === -1) {
      res.writeHead(403); res.end(); return;
    }
    if (req.method === "OPTIONS") {
      var requestedMethod = req.headers["access-control-request-method"];
      if (["GET", "HEAD", "POST"].indexOf(requestedMethod) === -1) { res.writeHead(403); res.end(); return; }
      var requestedHeaders = (req.headers["access-control-request-headers"] || "").split(",").map(function (header) { return header.trim().toLowerCase(); }).filter(Boolean);
      var allowedHeaders = ["accept", "content-type", "ascendontoken", "entitlementtoken", "customdata", "range", "x-f1-device-info", "x-f1-override-video-stream"];
      if (requestedHeaders.some(function (header) { return allowedHeaders.indexOf(header) === -1; })) { res.writeHead(403); res.end(); return; }
      addCorsHeaders(req, res);
      res.writeHead(204); res.end(); return;
    }
    addCorsHeaders(req, res);

    var headers = { "user-agent": "Mozilla/5.0", accept: "*/*" };
    ["accept", "content-type", "ascendontoken", "entitlementtoken", "customdata", "range", "x-f1-device-info", "x-f1-override-video-stream"].forEach(function (key) {
      if (typeof req.headers[key] === "string") headers[key] = req.headers[key];
    });

    var parts = [];
    var length = 0;
    req.on("data", function (chunk) {
      length += chunk.length;
      if (length > 2097152) { res.writeHead(413); res.end(); compat.destroy(req); return; }
      parts.push(chunk);
    });
    req.on("end", function () {
      if (res.writableEnded) return;
      var body = Buffer.concat(parts);
      if (body.length) headers["content-length"] = String(body.length);
      var options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: req.method,
        headers: headers
      };
      var upstream = https.request(options, function (reply) {
        ["content-type", "content-length", "content-range", "accept-ranges"].forEach(function (key) {
          if (reply.headers[key]) res.setHeader(key, reply.headers[key]);
        });
        res.writeHead(reply.statusCode);
        reply.on("error", function () { compat.destroy(res); });
        reply.pipe(res);
      });
      upstream.setTimeout(20000, function () { compat.destroy(upstream); });
      upstream.on("error", function () { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on("close", function () { compat.destroy(upstream); });
      upstream.end(body);
    });
    req.on("error", function () { compat.destroy(res); });
  });
}

var server = null;
var lastError = null;

var listeningCallbacks = [];
function isListening() {
  return !!(server && server.address());
}
function ensureListening(callback) {
  if (isListening()) { callback(true); return; }
  listeningCallbacks.push(callback);
  if (server) return;
  server = createProxy();
  function complete(ok) {
    var callbacks = listeningCallbacks;
    listeningCallbacks = [];
    callbacks.forEach(function (ready) { ready(ok); });
  }
  server.once("error", function () {
    lastError = "Local F1 service unavailable.";
    server = null;
    complete(false);
  });
  server.listen(PORT, "127.0.0.1", function () { lastError = null; complete(true); });
}

// Start the proxy as soon as webOS launches this service process (the Luna
// call that starts the service is the app's /start request below).
ensureListening(function () {});

var service = new Service("com.ravboni.raceweekend.service");

pip.register(service, function (callback) {
  ensureListening(function () { callback(isListening()); });
});

service.register("start", function (message) {
  if (message.sender !== APP_ID) { message.respond({ started: false, error: "unauthorized" }); return; }
  sessionToken = crypto.randomBytes(32).toString("hex");
  ensureListening(function (ok) {
    message.respond({ started: ok, listening: isListening(), port: PORT, token: ok ? sessionToken : null, error: lastError });
  });
});

service.register("status", function (message) {
  if (message.sender !== APP_ID) { message.respond({ listening: false, error: "unauthorized" }); return; }
  message.respond({ listening: isListening(), port: PORT, error: lastError });
});

// Keep-alive anchor. webos-service exits the process ~5s after its activity
// count reaches zero (ActivityManager idle timeout). The app holds this
// subscription open for its whole lifetime (see bridge.js), which keeps one
// activity registered so the proxy stays listening; when the app closes or
// reloads, the subscription drops and the service exits cleanly on its own —
// no lingering process, no root daemon.
service.register("keepalive", function (message) {
  if (message.sender !== APP_ID) { message.respond({ subscribed: false, listening: false, error: "unauthorized" }); return; }
  message.respond({ subscribed: !!message.isSubscription, listening: isListening(), port: PORT });
});
