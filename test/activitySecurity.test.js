import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureApnsProvider, createApnsProvider, disableApnsProvider, sendApnsRequest } from "../mac-helper/src/apnsProvider.js";
import { createActivityStore } from "../mac-helper/src/activityStore.js";
import { createActivityService } from "../mac-helper/src/activityService.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test("HTTP2 admission rechecks authority after a delayed TLS connection, before transmitting credentials", async () => {
  const session = new EventEmitter(); let requests = 0; let destroyed = false; let current = true;
  session.destroy = () => { destroyed = true; };
  session.request = () => { requests += 1; throw new Error("revoked credentials must not be written"); };
  const sending = sendApnsRequest({ environment: "sandbox", token: "ab".repeat(32), body: "{}", headers: { authorization: "fixture-credential" },
    isCurrent: async () => current, timeoutMs: 200, connectImpl: () => session });
  current = false;
  session.emit("connect");
  assert.deepEqual(await sending, { status: 0, revoked: true });
  assert.equal(requests, 0);
  assert.equal(destroyed, true);
});

test("a stalled admission check remains bounded and cannot resume after cancellation", async () => {
  const session = new EventEmitter(); const gate = deferred(); const entered = deferred(); let requests = 0;
  session.destroy = () => {};
  session.request = () => { requests += 1; throw new Error("cancelled admission resumed"); };
  const controller = new AbortController();
  const sending = sendApnsRequest({ environment: "production", token: "ab".repeat(32), body: "{}", headers: {}, signal: controller.signal,
    isCurrent: async () => { entered.resolve(); return gate.promise; }, timeoutMs: 200, connectImpl: () => session });
  session.emit("connect");
  await entered.promise;
  controller.abort();
  assert.deepEqual(await sending, { status: 0 });
  gate.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests, 0);
});

test("provider credentials are rechecked after an asynchronous authority guard finishes", async () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-provider-security-"));
  const keyPath = join(root, "fixture.p8"); const configPath = join(root, "notifications", "apns.json");
  const gate = deferred(); const entered = deferred(); let transmitted = 0; let sending;
  try {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    await configureApnsProvider({ keyPath, keyId: "KEY1234567", teamId: "TEAM123456", topic: "dev.fixture.Companion" }, { configPath });
    const provider = createApnsProvider({ configPath, transport: async ({ isCurrent }) => {
      if (!await isCurrent()) return { status: 0, revoked: true };
      transmitted += 1; return { status: 200 };
    } });
    sending = provider.send({ token: "ab".repeat(32), environment: "sandbox", payload: { aps: { alert: "fixture" } },
      collapseId: sha("fixture-event"), apnsId: randomUUID(),
      isCurrent: async () => { entered.resolve(); return gate.promise; } });
    await entered.promise;
    await disableApnsProvider({ configPath });
    gate.resolve(true);
    assert.deepEqual(await sending, { state: "rejected", reason: "NOTIFICATION_REVOKED" });
    assert.equal(transmitted, 0);
  } finally { gate.resolve(false); if (sending) await sending.catch(() => {}); rmSync(root, { recursive: true, force: true }); }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-activity-security-")); let time = 1_000_000;
  let pairing = { epoch: sha("original-pair"), installationId: "fixture-mac" }; let generation = "original-provider"; let configured = true;
  let live = []; let builds = []; let send;
  const store = createActivityStore({ rootPath: join(root, "activity"), now: () => time,
    lockManager: new NodeLockManager({ fileStore: new NodeAtomicFileStore(), identity: (pid) => pid === process.pid ? { startToken: "security-fixture" } : null }) });
  const provider = { status: () => ({ configured, generation }), send: async (input) => send ? send(input) : { state: "accepted" } };
  const service = createActivityService({ store, provider, getPairing: () => pairing, listBuilds: () => builds, listLiveDeliveries: () => live, now: () => time });
  return { service, store, advance(ms = 1000) { time += ms; },
    register(preferences = {}, token = "ab".repeat(32)) { return service.registerDevice({ deviceId: DEVICE, token, environment: "sandbox", preferences }); },
    rotate() { pairing = { ...pairing, epoch: sha("replacement-pair") }; },
    disable() { configured = false; generation = "disabled-provider"; },
    sendWith(callback) { send = callback; }, setLive(value) { live = value; }, setBuilds(value) { builds = value; },
    waiting() { return { requestId: "pending-request", state: "waiting-for-device", createdAt: time, updatedAt: time, expiresAt: time + 6000, baselineRevision: 0,
      scope: { sessionIdentity: "fixture-process", binaryIdentity: "fixture-binary" }, preparedPatch: { patchDigest: sha("patch") } }; },
    ready() { return { id: "ready-build", state: "ready", createdAt: time, updatedAt: time,
      artifacts: { ipaPath: "/fixture/private.ipa" }, remoteBaseUrl: "https://fixture.invalid/private", expiresAt: new Date(time + 120_000).toISOString() }; },
    cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

for (const revocation of ["pairing", "subscription", "preferences", "registration", "provider", "superseded", "failed", "applied", "source-expiry"]) {
  test(`deferred transport admission rejects ${revocation} revocation of an already claimed alert`, async () => {
    const f = fixture(); const gate = deferred(); const entered = deferred(); const transmitted = []; let sending;
    try {
      await f.service.runOnce(); await f.register(); f.advance();
      const request = f.waiting(); f.setLive([request]); await f.service.runOnce(); f.advance(5000);
      f.sendWith(async ({ isCurrent, payload }) => {
        entered.resolve(); await gate.promise;
        assert.equal(typeof isCurrent, "function", "service must pass a fresh journal and authority admission fence");
        if (!await isCurrent()) return { state: "rejected", reason: "AUTHORITY_CHANGED" };
        transmitted.push(payload.aps.alert.title); return { state: "accepted" };
      });
      sending = f.service.runOnce(); await entered.promise;
      if (revocation === "pairing") f.rotate();
      if (revocation === "subscription") await f.service.unregisterDevice(DEVICE);
      if (revocation === "preferences") await f.register({ queued: false });
      if (revocation === "registration") await f.register({}, "cd".repeat(32));
      if (revocation === "provider") f.disable();
      if (revocation === "superseded" || revocation === "failed") f.setLive([{ ...request, state: revocation }]);
      if (revocation === "applied") f.setLive([{ ...request, state: "refreshed", proof: {
        requestId: request.requestId, sessionIdentity: request.scope.sessionIdentity, binaryIdentity: request.scope.binaryIdentity,
        patchDigest: request.preparedPatch.patchDigest, applied: true, refreshed: true, revision: 1,
      } }]);
      if (revocation === "source-expiry") f.advance(2000);
      gate.resolve(); await sending;
      assert.deepEqual(transmitted, revocation === "applied" ? ["Update applied"] : []);
      assert.equal(transmitted.includes("Hot reload queued"), false);
    } finally { gate.resolve(); if (sending) await sending.catch(() => {}); await f.service.stop(); f.cleanup(); }
  });
}

test("removed build sources cancel pending retries and remain one bounded terminal inbox event", async () => {
  const f = fixture(); let attempts = 0;
  try {
    await f.service.runOnce(); await f.register(); f.advance(); f.setBuilds([f.ready()]);
    f.sendWith(async () => { attempts += 1; return { state: "retry", retryAfterMs: 1000 }; });
    await f.service.runOnce(); const original = f.service.feed().events[0].id;
    f.setBuilds([]);
    for (let index = 0; index < 8; index += 1) { f.advance(1000); await f.service.runOnce(); }
    const feed = f.service.feed();
    assert.equal(attempts, 1);
    assert.equal(feed.events.length, 1);
    assert.equal(feed.events[0].id, original);
    assert.equal(feed.events[0].state, "unavailable");
    assert.equal(f.store.snapshot().jobs.length, 0);
  } finally { await f.service.stop(); f.cleanup(); }
});
