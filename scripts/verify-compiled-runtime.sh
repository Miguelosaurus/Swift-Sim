#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_CLI="$ROOT/mac-helper/bin/swift-sim.js"
COMPILED_CLI="$ROOT/dist/mac-helper/bin/swift-sim.js"
SOURCE_HELPER="$ROOT/mac-helper/bin/swift-sim-helper-entry.js"
COMPILED_HELPER="$ROOT/dist/mac-helper/bin/swift-sim-helper-entry.js"
HELPER_TEST_ROOT="$(mktemp -d -t swift-sim-helper-equivalence)"
cleanup() {
  local status=$?
  rm -rf "$HELPER_TEST_ROOT"
  if [[ -e "$HELPER_TEST_ROOT" ]]; then
    echo "Compiled-runtime helper probe cleanup failed" >&2
    return 1
  fi
  return "$status"
}
trap cleanup EXIT
mkdir -p \
  "$HELPER_TEST_ROOT/caller-home/.swift-sim" \
  "$HELPER_TEST_ROOT/source-home/.swift-sim" \
  "$HELPER_TEST_ROOT/compiled-home/.swift-sim"
export HOME="$HELPER_TEST_ROOT/caller-home"
CALLER_STATE="$HOME/.swift-sim/device-builds.json"
printf '%s\n' '{"version":5,"apps":{},"artifactCleanupJobs":{},"deliveryReferenceCleanupJobs":{},"builds":[{"id":"sentinel","logs":["caller state must remain unchanged"]}]}' > "$CALLER_STATE"
CALLER_STATE_BEFORE="$(shasum -a 256 "$CALLER_STATE")"

for command in version help; do
  source_output="$(node "$SOURCE_CLI" "$command")"
  compiled_output="$(node "$COMPILED_CLI" "$command")"
  if [[ "$source_output" != "$compiled_output" ]]; then
    echo "Source/compiled CLI mismatch for '$command'" >&2
    diff -u <(printf '%s\n' "$source_output") <(printf '%s\n' "$compiled_output") >&2 || true
    exit 1
  fi
done

source_helper_output="$(HOME="$HELPER_TEST_ROOT/source-home" node "$SOURCE_HELPER" --help 2>&1 || true)"
compiled_helper_output="$(HOME="$HELPER_TEST_ROOT/compiled-home" node "$COMPILED_HELPER" --help 2>&1 || true)"
if [[ "$source_helper_output" != "$compiled_helper_output" ]]; then
  echo "Source/compiled helper entrypoint mismatch for '--help'" >&2
  diff -u <(printf '%s\n' "$source_helper_output") <(printf '%s\n' "$compiled_helper_output") >&2 || true
  exit 1
fi

CALLER_STATE_AFTER="$(shasum -a 256 "$CALLER_STATE")"
if [[ "$CALLER_STATE_BEFORE" != "$CALLER_STATE_AFTER" ]]; then
  echo "Compiled-runtime helper probes mutated caller state" >&2
  exit 1
fi

echo "Verified source/compiled CLI and helper entrypoint equivalence"
