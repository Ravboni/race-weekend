"use strict";
// Full service startup, Luna authorization and HTTP routes on the TV's Node
// versions, with only the external F1 transport and Luna registration stubbed.
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var http = require("http");
var https = require("https");
var PassThrough = require("stream").PassThrough;
var EventEmitter = require("events").EventEmitter;
var serviceDir = path.resolve(__dirname, "../service");
var handlers = {};
var server;
var fetches = 0;
var fixture = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic" minimumUpdatePeriod="PT2S"><Period><AdaptationSet contentType="video" codecs="avc1.640028" frameRate="50"><Representation id="small" width="1280" height="720"/><Representation id="large" width="1920" height="1080"/></AdaptationSet></Period></MPD>';
var originalRequest = https.request;
https.request = function (options, onResponse) {
  fetches += 1;
  var req = new EventEmitter();
  req.setTimeout = function () {};
  req.abort = function () {};
  req.end = function () {
    process.nextTick(function () {
      var reply = new PassThrough();
      reply.statusCode = 200;
      reply.headers = { "content-type": "application/dash+xml" };
      onResponse(reply);
      reply.end(fixture);
    });
  };
  return req;
};
function FakeService() {}
FakeService.prototype.register = function (name, handler) { handlers[name] = handler; };
var watchdog = setTimeout(function () { throw new Error("Legacy service test timed out."); }, 10000);
function get(route, origin, callback) {
  var opts = { hostname: "127.0.0.1", port: server.address().port, path: route, headers: {} };
  if (origin) opts.headers.origin = origin;
  http.get(opts, function (res) {
    var body = "";
    res.on("data", function (chunk) { body += chunk; });
    res.on("end", function () { callback(res.statusCode, body); });
  }).on("error", function (error) { throw error; });
}
function call(name, payload, sender, callback) {
  handlers[name]({ sender: sender, payload: payload, respond: callback });
}
var source = fs.readFileSync(path.join(serviceDir, "service.js"), "utf8").replace("var PORT = 18741;", "var PORT = 0;");
vm.runInNewContext(source, {
  require: function (name) {
    if (name === "webos-service") return FakeService;
    if (name === "http") return { createServer: function (handler) { server = http.createServer(handler); return server; } };
    return name.slice(0, 2) === "./" ? require(path.join(serviceDir, name)) : require(name);
  }, Buffer: Buffer, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout
}, { filename: "service.js" });
var app = "com.ravboni.raceweekend";
call("pipPrepare", {}, "attacker", function (reply) { assert.strictEqual(reply.returnValue, false); });
call("start", {}, app, function (started) {
  assert.strictEqual(started.started, true);
  assert.strictEqual(started.listening, true);
  assert(/^[a-f0-9]{64}$/.test(started.token));
  get("/f1tv.formula1.com/2.0/test", null, function (status) {
    assert.strictEqual(status, 403);
    get("/f1tv.formula1.com/2.0/test?__rwv_session=" + started.token, null, function (code, body) {
      assert.strictEqual(code, 200); assert(body.indexOf("MPD") >= 0);
      call("pipPrepare", { url: "https://f1prodlive.akamaized.net/a.mpd", role: "sub", maxHeight: 720, maxFrameRate: 50 }, app, function (prepared) {
        assert.strictEqual(prepared.returnValue, true); assert.strictEqual(prepared.height, 720);
        var route = prepared.url.replace(/^http:\/\/127\.0\.0\.1:\d+/, "");
        get(route, "https://attacker.example", function (denied) {
          assert.strictEqual(denied, 403);
          get(route, null, function (ok, xml) {
            assert.strictEqual(ok, 200); assert(xml.indexOf('id="large"') < 0); assert(xml.indexOf('id="small"') >= 0);
            call("pipReleaseAll", {}, app, function (released) {
              assert.strictEqual(released.returnValue, true);
              get(route, null, function (gone) {
                assert.strictEqual(gone, 404);
                clearTimeout(watchdog);
                https.request = originalRequest;
                server.close(function () { console.log(process.version + " full service routes passed (" + fetches + " upstream requests)"); });
              });
            });
          });
        });
      });
    });
  });
});
