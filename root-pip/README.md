# C9 root PiP companion

This is an optional, temporary native companion for the exact C9 software in
`profile.sha256`. It does not root a TV. An ordinary app cannot invoke the
privileged lifecycle; the app uses an already available Homebrew root service.
Unsupported models/firmware stay disabled. Detection and `status` do not change
services, flags, mounts, or boot configuration.

## Runtime contract

Run the packaged `control.sh` through root exec, with one literal verb:

| Verb | Result |
|---|---|
| `status` | Read-only root/model/hash and current-hook readiness check |
| `activate` | Stage owned temporary files, reply `activating`, restart ACB/WAM after two seconds, relaunch Race Weekend |
| `begin` | Require current hooks and foreground Race Weekend; set ACB dual mode and begin a 12-second lease |
| `heartbeat` | Renew the lease only while Race Weekend is foreground; call every three seconds |
| `end` | Remove the lease and reset ACB dual/subwindow state; mapped hooks become inert |
| `deactivate` | Reply `deactivating`, restore stock jobs asynchronously, remove owned files, relaunch Race Weekend |

Every public response is JSON with `protocol:1`, `root`, `supported`, `ready`,
`installed`, `active`, `reason`, `profile:"c9-avc-50"`. Activation/deactivation restart the app;
UI must explain this and save any intended navigation before invoking them.
The companion does not install any boot hook. Reboot also removes the temporary
bind and libraries. Deactivate is required after temporary physical tests.

Runtime files live in root-owned mode-0711 (traversable by the unprivileged WAM user; not listable/writable) `/tmp/race-weekend-pip`. An activation
never replaces WebAppMgr or AcbService executables. It preserves the original
libsystrim preload and binds only its own copy of WebAppMgr's upstart config.
Only its own bind (verified by inode/device identity) can be unmounted. Existing
CBCS fixes, the LiveTV guard, app data and other TV configuration are untouched.
A small watchdog expires a missed heartbeat or foreground loss. No URL or F1
credential is accepted by this companion or written to its logs.

## Native behavior and ABI boundaries

`wam-hook.c` bypasses SuspendPreviousPlayers only for a verified Race Weekend
RenderView AND a root-owned unexpired lease. Ordinary pause/unload still work.
The two RenderView and two delegate adjustment thunks are covered. Application
identity is read from the inspected C9 layout: `RenderViewImpl::applicationId`
reads the string pointer/length at 0x534/0x538; GetRenderView returns impl+640.
That layout is safe to use only with the exact pinned libcbe binary.

`acb-hook.c` rewrites only Race Weekend register messages during the lease.
A positive displayOutput width <=640 means SUB (the app uses a576px window at1920px display width);
this is display geometry, not coded stream width. MAIN keeps its audio fields;
SUB uses manual DASS and muted audio. Both register in coherent dual mode.

Payload ownership: transformed buffers remain alive through the owning
LsMsgWrapper. The pinned non-PIE AcbService destructor D1/D0 calls LSMessageUnref
with return addresses0x51742/0x5175a; only these calls reclaim buffers. Other
LS2 references are passed through untouched. The handler has already copied and
parsed the text into JsonWrapper before destructor. A synchronized128-entry
cache bounds exceptional concurrent registrations; normal sequential openings
reclaim entries (tested with2000). This is explicitly tied to the AcbService
hash; no guessed liblunaservice refcount offsets are used.

The application controls stream resolution separately. The measured C9 profile
is main AVC1080p50 + secondary AVC720p50. These hooks do not impose ABR ceilings.

## Build and package

From Linux/WSL with arm-linux-gnueabi-gcc:

```sh
sh root-pip/build.sh /path/to/locally-extracted-C9-libc-and-libdl
```

The input directory must contain `libc.so.6` and `libdl.so.2` from the TV.
Those proprietary libraries are not distributed. Own hook sources and the two
compiled hook libraries may be packaged. The build uses time32 and the legacy
`__fxstat` ABI; `--no-undefined` rejects accidental dependencies on a modern
host glibc. Runtime imports were verified as GLIBC_2.4.

Ship these files inside the application's root-pip directory:

- control.sh
- profile.sha256
- hooks.sha256
- lib/librw-pip-wam.so
- lib/librw-pip-acb.so

A package upgrade with a different control script or hook checksums makes old runtime hooks unready;
status reports installed:true/reason:stale-build; deactivate the old runtime before activation of the new build. Never replace a
mapped library in place. Source files and build.sh need not ship in the IPK.

## Verification and limits

`node --test tests/root-pip.test.js` checks shipped ELF hashes/architecture and
runs the shell protocol fixture on Linux or Windows with WSL Ubuntu.
`python3 tests/root-pip-native.py` on Linux x86_64 needs gcc and host json-c.
It exercises the real hook code with fixture LS2 symbols: app scoping, all four
thunks, MAIN/SUB audio, nonroot/expired leases, ownership reclamation, unrelated
LS2 unrefs, stable pointers, and concurrent-cache exhaustion.

The integrated companion was activated and deactivated through the application's
Homebrew bridge on OLED55C9PSA / 05.50.00 / webOS 4.10.2. The viewer confirmed two
moving images and main audio. The final 30.03-second 1080p + 720p sample measured
49.98 decoded frames per second on each stream with zero reported decoder errors/drops.
These are decoder counters, not panel presentation measurements. Firmware/model
profiles other than the pinned C9 remain unverified.

The control fixture also exercises delayed-heartbeat/end serialization, stale
activation markers, exclusive lifecycle locking, missing watchdogs, and recovery
after unmount or the first WAM restart fails. `ready` requires the packaged
control/build and a live guard. Lifecycle locks survive in the worker only and
are released by process death; no stale marker can permanently block a retry.
