# F1 TV for webOS (unofficial)

An experimental client for rooted LG webOS televisions, starting with the LG C2. This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

## Status

The app reads F1 TV's signed-in menu and catalogue feed into its own webOS home, section, and content-detail screens. It renders the service's current hero, categories, session information, and artwork, with remote navigation across rails and sections. The catalogue feed is requested directly from F1 TV and account cookies stay in the TV's webview. On an LG C2 running webOS 11.2.0, F1 TV's official player has been confirmed for live playback at 1920×1080 with MSE and EME media keys. The current development build hands playback to F1 TV's official player; a fully native in-app player and search are still in progress. The project uses the signed-in F1 TV account and TV's supported DRM pipeline; it does not decrypt, record, or redistribute protected streams.

## Development

The app is a standard webOS TV web app. Install LG's current webOS CLI, register your TV as a device, then package and install the project with the CLI:

```sh
ares-package .
ares-install -d <device-name> com.ravboni.f1tv.webos_0.3.2_all.ipk
```

On a rooted TV, Homebrew Channel / Device Manager can also be used to install a built IPK. Keep the TV's developer or homebrew installation instructions specific to your firmware.

## Reverse-engineering notes

The Android TV application cannot run directly on webOS. The app uses F1 TV's current menu, page, and video catalogue endpoints to build its own navigation and screens. Playback work will use the official subscription entitlement and the webOS Media Source Extensions / Encrypted Media Extensions path. Authentication tokens and DRM license material must remain on the device and must not be committed to this repository.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [webOS Homebrew](https://www.webosbrew.org/)
