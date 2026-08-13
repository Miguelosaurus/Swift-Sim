import assert from "node:assert/strict";
import test from "node:test";
import { SessionLegacyImportApplier } from "../mac-helper/src/persistence/sessionLegacyImport.js";
import { sessionProjectionHash } from "../mac-helper/src/persistence/sessionLegacyProjection.js";

const locked = { snapshot: [], sourceRevision: "revision-1", projectionHash: sessionProjectionHash([]), recordCount: 0, backups: [] };

test("session import checkpoint retries are idempotent", () => {
  let checkpoint = null;
  let applyCount = 0;
  const importer = new SessionLegacyImportApplier({
    readSnapshot: () => [],
    readCheckpoint: () => checkpoint,
    atomicApply: (change) => { applyCount += 1; checkpoint = change.checkpoint; },
    now: () => "2026-08-13T20:00:00.000Z",
  });
  assert.equal(importer.apply(locked).status, "checkpointed");
  assert.equal(importer.apply(locked).status, "already-current");
  assert.equal(applyCount, 1);
});

test("session import interruption leaves retryable state", () => {
  let checkpoint = null;
  const failing = new SessionLegacyImportApplier({ readSnapshot: () => [], readCheckpoint: () => checkpoint, atomicApply: () => { throw new Error("interrupted"); } });
  assert.throws(() => failing.apply(locked), /interrupted/);
  assert.equal(checkpoint, null);
});
