<p align="center">
  <img src="assets/brand/race-weekend-viewer-car-icon.png" alt="Red open-wheel race car app icon on a charcoal background" width="160">
</p>

<h1 align="center">Race Weekend Viewer</h1>

<p align="center">An unofficial, remote-friendly way to watch F1 TV on LG webOS.</p>

<p align="center">
  <a href="https://github.com/Ravboni/f1tv-webos/releases/latest">Download the latest release</a>
  ·
  <a href="docs/INSTALL.md">Installation guide</a>
</p>

**Race Weekend Viewer is built to bring F1 TV to LG webOS televisions.** It lets you sign in with your own F1 TV account, browse F1 TV's catalogue, and watch the streams available to your subscription using the television's web runtime and media capabilities. It is a webOS app in its own right, not the Android TV app running through an emulator.

> **Unofficial and experimental.** This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media. It requires an F1 TV account with the appropriate subscription. F1 may change its services, API, account flow, regional availability, or DRM requirements at any time.

## At a glance

| | |
| --- | --- |
| Current release | [0.16.24](https://github.com/Ravboni/f1tv-webos/releases/tag/v0.16.24) |
| Verified device | LG C2, webOS 11.2.0 |
| Install package | `.ipk` from GitHub Releases |
| TV setup | Rooted or Developer Mode |
| Subscription | Your own F1 TV subscription |

The C2 is the only tested model. Other LG webOS TVs may work, but have not been verified.

## Install on your TV

1. Download the `.ipk` from [the latest release](https://github.com/Ravboni/f1tv-webos/releases/latest).
2. Install it using [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) or LG's webOS CLI.
3. Open **Race Weekend Viewer** on the TV and follow the on-screen phone-pairing steps for your F1 TV account.

The [installation guide](docs/INSTALL.md) explains rooted TV and Developer Mode setup, install and update steps, CLI commands, and uninstalling. The package includes a SHA-256 checksum.

## What it can do

- Browse F1 TV home, live events, archive, search results, and video details.
- Sign in using F1's official phone-pairing flow.
- Play entitled live sessions and replays when F1 provides a stream compatible with the TV.
- Choose a live feed independently from the language and subtitle options offered for that feed.
- Navigate with the TV remote, including playback controls and D-pad seeking.
- Show a TV-scale interface with large cards, Roboto typography, and clear focus states.

Feed names, audio languages, subtitles, and available replays vary by event, account, and region.

## Remote controls

- **Up / Down / Left / Right:** Move through the focused screen or control.
- **OK:** Select the focused item; confirm a seek position while the playback timeline is active.
- **Back:** Close the current player panel or overlay, then navigate back through the app.
- **During playback:** Open feed and audio/subtitle choices from their separate controls; use the timeline to seek.

Exact behavior can vary slightly between TV remotes and webOS versions.

## Playback and known limitations

The app requests streams allowed by the signed-in account and uses webOS playback and DRM support. It does not decrypt, record, or redistribute protected video.

- A stream may be unavailable because of subscription tier, region, event rights, or F1's response for that item.
- Replay DRM metadata is not consistent across every archive item. Some replays may not play on a particular TV even when the account can open their details.
- Playback compatibility depends on the TV model and webOS firmware. Only the LG C2 on webOS 11.2.0 has been checked end to end.
- Changes to F1's services may temporarily break sign-in, catalogue browsing, or playback.

## Build from source

Requirements: Node.js 20 or newer, npm, and the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation).

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/f1tv-webos.git
cd f1tv-webos
./scripts/package.sh
```

The package is created under `dist/`. To install it, register your TV with `ares-setup-device`, then run:

```sh
ares-install --device myTV ./dist/com.ravboni.f1tv.webos_0.16.24_all.ipk
ares-launch --device myTV com.ravboni.f1tv.webos
```

Pushing a version tag such as `v0.16.24` runs the GitHub Actions release workflow. It packages the app and attaches the `.ipk` and checksum to the GitHub release.

## Account data and safe bug reports

The app encrypts its session on the TV in IndexedDB with AES-GCM and a non-exportable WebCrypto key. Pairing codes, account tokens, signed stream URLs, DRM challenges, and license responses must remain private. Never paste them into an issue, screenshot, log, or commit.

When reporting a problem, include the TV model, webOS version, app version, event or feed type, and the visible error message. See [the implementation notes](docs/official-player-notes.md) for non-secret observations about the sign-in, catalogue, and playback flows.

## App icon

The launcher mark is a purpose-made, unbranded race-car illustration. The high-resolution source artwork is [`assets/brand/race-weekend-viewer-car-icon-master.png`](assets/brand/race-weekend-viewer-car-icon-master.png), and [`assets/brand/race-weekend-viewer-car-icon.png`](assets/brand/race-weekend-viewer-car-icon.png) is its 512px preview. The app packages separate 80×80 small and 130×130 large icons as required by webOS. The design uses a centered, high-contrast silhouette with padding so it remains recognizable at launcher size. It follows the [Android TV safe-area and simplicity guidance](https://developer.android.com/design/ui/tv/guides/system/tv-app-icon-guidelines) and the [LG webOS app icon requirements](https://webostv.developer.lge.com/develop/references/appinfo-json).

## Third-party software and project license

The app bundles dash.js and a QR-code generator. Their license texts are in [`vendor/`](vendor/). Roboto's license is in [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt). No project-wide license has been declared for this repository; the bundled components retain their own licenses.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [LG webOS CLI installation and developer guide](https://webostv.developer.lge.com/develop/tools/cli-installation)
- [webOS Homebrew](https://www.webosbrew.org/)
