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

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the clean installation gate" >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d -t swift-sim-homebrew-test)"
ARCHIVE="$TEST_ROOT/swift-sim-$VERSION.tar.gz"
RENDERED="$TEST_ROOT/swift-sim.rb"
STATE_HOME="$TEST_ROOT/home"
TAP_OWNER="swift-sim-test-$PPID"
TAP="$TAP_OWNER/local"
TAP_DIR="$(brew --repository)/Library/Taps/$TAP_OWNER/homebrew-local"
cleanup() {
  brew services stop "$TAP"/swift-sim >/dev/null 2>&1 || true
  brew uninstall --force "$TAP"/swift-sim >/dev/null 2>&1 || true
  brew untap "$TAP" >/dev/null 2>&1 || true
  for launcher in swift-sim swift-sim-helper; do
    if [[ -e "$TEST_ROOT/old-$launcher" || -L "$TEST_ROOT/old-$launcher" ]]; then
      mv "$TEST_ROOT/old-$launcher" "$(brew --prefix)/bin/$launcher"
    fi
  done
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

bash "$ROOT/scripts/release/create-archive.sh" "$VERSION" "$ARCHIVE" >/dev/null
bash "$ROOT/scripts/release/render-homebrew-formula.sh" "$VERSION" "$RENDERED" "$ARCHIVE" >/dev/null
brew services stop "$TAP"/swift-sim >/dev/null 2>&1 || true
brew uninstall --force "$TAP"/swift-sim >/dev/null 2>&1 || true
for launcher in swift-sim swift-sim-helper; do
  if [[ -e "$(brew --prefix)/bin/$launcher" || -L "$(brew --prefix)/bin/$launcher" ]]; then
    mv "$(brew --prefix)/bin/$launcher" "$TEST_ROOT/old-$launcher"
  fi
done
brew tap-new --no-git "$TAP" >/dev/null
cp "$RENDERED" "$TAP_DIR/Formula/swift-sim.rb"
if ! brew install --formula --build-from-source "$TAP/swift-sim"; then
  # Homebrew 6 can return a linkage error when another tap also contains a
  # formula named swift-sim, even though the requested formula was installed.
  brew link --overwrite "$TAP/swift-sim"
fi

PREFIX="$(brew --prefix "$TAP/swift-sim")"
NODE24="$(brew --prefix node@24)/bin/node"
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
cat > "$STATE_HOME/.swift-sim/engine/manifest.json" <<'JSON'
{"version":"0.4.0","sha256":"17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696"}
JSON
unset SWIFT_SIM_MARKETPLACE_ROOT
HOME="$STATE_HOME" "$PREFIX/bin/swift-sim" setup --skip-service --skip-agents --skip-plugin --json > "$TEST_ROOT/setup.json"
HOME="$STATE_HOME" "$PREFIX/bin/swift-sim" doctor --json > "$TEST_ROOT/doctor.json"
"$NODE24" -e 'const fs=require("fs"); const setup=JSON.parse(fs.readFileSync(process.argv[1])); const doctor=JSON.parse(fs.readFileSync(process.argv[2])); if (setup.version !== "'"$VERSION"'") process.exit(1); if (doctor.version !== setup.version) process.exit(1);' "$TEST_ROOT/setup.json" "$TEST_ROOT/doctor.json"

brew services start "$TAP/swift-sim"
for _ in {1..30}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:47217/health >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail --max-time 2 http://127.0.0.1:47217/health >/dev/null
brew services restart "$TAP/swift-sim"
for _ in {1..30}; do
  if curl --silent --fail --max-time 1 http://127.0.0.1:47217/health >/dev/null; then break; fi
  sleep 1
done
curl --silent --fail --max-time 2 http://127.0.0.1:47217/health >/dev/null
ps -axo command | grep -F "$NODE24" | grep -F 'swift-sim-helper-entry.js' | grep -v grep >/dev/null

echo "Verified clean Homebrew archive installation, Node 24 launchers, service restart, assets, setup, and doctor"
