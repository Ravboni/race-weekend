# CBCS HD repair integration

The application uses `control.sh status` as a read-only probe and `apply` only after the viewer requests the repair. The fixed command runs through Homebrew root exec; it never accepts an arbitrary path or command.

`status` identifies the actual installed Widevine decryptor by SHA256, not the TV model. Its JSON fields are `protocol`, `root`, `supported`, `needed`, `active`, `canApply`, `canDisable`, `owner`, `reason`, and `restartRequired`. UI should use **canApply**, not just `needed`, for the action. An unknown library is unsupported, not evidence that its firmware is defective. A missing root channel in the app is unknown root state, not proof of no root.

A recognized patched library, including the earlier `/var/lib/c9-cbcs-fix` overlay, reports active without changing it. The adapter never adopts or disables that legacy repair. Disable requires the current mount to share the exact device/inode of this upstream tool's payload, not merely matching bytes. Unknown overlays are preserved.

## Runtime packaging

Stage `control.sh`, `cbcs-hd-fix.sh`, and `LICENSE` under the application's `root-cbcs/`. `README.md` and `KNOWN_FIRMWARES.md` are source documentation. No LG library is shipped.

A successful new apply returns `restartRequired:true`. Unlike the temporary PiP companion, the upstream CBCS fix installs a **persistent webosbrew boot hook** plus a verified bind overlay, while preserving the original firmware file and a backup. The UI must explain persistence and fully close/reopen playback after applying it: a running media process can retain the old mapped library. This adapter intentionally does not restart system services or apps. A failed apply may also return restartRequired if its verified overlay is active.

The repair affects licensed **HD/1080p CBCS playback only**. It does not repair UHD or circumvent licenses, key acquisition, secure buffers or output protection.

## Provenance

Vendored unchanged from https://github.com/genericox/lg-webos-cbcs-hd-fix at commit `1e5d6d7b303d774c0ac1deebdfd14b58ef305b95` (MIT): `cbcs-hd-fix.sh`, `KNOWN_FIRMWARES.md`, `LICENSE`. The adapter verifies the script SHA256 before any mutation. The copyright/license file must accompany packaging. The known original/patched SHA256 pair in the adapter matches that pinned release; supporting another upstream profile requires an explicit reviewed update.

Local tests use an isolated filesystem and simulated mount commands; they never change a real TV. Optional offline tests can use a library copied from the owner's TV, but that file is not included in the repository.
