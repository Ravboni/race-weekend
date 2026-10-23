# F1 TV for webOS (unofficial)

An experimental client for rooted LG webOS televisions, starting with the LG C2 (webOS 22). This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

## Status

This is an early, installable webOS TV shell. The first milestone checks the TV runtime's video and DRM capabilities. Login, catalogue access, and playback are not implemented yet. The project will use a valid F1 TV subscription and the TV's supported DRM pipeline; it will not decrypt, record, or redistribute protected streams.

## Development

The app is a standard webOS TV web app. Install LG's webOS TV CLI, register your TV as a device, then package and install the project with the CLI:

```sh
ares-package .
ares-install -d <device-name> com.ravboni.f1tv.webos_0.1.0_all.ipk
```

On a rooted TV, Homebrew Channel / Device Manager can also be used to install a built IPK. Keep the TV's developer or homebrew installation instructions specific to your firmware.

## Reverse-engineering notes

The Android TV application cannot run directly on webOS. The intended approach is to learn the official client's documented or observable account and content flows, then implement a webOS-native interface and use webOS Media Source Extensions / Encrypted Media Extensions for playback. Authentication tokens and DRM license material must remain on the device and must not be committed to this repository.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [webOS Homebrew](https://www.webosbrew.org/)
