import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDeliveryQueue } from "../mac-helper/src/liveDeliveryQueue.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const scope = { project: "project", scheme: "Example", appIdentity: "app", binaryIdentity: "binary", sessionIdentity: "process-one" };
const file = { path: "/project/Screen.swift", beforeSource: "installed-screen", afterSource: "screen-with-stateful-component" };
const helper = { path: "/project/Helper.swift", beforeSource: "old-helper", afterSource: "new-helper" };
const hash = "a".repeat(64);
function origin(overrides = {}) {
  return { path: file.path, owner: "StateCard", module: "SwiftSimLivePatch_" + hash, sourceFile: "Replacement0.swift",
    layoutDigest: hash, modulePath: "/patches/queued_" + hash + "/SwiftSimLivePatch_" + hash + ".swiftmodule", moduleDigest: hash,
    artifactPath: "/artifacts/eval_injection_swift_sim_dynamic_" + hash + ".dylib", artifactDigest: hash,
    requestId: "first", processIdentity: scope.sessionIdentity, binaryIdentity: scope.binaryIdentity, resourceDigest: hash, ...overrides };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-stateful-queue-"));
  const rootPath = join(directory, "queue");
  const fileStore = new NodeAtomicFileStore(); let clock = 1_000; let id = 0;
  const identity = pid => pid === process.pid ? { startToken: "stateful-queue" } : null;
  const options = { rootPath, fileStore, lockManager: new NodeLockManager({ identity, fileStore }), now: () => clock, newId: () => `token-${++id}` };
  return { queue: createLiveDeliveryQueue(options), reopen: () => createLiveDeliveryQueue(options), rootPath, fileStore,
    tick(ms) { clock += ms; }, cleanup() { rmSync(directory, { recursive: true, force: true }); } };
}
async function enqueue(f, requestId, files = [file], binding = scope, revision = 0) {
  return f.queue.enqueue({ requestId, scope: binding, files, baselineRevision: revision });
}
async function prepare(f, requestId, metadata = { statefulComponentProtocol: 1, statefulOrigins: [origin()] }, binding = scope, revision = 0) {
  const claim = await f.queue.claimNext({ scope: binding, currentRevision: revision, workerId: "compiler" });
  assert.equal(claim.requestId, requestId);
  await f.queue.transition(requestId, { claimToken: claim.claim.token, state: "waiting-for-device", preparedPatch: { patchDigest: requestId, ...metadata } });
}
async function refresh(f, requestId, binding = scope, revision = 0) {
  const claim = await f.queue.claimNext({ scope: binding, currentRevision: revision, deviceConnected: true, foreground: true, workerId: "apply" });
  assert.equal(claim.requestId, requestId);
  await f.queue.transition(requestId, { claimToken: claim.claim.token, state: "applying", scope: binding, currentRevision: revision });
  await f.queue.transition(requestId, { claimToken: claim.claim.token, state: "refreshed", proof: { requestId, sessionIdentity: binding.sessionIdentity,
    binaryIdentity: binding.binaryIdentity, applied: true, refreshed: true, revision: revision + 1, patchDigest: requestId } });
}

test("stateful projection carries complete preceding consumers and exact process origins without changing accepted snapshots", async () => {
  const f = fixture();
  try {
    await enqueue(f, "first"); await prepare(f, "first");
    const second = await enqueue(f, "second", [helper]);
    const projected = f.reopen().compilationRecord("second");
    assert.equal(projected.files.length, 2);
    assert.equal(projected.files.find(value => value.path === file.path).installedBaseline, file.beforeSource);
    assert.deepEqual(projected.statefulOrigins, [origin()]);
    assert.deepEqual(f.queue.get("second"), second);
    assert.equal(f.queue.get("second").statefulOrigins, undefined);
    const poll = f.queue.pollingSnapshot();
    assert.deepEqual(poll.statefulOrigins, [origin()]);
    assert(!JSON.stringify(poll).includes(file.afterSource));
    assert(!JSON.stringify(poll).includes(helper.afterSource));
    poll.statefulOrigins[0].layoutDigest = "caller-mutated";
    assert.deepEqual(f.queue.pollingSnapshot().statefulOrigins, [origin()]);
  } finally { f.cleanup(); }
});

test("confirmed stateful origins survive request GC and unrelated edits but are regenerated in a fresh process", async () => {
  const f = fixture();
  try {
    await enqueue(f, "first"); await prepare(f, "first"); await refresh(f, "first");
    assert.deepEqual(f.queue.desiredStates()[0].statefulOrigins, [origin()]);
    assert.equal(f.queue.desiredStates()[0].requiresCohort, true);
    f.tick(24 * 60 * 60 * 1000 + 1);
    await enqueue(f, "second", [helper], scope, 1);
    assert.equal(f.queue.get("first"), null);
    assert.deepEqual(f.reopen().compilationRecord("second").statefulOrigins, [origin()]);
    assert.deepEqual(f.reopen().pollingSnapshot().statefulOrigins, [origin()]);
    await prepare(f, "second", {}, scope, 1); await refresh(f, "second", scope, 1);
    assert.deepEqual(f.queue.desiredStates()[0].statefulOrigins, [origin()], "a nonstateful unrelated edit does not discard native type identity");
    const fresh = { ...scope, sessionIdentity: "process-two" };
    const recovery = await f.queue.rebaseForProcess({ scope: fresh, verified: true, currentRevision: 0, newRequestId: "recovery" });
    assert.equal(recovery.record.files.length, 2);
    assert.equal(f.reopen().compilationRecord("recovery").statefulOrigins, undefined, "a new address space must not import a dead process's pinned types");
    const freshOrigin = origin({ requestId: "recovery", processIdentity: fresh.sessionIdentity });
    await prepare(f, "recovery", { statefulComponentProtocol: 1, statefulOrigins: [freshOrigin] }, fresh);
    await refresh(f, "recovery", fresh);
    assert.deepEqual(f.queue.desiredStates()[0].statefulOrigins, [freshOrigin]);
  } finally { f.cleanup(); }
});

test("restoration, explicit replacement lineage and revocation release desired component metadata", async () => {
  const f = fixture();
  try {
    await enqueue(f, "first"); await prepare(f, "first"); await refresh(f, "first");
    await enqueue(f, "replace", [{ ...file, beforeSource: file.afterSource, afterSource: "plain-screen" }], scope, 1);
    await prepare(f, "replace", { statefulComponentProtocol: 1, statefulOrigins: [] }, scope, 1);
    await refresh(f, "replace", scope, 1);
    assert.equal(f.queue.desiredStates()[0].statefulOrigins, undefined);
    await enqueue(f, "undo", [{ ...file, beforeSource: "plain-screen", afterSource: file.beforeSource }], scope, 2);
    await prepare(f, "undo", { statefulComponentProtocol: 1, statefulOrigins: [origin()] }, scope, 2);
    await refresh(f, "undo", scope, 2);
    assert.equal(f.queue.desiredStates()[0].statefulOrigins, undefined, "returning to installed code clears desired lineage even if an artifact carried old metadata");
    await f.queue.revokeDesired({ scope });
    assert.equal(f.queue.desiredStates({ includeRevoked: true })[0].statefulOrigins, undefined);
  } finally { f.cleanup(); }
});

test("prepared component metadata rejects malformed protocol, scope, duplicates and unbounded lineage before publication", async () => {
  for (const metadata of [
    { statefulOrigins: [origin()] },
    { statefulComponentProtocol: 2, statefulOrigins: [] },
    { statefulComponentProtocol: 1, statefulOrigins: [origin({ processIdentity: "foreign-process" })] },
    { statefulComponentProtocol: 1, statefulOrigins: [origin({ binaryIdentity: "foreign-binary" })] },
    { statefulComponentProtocol: 1, statefulOrigins: [origin(), origin()] },
    { statefulComponentProtocol: 1, statefulOrigins: Array.from({ length: 33 }, (_, index) => origin({ owner: "Card" + index })) },
    { statefulComponentProtocol: 1, statefulOrigins: [origin({ requestId: "not a request identifier" })] },
  ]) {
    const f = fixture();
    try {
      await enqueue(f, "first");
      await assert.rejects(prepare(f, "first", metadata), { code: "QUEUE_PATCH_INVALID" });
      assert.equal(f.queue.get("first").preparedPatch, null);
    } finally { f.cleanup(); }
  }
});

test("journal validation rejects tampered desired and prepared component lineage", async () => {
  for (const location of ["desired", "prepared"]) {
    const f = fixture();
    try {
      await enqueue(f, "first"); await prepare(f, "first"); await refresh(f, "first");
      const path = join(f.rootPath, "queue.json"), journal = f.fileStore.readJSONSync(path);
      const origins = location === "desired" ? journal.desiredStates[0].statefulOrigins : journal.records[0].preparedPatch.statefulOrigins;
      origins[0].processIdentity = "foreign-process";
      f.fileStore.writeJSONSync(path, journal, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
      assert.throws(() => f.reopen().list(), { code: "QUEUE_JOURNAL_INVALID" });
    } finally { f.cleanup(); }
  }
});

test("bounded desired-lineage reserve rejects native admission before the journal could overflow after refresh", async () => {
  const f = fixture();
  try {
    await enqueue(f, "first"); await prepare(f, "first");
    const claim = await f.queue.claimNext({ scope, currentRevision: 0, deviceConnected: true, foreground: true, workerId: "apply" });
    const path = join(f.rootPath, "queue.json"), journal = f.fileStore.readJSONSync(path);
    journal.padding = "x".repeat(f.queue.limits.journalBytes - Buffer.byteLength(JSON.stringify(journal)) - 50_000);
    f.fileStore.writeJSONSync(path, journal, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    await assert.rejects(f.queue.transition("first", { claimToken: claim.claim.token, state: "applying", scope, currentRevision: 0 }), { code: "QUEUE_LIMIT_REACHED" });
    assert.equal(f.queue.get("first").state, "waiting-for-device");
    journal.padding = journal.padding.slice(70_000);
    f.fileStore.writeJSONSync(path, journal, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    await f.queue.transition("first", { claimToken: claim.claim.token, state: "applying", scope, currentRevision: 0 });
    await f.queue.transition("first", { claimToken: claim.claim.token, state: "refreshed", proof: { requestId: "first", sessionIdentity: scope.sessionIdentity,
      binaryIdentity: scope.binaryIdentity, applied: true, refreshed: true, revision: 1, patchDigest: "first" } });
    assert.deepEqual(f.queue.desiredStates()[0].statefulOrigins, [origin()]);
    assert(Buffer.byteLength(f.fileStore.readTextSync(path)) <= f.queue.limits.journalBytes);
  } finally { f.cleanup(); }
});

test("added State carries its source cohort through helper-only updates and desired-state GC",async()=>{
  const f=fixture();
  try {
    await enqueue(f,"slots");let r=f.queue.get("slots");
    await prepare(f,"slots",{addedStateProtocol:1,addedStateGeneration:r.sequence});
    await enqueue(f,"helper",[helper]);
    assert.equal(f.queue.compilationRecord("helper").files.length,2);
    assert.equal(f.queue.compilationRecord("helper").statefulOrigins,undefined);
    await refresh(f,"slots");r=f.queue.get("helper");
    await prepare(f,"helper",{addedStateProtocol:1,addedStateGeneration:r.sequence},scope,1);await refresh(f,"helper",scope,1);
    assert.equal(f.queue.desiredStates()[0].requiresCohort,true);
    f.tick(24*60*60*1000+1);
    await enqueue(f,"later",[{...helper,beforeSource:helper.afterSource,afterSource:"latest-helper"}],scope,2);
    assert.equal(f.queue.get("slots"),null);
    const compiled=f.reopen().compilationRecord("later");
    assert.equal(compiled.files.length,2);assert.equal(compiled.files.find(x=>x.path===file.path).afterSource,file.afterSource);
    assert.equal(f.queue.pollingSnapshot().statefulOrigins.length,0,"slots store no user values or module origins in the journal");
  }finally{f.cleanup();}
});

test("added State protocol and generation are validated against the immutable request sequence",async()=>{
 for(const metadata of [{addedStateProtocol:2,addedStateGeneration:1},{addedStateProtocol:1},{addedStateGeneration:1},{addedStateProtocol:1,addedStateGeneration:0},{addedStateProtocol:1,addedStateGeneration:2}]){
  const f=fixture();try{
   await enqueue(f,"slots");const claim=await f.queue.claimNext({scope,currentRevision:0,workerId:"compiler"});
   await assert.rejects(f.queue.transition("slots",{claimToken:claim.claim.token,state:"waiting-for-device",preparedPatch:{patchDigest:"slots",...metadata}}),{code:"QUEUE_PATCH_INVALID"});
   assert.equal(f.queue.get("slots").preparedPatch,null);
  }finally{f.cleanup();}
 }
});
