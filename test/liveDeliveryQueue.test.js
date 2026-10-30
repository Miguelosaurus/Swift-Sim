import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDeliveryQueue } from "../mac-helper/src/liveDeliveryQueue.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const scope = { project: "fixture-project", scheme: "Example", appIdentity: "app-signing-identity", binaryIdentity: "binary-uuid", sessionIdentity: "process-epoch" };
const sources = [{ path: "Card.swift", beforeSource: 'struct Card { var title: String { "old" } }', afterSource: 'struct Card { var title: String { "new" } }' }];

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-live-queue-"));
  const rootPath = join(directory, "deliveries");
  let clock = 1_000;
  let id = 0;
  const fileStore = new NodeAtomicFileStore();
  const identity = (pid) => pid === process.pid ? { startToken: "fixture-start-token" } : null;
  const options = { rootPath, fileStore, lockManager: new NodeLockManager({ identity, fileStore }), now: () => clock, newId: () => `token-${++id}` };
  return { directory, rootPath, fileStore, queue: createLiveDeliveryQueue(options), reopen: () => createLiveDeliveryQueue(options), tick(ms) { clock += ms; }, cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}
async function queued(f, requestId = "request-1", files = sources) { return f.queue.enqueue({ requestId, scope, files, baselineRevision: 0 }); }
async function prepare(f, requestId = "request-1") {
  const claim = await f.queue.claimNext({ scope, currentRevision: 0, workerId: "compiler" });
  assert.equal(claim.requestId, requestId);
  await f.queue.transition(requestId, { claimToken: claim.claim.token, state: "waiting-for-device", preparedPatch: { path: "private-compiled-artifact", patchDigest: requestId } });
}
async function begin(f, requestId = "request-1", currentRevision = 0) {
  const claim = await f.queue.claimNext({ scope, currentRevision, deviceConnected: true, foreground: true, workerId: "applier" });
  assert.equal(claim.requestId, requestId);
  await f.queue.transition(requestId, { claimToken: claim.claim.token, state: "applying", scope, currentRevision });
  return claim.claim.token;
}
function proof(requestId = "request-1", revision = 1, refreshed = true) { return { requestId, sessionIdentity: scope.sessionIdentity, binaryIdentity: scope.binaryIdentity, applied: true, refreshed, revision, patchDigest: requestId }; }

test("queue reads do not initialize state; immutable snapshots survive reopen privately", async () => {
  const f = fixture();
  try {
    assert.deepEqual(f.queue.list(), []);
    assert.equal(f.queue.get("missing"), null);
    assert.throws(() => lstatSync(f.rootPath), { code: "ENOENT" });
    const input = structuredClone(sources);
    const result = await f.queue.enqueue({ requestId: "request-1", scope, files: input });
    input[0].afterSource = "later unqueued source";
    result.files[0].afterSource = "mutated return";
    const record = f.reopen().get("request-1");
    assert.equal(record.files[0].afterSource, sources[0].afterSource);
    assert.equal(lstatSync(f.rootPath).mode & 0o777, 0o700);
    assert.equal(lstatSync(join(f.rootPath, "queue.json")).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("same request id is idempotent only for identical snapshots and binding", async () => {
  const f = fixture();
  try {
    const first = await queued(f);
    assert.deepEqual(await queued(f), first);
    await assert.rejects(f.queue.enqueue({ requestId: first.requestId, scope: { ...scope, binaryIdentity: "different" }, files: sources }), { code: "QUEUE_REQUEST_CONFLICT" });
    await assert.rejects(queued(f, first.requestId, [{ ...sources[0], afterSource: "different" }]), { code: "QUEUE_REQUEST_CONFLICT" });
    assert.equal(f.queue.list().length, 1);
  } finally { f.cleanup(); }
});

test("competing queue instances cannot claim the same request", async () => {
  const f = fixture();
  try {
    await queued(f);
    const [first, second] = await Promise.all([
      f.queue.claimNext({ scope, currentRevision: 0, workerId: "worker-1" }),
      f.reopen().claimNext({ scope, currentRevision: 0, workerId: "worker-2" }),
    ]);
    assert.equal([first, second].filter(Boolean).length, 1);
    const claim = first || second;
    await assert.rejects(f.queue.transition("request-1", { claimToken: "wrong-owner", state: "failed" }), { code: "QUEUE_STALE_CLAIM" });
    assert.equal(f.queue.get("request-1").claim.token, claim.claim.token);
  } finally { f.cleanup(); }
});

test("offline requests compile before device returns; no implicit apply or success", async () => {
  const f = fixture();
  try {
    await queued(f);
    const claim = await f.queue.claimNext({ scope, currentRevision: 0, workerId: "compiler" });
    assert.equal(claim.state, "compiling");
    await f.queue.transition("request-1", { claimToken: claim.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: "request-1" } });
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 0, workerId: "applier" }), null);
    assert.equal(f.queue.get("request-1").state, "waiting-for-device");
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 0, deviceConnected: true, foreground: false, workerId: "applier" }), null);
    assert.equal(f.queue.get("request-1").state, "waiting-for-foreground");
    assert.equal(f.queue.get("request-1").proof, null);
  } finally { f.cleanup(); }
});

test("FIFO compiles later snapshots offline and advances only after predecessor proof", async () => {
  const f = fixture();
  try {
    await queued(f);
    const nextSource = [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: 'struct Card { var title: String { "latest" } }' }];
    await queued(f, "request-2", nextSource);
    await prepare(f);
    await prepare(f, "request-2");
    assert.equal(f.queue.get("request-1").state, "waiting-for-device");
    const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    const second = await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "applier" });
    assert.equal(second.requestId, "request-2");
    assert.equal(second.baselineRevision, 1);
    assert.equal(second.files[0].beforeSource, sources[0].afterSource);
    assert.equal(second.files[0].afterSource, nextSource[0].afterSource);
  } finally { f.cleanup(); }
});

test("overlapping edits require a truthful source baseline and disjoint files remain queued", async () => {
  const f = fixture();
  try {
    await queued(f);
    await assert.rejects(queued(f, "request-2"), { code: "QUEUE_SOURCE_BASELINE_CONFLICT" });
    await queued(f, "request-3", [{ path: "Other.swift", beforeSource: "old", afterSource: "new" }]);
    assert.deepEqual(f.queue.list().map((record) => record.requestId), ["request-1", "request-3"]);
    assert.equal(f.queue.get("request-1").state, "queued");
  } finally { f.cleanup(); }
});

test("crash during compilation can reclaim; crash after apply barrier becomes uncertain", async () => {
  const f = fixture();
  try {
    await queued(f);
    const first = await f.queue.claimNext({ scope, currentRevision: 0, workerId: "dead-compiler", leaseMs: 20 });
    f.tick(21);
    const second = await f.reopen().claimNext({ scope, currentRevision: 0, workerId: "replacement" });
    assert.notEqual(second.claim.token, first.claim.token);
    await f.queue.transition("request-1", { claimToken: second.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: "request-1" } });
    const token = await begin(f);
    f.tick(120_001);
    assert.equal(await f.reopen().claimNext({ scope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "replacement" }), null);
    assert.equal(f.queue.get("request-1").state, "uncertain");
    await assert.rejects(f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() }), { code: "QUEUE_TERMINAL_STATE" });
  } finally { f.cleanup(); }
});

test("application requires current binary/session/revision; proof must correlate and advance", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f);
    const claim = await f.queue.claimNext({ scope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "applier" });
    for (const bad of [{ scope: { ...scope, binaryIdentity: "wrong" }, currentRevision: 0 }, { scope, currentRevision: 2 }]) {
      await assert.rejects(f.queue.transition("request-1", { claimToken: claim.claim.token, state: "applying", ...bad }), { code: "QUEUE_APPLICATION_FENCE_FAILED" });
    }
    await f.queue.transition("request-1", { claimToken: claim.claim.token, state: "applying", scope, currentRevision: 0 });
    for (const bad of [{ ...proof(), requestId: "other" }, { ...proof(), sessionIdentity: "other" }, { ...proof(), revision: 0 }, { ...proof(), patchDigest: "other" }, { ...proof(), refreshed: false }]) {
      await assert.rejects(f.queue.transition("request-1", { claimToken: claim.claim.token, state: "refreshed", proof: bad }), { code: "QUEUE_PROOF_INVALID" });
    }
    await f.queue.transition("request-1", { claimToken: claim.claim.token, state: "applied", proof: proof("request-1", 1, false) });
    assert.equal(f.queue.get("request-1").state, "applied");
    await f.queue.transition("request-1", { claimToken: claim.claim.token, state: "refreshed", proof: proof() });
    assert.equal(f.reopen().get("request-1").state, "refreshed");
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "duplicate" }), null);
  } finally { f.cleanup(); }
});

test("partial or unknown apply failure cannot be returned to the retry queue", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await assert.rejects(f.queue.transition("request-1", { claimToken: token, state: "waiting-for-device" }), { code: "QUEUE_STATE_INVALID" });
    const failed = await f.queue.transition("request-1", { claimToken: token, state: "failed", reasonCode: "PATCH_TIMEOUT" });
    assert.equal(failed.state, "uncertain");
    assert.equal(f.queue.list()[0].reasonCode, "PATCH_TIMEOUT");
  } finally { f.cleanup(); }
});

test("expiry never converts an unacknowledged apply into retryable work", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "request-1", scope, files: sources, expiresAt: 1_100 });
    f.tick(101);
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 0, workerId: "worker" }), null);
    assert.equal(f.queue.get("request-1").state, "expired");
  } finally { f.cleanup(); }
});

test("verified session rebind resets prepared artifacts but cannot cross app/binary identity", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f);
    const newScope = { ...scope, sessionIdentity: "new-process" };
    await assert.rejects(f.queue.rebindSession("request-1", { previousSessionIdentity: scope.sessionIdentity, scope: newScope, currentRevision: 0 }), { code: "QUEUE_REBIND_REJECTED" });
    await assert.rejects(f.queue.rebindSession("request-1", { previousSessionIdentity: scope.sessionIdentity, scope: { ...newScope, binaryIdentity: "changed-binary" }, currentRevision: 0, verified: true }), { code: "QUEUE_REBIND_REJECTED" });
    const rebound = await f.queue.rebindSession("request-1", { previousSessionIdentity: scope.sessionIdentity, scope: newScope, currentRevision: 0, verified: true });
    assert.equal(rebound.state, "queued");
    assert.equal(rebound.preparedPatch, null);
    assert.equal(rebound.scope.sessionIdentity, "new-process");
    assert.equal(rebound.bindingHistory.length, 1);
    assert.equal(rebound.files[0].afterSource, sources[0].afterSource);
  } finally { f.cleanup(); }
});

test("corrupt, broad-permission and symlink journals fail closed without replacement", async () => {
  const f = fixture();
  try {
    await queued(f);
    const path = join(f.rootPath, "queue.json");
    const original = await f.fileStore.readJSON(path);
    writeFileSync(path, "{corrupt", { mode: 0o600 });
    assert.throws(() => f.queue.list(), { code: "QUEUE_JOURNAL_INVALID" });
    assert.equal(await f.fileStore.readText(path), "{corrupt");
    await f.fileStore.writeJSON(path, { ...original, records: [{ ...original.records[0], files: [{ ...original.records[0].files[0], afterSource: "tampered" }] }] }, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    assert.throws(() => f.queue.list(), { code: "QUEUE_JOURNAL_INVALID" });
    await f.fileStore.writeJSON(path, original, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    chmodSync(path, 0o644);
    assert.throws(() => f.queue.list(), { code: "QUEUE_JOURNAL_UNSAFE" });
    assert.equal(lstatSync(path).mode & 0o777, 0o644);
    chmodSync(path, 0o600);
    chmodSync(f.rootPath, 0o755);
    assert.throws(() => f.queue.list(), { code: "QUEUE_JOURNAL_UNSAFE" });
    chmodSync(f.rootPath, 0o700);
    rmSync(path); symlinkSync(join(f.directory, "other"), path);
    assert.throws(() => f.queue.list(), { code: "QUEUE_JOURNAL_UNSAFE" });
  } finally { f.cleanup(); }
});

test("bounded inputs reject excessive snapshots and invalid request identities", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.queue.enqueue({ requestId: "../escape", scope, files: sources }), { code: "QUEUE_REQUEST_INVALID" });
    await assert.rejects(f.queue.enqueue({ requestId: "large", scope, files: [{ path: "Big.swift", beforeSource: "", afterSource: "x".repeat(f.queue.limits.fileBytes + 1) }] }), { code: "QUEUE_LIMIT_REACHED" });
    await assert.rejects(f.queue.enqueue({ requestId: "duplicate-file", scope, files: [sources[0], sources[0]] }), { code: "QUEUE_SNAPSHOT_INVALID" });
    assert.deepEqual(f.queue.list(), []);
  } finally { f.cleanup(); }
});


test("separate worker processes observe one durable claim", { timeout: 15_000 }, async () => {
  const f = fixture();
  try {
    await queued(f);
    const entry = fileURLToPath(new URL("../mac-helper/src/liveDeliveryQueue.js", import.meta.url));
    const identityEntry = fileURLToPath(new URL("../mac-helper/src/liveEngineOwnershipPreload.js", import.meta.url));
    const run = async (workerId) => {
      const script = `import { kernelProcessIdentity } from ${JSON.stringify(identityEntry)};
        import { createLiveDeliveryQueue } from ${JSON.stringify(entry)};
        const queue = createLiveDeliveryQueue({rootPath:${JSON.stringify(f.rootPath)},identity:kernelProcessIdentity,now:()=>1000});
        console.log(JSON.stringify(await queue.claimNext({scope:${JSON.stringify(scope)},currentRevision:0,workerId:${JSON.stringify(workerId)}})));`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = ""; let stderr = "";
      child.stdout.on("data", (bytes) => { stdout += bytes; });
      child.stderr.on("data", (bytes) => { stderr += bytes; });
      const [exit] = await once(child, "close");
      assert.equal(exit, 0, stderr);
      return JSON.parse(stdout);
    };
    const results = await Promise.all([run("process-one"), run("process-two")]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(f.reopen().get("request-1").claim.workerId, results.find(Boolean).claim.workerId);
  } finally { f.cleanup(); }
});

test("live claims can be renewed only by the current unexpired owner", async () => {
  const f = fixture();
  try {
    await queued(f);
    const claim = await f.queue.claimNext({scope,currentRevision:0,workerId:"compiler",leaseMs:20});
    f.tick(10);
    const renewed = await f.queue.renewClaim("request-1", {claimToken:claim.claim.token,leaseMs:100});
    assert.equal(renewed.claim.expiresAt, 1110);
    await assert.rejects(f.queue.renewClaim("request-1", {claimToken:"wrong"}), {code:"QUEUE_STALE_CLAIM"});
    f.tick(101);
    await assert.rejects(f.queue.renewClaim("request-1", {claimToken:claim.claim.token}), {code:"QUEUE_STALE_CLAIM"});
  } finally { f.cleanup(); }
});

test("unchanged waiting polls do not rewrite the durable journal", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f);
    const first = lstatSync(join(f.rootPath,"queue.json"));
    f.tick(20);
    await f.queue.claimNext({scope,currentRevision:0,workerId:"worker"});
    const second = lstatSync(join(f.rootPath,"queue.json"));
    assert.equal(second.ino,first.ino);
    assert.equal(second.mtimeMs,first.mtimeMs);
  } finally { f.cleanup(); }
});

test("verified receipts recover an interrupted apply without another effect or claim", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); await begin(f);
    f.tick(120_001);
    await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "restarted-helper" });
    assert.equal(f.queue.get("request-1").state, "uncertain");
    await assert.rejects(f.queue.reconcileReceipt("request-1", { scope, proof: proof() }), { code: "QUEUE_RECEIPT_REJECTED" });
    await assert.rejects(f.queue.reconcileReceipt("request-1", { scope: { ...scope, binaryIdentity: "other" }, proof: proof(), verified: true }), { code: "QUEUE_RECEIPT_REJECTED" });
    await assert.rejects(f.queue.reconcileReceipt("request-1", { scope, proof: { ...proof(), patchDigest: "other" }, verified: true }), { code: "QUEUE_PROOF_INVALID" });
    const applied = await f.queue.reconcileReceipt("request-1", { scope, proof: proof("request-1", 1, false), verified: true });
    assert.equal(applied.state, "applied");
    assert.equal(applied.claim, null);
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "no-reapply" }), null);
    const refreshed = await f.reopen().reconcileReceipt("request-1", { scope, proof: proof(), verified: true });
    assert.equal(refreshed.state, "refreshed");
    assert.equal(refreshed.claim, null);
    assert.deepEqual(await f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true }), refreshed);
  } finally { f.cleanup(); }
});

test("receipts cannot claim a pre-apply request succeeded or rebind a completed request", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f);
    await assert.rejects(f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true }), { code: "QUEUE_RECEIPT_REJECTED" });
    const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await assert.rejects(f.queue.rebindSession("request-1", { previousSessionIdentity: scope.sessionIdentity, scope: { ...scope, sessionIdentity: "relaunch" }, currentRevision: 0, verified: true }), { code: "QUEUE_REBIND_REJECTED" });
  } finally { f.cleanup(); }
});

test("an uncertain predecessor blocks apply until its receipt is reconciled", async () => {
  const f = fixture();
  try {
    await queued(f);
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "latest" }]);
    await prepare(f); await prepare(f, "request-2"); await begin(f);
    f.tick(120_001);
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "replacement" }), null);
    assert.equal(f.queue.get("request-1").state, "uncertain");
    assert.notEqual(f.queue.get("request-2").state, "failed");
    await f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true });
    const next = await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "replacement" });
    assert.equal(next.requestId, "request-2");
    assert.equal(next.baselineRevision, 1);
  } finally { f.cleanup(); }
});

test("relaunch never borrows a prior process revision or silently replays completed edits", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "latest" }]);
    await assert.rejects(f.queue.rebindSession("request-2", { previousSessionIdentity: scope.sessionIdentity, scope, currentRevision: 0, verified: true }), { code: "QUEUE_REBIND_REJECTED" });
    const newScope = { ...scope, sessionIdentity: "new-process" };
    await f.queue.rebindSession("request-2", { previousSessionIdentity: scope.sessionIdentity, scope: newScope, currentRevision: 0, verified: true });
    const compiler = await f.queue.claimNext({ scope: newScope, currentRevision: 0, workerId: "compiler" });
    await f.queue.transition("request-2", { claimToken: compiler.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: "request-2" } });
    assert.equal(await f.queue.claimNext({ scope: newScope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "applier" }), null);
    assert.equal(f.queue.get("request-2").reasonCode, "QUEUE_PREDECESSOR_SESSION_CHANGED");
    assert.equal(f.queue.get("request-1").scope.sessionIdentity, scope.sessionIdentity);
  } finally { f.cleanup(); }
});

test("new-process rebase atomically preserves cumulative desired edits across files", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "latest" }]);
    await queued(f, "request-3", [{ path: "Other.swift", beforeSource: "other-old", afterSource: "other-new" }]);
    const newScope = { ...scope, sessionIdentity: "relaunch" };
    const rebased = await f.queue.rebaseForProcess({ scope: newScope, currentRevision: 0, verified: true, newRequestId: "replay" });
    assert.deepEqual(rebased.supersededRequestIds, ["request-2", "request-3"]);
    assert.equal(rebased.record.baselineRevision, 0);
    assert.equal(rebased.record.predecessorRequestId, "");
    assert.deepEqual(rebased.record.files.map(({ path, beforeSource, afterSource }) => ({ path, beforeSource, afterSource })), [
      { path: "Card.swift", beforeSource: sources[0].beforeSource, afterSource: "latest" },
      { path: "Other.swift", beforeSource: "other-old", afterSource: "other-new" },
    ]);
    assert.equal(f.queue.get("request-1").state, "refreshed");
    for (const id of ["request-2", "request-3"]) {
      assert.equal(f.queue.get(id).state, "superseded");
      assert.equal(f.queue.get(id).replacementRequestId, "replay");
    }
    assert.deepEqual(await f.queue.rebaseForProcess({ scope: newScope, currentRevision: 0, verified: true, newRequestId: "another" }), rebased);
    const claim = await f.queue.claimNext({ scope: newScope, currentRevision: 0, workerId: "compiler" });
    assert.equal(claim.requestId, "replay");
  } finally { f.cleanup(); }
});

test("a net-no-change relaunch supersedes pending requests without claiming hot success", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: sources[0].beforeSource }]);
    const input = { scope: { ...scope, sessionIdentity: "relaunch" }, currentRevision: 0, verified: true, newRequestId: "replay" };
    const result = await f.queue.rebaseForProcess(input);
    assert.equal(result.netNoChange, true);
    assert.deepEqual(await f.reopen().rebaseForProcess(input), result);
    assert.equal(result.record, null);
    assert.equal(f.queue.get("request-2").state, "superseded");
    assert.equal(f.queue.get("request-2").reasonCode, "QUEUE_NET_NO_CHANGE");
    assert.equal(f.queue.get("request-2").proof, null);
    assert.equal(f.queue.get("replay"), null);
  } finally { f.cleanup(); }
});

test("new-process rebase refuses unverified, same-process and live-claim histories", async () => {
  const f = fixture();
  try {
    await queued(f);
    const newScope = { ...scope, sessionIdentity: "relaunch" };
    for (const input of [
      { scope: newScope, currentRevision: 0 },
      { scope, currentRevision: 0, verified: true },
      { scope: { ...newScope, binaryIdentity: "different" }, currentRevision: 0, verified: true },
      { scope: newScope, currentRevision: 1, verified: true },
    ]) await assert.rejects(f.queue.rebaseForProcess(input), { code: "QUEUE_REBASE_REJECTED" });
    const claim = await f.queue.claimNext({ scope, currentRevision: 0, workerId: "compiler" });
    await assert.rejects(f.queue.rebaseForProcess({ scope: newScope, currentRevision: 0, verified: true }), { code: "QUEUE_REBASE_BLOCKED" });
    await f.queue.transition("request-1", { claimToken: claim.claim.token, state: "uncertain" });
    await assert.rejects(f.queue.rebaseForProcess({ scope, currentRevision: 0, verified: true }), { code: "QUEUE_REBASE_REJECTED" });
    assert.equal(f.queue.get("request-1").scope.sessionIdentity, scope.sessionIdentity);
  } finally { f.cleanup(); }
});

test("failed durable rebase publication leaves original intents unsuperseded", async () => {
  const f = fixture();
  try {
    await queued(f);
    const write = f.fileStore.writeJSON;
    f.fileStore.writeJSON = async () => { throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" }); };
    await assert.rejects(f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "relaunch" }, currentRevision: 0, verified: true, newRequestId: "replay" }), { code: "ENOSPC" });
    f.fileStore.writeJSON = write;
    assert.equal(f.queue.get("request-1").state, "queued");
    assert.equal(f.queue.get("request-1").replacementRequestId, undefined);
    assert.equal(f.queue.get("replay"), null);
  } finally { f.cleanup(); }
});

test("expiry sweep works without engine availability and only writes when changed", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "request-1", scope, files: sources, expiresAt: 1100 });
    f.tick(101);
    assert.deepEqual(await f.queue.sweepExpired(), { expired: 1, uncertain: 0, reclaimed: 0 });
    assert.equal(f.queue.get("request-1").state, "expired");
    const previous = lstatSync(join(f.rootPath, "queue.json"));
    assert.deepEqual(await f.queue.sweepExpired(), { expired: 0, uncertain: 0, reclaimed: 0 });
    assert.equal(lstatSync(join(f.rootPath, "queue.json")).ino, previous.ino);
  } finally { f.cleanup(); }
});

test("a request cannot cross the application barrier after its expiry", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "request-1", scope, files: sources, expiresAt: 1100 });
    const claim = await f.queue.claimNext({ scope, currentRevision: 0, workerId: "compiler" });
    f.tick(101);
    await assert.rejects(f.queue.transition("request-1", { claimToken: claim.claim.token, state: "applying", scope, currentRevision: 0, preparedPatch: { patchDigest: "request-1" } }), { code: "QUEUE_REQUEST_EXPIRED" });
    await f.queue.sweepExpired();
    assert.equal(f.queue.get("request-1").state, "expired");
  } finally { f.cleanup(); }
});

test("read-only access needs no lock authority; mutation requires an explicit identity port", async () => {
  const f = fixture();
  try {
    const readOnly = createLiveDeliveryQueue({ rootPath: f.rootPath });
    assert.deepEqual(readOnly.list(), []);
    await assert.rejects(readOnly.enqueue({ requestId: "request", scope, files: sources }), { code: "QUEUE_LOCK_AUTHORITY_REQUIRED" });
    assert.throws(() => lstatSync(f.rootPath), { code: "ENOENT" });
    assert.throws(() => createLiveDeliveryQueue({ rootPath: "" }), { code: "QUEUE_ROOT_INVALID" });
  } finally { f.cleanup(); }
});

function noEffectReceipt(reasonCode = "PREPARED_WAITING_FOR_FOREGROUND", attemptId) {
  return { attemptId, requestId: "request-1", patchDigest: "request-1", sessionIdentity: scope.sessionIdentity, binaryIdentity: scope.binaryIdentity, admitted: false, applied: false, reasonCode };
}

test("verified pre-admission background rejection releases only its current apply attempt", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const firstToken = await begin(f);
    const released = await f.queue.releaseNoEffect("request-1", { claimToken: firstToken, scope, receipt: noEffectReceipt(undefined, firstToken), verified: true });
    assert.equal(released.state, "waiting-for-foreground");
    assert.equal(released.claim, null);
    assert.equal(released.proof, null);
    assert.equal(released.preparedPatch.patchDigest, "request-1");
    const secondToken = await begin(f);
    assert.notEqual(secondToken, firstToken);
    await assert.rejects(f.queue.releaseNoEffect("request-1", { claimToken: firstToken, scope, receipt: noEffectReceipt(undefined, firstToken), verified: true }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    await f.queue.releaseNoEffect("request-1", { claimToken: secondToken, scope, receipt: noEffectReceipt("PREPARED_ROOT_NOT_READY", secondToken), verified: true });
    assert.equal(f.queue.get("request-1").reasonCode, "PREPARED_ROOT_NOT_READY");
  } finally { f.cleanup(); }
});

test("no-effect release rejects forged, mismatched, partial, generic and unverified responses", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    const base = noEffectReceipt(undefined, token);
    const invalid = [
      null, {}, { ...base, admitted: undefined }, { ...base, admitted: true },
      { ...base, applied: true }, { ...base, applied: 0 }, { ...base, requestId: "other" },
      { ...base, patchDigest: "other" }, { ...base, binaryIdentity: "other" },
      { ...base, sessionIdentity: "other" }, { ...base, attemptId: "stale-attempt" }, { ...base, reasonCode: "PATCH_TIMEOUT" },
      { ...base, partialApplication: true }, { ...base, dynamic_replacements: 1 },
      { ...base, refreshed: true }, { ...base, error: "transport failure" },
    ];
    for (const receipt of invalid) {
      await assert.rejects(f.queue.releaseNoEffect("request-1", { claimToken: token, scope, receipt, verified: true }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    }
    await assert.rejects(f.queue.releaseNoEffect("request-1", { claimToken: token, scope, receipt: base }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    await assert.rejects(f.queue.releaseNoEffect("request-1", { scope, receipt: base, verified: true }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    await assert.rejects(f.queue.releaseNoEffect("request-1", { claimToken: token, scope: { ...scope, binaryIdentity: "other" }, receipt: base, verified: true }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    assert.equal(f.queue.get("request-1").state, "applying");
  } finally { f.cleanup(); }
});

test("verified no-effect evidence can resolve uncertainty, but never a proven application", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    f.tick(120_001); await f.queue.sweepExpired();
    assert.equal(f.queue.get("request-1").state, "uncertain");
    await f.queue.releaseNoEffect("request-1", { claimToken: token, scope, receipt: noEffectReceipt(undefined, token), verified: true });
    const nextToken = await begin(f);
    await f.queue.transition("request-1", { claimToken: nextToken, state: "applied", proof: proof("request-1", 1, false) });
    f.tick(120_001); await f.queue.sweepExpired();
    await assert.rejects(f.queue.releaseNoEffect("request-1", { claimToken: nextToken, scope, receipt: noEffectReceipt(undefined, nextToken), verified: true }), { code: "QUEUE_NO_EFFECT_REJECTED" });
    assert.equal(f.queue.get("request-1").proof.applied, true);
  } finally { f.cleanup(); }
});

test("expired no-effect requests become expired rather than retryable", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "request-1", scope, files: sources, expiresAt: 1100 });
    await prepare(f); const token = await begin(f);
    f.tick(101); await f.queue.sweepExpired();
    assert.equal(f.queue.get("request-1").state, "uncertain");
    const resolved = await f.queue.releaseNoEffect("request-1", { claimToken: token, scope, receipt: noEffectReceipt(undefined, token), verified: true });
    assert.equal(resolved.state, "expired");
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "no-retry" }), null);
  } finally { f.cleanup(); }
});

test("expired predecessor and GC cannot replace a binary's original source baseline", async () => {
  const f = fixture();
  try {
    const original = 'struct Card { func first() -> Int { 0 }; func second() -> Int { 0 } }';
    const intermediate = 'struct Card { func first() -> Int { 1 }; func second() -> Int { 0 } }';
    const desired = 'struct Card { func first() -> Int { 1 }; func second() -> Int { 2 } }';
    await f.queue.enqueue({ requestId: "a", scope, files: [{ path: "Card.swift", beforeSource: original, afterSource: intermediate }], expiresAt: 1100 });
    await f.queue.enqueue({ requestId: "b", scope, files: [{ path: "Card.swift", beforeSource: intermediate, afterSource: desired }] });
    f.tick(101); await f.queue.sweepExpired();
    assert.equal(f.queue.get("a").state, "expired");
    const otherScope = { ...scope, appIdentity: "other-app", binaryIdentity: "other-binary" };
    await f.queue.enqueue({ requestId: "gc", scope: otherScope, files: [{ path: "Other.swift", beforeSource: "other-original", afterSource: "other-new" }] });
    const rebound = await f.reopen().rebaseForProcess({ scope: { ...scope, sessionIdentity: "relaunch" }, verified: true, currentRevision: 0, newRequestId: "replay" });
    assert.equal(rebound.record.files[0].beforeSource, original);
    assert.equal(rebound.record.files[0].afterSource, desired);
    const retained = await f.fileStore.readJSON(join(f.rootPath, "queue.json"));
    const baseline = retained.binaryBaselines.find((item) => item.scope.binaryIdentity === scope.binaryIdentity);
    assert.equal(baseline.files[0].beforeSource, original);
    f.tick(24 * 60 * 60 * 1000 + 1);
    await f.queue.enqueue({ requestId: "gc-again", scope: otherScope, files: [{ path: "Other.swift", beforeSource: "other-new", afterSource: "other-latest" }] });
    const pruned = await f.fileStore.readJSON(join(f.rootPath, "queue.json"));
    assert.equal(pruned.binaryBaselines.some((item) => item.scope.binaryIdentity === scope.binaryIdentity), false);
  } finally { f.cleanup(); }
});

test("a missing original binary baseline cannot be guessed from an intermediate snapshot", async () => {
  const f = fixture();
  try {
    await queued(f);
    const path = join(f.rootPath, "queue.json");
    const journal = await f.fileStore.readJSON(path);
    journal.binaryBaselines = [];
    await f.fileStore.writeJSON(path, journal, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    await assert.rejects(f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "relaunch" }, verified: true, currentRevision: 0, newRequestId: "replay" }), { code: "QUEUE_REBASE_BASELINE_UNAVAILABLE" });
    await assert.rejects(f.queue.enqueue({ requestId: "intermediate", scope, files: [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "latest" }] }), { code: "QUEUE_REBASE_BASELINE_UNAVAILABLE" });
    assert.equal(f.queue.get("request-1").state, "queued");
    assert.equal(f.queue.get("replay"), null);
  } finally { f.cleanup(); }
});

test("near-expiry process rebase cannot extend accepted intent or marker lifetime", async () => {
  const f = fixture();
  try {
    await f.queue.enqueue({ requestId: "request-1", scope, files: sources, expiresAt: 1100 });
    f.tick(50);
    const newScope = { ...scope, sessionIdentity: "relaunch" };
    await assert.rejects(f.queue.rebaseForProcess({ scope: newScope, verified: true, currentRevision: 0, newRequestId: "too-long", expiresAt: 1101 }), { code: "QUEUE_EXPIRY_INVALID" });
    assert.equal(f.queue.get("request-1").state, "queued");
    assert.equal(f.queue.get("too-long"), null);
    const result = await f.queue.rebaseForProcess({ scope: newScope, verified: true, currentRevision: 0, newRequestId: "replay" });
    assert.equal(result.record.expiresAt, 1100);
    const journal = await f.fileStore.readJSON(join(f.rootPath, "queue.json"));
    assert.equal(journal.processRebases[0].expiresAt, 1100);
    f.tick(51); await f.queue.sweepExpired();
    assert.equal(f.queue.get("replay").state, "expired");
    assert.equal(await f.queue.claimNext({ scope: newScope, currentRevision: 0, workerId: "late" }), null);
  } finally { f.cleanup(); }
});

test("a fresh matching process recovers an uncertain predecessor and latest queued successor without inventing proof", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "uncertain", reasonCode: "QUEUE_APPLY_UNCONFIRMED" });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "latest useful source" }]);
    await prepare(f, "request-2");
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "same-process" }), null);
    const newScope = { ...scope, sessionIdentity: "verified-fresh-process" };
    const recovery = await f.reopen().rebaseForProcess({ scope: newScope, verified: true, currentRevision: 0, newRequestId: "recovery" });
    assert.deepEqual(recovery.supersededRequestIds, ["request-1", "request-2"]);
    assert.equal(recovery.record.baselineRevision, 0);
    assert.equal(recovery.record.predecessorRequestId, "");
    assert.equal(recovery.record.files[0].beforeSource, sources[0].beforeSource);
    assert.equal(recovery.record.files[0].afterSource, "latest useful source");
    const prior = f.queue.get("request-1");
    assert.equal(prior.state, "superseded"); assert.equal(prior.supersededState, "uncertain");
    assert.equal(prior.proof, null); assert.equal(prior.scope.sessionIdentity, scope.sessionIdentity);
    await assert.rejects(f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true }), { code: "QUEUE_RECEIPT_REJECTED" });
    assert.deepEqual(f.queue.desiredStates(), []);
    const claim = await f.queue.claimNext({ scope: newScope, currentRevision: 0, workerId: "compiler" });
    assert.equal(claim.requestId, "recovery");
  } finally { f.cleanup(); }
});

test("fresh-process recovery waits for a prior applying worker's live lease", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); await begin(f);
    const input = { scope: { ...scope, sessionIdentity: "fresh" }, verified: true, currentRevision: 0, newRequestId: "recovery" };
    await assert.rejects(f.queue.rebaseForProcess(input), { code: "QUEUE_REBASE_BLOCKED" });
    f.tick(120_001);
    const recovery = await f.queue.rebaseForProcess(input);
    assert.equal(recovery.record.scope.sessionIdentity, "fresh");
    assert.equal(f.queue.get("request-1").supersededState, "uncertain");
    assert.equal(f.queue.get("request-1").proof, null);
  } finally { f.cleanup(); }
});

test("confirmed desired sources survive request expiry, garbage collection and helper reopen", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    assert.equal(f.queue.desiredStates()[0].files[0].afterSource, sources[0].afterSource);
    f.tick(24 * 60 * 60 * 1000 + 1);
    const otherScope = { ...scope, binaryIdentity: "different-binary" };
    await f.queue.enqueue({ requestId: "gc", scope: otherScope, files: sources });
    assert.equal(f.queue.get("request-1"), null);
    const reopened = f.reopen();
    const desired = reopened.desiredStates({ scope })[0];
    assert.equal(desired.confirmation, "refreshed");
    assert.deepEqual(desired.proof, proof());
    const input = { scope: { ...scope, sessionIdentity: "relaunch-after-expiry" }, verified: true, currentRevision: 0, newRequestId: "restore" };
    const recovery = await reopened.rebaseForProcess(input);
    assert.equal(recovery.record.files[0].beforeSource, sources[0].beforeSource);
    assert.equal(recovery.record.files[0].afterSource, sources[0].afterSource);
    assert.equal(recovery.record.expiresAt - recovery.record.createdAt, 24 * 60 * 60 * 1000);
  } finally { f.cleanup(); }
});

test("confirmed label removal remains durable and old receipts cannot restore the label", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); let token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: sources[0].beforeSource }]);
    await prepare(f, "request-2"); token = await begin(f, "request-2", 1);
    await f.queue.transition("request-2", { claimToken: token, state: "refreshed", proof: proof("request-2", 2) });
    await f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true });
    assert.equal(f.reopen().desiredStates()[0].files[0].afterSource, sources[0].beforeSource);
    assert.equal(f.queue.desiredStates()[0].sourceRequestId, "request-2");
    f.tick(24 * 60 * 60 * 1000 + 1);
    const recovery = await f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "new" }, verified: true, currentRevision: 0 });
    assert.equal(recovery.netNoChange, true); assert.equal(recovery.record, null);
    assert.equal(f.queue.desiredStates()[0].confirmation, "verified-binary-baseline");
    assert.equal(f.queue.desiredStates()[0].proof, null);
    assert.equal(f.queue.desiredStates()[0].files[0].afterSource, sources[0].beforeSource);
  } finally { f.cleanup(); }
});

test("a cumulative recovery retains baseline tombstones for removed files alongside another live edit", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); let token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: sources[0].beforeSource }, { path: "Other.swift", beforeSource: "old", afterSource: "useful" }]);
    const newScope = { ...scope, sessionIdentity: "fresh" };
    const { record } = await f.queue.rebaseForProcess({ scope: newScope, verified: true, currentRevision: 0, newRequestId: "restore" });
    assert.deepEqual(record.files.map((file) => file.path), ["Other.swift"]);
    assert.equal(record.desiredSnapshots.find((file) => file.path === "Card.swift").afterSource, sources[0].beforeSource);
    let claim = await f.queue.claimNext({ scope: newScope, currentRevision: 0, workerId: "compiler" });
    await f.queue.transition("restore", { claimToken: claim.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: "restore" } });
    claim = await f.queue.claimNext({ scope: newScope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "applier" });
    token = claim.claim.token;
    await f.queue.transition("restore", { claimToken: token, state: "applying", scope: newScope, currentRevision: 0 });
    await f.queue.transition("restore", { claimToken: token, state: "refreshed", proof: { ...proof("restore"), sessionIdentity: "fresh" } });
    assert.equal(f.queue.desiredStates()[0].files.find((file) => file.path === "Card.swift").afterSource, sources[0].beforeSource);
    assert.equal(f.queue.get("request-1").restorationRequestId, "restore");
    assert.deepEqual(f.queue.get("request-1").proof, proof());
  } finally { f.cleanup(); }
});

test("expired pending intent never becomes durable desired state during fresh-process recovery", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await f.queue.enqueue({ requestId: "request-2", scope, files: [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "never confirmed" }], expiresAt: 1100 });
    f.tick(101);
    const { record } = await f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "fresh" }, verified: true, currentRevision: 0 });
    assert.equal(record.files[0].afterSource, sources[0].afterSource);
    assert.equal(f.queue.desiredStates()[0].files[0].afterSource, sources[0].afterSource);
  } finally { f.cleanup(); }
});

test("revocation fences confirmed and ambiguous history without falsifying its evidence", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); let token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "ambiguous" }]);
    await prepare(f, "request-2"); token = await begin(f, "request-2", 1);
    await assert.rejects(f.queue.revokeDesired({ scope }), { code: "QUEUE_REVOKE_BLOCKED" });
    await f.queue.transition("request-2", { claimToken: token, state: "uncertain" });
    const revoked = await f.queue.revokeDesired({ scope });
    assert.equal(revoked.revoked, true); assert.equal(revoked.confirmedThroughSequence, 2);
    assert.deepEqual(f.reopen().desiredStates(), []);
    assert.equal(f.queue.get("request-2").state, "uncertain");
    assert.equal(f.queue.get("request-2").supersededState, undefined);
    assert.equal(f.queue.get("request-2").proof, null);
    await f.queue.reconcileReceipt("request-1", { scope, proof: proof(), verified: true });
    assert.deepEqual(f.queue.desiredStates(), []);
    const result = await f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "fresh" }, verified: true, currentRevision: 0 });
    assert.equal(result.netNoChange, true); assert.equal(result.record, null);
    assert.equal(f.queue.desiredStates({ includeRevoked: true })[0].revoked, true);
  } finally { f.cleanup(); }
});

test("schema-one confirmed history migrates in memory without touching journal bytes", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "refreshed", proof: proof() });
    const path = join(f.rootPath, "queue.json");
    const legacy = await f.fileStore.readJSON(path); delete legacy.desiredStates;
    await f.fileStore.writeJSON(path, legacy, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    const bytes = await f.fileStore.readText(path); const stats = lstatSync(path);
    assert.equal(f.reopen().desiredStates()[0].files[0].afterSource, sources[0].afterSource);
    assert.equal(await f.fileStore.readText(path), bytes); assert.equal(lstatSync(path).ino, stats.ino);
    f.tick(24 * 60 * 60 * 1000 + 1);
    const { record } = await f.queue.rebaseForProcess({ scope: { ...scope, sessionIdentity: "fresh" }, verified: true, currentRevision: 0 });
    assert.equal(record.files[0].afterSource, sources[0].afterSource);
    assert.equal((await f.fileStore.readJSON(path)).desiredStates.length, 1);
  } finally { f.cleanup(); }
});

test("expired ambiguity still fences new effects in the same process after revocation and GC", async () => {
  const f = fixture();
  try {
    await queued(f); await prepare(f); const token = await begin(f);
    await f.queue.transition("request-1", { claimToken: token, state: "uncertain" });
    await f.queue.revokeDesired({ scope });
    f.tick(24 * 60 * 60 * 1000 + 1);
    await queued(f, "request-2", [{ ...sources[0], beforeSource: sources[0].afterSource, afterSource: "new explicit intent" }]);
    await prepare(f, "request-2");
    assert.equal(f.queue.get("request-1").state, "uncertain");
    assert.equal(await f.queue.claimNext({ scope, currentRevision: 1, deviceConnected: true, foreground: true, workerId: "same-process" }), null);
    assert.equal(f.queue.get("request-2").reasonCode, "QUEUE_AMBIGUOUS_PREDECESSOR");
    const newScope = { ...scope, sessionIdentity: "fresh-process" };
    const { record } = await f.queue.rebaseForProcess({ scope: newScope, verified: true, currentRevision: 0, newRequestId: "fresh-request" });
    assert.equal(record.files[0].afterSource, "new explicit intent");
  } finally { f.cleanup(); }
});

test("split offline requests cannot exceed eventual cumulative recovery source limits", async () => {
  const f = fixture();
  try {
    const full = "a".repeat(1024 * 1024);
    const files = Array.from({ length: 4 }, (_, index) => ({ path: `File${index}.swift`, beforeSource: full, afterSource: `b${full.slice(1)}` }));
    await queued(f, "large-pending", files);
    await assert.rejects(queued(f, "too-large", [{ path: "File4.swift", beforeSource: full, afterSource: `c${full.slice(1)}` }]), { code: "QUEUE_LIMIT_REACHED" });
    assert.equal(f.queue.get("too-large"), null);
    assert.equal(f.queue.list().length, 1);
    assert.equal(f.queue.get("large-pending").state, "queued");
  } finally { f.cleanup(); }
});
