#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="$(mktemp -d)"
SERVICE_STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}" "${SERVICE_STAGE_DIR}"' EXIT

mkdir -p "${DIST_DIR}"

# Stage only files needed at runtime. Keep docs, Git metadata, build output, and
# local development files out of the installable webOS package.
cp "${ROOT_DIR}/appinfo.json" \
   "${ROOT_DIR}/index.html" \
   "${ROOT_DIR}/app.js" \
   "${ROOT_DIR}/auth.js" \
   "${ROOT_DIR}/compat.js" \
   "${ROOT_DIR}/bridge.js" \
   "${ROOT_DIR}/pip-platform.js" \
   "${ROOT_DIR}/legacy-webos.css" \
   "${ROOT_DIR}/styles.css" \
   "${ROOT_DIR}/icon.png" \
   "${ROOT_DIR}/largeIcon.png" \
   "${STAGE_DIR}/"

# Stage the bundled JS service (the F1 catalog bridge). It ships inside the same
# IPK, installs unprivileged with the app, and is started on demand by bridge.js.
cp -R "${ROOT_DIR}/service/." "${SERVICE_STAGE_DIR}/"
# Own native hooks only; LG firmware libraries are build inputs, never shipped.
if [[ ! -f "${ROOT_DIR}/root-pip/lib/librw-pip-wam.so" || ! -f "${ROOT_DIR}/root-pip/lib/librw-pip-acb.so" ]]; then
  echo "Build the C9 PiP companion first (see root-pip/README.md)." >&2
  exit 1
fi
mkdir -p "${STAGE_DIR}/root-pip"
cp "${ROOT_DIR}/root-pip/control.sh" "${ROOT_DIR}/root-pip/"*.sha256 "${STAGE_DIR}/root-pip/"
cp -R "${ROOT_DIR}/root-pip/lib" "${STAGE_DIR}/root-pip/"
mkdir -p "${STAGE_DIR}/root-cbcs"
cp "${ROOT_DIR}/root-cbcs/control.sh" "${ROOT_DIR}/root-cbcs/cbcs-hd-fix.sh" "${ROOT_DIR}/root-cbcs/LICENSE" "${STAGE_DIR}/root-cbcs/"
# The brand artwork is used by this README; the TV launcher consumes the two
# correctly-sized root icons above. Only the font assets ship at runtime.
mkdir -p "${STAGE_DIR}/assets"
cp -R "${ROOT_DIR}/assets/fonts" "${STAGE_DIR}/assets/"
cp -R "${ROOT_DIR}/vendor" "${STAGE_DIR}/"

if [[ ! -d "${ROOT_DIR}/node_modules/@babel/core" ]]; then
  echo "Build dependencies are missing. Run 'npm ci --ignore-scripts' first." >&2
  exit 1
fi
node "${ROOT_DIR}/scripts/transpile.js" "${STAGE_DIR}"

ares-package --no-minify -o "${DIST_DIR}" "${STAGE_DIR}" "${SERVICE_STAGE_DIR}"

PACKAGE_ID="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).id" "${ROOT_DIR}/appinfo.json")"
PACKAGE_VERSION="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" "${ROOT_DIR}/appinfo.json")"
PACKAGE_PATH="${DIST_DIR}/${PACKAGE_ID}_${PACKAGE_VERSION}_all.ipk"
if [[ ! -f "${PACKAGE_PATH}" ]]; then
  echo "Expected package was not created: ${PACKAGE_PATH}" >&2
  exit 1
fi

echo "Created ${PACKAGE_PATH}"
