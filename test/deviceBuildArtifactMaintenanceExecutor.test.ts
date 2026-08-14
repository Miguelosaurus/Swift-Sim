import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDeviceBuildArtifactMaintenanceExecutor } from "../mac-helper/src/deviceBuildArtifactMaintenanceExecutor.js";

test("historical maintenance executor deletes only through the contained ArtifactStore boundary", async () => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-artifact-maintenance-executor-"));
  try {
    const artifact = join(root, "build-1");
    await mkdir(artifact);
    await writeFile(join(artifact, "payload"), "artifact");

    const executor = createDeviceBuildArtifactMaintenanceExecutor();
    const approved = executor.approveContained(root, artifact);
    assert.equal(approved, artifact);
    await executor.reclaimApproved(approved);
    await assert.rejects(
      access(artifact),
      (error: NodeJS.ErrnoException) => error.code === "ENOENT",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("historical maintenance executor refuses candidates outside the approved root", async () => {
  const parent = await mkdtemp(join(tmpdir(), "swift-sim-artifact-maintenance-containment-"));
  const root = join(parent, "root");
  const outside = join(parent, "outside");
  try {
    await mkdir(root);
    await mkdir(outside);
    const executor = createDeviceBuildArtifactMaintenanceExecutor();
    assert.throws(
      () => executor.approveContained(root, outside),
      (error: NodeJS.ErrnoException) => error.code === "SWIFT_SIM_ARTIFACT_PATH_INVALID",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
