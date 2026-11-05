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
- **Leaving the player** closes the window.

## Where it works

- webOS 6 and later (Chromium 79+), and only with DRM-free feeds.
- F1 TV serves the HD feeds of these TVs in the clear.
- Tested on an LG 43UP7500 (webOS 6.5.3) with a 2026 race replay: F1 LIVE plus an onboard, both at 1080p.
- Not available on webOS 4 or 5.

## How it works

Three platform limits had to be worked around:

1. **The webOS media player manager pauses one video as soon as another starts.** `appinfo.json` turns it off with `"mediaExtension": {"ums": {"disableMediaPlayerManager": true}}`. LG's own media app uses the same setting.
2. **A browser (MSE) `<video>` always asks the TV for its largest decode size (4096x2304).** That takes all four video decoders, so no second video can start.
   - While the window is open, both feeds play on the TV's own DASH player instead: a `<video>` with a `<source type="application/dash+xml;mediaOption=…">`.
   - The main feed is capped at 1080p, which uses two decoders. The window's feed uses the other two.
3. **Sound.** The window's feed is sent to the TV's second video path with `avSink.videoSink.type: "sub_video"`. Naming an `avSink.audioSink` keeps it from taking the main sound output, so the main feed keeps its audio. The window plays muted.

## Trade-offs while the window is open

- **The browser player returns when the window closes**, at the same position. Opening or closing the window rebuffers the main feed.
- **Menus:** audio languages stay available (`video.audioTracks`). The quality menu and subtitles come back when the window closes.
- **Sync:** the window starts at the main feed's position but ends up about 1 to 3 seconds behind, because the TV player starts at a segment boundary.
- **No 4K:** 2160p needs all four decoders, so the main feed plays in HD while the window is open.
