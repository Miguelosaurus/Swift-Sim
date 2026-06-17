#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_DIR="${SWIFT_SIM_HOME:-$SCRIPT_ROOT}"
HELPER="$ROOT_DIR/mac-helper/bin/swift-sim-helper.js"
DEFAULT_PORT="${SWIFT_SIM_PORT:-47217}"
HOST="${SWIFT_SIM_HOST:-127.0.0.1}"
LOG_DIR="${SWIFT_SIM_LOG_DIR:-$HOME/.swift-sim}"
HELPER_LOG="$LOG_DIR/helper.log"

PROJECT=""
SCHEME=""
SIMULATOR=""
REMOTE_BASE_URL="${SWIFT_SIM_REMOTE_BASE_URL:-}"
TRANSPORT="${SWIFT_SIM_TRANSPORT:-auto}"

usage() {
  cat <<'USAGE'
Usage:
  open-simulator-session.sh --project <path> --scheme <scheme> --simulator <udid> --remote-base-url <https-url> [--transport auto|serve-sim|native-companion]

Starts/reuses the Swift Sim helper and prints session JSON with:
  links.universalLink
  links.customScheme

Environment:
  SWIFT_SIM_PORT             Helper port. Default: 47217
  SWIFT_SIM_HOST             Helper bind host. Default: 127.0.0.1
  SWIFT_SIM_REMOTE_BASE_URL  Default remote URL if --remote-base-url is omitted
  SWIFT_SIM_TRANSPORT        Transport preference. Default: auto
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="${2:-}"
      shift 2
      ;;
    --scheme)
      SCHEME="${2:-}"
      shift 2
      ;;
    --simulator|--simulator-udid)
      SIMULATOR="${2:-}"
      shift 2
      ;;
    --remote-base-url)
      REMOTE_BASE_URL="${2:-}"
      shift 2
      ;;
    --transport)
      TRANSPORT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROJECT" || -z "$SCHEME" || -z "$SIMULATOR" || -z "$REMOTE_BASE_URL" ]]; then
  usage >&2
  exit 2
fi

mkdir -p "$LOG_DIR"

if ! curl -fsS "http://$HOST:$DEFAULT_PORT/health" >/dev/null 2>&1; then
  nohup node "$HELPER" serve --host "$HOST" --port "$DEFAULT_PORT" >"$HELPER_LOG" 2>&1 &
  helper_pid=$!
  for _ in {1..30}; do
    if curl -fsS "http://$HOST:$DEFAULT_PORT/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$helper_pid" 2>/dev/null; then
      echo "Swift Sim helper exited while starting. Log: $HELPER_LOG" >&2
      exit 1
    fi
    sleep 0.2
  done
fi

if ! curl -fsS "http://$HOST:$DEFAULT_PORT/health" >/dev/null 2>&1; then
  echo "Swift Sim helper did not become healthy. Log: $HELPER_LOG" >&2
  exit 1
fi

node "$HELPER" start-session \
  --project "$PROJECT" \
  --scheme "$SCHEME" \
  --simulator "$SIMULATOR" \
  --remote-base-url "$REMOTE_BASE_URL" \
  --transport "$TRANSPORT"
