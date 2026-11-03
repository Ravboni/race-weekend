# webOS CORP bridge (catalog loading on webOS 6 / webOS 22)

## Problem

On LG webOS builds whose Chromium is new enough to enforce
`Cross-Origin-Resource-Policy` — webOS 6 (Chrome 79) and webOS 22 (Chrome 87) —
the home feed never loads and the app shows "Can't load the home feed."
Older webOS (for example the C9 on Chrome 53) is unaffected.

The cause is on the server, not in the app. The F1 TV API is served
**same-origin only**:

- it returns **no `Access-Control-Allow-Origin`** for any cross-origin caller
  (verified with `Origin: null` and `Origin: file://…`, including the OPTIONS
  preflight), and
- it sets **`Cross-Origin-Resource-Policy: same-origin`** (and
  `Cross-Origin-Opener-Policy: same-origin`).

A webOS web app runs from a `file://` origin, so every F1 request is
cross-origin. webOS already launches app renderers with `--disable-cors`, so
CORS is not the blocker — **CORP is**, and that flag does not cover it. The
request fails with `net::ERR_BLOCKED_BY_RESPONSE` (corp-not-same-origin). The C9
only works because its pre-CORP Chromium does not enforce the header.

Because the server refuses cross-origin reads outright, **no client-only change
can fix this** — not a `fetch` mode, not a service worker, not XHR. `no-cors`
returns an opaque, unreadable response. The only way for the webview to read the
API is a local reverse proxy that re-emits a permissive
`Cross-Origin-Resource-Policy: cross-origin` (plus `Access-Control-Allow-Origin`).

## Design

The proxy ships **inside the app's own IPK as a webOS JS service**
(`com.ravboni.raceweekend.service`) rather than as a separate root daemon:

- It installs unprivileged with the app (no root, no Homebrew `init.d` hook) and
  runs as the app's non-root service user.
- `bridge.js` starts it on demand over the Luna bus when the app loads, and
  holds one `keepalive` subscription open for the app's lifetime. webos-service
  exits a service ~5 s after its activity count reaches zero, so the open
  subscription keeps the proxy listening while the app is open and lets it exit
  cleanly when the app closes — no lingering process.
- The service listens only on `127.0.0.1:18741`, forwards only an allowlist of
  F1 hosts/paths (`f1tv.formula1.com` `1.0|2.0|4.0|image-resizer`,
  `api.formula1.com /static/jwks.json`, `id.formula1.com /as/…`) over normal
  TLS, adds no credentials, and persists no session state. Non-F1 media (the
  Akamai CDN) is not proxied; it has no CORP restriction and is fetched directly.
- `bridge.js` only activates on webOS with Chrome ≥ 73. On older webOS (the C9)
  it does nothing and the app reaches the API directly, exactly as before.
- The CSP gains `http://127.0.0.1:18741` in `connect-src` and `img-src` only.
- Each app launch establishes a fresh 256-bit session token over the app's own
  Luna service call. The proxy requires that token on every forwarded request
  and removes it before contacting F1; the token is not logged or sent upstream.
- The service accepts setup/status/keepalive calls only from the Race Weekend
  app ID. The local HTTP proxy no longer returns wildcard CORS: it allows only
  the packaged app origin observed on the C2 (`file://com.ravboni.raceweekend-webos`),
  and only the required methods and request headers. Other origins, including
  `null`, are rejected. Missing-origin requests still need the unpredictable
  session token and receive no CORS read permission.

webOS 6's Node is v8.12, so `service.js` stays ES5-ish (`URL` from `url`,
`https.request` with an options object).

## Files

- `service/` — the JS service (`services.json`, `package.json`, `service.js`).
- `bridge.js` — client shim: starts the service, holds the keepalive
  subscription, and rewrites F1 `fetch`/XHR/`imageUrl` to the local proxy.
- `index.html` — loads `bridge.js` and allows the loopback origin in the CSP.
- `scripts/package.sh` — stages `bridge.js` and the service into the IPK.

## Verification

The bridge's catalog behavior was validated on an LG 43UP7500PSF running webOS
6.5.3-47 / Chrome 79: the home catalogue and artwork loaded through the bundled
service. Playback was not tested on that model.

The hardened v0.16.33 test build was installed on the LG OLED55C25LB (C2). Its
packaged origin matched the allowlist; home, playback API, and artwork requests
completed through the bridge; playback remained active at 1920×1080; and
requests from an unrelated web origin and from `null` without a session token
returned `403` with no `Access-Control-Allow-Origin` header. The build was also
installed and launched on the LG OLED55E9PLA (E9). The user confirmed higher-
quality playback on that rooted test setup with v0.16.32; the E9's Chromium 53
browser does not activate the bridge. Playback media continues directly from the
CDN, so the bridge's token and API forwarding do not touch media segments or
quality selection.

The v0.16.33 package was a developer test build, not a public release. The newer
Auto-by-default quality and subtitles-Off behavior merged to `develop` after
that build and still needs device confirmation.

## Note for signed/published builds

This was validated with a developer-mode install, where an app may call its own
same-prefix service without extra configuration. On a signed release, confirm
the app is allowed to call `luna://com.ravboni.raceweekend.service/*`; no
`requiredACG`/`requiredPermissions` entries were needed in developer mode.
