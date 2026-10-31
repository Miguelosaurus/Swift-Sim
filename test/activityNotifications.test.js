import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createActivityStore, activityEventId } from "../mac-helper/src/activityStore.js";
import { createActivityService, activitySnapshotEvents, activityBuildView, activityLiveDeliveryView } from "../mac-helper/src/activityService.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../mac-helper/src/infrastructure/nodeLockManager.js";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const DEVICE = "11111111-1111-4111-8111-111111111111";
const TOKEN = "ab".repeat(32);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-activity-")); let clock = 1_000_000;
  let pairing = { epoch: sha("pairing-one"), installationId: "test-mac" };
  let configured = true; let generation = "provider-one"; const sent = []; let sender;
  let builds = []; let live = [];
  const options = { rootPath: join(root, "notifications"), now: () => clock, lockManager: new NodeLockManager({ fileStore: new NodeAtomicFileStore(), identity: (pid) => pid === process.pid ? { startToken: "test-process" } : null }) };
  let store = createActivityStore(options);
  const provider = { status: () => ({ configured, generation, ...(!configured ? { reason: "APNS_NOT_CONFIGURED" } : {}) }), async send(input) { sent.push(input); return sender ? sender(input) : { state: "accepted" }; } };
  const service = () => createActivityService({ store, provider, getPairing: () => pairing, listBuilds: () => builds, listLiveDeliveries: () => live, now: () => clock });
  let runtime = service();
  return { root, sent, options, provider, get store() { return store; }, get service() { return runtime; },
    advance(ms = 1000) { clock += ms; }, now: () => clock, setBuilds(value) { builds = value; }, setLive(value) { live = value; },
    rotate() { pairing = { ...pairing, epoch: sha(randomUUID()) }; }, configure(value) { configured = value; generation = value ? randomUUID() : "unconfigured"; }, sendWith(fn) { sender = fn; },
    async register(preferences = {}, token = TOKEN) { return runtime.registerDevice({ deviceId: DEVICE, token, environment: "sandbox", preferences }); },
    reopen() { store = createActivityStore(options); runtime = service(); },
    build(id = "build-one", state = "ready") { return { id, state, createdAt: clock, updatedAt: clock, app: { name: "/Users/private/app Bearer secret" }, artifacts: { ipaPath: "/Users/private/app.ipa" }, remoteBaseUrl: "https://secret.example/token", expiresAt: new Date(clock + 60_000).toISOString() }; },
    live(id = "request-one", state = "queued") { return { requestId: id, state, createdAt: clock, updatedAt: clock, baselineRevision: 0, scope: { sessionIdentity: "process-one", binaryIdentity: "exact-binary" }, preparedPatch: { patchDigest: sha(id) } }; },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}
function applied(record) { return { ...record, state: "refreshed", proof: { requestId: record.requestId, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, patchDigest: record.preparedPatch.patchDigest, applied: true, refreshed: true, revision: 1 } }; }

test("known Mac faults replace misleading open-app alerts and remain deduplicated", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const waiting = { ...f.live("mac-paused", "waiting-for-device"), targetAppName: "Zenics" };
    f.setLive([waiting]); await f.service.refresh();
    assert.equal(f.store.snapshot().jobs.length, 1);
    const blocked = { ...waiting, readiness: { code: "LIVE_ENGINE_UNAVAILABLE", changedAt: f.now(), heartbeatAgeMs: 0 } };
    f.setLive([blocked]); await f.service.refresh(); f.advance(); await f.service.runOnce();
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].payload.aps.alert.title, "Zenics — Update needs your Mac");
    assert.doesNotMatch(f.sent[0].payload.aps.alert.body, /Open Zenics/);
    assert.equal(f.service.feed().events[0].launchURL, undefined);
    f.advance(5000); f.setLive([{ ...blocked, readiness: { ...blocked.readiness, heartbeatAgeMs: 5000 } }]); await f.service.runOnce();
    assert.equal(f.sent.length, 1);
    f.setLive([{ ...waiting, readiness: { code: "LIVE_READY" } }]); await f.service.runOnce();
    f.advance(5000); await f.service.runOnce();
    assert.equal(f.sent[1].payload.aps.alert.title, "Zenics — Ready to apply");
  } finally { f.cleanup(); }
});

test("activity reads readiness once for all pending records without altering cached queue views", () => {
  const f = fixture(); try {
    const pending = f.live("pending"); const success = applied(f.live("success")); const records = [pending, success]; let reads = 0;
    const view = activityLiveDeliveryView({ pollingSnapshot: () => ({ records }), readinessSnapshot(input) { reads++; assert.deepEqual(input, [pending]); return new Map([[pending.requestId, { code: "LIVE_CAPTURE_UNAVAILABLE", changedAt: f.now() }]]); } });
    assert.equal(reads, 1); assert.equal(pending.readiness, undefined); assert.equal(view[1], success);
    assert.equal(activitySnapshotEvents({ liveDeliveries: view, now: f.now() }).entries.find((event) => event.requestId === "pending").kind, "attention");
    assert.equal(activitySnapshotEvents({ liveDeliveries: view, now: f.now() }).entries.find((event) => event.requestId === "success").kind, "live-applied");
  } finally { f.cleanup(); }
});

test("device diagnostics preserve pending alert authority and never imply background presentation", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    f.setBuilds([f.build()]); await f.service.refresh();
    const before = f.store.snapshot();
    const diagnostics = { schemaVersion: 1, authorization: "authorized", alerts: "enabled", alertStyle: "banner", scheduledDelivery: "disabled", observedAt: new Date(f.now()).toISOString(), lastTap: { eventId: before.events[0].id, macID: "test-mac", observedAt: new Date(f.now()).toISOString() } };
    await f.service.registerDevice({ deviceId: DEVICE, environment: "sandbox", preferences: {}, diagnostics });
    const after = f.store.snapshot();
    assert.equal(after.devices[0].revision, before.devices[0].revision);
    assert.equal(after.devices[0].registeredAt, before.devices[0].registeredAt);
    assert.deepEqual(after.jobs, before.jobs);
    assert.deepEqual(f.service.feed({ deviceId: DEVICE }).diagnostics, diagnostics);
    assert.equal(f.service.feed({ deviceId: "another-device" }).diagnostics, undefined);
    await f.service.runOnce();
    const report = f.store.notificationDiagnostics();
    assert.equal(report.recentAlerts[0].acceptance, "accepted");
    assert.equal(report.recentAlerts[0].observedAt, new Date(f.now()).toISOString());
    assert.equal(report.recentAlerts[0].pendingAttempts, 0);
    assert.equal(report.devices[0].diagnostics.lastForegroundReceipt, undefined);
    assert.doesNotMatch(JSON.stringify(report), new RegExp(`${TOKEN}|${DEVICE}|provider-one|sandbox|secret|delivered|displayed`));
    assert.equal(f.service.feed().events[0].pushStatus.state, "accepted");
  } finally { f.cleanup(); }
});

test("diagnostics reject unknown, private, unbounded and malformed evidence without changing registrations", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register();
    const valid = { schemaVersion: 1, authorization: "authorized", alerts: "enabled", alertStyle: "banner", scheduledDelivery: "disabled", observedAt: new Date(f.now()).toISOString() };
    const before = f.store.snapshot();
    for (const diagnostics of [{ ...valid, token: TOKEN }, { ...valid, authorization: "displayed" }, { ...valid, observedAt: "/Users/private" }, { ...valid, lastTap: { eventId: "x".repeat(500), macID: "test-mac", observedAt: valid.observedAt } }, { ...valid, lastForegroundReceipt: { eventId: sha("event"), macID: "test-mac", observedAt: valid.observedAt, privatePath: "/Users/private" } }]) {
      await assert.rejects(f.service.registerDevice({ deviceId: DEVICE, environment: "sandbox", preferences: {}, diagnostics }), /ACTIVITY_DIAGNOSTICS_INVALID/);
    }
    assert.deepEqual(f.store.snapshot(), before);
  } finally { f.cleanup(); }
});

test("presentation updates refresh accepted history without replaying pushes", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const record = { ...applied(f.live()), targetAppName: "Zenics" };
    f.setLive([record]); await f.service.runOnce();
    assert.equal(f.sent[0].payload.aps.alert.title, "Zenics updated");
    assert.match(f.sent[0].payload.aps.alert.body, /applied successfully/);
    const before = f.store.snapshot().events[0];
    const entry = activitySnapshotEvents({ liveDeliveries: [record], now: f.now() }).entries[0];
    f.advance();
    // A source timestamp can advance for unrelated installation metadata.
    await f.store.sync({ entries: [{ ...entry, time: f.now(), title: "Zenics changes applied", message: "Your latest changes are ready to try." }], observations: {}, epoch: sha("pairing-one"), providerGeneration: "provider-one", notifyReady: true });
    const after = f.store.snapshot();
    assert.equal(after.jobs.length, 0);
    assert.equal(after.events[0].lastPushState, "accepted");
    assert.equal(after.events[0].time, before.time);
    assert.equal(after.events[0].sequence, before.sequence);
    assert.equal(f.service.feed().events[0].presentationOnly, true);
    assert.equal(f.service.feed({ after: before.sequence }).events.length, 0);
    await f.service.runOnce(); assert.equal(f.sent.length, 1);
  } finally { f.cleanup(); }
});

test("copy refresh preserves pending delivery and uses the new copy; genuine transitions still alert", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const context = { epoch: sha("pairing-one"), providerGeneration: "provider-one", notifyReady: true };
    const entry = activitySnapshotEvents({ builds: [{ ...f.build(), app: { name: "Zenics" } }], now: f.now() }).entries[0];
    await f.store.sync({ ...context, entries: [{ ...entry, title: "Old build copy" }], observations: {} });
    const job = f.store.snapshot().jobs[0];
    await f.store.sync({ ...context, entries: [entry], observations: {} });
    assert.deepEqual(f.store.snapshot().jobs[0], job);
    const claim = await f.store.claimNext(context);
    assert.equal(claim.event.title, "Zenics — Ready to install");
    await f.store.settle(claim.job.id, claim.job.claim.token, { state: "accepted" }, context);
    f.advance();
    await f.store.sync({ ...context, entries: [{ ...entry, kind: "attention", state: "failed", time: f.now(), title: "Zenics — Build couldn't finish" }], observations: {} });
    assert.equal(f.store.snapshot().jobs.length, 1);
  } finally { f.cleanup(); }
});

test("initial history fills the inbox without pushes; later ready transition is durable and deduplicated", async () => {
  const f = fixture(); try {
    f.setBuilds([f.build("historical")]); await f.register(); await f.service.runOnce();
    assert.equal(f.sent.length, 0); assert.equal(f.service.feed().events.length, 1);
    f.advance(); f.setBuilds([f.build("new-build")]); await f.service.runOnce();
    assert.equal(f.sent.length, 1); const payload = f.sent[0].payload;
    assert.equal(payload.macID, "test-mac"); assert.equal(payload.buildId, "new-build");
    assert.doesNotMatch(JSON.stringify(payload), /Bearer|secret|\/Users|https:|token/);
    await f.service.runOnce(); f.reopen(); await f.service.runOnce();
    assert.equal(f.sent.length, 1); assert.equal(f.store.snapshot().jobs.length, 0);
    assert.equal(f.store.snapshot().events.find((event) => event.buildId === "new-build").lastPushState, "accepted");
    assert.equal(lstatSync(join(f.root, "notifications", "activity.json")).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("build alerts identify their app without replaying unchanged generic history", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const ready = { ...f.build("companion-update"), app: { name: "Swift Sim" } };
    const failed = { ...f.build("larply-attempt", "failed"), app: { name: "Larply" }, logs: ["[BUILD_SIGNING_FAILED]"] };
    f.setBuilds([ready, failed]); await f.service.runOnce();
    f.advance(1000); await f.service.runOnce();
    assert.deepEqual(f.sent.map((input) => input.payload.aps.alert.title).sort(), ["Larply — Build couldn't finish", "Swift Sim — Ready to install"]);
    assert.equal(f.service.feed().events.find((event) => event.buildId === "larply-attempt").targetAppName, "Larply");

    const generic = { ...ready, app: {} };
    const previous = activitySnapshotEvents({ builds: [generic], now: f.now() }).observations;
    assert.equal(activitySnapshotEvents({ builds: [ready], previous, now: f.now() }).entries.length, 1);
    for (const name of ["/Users/private/project", "Bearer secret", "https://private.example", "token=secret", "Bad\nName", "Bad\u0000Name", "x".repeat(61)]) {
      const event = activitySnapshotEvents({ builds: [{ ...ready, app: { name } }], now: f.now() }).entries[0];
      assert.equal(event.title, "Ready to install");
      assert.equal(event.targetAppName, undefined);
    }
  } finally { f.cleanup(); }
});

test("queued/prepared/unconfirmed live work cannot notify successful application", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register({ hotReload: true });
    const record = f.live(); f.setLive([record]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    f.advance(); f.setLive([{ ...record, state: "applied", updatedAt: f.now() }]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    const wrong = applied(record); wrong.proof.requestId = "another-request";
    f.setLive([wrong]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    f.advance(); f.setLive([{ ...applied(record), updatedAt: f.now() }]); await f.service.runOnce();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].payload.aps.alert.title, "Changes applied");
    assert.equal(f.service.feed().events.length, 1); assert.equal(f.service.feed().events[0].state, "refreshed");
  } finally { f.cleanup(); }
});

test("proven hot reload alerts default on while launch alerts remain inbox-only", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    f.setLive([applied(f.live())]); const build = f.build(); build.installation = { state: "launch-confirmed", launchConfirmedAt: new Date(f.now()).toISOString() };
    f.setBuilds([build]); await f.service.runOnce(); assert.equal(f.sent.length, 2); // Build ready and proven hot reload.
    assert.deepEqual(f.sent.map((item) => item.payload.aps.alert.title).sort(), ["Changes applied", "Ready to install"]);
    assert.equal(f.service.feed().events.filter((e) => e.kind === "launch-confirmed").length, 1);
    const events = activitySnapshotEvents({ builds: [{ ...build, installation: { state: "requested" } }], now: f.now() }).entries;
    assert.equal(events.some((e) => e.kind === "launch-confirmed"), false);
  } finally { f.cleanup(); }
});

test("rotation, revocation and configuration changes prevent old outbox replay", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.sendWith(() => ({ state: "retry" })); f.advance(); f.setBuilds([f.build()]); await f.service.runOnce();
    assert.equal(f.store.snapshot().jobs.length, 1); f.rotate(); f.advance(60_000); await f.service.runOnce();
    assert.equal(f.sent.length, 1); assert.equal(f.store.snapshot().devices.length, 0);
    await f.register(); f.advance(); f.setBuilds([f.build("next")]); await f.service.runOnce(); assert.equal(f.sent.length, 2);
    await f.service.unregisterDevice(DEVICE); f.advance(60_000); await f.service.runOnce(); assert.equal(f.sent.length, 2);
    f.configure(false); await f.register(); f.advance(); f.setBuilds([f.build("while-unconfigured")]); await f.service.runOnce();
    f.configure(true); f.advance(); await f.service.runOnce(); assert.equal(f.sent.length, 2);
  } finally { f.cleanup(); }
});

test("late invalid-token response cannot disable a replacement registration", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance(); f.setBuilds([f.build()]);
    f.sendWith(async () => { await f.register({}, "cd".repeat(32)); return { state: "unregistered" }; });
    await f.service.runOnce(); const device = f.store.snapshot().devices[0];
    assert.equal(device.enabled, true); assert.equal(device.token, "cd".repeat(32));
  } finally { f.cleanup(); }
});

test("retry uses the same APNs operation and collapses repeated polling", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance(); f.setBuilds([f.build()]);
    f.sendWith(() => f.sent.length === 1 ? { state: "retry", retryAfterMs: 1000 } : { state: "accepted" });
    await f.service.runOnce(); await f.service.runOnce(); assert.equal(f.sent.length, 1);
    f.advance(1000); await f.service.runOnce(); assert.equal(f.sent.length, 2);
    assert.equal(f.sent[0].apnsId, f.sent[1].apnsId); assert.equal(f.sent[0].collapseId, f.sent[1].collapseId);
  } finally { f.cleanup(); }
});

test("coalesced turns and stop abort the provider then drain without another send", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance(); f.setBuilds([f.build()]);
    let started; const ready = new Promise((resolve) => { started = resolve; });
    f.sendWith(({ signal }) => new Promise((resolve) => { started(); signal.addEventListener("abort", () => resolve({ state: "retry", reason: "CANCELLED" }), { once: true }); }));
    const a = f.service.runOnce(); const b = f.service.runOnce(); await ready;
    await f.service.stop(); await Promise.all([a, b]); assert.equal(f.sent.length, 1);
    await f.service.runOnce(); assert.equal(f.sent.length, 1);
  } finally { f.cleanup(); }
});

test("private/corrupt journals and stale authority fail without replacing data", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); const path = join(f.root, "notifications", "activity.json"); const original = new NodeAtomicFileStore().readTextSync(path);
    chmodSync(path, 0o644); assert.throws(() => f.service.feed(), /ACTIVITY_STORE_UNSAFE/); chmodSync(path, 0o600);
    writeFileSync(path, "malformed"); assert.throws(() => f.service.feed(), /ACTIVITY_STORE_INVALID/); assert.equal(new NodeAtomicFileStore().readTextSync(path), "malformed");
    writeFileSync(path, original); const backup = join(f.root, "safe-backup"); writeFileSync(backup, original, { mode: 0o600 }); rmSync(path); symlinkSync(backup, path);
    assert.throws(() => f.service.feed(), /ACTIVITY_STORE_UNSAFE/);
  } finally { f.cleanup(); }
});

test("prepared waiting alerts delay and collapse per app, without treating ordinary absence as failure", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const first = { ...f.live("waiting-first", "waiting-for-device"), targetAppName: "Zenics" };
    f.setLive([first]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    assert.equal(f.service.feed().events[0].kind, "queued");
    assert.match(f.service.feed().events[0].message, /Open Zenics.*No install needed/);
    f.advance(4000); const second = { ...f.live("waiting-second", "waiting-for-foreground"), targetAppName: "Zenics" };
    f.setLive([first, second]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    f.advance(5000); await f.service.runOnce(); assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].payload.aps.alert.title, "Zenics — Ready to apply");
    assert.equal(f.sent[0].payload.requestId, "waiting-second");
    f.advance(); f.setLive([first, second, f.live("waiting-third", "waiting-for-device")]); await f.service.runOnce(); f.advance(5000); await f.service.runOnce();
    assert.equal(f.sent.length, 1);
  } finally { f.cleanup(); }
});

test("foreground success cancels a delayed queued alert and building states never push", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const request = f.live("quick-apply", "waiting-for-device");
    f.setLive([request]); f.setBuilds([f.build("compiling-build", "building")]); await f.service.runOnce();
    f.advance(2000); f.setLive([{ ...applied(request), updatedAt: f.now() }]); await f.service.runOnce();
    f.advance(5000); await f.service.runOnce();
    assert.deepEqual(f.sent.map((item) => item.payload.aps.alert.title), ["Changes applied"]);
    assert.equal(f.store.snapshot().jobs.length, 0);
  } finally { f.cleanup(); }
});

test("a stale authority waiting for journal admission cannot overwrite replacement subscriptions", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register();
    await assert.rejects(f.store.registerDevice({ deviceId: DEVICE, token: TOKEN, environment: "sandbox", preferences: {} }, { epoch: sha("old"), providerGeneration: "provider-one", isCurrent: () => false }), /ACTIVITY_AUTHORITY_CHANGED/);
    assert.equal(f.store.snapshot().devices.length, 1);
    assert.equal(f.store.snapshot().epoch, sha("pairing-one"));
  } finally { f.cleanup(); }
});

test("queued terminal transitions cancel undispatched alerts and taps read the current status", async () => {
  for (const state of ["expired", "failed", "superseded"]) {
    const f = fixture(); try {
      await f.service.runOnce(); await f.register(); f.advance();
      const request = f.live("terminal-request", "waiting-for-device"); f.setLive([request]); await f.service.runOnce();
      assert.equal(f.store.snapshot().jobs.length, 1);
      f.advance(); f.setLive([{ ...request, state, updatedAt: f.now() }]); await f.service.refresh();
      assert.equal(f.service.feed().events[0].state, state);
      assert.equal(f.store.snapshot().jobs.some((job) => job.eventId === f.service.feed().events[0].id && state !== "failed"), false);
      f.advance(5000); await f.service.runOnce();
      assert.equal(f.sent.some((send) => send.payload.aps.alert.title === "Ready to apply"), false);
    } finally { f.cleanup(); }
  }
});

test("freshness reconciliation continues while a provider is stalled and a delivered queued tap cannot show waiting forever", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const request = f.live("stalled-provider", "waiting-for-device"); f.setLive([request]); await f.service.runOnce(); f.advance(5000);
    let release; let started; const ready = new Promise((resolve) => { started = resolve; });
    f.sendWith(() => new Promise((resolve) => { release = resolve; started(); }));
    const sending = f.service.runOnce(); await ready;
    f.setLive([{ ...request, state: "superseded", updatedAt: f.now() }]);
    await f.service.refresh(); assert.equal(f.service.feed().events[0].state, "superseded");
    release({ state: "accepted" }); await sending;
    assert.equal(f.service.feed().events[0].state, "superseded");
    assert.equal(f.store.snapshot().jobs.length, 0);
  } finally { f.cleanup(); }
});

test("expiry time and deleted build sources prevent stale queued or ready pushes", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register(); f.advance();
    const request = { ...f.live("expires-before-push", "waiting-for-device"), expiresAt: f.now() + 2000 };
    f.setLive([request]); await f.service.runOnce(); f.advance(5000); await f.service.runOnce();
    assert.equal(f.sent.length, 0); assert.equal(f.service.feed().events[0].state, "expired");
    f.sendWith(() => ({ state: "retry" })); f.advance(); f.setBuilds([f.build("deleted-before-retry")]); await f.service.runOnce();
    assert.equal(f.sent.length, 1); f.setBuilds([]); await f.service.refresh(); f.advance(60_000); await f.service.runOnce();
    assert.equal(f.sent.length, 1); assert.equal(f.service.feed().events.find((event) => event.buildId === "deleted-before-retry").state, "unavailable");
  } finally { f.cleanup(); }
});

test("large build history remains bounded and cannot replay discarded inbox rows", async () => {
  const f = fixture(); try {
    f.setBuilds(Array.from({ length: 1000 }, (_, index) => ({ ...f.build(`history-${index}`), installation: { state: "launch-confirmed", launchConfirmedAt: new Date(f.now()).toISOString() } })));
    await f.service.runOnce(); await f.register({ launchConfirmed: true }); f.reopen(); await f.service.runOnce();
    assert.equal(f.sent.length, 0); assert.equal(f.store.snapshot().events.length, 500);
    assert.ok(Object.keys(f.store.snapshot().observations).length <= 2000);
  } finally { f.cleanup(); }
});

test("queued app launch action requires explicit opt-in and exact project, bundle and both binary UUIDs", async () => {
  const f = fixture(); try {
    const identity = { bundle_id: "example.debug", bundle_version: "1.0", build_number: "2", executable_uuid: "11111111-1111-4111-8111-111111111111", debug_dylib_uuid: "22222222-2222-4222-8222-222222222222" };
    const build = { ...f.build(), configuration: "Debug", app: { bundleIdentifier: identity.bundle_id, version: identity.bundle_version, build: identity.build_number }, liveReload: { eligible: true, compilerReady: true, recovery: { provenance: { projectPath: "/private/project/Test.xcodeproj", scheme: "Test", binaryIdentity: identity } }, presentation: { targetAppName: "Test App", launchURL: "example-debug://open" } } };
    const record = { ...f.live("launch-action", "waiting-for-device"), scope: { project: "/private/project/Test.xcodeproj/project.pbxproj", scheme: "Test", appIdentity: activityEventId([identity.bundle_id, identity.bundle_version, identity.build_number]), binaryIdentity: `${identity.executable_uuid}:${identity.debug_dylib_uuid}`, sessionIdentity: "process-one" } };
    const projected = activityBuildView({ builds: new Map([[build.id, build]]) });
    const observation = { liveDeliveries: [record], now: Date.now() };
    assert.deepEqual(activitySnapshotEvents({ ...observation, builds: projected }), activitySnapshotEvents({ ...observation, builds: [build] }));
    f.setBuilds([build]); f.setLive([record]); await f.service.runOnce();
    const queued = () => f.service.feed().events.find((event) => event.requestId === record.requestId);
    assert.equal(queued().launchURL, "example-debug://open"); assert.equal(queued().targetAppName, "Test App");
    build.liveReload.recovery.provenance.binaryIdentity = { ...identity, debug_dylib_uuid: "33333333-3333-4333-8333-333333333333" };
    await f.service.refresh(); assert.equal(queued().launchURL, undefined);
    build.liveReload.recovery.provenance.binaryIdentity = identity;
    for (const launchURL of ["example-debug://open?token=secret", "file:///private/data", "https://example.com", "swift-sim://open", "example-debug://user:password@open", undefined]) {
      build.liveReload.presentation.launchURL = launchURL; await f.service.refresh(); assert.equal(queued().launchURL, undefined);
    }
    assert.doesNotMatch(JSON.stringify(f.sent), /example-debug|private\/project/);
  } finally { f.cleanup(); }
});


test("an explicit hot reload opt-out survives helper restart and enabling never replays history", async () => {
  const f = fixture(); try {
    await f.service.runOnce(); await f.register({ hotReload: false }); f.advance();
    f.setLive([applied(f.live())]); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    f.reopen(); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    assert.equal(f.store.snapshot().devices[0].preferences.hotReload, false);
    await f.register({ hotReload: true }); await f.service.runOnce(); assert.equal(f.sent.length, 0);
    f.advance(); f.setLive([applied(f.live("next-request"))]); await f.service.runOnce();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].payload.aps.alert.title, "Changes applied");
  } finally { f.cleanup(); }
});


test("compact activity build view preserves all events and older retained-build existence", () => {
  const now = Date.now();
  const rows = Array.from({ length: 510 }, (_, i) => ({
    id: `build-${i}`, state: ["queued", "ready", "failed", "exporting"][i % 4],
    createdAt: new Date(now - i * 1000).toISOString(), updatedAt: new Date(now - i * 1000).toISOString(),
    app: { name: "Example", bundleIdentifier: "com.example", version: "1", build: "1" },
    configuration: "Debug", remoteBaseUrl: "https://example.test", expiresAt: new Date(now + 60_000).toISOString(),
    artifacts: { ipaPath: "/private/app.ipa" }, logs: ["unused diagnostic".repeat(1000), "[CODESIGN_FAILED] last diagnostic"],
    installation: { state: "launch-confirmed", launchConfirmedAt: new Date(now - 1000).toISOString() },
    liveReload: { eligible: true, presentation: { targetAppName: "Example", launchURL: "example://" }, recovery: { provenance: {
      projectPath: "/tmp/Example.xcodeproj", scheme: "Example", sourceFiles: [{ source: "not for notification discovery".repeat(1000) }],
    } } },
  }));
  const compact = activityBuildView({ builds: new Map(rows.map(r => [r.id, r])) });
  assert.equal(compact.length, 510, "older retained builds still resolve existing activity");
  assert(JSON.stringify(compact).length < JSON.stringify(rows).length / 10);
  const knownEvents = [{ id: "old-event", buildId: "build-509", kind: "build-ready" }];
  assert.deepEqual(activitySnapshotEvents({ builds: compact, knownEvents, now }), activitySnapshotEvents({ builds: rows, knownEvents, now }));
});
