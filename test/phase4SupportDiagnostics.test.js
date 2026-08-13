import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPhase4SupportDiagnostics,
  serializePhase4SupportEvidence,
} from "../mac-helper/src/commands/phase4SupportDiagnostics.js";

function healthyProbes() {
  const privateRoot = ["", "Users", "operator", ".swift-sim"].join("/");
  return {
    repositoryHealth: () => ({
      ok: true,
      path: `${privateRoot}/state.sqlite`,
      integrity: "ok",
      journalMode: "wal",
      foreignKeys: true,
      foreignKeyViolations: 0,
      missingTables: [],
      schemaVersion: 7,
      latestSchemaVersion: 7,
      migrationsApplied: 7,
    }),
    migration: () => ({
      status: "already-current",
      recordCount: 212,
      sourceRevision: ["sha256", "private-source"].join(":"),
      projectionHash: ["sha256", "private-projection"].join(":"),
      backups: [`${privateRoot}/backups/state.json`],
    }),
    shadow: () => ({
      enabled: true,
      mismatchCount: 0,
      observationCount: 212,
      keyHash: "private-key-hash",
    }),
    compatibility: () => ({
      state: "compatible",
      legacyReadable: true,
      sqliteReadable: true,
      rollbackReadable: true,
      deviceIdentifier: "private-device-identifier",
    }),
    artifactStorage: () => ({
      readOnly: true,
      cleanupEnabled: false,
      measurementComplete: true,
      totalKiB: 1000,
      reclaimableKiB: 200,
      protectedKiB: 800,
      manualReviewKiB: 0,
      orphanRootCount: 0,
      measurementIssueCount: 0,
      warnings: [`${privateRoot}/DerivedData/private-build`],
    }),
  };
}

test("Phase 4 support evidence is useful, observational, and redacted", () => {
  const probes = healthyProbes();
  const report = collectPhase4SupportDiagnostics(probes);

  assert.equal(report.overall, "healthy");
  assert.equal(report.readOnly, true);
  assert.equal(report.redacted, true);
  assert.equal(report.mutationAllowed, false);
  assert.equal(report.database.schemaVersion, 7);
  assert.equal(report.migration.recordCount, 212);
  assert.equal(report.shadow.observationCount, 212);
  assert.equal(report.artifactStorage.reclaimableKiB, 200);
  assert.deepEqual(report.recovery.actionCodes, []);

  const exported = serializePhase4SupportEvidence(probes);
  for (const omitted of [
    "operator",
    "private-source",
    "private-projection",
    "private-key-hash",
    "private-device-identifier",
    "private-build",
  ]) {
    assert.equal(exported.includes(omitted), false, `support export leaked ${omitted}`);
  }
});

test("artifact observations never enable cleanup through diagnostics", () => {
  const report = collectPhase4SupportDiagnostics({
    ...healthyProbes(),
    artifactStorage: () => ({
      ...healthyProbes().artifactStorage(),
      measurementComplete: false,
      orphanRootCount: 1,
      measurementIssueCount: 2,
    }),
  });

  assert.equal(report.overall, "attention");
  assert.equal(report.artifactStorage.informational, true);
  assert.equal(report.artifactStorage.cleanupEnabled, false);
  assert.equal(report.recovery.mutationAllowed, false);
  assert.ok(report.recovery.actionCodes.includes("review-artifact-measurement-without-cleanup"));
});
