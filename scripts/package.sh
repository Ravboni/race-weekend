#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${ROOT_DIR}/dist"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "${STAGE_DIR}"' EXIT

mkdir -p "${DIST_DIR}"

# Stage only files needed at runtime. Keep docs, Git metadata, build output, and
# local development files out of the installable webOS package.
cp "${ROOT_DIR}/appinfo.json" \
   "${ROOT_DIR}/index.html" \
   "${ROOT_DIR}/app.js" \
   "${ROOT_DIR}/auth.js" \
   "${ROOT_DIR}/styles.css" \
   "${ROOT_DIR}/icon.png" \
   "${STAGE_DIR}/"
cp -R "${ROOT_DIR}/assets" "${ROOT_DIR}/vendor" "${STAGE_DIR}/"

ares-package --no-minify -o "${DIST_DIR}" "${STAGE_DIR}"

PACKAGE_PATH="${DIST_DIR}/com.ravboni.f1tv.webos_$(node -p "require('${ROOT_DIR}/appinfo.json').version")_all.ipk"
if [[ ! -f "${PACKAGE_PATH}" ]]; then
  echo "Expected package was not created: ${PACKAGE_PATH}" >&2
  exit 1
fi

echo "Created ${PACKAGE_PATH}"
