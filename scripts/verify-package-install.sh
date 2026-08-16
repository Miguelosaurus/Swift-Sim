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

CUTOVER_ENTRY="$INSTALL_ROOT/node_modules/swift-sim/dist/mac-helper/bin/swift-sim-phase4-cutover.js"
if [[ ! -f "$CUTOVER_ENTRY" ]]; then
  echo "Installed package is missing the Phase-4 maintenance entrypoint" >&2
  exit 1
fi
if ! rg -q '"status", "prepare", "activate", "cancel", "rollback"' "$CUTOVER_ENTRY"; then
  echo "Maintenance entrypoint source marker mismatch" >&2
  exit 1
fi
STATUS_ROOT="$(mktemp -d -t swift-sim-cutover-status)"
trap 'rm -rf "$STATUS_ROOT"' EXIT
"$NODE_BIN" "$CUTOVER_ENTRY" status --state-root "$STATUS_ROOT" > "$STATUS_ROOT/status.json"
if ! "$NODE_BIN" -e 'const fs=require("fs"); const report=JSON.parse(fs.readFileSync(process.argv[1])); if (report.mutationAllowed !== false || report.latestSchemaVersion < 1) process.exit(1);' "$STATUS_ROOT/status.json"; then
  echo "Installed maintenance entrypoint could not run read-only status" >&2
  exit 1
fi
trap 'rm -rf "$TEMP_ROOT"' EXIT

cd "$INSTALL_ROOT"
"$NODE_BIN" --input-type=module <<'NODE'
const resolved = import.meta.resolve("swift-sim/dist/mac-helper/bin/swift-sim-entry.js");
if (!resolved.startsWith("file:")) {
  throw new Error(`Unexpected package entrypoint resolution: ${resolved}`);
}
console.log(`Resolved package entrypoint: ${resolved}`);
NODE

echo "Verified clean package archive installation"
