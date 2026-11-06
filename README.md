<p align="center">
  <img src="assets/brand/race-weekend-logo-master.png" alt="Black and red Race Weekend logo" width="128">
</p>

<h1 align="center">Race Weekend</h1>

<p align="center">An unofficial, remote-friendly way to watch F1 TV on LG webOS.</p>

<p align="center">
  <a href="https://github.com/Ravboni/race-weekend/releases">Releases</a>
  ·
  <a href="docs/INSTALL.md">Installation guide</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
  ·
  <a href="docs/PR_HISTORY.md">PR history archive</a>
</p>

**Race Weekend is built to bring F1 TV to LG webOS televisions.** It lets you sign in with your own F1 TV account, browse F1 TV's catalogue, and watch the streams available to your subscription using the television's web runtime and media capabilities. It is a webOS app in its own right, not the Android TV app running through an emulator.

> **Unofficial and experimental.** This project is not affiliated with or endorsed by Formula 1, F1 TV, or Liberty Media. It requires an F1 TV account with the appropriate subscription. F1 may change its services, API, account flow, regional availability, or DRM requirements at any time.

## At a glance

| | |
| --- | --- |
| Latest release | [v0.2.1](https://github.com/Ravboni/race-weekend/releases/tag/v0.2.1) |
| Compatibility | See tested TV and webOS versions below |
| Install package | `.ipk` from GitHub Releases |
| TV setup | Rooted or Developer Mode |
| Subscription | Your own F1 TV subscription |

### Tested TV compatibility

| TV | webOS / browser | Verified results |
| --- | --- | --- |
| LG OLED55C25LB (C2) | webOS 11.2.0 | End-to-end app use; 1080p playback, audio, feeds, and subtitle selection confirmed. The hardened catalog bridge was also exercised. |
| LG OLED55E9PLA (E9) | webOS 4.5, firmware 05.50.00, Chromium 53 | Catalogue, phone pairing, remote navigation, and replay picture/audio confirmed. Playback above 540p was confirmed on this rooted test setup. |
| LG 43UP7500PSF | webOS 6.5.3-47, Chrome 79 | Catalogue/artwork and the original PR #41 dual-HD replay path (direct MPD) were tested. The service-filtered PiP manifest path is not yet validated on this model. |
| LG OLED55C9PSA (C9) | webOS 4.10.2, firmware 05.50.00, Chrome 53 | Rooted integration: race + onboard at 1080p50 / 720p50 with main audio; model/root detection and temporary PiP activation verified. Existing CBCS HD fix detected and preserved. |

The app's former fixed 540p bitrate ceiling has been removed. New playback starts in adaptive **Auto** with no app-imposed 540p cap; manual quality choices are available per stream and are not saved for the next stream. The E9's higher-quality playback was confirmed on this rooted test setup after earlier tests at 540p. This does not remove decoder or firmware limitations on every webOS 4.5 TV: the maximum quality can still vary by model, firmware, stream, and network.

These results describe specific devices and test builds, not every TV running the same webOS version. Release v0.2.1 adds Ultra HD playback choices on qualifying 4K TVs, including adaptive Ultra HD Auto, and includes the rooted-TV Live TV handling described below.

## Install on your TV

1. Download the latest `.ipk` from [Releases](https://github.com/Ravboni/race-weekend/releases/latest).
2. Install it using [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) or LG's webOS CLI.
3. Open **Race Weekend** on the TV and follow the on-screen phone-pairing steps for your F1 TV account.

The [installation guide](docs/INSTALL.md) explains rooted TV and Developer Mode setup, install and update steps, CLI commands, and uninstalling. New packages are published here after changes are promoted to `main`.

Public releases built after the provenance-enabled workflow reaches `main` include a GitHub Actions build attestation for the `.ipk`. GitHub currently limits artifact attestations to public repositories on Free, Pro, and Team plans; the workflow skips attestation while this repository is private. To verify a downloaded package with [GitHub CLI](https://cli.github.com/), run:

```sh
gh attestation verify ./path/to/downloaded-package.ipk --repo Ravboni/race-weekend
```

The attestation proves which repository workflow produced the package and binds that claim to its digest. It does not guarantee that the source code itself is free of defects.

## What it can do

- Browse F1 TV home, live events, archive, search results, and video details.
- Sign in using F1's official phone-pairing flow.
- Play entitled live sessions and replays when F1 provides a stream compatible with the TV.
- Choose a live feed independently from the audio language and subtitles offered for that feed.
- Start each stream in adaptive Auto quality with subtitles Off; select a specific available quality or subtitle track during playback.
- Play Ultra HD (2160p or 2880x1620 HDR) on qualifying 4K TVs when F1 offers it for the programme. See [Ultra HD playback](docs/ULTRA-HD.md).
- Watch a second feed (an onboard, the tracker, the data feed) in a picture-in-picture window on webOS 6 and later, or a compatible rooted C9. TV support detects the platform and caps both feeds accordingly. See [Picture-in-picture](docs/PICTURE-IN-PICTURE.md).
- Navigate with the TV remote, including playback controls and D-pad seeking.
- Show a TV-scale interface with large cards, Roboto typography, and clear focus states.

Feed names, audio languages, subtitles, and available replays vary by event, account, and region.

## Remote controls

- **Up / Down / Left / Right:** Move through the focused screen or control.
- **OK:** Select the focused item; confirm a seek position while the playback timeline is active.
- **Back:** Close the current player panel or overlay, then navigate back through the app.
- **During playback:** Open feed and audio/subtitle choices from their separate controls; use the timeline to seek.
- **Number keys (during playback):** Type a car number (for example `1` `6` for car 16) to open that driver's onboard in the picture-in-picture window; type the same number again to put it full screen, or `0` `0` to close the window. On TVs without picture-in-picture, the number switches the full-screen feed.
- **Blue button (during playback):** Move the picture-in-picture window to the next corner.
- **Sources → PiP:** Open a feed in the window. With the window open, **Swap** exchanges the two feeds, **Move** changes the corner and **Close PiP** returns to one feed.

Exact behavior can vary slightly between TV remotes and webOS versions.

## Playback and known limitations

The app requests streams allowed by the signed-in account and uses webOS playback and DRM support. It does not decrypt, record, or redistribute protected video.

- A stream may be unavailable because of subscription tier, region, event rights, or F1's response for that item.
- Replay DRM metadata is not consistent across every archive item. Some replays may not play on a particular TV even when the account can open their details.
- Playback compatibility depends on the TV model and webOS firmware. The configurations listed in [Tested TV compatibility](#tested-tv-compatibility) have been checked or reported; other combinations are unverified.
- Older webOS browsers use a capability-detected compatibility path for layout, JavaScript APIs, account pairing, and remote navigation. This path was verified on the OLED55E9PLA (Chromium 53).
- **Quality selection:** Playback starts in adaptive Auto and does not impose the former 540p bitrate ceiling. Available manual quality choices apply only to the current stream. Higher-than-540p playback was confirmed on the rooted OLED55E9PLA test setup; unmodified TVs with older decoders may still have hardware or firmware limits.
- **Ultra HD and Live TV (webOS 4):** On the OLED C9 (webOS 4.10), 2160p50 plays at 50 fps only while the Live TV app is closed. webOS 4 keeps Live TV running behind apps opened over it; its tuner decoder then shares the video decoder, and 2160p drops to ~43 fps. On rooted TVs with the Homebrew Channel, Race Weekend closes a background Live TV before playing 2160p. Elsewhere, the default **Ultra HD Auto** detects the drop and continues at 1620p HDR. Fixed 2160p and 1620p choices are also available. Details: [Ultra HD playback](docs/ULTRA-HD.md#findings-oled-c9-webos-4x-and-live-tv).
- **Subtitles:** New streams start with subtitles Off. F1 subtitle tracks remain selectable, and fragmented TTML rendering was confirmed in the C2 test build.
- **Picture-in-picture profiles:** webOS 6 and later use native dual playback without root. The supported C9 needs Homebrew root and a temporary companion enabled from **TV playback support** (on the sign-in/account screen or in Sources); disabling it restores the TV services, and a reboot removes it. The window's quality choices respect the detected model. See [Picture-in-picture](docs/PICTURE-IN-PICTURE.md).
- **CBCS HD repair (rooted TVs):** TV playback support also detects the known CBCS HD defect in the Widevine decryptor and offers the bundled repair. Unlike the PiP companion, this repair persists across reboots; it can be removed from the same screen only if this tool installed it. It does not fix 4K playback. See [repair behavior](root-cbcs/README.md).
- Release v0.2.1 adds Ultra HD options and webOS 4 Live TV handling; the playback defaults and subtitle updates were introduced in v0.2.0.
- Changes to F1's services may temporarily break sign-in, catalogue browsing, or playback.

## Build from source

Requirements: Node.js 20 or newer, npm, and the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation).

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/race-weekend.git
cd race-weekend
git switch develop
npm ci --ignore-scripts
./scripts/package.sh
```

Run `npm test` for the local checks (see [Development checks](docs/PICTURE-IN-PICTURE.md#development-checks)). The package is created under `dist/`. To install it, register your TV with `ares-setup-device`, then run:

```sh
ares-install --device myTV ./dist/com.ravboni.raceweekend_*.ipk
ares-launch --device myTV com.ravboni.raceweekend
```

Contributions go to `develop` first. The project owner promotes reviewed changes to `main` and creates version tags; only commits already on `main` can produce a release. See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and release workflow.

## Account data and safe bug reports

The app encrypts its saved session token with AES-GCM in IndexedDB. The non-exportable WebCrypto key is stored in that same database, so this is protection against casual file access, not secure or hardware-backed storage. It does not protect against code running in the app's origin or someone with root access to the TV.

Logging out clears the session stored on the TV; it does not revoke the token at F1, which remains valid until it expires. If the TV is lost or sold, remove it from your F1 account: sign in on the F1 TV website, open **Manage Account → My Subscriptions → Devices**, then edit the device list and remove the TV. See [F1's device management instructions](https://f1help.formula1.com/article/Managing-your-F1-TV-account).

Pairing codes, account tokens, signed stream URLs, DRM challenges, and license responses must remain private. Never paste them into an issue, screenshot, log, or commit.

When reporting a problem, include the TV model, webOS version, app version, event or feed type, and the visible error message. See [the implementation notes](docs/official-player-notes.md) for non-secret observations about the sign-in, catalogue, and playback flows.

## Brand assets

The app uses the supplied Race Weekend RW wordmark throughout its branding. The mark is tightly cropped from the transparent original so it remains large and legible in small graphics. The square launcher tile is [`assets/brand/race-weekend-logo.png`](assets/brand/race-weekend-logo.png); the original cropped transparent artwork is [`assets/brand/race-weekend-logo-master.png`](assets/brand/race-weekend-logo-master.png). The webOS package uses 80×80 and 130×130 versions of this mark in `icon.png` and `largeIcon.png`.

The repository banner is [`assets/brand/race-weekend-social-preview.jpg`](assets/brand/race-weekend-social-preview.jpg) (1280×640). It places the exact supplied wordmark on a light panel for contrast against a dark racing-inspired background. The logo assets retain the source lettering and proportions; only the empty transparent margins are cropped for the app-sized files.

## Third-party software and project license

The project is licensed under the [MIT License](LICENSE). The app bundles dash.js and a QR-code generator; their license texts are in [`vendor/`](vendor/). Roboto's license is in [`assets/fonts/OFL.txt`](assets/fonts/OFL.txt). The app service bundles @xmldom/xmldom ([`service/vendor/`](service/vendor/README.md)), and the CBCS HD repair script is vendored from lg-webos-cbcs-hd-fix with its MIT license in [`root-cbcs/`](root-cbcs/LICENSE). The C9 PiP hook libraries are built from this repository's own sources in [`root-pip/`](root-pip/README.md); no LG firmware library is distributed. These bundled components retain their own licenses.

To report a security issue, follow [`SECURITY.md`](SECURITY.md). Do not post vulnerabilities or account data in public issues.

## References

- [F1 TV supported devices](https://f1help.formula1.com/article/Supported-devices)
- [LG webOS streaming and DRM support](https://webostv.developer.lge.com/develop/specifications/streaming-protocol-drm)
- [LG webOS DRM content playback](https://webostv.developer.lge.com/develop/guides/drm-content-playback)
- [LG webOS CLI installation and developer guide](https://webostv.developer.lge.com/develop/tools/cli-installation)
- [webOS Homebrew](https://www.webosbrew.org/)
