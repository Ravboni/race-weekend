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
//     over normal TLS, adding no credentials and storing nothing.
//
// webOS 6's Node is v8.12, so this file stays ES5-ish: `URL` comes from 'url'
// and https.request() is given an options object (it does not accept a WHATWG
// URL as its first argument until Node 10.9).

var Service = require("webos-service");
var http = require("http");
var https = require("https");
var URL = require("url").URL;

var PORT = 18741;
var APP_ORIGIN = "file://com.ravboni.raceweekend-webos";

// host -> allowed path prefixes. Mirrors the documented catalog/auth/image
// endpoints the app needs; everything else is refused.
var ALLOWED = {
  "f1tv.formula1.com": /^\/(?:[124]\.0\/|image-resizer\/)/,
  "api.formula1.com": /^\/static\/jwks\.json$/,
  "id.formula1.com": /^\/as\/(?:device_authorization|token)$/
};

function upstreamURL(raw) {
  var match = /^\/([^/]+)(\/[^#]*)$/.exec(raw);
  if (!match || !ALLOWED[match[1]]) return null;
  var u = new URL("https://" + match[1] + match[2]);
  if (u.hostname !== match[1] || u.port || u.username || u.password || !ALLOWED[u.hostname].test(u.pathname)) {
    return null;
  }
  return u;
}

function createProxy() {
  return http.createServer(function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "accept, content-type, ascendontoken, entitlementtoken, customdata, range");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "no-store");

    var origin = req.headers.origin;
    if (origin && origin !== "null" && origin !== APP_ORIGIN && origin !== "http://127.0.0.1:" + PORT) {
      res.writeHead(403); res.end(); return;
    }
    var url = upstreamURL(req.url);
    if (!url || ["GET", "HEAD", "POST", "OPTIONS"].indexOf(req.method) === -1) {
      res.writeHead(403); res.end(); return;
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    var headers = { "user-agent": "Mozilla/5.0", accept: "*/*" };
    ["accept", "content-type", "ascendontoken", "entitlementtoken", "customdata", "range"].forEach(function (key) {
      if (typeof req.headers[key] === "string") headers[key] = req.headers[key];
    });

    var parts = [];
    var length = 0;
    req.on("data", function (chunk) {
      length += chunk.length;
      if (length > 2097152) { res.writeHead(413); res.end(); req.destroy(); return; }
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
        reply.on("error", function () { res.destroy(); });
        reply.pipe(res);
      });
      upstream.setTimeout(20000, function () { upstream.destroy(); });
      upstream.on("error", function () { if (!res.headersSent) res.writeHead(502); res.end(); });
      res.on("close", function () { upstream.destroy(); });
      upstream.end(body);
    });
    req.on("error", function () { res.destroy(); });
  });
}

var server = null;
var lastError = null;

function ensureListening(callback) {
  if (server && server.listening) { callback(true); return; }
  server = createProxy();
  server.once("error", function (error) {
    // EADDRINUSE means a proxy (this service or the legacy root bridge) is
    // already serving the port, which is fine for our purposes.
    lastError = String(error && error.message ? error.message : error);
    var inUse = error && error.code === "EADDRINUSE";
    server = inUse ? server : null;
    callback(inUse);
  });
  server.listen(PORT, "127.0.0.1", function () { lastError = null; callback(true); });
}

// Start the proxy as soon as webOS launches this service process (the Luna
// call that starts the service is the app's /start request below).
ensureListening(function () {});

var service = new Service("com.ravboni.raceweekend.service");

service.register("start", function (message) {
  ensureListening(function (ok) {
    message.respond({ started: ok, listening: !!(server && server.listening), port: PORT, error: lastError });
  });
});

service.register("status", function (message) {
  message.respond({ listening: !!(server && server.listening), port: PORT, error: lastError });
});

// Keep-alive anchor. webos-service exits the process ~5s after its activity
// count reaches zero (ActivityManager idle timeout). The app holds this
// subscription open for its whole lifetime (see bridge.js), which keeps one
// activity registered so the proxy stays listening; when the app closes or
// reloads, the subscription drops and the service exits cleanly on its own —
// no lingering process, no root daemon.
service.register("keepalive", function (message) {
  message.respond({ subscribed: !!message.isSubscription, listening: !!(server && server.listening), port: PORT });
});
