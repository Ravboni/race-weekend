"use strict";

// The native DASH player does not consistently obey adaptiveStreaming limits.
// Keep one AVC representation per period; never let a refresh restore the full
// ladder. Audio/languages and the original segment timeline stay unchanged.
var XML = require("./vendor/xmldom");
var compat = require("./node-compat");
var URL = compat.URL;
var MAX_BYTES = 2 * 1024 * 1024;
var DASH_NS = "urn:mpeg:dash:schema:mpd:2011";

function allowedURL(value) {
  try {
    if (typeof value !== "string" || value.length > 16384) return null;
    var url = new URL(value);
    var allowedHost = url.hostname === "f1prodlive.akamaized.net" || /^(?:[a-z0-9-]+\.)*formula1\.com$/.test(url.hostname);
    if (!allowedHost || url.protocol !== "https:" || url.port || url.username || url.password || url.hash) return null;
    return url;
  } catch (_error) { return null; }
}

function children(node, name) {
  var result = [];
  for (var child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && (!name || child.localName === name)) result.push(child);
  }
  return result;
}
function inherited(node, name, stop) {
  for (var at = node; at && at !== stop; at = at.parentNode) {
    if (at.nodeType === 1 && at.hasAttribute(name)) return at.getAttribute(name);
  }
  return "";
}
function number(value) { return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : 0; }
function rate(value) {
  var parts = String(value).split("/");
  return parts.length === 1 ? number(parts[0]) : parts.length === 2 && number(parts[1]) > 0 ? number(parts[0]) / number(parts[1]) : 0;
}
function mediaKind(node, period) {
  var type = inherited(node, "contentType", period);
  var mime = inherited(node, "mimeType", period);
  var codec = inherited(node, "codecs", period);
  if (type === "video" || /^video\//.test(mime) || /^(?:avc[13]|hvc1|hev1|vp0[89]|av01)/i.test(codec)) return "video";
  if (type === "audio" || /^audio\//.test(mime) || /^(?:mp4a|ac-3|ec-3|opus)/i.test(codec)) return "audio";
  return "unknown";
}

function validateMediaURLs(root, source) {
  var work = [{ node: root, base: source }];
  var urlAttributes = {
    SegmentTemplate: ["media", "initialization", "index", "bitstreamSwitching"],
    SegmentURL: ["media", "index"],
    Initialization: ["sourceURL"],
    RepresentationIndex: ["sourceURL"]
  };
  while (work.length) {
    var entry = work.pop();
    var base = entry.base;
    children(entry.node, "BaseURL").forEach(function (child, index) {
      var resolved;
      try { resolved = new URL(child.textContent.trim(), entry.base).href; }
      catch (_error) { throw new Error("Invalid manifest base URL."); }
      if (!allowedURL(resolved)) throw new Error("Unsupported manifest base URL.");
      if (index === 0) base = resolved;
    });
    (urlAttributes[entry.node.localName] || []).forEach(function (name) {
      if (!entry.node.hasAttribute(name)) return;
      var resolved;
      try { resolved = new URL(entry.node.getAttribute(name), base).href; }
      catch (_error) { throw new Error("Invalid media URL."); }
      if (!allowedURL(resolved)) throw new Error("Unsupported media URL.");
    });
    children(entry.node).forEach(function (child) { work.push({ node: child, base: base }); });
  }
}

function filter(xml, sourceURL, limits) {
  if (typeof xml !== "string" || Buffer.byteLength(xml, "utf8") > MAX_BYTES) throw new Error("Manifest is too large.");
  var source = allowedURL(sourceURL);
  if (!source) throw new Error("Unsupported manifest URL.");
  var height = limits && limits.maxHeight;
  var maxRate = limits && limits.maxFrameRate;
  if ([360, 540, 720, 1080].indexOf(height) < 0 || maxRate !== 50) throw new Error("Unsupported video limit.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Invalid manifest declarations.");
  var document;
  try {
    document = new XML.DOMParser({ errorHandler: function () { throw new Error("Invalid manifest XML."); } }).parseFromString(xml, "application/xml");
  } catch (_error) { throw new Error("Invalid manifest XML."); }
  var root = document.documentElement;
  if (!root || root.localName !== "MPD" || root.namespaceURI !== DASH_NS || ["static", "dynamic", ""].indexOf(root.getAttribute("type") || "") < 0) throw new Error("Invalid DASH manifest.");
  // Reject external period/representation expansion and encrypted streams.
  // Remove DASH relocation/patch hints so native refreshes stay on our URL.
  var stack = [root];
  var count = 0;
  while (stack.length) {
    var element = stack.pop();
    if (++count > 50000) throw new Error("Manifest is too large.");
    if (element.localName === "ContentProtection") throw new Error("Protected manifests cannot use picture-in-picture.");
    if (element.localName === "Location" || element.localName === "PatchLocation") {
      element.parentNode.removeChild(element); continue;
    }
    for (var a = 0; a < element.attributes.length; a += 1) {
      var attr = element.attributes.item(a);
      if (attr.namespaceURI === "http://www.w3.org/1999/xlink" && attr.localName === "href") throw new Error("External manifest expansion is unsupported.");
      if (attr.namespaceURI === "http://www.w3.org/XML/1998/namespace" && attr.localName === "base") throw new Error("External XML base is unsupported.");
    }
    var descendants = children(element);
    for (var childIndex = 0; childIndex < descendants.length; childIndex += 1) stack.push(descendants[childIndex]);
  }
  var periods = children(root, "Period");
  if (!periods.length) throw new Error("Manifest has no video periods.");
  var selectedHeight = 0;
  periods.forEach(function (period) {
    var sets = children(period, "AdaptationSet");
    var candidates = [];
    sets.forEach(function (set) {
      children(set, "Representation").forEach(function (rep) {
        if (mediaKind(rep, period) !== "video") return;
        var codec = inherited(rep, "codecs", period);
        var h = number(inherited(rep, "height", period));
        var w = number(inherited(rep, "width", period));
        var fps = rate(inherited(rep, "frameRate", period));
        if (/^avc[13]\.[a-f0-9]+$/i.test(codec) && h > 0 && h <= height && w > 0 && w <= Math.ceil(height * 16 / 9) && fps > 0 && fps <= maxRate) {
          candidates.push({ rep: rep, set: set, height: h, width: w, fps: fps, bitrate: number(rep.getAttribute("bandwidth") || "") });
        }
      });
    });
    candidates.sort(function (a, b) { return b.height - a.height || b.width - a.width || b.bitrate - a.bitrate; });
    var selected = candidates[0];
    if (!selected) throw new Error("No AVC representation within the video limit.");
    selectedHeight = Math.max(selectedHeight, selected.height);
    sets.forEach(function (set) {
      var reps = children(set, "Representation");
      reps.forEach(function (rep) {
        var kind = mediaKind(rep, period);
        if (rep !== selected.rep && kind !== "audio") set.removeChild(rep);
      });
      if (!children(set, "Representation").length) { period.removeChild(set); return; }
      if (set === selected.set) {
        set.setAttribute("maxWidth", String(selected.width));
        set.setAttribute("maxHeight", String(selected.height));
        set.setAttribute("maxFrameRate", String(selected.fps));
      }
    });
  });
  // Resolution of root-relative references must still use the final CDN URL,
  // not the local manifest route. Preserve nested BaseURL semantics.
  var bases = children(root, "BaseURL");
  if (!bases.length) {
    var base = document.createElementNS(DASH_NS, "BaseURL");
    base.appendChild(document.createTextNode(new URL(".", source.href).href));
    root.insertBefore(base, root.firstChild);
  } else {
    bases.forEach(function (base) {
      var resolved;
      try { resolved = new URL(base.textContent.trim(), source.href).href; } catch (_error) { throw new Error("Invalid manifest base URL."); }
      if (!allowedURL(resolved)) throw new Error("Unsupported manifest base URL.");
      base.textContent = resolved;
    });
  }
  validateMediaURLs(root, source.href);
  return { xml: new XML.XMLSerializer().serializeToString(document), height: selectedHeight, dynamic: root.getAttribute("type") === "dynamic" };
}

module.exports = { filter: filter, allowedURL: allowedURL, MAX_BYTES: MAX_BYTES };
