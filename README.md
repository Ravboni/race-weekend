# F1 TV for webOS

An unofficial F1 TV client for LG webOS televisions. The app was developed and verified on a rooted LG C2 running webOS 11.2.0. It is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media.

> **Experimental software:** F1 can change its services, playback API, account flow, and DRM requirements at any time. A working subscription is required. Compatibility with other TV models and firmware versions has not been verified.

## Install

The easiest option is to download the latest `.ipk` from [GitHub Releases](https://github.com/Ravboni/f1tv-webos/releases/latest) and install it with [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest). See the step-by-step [installation guide](docs/INSTALL.md) for rooted TVs and Developer Mode TVs, plus command-line instructions.

After installation, open **F1 TV** from the TV's launcher and pair it with your F1 account using the on-screen code and URL.

## Features

- Browse F1 TV's home page, live events, archive, search, and video details.
- Sign in using F1 TV's phone-pairing flow.
- Watch entitled live and replay streams through the TV's own webOS media and DRM support.
- Choose available live feeds (such as F1 Live, International, tracker, data, or onboard cameras) independently from audio and subtitle tracks.
- Use the TV remote for navigation, feed and audio selection, playback controls, and seeking.
- Display a 4K-friendly TV layout with large cards, Roboto typography, and D-pad focus states.

Available feeds, languages, subtitles, and replay playback depend on what F1 returns for the event, account, and region.

## Build from source

Requirements: Node.js 20 or newer and npm. Install LG's webOS CLI, then package the app:

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/f1tv-webos.git
cd f1tv-webos
./scripts/package.sh
```

The installable package is written to `dist/`. For TV setup and installation, follow the CLI section in [docs/INSTALL.md](docs/INSTALL.md).

## Account and privacy

The app uses the signed-in user's own F1 TV subscription and entitlement. Its session is encrypted locally on the TV using IndexedDB, AES-GCM, and a non-exportable WebCrypto key. Authentication tokens, signed stream URLs, DRM challenges, and license responses should stay on the TV and must not be included in bug reports or commits. The app does not decrypt, record, or redistribute protected media.

## Known limitations

- F1's APIs and playback behavior can change without notice.
- A feed or replay may be unavailable because of subscription tier, region, event, or rights restrictions.
- Some replay responses have no usable Widevine metadata, while others require DRM capabilities that vary by TV firmware. Playback is therefore not guaranteed for every archive item.
- The LG C2 on webOS 11.2.0 is the only device configuration verified so far.

## Project and third-party licenses

No project-wide license is declared for this repository. The bundled dash.js and QR-code libraries retain their own licenses and notices in [`vendor/`](vendor/); the bundled Roboto font is covered by [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt).

## Technical notes

See [docs/official-player-notes.md](docs/official-player-notes.md) for non-secret observations about F1's catalogue, sign-in, and playback flows. The notes intentionally exclude account tokens, signed URLs, DRM challenges, and license responses.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [LG webOS CLI installation](https://webostv.developer.lge.com/develop/tools/cli-installation)
- [webOS Homebrew](https://www.webosbrew.org/)
