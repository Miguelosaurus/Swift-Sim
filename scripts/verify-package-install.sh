#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d -t swift-sim-package-install)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

npm pack --pack-destination "$TEMP_ROOT" >/dev/null
ARCHIVE="$(find "$TEMP_ROOT" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
if [[ -z "$ARCHIVE" ]]; then
  echo "npm pack did not produce an archive" >&2
  exit 1
fi

INSTALL_ROOT="$TEMP_ROOT/install"
mkdir -p "$INSTALL_ROOT"
npm install --prefix "$INSTALL_ROOT" --omit=dev --ignore-scripts "$ARCHIVE" >/dev/null

node "$ROOT/scripts/verify-installed-package.mjs" "$INSTALL_ROOT/node_modules/swift-sim"

NODE_BIN="${NODE_BIN:-node}"
export PATH="$(dirname "$(command -v "$NODE_BIN")"):$PATH"
"$NODE_BIN" "$INSTALL_ROOT/node_modules/swift-sim/dist/mac-helper/bin/swift-sim.js" version
"$NODE_BIN" "$INSTALL_ROOT/node_modules/.bin/swift-sim" version

cd "$INSTALL_ROOT"
"$NODE_BIN" --input-type=module <<'NODE'
const resolved = import.meta.resolve("swift-sim/dist/mac-helper/bin/swift-sim-entry.js");
if (!resolved.startsWith("file:")) {
  throw new Error(`Unexpected package entrypoint resolution: ${resolved}`);
}
console.log(`Resolved package entrypoint: ${resolved}`);
NODE

echo "Verified clean package archive installation"
