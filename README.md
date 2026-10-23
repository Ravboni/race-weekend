# F1 TV for webOS (unofficial)

An experimental client for rooted LG webOS televisions, starting with the LG C2. This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

## Status

The app reads F1 TV's menu and catalogue feeds into its own webOS home, sections, and detail screens. Version 0.4.2 adds F1's phone pairing flow, an encrypted on-device session store, and an in-app DASH/Widevine playback path with full-screen controls. The catalogue, account pairing, and 1080p protected playback have been verified on an LG C2 running webOS 11.2.0. It uses the account's own F1 subscription and the TV's Widevine pipeline. It does not decrypt, record, or redistribute protected streams.

## Development

The app is a standard webOS TV web app. Install LG's current webOS CLI, register your TV as a device, then package and install the project with the CLI:

```sh
ares-package .
ares-install -d <device-name> com.ravboni.f1tv.webos_0.4.2_all.ipk
```

On a rooted TV, Homebrew Channel / Device Manager can also be used to install a built IPK. Keep the TV's developer or homebrew installation instructions specific to your firmware.

## Reverse-engineering notes

The Android TV application cannot run directly on webOS. This client uses F1 TV's menu, page, video, phone authorization, entitlement, and playback APIs. The signed-in subscription token is encrypted in IndexedDB with a non-exportable WebCrypto key. Playback licenses are requested by dash.js through the TV's Encrypted Media Extensions implementation. Authentication tokens, signed stream URLs, DRM challenges, and license responses must remain on the TV and must not be committed to this repository.

## Third-party software

The bundled dash.js 4.7.4 player is distributed under the BSD 3-Clause license. The QR code generator is MIT licensed. Their license texts are included in `vendor/`.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [webOS Homebrew](https://www.webosbrew.org/)
