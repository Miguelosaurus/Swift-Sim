#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA="$ROOT/packaging/homebrew/swift-sim.rb.template"

if grep -q 'node@22\|node-version: 22' "$FORMULA"; then
  echo "Homebrew formula still references Node 22" >&2
  exit 1
fi

FORMULA_TEXT="$(sed -e 's/@VERSION@/0.0.0/g' -e 's/@SHA256@/0000000000000000000000000000000000000000000000000000000000000000/g' "$FORMULA")"
printf '%s\n' "$FORMULA_TEXT" | ruby -c >/dev/null
grep -q 'depends_on "node@24"' <<< "$FORMULA_TEXT"
grep -q 'dist/mac-helper/bin/swift-sim-entry.js' <<< "$FORMULA_TEXT"
grep -q 'dist/mac-helper/bin/swift-sim-helper-entry.js' <<< "$FORMULA_TEXT"

echo "Verified Homebrew formula syntax and Node 24 compiled entrypoints"
