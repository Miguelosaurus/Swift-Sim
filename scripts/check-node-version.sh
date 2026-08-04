#!/usr/bin/env bash
set -euo pipefail

NODE_BIN="${NODE_BIN:-node}"
VERSION="$(${NODE_BIN} --version)"
MAJOR="${VERSION#v}"
MAJOR="${MAJOR%%.*}"

if [[ "$MAJOR" != "24" ]]; then
  echo "Swift Sim requires Node.js 24.x; found ${VERSION} (${NODE_BIN})" >&2
  exit 1
fi

echo "Verified Node.js ${VERSION}"
