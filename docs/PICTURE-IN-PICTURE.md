# Picture-in-picture

Watch a second feed of the programme (an onboard, the tracker, the data feed) in a small window over the main one.

## Using it

- **Sources:** every feed has a **PiP** button next to it.
  - The feed button itself still switches the full screen.
  - With the window open, the panel adds **Swap** (the window's feed goes full screen), **Move** and **Close PiP**.
  - Tags show which feed is **Full screen** and which is **In PiP**. **PiP** on the full-screen feed swaps the two.
- **Car number:** type a driver's car number on the remote (for example `1` `6` for car 16) to open that driver's onboard in the window.
  - Another number changes the window's onboard.
  - The same number again puts that onboard full screen (swap).
  - `0` `0` closes the window.
  - On TVs without picture-in-picture, the number switches the full-screen feed instead.
- **First use:** the first programme with onboards shows a tip about car numbers, and the first window shows a short card with its remote controls. Both appear once.
- **Blue button:** moves the window to the next corner. The corner is remembered.
- **PiP quality:** Sources offers 360p, 540p, 720p and, on supported models, 1080p. The app remembers the choice and clamps it to this TV's profile. The main feed stays at up to 1080p50.
- **TV support:** available from the account screen and Sources. It shows model, firmware, webOS, board, root access and available repairs. On a supported rooted C9, enable PiP support here; activation restarts TV apps and reopens Race Weekend. Disable support here to restore the normal TV services.
- **Leaving the player** closes the window. Backgrounding the app also ends the dual-player session.

## Where it works

Only clear (DRM-free) AVC feeds are supported by the native dual-player path.

| Platform | Requirement | Main / secondary maximum |
| --- | --- | --- |
| webOS 6+, Chromium 79+ | Native PiP; root is not required | 1080p50 / 720p50 by default |
| LG 43UP7500 and 50NANO75 families on that platform | Existing dual-HD profile | 1080p50 / 1080p50 |
| OLED C9, webOS 4, Chromium 53 | Accessible Homebrew root service, exact supported firmware hashes, activated companion | 1080p50 / 720p50 |
| Other legacy TVs or unknown C9 firmware | No verified companion profile | PiP unavailable; single-feed playback remains available |

The app probes the actual TV and root service. A missing or denied Homebrew service is reported as root **unknown**, since the app cannot prove that a TV is unrooted. Root access alone never enables C9 PiP: the firmware, hook versions, mapped processes and watchdog must also match. Firmware updates fail closed until a matching profile is validated.

On OLED55C9PSA firmware 05.50.00 / webOS 4.10.2, the integrated app played a race and onboard at 1080p50 + 720p50. The final 30.03-second steady sample measured 49.98 decoded frames/second on each stream, with zero reported decoder errors or drops; the viewer confirmed both moving images and main audio. Decoder counters do not prove every frame reached the panel. This is a measured profile for this configuration, not a universal no-drop guarantee. Lower secondary resolutions are available for network or workload pressure.

## Rooted C9 support and HD repair

The bundled PiP companion creates temporary files under `/tmp`, binds its own WebAppMgr configuration and loads app-scoped hooks into the existing TV processes. It does not replace firmware executables or install a PiP boot hook. The hooks act only for Race Weekend while a short foreground lease is renewed. Closing PiP ends the lease; disabling support restores the services; a reboot removes the temporary installation. Details: [root companion](../root-pip/README.md).

TV support also checks the installed Widevine decryptor against the pinned [CBCS HD fix](https://github.com/genericox/lg-webos-cbcs-hd-fix). On a known affected library with root available, **Apply HD playback fix** runs the packaged repair; **Disable HD fix** removes a repair installed by this tool (never a legacy or foreign overlay). It detects and preserves an existing fix, including the earlier C9 overlay. Unknown firmware or foreign overlays are not modified.

Unlike PiP support, this repair persists through a webosbrew boot hook. The UI explains this before application and asks the viewer to restart the app afterward. It repairs the known HD/CBCS issue, not UHD. The existing C9 repair was detected on real hardware; fresh application was exercised in isolated fixtures, without removing the working TV repair. See [repair provenance and behavior](../root-cbcs/README.md).

## How it works

The native path addresses these platform limits:

1. **The webOS media player manager pauses one video as soon as another starts.** `appinfo.json` turns it off with `"mediaExtension": {"ums": {"disableMediaPlayerManager": true}}`. LG's own media app uses the same setting. On the C9 this setting is insufficient; the temporary root companion bypasses the app-scoped suspension decision during an active lease.
2. **A browser (MSE) `<video>` always asks the TV for its largest decode size (4096x2304).** That takes all four video decoders, so no second video can start.
   - While the window is open, both feeds play on the TV's own DASH player instead: a `<video>` with a `<source type="application/dash+xml;mediaOption=…">`.
   - The unprivileged bundled service fetches and filters the MPD to one AVC adaptation set per period, keeping its whole ladder under the TV's resolution and 50fps limits so the native player can still adapt. Native `mediaOption` limits are also supplied. If the local service cannot listen on webOS 6+, the original MPD is used with those native limits. Live manifests are refreshed and revalidated; a transient refresh failure briefly reuses the last filtered manifest; audio languages and timelines are retained.
   - Only allowlisted HTTPS F1 CDNs are fetched. The local manifest uses a random capability URL on loopback; upstream signed URLs stay in memory. Prepared streams are bounded and released on feed changes and app startup. The service supports the C9's Node 0.12.2 runtime.
3. **Sound.** The window's feed is sent to the TV's second video path with `avSink.videoSink.type: "sub_video"`. Naming an `avSink.audioSink` keeps it from taking the main sound output, so the main feed keeps its audio. The window plays muted.

## Trade-offs while the window is open

- **The browser player returns when the window closes**, at the same position. Opening or closing the window rebuffers the main feed.
- **Menus:** audio languages stay available (`video.audioTracks`). The quality menu and subtitles come back when the window closes.
- **Sync:** native players start at segment boundaries. The C9 coordinates a seek of both players; the integrated replay test was approximately 0.12 seconds apart after synchronization. Other platforms and live feeds can differ.
- **No 4K:** 2160p needs all four decoders, so the main feed plays in HD while the window is open.

## Development checks

`npm test` covers capability policy, manifest restrictions, service authorization/lifecycle, application cancellation and root-control failure recovery. `npm run test:service` exercises the complete loopback route with mocked Luna/upstream boundaries; run the same script on Node 0.12.2 for C9 compatibility. Linux/WSL Python fixtures cover native hook ownership and CBCS repair/rollback. No proprietary LG library is distributed in the package.
