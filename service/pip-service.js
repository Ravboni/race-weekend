"use strict";

var https = require("https");
var crypto = require("crypto");
var compat = require("./node-compat");
var URL = compat.URL;
var manifest = require("./pip-manifest");
// Released explicitly on feed changes/app startup; no idle expiry, because a
// static native player can seek hours after its only MPD request. Memory stays
// bounded and disappears with the unprivileged app service.
var MAX_SESSIONS = 8;
var FETCH_MS = 12000;

// No caller-controlled headers, cookies or credentials are forwarded. Each
// redirect is revalidated; capability URLs and upstream tokens stay in memory.
function fetchManifest(input, callback) {
  var done = false;
  var request = null;
  var timer = setTimeout(function () { finish(new Error("Manifest request timed out.")); }, FETCH_MS);
  function finish(error, value) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (request) compat.destroy(request);
    callback(error, value);
  }
  function visit(raw, redirects) {
    var url = manifest.allowedURL(raw);
    if (!url || redirects > 3) { finish(new Error("Unsupported manifest redirect.")); return; }
    request = https.request({ protocol: "https:", hostname: url.hostname, port: 443, path: url.pathname + url.search, method: "GET", headers: { accept: "application/dash+xml", "accept-encoding": "identity", "user-agent": "Mozilla/5.0" } }, function (reply) {
      if (done) { compat.destroy(reply); return; }
      reply.on("error", function () { finish(new Error("Manifest unavailable.")); });
      if ([301, 302, 303, 307, 308].indexOf(reply.statusCode) >= 0) {
        var next;
        try { next = new URL(reply.headers.location, url.href).href; } catch (_error) { next = ""; }
        reply.resume();
        visit(next, redirects + 1);
        return;
      }
      if (reply.statusCode !== 200 || (reply.headers["content-encoding"] && reply.headers["content-encoding"] !== "identity")) {
        reply.resume(); finish(new Error("Manifest unavailable.")); return;
      }
      var chunks = [];
      var size = 0;
      reply.on("data", function (chunk) {
        size += chunk.length;
        if (size > manifest.MAX_BYTES) { finish(new Error("Manifest is too large.")); return; }
        if (!done) chunks.push(chunk);
      });
      reply.on("aborted", function () { finish(new Error("Manifest unavailable.")); });
      reply.on("end", function () { if (!done) finish(null, { xml: Buffer.concat(chunks).toString("utf8"), url: url.href }); });
    });
    request.on("error", function () { finish(new Error("Manifest unavailable.")); });
    request.setTimeout(FETCH_MS, function () { finish(new Error("Manifest request timed out.")); });
    request.end();
  }
  visit(input, 0);
  return function () { finish(new Error("Manifest request cancelled.")); };
}

module.exports = function createPip(options) {
  var sessions = Object.create(null);
  var pending = 0;
  var pendingRequests = [];
  var generation = 0;
  function remove(id) {
    var session = sessions[id];
    delete sessions[id];
    if (session && session.cancel) session.cancel();
  }
  function clear() {
    generation += 1;
    Object.keys(sessions).forEach(remove);
    pendingRequests.slice().forEach(function (entry) { if (entry.cancel) entry.cancel(); });
  }
  function rejected(message, error) { message.respond({ returnValue: false, errorText: error }); }
  function authorized(message) {
    if (message.sender !== options.appId) { rejected(message, "Unauthorized."); return false; }
    return true;
  }
  function register(service, listening) {
    service.register("pipPrepare", function (message) {
      if (!authorized(message)) return;
      var payload = message.payload || {};
      var url = manifest.allowedURL(payload.url);
      var maxHeight = payload.maxHeight;
      var maxFrameRate = payload.maxFrameRate;
      if (!url || ["main", "sub"].indexOf(payload.role) < 0 || [360, 540, 720, 1080].indexOf(maxHeight) < 0 || maxFrameRate !== 50) {
        rejected(message, "Unsupported picture-in-picture request."); return;
      }
      if (pending + Object.keys(sessions).length >= MAX_SESSIONS) { rejected(message, "Too many picture-in-picture streams."); return; }
      var requestedGeneration = generation;
      pending += 1;
      var requestEntry = {};
      pendingRequests.push(requestEntry);
      requestEntry.cancel = fetchManifest(url.href, function (error, upstream) {
        pendingRequests.splice(pendingRequests.indexOf(requestEntry), 1);
        if (requestedGeneration !== generation) { pending -= 1; rejected(message, "Picture-in-picture request cancelled."); return; }
        if (error) { pending -= 1; rejected(message, error.message); return; }
        var filtered;
        try { filtered = manifest.filter(upstream.xml, upstream.url, { maxHeight: maxHeight, maxFrameRate: maxFrameRate }); }
        catch (failure) { pending -= 1; rejected(message, failure.message); return; }
        listening(function (ok) {
          pending -= 1;
          if (!ok || requestedGeneration !== generation) { rejected(message, "Picture-in-picture service unavailable."); return; }
          var id = crypto.randomBytes(32).toString("hex");
          sessions[id] = { url: url.href, maxHeight: maxHeight, maxFrameRate: maxFrameRate, dynamic: filtered.dynamic, xml: filtered.xml, refreshing: false };
          message.respond({ returnValue: true, id: id, url: "http://127.0.0.1:" + options.port + "/pip/" + id + ".mpd", height: filtered.height });
        });
      });
    });
    service.register("pipRelease", function (message) {
      if (!authorized(message)) return;
      var id = (message.payload || {}).id;
      if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) { rejected(message, "Invalid picture-in-picture stream."); return; }
      remove(id);
      message.respond({ returnValue: true });
    });
    service.register("pipReleaseAll", function (message) {
      if (!authorized(message)) return;
      clear();
      message.respond({ returnValue: true });
    });
  }
  function handle(req, res) {
    if (req.url.indexOf("/pip/") !== 0) return false;
    var match = /^\/pip\/([a-f0-9]{64})\.mpd$/.exec(req.url);
    var session = match && sessions[match[1]];
    if (!session) { res.writeHead(404); res.end(); return true; }
    if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return true; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    function send(xml) {
      if (sessions[match[1]] !== session) { res.writeHead(410); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/dash+xml; charset=utf-8", "Content-Length": Buffer.byteLength(xml, "utf8") });
      res.end(req.method === "HEAD" ? undefined : xml);
    }
    if (!session.dynamic || req.method === "HEAD") { send(session.xml); return true; }
    if (session.refreshing) { res.writeHead(503); res.end(); return true; }
    session.refreshing = true;
    var cancelled = false;
    var cancel = fetchManifest(session.url, function (error, upstream) {
      session.refreshing = false;
      session.cancel = null;
      if (cancelled) return;
      if (error) { res.writeHead(502); res.end(); return; }
      var filtered;
      try { filtered = manifest.filter(upstream.xml, upstream.url, session); }
      catch (_error) { res.writeHead(502); res.end(); return; }
      // Keep refreshing even if the event just became static: the local URL
      // remains authoritative and cannot ever reveal the original full ladder.
      session.xml = filtered.xml;
      send(filtered.xml);
    });
    session.cancel = cancel;
    res.on("close", function () { cancelled = true; cancel(); });
    return true;
  }
  return { register: register, handle: handle, clear: clear };
};
