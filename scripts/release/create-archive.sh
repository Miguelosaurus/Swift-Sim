#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-}"
OUTPUT="${2:-$ROOT/.build/release/swift-sim-${VERSION}.tar.gz}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: create-archive.sh <version> [output]" >&2
  exit 2
fi

node --input-type=module -e '
  import { readFileSync } from "node:fs";
  if (JSON.parse(readFileSync(process.argv[1], "utf8")).version !== process.argv[2]) {
    throw new Error("Release version must match the package being archived");
  }
' "$ROOT/package.json" "$VERSION"

npm --prefix "$ROOT" run build
STAGING="$(mktemp -d -t swift-sim-release-staging)"
PACKAGE_DIR="$(mktemp -d -t swift-sim-package)"
trap 'rm -rf "$STAGING" "$PACKAGE_DIR"' EXIT

npm pack "$ROOT" --pack-destination "$PACKAGE_DIR" >/dev/null
PACKED_ARCHIVE="$(find "$PACKAGE_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
tar -xzf "$PACKED_ARCHIVE" -C "$STAGING" --strip-components=1
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  if (JSON.parse(readFileSync(process.argv[1], "utf8")).version !== process.argv[2]) {
    throw new Error("Packed release version differs from the requested version");
  }
' "$STAGING/package.json" "$VERSION"
mkdir -p "$(dirname "$OUTPUT")"
tar -czf "$OUTPUT" -C "$STAGING" .
echo "$OUTPUT"
