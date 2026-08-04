#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d -t swift-sim-hermetic-compiled)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

cp -R "$ROOT/dist" "$TEMP_ROOT/dist"
cp -R "$ROOT/node_modules" "$TEMP_ROOT/node_modules"
cp -R "$ROOT/plugins" "$TEMP_ROOT/plugins"
cp -R "$ROOT/.agents" "$TEMP_ROOT/.agents"
cp -R "$ROOT/.claude-plugin" "$TEMP_ROOT/.claude-plugin"
cp -R "$ROOT/.cursor-plugin" "$TEMP_ROOT/.cursor-plugin"

if [[ -e "$TEMP_ROOT/mac-helper" || -e "$TEMP_ROOT/test" ]]; then
  echo "Hermetic compiled tree unexpectedly contains source directories" >&2
  exit 1
fi

node --test --test-concurrency=1 "$TEMP_ROOT/dist/test/compiledHermetic.test.js"
echo "Verified isolated compiled CLI, helper lifecycle, setup, doctor, assets, and ownership state"
