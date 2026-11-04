# Bundled libraries

This directory contains the browser libraries bundled with Race Weekend. Keep each library's license file with its source when updating it.

| Library | Version | License | Source | Used for |
| --- | --- | --- | --- | --- |
| [dash.js](https://github.com/Dash-Industry-Forum/dash.js) | 4.7.4 | BSD-3-Clause | [v4.7.4 release](https://github.com/Dash-Industry-Forum/dash.js/releases/tag/v4.7.4) | DASH playback and stream selection |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT | [npm package](https://www.npmjs.com/package/qrcode-generator/v/1.4.4) | F1 phone-pairing QR codes |
| [hls.js](https://github.com/video-dev/hls.js) | 1.7.4 | Apache-2.0 | [v1.7.4 release](https://github.com/video-dev/hls.js/releases/tag/v1.7.4) | 4K (2160p HLS/CMAF + Widevine) playback, loaded only when 4K is used |

## Local changes

- `qrcode.js` is based on qrcode-generator 1.4.4. It includes the full MIT license notice and a local correction in `renderTo2dContext` that maps matrix columns to the canvas x-axis and rows to the y-axis.
- `dash.all.min.js` is the upstream dash.js 4.7.4 browser bundle. Its BSD license is in [`dash-LICENSE.md`](dash-LICENSE.md); bundled third-party notices are in [`dash-LICENSE-NOTICES.txt`](dash-LICENSE-NOTICES.txt).
- The QR generator's MIT license is in [`qrcode-LICENSE.txt`](qrcode-LICENSE.txt) and is also included in the source file.
- `hls.min.js` is the unmodified upstream hls.js 1.7.4 `dist/hls.min.js` (SHA-256 `cfc70cc9e9fc63d071919e087670abc760c8fd1bc889b88588026e4d22193bbe`). Its Apache-2.0 license and notices are in [`hls-LICENSE.txt`](hls-LICENSE.txt).
