#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="${GITLEAKS_BIN:-gitleaks}"
if ! command -v "$SCANNER" >/dev/null 2>&1; then
  echo 'Install gitleaks or set GITLEAKS_BIN to its executable path.' >&2
  exit 2
fi

case "${1:---history}" in
  --history)
    "$SCANNER" git --log-opts='--all --full-history' --redact=100 --no-banner "$ROOT"
    ;;
  --staged)
    "$SCANNER" git --staged --redact=100 --no-banner "$ROOT"
    ;;
  *)
    echo 'Usage: scripts/check-secrets.sh [--history|--staged]' >&2
    exit 2
    ;;
esac
