import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  installArtifactCleanupBoundary,
  validatedArtifactCleanupRoot,
} from "../mac-helper/src/artifactCleanupBoundaryPreload.js";
import { DeviceBuildStore } from "../mac-helper/src/deviceBuildStore.js";

installArtifactCleanupBoundary();

test("artifact cleanup accepts only the exact private build root", () => {
  const statePath = "/tmp/swift-sim/device-builds.json";
  assert.equal(
    validatedArtifactCleanupRoot(statePath, {
      id: "job",
      buildId: "build-1",
      root: "/tmp/swift-sim/device-builds/build-1",
    }),
    "/tmp/swift-sim/device-builds/build-1",
  );
  assert.throws(() => validatedArtifactCleanupRoot(statePath, {
    id: "job",
    buildId: "build-1",
    root: "/tmp/swift-sim",
  }), { code: "SWIFT_SIM_ARTIFACT_CLEANUP_PATH_INVALID" });
});

test("persisted cleanup state cannot recursively delete an unrelated directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cleanup-boundary-"));
  const statePath = join(directory, "device-builds.json");
  const victim = join(directory, "unrelated");
  mkdirSync(victim, { recursive: true });
  writeFileSync(join(victim, "keep.txt"), "keep\n");
  const jobID = randomUUID();
  writeState(statePath, {
    [jobID]: {
      id: jobID,
      buildId: "build-1",
      root: victim,
      createdAt: new Date(0).toISOString(),
      nextAttemptAt: new Date(0).toISOString(),
      attempts: 0,
    },
  });

  try {
    const store = new DeviceBuildStore({ path: statePath, maintenance: false });
    store.drainArtifactCleanupJobs();
    assert.equal(existsSync(join(victim, "keep.txt")), true);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.artifactCleanupJobs[jobID].attempts, 1);
    assert.match(state.artifactCleanupJobs[jobID].lastError, /outside its private device-build directory/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("valid persisted cleanup removes its private artifact directory and job", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cleanup-valid-"));
  const statePath = join(directory, "device-builds.json");
  const buildID = "build-1";
  const root = join(directory, "device-builds", buildID);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "artifact.txt"), "artifact\n");
  const jobID = randomUUID();
  writeState(statePath, {
    [jobID]: {
      id: jobID,
      buildId: buildID,
      root,
      createdAt: new Date(0).toISOString(),
      nextAttemptAt: new Date(0).toISOString(),
      attempts: 0,
    },
  });

  try {
    const store = new DeviceBuildStore({ path: statePath, maintenance: false });
    store.drainArtifactCleanupJobs();
    assert.equal(existsSync(root), false);
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(state.artifactCleanupJobs[jobID], undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function writeState(path, jobs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({
    version: 5,
    apps: {},
    builds: [],
    artifactCleanupJobs: jobs,
    deliveryReferenceCleanupJobs: {},
  }, null, 2));
}
