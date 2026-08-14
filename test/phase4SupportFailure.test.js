import assert from "node:assert/strict";
import test from "node:test";
import { collectPhase4SupportDiagnostics } from "../mac-helper/src/commands/phase4SupportDiagnostics.js";

test("busy observations fail safely without mutation guidance", () => {
  const report = collectPhase4SupportDiagnostics({
    repositoryHealth: () => {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    },
  });

  assert.equal(report.database.available, false);
  assert.equal(report.database.failureCategory, "busy");
  assert.equal(report.overall, "attention");
  assert.ok(report.recovery.actionCodes.includes("retry-diagnostic-after-current-writer-completes"));
  assert.equal(report.recovery.actionCodes.some((code) => /delete|repair/.test(code)), false);
});

test("corruption is blocked with preserve-state recovery guidance", () => {
  const report = collectPhase4SupportDiagnostics({
    repositoryHealth: () => {
      throw Object.assign(new Error("database image is malformed"), { code: "SQLITE_CORRUPT" });
    },
  });

  assert.equal(report.database.failureCategory, "corrupt");
  assert.equal(report.overall, "blocked");
  assert.ok(report.recovery.actionCodes.includes("preserve-state-and-restore-verified-backup"));
});
