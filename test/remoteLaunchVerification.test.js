import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { DeviceBuildStore } from "../mac-helper/src/deviceBuildStore.js";
import { DeviceBuildStore as CoreStore } from "../mac-helper/src/deviceBuildStoreCore.js";
import { createRemoteLaunchVerifier, readQualifiedLaunchCapture } from "../mac-helper/src/remoteLaunchVerification.js";
import { publicDeviceBuild } from "../mac-helper/src/deviceBuilderCore.js";

const fixtureFiles = new NodeAtomicFileStore();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const identity = { bundle_id: "com.example.fixture", bundle_version: "1.0", build_number: "28", executable_uuid: "11111111-1111-1111-1111-111111111111", debug_dylib_uuid: "22222222-2222-2222-2222-222222222222" };
function fixture(Store = DeviceBuildStore) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-launch-confirmation-"));
  const store = new Store({ path: join(root, "builds.json"), maintenance: false });
  let clock = Date.now(); let saves = 0;
  const created = store.create({ scheme: "Example", configuration: "Debug" });
  const source = join(root, "Card.swift"); const project = join(root, "Example.xcodeproj");
  const provenance = { version: 1, binaryIdentity: identity, resultBundle: { logDigest: hash("build log") }, appFingerprint: ["Info.plist", "Example", "Example.debug.dylib", "_CodeSignature/CodeResources"].map((name) => ({ name, hash: hash(name), size: 10, mtimeMs: clock - 1000 })), sourceFiles: [{ path: source, hash: hash("source") }] };
  Object.assign(created, { state: "ready", createdAt: new Date(clock - 2000).toISOString(), project, app: { name: "Example", bundleIdentifier: identity.bundle_id, version: "1.0", build: "28", teamID: "FIXTURETEAM" }, liveReload: { eligible: true, compilerReady: true, recovery: { completedAt: clock - 1000, phase: "packaged", provenance } } });
  store.save(created);
  const capture = { version: 1, binaryIdentity: identity, binding: { projectPath: join(project, "project.pbxproj"), projectRoot: root, scheme: "Example" }, sourceBaselines: { [source]: hash("source") }, registration: { requestId: "registration-request-one", engineNonce: "registration-engine-one", mapDigest: hash("map"), provenanceDigest: hash(provenance), commandCount: 89 } };
  const native = { status: { success: true, data: { prepared_delivery_protocol: 1, engine_instance_nonce: capture.registration.engineNonce, has_connected_client: true, client_capabilities: ["prepared-delivery-v1", "receipt-v1", "replacement-proof-v2"], client_identity: { ...identity, process_nonce: "app-process-one", connection_nonce: "connection-one", root_revision: 0, is_active: true, root_ready: true } } }, registration: { success: true, data: { engine_instance_nonce: capture.registration.engineNonce, registration_id: capture.registration.requestId, current_registration_id: capture.registration.requestId, map_digest: capture.registration.mapDigest, provenance_digest: capture.registration.provenanceDigest, state: "committed", command_count: 89, registered_count: 1, sources: [source] } } };
  const options = { listBuilds: () => store.list(), readCapture: () => structuredClone(capture), inspectClient: async () => structuredClone(native), saveConfirmation(id, proof) { saves++; return store.saveLaunchConfirmation(id, proof); }, now: () => clock };
  return { root, store, created, capture, native, options, service: () => createRemoteLaunchVerifier(options), setClock(value) { clock = value; }, clock: () => clock, saves: () => saves, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("a connected exact Debug app confirms launch remotely without device inventory or a hot patch", async () => {
  const f = fixture();
  try {
    const result = await f.service().runOnce();
    assert.deepEqual(result, { changed: true, buildId: f.created.id });
    const installation = f.store.get(f.created.id).installation;
    assert.equal(installation.state, "launch-confirmed");
    assert.equal(installation.source, "live-client");
    assert.equal(installation.lastSeenAt, new Date(f.clock()).toISOString());
    assert.equal(installation.verifiedAt, "");
    assert.deepEqual(installation.devices, []);
    const projected = publicDeviceBuild(f.store.get(f.created.id)).installation;
    assert.equal(projected.launchConfirmedAt, installation.launchConfirmedAt);
    assert.doesNotMatch(JSON.stringify(projected), /process-one|registration-engine|Fingerprint|executable_uuid|projectPath|sourceFiles/);
  } finally { f.cleanup(); }
});

test("cached status, helper restart and same-process reconnection never advance last-seen history", async () => {
  const f = fixture();
  try {
    await f.service().runOnce();
    const first = f.store.get(f.created.id).installation.lastSeenAt;
    f.setClock(f.clock() + 120_000);
    f.native.status.data.client_identity.connection_nonce = "connection-two";
    f.native.status.data.client_identity.root_revision = 3;
    await f.service().runOnce();
    assert.equal(f.saves(), 1); assert.equal(f.store.get(f.created.id).installation.lastSeenAt, first);
    f.native.status.data.client_identity.process_nonce = "app-process-two";
    // Use a real-time-adjacent observation for the store's trusted-clock fence.
    f.setClock(Date.now() + 1000);
    assert.equal((await f.service().runOnce()).changed, true);
    assert.equal(f.saves(), 2);
  } finally { f.cleanup(); }
});

test("wrong, disconnected, inactive, unready or incomplete native reports cannot confirm a launch", async () => {
  const mutations = [
    (n) => { n.status.success = false; }, (n) => { n.status.data.has_connected_client = false; },
    (n) => { n.status.data.engine_instance_nonce = "another-engine"; }, (n) => { n.status.data.prepared_delivery_protocol = 0; },
    (n) => { n.status.data.client_capabilities = ["receipt-v1"]; }, (n) => { n.status.data.client_capabilities = "prepared-delivery-v1 receipt-v1 replacement-proof-v2"; },
    (n) => { n.status.data.client_identity.is_active = false; }, (n) => { n.status.data.client_identity.root_ready = false; },
    (n) => { delete n.status.data.client_identity.root_revision; }, (n) => { n.status.data.client_identity.root_revision = "0"; },
    (n) => { n.status.data.client_identity.debug_dylib_uuid = "33333333-3333-3333-3333-333333333333"; },
    (n) => { n.status.data.client_identity.build_number = "29"; }, (n) => { n.registration.data.state = "superseded"; },
    (n) => { n.registration.data.map_digest = hash("different"); }, (n) => { n.registration.data.current_registration_id = "another-registration"; },
    (n) => { n.registration.data.command_count = 88; }, (n) => { n.registration.data.registered_count = 0; }, (n) => { n.registration.data.sources = []; }, (n) => { n.registration.data.pending_registration = { registration_id: "another" }; },
  ];
  for (const mutate of mutations) {
    const f = fixture();
    try { mutate(f.native); assert.deepEqual(await f.service().runOnce(), { changed: false }); assert.equal(f.saves(), 0); } finally { f.cleanup(); }
  }
});

test("no new build can inherit another signed binary, project, team or source provenance", async () => {
  const changes = [
    (b) => { b.app.teamID = ""; }, (b) => { b.app.build = "29"; }, (b) => { b.project += "-another"; },
    (b) => { b.scheme = "Another"; }, (b) => { b.liveReload.recovery.provenance.appFingerprint[0].hash = hash("replaced app"); },
    (b) => { b.liveReload.compilerReady = false; }, (b) => { b.configuration = "Release"; }, (b) => { b.state = "failed"; },
    (b) => { b.createdAt = new Date(Date.now() + 60_000).toISOString(); },
  ];
  for (const mutate of changes) {
    const f = fixture();
    try { const build = f.store.get(f.created.id); mutate(build); f.store.save(build); assert.equal((await f.service().runOnce()).changed, false); assert.equal(f.saves(), 0); } finally { f.cleanup(); }
  }
});

test("ambiguous duplicate binary records do not select an arbitrary build", async () => {
  const f = fixture();
  try {
    const duplicate = { ...f.store.get(f.created.id), id: "another-claimed-id" };
    f.options.listBuilds = () => [f.store.get(f.created.id), duplicate];
    assert.equal((await f.service().runOnce()).changed, false); assert.equal(f.saves(), 0);
  } finally { f.cleanup(); }
});

test("capture drift, a slow observation, backward time and stop prevent stale publication", async () => {
  for (const kind of ["capture", "slow", "backward", "stop"]) {
    const f = fixture();
    try {
      let service;
      f.options.inspectClient = async () => {
        if (kind === "capture") f.capture.registration.mapDigest = hash("new capture");
        if (kind === "slow") f.setClock(f.clock() + 5001);
        if (kind === "backward") f.setClock(f.clock() - 1);
        if (kind === "stop") void service.stop();
        return structuredClone(f.native);
      };
      service = f.service();
      assert.equal((await service.runOnce()).changed, false); assert.equal(f.saves(), 0);
    } finally { f.cleanup(); }
  }
});

for (const Store of [CoreStore, DeviceBuildStore]) test(`${Store === CoreStore ? "core" : "runtime"} store preserves launch history against native unknown probes and stale writers`, async () => {
  const f = fixture(Store);
  try {
    const stale = f.store.get(f.created.id);
    await f.service().runOnce();
    f.store.saveVerification(f.created.id, { state: "unknown", devices: [{ state: "unreachable" }] });
    f.store.saveVerification(f.created.id, { state: "different-version", devices: [{ name: "Another phone", state: "different-version" }] });
    f.store.save(stale);
    let installed = f.store.get(f.created.id).installation;
    assert.equal(installed.state, "launch-confirmed"); assert.equal(installed.source, "live-client"); assert.deepEqual(installed.devices, []);
    f.store.markInstallRequested(f.created.id);
    assert.equal(f.store.get(f.created.id).installation.state, "launch-confirmed");
    f.store.saveVerification(f.created.id, { state: "verified", devices: [{ name: "Fixture phone", state: "installed" }] });
    installed = f.store.get(f.created.id).installation;
    assert.equal(installed.state, "verified"); assert.equal(installed.source, "apple-device"); assert.ok(installed.launchConfirmedAt);
  } finally { f.cleanup(); }
});

test("the store transaction rejects a deleted or changed build after native inspection", async () => {
  for (const kind of ["deleted", "changed"]) {
    const f = fixture();
    try {
      f.options.saveConfirmation = (id, proof) => {
        if (kind === "deleted") f.store.withTransaction((state) => { state.builds.delete(id); });
        else { const build = f.store.get(id); build.app.build = "29"; f.store.save(build); }
        return f.store.saveLaunchConfirmation(id, proof);
      };
      assert.equal((await f.service().runOnce()).changed, false);
      assert.notEqual(f.store.get(f.created.id)?.installation.state, "launch-confirmed");
    } finally { f.cleanup(); }
  }
});

test("qualified capture reads reject public permissions, links and corrupted provenance without writes", () => {
  const f = fixture(); const path = join(f.root, "capture.json");
  try {
    writeFileSync(path, JSON.stringify(f.capture), { mode: 0o600 });
    assert.equal(readQualifiedLaunchCapture(path).registration.commandCount, 89);
    chmodSync(path, 0o644); assert.throws(() => readQualifiedLaunchCapture(path)); chmodSync(path, 0o600);
    const alias = join(f.root, "alias.json"); symlinkSync(path, alias); assert.throws(() => readQualifiedLaunchCapture(alias)); unlinkSync(alias);
    linkSync(path, alias); assert.throws(() => readQualifiedLaunchCapture(path)); unlinkSync(alias);
    f.capture.sourceBaselines[Object.keys(f.capture.sourceBaselines)[0]] = "not-a-hash";
    writeFileSync(path, JSON.stringify(f.capture)); const before = fixtureFiles.readTextSync(path);
    assert.throws(() => readQualifiedLaunchCapture(path)); assert.deepEqual(fixtureFiles.readTextSync(path), before);
  } finally { f.cleanup(); }
});
