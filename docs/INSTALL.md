# Install F1 TV on an LG webOS TV

This guide installs the prebuilt app package. You need an LG webOS TV on the same local network as the computer used to install it.

## 1. Download the app

Open [the latest F1 TV for webOS release](https://github.com/Ravboni/f1tv-webos/releases/latest) and download the `.ipk` package. The release includes a `SHA256SUMS` file so you can check the download if desired.

## 2. Prepare the TV

Choose the method that matches your TV:

### Rooted TV

Root access is already enabled. Find the TV's local IP address in its network settings. Keep the TV and computer on the same network. Do not expose the TV's SSH service to the public internet.

### Developer Mode TV (not rooted)

1. Create or use an account at [LG webOS TV Developer](https://webostv.developer.lge.com/).
2. Install **Developer Mode** from the LG Content Store.
3. Sign in to the Developer Mode app, turn **Dev Mode Status** on, and enable **Key Server**.
4. Note the TV's IP address and follow the on-screen instructions to obtain its developer key.

Developer Mode is time-limited. The Homebrew guide currently documents a 1,000-hour session; renew it in the Developer Mode app before it expires. See the [webOS Homebrew Developer Mode guide](https://www.webosbrew.org/devmode/) for current instructions.

## 3. Install with webOS Dev Manager (recommended)

1. Download and install [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases/latest) for macOS, Windows, or Linux.
2. Add/connect your TV in Dev Manager:
   - For a rooted TV, use the rooted-device connection method and the TV's IP address.
   - For Developer Mode, use the Developer Mode connection method and the developer key from the TV.
3. Choose the option to install an app, select the downloaded `.ipk`, and wait for installation to finish.
4. Launch **F1 TV** from the TV launcher.

Dev Manager's [project page](https://github.com/webosbrew/dev-manager-desktop) has the latest connection instructions and troubleshooting details.

## 4. Install with LG's command-line tools (optional)

Install Node.js and npm, then install the current LG webOS CLI:

```sh
npm install --global @webos-tools/cli
```

Register the TV using the interactive device setup. The CLI's device setup guide explains the connection and SSH-key fields for your chosen TV mode:

```sh
ares-setup-device
```

Install and launch the package, replacing the device name and filename with yours:

```sh
ares-install --device myTV ./com.ravboni.f1tv.webos_0.16.23_all.ipk
ares-launch --device myTV com.ravboni.f1tv.webos
```

LG's [CLI installation](https://webostv.developer.lge.com/develop/tools/cli-installation) and [CLI developer guide](https://webostv.developer.lge.com/develop/tools/cli-dev-guide) cover setup, device registration, package installation, and launching.

## Sign in

Open F1 TV on the television. Follow the pairing instructions shown on screen using a phone or computer signed in to the F1 account that has the required subscription. The app can only show events and streams available to that account and region.

## Update

Download the newer `.ipk` from [Releases](https://github.com/Ravboni/f1tv-webos/releases/latest) and install it over the existing app using Dev Manager or `ares-install`. Your local app data should remain on the TV; signing in again may be needed if F1 expires the session.

## Uninstall

Use Dev Manager's installed-apps list to remove **F1 TV**, or run:

```sh
ares-install --device myTV --remove com.ravboni.f1tv.webos
```

## Build and install your own package

To build from source, use Node.js 20 or newer and npm:

```sh
npm install --global @webos-tools/cli
git clone https://github.com/Ravboni/f1tv-webos.git
cd f1tv-webos
./scripts/package.sh
```

The generated package is under `dist/`. Install that `.ipk` using Dev Manager or the CLI command above.

## Help improve compatibility

Include the TV model, webOS version, app version, event/feed type, and the visible error text in a bug report. Never include passwords, pairing codes, account tokens, signed URLs, DRM challenges, license responses, or screenshots that reveal them.
