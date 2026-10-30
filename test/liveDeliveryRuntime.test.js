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

const original = 'struct Card { var first: String { "old" }; var second: String { "old" } }';
const firstEdit = original.replace('first: String { "old" }', 'first: String { "new" }');
const secondEdit = firstEdit.replace('second: String { "old" }', 'second: String { "new" }');
const sha = (value) => createHash("sha256").update(value).digest("hex");

test("a new request after expired history uses the fresh process revision and qualified original source", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    await f.service.enqueue({ files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.state.revision, 1);
    f.advance(24 * 60 * 60 * 1000 + 1);
    await f.queue.sweepExpired();
    f.state.scope.sessionIdentity = "fixture-process-new"; f.state.revision = 0;
    const response = await f.service.enqueue({ files: f.files(firstEdit, secondEdit) });
    const record = f.queue.get(response.delivery.requestId);
    assert.equal(record.baselineRevision, 0); assert.equal(record.files[0].beforeSource, firstEdit);
    assert.equal(record.files[0].afterSource, secondEdit);
    assert.equal(f.queue.get(record.predecessorRequestId).files[0].beforeSource, original);
    await f.service.runOnce(); await f.service.runOnce(); await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.service.status(record.requestId).outcome, "hot-reloaded");
  } finally { f.cleanup(); }
});

test("a lost old-process acknowledgement and its successor recover cumulatively only in a verified fresh process", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    f.adapter.apply = async (record) => { await apply(record); f.receipts.clear(); return null; };
    await f.service.enqueue({ requestId: "request-lost-a", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.queue.get("request-lost-a").state, "uncertain");
    await f.service.enqueue({ requestId: "request-successor-a", files: f.files(firstEdit, secondEdit) });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.queue.get("request-successor-a").reasonCode, "QUEUE_PREDECESSOR_PENDING");
    assert.equal(f.calls.apply.length, 1);
    // Same process reconnect/foreground changes cannot erase admission doubt.
    f.state.connected = false; await f.runtime().runOnce();
    f.state.connected = true; await f.runtime().runOnce();
    assert.equal(f.calls.apply.length, 1);
    // A new authenticated nonce with nonzero revision has no fresh baseline.
    f.state.scope.sessionIdentity = "fixture-process-nonzero";
    await f.runtime().runOnce();
    assert.equal(f.calls.apply.length, 1);
    f.state.scope.sessionIdentity = "fixture-process-new"; f.state.revision = 0;
    f.adapter.apply = apply;
    const restarted = f.runtime();
    await restarted.runOnce(); await restarted.runOnce(); await restarted.runOnce();
    const latest = f.calls.apply.at(-1);
    assert.equal(latest.files[0].beforeSource, original);
    assert.equal(latest.files[0].afterSource, secondEdit);
    assert.equal(latest.scope.sessionIdentity, "fixture-process-new");
    assert.equal(latest.baselineRevision, 0);
    assert.equal(f.calls.apply.length, 2);
    assert.equal(restarted.status("request-successor-a").outcome, "hot-reloaded");
    assert.equal(f.queue.get("request-lost-a").proof, null);
  } finally { f.cleanup(); }
});

test("confirmed desired source survives expiry, helper absence and repeated app relaunches without resending", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    await f.service.enqueue({ requestId: "request-durable", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    await f.service.enqueue({ requestId: "request-removal", files: f.files(firstEdit, original.replace('second: String { "old" }', 'second: String { "new" }')) });
    await f.service.runOnce(); await f.service.runOnce();
    const desired = f.queue.desiredStates()[0].files[0].afterSource;
    assert.doesNotMatch(desired, /first: String \{ "new"/);
    f.advance(24 * 60 * 60 * 1000 + 1);
    f.state.scope.sessionIdentity = "fixture-after-eviction"; f.state.revision = 0;
    f.state.connected = false; f.state.foreground = false;
    f.state.engineAvailable = false;
    const resumed = f.runtime();
    await resumed.runOnce();
    assert.equal(f.calls.apply.length, 2);
    f.state.engineAvailable = true; f.state.connected = true;
    await resumed.runOnce(); await resumed.runOnce();
    assert.equal(f.calls.apply.length, 2);
    const restorationId = f.queue.list().findLast((item) => item.scope.sessionIdentity === f.state.scope.sessionIdentity).requestId;
    assert.equal(resumed.status(restorationId).outcome, "queued");
    f.state.foreground = true;
    await resumed.runOnce();
    assert.equal(f.calls.apply.at(-1).files[0].beforeSource, original);
    assert.equal(f.calls.apply.at(-1).files[0].afterSource, desired);
    assert.equal(resumed.status(restorationId).outcome, "hot-reloaded");
    // A helper restart and foreground transition in the same app process do not
    // apply again. A later force-quit-equivalent nonce restores the same source.
    f.state.foreground = false; await f.runtime().runOnce();
    f.state.foreground = true; await f.runtime().runOnce();
    assert.equal(f.calls.apply.length, 3);
    f.state.scope.sessionIdentity = "fixture-after-force-quit"; f.state.revision = 0;
    const again = f.runtime();
    await again.runOnce(); await again.runOnce(); await again.runOnce();
    assert.equal(f.calls.apply.length, 4);
    assert.equal(f.calls.apply.at(-1).files[0].afterSource, desired);
    assert.equal(again.status(restorationId).outcome, "hot-reloaded");
    assert.equal(f.state.revision, 1);
  } finally { f.cleanup(); }
});

test("revoking durable restoration leaves current effects alone and prevents future automatic replay", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    await f.service.enqueue({ requestId: "request-revoke", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal((await f.service.revokeDesired()).revoked, true);
    f.state.scope.sessionIdentity = "fixture-after-revoke"; f.state.revision = 0;
    await f.runtime().runOnce(); await f.runtime().runOnce();
    assert.equal(f.calls.apply.length, 1);
    assert.equal(f.queue.desiredStates().length, 0);
  } finally { f.cleanup(); }
});

test("insufficient journal capacity for desired publication fails before native admission", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const queue = { ...f.queue, async transition(requestId, options) {
      if (options.state === "applying") throw Object.assign(new Error("publication reserve exhausted"), { code: "QUEUE_LIMIT_REACHED" });
      return f.queue.transition(requestId, options);
    } };
    const service = createLiveDeliveryRuntime({ queue, adapter: f.adapter, now: () => 1_000_000 });
    await service.enqueue({ requestId: "request-capacity", files: f.files() });
    await service.runOnce(); await service.runOnce();
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.queue.get("request-capacity").state, "failed");
    assert.equal(service.status("request-capacity").reasonCode, "QUEUE_LIMIT_REACHED");
  } finally { f.cleanup(); }
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-runtime-test-"));
  const path = join(directory, "Card.swift");
  const scope = { project: "fixture-project", scheme: "Example", appIdentity: "fixture-app", binaryIdentity: "fixture-binary", sessionIdentity: "fixture-process-one" };
  let clock = 1_000_000;
  let sequence = 0;
  const store = new NodeAtomicFileStore();
  const lockManager = new NodeLockManager({ fileStore: store, identity: (pid) => pid === process.pid ? { startToken: "runtime-test-owner" } : null });
  const queueOptions = { rootPath: join(directory, "deliveries"), fileStore: store, lockManager, now: () => clock, newId: () => `fixture-token-${++sequence}` };
  const queue = createLiveDeliveryQueue(queueOptions);
  const state = { engineAvailable: true, matchesBinary: true, connected: false, foreground: false, rootReady: true, revision: 0, scope: { ...scope } };
  const calls = { prepare: [], apply: [], receipt: [] };
  const receipts = new Map();
  const adapter = {
    async binding() { return { scope: { ...state.scope }, verifiedProcess: state.connected && state.matchesBinary, revision: state.revision, sourceBaselines: { [path]: sha(original) } }; },
    async inspect() { return structuredClone(state); },
    async prepare(record) {
      calls.prepare.push(structuredClone(record));
      return { path: "fixture-owned-artifact", patchDigest: sha(record.snapshotDigest), mode: "swift-dynamic-replacement-bundle" };
    },
    async apply(record) {
      calls.apply.push(structuredClone(record));
      const result = proof(record, record.baselineRevision + 1);
      state.revision = result.revision;
      receipts.set(record.requestId, result);
      return result;
    },
    async receipt(record) { calls.receipt.push(record.requestId); return receipts.get(record.requestId) || null; },
  };
  function runtime() { return createLiveDeliveryRuntime({ queue: createLiveDeliveryQueue(queueOptions), adapter, workerId: `fixture-worker-${++sequence}`, now: () => clock }); }
  function proof(record, revision, refreshed = true) {
    return { requestId: record.requestId, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, patchDigest: record.preparedPatch.patchDigest, applied: true, refreshed, revision };
  }
  return {
    path, scope, state, calls, adapter, queue, receipts, proof, runtime,
    service: runtime(),
    files(beforeSource = original, afterSource = firstEdit) { return [{ path, beforeSource, afterSource }]; },
    advance(ms) { clock += ms; },
    cleanup() { rmSync(directory, { recursive: true, force: true }); },
  };
}

test("offline intent compiles once, waits durably and applies after foreground without a build or retry request", async () => {
  const f = fixture();
  try {
    const files = f.files();
    const pending = await f.service.enqueue({ requestId: "request-offline-0001", files });
    assert.equal(pending.outcome, "queued");
    files[0].afterSource = "an unqueued later edit";
    await f.service.runOnce();
    assert.equal(f.service.status("request-offline-0001").delivery.state, "waiting-for-device");
    assert.equal(f.calls.prepare[0].files[0].afterSource, firstEdit);
    await f.service.runOnce();
    assert.equal(f.calls.prepare.length, 1);
    assert.equal(f.calls.apply.length, 0);

    f.state.connected = true;
    await f.service.runOnce();
    assert.equal(f.service.status("request-offline-0001").delivery.state, "waiting-for-foreground");
    f.state.foreground = true;
    await f.service.runOnce();
    assert.equal(f.service.status("request-offline-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.prepare.length, 1);
    assert.equal(f.calls.apply.length, 1);
    assert.equal(f.state.revision, 1);
  } finally { f.cleanup(); }
});

test("foreground delivery depends on global app readiness, not which screen is visible", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    f.state.screen = "another-screen";
    await f.service.enqueue({ requestId: "request-screen-0001", files: f.files() });
    await f.service.runOnce();
    f.state.screen = "still-not-library";
    await f.service.runOnce();
    assert.equal(f.service.status("request-screen-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 1);
  } finally { f.cleanup(); }
});

test("a root that has not subscribed yet cannot receive an early patch", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true; f.state.rootReady = false;
    await f.service.enqueue({ requestId: "request-root-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.service.status("request-root-0001").delivery.state, "waiting-for-foreground");
    f.state.rootReady = true;
    await f.service.runOnce();
    assert.equal(f.service.status("request-root-0001").outcome, "hot-reloaded");
  } finally { f.cleanup(); }
});

test("a network interruption keeps the prepared artifact and resumes the same operation", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    await f.service.enqueue({ requestId: "request-network-0001", files: f.files() });
    await f.service.runOnce();
    const digest = f.queue.get("request-network-0001").preparedPatch.patchDigest;
    f.state.connected = false;
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.calls.prepare.length, 1); assert.equal(f.calls.apply.length, 0);
    f.state.connected = true;
    await f.service.runOnce();
    assert.equal(f.service.status("request-network-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply[0].preparedPatch.patchDigest, digest);
  } finally { f.cleanup(); }
});

test("authenticated no-admission foreground race waits and retries the same identity with a new attempt claim", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    let rejectBeforeAdmission = true;
    f.adapter.apply = async (record) => {
      if (!rejectBeforeAdmission) return apply(record);
      rejectBeforeAdmission = false;
      f.calls.apply.push(structuredClone(record));
      f.state.foreground = false;
      return { noEffect: {
        requestId: record.requestId, patchDigest: record.preparedPatch.patchDigest,
        sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity,
        attemptId: record.claim.token,
        admitted: false, applied: false, reasonCode: "PREPARED_WAITING_FOR_FOREGROUND",
      } };
    };
    await f.service.enqueue({ requestId: "request-race-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.queue.get("request-race-0001").state, "waiting-for-foreground");
    assert.equal(f.service.status("request-race-0001").outcome, "queued");
    await f.service.runOnce();
    assert.equal(f.calls.apply.length, 1);
    f.state.foreground = true;
    await f.service.runOnce();
    assert.equal(f.service.status("request-race-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 2);
    assert.equal(f.calls.apply[0].requestId, f.calls.apply[1].requestId);
    assert.equal(f.calls.apply[0].preparedPatch.patchDigest, f.calls.apply[1].preparedPatch.patchDigest);
    assert.notEqual(f.calls.apply[0].claim.token, f.calls.apply[1].claim.token);
    assert.equal(f.state.revision, 1);
  } finally { f.cleanup(); }
});

test("helper restart reconciles a lost acknowledgement without applying the edit twice", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    f.adapter.apply = async (record) => { await apply(record); throw new Error("transport interrupted after application"); };
    await f.service.enqueue({ requestId: "request-ack-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.queue.get("request-ack-0001").state, "uncertain");
    assert.equal(f.service.status("request-ack-0001").outcome, "failed");
    const restarted = f.runtime();
    await restarted.runOnce();
    assert.equal(restarted.status("request-ack-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 1);
    assert.deepEqual(f.calls.receipt, ["request-ack-0001"]);
  } finally { f.cleanup(); }
});

test("an existing admitted receipt can clear uncertainty after pending expiry without another apply", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    f.adapter.apply = async (record) => { await apply(record); throw new Error("lost reply"); };
    await f.service.enqueue({ requestId: "request-late-receipt", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    f.advance(24 * 60 * 60 * 1000 + 1);
    await f.runtime().runOnce();
    assert.equal(f.queue.get("request-late-receipt").state, "refreshed");
    assert.equal(f.queue.desiredStates()[0].files[0].afterSource, firstEdit);
    assert.equal(f.calls.apply.length, 1);
    assert.deepEqual(f.calls.receipt, ["request-late-receipt"]);
  } finally { f.cleanup(); }
});

test("an applied edit remains pending until its correlated refresh is proven", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    f.adapter.apply = async (record) => ({ ...await apply(record), refreshed: false });
    await f.service.enqueue({ requestId: "request-refresh-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    const pending = f.service.status("request-refresh-0001");
    assert.equal(pending.outcome, "queued"); assert.equal(pending.delivery.state, "applied");
    await f.runtime().runOnce();
    assert.equal(f.service.status("request-refresh-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 1);
  } finally { f.cleanup(); }
});

test("an unrelated proof cannot be presented as a successful current edit", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    const apply = f.adapter.apply;
    f.adapter.apply = async (record) => ({ ...await apply(record), requestId: "request-unrelated-0001" });
    await f.service.enqueue({ requestId: "request-proof-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.queue.get("request-proof-0001").state, "uncertain");
    assert.notEqual(f.service.status("request-proof-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 1);
  } finally { f.cleanup(); }
});

test("a different binary cannot inherit queued mutation authority", async () => {
  const f = fixture();
  try {
    await f.service.enqueue({ requestId: "request-binary-0001", files: f.files() });
    await f.service.runOnce();
    f.state.connected = true; f.state.foreground = true;
    f.state.matchesBinary = false; f.state.scope.binaryIdentity = "unrelated-binary";
    await f.service.runOnce(); await f.service.runOnce();
    assert.equal(f.calls.apply.length, 0);
    assert.equal(f.service.status("request-binary-0001").outcome, "queued");
  } finally { f.cleanup(); }
});

test("fresh app process receives a cumulative replay and original pending status follows its replacement", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    await f.service.enqueue({ requestId: "request-first-0001", files: f.files() });
    await f.service.runOnce(); await f.service.runOnce();
    f.state.connected = false; f.state.foreground = false;
    await f.service.enqueue({ requestId: "request-second-0001", files: f.files(firstEdit, secondEdit) });
    await f.service.runOnce();
    f.state.scope.sessionIdentity = "fixture-process-two";
    f.state.revision = 0; f.state.connected = true; f.state.foreground = true;
    await f.service.runOnce();
    const replacement = f.queue.get("request-second-0001").replacementRequestId;
    assert.ok(replacement);
    assert.equal(f.service.status("request-second-0001").delivery.requestId, replacement);
    await f.service.runOnce(); await f.service.runOnce();
    const replay = f.calls.prepare.at(-1);
    assert.equal(replay.files[0].beforeSource, original);
    assert.equal(replay.files[0].afterSource, secondEdit);
    assert.equal(replay.scope.sessionIdentity, "fixture-process-two");
    assert.equal(f.service.status("request-second-0001").outcome, "hot-reloaded");
    assert.equal(f.calls.apply.length, 2);
  } finally { f.cleanup(); }
});

test("first edit baseline is checked against the qualified Debug capture", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.service.enqueue({ requestId: "request-baseline-0001", files: f.files("unqualified before", firstEdit) }), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
    assert.equal(f.queue.list().length, 0);
    assert.equal(f.calls.prepare.length, 0);
  } finally { f.cleanup(); }
});

test("expiry is reconciled even while the engine is unavailable", async () => {
  const f = fixture();
  try {
    await f.service.enqueue({ requestId: "request-expiry-0001", files: f.files() });
    f.state.engineAvailable = false;
    f.advance(24 * 60 * 60 * 1_000 + 1);
    await f.service.runOnce();
    assert.equal(f.queue.get("request-expiry-0001").state, "expired");
    assert.equal(f.service.status("request-expiry-0001").outcome, "failed");
    assert.equal(f.calls.prepare.length, 0); assert.equal(f.calls.apply.length, 0);
  } finally { f.cleanup(); }
});

test("concurrent helper turns coalesce and public status omits private snapshots and binding", async () => {
  const f = fixture();
  try {
    await f.service.enqueue({ requestId: "request-coalesce-0001", files: f.files() });
    await Promise.all([f.service.runOnce(), f.service.runOnce(), f.service.runOnce()]);
    assert.equal(f.calls.prepare.length, 1);
    const envelope = JSON.stringify(f.service.status("request-coalesce-0001"));
    assert.doesNotMatch(envelope, /beforeSource|afterSource|snapshotDigest|fixture-owned-artifact|fixture-project|fixture-binary|fixture-process/);
    assert.ok(Buffer.byteLength(envelope) < 1_024);
  } finally { f.cleanup(); }
});

test("stopping cancels and drains in-flight preparation, releasing its claim without applying", async () => {
  const f = fixture();
  try {
    let preparationStarted;
    const started = new Promise((resolve) => { preparationStarted = resolve; });
    let observedSignal;
    let cancellationObserved = false;
    f.adapter.prepare = async (record, { cancellationSignal }) => {
      f.calls.prepare.push(structuredClone(record));
      observedSignal = cancellationSignal;
      preparationStarted();
      return new Promise((_, reject) => {
        cancellationSignal.addEventListener("abort", () => {
          cancellationObserved = true;
          reject(Object.assign(new Error("compiler cancelled"), { code: "ABORT_ERR" }));
        }, { once: true });
      });
    };
    await f.service.enqueue({ requestId: "request-stop-prepare-0001", files: f.files() });
    const turn = f.service.runOnce();
    await started;
    assert.equal(f.queue.get("request-stop-prepare-0001").state, "compiling");
    assert.ok(f.queue.get("request-stop-prepare-0001").claim);
    await f.service.stop();
    await turn;
    assert.equal(observedSignal.aborted, true);
    assert.equal(cancellationObserved, true);
    const record = f.queue.get("request-stop-prepare-0001");
    assert.equal(record.state, "waiting-for-device");
    assert.equal(record.claim, null);
    assert.equal(record.preparedPatch, null);
    assert.equal(record.reasonCode, "QUEUE_WORKER_STOPPED");
    assert.equal(f.calls.apply.length, 0);
    assert.deepEqual(await f.service.runOnce(), { processed: false });
    assert.equal(f.calls.prepare.length, 1);
    await f.service.stop();
  } finally { f.cleanup(); }
});

test("stopping while lifecycle admission is pending prevents later compile or apply", async () => {
  const f = fixture();
  try {
    let lockRequested;
    const waiting = new Promise((resolve) => { lockRequested = resolve; });
    let release;
    const admission = new Promise((resolve) => { release = resolve; });
    f.adapter.withLock = async (operation) => {
      lockRequested();
      await admission;
      return operation();
    };
    await f.service.enqueue({ requestId: "request-stop-lock-0001", files: f.files() });
    const turn = f.service.runOnce();
    await waiting;
    let stopped = false;
    const stopping = f.service.stop().then(() => { stopped = true; });
    await Promise.resolve();
    assert.equal(stopped, false);
    release();
    await Promise.all([turn, stopping]);
    assert.equal(stopped, true);
    assert.equal(f.calls.prepare.length, 0); assert.equal(f.calls.apply.length, 0);
    const record = f.queue.get("request-stop-lock-0001");
    assert.equal(record.state, "queued"); assert.equal(record.claim, null);
    assert.deepEqual(await f.service.runOnce(), { processed: false });
  } finally { f.cleanup(); }
});

test("stopping after the applying barrier preserves uncertainty instead of reopening mutation", async () => {
  const f = fixture();
  try {
    f.state.connected = true; f.state.foreground = true;
    let applicationStarted;
    const started = new Promise((resolve) => { applicationStarted = resolve; });
    f.adapter.apply = async (record, _observed, { cancellationSignal }) => {
      f.calls.apply.push(structuredClone(record));
      applicationStarted();
      return new Promise((_, reject) => {
        cancellationSignal.addEventListener("abort", () => reject(new Error("application acknowledgement cancelled")), { once: true });
      });
    };
    await f.service.enqueue({ requestId: "request-stop-apply-0001", files: f.files() });
    await f.service.runOnce();
    const turn = f.service.runOnce();
    await started;
    assert.equal(f.queue.get("request-stop-apply-0001").state, "applying");
    await f.service.stop();
    await turn;
    const record = f.queue.get("request-stop-apply-0001");
    assert.equal(record.state, "uncertain"); assert.equal(record.claim, null);
    assert.equal(record.reasonCode, "QUEUE_APPLY_UNCONFIRMED");
    await f.runtime().runOnce();
    assert.equal(f.calls.apply.length, 1);
    assert.notEqual(f.service.status("request-stop-apply-0001").outcome, "hot-reloaded");
  } finally { f.cleanup(); }
});
