import assert from "node:assert/strict";
import test from "node:test";
import { deviceBuildArtifactDoctorSection } from "../mac-helper/src/commands/deviceBuildArtifactDoctorProjection.js";

test("doctor storage section keeps artifact cleanup informational and disabled", () => {
  const section = deviceBuildArtifactDoctorSection({
    version: 1,
    readOnly: true,
    cleanupEnabled: false,
    measurementComplete: true,
    totalKiB: 44_144_176,
    reclaimableKiB: 9_495_592,
    protectedKiB: 34_648_584,
    manualReviewKiB: 0,
    orphanRootCount: 1,
    measurementIssueCount: 0,
    buckets: {},
    warnings: [],
  });

  assert.equal(section.artifacts.available, true);
  assert.equal(section.artifacts.informational, true);
  assert.equal(section.artifacts.cleanupEnabled, false);
  assert.match(section.artifacts.detail, /9\.06 GiB safely reclaimable/);
  assert.match(section.artifacts.detail, /33\.04 GiB protected/);
  assert.match(section.artifacts.detail, /1 orphan root/);
  assert.match(section.artifacts.detail, /measurement complete/);
});

test("incomplete measurement is labeled conservative rather than authoritative", () => {
  const section = deviceBuildArtifactDoctorSection({
    readOnly: true,
    cleanupEnabled: false,
    measurementComplete: false,
    totalKiB: 100,
    reclaimableKiB: 20,
    protectedKiB: 80,
    manualReviewKiB: 0,
    orphanRootCount: 0,
    measurementIssueCount: 2,
  });

  assert.equal(section.artifacts.available, true);
  assert.match(section.artifacts.detail, /2 measurement issues; conservative estimate/);
});

test("doctor refuses to present an unproven or cleanup-enabled audit as usable", () => {
  for (const value of [null, {}, { readOnly: false, cleanupEnabled: false }, { readOnly: true, cleanupEnabled: true }]) {
    const section = deviceBuildArtifactDoctorSection(value);
    assert.equal(section.artifacts.available, false);
    assert.equal(section.artifacts.cleanupEnabled, false);
    assert.equal(section.artifacts.informational, true);
    assert.match(section.artifacts.detail, /no cleanup was attempted/);
  }
});
