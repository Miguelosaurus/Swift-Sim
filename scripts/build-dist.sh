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

echo "Built compiled source tree at $DIST"
