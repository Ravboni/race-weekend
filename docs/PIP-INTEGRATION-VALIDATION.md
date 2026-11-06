# PiP integration validation — 2026-11-05

Base: PR #41 head `1e471ffdd27bb23277e0b2a233e9c3ac36d43256`, branch `feat/picture-in-picture`. This records the local implementation; no PR publication or release is implied.

## C9 hardware

- OLED55C9PSA; firmware 05.50.00; webOS 4.10.2; Chromium 53; board O18_ATSC_KR; native service runtime Node 0.12.2.
- TV identity/root and compatible companion detected by the app. Activation was invoked using its TV support button and Homebrew bridge. Both native hooks and the watchdog became ready; sign-in survived the restart.
- Existing CBCS HD repair was recognized as `owner:legacy-c9`, `active:true`, `canApply:false`. Its library and boot configuration were preserved. Fresh CBCS application was tested only with isolated fixtures.
- F1 Mexico replay: main F1 LIVE (1033), onboard (1009). Viewer confirmed two moving images and main audio. No claim of Portuguese audio in this test.
- Final source: 1920×1080 main and 1280×720 secondary, both advancing/readyState4. Decoder padding reports the main height as 1088.
- Final steady sample: 30.03 seconds, 49.98 decoded fps on each stream, 0 decoder error deltas, 0 dropped-counter deltas. Earlier integrated sample: 30.02 seconds, 50.00/49.97 fps. These counters do not establish panel presentation timing.
- Live TV pipeline had no decoder resources. The existing LiveTV guard was preserved.
- Quality 720→540, pause/change-quality/resume, move and swap exercised through the app controls. Closing PiP returned to the browser player with the root lease ended.
- The TV changed DHCP address during the test. Reconnection verified its existing SSH host key and MAC; this was not an app activation failure.

## Local verification

- `npm test`: 31 passing tests, including application races, capability policy, manifest filtering, service bounds and root-control protocol.
- Actual Node 0.12.2: complete service route smoke passed with mocked Luna/upstream endpoints and real local HTTP.
- CBCS fixture: 11 passing cases, including failed apply preventing activation on next boot.
- Native hook harness: application/lease scoping, all four suspension thunks, MAIN/SUB audio ownership, lifetime reclamation and bounded cache.
- Root fixture: delayed heartbeat versus end, stale marker recovery, lifecycle lock, stale build/missing watchdog refusal, first WAM restart failure after successful unmount, and failed unmount restoring WAM.
- Browser smoke: desktop 1920 and mobile 390 TV-support layout, modal navigation and no JavaScript errors.
- Package built; runtime sources/checksums verified; no proprietary LG firmware libraries included.
- Full code review covered correctness, security, testing, maintainability, performance, reliability, frontend races and an independent adversarial pass. Eleven findings were fixed; final receipt had no remaining findings. External cross-model review did not run (local tool dependency missing).

## Limits

Real hardware validation used a replay, not a current live event or a long-duration soak. Dynamic MPD refresh is covered by fixtures; actual live playback and other firmware remain unverified. The webOS 6+ path through the service-filtered manifest has no physical validation in this change. Root access does not imply support for arbitrary legacy TV models. The main cap during PiP is 1080p50 and the measured C9 secondary cap is 720p50. UHD/CBCS mosaics are outside this repair.

## Final TV state and artifact

The final companion was disabled through the app. All hook mappings and its
WebAppMgr bind were absent; its temporary runtime was removed. The temporary
app/service mounts were detached and all three original file hashes matched.
Test files were removed. Foreground was restored to `io.freemytv`; the LiveTV
guard and existing CBCS overlay remained active. The new feature is available
in the local package, not permanently installed by this temporary test.

Package: `dist/com.ravboni.raceweekend_0.2.1_all.ipk` (667870 bytes).
SHA256: `a104a4875a7ae3cc21302cc2ab819551e1456273c74685706492ded613cdbe0b`.
Version remains the base development version; no release or publication occurred.
