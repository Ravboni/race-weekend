# Repository-specific working notes

## Installing updates on the rooted LG C2

The rooted C2 is registered locally as `luma-c2`. Use the already configured root SSH key; never print or copy the private key.

### Verified update procedure

1. Build the install package from the repository root with `./scripts/package.sh`. Use the versioned `.ipk` produced under `dist/`.
2. Copy the package to the TV with SFTP/SCP at `/media/developer/temp/<package-name>.ipk` if the webOS CLI has not already staged it.
3. Install it through the TV's app installer over an SSH pseudo-terminal. The TV's older `luna-send-pub` buffers its output when SSH has no TTY; use `ssh -tt` so installer progress and the final result are visible. The verified install call is:

   ```sh
   luna-send-pub -i 'luna://com.webos.appInstallService/dev/install' '{"id":"com.ares.defaultName","ipkUrl":"/media/developer/temp/<package-name>.ipk","subscribe":true}'
   ```

   Wait for the response with `statusValue: 30` and `details.state: "installed"` for package `com.ravboni.f1tv.webos`.
4. Verify the installed file under `/media/developer/apps/usr/palm/applications/com.ravboni.f1tv.webos/` reflects the new package. Checking only that the IPK uploaded is not proof of installation.
5. If needed, launch the app using the application manager's `launch` method through `luna-send-pub` over `ssh -tt`, and confirm it returns `returnValue: true`.

### Failure notes

- On this Mac, `ares-install` 3.2.6 consistently uploads the IPK, then fails on its remote `/bin/ls` check with `Unable to exec`. Retrying did not fix it, and running it under Node 22 produced the same failure. Do not treat a successful upload as an installed update or keep retrying the same path; use the PTY-backed app-installer procedure above.
- The TV's root filesystem was full (0 bytes available) during the last update attempt. `opkg install` therefore failed with a no-space error. Avoid the `opkg` fallback; the managed app installer successfully updated the app on the developer app partition without removing it or its local data.
- After installation, the app was confirmed at version `0.16.25`, and the updated focused Back-button CSS was present on the TV.

The install commands are for this trusted, local rooted device only. Do not add its network address or SSH key material to the repository.
