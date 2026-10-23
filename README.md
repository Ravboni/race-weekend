# F1 TV for webOS (unofficial)

An experimental client for rooted LG webOS televisions, starting with the LG C2. This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

## Status

The app reads F1 TV's menu and catalogue feeds into its own webOS home, sections, and detail screens. Version 0.16.1 applies Android TV's Standard Card layout to catalogue cards: 16:9 thumbnails, centered title and subtitle text, 8dp image-to-content spacing, a 40dp text block, and 20dp rail spacing. Card width adapts to the app rail so four full cards and a peek of the next card fit across the C2 screen. Focus enlarges the card image with a white edge and red glow; pressing shows a muted gray edge. It also adds safe focus gutters around horizontal card rails so the first and last cards can expand without clipping. Version 0.15.0 removed focus outline rings from non-card controls, using scale, surface color, and elevation to show focus and selection. Version 0.14.0 added an immersive featured carousel with a cinematic image scrim, overline/title/description/action content block, bottom-end pagination dots, 5-second rotation, pause-on-focus, and D-pad slide navigation. Version 0.13.3 uses compact 48px pill tabs for the top level page destinations, with a translucent red selection and scale/surface focus state without an outline ring or underline. Version 0.12.0 separated video feed selection from audio and subtitles, added subtitle track controls when a feed provides them, and used webOS history for predictable remote Back behavior through playback panels and controls. The app also supports catalogue search, phone pairing, an encrypted on-device session store, live session feed selection, and an in-app DASH/Widevine player with full-screen and live-window controls. Playback and navigation have been verified on an LG C2 running webOS 11.2.0. It uses the account's own F1 subscription and the TV's Widevine pipeline. It does not decrypt, record, or redistribute protected streams.

## Development

The app is a standard webOS TV web app. Install LG's current webOS CLI, register your TV as a device, then package and install the project with the CLI:

```sh
ares-package .
ares-install -d <device-name> com.ravboni.f1tv.webos_0.6.0_all.ipk
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
