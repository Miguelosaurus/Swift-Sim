#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA="$ROOT/packaging/homebrew/swift-sim.rb.template"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"

if grep -q 'node@22\|node-version: 22' "$FORMULA"; then
  echo "Homebrew formula still references Node 22" >&2
  exit 1
fi

FORMULA_TEXT="$(sed -e 's/@VERSION@/0.0.0/g' -e 's/@SHA256@/0000000000000000000000000000000000000000000000000000000000000000/g' -e 's|@ARCHIVE_URL@|https://example.test/swift-sim.tar.gz|g' "$FORMULA")"
printf '%s\n' "$FORMULA_TEXT" | ruby -c >/dev/null
grep -q 'depends_on "node@24"' <<< "$FORMULA_TEXT"
grep -q 'dist/mac-helper/bin/swift-sim-entry.js' <<< "$FORMULA_TEXT"
grep -q 'dist/mac-helper/bin/swift-sim-helper-entry.js' <<< "$FORMULA_TEXT"

echo "Verified Homebrew formula syntax and Node 24 compiled entrypoints"

if [[ "${SWIFT_SIM_RUN_CLEAN_HOMEBREW:-0}" != "1" ]]; then
  echo "Skipping destructive Homebrew installation gate; set SWIFT_SIM_RUN_CLEAN_HOMEBREW=1 to opt in."
  exit 0
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the clean installation gate" >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d -t swift-sim-homebrew-test)"
ARCHIVE="$TEST_ROOT/swift-sim-$VERSION.tar.gz"
RENDERED="$TEST_ROOT/swift-sim.rb"
STATE_HOME="$TEST_ROOT/home"
BREW_CONFIG_HOME="$TEST_ROOT/homebrew-config"
BREW_REPOSITORY="$(brew --repository)"
TAP_OWNER="swift-sim-test-$PPID-$$"
TAP="$TAP_OWNER/local"
TAP_DIR="$BREW_REPOSITORY/Library/Taps/$TAP_OWNER/homebrew-local"
TEST_FORMULA="swift-sim-clean-test-$PPID-$$"
TEST_FORMULA_CLASS="SwiftSimCleanTest$PPID$$"
TAP_CREATED=0
FORMULA_INSTALLED=0

brew_with_state() {
  HOME="$STATE_HOME" HOMEBREW_USER_CONFIG_HOME="$BREW_CONFIG_HOME" brew "$@"
}

service_with_state() {
  HOME="$STATE_HOME" \
    HOMEBREW_USER_CONFIG_HOME="$BREW_CONFIG_HOME" \
    SWIFT_SIM_SERVICE_HOME="$STATE_HOME" \
    SWIFT_SIM_SERVICE_PORT="$PORT" \
    brew "$@"
}

cleanup() {
  if [[ "$FORMULA_INSTALLED" == "1" ]]; then
    service_with_state services stop "$TAP/$TEST_FORMULA" >/dev/null 2>&1 || true
    brew_with_state uninstall --force "$TAP/$TEST_FORMULA" >/dev/null 2>&1 || true
  fi
  if [[ "$TAP_CREATED" == "1" ]]; then
    brew_with_state untap "$TAP" >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

bash "$ROOT/scripts/release/create-archive.sh" "$VERSION" "$ARCHIVE" >/dev/null
bash "$ROOT/scripts/release/render-homebrew-formula.sh" "$VERSION" "$RENDERED" "$ARCHIVE" >/dev/null

if brew list --formula swift-sim >/dev/null 2>&1; then
  echo "Refusing to touch a pre-existing Homebrew swift-sim installation." >&2
  exit 1
fi
if brew services list | awk '$1 == "swift-sim" { found = 1 } END { exit(found ? 0 : 1) }'; then
  echo "Refusing to touch a pre-existing swift-sim service." >&2
  exit 1
fi
for launcher in swift-sim swift-sim-helper; do
  if [[ -e "$(brew --prefix)/bin/$launcher" || -L "$(brew --prefix)/bin/$launcher" ]]; then
    echo "Pre-existing $launcher launcher detected; it will remain untouched." >&2
  fi
done

mkdir -p "$BREW_CONFIG_HOME/services"
brew_with_state tap-new --no-git "$TAP" >/dev/null
TAP_CREATED=1
sed -i '' -e "s/^class SwiftSim < Formula$/class $TEST_FORMULA_CLASS < Formula/" "$RENDERED"

NODE24="$(brew_with_state --prefix node@24)/bin/node"
[[ -x "$NODE24" ]]
PORT="$("$NODE24" -e 'const net=require("net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>{ console.log(s.address().port); s.close(); });')"
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" != "47217" ]]
# Homebrew materializes the service environment while installing the formula.
# Pin the test-only HOME and port in the temporary formula so the service can
# never inherit the user's launchd environment or the production port.
sed -i '' \
  -e "s|HOME: ENV.fetch(\"SWIFT_SIM_SERVICE_HOME\", Dir.home)|HOME: \"$STATE_HOME\"|" \
  -e "s|SWIFT_SIM_PORT=47217|SWIFT_SIM_PORT=$PORT|" \
  "$RENDERED"
cp "$RENDERED" "$TAP_DIR/Formula/$TEST_FORMULA.rb"

install_status=0
HOME="$STATE_HOME" \
  HOMEBREW_USER_CONFIG_HOME="$BREW_CONFIG_HOME" \
  SWIFT_SIM_SERVICE_HOME="$STATE_HOME" \
  SWIFT_SIM_SERVICE_PORT="$PORT" \
  brew install --formula --build-from-source "$TAP/$TEST_FORMULA" || install_status=$?
PREFIX="$(brew_with_state --prefix "$TAP/$TEST_FORMULA")"
if [[ "$install_status" != "0" && ! -d "$PREFIX" ]]; then
  echo "Homebrew installation failed without leaving the requested formula prefix." >&2
  exit "$install_status"
fi
FORMULA_INSTALLED=1

[[ -x "$PREFIX/bin/swift-sim" ]]
[[ -x "$PREFIX/bin/swift-sim-helper" ]]
[[ -x "$NODE24" ]]
"$NODE24" --version | grep -q '^v24\.'
[[ -d "$PREFIX/libexec/plugins/swift-sim-companion/skills/remote-simulator-companion" ]]
[[ -d "$PREFIX/libexec/.agents" ]]
grep -q 'node@24/bin/node' "$PREFIX/bin/swift-sim"
grep -q 'dist/mac-helper/bin/swift-sim-entry.js' "$PREFIX/bin/swift-sim"

mkdir -p "$STATE_HOME/.swift-sim/engine/InjectionNext.app/Contents/MacOS"
printf '#!/bin/sh\nexit 0\n' > "$STATE_HOME/.swift-sim/engine/InjectionNext.app/Contents/MacOS/InjectionNext"
chmod 700 "$STATE_HOME/.swift-sim/engine/InjectionNext.app/Contents/MacOS/InjectionNext"
printf '%s\n' '{"version":"0.4.0","sha256":"17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696"}' > "$STATE_HOME/.swift-sim/engine/manifest.json"
unset SWIFT_SIM_MARKETPLACE_ROOT
HOME="$STATE_HOME" SWIFT_SIM_PORT="$PORT" "$PREFIX/bin/swift-sim" setup --skip-service --skip-agents --skip-plugin --json > "$TEST_ROOT/setup.json"
HOME="$STATE_HOME" SWIFT_SIM_PORT="$PORT" "$PREFIX/bin/swift-sim" doctor --json > "$TEST_ROOT/doctor.json"
"$NODE24" -e 'const fs=require("fs"); const setup=JSON.parse(fs.readFileSync(process.argv[1])); const doctor=JSON.parse(fs.readFileSync(process.argv[2])); if (setup.version !== process.argv[3] || doctor.version !== setup.version) process.exit(1);' "$TEST_ROOT/setup.json" "$TEST_ROOT/doctor.json" "$VERSION"

service_with_state services start "$TAP/$TEST_FORMULA" >/dev/null
listener_pid() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t | head -n 1
}
wait_for_listener() {
  for _ in {1..30}; do
    local pid
    pid="$(listener_pid || true)"
    if [[ -n "$pid" ]]; then return 0; fi
    sleep 1
  done
  return 1
}
wait_for_listener
health_json() { curl --silent --fail --max-time 2 "http://127.0.0.1:$PORT/health"; }
health_json | "$NODE24" -e 'let data=""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => { const value=JSON.parse(data); if (value.protocol !== 1 || !value.version) process.exit(1); });'
PID_BEFORE="$(listener_pid)"
[[ -n "$PID_BEFORE" ]]
COMMAND_BEFORE="$(ps -p "$PID_BEFORE" -o command=)"
[[ "$COMMAND_BEFORE" == *"$PREFIX"* ]]
[[ "$COMMAND_BEFORE" == *"swift-sim-helper-entry.js"* ]]

service_with_state services restart "$TAP/$TEST_FORMULA" >/dev/null
for _ in {1..30}; do
  if ! kill -0 "$PID_BEFORE" >/dev/null 2>&1 && [[ "$(listener_pid || true)" != "$PID_BEFORE" ]]; then break; fi
  sleep 1
done
if kill -0 "$PID_BEFORE" >/dev/null 2>&1; then
  echo "The exact pre-restart helper PID did not exit." >&2
  exit 1
fi
wait_for_listener
PID_AFTER="$(listener_pid)"
[[ -n "$PID_AFTER" && "$PID_AFTER" != "$PID_BEFORE" ]]
COMMAND_AFTER="$(ps -p "$PID_AFTER" -o command=)"
[[ "$COMMAND_AFTER" == *"$PREFIX"* ]]
[[ "$COMMAND_AFTER" == *"swift-sim-helper-entry.js"* ]]
health_json | "$NODE24" -e 'let data=""; process.stdin.on("data", chunk => data += chunk); process.stdin.on("end", () => { const value=JSON.parse(data); if (value.protocol !== 1 || !value.version) process.exit(1); });'

echo "Verified isolated Homebrew archive installation, Node 24 launchers, unique-port service identity and restart, assets, setup, and doctor"
