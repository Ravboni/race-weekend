# Ultra HD (4K) playback

F1 TV serves Ultra HD only through its 3.0 PLAY API with the `HDR_UHD_CMAFWV` profile: HLS/CMAF, HEVC Main10 HLG and Widevine. Race Weekend plays it with hls.js (`vendor/hls.min.js`, loaded only when Ultra HD is used). Every other quality stays on dash.js.

Every F1 rendition, including 2160p and 2880x1620, is 50 fps.

## When the Ultra HD option appears

The option is listed in **Quality & audio** when the TV qualifies:

- a 4K panel (`PalmSystem.deviceInfo`),
- HEVC through Media Source Extensions,
- Widevine `HW_SECURE_DECODE` for HEVC,
- hls.js support.

It is enabled when the programme's master playlist lists an above-HD HEVC rendition whose media playlist answers. F1 returns 404 there for some time after recent events; the option then reads "not available for this video".

## Which height plays

- **The TV confirms smooth 2160p50:** when `navigator.mediaCapabilities.decodingInfo` reports 2160p50 HEVC as `smooth` (webOS 6 and newer, e.g. the LG 43UP7500), the option is **2160p · 4K HDR**.
- **The TV cannot confirm it:** webOS 4.x (Chromium 53) has no MediaCapabilities. These TVs get three choices:
  - **Ultra HD Auto** (the default) starts at 2160p and watches the decoder. When more than 1 frame in 25 is dropped over 6 s of steady playback, Auto resumes at the same position in **1620p · HDR**. It stays at 1620p until the app returns to the foreground, then tries 2160p again.
  - **2160p · 4K HDR** always plays 2160p.
  - **1620p · HDR** always plays the 2880x1620 HDR rendition.

The choice is remembered for the next programme, like the audio, subtitle and HD quality choices.

## Findings: OLED C9 (webOS 4.x) and Live TV

Measured on an LG OLED55C9PSA (webOS 4.10.2, Chromium 53, Widevine 14) with the Italian GP 2026 replay on 2026-11-04.

**Result.**
- Protected 2160p50 plays at a full **50 fps in real time (1.0x, 0 dropped frames)**, but only while the **Live TV app is not running**.
- With Live TV running in the background, the same stream decodes at **~43 fps**: about 12 frames are dropped per second and playback runs at **~0.85x**.
- 1620p50 plays at 50 fps either way.

**Why.**
- webOS 4 keeps **Live TV** (`com.webos.app.livetv`) running behind an app that was opened over it. Its tuner keeps decoding H.264 1080i at 29.97 fps the whole time.
- That second stream shares the TV's video decoder (a Realtek decoder driven by its own firmware).
- In the secure (Widevine) video path, one media thread decrypts each frame and then hands its slice list to the decoder firmware in a blocking call. With 2160p, 16 tiles per frame and the firmware also serving the tuner, that chain no longer fits in the 20 ms a 50 fps frame allows.
- 1620p frames still fit, so they play at 50 fps.
- Unprotected 2160p50 test streams also play at 50 fps: their decode path has no per-frame decrypt-and-submit chain.

**What was ruled out.**
- the network or buffer (25–30 s buffered, no `waiting` events),
- memory (a reboot changed nothing),
- the player code: dash.js, hls.js, older builds and a standalone pipeline all gave the same result,
- the title: Italy and Singapore behave the same,
- the Widevine decrypt plugin itself: making it faster did not change the frame rate, and the TrustZone call thread runs at only ~28% of one core.

**What viewers can do.**
- **Auto** (the default) detects the drop and continues at 1620p, so the picture stays smooth with no setup.
- For 2160p, close Live TV before playing:
  - The usual way is to open Race Weekend without Live TV running in the background.
  - On rooted TVs: `luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '{"id":"com.webos.app.livetv"}'`. A root-level helper can do this whenever Race Weekend comes to the foreground.
- Race Weekend cannot do this by itself: the application manager's running-app list (`applications.internal`) and `closeByAppId` are not available to apps on webOS 4.
- The 2160p choice forces 2160p. If Live TV is still running, it plays below real time.

**Other webOS 4 TVs.** Other models were not measured. Auto is designed to work the same way on them: it measures dropped frames and does not depend on a particular model.

## Live sessions

Ultra HD was tested on replays. Live sessions were not tested on older TVs.
