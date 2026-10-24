# Bundled libraries

This directory contains the browser libraries bundled with Race Weekend Viewer. Keep each library's license file with its source when updating it.

| Library | Version | License | Source | Used for |
| --- | --- | --- | --- | --- |
| [dash.js](https://github.com/Dash-Industry-Forum/dash.js) | 4.7.4 | BSD-3-Clause | [v4.7.4 release](https://github.com/Dash-Industry-Forum/dash.js/releases/tag/v4.7.4) | DASH playback and stream selection |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) | 1.4.4 | MIT | [npm package](https://www.npmjs.com/package/qrcode-generator/v/1.4.4) | F1 phone-pairing QR codes |

## Local changes

- `qrcode.js` is based on qrcode-generator 1.4.4. It includes the full MIT license notice and a local correction in `renderTo2dContext` that maps matrix columns to the canvas x-axis and rows to the y-axis.
- `dash.all.min.js` is the upstream dash.js 4.7.4 browser bundle. Its BSD license is in [`dash-LICENSE.md`](dash-LICENSE.md); bundled third-party notices are in [`dash-LICENSE-NOTICES.txt`](dash-LICENSE-NOTICES.txt).
- The QR generator's MIT license is in [`qrcode-LICENSE.txt`](qrcode-LICENSE.txt) and is also included in the source file.
