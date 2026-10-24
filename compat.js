(function detectRuntimeProfile() {
  "use strict";

  var userAgent = navigator.userAgent || "";
  var chromeMatch = userAgent.match(/Chrome\/(\d+)/);
  var chromeMajor = chromeMatch ? Number(chromeMatch[1]) : 0;
  var webOS = /Web0S|webOS/i.test(userAgent);
  var style = document.documentElement.style;
  var hasInset = "inset" in style;
  var hasAspectRatio = "aspectRatio" in style;
  var hasFlexGap = false;

  try {
    var probe = document.createElement("div");
    var first = document.createElement("div");
    var second = document.createElement("div");
    probe.style.cssText = "position:absolute;left:-10000px;top:0;display:flex;flex-direction:column;row-gap:1px;";
    first.style.cssText = "display:block;width:1px;height:1px;";
    second.style.cssText = "display:block;width:1px;height:1px;";
    probe.appendChild(first);
    probe.appendChild(second);
    document.documentElement.appendChild(probe);
    hasFlexGap = probe.getBoundingClientRect().height === 3;
    document.documentElement.removeChild(probe);
  } catch (_error) {
    hasFlexGap = false;
  }

  // Select layout fallbacks by actual browser capabilities, with the Chromium
  // version as a guard for older webOS builds that report partial CSS support.
  if (webOS && (chromeMajor < 60 || !hasInset || !hasAspectRatio || !hasFlexGap)) {
    document.documentElement.className += " legacy-webos";
  }

  // Array.flatMap arrived well after the Chromium version used by some TVs.
  // The app uses it to enumerate D-pad focus targets.
  if (!Array.prototype.flatMap) {
    Array.prototype.flatMap = function flatMap(callback, thisArg) {
      var output = [];
      for (var index = 0; index < this.length; index += 1) {
        if (!(index in this)) continue;
        var value = callback.call(thisArg, this[index], index, this);
        if (Array.isArray(value)) {
          for (var item = 0; item < value.length; item += 1) output.push(value[item]);
        } else {
          output.push(value);
        }
      }
      return output;
    };
  }
})();
