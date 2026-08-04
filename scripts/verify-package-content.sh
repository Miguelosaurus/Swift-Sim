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
console.log(`Verified ${files.length} intended package paths`);
NODE
