import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createDeviceBuildArtifactRetention,
  FAILED_BUILD_ARTIFACT_RETENTION_MS,
  pruneReadyIntermediates,
} from "../mac-helper/src/deviceBuildArtifactRetention.js";

class RecordingArtifactStore {
  constructor() {
    this.removed = [];
    this.approved = [];
  }

  resolveContained(root, candidate) {
    const resolvedRoot = resolve(root);
    const resolvedCandidate = resolve(candidate);
    const relative = resolvedCandidate.slice(resolvedRoot.length);
    if (
      resolvedCandidate !== resolvedRoot &&
      (!relative.startsWith("/") || relative.includes("/../"))
    ) {
      throw new Error("outside artifact root");
    }
    this.approved.push(resolvedCandidate);
    return resolvedCandidate;
  }

  removeTreeSync(path) {
    this.removed.push(resolve(path));
  }
}

function readyBuild(root = "/private/tmp/swift-sim/device-builds/build-1") {
  return {
    id: "build-1",
    state: "ready",
    artifacts: {
      root,
      archivePath: join(root, "App.xcarchive"),
      exportPath: join(root, "export"),
      ipaPath: join(root, "export", "App.ipa"),
      resultBundlePath: join(root, "App.xcresult"),
    },
  };
}

test("ready retention prunes heavyweight intermediates but preserves install payload", () => {
  const artifactStore = new RecordingArtifactStore();
  const build = readyBuild();
  const result = pruneReadyIntermediates(build, artifactStore);

  assert.equal(result.action, "pruned-ready");
  assert.deepEqual(new Set(artifactStore.removed), new Set([
    resolve(join(build.artifacts.root, "DerivedData")),
    resolve(build.artifacts.archivePath),
    resolve(build.artifacts.resultBundlePath),
    resolve(join(build.artifacts.root, "ExportOptions.plist")),
  ]));
  assert.equal(artifactStore.removed.includes(resolve(build.artifacts.exportPath)), false);
  assert.equal(artifactStore.removed.includes(resolve(build.artifacts.ipaPath)), false);
  assert.deepEqual(result.preserved, [resolve(build.artifacts.ipaPath)]);
});

test("ready retention will not delete a candidate that aliases an IPA ancestor", () => {
  const artifactStore = new RecordingArtifactStore();
  const build = readyBuild();
  build.artifacts.archivePath = build.artifacts.exportPath;

  const result = pruneReadyIntermediates(build, artifactStore);

  assert.equal(artifactStore.removed.includes(resolve(build.artifacts.exportPath)), false);
  assert.equal(result.preserved.includes(resolve(build.artifacts.exportPath)), true);
});

test("retention schedules failed whole-root cleanup after a diagnostic grace period", () => {
  const artifactStore = new RecordingArtifactStore();
  const scheduled = [];
  const now = Date.parse("2026-08-12T12:00:00.000Z");
  const retention = createDeviceBuildArtifactRetention({
    artifactStore,
    scheduleFailedCleanup: (request) => scheduled.push(request),
    now: () => now,
  });
  const build = readyBuild();
  build.state = "failed";

  const result = retention.afterTerminalBuild(build);

  assert.equal(result.action, "scheduled-failed");
  assert.deepEqual(scheduled, [{
    buildID: "build-1",
    root: build.artifacts.root,
    notBefore: new Date(now + FAILED_BUILD_ARTIFACT_RETENTION_MS).toISOString(),
  }]);
  assert.deepEqual(artifactStore.removed, []);
});

test("retention is inert for nonterminal builds and records without artifacts", () => {
  const artifactStore = new RecordingArtifactStore();
  const scheduled = [];
  const retention = createDeviceBuildArtifactRetention({
    artifactStore,
    scheduleFailedCleanup: (request) => scheduled.push(request),
  });

  assert.deepEqual(retention.afterTerminalBuild({ id: "active", state: "building" }), {
    action: "none",
  });
  assert.deepEqual(retention.afterTerminalBuild({ id: "failed", state: "failed" }), {
    action: "none",
  });
  assert.deepEqual(artifactStore.removed, []);
  assert.deepEqual(scheduled, []);
});
