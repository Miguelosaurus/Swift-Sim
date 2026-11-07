import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { createSqliteDeviceBuildStore } from "../mac-helper/src/persistence/phase4DeviceBuildStore.js";
import { deliverSavedBuild } from "../mac-helper/src/buildDelivery.js";
import { publicDeviceApp } from "../mac-helper/src/deviceBuilderCore.js";

function fixture(t, backend) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-native-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const factory = createPhase4ProductionStoreFactories({ stateRoot: root, deviceMaintenance: false });
  t.after(() => factory.database.close());
  const store = backend === "sqlite" ? createSqliteDeviceBuildStore({ database: factory.database, legacyPath: join(root, "builds.json"), maintenance: false }) : factory.createDeviceBuildStore();
  const build = store.create({ scheme: "Example" });
  Object.assign(build, { state: "ready", project: join(root, "Example.xcodeproj"),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    app: { ...build.app, name: "Example", bundleIdentifier: "example.native", teamID: "TEAM", version: "1", build: "42" },
    signing: { ...build.signing, deviceInstallable: true } });
  store.save(build);
  return { store, build, input: { buildID: build.id, project: build.project, scheme: build.scheme,
    readBuild: id => store.get(id), saveVerification: (id, proof) => store.saveVerification(id, proof),
    prompt: async () => ({ code: "INSTALL_REQUEST_NOT_FOUND" }) } };
}
for (const backend of ["legacy", "sqlite"]) test(`${backend}: native install reaches durable app history/public Companion payload without an install-link tap`, async t => {
  const f = fixture(t, backend); const observedAt = new Date(Date.now() - 2000).toISOString();
  const older = f.store.create({ scheme: "Example" });
  f.store.save({ ...f.build, id: older.id, app: { ...f.build.app, build: "41" },
    createdAt: new Date(Date.parse(f.build.createdAt) - 1000).toISOString() });
  const result = await deliverSavedBuild({ ...f.input, direct: async () => ({ state: "installed", observedAt, launchRequested: true }) });
  assert.equal(result.state, "installed");
  assert.equal(f.store.listApps().length, 1);
  const app = publicDeviceApp(f.store.listApps()[0]);
  assert.equal(app.builds[0].id, f.build.id);
  assert.equal(app.builds[0].installation.state, "verified");
  assert.equal(app.builds[0].installation.source, "apple-device");
  assert.equal(app.builds[0].installation.verifiedAt, observedAt);
  assert.equal(app.builds[0].installation.devices[0].build, "42");
  assert.equal(app.builds[0].installation.requestedAt, "");
  assert.equal(app.builds[1].app.build, "41");
  assert.equal(app.builds[1].installation.state, "unknown");
  assert.doesNotMatch(JSON.stringify(app.builds[0].installation), /udid|pairing_file|executable_uuid/);
});
for (const backend of ["legacy", "sqlite"]) test(`${backend}: replayed native receipt cannot overwrite a newer different Xcode version or make its status fresh`, async t => {
  const f = fixture(t, backend); const observedAt = new Date(Date.now() - 10000).toISOString();
  const direct = async () => ({ state: "installed", observedAt });
  await deliverSavedBuild({ ...f.input, direct });
  f.store.saveVerification(f.build.id, { state: "different-version", devices: [{ name: "iPhone", state: "different-version", version: "1", build: "43" }] });
  const before = f.store.get(f.build.id).installation;
  const result = await deliverSavedBuild({ ...f.input, direct, status: true });
  assert.equal(result.state, "different-version");
  assert.equal(result.code, "INSTALL_RECEIPT_SUPERSEDED");
  assert.deepEqual(f.store.get(f.build.id).installation, before);
  assert.equal(publicDeviceApp(f.store.listApps()[0]).builds[0].installation.state, "different-version");
});
for (const backend of ["legacy", "sqlite"]) test(`${backend}: native replay is idempotent; uncertainty or a launch callback alone never marks Installed`, async t => {
  const f = fixture(t, backend); const observedAt = new Date(Date.now() - 2000).toISOString();
  await deliverSavedBuild({ ...f.input, direct: async () => ({ state: "unconfirmed", observedAt, launchRequested: true }) });
  assert.equal(f.store.get(f.build.id).installation.state, "unknown");
  const direct = async () => ({ state: "installed", observedAt });
  await deliverSavedBuild({ ...f.input, direct });
  const before = f.store.get(f.build.id).installation;
  await deliverSavedBuild({ ...f.input, direct });
  assert.deepEqual(f.store.get(f.build.id).installation, before);
});
