#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROJECT_PATH="$ROOT_DIR/Companion/SwiftSimCompanion.xcodeproj"
SCHEME="SwiftSimCompanion"
CONFIGURATION="${CONFIGURATION:-Debug}"
DERIVED_DATA_BASE="$ROOT_DIR/.build/DerivedData-ios-device"
LOCK_ROOT="$ROOT_DIR/.build/locks"
LOCK_DIR="$LOCK_ROOT/run-on-device.lock"
XCODE_BUILD_JOBS="${XCODE_BUILD_JOBS:-4}"

# These defaults are Miguel's local SEA & SEA setup. Override them for your own team/app id.
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-F5786NY22N}"
PRODUCT_BUNDLE_IDENTIFIER="${PRODUCT_BUNDLE_IDENTIFIER:-app.rork.swift-sim-companion}"

DEVICE_UDID="${DEVICE_UDID:-}"

if [[ ! -d "$PROJECT_PATH" ]]; then
  echo "ERROR: Xcode project not found at: $PROJECT_PATH" >&2
  exit 1
fi

if [[ -z "$DEVICE_UDID" ]]; then
  DEVICE_UDID="$(xcrun xctrace list devices 2>/dev/null | \
    sed -nE '/(iPhone|iPad)/{ /Simulator/! s/^.*\(([0-9A-Fa-f-]{10,})\)[[:space:]]*$/\1/p; }' | \
    head -n 1)"
fi

if [[ -z "$DEVICE_UDID" ]]; then
  echo "ERROR: Could not find a connected iOS device." >&2
  echo "Tip: connect once over USB, trust this Mac, then retry." >&2
  echo "You can also set DEVICE_UDID explicitly: DEVICE_UDID=<udid> $0" >&2
  exit 1
fi

mkdir -p "$LOCK_ROOT"
if [[ -d "$LOCK_DIR" ]]; then
  if [[ -f "$LOCK_DIR/pid" ]]; then
    LOCK_PID="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "${LOCK_PID:-}" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
      echo "ERROR: run-on-device is already running (pid=$LOCK_PID)." >&2
      exit 1
    fi
  fi
  rm -rf "$LOCK_DIR"
fi
mkdir "$LOCK_DIR"
echo "$$" > "$LOCK_DIR/pid"
cleanup_lock() {
  rm -rf "$LOCK_DIR"
}
trap cleanup_lock EXIT INT TERM HUP

SAFE_UDID="${DEVICE_UDID//[^A-Za-z0-9_-]/_}"
DERIVED_DATA="${DERIVED_DATA_BASE}-${SAFE_UDID}"

echo "==> Building Swift Sim Companion for device: $DEVICE_UDID"
echo "==> Team: $DEVELOPMENT_TEAM"
echo "==> Bundle id: $PRODUCT_BUNDLE_IDENTIFIER"

DESTINATION="platform=iOS,id=$DEVICE_UDID"
if ! xcodebuild -project "$PROJECT_PATH" -scheme "$SCHEME" -showdestinations 2>/dev/null | grep -q "$DEVICE_UDID"; then
  echo "Warning: Xcode does not list $DEVICE_UDID as a build destination. Building generic iOS and installing with devicectl." >&2
  DESTINATION="generic/platform=iOS"
fi

run_build() {
  local jobs="$1"
  xcodebuild \
    -project "$PROJECT_PATH" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "$DESTINATION" \
    -derivedDataPath "$DERIVED_DATA" \
    -jobs "$jobs" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    PRODUCT_BUNDLE_IDENTIFIER="$PRODUCT_BUNDLE_IDENTIFIER" \
    ENABLE_PREVIEWS=NO \
    build
}

set +e
run_build "$XCODE_BUILD_JOBS"
build_rc=$?
set -e

if [[ "$build_rc" -eq 137 ]]; then
  echo "Build was killed. Retrying with -jobs 1..." >&2
  rm -rf "$DERIVED_DATA/Build/Intermediates.noindex"
  run_build 1
elif [[ "$build_rc" -ne 0 ]]; then
  exit "$build_rc"
fi

APP_PATH="$DERIVED_DATA/Build/Products/${CONFIGURATION}-iphoneos/${SCHEME}.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "ERROR: .app not found at expected path: $APP_PATH" >&2
  exit 1
fi

BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Info.plist")"

echo "==> Installing: $APP_PATH"
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH"

echo "==> Launching: $BUNDLE_ID"
launch_ok=0
for i in 1 2 3; do
  if xcrun devicectl device process launch --terminate-existing --device "$DEVICE_UDID" "$BUNDLE_ID" >/dev/null 2>&1; then
    launch_ok=1
    break
  fi
  echo "Launch attempt $i failed; retrying..." >&2
  sleep 1
done

if [[ "$launch_ok" -eq 1 ]]; then
  echo "Installed + launched on device."
else
  echo "Installed, but launch failed. Unlock the phone and open the app manually." >&2
fi
