import test from "node:test";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import assert from "node:assert/strict";
import { deliverSavedBuild, holdChangedBuild, noForegroundJournal, foregroundInstallFence, maintainForegroundJournal } from "../mac-helper/src/buildDelivery.js";
const emptyStore = { list: () => [] };
const buildID = "11111111-1111-1111-1111-111111111111";
function fixture() {
  const calls = [];
  const build = { id: buildID, state: "ready", signing: { deviceInstallable: true }, preserveData: true,
    expiresAt: new Date(Date.now() + 100000).toISOString(), project: "/tmp/App.xcodeproj", scheme: "App" };
  return { calls, build, input: { buildID, project: build.project, scheme: build.scheme,
    readBuild: () => build, maintain: async () => {}, foregroundFence: () => null,
    direct: async (_, options) => { calls.push(["direct", options]); return { state: "unavailable" }; },
    prompt: async request => { calls.push(["prompt", request.operation]); return request.operation === "status"
      ? { code: "INSTALL_REQUEST_NOT_FOUND" }
      : { outcome: "install-request", buildID, state: "waiting", expiresAt: build.expiresAt }; } } };
}
test("unreachable developer connection queues one foreground request", async () => {
  const f = fixture(); assert.equal((await deliverSavedBuild(f.input)).state, "waiting");
  assert.deepEqual(f.calls.map(c => c[0]), ["prompt", "direct", "prompt"]);
});
for (const state of ["installed", "installed-version-observed", "already-matching-version", "unconfirmed"]) test(`${state} never opens an OTA prompt`, async () => {
  const f = fixture(); f.input.direct = async () => ({ state });
  assert.equal((await deliverSavedBuild(f.input)).state, state);
  assert.deepEqual(f.calls, [["prompt", "status"]]);
});
test("existing OTA request fences native route; status never enqueues", async () => {
  const f = fixture(); f.input.prompt = async () => ({ outcome: "install-request", state: "opening", buildID });
  assert.equal((await deliverSavedBuild(f.input)).state, "opening"); assert.equal(f.calls.length, 0);
  const other = fixture(); other.input.status = true;
  assert.equal((await deliverSavedBuild(other.input)).state, "not-found");
  assert.equal(other.calls.filter(c => c[0] === "prompt").length, 1);
});
test("ambiguous OTA status never switches to native installation", async () => {
  const f = fixture(); f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" }); f.input.foregroundFence = () => ({ code: "INSTALL_HANDOFF_PENDING", nextAction: "check-status" });
  assert.equal((await deliverSavedBuild(f.input)).state, "unconfirmed"); assert.equal(f.calls.length, 0);
});
for (const mutate of [f => f.input.project = "/other/App.xcodeproj", f => f.build.preserveData = false,
  f => f.build.expiresAt = new Date(0).toISOString(), f => f.build.signing.deviceInstallable = false]) test("invalid build/scope never contacts phone", async () => {
  const f = fixture(); mutate(f); assert.equal((await deliverSavedBuild(f.input)).state, "blocked"); assert.equal(f.calls.length, 0);
});

test("a fresh native-only install does not require a running hot reload engine", async () => {
  const f = fixture(); f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" });
  f.input.foregroundFence = () => null;
  f.input.direct = async () => ({ state: "installed" });
  assert.equal((await deliverSavedBuild(f.input)).state, "installed");
});

test("only dated native inventory proof updates normal build history", async () => {
  const f = fixture(); f.build.app = { version: "1", build: "2" }; const saved = [];
  f.input.saveVerification = (_, proof) => saved.push(proof);
  const observedAt = "2026-11-07T20:00:00Z";
  f.input.direct = async () => ({ state: "installed", observedAt, deviceID: "private", rawLog: "private" });
  const result = await deliverSavedBuild(f.input);
  assert.equal(saved[0].verifiedAt, observedAt); assert.equal(saved[0].state, "verified");
  assert.doesNotMatch(JSON.stringify(result), /private|deviceID|rawLog/);
  f.input.direct = async () => ({ state: "unconfirmed" });
  await deliverSavedBuild(f.input); assert.equal(saved.length, 1);
});

test("expired delivery can still reconcile a prior native submission", async () => {
  const f = fixture(); f.input.status = true; f.build.expiresAt = new Date(0).toISOString(); f.build.tokenExpiredAt = "expired";
  f.input.direct = async () => ({ state: "installed-version-observed" });
  assert.equal((await deliverSavedBuild(f.input)).state, "installed-version-observed");
});

test("a mixed-source automatic build is failed and its install capability expires", async () => {
  const build = { state: "ready", logs: [] }; let saved;
  await holdChangedBuild(buildID, { get: () => build, save: value => { saved = value; } });
  assert.equal(saved.state, "failed"); assert.ok(saved.tokenExpiredAt);
  let writes = 0;
  await holdChangedBuild(buildID, { get: () => null, save: () => { writes++; } });
  assert.equal(writes, 0);
});


test("old or corrupt foreground journals cannot fence a native install without gateway evidence", async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "swift-sim-route-fence-"));
  chmodSync(root, 0o700); t.after(() => rmSync(root, { recursive: true, force: true }));
  const build = { app: { bundleIdentifier: "app" } };
  mkdirSync(join(root, "live"), { mode: 0o700 });
  writeFileSync(join(root, "live", "install-requests.json"), "[]", { mode: 0o600 });
  writeFileSync(join(root, "install-requests.json"), JSON.stringify([{selector:{bundle_id:"app"},state:"unconfirmed"}]), { mode: 0o600 });
  assert.equal(await noForegroundJournal(build, root, undefined, { store: emptyStore }), true);
  writeFileSync(join(root, "install-requests.json"), "{");
  assert.equal(await noForegroundJournal(build, root, undefined, { store: emptyStore }), true);
  writeFileSync(join(root, "install-requests.json"), "[]");
  assert.equal(await noForegroundJournal(build, root, undefined, { store: emptyStore }), true);
});

async function journalFixture(t, entries) {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-install-history-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "install-requests.json");
  writeFileSync(path, JSON.stringify(entries), { mode: 0o600 });
  return { directory, read: () => new NodeAtomicFileStore().readJSONSync(path),
    maintenance: { directory, now: 1000000, lock: async fn => fn(), assertStopped() {} } };
}
const oldRequest = (state, expiresAt, number = 2) => ({
  id: `11111111-1111-1111-1111-${String(number).padStart(12, "0")}`,
  selector: { bundle_id: "fixture.app" }, state, expiresAt,
});

test("expired older handoffs are pruned and cannot block a new native build while the engine is down", async t => {
  const j = await journalFixture(t, [oldRequest("prompt-requested", 1000000 - 86401)]);
  const f = fixture(); f.build.app = { bundleIdentifier: "fixture.app" };
  f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" });
  f.input.foregroundFence = b => foregroundInstallFence(b, j.directory, 1000000, { store: emptyStore });
  f.input.maintain = () => maintainForegroundJournal(j.maintenance);
  f.input.direct = async () => { f.calls.push(["native"]); return { state: "installed" }; };
  assert.equal((await deliverSavedBuild(f.input)).state, "installed");
  assert.deepEqual(f.calls, [["native"]]); assert.deepEqual(j.read(), []);
});

for (const state of ["waiting", "opening", "prompt-requested", "unconfirmed"]) test(`${state} without an admitted IPA is superseded before the new native install`, async t => {
  const entry = oldRequest(state, 1000060), j = await journalFixture(t, [entry]);
  const f = fixture(); f.build.app = { bundleIdentifier: "fixture.app" };
  f.build.createdAt = new Date(1000000 * 1000).toISOString();
  const old = { id: entry.id, app: f.build.app, createdAt: new Date(0).toISOString() };
  const store = { list: () => [old], withTransaction: fn => fn({ builds: new Map([[old.id, old]]) }) };
  f.input.prompt = async () => ({ code: "INSTALL_REQUEST_NOT_FOUND" });
  f.input.foregroundFence = b => foregroundInstallFence(b, j.directory, 1000000, { store });
  f.input.direct = async () => {
    assert.equal(old.ipaTransfer.state, "superseded"); assert.ok(old.tokenExpiredAt);
    return { state: "installed" };
  };
  assert.equal((await deliverSavedBuild(f.input)).state, "installed");
  assert.equal(j.read().length, 1, "the replay tombstone remains engine-owned");
});

test("cancellation preserves bounded tombstones, prunes old history, and never writes over a running engine", async t => {
  const entries = Array.from({ length: 32 }, (_, i) => oldRequest("cancelled", 1000000 - 86401, i + 2));
  entries[0] = oldRequest("waiting", 1000060);
  const j = await journalFixture(t, entries);
  await assert.rejects(maintainForegroundJournal({ ...j.maintenance, assertStopped() { throw Error("engine active"); } }), /engine active/);
  assert.deepEqual(j.read(), entries);
  const cancelled = await maintainForegroundJournal({ ...j.maintenance, cancelID: entries[0].id });
  assert.equal(cancelled.state, "cancelled"); assert.equal(j.read().length, 1);
  assert.equal(await noForegroundJournal({ app: { bundleIdentifier: "fixture.app" } }, j.directory, 1000000, { store: emptyStore }), true);
  await maintainForegroundJournal({ ...j.maintenance, now: 1000060 + 86400 });
  assert.deepEqual(j.read(), []);
});

test("native uncertainty keeps its actionable reason in the delivery result", async () => {
  const f = fixture(); f.input.direct = async () => ({ state: "unconfirmed", code: "INSTALL_RECONCILE_REQUIRED",
    nextAction: "check-status", message: "Reconnect the original phone and check inventory." });
  const result = await deliverSavedBuild(f.input);
  assert.equal(result.code, "INSTALL_RECONCILE_REQUIRED"); assert.equal(result.nextAction, "check-status");
});

test("a different native signing team fences the foreground route even without a submission", async () => {
  const f = fixture();
  f.input.direct = async () => ({ state: "blocked", code: "EXISTING_APP_TEAM_UNCONFIRMED", nextAction: "check-mac" });
  const result = await deliverSavedBuild(f.input);
  assert.equal(result.state, "blocked");
  assert.equal(result.code, "EXISTING_APP_TEAM_UNCONFIRMED");
  assert.deepEqual(f.calls, [["prompt", "status"]]);
});

test("notification failure remains visible without bypassing the installation fence", async () => {
  const f = fixture();
  f.build.notification = { code: "NOTIFICATION_UNAVAILABLE", message: "Check the Mac.", nextAction: "check-mac" };
  f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" });
  f.input.foregroundFence = () => ({ code: "INSTALL_HANDOFF_PENDING", nextAction: "check-status" });
  const result = await deliverSavedBuild(f.input);
  assert.equal(result.state, "unconfirmed");
  assert.equal(result.code, "INSTALL_HANDOFF_PENDING");
  assert.equal(result.nextAction, "check-status");
  assert.deepEqual(result.notification, f.build.notification);
  assert.deepEqual(f.calls, []);
});

test("a blocked foreground fallback preserves engine-unavailable guidance", async () => {
  const f = fixture();
  const guidance = "The Mac live engine is not responding. No new install request was queued.";
  f.input.prompt = async request => request.operation === "status"
    ? { code: "INSTALL_REQUEST_NOT_FOUND" }
    : { outcome: "needs-user-action", code: "INSTALL_ENGINE_UNAVAILABLE", nextAction: "check-mac", guidance };
  const result = await deliverSavedBuild(f.input);
  assert.equal(result.state, "blocked"); assert.equal(result.code, "INSTALL_ENGINE_UNAVAILABLE");
  assert.equal(result.nextAction, "check-mac"); assert.equal(result.message, guidance);
});
