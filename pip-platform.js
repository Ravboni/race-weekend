/* Capability policy and bounded Luna client. Kept ES5 for webOS 4 / Chrome 53. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RaceWeekendPip = api;
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  var SERVICE = 'luna://com.ravboni.raceweekend.service/';
  var HOMEBREW = 'luna://org.webosbrew.hbchannel.service/';
  var CONTROL = '/media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-pip/control.sh';

  function resolve(input) {
    input = input || {};
    var device = input.device || {};
    var model = String(device.modelName || '').toUpperCase();
    var release = String(input.release || device.sdkVersion || '');
    var major = parseInt(release, 10) || 0;
    var chrome = /Chrome\/(\d+)/.exec(input.userAgent || '');
    var chromium = chrome ? Number(chrome[1]) : 0;
    var companion = input.companion || {};
    var root = ['available', 'unavailable'].indexOf(input.root) >= 0 ? input.root : 'unknown';
    var pip = {available: false, canActivate: false, mode: 'none', mainHeight: 1080,
      maxSubHeight: 720, maxFrameRate: 50, reason: 'Picture-in-picture is not available on this TV.'};
    var c9 = /^OLED(?:55|65|77)C9[A-Z0-9]*$/.test(model) && major === 4 && chromium === 53;
    if (input.isWebOS && chromium >= 79 && (!major || major >= 6)) {
      pip.available = true;
      pip.mode = 'native';
      // These families played dual HD in PR #41. Unmeasured models use 720p.
      pip.maxSubHeight = /^(?:43UP7500|50NANO75)[A-Z0-9]*$/.test(model) ? 1080 : 720;
      pip.reason = '';
    } else if (input.isWebOS && c9) {
      pip.reason = root === 'available'
        ? 'This TV needs compatible PiP support to be activated.'
        : 'Picture-in-picture on this TV requires root access through Homebrew Channel.';
      if (root === 'available' && companion.protocol === 1 && companion.profile === 'c9-avc-50') {
        pip.mode = 'root-c9';
        pip.available = companion.supported === true && companion.ready === true;
        pip.canDeactivate = companion.installed === true || pip.available;
        pip.canActivate = companion.supported === true && !pip.available && !pip.canDeactivate;
        if (pip.canDeactivate && !pip.available) pip.reason = 'Previous PiP support must be disabled before enabling this version.';
        if (pip.available) pip.reason = '';
      }
    }
    return {model: model || 'Unknown TV', release: release, firmware: String(device.firmwareVersion || device.version || ''),
      board: String(device.boardType || ''), chromium: chromium, root: root, pip: pip};
  }

  function subHeight(capabilities, requested) {
    var max = capabilities.pip.maxSubHeight;
    var value = Number(requested);
    return [360, 540, 720, 1080].indexOf(value) >= 0 ? Math.min(value, max) : max;
  }

  function createClient(host) {
    var pending = [];
    var keepAlive = null;
    function call(uri, params, timeout) {
      return new Promise(function (resolve, reject) {
        if (typeof host.PalmServiceBridge !== 'function') { reject(new Error('TV service unavailable.')); return; }
        var bridge, done = false;
        function finish(error, value) {
          if (done) return;
          done = true;
          host.clearTimeout(timer);
          var index = pending.indexOf(bridge);
          if (index >= 0) pending.splice(index, 1);
          try { if (bridge) bridge.cancel(); } catch (_) {}
          if (error) reject(error); else resolve(value);
        }
        var timer = host.setTimeout(function () { finish(new Error('TV service timed out.')); }, timeout || 5000);
        try {
          bridge = new host.PalmServiceBridge();
          pending.push(bridge);
          bridge.onservicecallback = function (text) {
            try { finish(null, JSON.parse(text)); } catch (_) { finish(new Error('Invalid TV service response.')); }
          };
          bridge.call(uri, JSON.stringify(params || {}));
        } catch (_) { finish(new Error('TV service unavailable.')); }
      });
    }
    function rootCommand(action) {
      if (['status', 'activate', 'begin', 'heartbeat', 'end', 'deactivate'].indexOf(action) < 0) return Promise.reject(new Error('Invalid PiP action.'));
      return call(HOMEBREW + 'exec', {command: 'sh ' + CONTROL + ' ' + action}, 15000).then(function (response) {
        var result;
        try { result = JSON.parse(String(response.stdoutString || '').trim()); } catch (_) {}
        if (!result || result.protocol !== 1) throw new Error('PiP support did not respond.');
        return result;
      });
    }
    function rootStatus() {
      // A missing/denied Homebrew service does not prove a TV is unrooted.
      return call(HOMEBREW + 'exec', {command: 'id -u'}, 4000).then(function (message) {
        var uid = String(message.stdoutString || '').trim();
        if (uid !== '0') return {root: /^\d+$/.test(uid) ? 'unavailable' : 'unknown', companion: null};
        return rootCommand('status').then(function (companion) {
          return {root: 'available', companion: companion};
        }, function () { return {root: 'available', companion: null}; });
      }, function () { return {root: 'unknown', companion: null}; });
    }
    function cbcsCommand(action) {
      if (['status', 'apply', 'disable'].indexOf(action) < 0) return Promise.reject(new Error('Invalid HD fix action.'));
      return call(HOMEBREW + 'exec', {
        command: 'sh /media/developer/apps/usr/palm/applications/com.ravboni.raceweekend/root-cbcs/control.sh ' + action
      }, 25000).then(function (response) {
        var result;
        try { result = JSON.parse(String(response.stdoutString || '').trim()); } catch (_) {}
        if (!result || result.protocol !== 1) throw new Error('HD fix status is unavailable.');
        return result;
      });
    }
    function deviceInfo() {
      return call('luna://com.webos.service.tv.systemproperty/getSystemInfo', {
        keys: ['modelName', 'firmwareVersion', 'sdkVersion', 'boardType']
      }, 3000).then(function (info) { return info.returnValue === true ? info : {}; }, function () { return {}; });
    }
    function retainService() {
      if (keepAlive || typeof host.PalmServiceBridge !== 'function') return;
      keepAlive = new host.PalmServiceBridge();
      keepAlive.onservicecallback = function () {};
      keepAlive.call(SERVICE + 'keepalive', JSON.stringify({subscribe: true}));
    }
    function prepare(url, role, height) {
      retainService();
      return call(SERVICE + 'pipPrepare', {url: url, role: role, maxHeight: height, maxFrameRate: 50}, 25000).then(function (result) {
        if (!result || result.returnValue !== true || !result.id || !/^http:\/\/127\.0\.0\.1:18741\/pip\/[a-f0-9]+\.mpd$/.test(result.url || '')) {
          throw new Error('Could not prepare a compatible PiP feed.');
        }
        return result;
      });
    }
    function release(id) {
      if (!id) return Promise.resolve();
      return call(SERVICE + 'pipRelease', {id: id}).catch(function () {});
    }
    function dispose() {
      try { if (keepAlive) keepAlive.cancel(); } catch (_) {}
      keepAlive = null;
      pending.slice().forEach(function (bridge) { try { bridge.cancel(); } catch (_) {} });
    }
    function releaseAll() { return call(SERVICE + 'pipReleaseAll', {}).catch(function () {}); }
    return {deviceInfo: deviceInfo, rootStatus: rootStatus, rootCommand: rootCommand, cbcsCommand: cbcsCommand,
      prepare: prepare, release: release, releaseAll: releaseAll, dispose: dispose};
  }
  return {resolve: resolve, subHeight: subHeight, createClient: createClient};
}));
