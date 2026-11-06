"use strict";

// webOS 4 ships Node 0.12; later TVs ship Node 8. Keep this service on their
// shared API surface, including URL resolution and stream cancellation.
var url = require("url");
var querystring = require("querystring");

function ServiceURL(value, base) {
  if (typeof value !== "string" || /[\u0000-\u0020\\]/.test(value)) throw new Error("Invalid URL.");
  var parsed = url.parse(base ? url.resolve(String(base), value) : value);
  if (!parsed.protocol || !parsed.hostname) throw new Error("Absolute URL required.");
  this.protocol = parsed.protocol;
  this.hostname = parsed.hostname.toLowerCase();
  this.port = parsed.port || "";
  this.username = parsed.auth || "";
  this.password = "";
  this.hash = parsed.hash || "";
  this.pathname = parsed.pathname || "/";
  this.search = parsed.search || "";
  this.href = url.format(parsed);
  var self = this;
  this.searchParams = {
    getAll: function (name) {
      var fields = querystring.parse(self.search.slice(1));
      if (!Object.prototype.hasOwnProperty.call(fields, name)) return [];
      return Array.isArray(fields[name]) ? fields[name] : [fields[name]];
    },
    delete: function (name) {
      var fields = querystring.parse(self.search.slice(1));
      delete fields[name];
      var query = querystring.stringify(fields);
      self.search = query ? "?" + query : "";
      parsed.search = self.search;
      self.href = url.format(parsed);
    }
  };
}

function destroy(stream) {
  if (!stream) return;
  if (typeof stream.destroy === "function") stream.destroy();
  else if (typeof stream.abort === "function") stream.abort();
  else if (stream.connection && typeof stream.connection.destroy === "function") stream.connection.destroy();
}

module.exports = { URL: ServiceURL, destroy: destroy };
