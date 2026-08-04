#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-}"
OUTPUT="${2:-$ROOT/.build/release/swift-sim-${VERSION}.tar.gz}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: create-archive.sh <version> [output]" >&2
  exit 2
fi

npm --prefix "$ROOT" run build
STAGING="$(mktemp -d -t swift-sim-release-staging)"
PACKAGE_DIR="$(mktemp -d -t swift-sim-package)"
trap 'rm -rf "$STAGING" "$PACKAGE_DIR"' EXIT

npm --prefix "$ROOT" pack --pack-destination "$PACKAGE_DIR" >/dev/null
PACKED_ARCHIVE="$(find "$PACKAGE_DIR" -maxdepth 1 -type f -name '*.tgz' -print -quit)"
tar -xzf "$PACKED_ARCHIVE" -C "$STAGING" --strip-components=1
mkdir -p "$(dirname "$OUTPUT")"
tar -czf "$OUTPUT" -C "$STAGING" .
echo "$OUTPUT"
