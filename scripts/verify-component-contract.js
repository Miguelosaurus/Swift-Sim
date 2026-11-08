import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMPONENTS } from "../mac-helper/src/componentCompatibility.js";
const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
for (const harness of ["claude", "cursor", "codex"]) {
  const plugin = JSON.parse(read(`plugins/swift-sim-companion/.${harness}-plugin/plugin.json`));
  assert.equal(plugin.version.split("+")[0], COMPONENTS.version, `${harness} plugin version`);
}
assert.ok(
  read("Package.swift").includes(`exact: "${COMPONENTS.sdk.enginePackageVersion}"`),
  "SDK requires the exact engine package tag",
);
assert.equal(JSON.parse(read("package-lock.json")).version, COMPONENTS.version);
assert.equal(JSON.parse(read("package-lock.json")).packages[""].version, COMPONENTS.version);
console.log("Verified CLI, helper, agent, engine and SDK component contract");
