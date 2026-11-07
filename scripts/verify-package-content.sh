#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT="$(mktemp -t swift-sim-package-report).json"
trap 'rm -f "$REPORT"' EXIT

npm pack --dry-run --json > "$REPORT"
ROOT="$ROOT" REPORT="$REPORT" node --input-type=module <<'NODE'
import { readFileSync } from "node:fs";

const reportPath = process.env.REPORT;
if (!reportPath) {
  throw new Error("Package report path is missing");
}
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const files = report[0]?.files?.map((entry) => entry.path.replace(/^package\//, "")) ?? [];
const required = [
  "dist/mac-helper/bin/swift-sim-entry.js",
  "dist/mac-helper/bin/swift-sim-helper-entry.js",
  "dist/mac-helper/bin/swift-sim-phase4-cutover.js",
  "dist/mac-helper/build-provenance.json",
  "dist/mac-helper/src/appControlCli.js",
  "dist/mac-helper/optional/app-control/control.py",
  "dist/mac-helper/optional/app-control/setup.py",
  "dist/mac-helper/optional/app-control/requests.js",
  "dist/mac-helper/optional/app-control/runner/provenance.json",
  "dist/mac-helper/optional/app-control/runner/lifetime.patch",
  "dist/mac-helper/optional/app-control/runner/SwiftSimTestingLifetime.swift",
  "dist/mac-helper/optional/app-control/runner/BuildHost.swift",
  "dist/mac-helper/optional/app-control/runner/SwiftSimTesting.xcodeproj/project.pbxproj",
  "dist/mac-helper/optional/app-control/runner/SwiftSimTesting.xcodeproj/xcshareddata/xcschemes/SwiftSimTesting.xcscheme",
  "dist/mac-helper/optional/app-control/vendor/ictrl_rpc.py",
  "dist/mac-helper/optional/app-control/vendor/provenance.json",
  "dist/mac-helper/optional/app-control/vendor/LICENSE",
  "docs/APP_CONTROL.md",
  "docs/FOREGROUND_INSTALLS.md",
  "dist/mac-helper/src/installRequest.js",
  "plugins/swift-sim-companion/skills/remote-simulator-companion/references/foreground-installs.md",
  "dist/mac-helper/bin/swift-sim-entry.js.map",
  "dist/package.json",
  "package.json",
  "plugins/swift-sim-companion/.codex-plugin/plugin.json",
  ".agents/plugins/marketplace.json",
];
const prohibited = /^(?:test|benchmarks|Companion|scripts|\.github|docs\/internal|mac-helper\/src|mac-helper\/bin|\.build|dist\/(?:test|benchmarks|Companion|scripts|packaging))\//;

for (const path of required) {
  if (!files.includes(path)) {
    throw new Error(`Required package path is missing: ${path}`);
  }
}
for (const path of files) {
  if (prohibited.test(path) || path.includes("/fixtures/") || path.includes("/results/")) {
    throw new Error(`Unexpected package path: ${path}`);
  }
}
const provenance = JSON.parse(readFileSync(`${process.env.ROOT}/dist/mac-helper/build-provenance.json`, "utf8"));
if (provenance?.version !== 1 || !/^[0-9a-f]{40}$/.test(String(provenance?.gitSHA || ""))) {
  throw new Error("Packaged Phase-4 candidate provenance is invalid");
}
console.log(`Verified ${files.length} intended package paths`);
NODE
