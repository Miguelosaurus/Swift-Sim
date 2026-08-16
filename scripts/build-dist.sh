#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"

rm -rf "$DIST"
"$ROOT/node_modules/.bin/tsc" --project "$ROOT/tsconfig.json"

copy_tracked_asset() {
  local path="$1"
  local destination="$DIST/$path"
  mkdir -p "$(dirname "$destination")"
  cp "$ROOT/$path" "$destination"
}

while IFS= read -r -d '' path; do
  case "$path" in
    *.js|*.mjs|*.cjs|*.ts|*.mts|*.cts|*.tsx|*.d.ts|*.d.mts|*.d.cts)
      continue
      ;;
    .agents/*|.claude-plugin/*|.cursor-plugin/*|plugins/*|Companion/*|\
    benchmarks/corpora/*|benchmarks/fixtures/*|benchmarks/schema/*|\
    test/fixtures/*|mac-helper/*|scripts/*|packaging/*|README.md|CHANGELOG.md|\
    LICENSE|SECURITY.md|package.json|package-lock.json)
      copy_tracked_asset "$path"
      ;;
  esac
done < <(git -C "$ROOT" ls-files -z)

# The maintenance executor is a deliberately pinned compiled entrypoint.
# tsc compiles importable modules but bin/ files are omitted from the build
# output; the reviewed cutover entrypoint must exist at the exact installed
# libexec path the runbook documents, so it is copied verbatim alongside the
# compiled tree. Its relative imports resolve against dist/mac-helper/src.
if [[ -f "$ROOT/mac-helper/bin/swift-sim-phase4-cutover.js" ]]; then
  copy_tracked_asset "mac-helper/bin/swift-sim-phase4-cutover.js"
  chmod +x "$DIST/mac-helper/bin/swift-sim-phase4-cutover.js"
fi

# Record immutable candidate provenance inside the packaged mac-helper tree.
# Pull-request Actions check out a synthetic merge ref by default, so prefer the
# immutable PR head SHA from the event payload. Release/push/local builds fall
# back to the exact checked-out Git commit. The maintenance executor measures
# this installed manifest and compares it with external ceremony evidence; it
# never derives the installed SHA from the submitted evidence file.
BUILD_GIT_SHA="${SWIFT_SIM_BUILD_GIT_SHA:-}"
if [[ -z "$BUILD_GIT_SHA" && -n "${GITHUB_EVENT_PATH:-}" && -f "${GITHUB_EVENT_PATH}" ]]; then
  BUILD_GIT_SHA="$(node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    process.stdout.write(String(event?.pull_request?.head?.sha || ""));
  ')"
fi
if [[ -z "$BUILD_GIT_SHA" ]]; then
  BUILD_GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
fi
if [[ ! "$BUILD_GIT_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid Swift Sim build Git SHA: $BUILD_GIT_SHA" >&2
  exit 1
fi
mkdir -p "$DIST/mac-helper"
printf '{\n  "version": 1,\n  "gitSHA": "%s"\n}\n' "$BUILD_GIT_SHA" \
  > "$DIST/mac-helper/build-provenance.json"
chmod 0644 "$DIST/mac-helper/build-provenance.json"

echo "Built compiled source tree at $DIST"