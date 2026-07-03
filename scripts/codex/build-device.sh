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
WORKSPACE=""
SCHEME=""
CONFIGURATION="Release"
REMOTE_BASE_URL="${SWIFT_SIM_DEVICE_REMOTE_BASE_URL:-}"
DELIVERY="${SWIFT_SIM_DEVICE_DELIVERY:-}"
EXPORT_METHOD="${SWIFT_SIM_EXPORT_METHOD:-development}"
TTL_MINUTES="${SWIFT_SIM_DEVICE_TTL_MINUTES:-120}"
ALLOW_PROVISIONING_UPDATES=0

usage() {
  cat <<'USAGE'
Usage:
  build-device.sh --project <path> --scheme <scheme> [--ttl-minutes <5-120>] [--allow-provisioning-updates]
  build-device.sh --workspace <path> --scheme <scheme> [--ttl-minutes <5-120>] [--allow-provisioning-updates]

Builds a signed real-device IPA and prints JSON with:
  links.universalLink
  links.customScheme
  links.installURL

Defaults:
  configuration: Release
  export method: development
  delivery: temporary public HTTPS link, no account or Tailscale required
  link lifetime: 120 minutes

Environment:
  SWIFT_SIM_PORT             Helper port. Default: 47217
  SWIFT_SIM_HOST             Helper bind host. Default: 127.0.0.1
  SWIFT_SIM_DEVICE_REMOTE_BASE_URL  Custom device URL if --remote-base-url is omitted
  SWIFT_SIM_DEVICE_DELIVERY  quick-tunnel or custom. Default: automatic
  SWIFT_SIM_EXPORT_METHOD    development or ad-hoc. Default: development
  SWIFT_SIM_DEVICE_TTL_MINUTES  Install-link lifetime from 5 to 120. Default: 120
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="${2:-}"
      shift 2
      ;;
    --workspace)
      WORKSPACE="${2:-}"
      shift 2
      ;;
    --scheme)
      SCHEME="${2:-}"
      shift 2
      ;;
    --configuration)
      CONFIGURATION="${2:-}"
      shift 2
      ;;
    --remote-base-url)
      REMOTE_BASE_URL="${2:-}"
      shift 2
      ;;
    --delivery)
      DELIVERY="${2:-}"
      shift 2
      ;;
    --export-method)
      EXPORT_METHOD="${2:-}"
      shift 2
      ;;
    --ttl-minutes)
      TTL_MINUTES="${2:-}"
      shift 2
      ;;
    --allow-provisioning-updates)
      ALLOW_PROVISIONING_UPDATES=1
      shift
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

if [[ -z "$SCHEME" ]]; then
  usage >&2
  exit 2
fi

if [[ -z "$PROJECT" && -z "$WORKSPACE" ]]; then
  usage >&2
  exit 2
fi

if [[ -n "$PROJECT" && -n "$WORKSPACE" ]]; then
  echo "Pass either --project or --workspace, not both." >&2
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

args=(
  "$HELPER" build-device
  --scheme "$SCHEME"
  --configuration "$CONFIGURATION"
  --export-method "$EXPORT_METHOD"
  --ttl-minutes "$TTL_MINUTES"
)

if [[ -n "$REMOTE_BASE_URL" ]]; then
  args+=(--remote-base-url "$REMOTE_BASE_URL")
fi

if [[ -n "$DELIVERY" ]]; then
  args+=(--delivery "$DELIVERY")
fi

if [[ -n "$PROJECT" ]]; then
  args+=(--project "$PROJECT")
else
  args+=(--workspace "$WORKSPACE")
fi

if [[ "$ALLOW_PROVISIONING_UPDATES" == "1" ]]; then
  args+=(--allow-provisioning-updates)
fi

node "${args[@]}"
