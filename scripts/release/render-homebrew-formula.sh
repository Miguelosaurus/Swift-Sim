#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${1:-}"
OUTPUT="${2:-$ROOT/.build/homebrew/Formula/swift-sim.rb}"
ARCHIVE_PATH="${3:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: render-homebrew-formula.sh <version> [output] [local-archive]" >&2
  exit 2
fi

TEMP_ARCHIVE="$(mktemp -t swift-sim-release).tar.gz"
if [[ -n "$ARCHIVE_PATH" ]]; then
  ARCHIVE_PATH="$(cd "$(dirname "$ARCHIVE_PATH")" && pwd)/$(basename "$ARCHIVE_PATH")"
  ARCHIVE_URL="file://$ARCHIVE_PATH"
  SHA256="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
else
  ARCHIVE_URL="https://github.com/Miguelosaurus/Swift-Sim/releases/download/v$VERSION/swift-sim-$VERSION.tar.gz"
  trap 'rm -f "$TEMP_ARCHIVE"' EXIT
  curl --fail --location --silent --show-error "$ARCHIVE_URL" --output "$TEMP_ARCHIVE"
  SHA256="$(shasum -a 256 "$TEMP_ARCHIVE" | awk '{print $1}')"
fi

ESCAPED_ARCHIVE_URL="${ARCHIVE_URL//&/\\&}"

mkdir -p "$(dirname "$OUTPUT")"
sed \
  -e "s/@VERSION@/$VERSION/g" \
  -e "s/@SHA256@/$SHA256/g" \
  -e "s|@ARCHIVE_URL@|$ESCAPED_ARCHIVE_URL|g" \
  "$ROOT/packaging/homebrew/swift-sim.rb.template" > "$OUTPUT"

echo "$OUTPUT"
