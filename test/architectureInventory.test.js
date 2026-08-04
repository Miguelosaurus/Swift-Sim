import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkInventory, collectInventory } from "../scripts/architecture/inventory.js";

test("architecture inventory detects the required production categories", () => {
  const fixture = createFixture({
    "mac-helper/src/examplePreload.js": [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("state.json", JSON.stringify({ ready: true }));',
      "spawn(process.execPath, []);",
      "fetch(\"https://example.test\");",
    ].join("\n"),
    "Companion/SwiftSimCompanion/Example.swift": "struct Example {}\n",
    "test/example.test.js": [
      'import { readFileSync } from "node:fs";',
      'const source = readFileSync("../mac-helper/src/examplePreload.js", "utf8");',
      "assert.match(source, /spawn/);",
    ].join("\n"),
    "package.json": JSON.stringify({ bin: { "swift-sim": "./mac-helper/src/examplePreload.js" } }),
    ".github/workflows/verify.yml": "name: Verify\n",
    "README.md": '<a href="https://github.com/example/repo/actions/workflows/verify.yml"><img src="https://github.com/example/repo/actions/workflows/verify.yml/badge.svg"></a>\n',
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.equal(inventory.productionFileCounts.javascript, 1);
    assert.equal(inventory.productionFileCounts.swift, 1);
    assert.equal(inventory.childProcessImports.length, 1);
    assert.equal(inventory.destructiveFilesystemImports.length, 1);
    assert.equal(inventory.directGlobalFetchUses.length, 1);
    assert.equal(inventory.writableJSONDomainStateStores.length, 1);
    assert.equal(inventory.sourceTextImplementationTests.length, 1);
    assert.equal(inventory.preloadRuntimePatchModules[0].path, "mac-helper/src/examplePreload.js");
    assert.equal(inventory.packageEntrypoints[0].exists, true);
    assert.equal(inventory.workflowBadgeTargets.every((entry) => entry.exists), true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects a new preload/runtime patch module", () => {
  const fixture = createFixture({ "mac-helper/src/newPreload.js": "export {};\n" });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("new preload/runtime patch module")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects additional child-process imports in one module", () => {
  const fixture = createFixture({
    "mac-helper/src/commands.js": [
      'import { spawn } from "node:child_process";',
      'import { execFile } from "node:child_process";',
    ].join("\n"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({ childProcessImporters: { "mac-helper/src/commands.js": 1 } }));
    assert.ok(result.violations.some((violation) => violation.includes("new child-process importer")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects additional destructive filesystem imports", () => {
  const fixture = createFixture({
    "mac-helper/src/files.js": [
      'import { writeFileSync } from "node:fs";',
      'import { rmSync } from "node:fs";',
    ].join("\n"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({ destructiveFilesystemImporters: { "mac-helper/src/files.js": 1 } }));
    assert.ok(result.violations.some((violation) => violation.includes("new destructive filesystem importer")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects a new source-text implementation test", () => {
  const fixture = createFixture({
    "mac-helper/src/app.js": "export const value = true;\n",
    "test/app.test.js": [
      'import { readFileSync } from "node:fs";',
      'const source = readFileSync("../mac-helper/src/app.js", "utf8");',
      "assert.match(source, /value/);",
    ].join("\n"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("new source-text implementation test")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects an oversized production file without an ADR exception", () => {
  const fixture = createFixture({ "mac-helper/src/large.js": `${Array.from({ length: 801 }, () => "x").join("\n")}\n` });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("exceeds 800 lines")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects an invalid workflow badge target", () => {
  const fixture = createFixture({
    ".github/workflows/verify.yml": "name: Verify\n",
    "README.md": '<a href="https://github.com/example/repo/actions/workflows/release.yml"><img src="https://github.com/example/repo/actions/workflows/release.yml/badge.svg"></a>\n',
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("stale workflow badge target")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("baseline policy allows existing debt without false failure", () => {
  const fixture = createFixture({
    "mac-helper/src/existingPreload.js": [
      'import { spawn } from "node:child_process";',
      'import { writeFileSync } from "node:fs";',
      'writeFileSync("state.json", JSON.stringify({ ready: true }));',
      "spawn(process.execPath, []);",
    ].join("\n"),
    "mac-helper/src/existing-large.js": `${Array.from({ length: 801 }, () => "x").join("\n")}\n`,
    "test/existing.test.js": [
      'import { readFileSync } from "node:fs";',
      'const source = readFileSync("../mac-helper/src/existingPreload.js", "utf8");',
      "assert.match(source, /spawn/);",
    ].join("\n"),
    ".github/workflows/verify.yml": "name: Verify\n",
    "README.md": '<a href="https://github.com/example/repo/actions/workflows/verify.yml"><img src="https://github.com/example/repo/actions/workflows/verify.yml/badge.svg"></a>\n',
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({
      preloadRuntimePatchModules: ["mac-helper/src/existingPreload.js"],
      childProcessImporters: { "mac-helper/src/existingPreload.js": 1 },
      destructiveFilesystemImporters: { "mac-helper/src/existingPreload.js": 1 },
      sourceTextImplementationTests: { "test/existing.test.js": 1 },
      oversizedProductionFiles: ["mac-helper/src/existing-large.js"],
    }));
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function policy(overrides = {}) {
  return {
    version: 1,
    preloadRuntimePatchModules: [],
    childProcessImporters: {},
    destructiveFilesystemImporters: {},
    sourceTextImplementationTests: {},
    oversizedProductionFiles: [],
    allowlists: {},
    ...overrides,
  };
}

function createFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-architecture-"));
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(root, path);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return { root, files: Object.keys(files).sort() };
}
