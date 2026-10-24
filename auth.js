(function () {
  "use strict";

  const ID_ORIGIN = "https://id.formula1.com/as/";
  const F1_ORIGIN = "https://f1tv.formula1.com";
  const MANIFEST_HOSTS = new Set(["f1prodlive.akamaized.net"]);
  const LICENSE_HOSTS = new Set(["f1tv.formula1.com"]);
  const DEVICE_CLIENT_ID = "13c21153-f2f3-484b-a642-f2a2927e55de";
  const STORAGE_NAME = "f1tv-webos-session-v1";

  function trustedPlaybackUrl(value, allowedHosts, allowFormula1Hosts = false) {
    try {
      const url = new URL(value);
      const trustedHost = allowedHosts.has(url.hostname)
        || (allowFormula1Hosts && (url.hostname === "formula1.com" || url.hostname.endsWith(".formula1.com")));
      if (url.protocol !== "https:" || url.port || url.username || url.password || !trustedHost) return "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function decodeBase64Url(input) {
    let value = input.replace(/-/g, "+").replace(/_/g, "/");
    while (value.length % 4) value += "=";
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function decodeJsonPart(input) {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(input)));
  }

  function makeParams(values) {
    const params = new URLSearchParams();
    Object.keys(values).forEach((key) => params.append(key, String(values[key])));
    return params;
  }

  function createPairingController() {
    if (typeof AbortController === "function") return new AbortController();
    // Older webOS browsers expose fetch but do not implement AbortController.
    // Keep pairing functional there and ignore late responses after cancellation.
    return { signal: undefined, abort() {} };
  }

  async function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(STORAGE_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("session");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Secure sign-in storage is unavailable on this TV."));
    });
  }

  async function readValue(key) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction("session", "readonly").objectStore("session").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("Could not read the F1 TV session."));
    });
  }

  async function writeValue(key, value) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("session", "readwrite");
      transaction.objectStore("session").put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error("Could not save the F1 TV session."));
    });
  }

  async function saveToken(token) {
    let key = await readValue("key");
    if (!key) {
      key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await writeValue("key", key);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
    await writeValue("token", { iv, ciphertext });
  }

  async function loadToken() {
    const saved = await readValue("token");
    const key = await readValue("key");
    if (!saved || !key) return "";
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: saved.iv }, key, saved.ciphertext);
    return new TextDecoder().decode(plaintext);
  }

  async function clearToken() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("session", "readwrite");
      transaction.objectStore("session").clear();
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(new Error("Could not remove the F1 TV session."));
    });
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, { credentials: "omit", redirect: "error", ...options });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); } catch (_error) { throw new Error(`F1 TV returned an unexpected response (${response.status}).`); }
    if (!response.ok) {
      const error = new Error(`F1 TV sign-in failed (${response.status}).`);
      error.status = response.status;
      error.oauthError = typeof data.error === "string" ? data.error : "";
      throw error;
    }
    return data;
  }

  async function deviceRequest(path, fields, signal) {
    const body = makeParams(fields);
    return requestJson(`${ID_ORIGIN}${path}`, {
      method: "POST", signal,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    });
  }

  async function verifySubscriptionToken(token) {
    if (typeof token !== "string" || token.length > 32000) throw new Error("F1 TV did not provide a valid account session.");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("F1 TV did not provide a valid account session.");
    const header = decodeJsonPart(parts[0]);
    const claims = decodeJsonPart(parts[1]);
    const now = Date.now() / 1000;
    if (header.alg !== "RS256" || !header.kid || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now)) {
      throw new Error("The F1 TV account session has expired or is invalid.");
    }
    const jwksResponse = await fetch("https://api.formula1.com/static/jwks.json", { credentials: "omit", redirect: "error" });
    if (!jwksResponse.ok) throw new Error("Could not verify the F1 TV account session.");
    const jwks = await jwksResponse.json();
    const jwk = (jwks.keys || []).find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
    if (!jwk) throw new Error("Could not verify the F1 TV account session.");
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    if (!await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, decodeBase64Url(parts[2]), signed)) {
      throw new Error("Could not verify the F1 TV account session.");
    }
    return claims;
  }

  class F1Session {
    constructor() {
      this.token = "";
      this.entitlement = "";
      this.location = null;
      this.expires = 0;
      this.pending = null;
    }

    get signedIn() { return Boolean(this.token) && this.expires > Date.now() / 1000; }

    async validate(token, persist) {
      const claims = await verifySubscriptionToken(token);
      const entitlementData = await requestJson(`${F1_ORIGIN}/2.0/R/ENG/WEB_DASH/ALL/USER/ENTITLEMENT`, {
        headers: { ascendontoken: token, accept: "application/json" },
      });
      const entitlement = entitlementData.resultObj?.entitlementToken;
      if (!entitlement) throw new Error("F1 TV did not provide subscription access for this account.");
      const locationData = await requestJson(`${F1_ORIGIN}/1.0/R/ENG/WEB_DASH/ALL/USER/LOCATION`, {
        headers: { ascendontoken: token, entitlementtoken: entitlement, accept: "application/json" },
      });
      const location = locationData.resultObj?.userLocation?.[0];
      if (!location) throw new Error("F1 TV did not provide an account region.");
      if (persist) await saveToken(token);
      this.token = token;
      this.entitlement = entitlement;
      this.location = location;
      this.expires = claims.exp;
    }

    async restore() {
      try {
        const token = await loadToken();
        if (token) await this.validate(token, false);
      } catch (_error) {
        await clearToken();
      }
      return this.signedIn;
    }

    async beginPairing() {
      this.cancelPairing();
      const session = { controller: createPairingController(), code: "", userCode: "", nextPoll: 0, interval: 5000, expires: 0, cancelled: false, polling: false };
      this.pending = session;
      const data = await deviceRequest("device_authorization", { client_id: DEVICE_CLIENT_ID, scope: "openid f1tv_groups" }, session.controller.signal);
      if (session.cancelled || this.pending !== session) throw new Error("F1 TV sign-in was cancelled.");
      const url = new URL(data.verification_uri);
      if (url.protocol !== "https:" || url.hostname !== "f1.com" || url.pathname !== "/pair" || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(data.user_code || "") || !data.device_code) {
        this.cancelPairing();
        throw new Error("F1 TV returned an invalid TV pairing request.");
      }
      session.code = data.device_code;
      session.userCode = data.user_code;
      session.expires = Date.now() + Math.min(1800, Math.max(1, Number(data.expires_in) || 600)) * 1000;
      session.interval = Math.max(5000, Math.min(60000, (Number(data.interval) || 5) * 1000));
      session.nextPoll = Date.now() + session.interval;
      return { code: session.userCode, url: `${url.origin}${url.pathname}?user_code=${encodeURIComponent(session.userCode)}`, expires: session.expires };
    }

    async pollPairing() {
      const session = this.pending;
      if (!session || session.cancelled) throw new Error("F1 TV sign-in was cancelled.");
      if (session.polling) return false;
      if (Date.now() >= session.expires) throw new Error("The TV sign-in code expired. Start again to get a new code.");
      if (Date.now() < session.nextPoll) return false;
      session.polling = true;
      try {
        const data = await deviceRequest("token", {
          client_id: DEVICE_CLIENT_ID,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: session.code,
        }, session.controller.signal);
        if (session.cancelled || this.pending !== session) throw new Error("F1 TV sign-in was cancelled.");
        let claims;
        try { claims = decodeJsonPart(data.access_token.split(".")[1]); } catch (_error) { throw new Error("F1 TV returned an invalid sign-in response."); }
        if (!claims.subscriptionToken) throw new Error("F1 TV did not return the account session.");
        await this.validate(claims.subscriptionToken, true);
        this.cancelPairing();
        return true;
      } catch (error) {
        if (error.status === 400 && ["authorization_pending", "slow_down"].includes(error.oauthError)) {
          session.interval += error.oauthError === "slow_down" ? 5000 : 0;
          session.nextPoll = Date.now() + session.interval;
          return false;
        }
        throw error;
      } finally {
        session.polling = false;
      }
    }

    cancelPairing() {
      if (this.pending) {
        this.pending.cancelled = true;
        this.pending.controller.abort();
        this.pending.code = "";
        this.pending = null;
      }
    }

    async signOut() {
      this.cancelPairing();
      await clearToken();
      this.token = "";
      this.entitlement = "";
      this.location = null;
      this.expires = 0;
    }

    headers() {
      return { ascendontoken: this.token, entitlementtoken: this.entitlement };
    }

    async play(contentId, channelId = "") {
      if (!this.signedIn) throw new Error("Sign in to F1 TV to play this programme.");
      const params = makeParams({ contentId: String(contentId), player: "player_bm" });
      if (channelId) params.set("channelId", String(channelId));
      const response = await fetch(`${F1_ORIGIN}/2.0/R/ENG/WEB_DASH/ALL/CONTENT/PLAY?${params}`, {
        credentials: "omit", headers: { ...this.headers(), accept: "application/json" },
      });
      if (!response.ok) throw new Error(`F1 TV could not start playback (${response.status}).`);
      const data = await response.json();
      const result = data.resultObj;
      if (data.resultCode !== "OK" || !result) throw new Error("F1 TV did not provide a playable stream. Check your subscription and region.");
      const candidates = Array.isArray(result)
        ? result
        : [result, ...(Array.isArray(result.streams) ? result.streams : [])];
      const dashCandidates = candidates.filter((candidate) => {
        const manifest = trustedPlaybackUrl(candidate?.url || candidate?.manifestUrl, MANIFEST_HOSTS, true);
        return manifest && /DASH/i.test(candidate.streamType || "");
      });
      const licenseAddress = (candidate) => candidate.laURL || candidate.laUrl || candidate.licenseUrl || "";
      const drmLabel = (candidate) => String(candidate.drmType || candidate.drm || candidate.protectionType || "").toLowerCase();
      const isWidevine = (candidate) => /widevine|(^|[^a-z])wv([^a-z]|$)/i.test(`${drmLabel(candidate)} ${candidate.streamType || ""}`);
      const widevineStream = dashCandidates.find((candidate) => {
        const licenseUrl = trustedPlaybackUrl(licenseAddress(candidate), LICENSE_HOSTS);
        return isWidevine(candidate) && Boolean(licenseUrl);
      });
      const clearDashStream = dashCandidates.find((candidate) => {
        const label = drmLabel(candidate);
        const profile = `${label} ${candidate.streamType || ""}`;
        const explicitlyOtherDrm = /playready|fairplay|widevine|(^|[^a-z])wv([^a-z]|$)|encrypted|drm/i.test(profile);
        return !explicitlyOtherDrm && (!label || /^(none|clear|unprotected)$/i.test(label)) && !licenseAddress(candidate);
      });
      const stream = widevineStream || clearDashStream;
      if (!stream) throw new Error("F1 TV did not provide a playable DASH stream for this programme.");
      const manifest = trustedPlaybackUrl(stream.url || stream.manifestUrl, MANIFEST_HOSTS, true);
      const licenseUrl = widevineStream ? trustedPlaybackUrl(licenseAddress(stream), LICENSE_HOSTS) : "";
      const licenseHeaders = {};
      const entitlementToken = stream.entitlementToken || result.entitlementToken || this.entitlement;
      if (entitlementToken) licenseHeaders.entitlementtoken = entitlementToken;
      if (stream.drmToken) licenseHeaders.customdata = stream.drmToken;
      return {
        manifest,
        drmType: widevineStream ? "widevine" : "clear",
        licenseUrl: widevineStream ? licenseUrl : "",
        headers: widevineStream ? licenseHeaders : {},
      };
    }
  }

  window.F1Session = F1Session;
}());
