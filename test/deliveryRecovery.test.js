import test from "node:test";
import assert from "node:assert/strict";
import { recoverDelivery } from "../mac-helper/src/deliveryRecovery.js";
import { recoveryFixture } from "./fixtures/recovery.js";
function fixture(t) {
  const f = recoveryFixture();
  t.after(f.cleanup);
  return f;
}

test("a stopped helper resumes the same durable request and preserves native state", async (t) => {
  const f = fixture(t);
  await f.enqueue();
  await f.service.runOnce();
  const before = f.queue.get("recovery-one");
  f.healthy(false);
  const result = await recoverDelivery({ requestId: before.requestId }, f.ports);
  assert.deepEqual(result.repaired, ["helper-started"]);
  assert.equal(result.requestId, before.requestId);
  assert.equal(f.queue.get(before.requestId).snapshotDigest, before.snapshotDigest);
  await f.service.runOnce();
  assert.equal(f.service.status(before.requestId).outcome, "hot-reloaded");
  assert.deepEqual(f.phone.applied, [before.requestId]);
  assert.equal(f.phone.counter, 4);
  assert.equal(f.phone.draft, "keep-me");
  await recoverDelivery({ requestId: before.requestId }, f.ports);
  await f.service.runOnce();
  assert.equal(f.calls.apply, 1);
  assert.equal(f.calls.helper, 1);
});
for (const interruption of ["lock", "network", "sleep"])
  test(interruption + " preserves prepared bytes, state and one application", async (t) => {
    const f = fixture(t);
    await f.enqueue();
    await f.service.runOnce();
    const digest = f.queue.get("recovery-one").preparedPatch.patchDigest;
    f.state.connected = false;
    f.state.foreground = false;
    if (interruption === "sleep") f.advance(35000);
    await f.service.runOnce();
    const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
    assert.equal(result.nextAction, "open-app");
    assert.equal(f.calls.helper, 0);
    assert.equal(f.calls.engine, 0);
    assert.equal(f.calls.apply, 0);
    f.reopen();
    f.state.connected = true;
    f.state.foreground = true;
    await f.service.runOnce();
    await f.service.runOnce();
    assert.equal(f.queue.get("recovery-one").preparedPatch.patchDigest, digest);
    assert.equal(f.calls.prepare, 1);
    assert.equal(f.calls.apply, 1);
    assert.equal(f.phone.counter, 4);
    assert.equal(f.phone.draft, "keep-me");
  });
test("a lost acknowledgement is reconciled after helper recovery without a second apply", async (t) => {
  const f = fixture(t);
  const apply = f.adapter.apply;
  f.adapter.apply = async (r) => {
    await apply(r);
    throw Error("lost");
  };
  await f.enqueue();
  await f.service.runOnce();
  await f.service.runOnce();
  assert.equal(f.queue.get("recovery-one").state, "uncertain");
  f.healthy(false);
  const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.equal(result.completionVerified, true);
  assert.equal(f.calls.apply, 1);
  assert.equal(f.calls.receipt, 1);
  assert.equal(f.phone.counter, 4);
  assert.equal(f.phone.draft, "keep-me");
});
test("unknown receipt stays fenced across recovery and subsequent turns", async (t) => {
  const f = fixture(t);
  f.adapter.apply = async () => {
    f.calls.apply++;
    throw Error("unknown");
  };
  await f.enqueue();
  await f.service.runOnce();
  await f.service.runOnce();
  f.healthy(false);
  const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.equal(result.completionVerified, false);
  assert.equal(result.code, "RECOVERY_PRESERVED");
  for (let i = 0; i < 4; i++) await f.service.runOnce();
  assert.equal(f.calls.apply, 1);
  assert.equal(f.queue.get("recovery-one").state, "uncertain");
});
test("stale worker repair is bounded and busy work prevents destructive restart", async (t) => {
  const f = fixture(t);
  await f.enqueue();
  await f.service.runOnce();
  f.advance(35000);
  const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.equal(f.calls.helper, 1);
  assert.equal(result.completionVerified, true);
  await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.equal(f.calls.helper, 1);
  const g = fixture(t);
  await g.enqueue();
  await g.service.runOnce();
  g.advance(35000);
  g.busy(true);
  assert.equal(
    (await recoverDelivery({ requestId: "recovery-one" }, g.ports)).code,
    "RECOVERY_BUSY",
  );
  assert.equal(g.calls.helper, 0);
});
test("scope mismatch, multiple pending requests and bad journals never trigger repair", async (t) => {
  const f = fixture(t);
  await f.enqueue();
  f.healthy(false);
  assert.equal(
    (await recoverDelivery({ requestId: "recovery-one", project: "/wrong/App.xcodeproj" }, f.ports))
      .code,
    "RECOVERY_SCOPE_REQUIRED",
  );
  assert.equal(
    (await recoverDelivery({ requestId: "missing" }, f.ports)).code,
    "RECOVERY_SCOPE_REQUIRED",
  );
  assert.equal(f.calls.helper, 0);
  f.ports.exclusive = () => {
    throw Error("private token /Users/path");
  };
  const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.equal(result.code, "RECOVERY_UNCONFIRMED");
  assert.doesNotMatch(JSON.stringify(result), /token|Users/);
});
for (const failureCode of [
  "HELPER_TIMEOUT",
  "HELPER_RESPONSE_INVALID",
  "HELPER_IDENTITY_MISMATCH",
  "HELPER_HTTP_ERROR",
])
  test(failureCode + " cannot authorize a restart", async (t) => {
    const f = fixture(t);
    await f.enqueue();
    f.ports.health = async () => ({ ok: false, failureCode, helper: "other" });
    const r = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
    assert.equal(r.code, "RECOVERY_HELPER_UNCONFIRMED");
    assert.equal(f.calls.helper, 0);
  });
test("only a stopped matching engine is restored; original request stays unchanged", async (t) => {
  const f = fixture(t);
  await f.enqueue();
  await f.service.runOnce();
  f.state.engineAvailable = false;
  f.state.engineReachable = false;
  await f.service.runOnce();
  const before = f.queue.get("recovery-one");
  const result = await recoverDelivery({ requestId: "recovery-one" }, f.ports);
  assert.deepEqual(result.repaired, ["engine-started"]);
  assert.equal(result.completionVerified, false);
  assert.equal(f.queue.get("recovery-one").snapshotDigest, before.snapshotDigest);
  await f.service.runOnce();
  assert.equal(f.calls.apply, 1);
});

test("an ambiguous project cannot guess one of several existing operations", async (t) => {
  const f = fixture(t);
  await f.enqueue();
  await f.queue.enqueue({
    requestId: "recovery-other",
    scope: { ...f.scope, appIdentity: "other-app", binaryIdentity: "other-binary" },
    baselineRevision: 0,
    files: [
      {
        path: f.path,
        beforeSource: "struct Card {}",
        afterSource: "struct Card { var n:Int { 1 } }",
      },
    ],
  });
  f.healthy(false);
  assert.equal(
    (await recoverDelivery({ project: f.project, scheme: "App" }, f.ports)).code,
    "RECOVERY_SCOPE_REQUIRED",
  );
  assert.equal(f.calls.helper, 0);
});
test("recovery refuses an active or malformed engine record and permits only absent processes", async () => {
  const { assertStoppedLiveEngineForRecovery } = await import("../mac-helper/src/liveReload.js");
  for (const record of [null, { pid: "123" }, { pid: 123 }])
    assert.throws(
      () =>
        assertStoppedLiveEngineForRecovery({
          readRecord: () => record,
          identity: () => ({ startToken: "alive" }),
        }),
      { code: "RECOVERY_ENGINE_ACTIVE" },
    );
  assert.doesNotThrow(() =>
    assertStoppedLiveEngineForRecovery({ readRecord: () => ({ pid: 123 }), identity: () => null }),
  );
  assert.doesNotThrow(() =>
    assertStoppedLiveEngineForRecovery({
      readRecord: () => {
        throw Object.assign(Error(), { code: "ENOENT" });
      },
    }),
  );
});
