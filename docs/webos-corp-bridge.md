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
  TLS, adds no credentials, and stores nothing. Non-F1 media (the Akamai CDN) is
  not proxied; it has no CORP restriction and is fetched directly.
- `bridge.js` only activates on webOS with Chrome ≥ 73. On older webOS (the C9)
  it does nothing and the app reaches the API directly, exactly as before.
- The CSP gains `http://127.0.0.1:18741` in `connect-src` and `img-src` only.

webOS 6's Node is v8.12, so `service.js` stays ES5-ish (`URL` from `url`,
`https.request` with an options object).

## Files

- `service/` — the JS service (`services.json`, `package.json`, `service.js`).
- `bridge.js` — client shim: starts the service, holds the keepalive
  subscription, and rewrites F1 `fetch`/XHR/`imageUrl` to the local proxy.
- `index.html` — loads `bridge.js` and allows the loopback origin in the CSP.
- `scripts/package.sh` — stages `bridge.js` and the service into the IPK.

## Verification

Built with `scripts/package.sh` and validated on an LG 43UP7500PSF, webOS
6.5.3-47, Chrome 79 (installed via the unprivileged `dev/install`): the service
ran as a non-root user on `127.0.0.1:18741`, `bridge.js` started it on load, and
the home feed rendered 47 cards with the menu, `PAGE/395`, and all artwork
served `200` through the proxy with `Cross-Origin-Resource-Policy: cross-origin`
— with no root daemon. The keepalive subscription kept the service alive across
an idle period. Playback uses the same allowlisted proxy for its F1 API calls
and the direct CDN path for media, unchanged from the existing setup.

## Note for signed/published builds

This was validated with a developer-mode install, where an app may call its own
same-prefix service without extra configuration. On a signed release, confirm
the app is allowed to call `luna://com.ravboni.raceweekend.service/*`; no
`requiredACG`/`requiredPermissions` entries were needed in developer mode.
