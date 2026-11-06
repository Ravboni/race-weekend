"use strict";
// Run with Node 8 as well as the current host Node. The TV service cannot rely
// on node:test or modern syntax even though the host tests can.
var assert = require("assert");
var fs = require("fs");
var vm = require("vm");
var path = require("path");
var manifest = require("../service/pip-manifest");
var xml = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="dynamic"><Period><AdaptationSet contentType="video" codecs="avc1.640028" frameRate="50"><Representation width="1280" height="720"/><Representation width="1920" height="1080"/></AdaptationSet></Period></MPD>';
var result = manifest.filter(xml, "https://f1prodlive.akamaized.net/a.mpd", { maxHeight: 720, maxFrameRate: 50 });
assert.strictEqual(result.height, 720);
assert.strictEqual(result.dynamic, true);
assert.strictEqual(result.xml.indexOf('height="1080"'), -1);
["service.js", "pip-manifest.js", "pip-service.js", "node-compat.js"].forEach(function (file) {
  new vm.Script(fs.readFileSync(path.join(__dirname, "../service", file), "utf8"), {filename:file});
});
var pip = require("../service/pip-service")({appId:"app",port:18741});
var handlers = {};
pip.register({register:function(name,fn) {handlers[name]=fn;}},function(cb){cb(true);});
handlers.pipPrepare({sender:"wrong",payload:{},respond:function(reply){assert.strictEqual(reply.returnValue,false);}});
pip.clear();
console.log(process.version + " manifest filter and service syntax passed");
