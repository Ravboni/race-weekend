# XML parser used by the PiP manifest filter

Vendored package: **@xmldom/xmldom 0.8.15**, MIT license (included in `xmldom/LICENSE`).

Source: https://github.com/xmldom/xmldom
Package: https://registry.npmjs.org/@xmldom/xmldom/-/xmldom-0.8.15.tgz
npm integrity: `sha512-/5NV/vDALVFDXgLmfsy9TRCBlKwO2LNBFzpzvb9iIj+jR+eSc6DLYYvVOdivT/jm7MtU6TebYuRmzEOI7w40UA==`

Only the runtime `lib/`, package metadata and license are vendored. No install/build script or development dependencies run on the TV. Upstream declares Node >=10; Race Weekend exercises the required runtime paths on Node0.12.2 and Node8.17 because those are the LG service runtimes.

One local compatibility change in `lib/dom.js`: `walkDOM.STOP = Symbol('walkDOM.STOP')` becomes `walkDOM.STOP = {}`. The private sentinel is compared only by identity; a unique object preserves that behavior without installing a global Symbol shim. All other runtime JavaScript files are unchanged. The current0.9 release uses named regexp groups and does not run on those TVs, so use the maintained0.8 patch line.

The service rejects DTD/entity declarations, parser warnings/errors, external XLink expansion, protected streams, unbounded video representations and non-allowlisted media URLs before returning a manifest. Signed manifests remain only in memory. Fixtures and HTTP behavior are tested in `tests/pip-manifest.test.js`, `tests/service-pip.test.js` and the old-runtime smoke scripts.
