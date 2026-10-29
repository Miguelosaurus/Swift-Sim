import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLocalEngineCandidate, stageLocalEngineCandidate } from "../mac-helper/src/liveEngineCandidate.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-candidate-"));
  const rootPath = join(directory, "engine"); const archivePath = join(directory, "fixture.zip");
  const bytes = Buffer.from("synthetic candidate archive"); writeFileSync(archivePath, bytes, { mode: 0o600 });
  const value = { archivePath, version: "0.5.0", sha256: createHash("sha256").update(bytes).digest("hex"), sourceRevision: "a".repeat(40) };
  return { directory, rootPath, archivePath, value, cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}

test("candidate reads are read-only and explicit staging is hash-bound, private and idempotent", async () => {
  const f = fixture();
  try {
    assert.deepEqual(readLocalEngineCandidate({ rootPath: f.rootPath }), { candidate: null, error: "" });
    assert.equal(existsSync(f.rootPath), false);
    await stageLocalEngineCandidate(f.value, { rootPath: f.rootPath });
    await stageLocalEngineCandidate(f.value, { rootPath: f.rootPath });
    const result = readLocalEngineCandidate({ rootPath: f.rootPath });
    assert.equal(result.error, ""); assert.equal(result.candidate.sha256, f.value.sha256);
    assert.equal(result.candidate.sourceRevision, f.value.sourceRevision); assert.equal(result.candidate.localCandidate, true);
    assert.equal(lstatSync(join(f.rootPath, "local-candidate.json")).mode & 0o777, 0o600);
    assert.equal(lstatSync(result.candidate.archivePath).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("hash, source identity and source symlink failures do not initialize candidate state", async () => {
  const f = fixture();
  try {
    for (const value of [{ ...f.value, sha256: "f".repeat(64) }, { ...f.value, sourceRevision: "not-a-revision" }, { ...f.value, version: "../escape" }]) await assert.rejects(stageLocalEngineCandidate(value, { rootPath: f.rootPath }), { code: "LIVE_ENGINE_CANDIDATE_INVALID" });
    const link = join(f.directory, "symlink.zip"); symlinkSync(f.archivePath, link);
    await assert.rejects(stageLocalEngineCandidate({ ...f.value, archivePath: link }, { rootPath: f.rootPath }), { code: "LIVE_ENGINE_CANDIDATE_INVALID" });
    assert.equal(existsSync(f.rootPath), false);
  } finally { f.cleanup(); }
});

test("malformed, missing-archive and broadly readable candidates fail closed", async () => {
  const f = fixture();
  try {
    await stageLocalEngineCandidate(f.value, { rootPath: f.rootPath });
    const path = join(f.rootPath, "local-candidate.json");
    chmodSync(path, 0o644); assert.ok(readLocalEngineCandidate({ rootPath: f.rootPath }).error);
    chmodSync(path, 0o600); writeFileSync(path, "not-json", { mode: 0o600 }); assert.ok(readLocalEngineCandidate({ rootPath: f.rootPath }).error);
    await stageLocalEngineCandidate(f.value, { rootPath: f.rootPath });
    const archive = readLocalEngineCandidate({ rootPath: f.rootPath }).candidate.archivePath;
    rmSync(archive); const missing = readLocalEngineCandidate({ rootPath: f.rootPath });
    assert.equal(missing.candidate, null); assert.ok(missing.error);
  } finally { f.cleanup(); }
});

test("candidate parent-directory symlinks and broad permissions cannot redirect trusted activation", async () => {
  const f = fixture();
  try {
    await stageLocalEngineCandidate(f.value, { rootPath: f.rootPath });
    chmodSync(f.rootPath, 0o755); assert.ok(readLocalEngineCandidate({ rootPath: f.rootPath }).error);
    chmodSync(f.rootPath, 0o700);
    const alias = join(f.directory, "redirected-engine"); symlinkSync(f.rootPath, alias);
    assert.ok(readLocalEngineCandidate({ rootPath: alias }).error);
  } finally { f.cleanup(); }
});
