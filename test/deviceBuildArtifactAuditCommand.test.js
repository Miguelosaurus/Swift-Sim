import assert from "node:assert/strict";
import test from "node:test";
import {
  DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND,
  dispatchDeviceBuildArtifactAuditCommand,
} from "../mac-helper/src/commands/deviceBuildArtifactAuditCommand.js";
import { createDeviceBuildArtifactAuditCompatibility } from "../mac-helper/src/deviceBuildArtifactAuditCompatibility.js";
import { summarizeDeviceBuildArtifactAudit } from "../mac-helper/src/deviceBuildArtifactAuditSummary.js";

function emptyLegacyState() {
  return JSON.stringify({
    version: 6,
    builds: [],
    apps: {},
    artifactCleanupJobs: {},
    deliveryReferenceCleanupJobs: {},
  });
}

function auditResult(overrides = {}) {
  return {
    version: 1,
    readOnly: true,
    measurementComplete: true,
    buildCount: 1,
    measuredBuildCount: 1,
    totalKiB: 1_000,
    reclaimableKiB: 250,
    protectedKiB: 750,
    manualReviewKiB: 0,
    buckets: { failedWholeRoots: { count: 0, totalKiB: 0 } },
    orphanRoots: [],
    unboundInventory: [],
    measurementIssues: [],
    warnings: ["cleanup disabled"],
    builds: [{ buildID: "secret-build", root: "/Users/private/device-builds/secret-build" }],
    artifactDirectory: "/Users/private/device-builds",
    ...overrides,
  };
}

test("compatibility audit reads one atomic legacy snapshot without any write-capable store operation", async () => {
  let reads = 0;
  const usageCalls = [];
  const fileStore = {
    readTextSync(path) {
      reads += 1;
      assert.equal(path, "/Users/test/.swift-sim/device-builds.json");
      return emptyLegacyState();
    },
    writeTextSync() {
      throw new Error("read-only artifact audit must not write");
    },
  };
  const usage = {
    async measure(input) {
      usageCalls.push(input);
      return { inventory: [], orphanRoots: [], issues: [] };
    },
  };
  const service = createDeviceBuildArtifactAuditCompatibility({
    legacyPath: "/Users/test/.swift-sim/device-builds.json",
    commandRunner: { async run() { throw new Error("injected usage should own measurement"); } },
    environmentNames: () => [],
    fileStore,
    usage,
  });

  const result = await service.inspect();

  assert.equal(reads, 1);
  assert.equal(result.readOnly, true);
  assert.equal(result.buildCount, 0);
  assert.deepEqual(usageCalls, [{
    builds: [],
    artifactDirectory: "/Users/test/.swift-sim/device-builds",
  }]);
});

test("missing legacy JSON is an empty read-only audit rather than a store initialization", async () => {
  const fileStore = {
    readTextSync() {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
  };
  const service = createDeviceBuildArtifactAuditCompatibility({
    legacyPath: "/Users/test/.swift-sim/device-builds.json",
    commandRunner: { async run() { throw new Error("not used"); } },
    environmentNames: () => [],
    fileStore,
    usage: { async measure() { return { inventory: [], orphanRoots: [], issues: [] }; } },
  });

  const result = await service.inspect();

  assert.equal(result.buildCount, 0);
  assert.equal(result.reclaimableKiB, 0);
});

test("summary is path-free and reports conservative diagnostic counts", () => {
  const summary = summarizeDeviceBuildArtifactAudit(auditResult({
    orphanRoots: [{ name: "orphan", root: "/private/orphan", totalKiB: 10 }],
    measurementIssues: [
      { code: "missing-root", path: "/private/a" },
      { code: "missing-root", path: "/private/b" },
      { code: "component-symlink", path: "/private/c" },
    ],
  }));
  const serialized = JSON.stringify(summary);

  assert.equal(summary.readOnly, true);
  assert.equal(summary.cleanupEnabled, false);
  assert.equal(summary.orphanRootCount, 1);
  assert.equal(summary.measurementIssueCount, 3);
  assert.deepEqual(summary.measurementIssueCodes, {
    "missing-root": 2,
    "component-symlink": 1,
  });
  assert.equal(serialized.includes("/private/"), false);
  assert.equal(serialized.includes("secret-build"), false);
});

test("helper artifact audit command is opt-in, argument-free, and emits only the redacted summary", async () => {
  const output = [];
  let inspections = 0;
  const handled = await dispatchDeviceBuildArtifactAuditCommand({
    argv: [DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND],
    async inspect() {
      inspections += 1;
      return auditResult();
    },
    writeLine: (line) => output.push(line),
  });

  assert.equal(handled, true);
  assert.equal(inspections, 1);
  const payload = JSON.parse(output.join("\n"));
  assert.equal(payload.cleanupEnabled, false);
  assert.equal(JSON.stringify(payload).includes("/Users/private"), false);

  assert.equal(
    await dispatchDeviceBuildArtifactAuditCommand({
      argv: ["serve"],
      inspect: async () => { throw new Error("must not inspect unrelated commands"); },
      writeLine: () => {},
    }),
    false,
  );
  await assert.rejects(
    dispatchDeviceBuildArtifactAuditCommand({
      argv: [DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND, "--delete"],
      inspect: async () => auditResult(),
      writeLine: () => {},
    }),
    /does not accept arguments/,
  );
});
