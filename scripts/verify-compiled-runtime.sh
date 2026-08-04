#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CLI="$ROOT/mac-helper/bin/swift-sim.js"
COMPILED_CLI="$ROOT/dist/mac-helper/bin/swift-sim.js"
SOURCE_HELPER="$ROOT/mac-helper/bin/swift-sim-helper-entry.js"
COMPILED_HELPER="$ROOT/dist/mac-helper/bin/swift-sim-helper-entry.js"

for command in version help; do
  source_output="$(node "$SOURCE_CLI" "$command")"
  compiled_output="$(node "$COMPILED_CLI" "$command")"
  if [[ "$source_output" != "$compiled_output" ]]; then
    echo "Source/compiled CLI mismatch for '$command'" >&2
    diff -u <(printf '%s\n' "$source_output") <(printf '%s\n' "$compiled_output") >&2 || true
    exit 1
  fi
done

source_helper_output="$(node "$SOURCE_HELPER" --help 2>&1 || true)"
compiled_helper_output="$(node "$COMPILED_HELPER" --help 2>&1 || true)"
if [[ "$source_helper_output" != "$compiled_helper_output" ]]; then
  echo "Source/compiled helper entrypoint mismatch for '--help'" >&2
  diff -u <(printf '%s\n' "$source_helper_output") <(printf '%s\n' "$compiled_helper_output") >&2 || true
  exit 1
fi

echo "Verified source/compiled CLI and helper entrypoint equivalence"
