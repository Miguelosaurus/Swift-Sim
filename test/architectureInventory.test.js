import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkInventory, collectInventory, collectInventoryAtCommit, snapshotFromInventory } from "../scripts/architecture/inventory.js";

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "architecture");
const baselineCommit = "a".repeat(40);
const baseCommit = baselineCommit;

test("architecture inventory detects the required production categories", () => {
  const fixture = createFixture({
    "mac-helper/src/examplePreload.js": fixtureText("javascriptRisk"),
    "Companion/SwiftSimCompanion/Example.swift": "struct Example {}\n",
    "test/example.test.js": fixtureText("sourceTextJavaScript"),
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
    assert.deepEqual(inventory.destructiveFilesystemImports[0].apis, ["writeFileSync"]);
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

test("the checked-in baseline snapshot is generated from its declared Git commit", () => {
  const policy = JSON.parse(readFileSync(join(fixtureDirectory, "..", "..", "..", "scripts", "architecture", "baseline-policy.json"), "utf8"));
  const baselineInventory = collectInventoryAtCommit(process.cwd(), policy.baselineCommit);
  assert.deepEqual(snapshotFromInventory(baselineInventory), policy.baseline);
});

test("architecture fitness detects a new preload/runtime patch module", () => {
  const fixture = createFixture({ "mac-helper/src/newPreload.js": "export {};\n" });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("new preloadRuntimePatchModules")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness detects TypeScript child process, filesystem, fetch, and JSON risks", () => {
  const fixture = createFixture({ "mac-helper/src/risk.ts": fixtureText("typescriptRisk") });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.equal(inventory.productionFileCounts.typescript, 1);
    assert.equal(inventory.childProcessImports.length, 1);
    assert.equal(inventory.destructiveFilesystemImports.length, 1);
    assert.equal(inventory.directGlobalFetchUses.length, 1);
    assert.equal(inventory.writableJSONDomainStateStores.length, 1);
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("childProcessImporters")));
    assert.ok(result.violations.some((violation) => violation.includes("destructiveFilesystemImporters")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("architecture fitness rejects .tsx in the Node production tree", () => {
  const fixture = createFixture({ "mac-helper/src/component.tsx": fixtureText("tsxRisk") });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.deepEqual(inventory.unsupportedNodeFiles, ["mac-helper/src/component.tsx"]);
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("unsupported Node production extension .tsx")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("filesystem promises variants share one importer capability per file", () => {
  const fixture = createFixture({ "mac-helper/src/promises.js": fixtureText("promisesVariants") });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.equal(inventory.destructiveFilesystemImports.length, 1);
    assert.deepEqual(inventory.destructiveFilesystemImports[0].apis, ["mkdir", "rename", "rm", "writeFile"]);
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("destructiveFilesystemImporters")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("neutral filenames cannot bypass aliased built-in monkey-patch detection", () => {
  const fixture = createFixture({ "mac-helper/src/neutral.js": fixtureText("aliasedMonkeyPatch") });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const module = inventory.preloadRuntimePatchModules.find((entry) => entry.path === "mac-helper/src/neutral.js");
    assert.ok(module);
    assert.ok(module.reasons.includes("built-in-assignment"));
    assert.ok(module.reasons.includes("built-in-define-property"));
    assert.ok(module.reasons.includes("built-in-object-assign"));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the architecture test path is not exempt from source-text enforcement", () => {
  const architectureTestPath = "test/architectureInventory.test.js";
  const fixture = createFixture({
    "mac-helper/src/app.js": "export const value = true;\n",
    [architectureTestPath]: fixtureText("sourceTextJavaScript"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.deepEqual(inventory.sourceTextImplementationTests.map((entry) => entry.path), [architectureTestPath]);
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("sourceTextImplementationTests")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("TypeScript source-text tests are enforced", () => {
  const fixture = createFixture({
    "mac-helper/src/app.ts": "export const value = true;\n",
    "test/app.test.ts": fixtureText("sourceTextTypeScript"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    assert.equal(inventory.sourceTextImplementationTests.length, 1);
    const result = checkInventory(inventory, policy());
    assert.ok(result.violations.some((violation) => violation.includes("sourceTextImplementationTests")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("baseline snapshot is history-backed and cannot be inflated", () => {
  const fixture = createFixture({ "mac-helper/src/existing.js": "export {};\n" });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const inflated = snapshotFromInventory(inventory);
    inflated.preloadRuntimePatchModules.push("mac-helper/src/inflated.js");
    const result = checkInventory(inventory, policy({ baseline: inflated }), { history: historyFor(inventory) });
    assert.ok(result.violations.some((violation) => violation.includes("baseline sections do not match")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("baseline authority cannot be changed from the PR base", () => {
  const fixture = createFixture({ "mac-helper/src/existing.js": "export {};\n" });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({ baselineCommit: "b".repeat(40) }), {
      history: historyFor(inventory, { basePolicy: policy() }),
    });
    assert.ok(result.violations.some((violation) => violation.includes("baselineCommit changed")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("removed debt cannot be reintroduced after a cap reduction", () => {
  const baselineFixture = createFixture({ "mac-helper/src/clean.js": "export {};\n" });
  const currentFixture = createFixture({ "mac-helper/src/reintroduced.js": fixtureText("javascriptRisk") });
  try {
    const baselineInventory = collectInventory(baselineFixture.root, { trackedFiles: baselineFixture.files });
    const currentInventory = collectInventory(currentFixture.root, { trackedFiles: currentFixture.files });
    const result = checkInventory(currentInventory, policy(), { history: historyFor(baselineInventory, { basePolicy: policy() }) });
    assert.ok(result.violations.some((violation) => violation.includes("childProcessImporters")));
    assert.ok(result.violations.some((violation) => violation.includes("destructiveFilesystemImporters")));
  } finally {
    rmSync(baselineFixture.root, { recursive: true, force: true });
    rmSync(currentFixture.root, { recursive: true, force: true });
  }
});

test("invalid allowlists fail closed", () => {
  const fixture = createFixture({ "mac-helper/src/clean.js": "export {};\n" });
  try {
    const invalidAllowlists = emptyAllowlists();
    invalidAllowlists.preloadRuntimePatchModules.push({ id: "bad", path: "mac-helper/src/new.js", adr: "README.md", reason: "", owner: "", removalPhase: "", expiresOn: "2000-01-01" });
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({ allowlists: invalidAllowlists }), { history: historyFor(inventory), today: "2026-08-04" });
    assert.ok(result.violations.some((violation) => violation.includes("requires an ADR path")));
    assert.ok(result.violations.some((violation) => violation.includes("future expiresOn")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("allowlist increases require immutable structured entries", () => {
  const fixture = createFixture({ "mac-helper/src/clean.js": "export {};\n" });
  try {
    const baseAllowlists = emptyAllowlists();
    baseAllowlists.destructiveFilesystemImporters.push(validAllowlist("destructiveFilesystemImporters", "exception", 1));
    const currentAllowlists = emptyAllowlists();
    currentAllowlists.destructiveFilesystemImporters.push(validAllowlist("destructiveFilesystemImporters", "exception", 2));
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policy({ allowlists: currentAllowlists }), {
      history: historyFor(inventory, { basePolicy: policy({ allowlists: baseAllowlists }) }),
    });
    assert.ok(result.violations.some((violation) => violation.includes("may only be removed")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a valid structured allowlist can authorize one exceptional new module", () => {
  const baselineFixture = createFixture({ "mac-helper/src/clean.js": "export {};\n" });
  const currentFixture = createFixture({ "mac-helper/src/neutral.js": fixtureText("aliasedMonkeyPatch") });
  try {
    const baselineInventory = collectInventory(baselineFixture.root, { trackedFiles: baselineFixture.files });
    const currentInventory = collectInventory(currentFixture.root, { trackedFiles: currentFixture.files });
    const allowlists = emptyAllowlists();
    allowlists.preloadRuntimePatchModules.push(validAllowlist("preloadRuntimePatchModules", "neutral-exception"));
    const result = checkInventory(currentInventory, policy({ allowlists }), {
      history: historyFor(baselineInventory),
      today: "2026-08-04",
    });
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(baselineFixture.root, { recursive: true, force: true });
    rmSync(currentFixture.root, { recursive: true, force: true });
  }
});

test("baseline policy allows existing debt without false failure", () => {
  const fixture = createFixture({
    "mac-helper/src/existingPreload.js": fixtureText("javascriptRisk"),
    "mac-helper/src/existing-large.js": `${Array.from({ length: 801 }, () => "x").join("\n")}\n`,
    "test/existing.test.js": fixtureText("sourceTextJavaScript"),
  });
  try {
    const inventory = collectInventory(fixture.root, { trackedFiles: fixture.files });
    const result = checkInventory(inventory, policyForInventory(inventory), { history: historyFor(inventory) });
    assert.deepEqual(result.violations, []);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function policy(overrides = {}) {
  const baseline = overrides.baseline || emptySnapshot();
  return {
    version: 2,
    baselineCommit: overrides.baselineCommit || baselineCommit,
    baseline,
    caps: overrides.caps || structuredClone(baseline),
    allowlists: overrides.allowlists || emptyAllowlists(),
  };
}

function policyForInventory(inventory, overrides = {}) {
  return policy({ baseline: snapshotFromInventory(inventory), ...overrides });
}

function historyFor(baselineInventory, overrides = {}) {
  return {
    baselineCommit,
    baseCommit,
    baselineInventory,
    basePolicy: overrides.basePolicy ?? null,
    knownFiles: new Set(["docs/internal/adr/ADR-0001-test.md"]),
  };
}

function emptySnapshot() {
  return {
    preloadRuntimePatchModules: [],
    childProcessImporters: {},
    destructiveFilesystemImporters: {},
    sourceTextImplementationTests: {},
    oversizedProductionFiles: [],
  };
}

function emptyAllowlists() {
  return {
    preloadRuntimePatchModules: [],
    childProcessImporters: [],
    destructiveFilesystemImporters: [],
    sourceTextImplementationTests: [],
    oversizedProductionFiles: [],
  };
}

function validAllowlist(category, id, max) {
  const entry = {
    id,
    path: "mac-helper/src/neutral.js",
    adr: "docs/internal/adr/ADR-0001-test.md",
    reason: "Temporary compatibility exception for a bounded fixture.",
    owner: "architecture",
    removalPhase: "Phase 1",
    expiresOn: "2026-12-31",
  };
  if (max !== undefined) entry.max = max;
  return entry;
}

function fixtureText(name) {
  return JSON.parse(readFileSync(join(fixtureDirectory, "inventory-fixtures.json"), "utf8"))[name];
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
