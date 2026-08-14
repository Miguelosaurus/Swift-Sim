import assert from "node:assert/strict";
import test from "node:test";
import { classifyPhase4DiagnosticFailure } from "../mac-helper/src/commands/phase4DiagnosticFailure.js";
import { collectPhase4SupportDiagnostics } from "../mac-helper/src/commands/phase4SupportDiagnostics.js";

const HEALTH = {
  ok: true,
  path: "omitted-by-projection",
  integrity: "ok",
  journalMode: "wal",
  foreignKeys: true,
  foreignKeyViolations: 0,
  missingTables: [],
  schemaVersion: 7,
  latestSchemaVersion: 7,
  migrationsApplied: 7,
};

test("schema-ahead health gets compatibility guidance without changing authority", () => {
  const report = collectPhase4SupportDiagnostics({
    repositoryHealth: () => ({
      ...HEALTH,
      ok: false,
      schemaVersion: 8,
      latestSchemaVersion: 7,
      migrationsApplied: 8,
    }),
  });

  assert.equal(report.database.status, "blocked");
  assert.ok(report.recovery.actionCodes.includes("use-compatible-build-before-migration"));
  assert.equal(report.mutationAllowed, false);
});

test("failure classifier exposes only coarse categories", () => {
  assert.equal(
    classifyPhase4DiagnosticFailure(Object.assign(new Error("locked"), { code: "SQLITE_BUSY" })),
    "busy",
  );
  assert.equal(
    classifyPhase4DiagnosticFailure(Object.assign(new Error("not a database"), { code: "SQLITE_NOTADB" })),
    "corrupt",
  );
  assert.equal(
    classifyPhase4DiagnosticFailure(new Error("schema version is newer than this build")),
    "incompatible",
  );
  assert.equal(
    classifyPhase4DiagnosticFailure(Object.assign(new Error("permission denied"), { code: "EACCES" })),
    "permission-denied",
  );
});
