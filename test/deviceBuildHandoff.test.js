import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { once } from "node:events";
import { DeviceBuildStore } from "../mac-helper/src/deviceBuildStore.js";
import { admitIPA, POST_DOWNLOAD_MS } from "../mac-helper/src/deviceBuildHandoff.js";
import { deliverSavedBuild, foregroundInstallFence } from "../mac-helper/src/buildDelivery.js";
import { handlePublicDeviceBuildCapability } from "../mac-helper/src/deviceBuildCapabilityBoundaryPreload.js";
import { serveFile } from "../mac-helper/src/fileServer.js";
import { createSqliteDeviceBuildStore } from "../mac-helper/src/persistence/phase4DeviceBuildStore.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";
import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/deviceBuildSqliteSchema.js";

function fixture(t, sqlite = false) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-handoff-"));
  const database = sqlite && new SwiftSimSqliteDatabase({ path: join(root, "state.sqlite"), migrations: DEVICE_BUILD_SQLITE_MIGRATIONS });
  t.after(() => { database && database.close(); rmSync(root, { recursive: true, force: true }); });
  const store = database ? createSqliteDeviceBuildStore({ database, legacyPath: join(root, "builds.json"), maintenance: false })
    : new DeviceBuildStore({ path: join(root, "builds.json"), maintenance: false });
  let clock = Date.now();
  function build(number) {
    const b = store.create({ scheme: "Fixture" });
    Object.assign(b, { state: "ready", createdAt: new Date(clock - (3 - number) * 1000).toISOString(),
      expiresAt: new Date(clock + 60_000).toISOString(), project: "/fixture/App.xcodeproj",
      app: { name: "Fixture", bundleIdentifier: "fixture.app", teamID: "fixture", version: "1", build: String(number) },
      signing: { ...b.signing, deviceInstallable: true }, artifacts: { ...b.artifacts, ipaPath: join(root, "fixture.ipa") } });
    store.save(b); return b;
  }
  const old = build(1), target = build(2);
  writeFileSync(old.artifacts.ipaPath, Buffer.alloc(2 * 1024 * 1024));
  writeFileSync(join(root, "install-requests.json"), JSON.stringify([
    { id: old.id, selector: { bundle_id: "fixture.app" }, state: "unconfirmed", expiresAt: clock / 1000 + 60 },
  ]), { mode: 0o600 });
  const options = { now: () => clock, identity: () => ({ startToken: "fixture-owner" }) };
  return { root, store, old, target, options, advance: ms => { clock += ms; },
    admit: deviceUDID => admitIPA(store, old.id, old.token, { ...options, deviceUDID }),
    fence: observe => foregroundInstallFence(target, root, clock / 1000, { store, ...options, observe }),
  };
}

test("unstarted handoff is atomically revoked before native delivery; current and historical capabilities return 410", async t => {
  const f = fixture(t);
  f.old.capabilities = [{ token: "historical-fixture", expiresAt: f.old.expiresAt }]; f.store.save(f.old);
  assert.equal(await foregroundInstallFence(f.target, f.root, f.options.now() / 1000, { store: f.store, supersede: false }), null);
  assert.equal(f.store.get(f.old.id).tokenExpiredAt, "", "status does not revoke an unstarted link");
  const result = await deliverSavedBuild({ buildID: f.target.id, project: f.target.project, scheme: f.target.scheme,
    readBuild: id => f.store.get(id), maintain: async () => {}, foregroundFence: () => f.fence(),
    prompt: async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" }),
    direct: async () => {
      assert.equal(f.store.get(f.old.id).ipaTransfer.state, "superseded");
      assert.equal(f.admit().status, 410, "authorization read before revocation cannot admit afterward");
      return { state: "installed" };
    } });
  assert.equal(result.state, "installed");
  const replay = await deliverSavedBuild({ buildID: f.old.id, readBuild: id => f.store.get(id),
    direct: () => { throw Error("superseded builds never reinstall"); } });
  assert.equal(replay.state, "superseded"); assert.equal(replay.code, "INSTALL_SUPERSEDED");
  f.store.save(f.old); // A stale writer must not revive admission or erase terminal state.
  for (const token of [f.old.token, "historical-fixture"]) for (const artifact of ["manifest", "ipa"]) {
    const response = { writeHead(status) { this.status = status; }, end() {} };
    assert.equal(await handlePublicDeviceBuildCapability({ method: "GET", headers: {},
      url: `/api/device-builds/${f.old.id}/artifact/${artifact}?token=${token}` }, response,
    { pairingStore: { tokenMatches: () => false }, deviceBuildStore: f.store }), true);
    assert.equal(response.status, 410);
  }
});

test("SQLite authority retains stream evidence and supersession across stale saves", async t => {
  const f = fixture(t, true), lease = f.admit();
  assert.equal((await f.fence()).code, "INSTALL_DOWNLOAD_IN_PROGRESS");
  lease.finish(true);
  assert.equal(await f.fence(async () => ({ state: "installed-version-observed", deviceUDID: "only-phone", soleProfileDevice: true,
    observedAt: new Date(f.options.now()).toISOString() })), null);
  f.store.save(f.old); lease.finish(false);
  assert.equal(f.store.get(f.old.id).ipaTransfer.state, "superseded");
  assert.equal(f.admit().status, 410);
});

test("an admitted stream fences another build and rejects overlapping admission without overwriting its receipt", async t => {
  const f = fixture(t), lease = f.admit();
  assert.equal(lease.status, 200); assert.equal(f.admit().status, 409);
  const fence = await f.fence(() => { throw Error("active downloads are not reconciled away"); });
  assert.equal(fence.code, "INSTALL_DOWNLOAD_IN_PROGRESS"); assert.equal(fence.nextAction, "wait");
  assert.equal(fence.resolvesAt, f.old.expiresAt);
  const other = new DeviceBuildStore({ path: f.store.path, maintenance: false });
  assert.equal(other.get(f.old.id).ipaTransfer.state, "streaming");
  lease.finish(false);
  assert.equal(await f.fence(), null);
});

test("completed download fences only for the post-download budget, independently of link expiry", async t => {
  const f = fixture(t), lease = f.admit();
  f.advance(10); lease.finish(true);
  const completed = f.options.now();
  f.advance(60_000);
  const fence = await f.fence(async () => ({ state: "not-found" }));
  assert.equal(fence.code, "INSTALL_HANDOFF_PENDING"); assert.equal(fence.nextAction, "check-status");
  assert.equal(Date.parse(fence.resolvesAt), completed + POST_DOWNLOAD_MS);
  f.advance(POST_DOWNLOAD_MS - 60_000);
  assert.equal(await f.fence(), null);
  assert.equal(f.store.get(f.old.id).ipaTransfer.state, "superseded");
});

test("only fresh inventory for the actual recipient can resolve a completed handoff", async t => {
  const f = fixture(t); f.admit("phone-B").finish(true);
  assert.equal(f.store.get(f.old.id).ipaTransfer.deviceUDID, "phone-B");
  let observed = 0;
  assert.equal((await f.fence(async () => ({ state: "installed-version-observed", deviceUDID: "phone-A", boundDeviceVerified: true,
    observedAt: new Date(f.options.now()).toISOString() }))).code, "INSTALL_HANDOFF_PENDING");
  assert.equal((await f.fence(async () => ({ state: "installed-version-observed", deviceUDID: "phone-B",
    observedAt: new Date(0).toISOString() }))).code, "INSTALL_HANDOFF_PENDING");
  assert.equal(await f.fence(async old => {
    observed++; assert.equal(old.id, f.old.id); return { state: "installed-version-observed", deviceUDID: "phone-B",
      observedAt: new Date(f.options.now()).toISOString() };
  }), null);
  assert.equal(observed, 1); assert.equal(f.store.get(f.old.id).ipaTransfer.state, "superseded");
});

test("an anonymous handoff requires sole-device profile proof before it can settle early", async t => {
  const f = fixture(t); f.admit().finish(true);
  const observedAt = new Date(f.options.now()).toISOString();
  const proof = { state: "installed-version-observed", deviceUDID: "phone-A", observedAt };
  assert.equal((await f.fence(async () => ({ ...proof, boundDeviceVerified: true }))).code, "INSTALL_HANDOFF_PENDING");
  assert.equal(await f.fence(async () => ({ ...proof, soleProfileDevice: true })), null);
  assert.equal(f.store.get(f.old.id).ipaTransfer.completedDeviceUDID, "phone-A");
});

test("a newer failed download retains the preceding completion and its recipient", async t => {
  const f = fixture(t);
  f.admit("phone-A").finish(true);
  f.advance(10);
  f.admit("phone-B").finish(false);
  const result = await deliverSavedBuild({ buildID: f.target.id, project: f.target.project, scheme: f.target.scheme,
    device: "phone-B", store: f.store, readBuild: id => f.store.get(id), maintain: async () => {},
    prompt: async () => ({ code: "INSTALL_REQUEST_NOT_FOUND" }),
    direct: async (_, options) => {
      assert.equal(options.observe, true);
      assert.equal(options.transferDevice, "phone-A");
      return { state: "installed-version-observed", deviceUDID: "phone-B", observedAt: new Date().toISOString() };
    } });
  assert.equal(result.code, "INSTALL_HANDOFF_PENDING");
});

test("reused gateway identity cannot leave a dead stream fencing forever", async t => {
  const f = fixture(t); f.admit();
  f.options.identity = () => ({ startToken: "replacement-owner" });
  assert.equal(await f.fence(), null);
  assert.equal(f.store.get(f.old.id).ipaTransfer.state, "superseded");
});

function response(t) {
  let first, resume;
  const started = new Promise(resolve => { first = resolve; });
  const res = new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) {
    if (!resume) { resume = callback; first(); } else callback();
  } });
  res.writeHead = status => { res.statusCode = status; res.headersSent = true; };
  t.after(() => res.destroy());
  return { res, started, resume: () => resume() };
}

test("file serving persists admission before bytes and completion only after the response finishes", async t => {
  const f = fixture(t), r = response(t), done = once(r.res, "finish");
  serveFile(r.res, f.old.artifacts.ipaPath, { contentType: "application/octet-stream", notFound: assert.fail, admit: f.admit });
  await r.started;
  assert.equal((await f.fence()).code, "INSTALL_DOWNLOAD_IN_PROGRESS");
  r.resume(); await done;
  assert.equal(f.store.get(f.old.id).ipaTransfer.state, "completed");
  assert.equal((await f.fence()).code, "INSTALL_HANDOFF_PENDING");
});

test("a disconnected or expired stream records abortion and cannot leave a completed-download fence", async t => {
  for (const expired of [false, true]) {
    const f = fixture(t), r = response(t);
    if (expired) { f.old.expiresAt = new Date(Date.now() + 30).toISOString(); f.store.save(f.old); }
    const closed = once(r.res, "close");
    serveFile(r.res, f.old.artifacts.ipaPath, { contentType: "application/octet-stream", notFound: assert.fail, admit: f.admit });
    if (!expired) { await r.started; r.res.destroy(); }
    await closed;
    assert.equal(f.store.get(f.old.id).ipaTransfer.state, "aborted");
    assert.equal(await f.fence(), null);
  }
});
