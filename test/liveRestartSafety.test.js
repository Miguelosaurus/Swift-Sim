import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDeliveryQueue } from "../mac-helper/src/liveDeliveryQueue.js";
import { createLiveDeliveryRuntime } from "../mac-helper/src/liveDeliveryRuntime.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const hash = (text) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-restart-safety-"));
  let time = 1_000_000;
  let sequence = 0;
  const fileStore = new NodeAtomicFileStore();
  const lockManager = new NodeLockManager({ fileStore, identity: (pid) => pid === process.pid ? { startToken: "safety-test" } : null });
  const queue = createLiveDeliveryQueue({ rootPath: join(root, "deliveries"), fileStore, lockManager, now: () => time, newId: () => `safety-token-${++sequence}` });
  const scope = { project: "project", scheme: "Example", appIdentity: "app", binaryIdentity: "binary", sessionIdentity: "process-a" };
  async function prepare(requestId, scopeForClaim = scope, revision = 0) {
    const record = await queue.claimNext({ scope: scopeForClaim, currentRevision: revision, deviceConnected: true, foreground: true, workerId: "safety-worker" });
    assert.equal(record?.requestId, requestId);
    await queue.transition(requestId, { claimToken: record.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: hash(requestId), path: "owned-test-artifact" } });
  }
  async function apply(requestId, scopeForClaim = scope, revision = 0, uncertain = false) {
    const record = await queue.claimNext({ scope: scopeForClaim, currentRevision: revision, deviceConnected: true, foreground: true, workerId: "safety-worker" });
    assert.equal(record?.requestId, requestId);
    await queue.transition(requestId, { claimToken: record.claim.token, state: "applying", scope: scopeForClaim, currentRevision: revision });
    await queue.transition(requestId, { claimToken: record.claim.token, state: uncertain ? "uncertain" : "refreshed", proof: uncertain ? undefined : { requestId, sessionIdentity: scopeForClaim.sessionIdentity, binaryIdentity: scopeForClaim.binaryIdentity, patchDigest: record.preparedPatch.patchDigest, applied: true, refreshed: true, revision: revision + 1 } });
  }
  return { root, queue, scope, prepare, apply, advance(ms) { time += ms; }, now: () => time, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("revoking restoration cannot clear ambiguity for a later mutation in the same app process", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "ambiguous-a", scope: f.scope, files: [{ path: "Card.swift", beforeSource: "old", afterSource: "first" }] });
    await f.prepare("ambiguous-a"); await f.apply("ambiguous-a", f.scope, 0, true);
    try { await f.queue.revokeDesired({ scope: f.scope }); } catch (error) { assert.equal(error.code, "QUEUE_REVOKE_BLOCKED"); }
    await f.queue.enqueue({ requestId: "successor-a", scope: f.scope, files: [{ path: "Card.swift", beforeSource: "first", afterSource: "second" }], baselineRevision: 1 });
    await f.prepare("successor-a", f.scope, 1);
    const admission = await f.queue.claimNext({ scope: f.scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "safety-worker" });
    assert.equal(admission, null, "unresolved process-A effect must still fence process-A successors");
  } finally { f.cleanup(); }
});

test("fresh-process edit after receipt GC restores other durable files as well as the new edit", async () => {
  const f = fixture();
  try {
    const firstPath = join(f.root, "Card.swift");
    const secondPath = join(f.root, "Other.swift");
    await f.queue.enqueue({ requestId: "confirmed-a", scope: f.scope, files: [
      { path: firstPath, beforeSource: "card-original", afterSource: "card-first" },
      { path: secondPath, beforeSource: "other-original", afterSource: "other-first" },
    ] });
    await f.prepare("confirmed-a"); await f.apply("confirmed-a");
    f.advance(24 * 60 * 60 * 1000 + 1);
    // An unrelated lane mutation legitimately collects the expired receipt.
    await f.queue.enqueue({ requestId: "unrelated-lane", scope: { ...f.scope, binaryIdentity: "other-binary" }, files: [{ path: "Unrelated.swift", beforeSource: "a", afterSource: "b" }] });
    assert.equal(f.queue.get("confirmed-a"), null);
    const state = { engineAvailable: true, connected: true, matchesBinary: true, foreground: true, rootReady: true, scope: { ...f.scope, sessionIdentity: "process-b" }, revision: 0 };
    const appliedFiles = new Map();
    const adapter = {
      async binding() { return { scope: state.scope, verifiedProcess: true, revision: state.revision, sourceBaselines: { [firstPath]: hash("card-original"), [secondPath]: hash("other-original") } }; },
      async inspect(record) { return { ...state, matchesBinary: record.scope.binaryIdentity === state.scope.binaryIdentity }; },
      async prepare(record) { return { patchDigest: hash(record.requestId), path: "owned-test-artifact" }; },
      async apply(record) {
        for (const file of record.files) appliedFiles.set(file.path, file.afterSource);
        state.revision += 1;
        return { requestId: record.requestId, sessionIdentity: state.scope.sessionIdentity, binaryIdentity: state.scope.binaryIdentity, patchDigest: record.preparedPatch.patchDigest, applied: true, refreshed: true, revision: state.revision };
      },
      async receipt() { return null; },
    };
    const runtime = createLiveDeliveryRuntime({ queue: f.queue, adapter, now: f.now, workerId: "safety-runtime" });
    await runtime.enqueue({ requestId: "new-edit-b", files: [{ path: firstPath, beforeSource: "card-first", afterSource: "card-second" }] });
    for (let tick = 0; tick < 8; tick += 1) await runtime.runOnce();
    assert.equal(appliedFiles.get(firstPath), "card-second");
    assert.equal(appliedFiles.get(secondPath), "other-first", "the new edit must not suppress durable restoration of other files");
  } finally { f.cleanup(); }
});

test("an unexpired source request keeps readable terminal status when its shorter-lived recovery expires", async () => {
  const f = fixture();
  try {
    const firstExpiry = f.now() + 100;
    await f.queue.enqueue({ requestId: "short-pending", scope: f.scope, expiresAt: firstExpiry, files: [{ path: "Card.swift", beforeSource: "old", afterSource: "first" }] });
    await f.queue.enqueue({ requestId: "long-pending", scope: f.scope, expiresAt: f.now() + 200, files: [{ path: "Card.swift", beforeSource: "first", afterSource: "second" }] });
    const nextScope = { ...f.scope, sessionIdentity: "process-b" };
    const result = await f.queue.rebaseForProcess({ scope: nextScope, verified: true, currentRevision: 0, newRequestId: "short-recovery" });
    assert.equal(result.record.expiresAt, firstExpiry);
    f.advance(101);
    // This sweeps the expired cumulative request and collects removable history.
    await f.queue.enqueue({ requestId: "gc-trigger", scope: { ...f.scope, binaryIdentity: "unrelated" }, files: [{ path: "Other.swift", beforeSource: "a", afterSource: "b" }] });
    assert.equal(f.queue.get("long-pending").replacementRequestId, "short-recovery");
    const runtime = createLiveDeliveryRuntime({ queue: f.queue, adapter: {}, now: f.now });
    const status = runtime.status("long-pending");
    assert.equal(status.outcome, "failed");
    assert.equal(status.reasonCode, "QUEUE_EXPIRED");
  } finally { f.cleanup(); }
});

test("delivery expiry and history collection cannot erase a same-process uncertain-effect fence", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "expired-ambiguous", scope: f.scope, files: [{ path: "Card.swift", beforeSource: "old", afterSource: "first" }], expiresAt: f.now() + 100 });
    await f.prepare("expired-ambiguous"); await f.apply("expired-ambiguous", f.scope, 0, true);
    f.advance(101);
    await f.queue.enqueue({ requestId: "post-expiry-successor", scope: f.scope, files: [{ path: "Card.swift", beforeSource: "first", afterSource: "second" }], baselineRevision: 1 });
    await f.prepare("post-expiry-successor", f.scope, 1);
    const admission = await f.queue.claimNext({ scope: f.scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "safety-worker" });
    assert.equal(admission, null, "expiry is not proof that the previous native operation had no effect");
  } finally { f.cleanup(); }
});

test("cumulative confirmed source capacity is checked before accepting a patch whose effect could not be journaled", async () => {
  const f = fixture();
  try {
    const largeOriginal = "a".repeat(1024 * 1024);
    const largeChanged = "b".repeat(1024 * 1024);
    await f.queue.enqueue({ requestId: "full-desire", scope: f.scope, files: Array.from({ length: 4 }, (_, index) => ({ path: `Large${index}.swift`, beforeSource: largeOriginal, afterSource: largeChanged })) });
    await f.prepare("full-desire"); await f.apply("full-desire");
    await assert.rejects(f.queue.enqueue({ requestId: "over-capacity", scope: f.scope, files: [{ path: "Fifth.swift", beforeSource: largeOriginal, afterSource: largeChanged }], baselineRevision: 1 }), { code: "QUEUE_LIMIT_REACHED" });
    assert.equal(f.queue.get("over-capacity"), null);
    assert.equal(f.queue.desiredStates()[0].files.length, 4);
  } finally { f.cleanup(); }
});

test("splitting a large cumulative desired state across offline requests cannot evade the source capacity fence", async () => {
  const f = fixture();
  try {
    const original = "a".repeat(1024 * 1024);
    const changed = "b".repeat(1024 * 1024);
    await f.queue.enqueue({ requestId: "pending-full", scope: f.scope, files: Array.from({ length: 4 }, (_, index) => ({ path: `Pending${index}.swift`, beforeSource: original, afterSource: changed })) });
    await assert.rejects(f.queue.enqueue({ requestId: "pending-over-capacity", scope: f.scope, files: [{ path: "PendingFifth.swift", beforeSource: original, afterSource: changed }] }), { code: "QUEUE_LIMIT_REACHED" });
    assert.equal(f.queue.get("pending-over-capacity"), null);
  } finally { f.cleanup(); }
});

test("journal space for new durable confirmation is reserved before another binary's patch is accepted", async () => {
  const f = fixture();
  try {
    const largeOriginal = "a".repeat(1024 * 1024);
    const largeChanged = "b".repeat(1024 * 1024);
    await f.queue.enqueue({ requestId: "binary-a-full", scope: f.scope, files: Array.from({ length: 4 }, (_, index) => ({ path: `Original${index}.swift`, beforeSource: largeOriginal, afterSource: largeChanged })) });
    await f.prepare("binary-a-full"); await f.apply("binary-a-full");
    const otherOriginal = "c".repeat(Math.floor(0.85 * 1024 * 1024));
    const otherChanged = "d".repeat(Math.floor(0.85 * 1024 * 1024));
    await assert.rejects(f.queue.enqueue({ requestId: "binary-b-over-journal", scope: { ...f.scope, binaryIdentity: "binary-b" }, files: Array.from({ length: 3 }, (_, index) => ({ path: `New${index}.swift`, beforeSource: otherOriginal, afterSource: otherChanged })) }), { code: "QUEUE_LIMIT_REACHED" });
    assert.equal(f.queue.get("binary-b-over-journal"), null);
  } finally { f.cleanup(); }
});
