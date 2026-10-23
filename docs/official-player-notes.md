# F1 TV client observations

These notes describe requests observed in the signed-in F1 TV TV-web client on an LG C2. They contain endpoint shapes only; account tokens, signed URLs, DRM challenge data, and license responses are deliberately excluded.

## Catalogue

- The navigation menu is returned by `GET /2.0/R/ENG/WEB_DASH/ALL/MENU/PRO/2`.
- Menu actions contain page request paths. The home page path should be read from the `Home` menu action rather than hardcoded.
- Pages are returned by paths such as `/2.0/R/ENG/WEB_DASH/ALL/PAGE/{pageId}/PRO/2`.
- Page sections expose `layout`, `title`, `metadata`, and `retrieveItems`. The items are in `retrieveItems.resultObj.containers`.
- Video details are returned by `GET /4.0/R/ENG/WEB_DASH/ALL/CONTENT/VIDEO/{contentId}/PRO/2`.
- The webOS app can request the menu, page, and image-resizer endpoints directly with `credentials: include`. The current home screen uses these feeds for its navigation, hero, category rails, and artwork.

## Playback

- The official web player requests `GET /3.0/R/ENG/WEB_HLS/ALL/CONTENT/PLAY` with `channelId`, `contentId`, and `player` query parameters.
- The observed request includes `ascendonToken`, `entitlementToken`, `x-f1-device-info`, and `sessionid` headers. Their values are user-specific and must remain on the TV.
- The successful response includes stream type, DRM type, a license-server URL, entitlement data, TME feed data, and player settings. The exact values are not stored here.
- The C2's WebView exposes MSE and EME APIs. F1 TV's own player has played a subscribed live feed on this C2. The app requests the `WEB_DASH` playback profile with the account's verified subscription and entitlement tokens, then configures dash.js to use the returned Widevine license endpoint in the app's own player view. Phone pairing and live 1920×1080 playback were confirmed on the C2: `readyState` reached 4, Widevine media keys were attached, and decoded frames advanced without drops. The TV display showed the protected picture; remote WebView screenshots show black video, as expected for protected content capture.

## Sign-in

- The app uses F1's OAuth device authorization flow. The TV shows F1's official pairing code and URL; the user approves the TV on their phone.
- The app reads the subscription session only from the returned signed OAuth response, verifies the nested subscription token against F1's published JWKS, and checks the account's entitlement and region endpoints.
- The subscription token is encrypted in IndexedDB using AES-GCM and a non-exportable WebCrypto key. Pairing codes, OAuth access tokens, subscription tokens, entitlement tokens, stream URLs, and DRM material are not written to source files or diagnostics.

## Boundaries

- Use the account's own subscription entitlement and the device's DRM implementation.
- Do not store or log authentication tokens, signed stream URLs, DRM challenges, or license responses.
- Do not decrypt, record, or redistribute protected media.
