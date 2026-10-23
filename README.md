# F1 TV for webOS (unofficial)

An experimental client for rooted LG webOS televisions, starting with the LG C2. This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

## Status

The app has a remote-friendly webOS home screen, TV capability panel, and a one-click route into the official F1 TV web player. On an LG C2 running webOS 11.2.0, the official site loaded, accepted the selected cookie preference, and reached the signed-in F1 TV home page. The TV reported MSE, Widevine Modular, PlayReady, and HEVC support. Live playback of the 2026 United States Grand Prix Practice 1 is confirmed on the physical panel. The player reached ready state 4, reported 1920×1080, had EME media keys, and its playback time and buffer advanced. The catalogue, sign-in and playback remain handled by F1 TV's own player; a webOS-native content catalogue/player is future work. The project uses a valid F1 TV subscription and the TV's supported DRM pipeline; it does not decrypt, record, or redistribute protected streams.

## Development

The app is a standard webOS TV web app. Install LG's current webOS CLI, register your TV as a device, then package and install the project with the CLI:

```sh
ares-package .
ares-install -d <device-name> com.ravboni.f1tv.webos_0.2.0_all.ipk
```

On a rooted TV, Homebrew Channel / Device Manager can also be used to install a built IPK. Keep the TV's developer or homebrew installation instructions specific to your firmware.

## Reverse-engineering notes

The Android TV application cannot run directly on webOS. The intended approach is to learn the official client's documented or observable account and content flows, then implement a webOS-native interface and use webOS Media Source Extensions / Encrypted Media Extensions for playback. Authentication tokens and DRM license material must remain on the device and must not be committed to this repository.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [webOS Homebrew](https://www.webosbrew.org/)
