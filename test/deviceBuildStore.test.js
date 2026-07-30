import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DeviceBuildStore,
  MAX_DEVICE_BUILD_LOG_LINES,
  deviceAppIdentity,
} from "../mac-helper/src/deviceBuildStore.js";

function withStore(run) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-store-test-"));
  try {
    return run(new DeviceBuildStore({ path: join(directory, "builds.json") }), directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function completeBuild(store, name, bundleIdentifier, teamID, version, buildNumber) {
  const build = store.create({ scheme: name });
  build.app = {
    identity: deviceAppIdentity({ bundleIdentifier, teamID }),
    name,
    bundleIdentifier,
    teamID,
    version,
    build: buildNumber,
  };
  build.state = "ready";
  store.save(build);
  return build;
}

test("device builds group under one stable app identity", () => withStore((store) => {
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.1", "2");

  const apps = store.listApps();
  assert.equal(apps.length, 1);
  assert.equal(apps[0].builds.length, 2);
  assert.equal(apps[0].bundleIdentifier, "com.example.app");
}));

test("build numbers advance for repeated Swift Sim builds of the same app", () => withStore((store) => {
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "2");

  assert.equal(
    store.nextBuildNumber(
      { bundleIdentifier: "com.example.app", teamID: "TEAM123" },
      "1"
    ),
    "3"
  );
}));

test("a higher project build number remains authoritative", () => withStore((store) => {
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "4");

  assert.equal(
    store.nextBuildNumber(
      { bundleIdentifier: "com.example.app", teamID: "TEAM123" },
      "20"
    ),
    "20"
  );
}));

test("same bundle signed by another team remains a different app", () => withStore((store) => {
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  completeBuild(store, "Example", "com.example.app", "TEAM999", "1.0", "1");
  assert.equal(store.listApps().length, 2);
}));

test("failed builds without a resolved app identity do not create duplicate catalog rows", () => withStore((store) => {
  store.create({ project: "/tmp/Example.xcodeproj", scheme: "Example" });
  store.create({ project: "/tmp/Example.xcodeproj", scheme: "Example" });
  assert.equal(store.listApps().length, 0);
}));

test("Swift Sim QA builds are archived while real project builds remain visible", () => withStore((store) => {
  const qa = store.create({
    project: "/Users/test/Swift-Sim/.build/qa-device-probe/UpdateProbe.xcodeproj",
    scheme: "UpdateProbe",
  });
  qa.app = {
    identity: deviceAppIdentity({
      bundleIdentifier: "com.seaandsea.SwiftSimUpdateProbe",
      teamID: "TEAM123",
    }),
    name: "Update Probe",
    bundleIdentifier: "com.seaandsea.SwiftSimUpdateProbe",
    teamID: "TEAM123",
  };
  qa.state = "ready";
  store.save(qa);
  completeBuild(store, "Customer App", "com.example.customer", "TEAM123", "1.0", "1");

  assert.deepEqual(store.listApps().map((app) => app.name), ["Customer App"]);
  assert.equal(store.listApps({ includeArchived: true }).length, 2);
}));

test("device build logs stay bounded to the user-visible diagnostic tail", () => withStore((store) => {
  const build = store.create({ scheme: "Example" });
  build.logs = Array.from(
    { length: MAX_DEVICE_BUILD_LOG_LINES + 25 },
    (_, index) => `line-${index}`
  );
  store.save(build);

  const saved = store.get(build.id);
  assert.equal(saved.logs.length, MAX_DEVICE_BUILD_LOG_LINES);
  assert.equal(saved.logs[0], "line-25");
  assert.equal(saved.logs.at(-1), `line-${MAX_DEVICE_BUILD_LOG_LINES + 24}`);
}));

test("queued builds preserve TTL without starting the install-link clock", () => withStore((store) => {
  const build = store.create({ scheme: "Example", ttlMinutes: 45 });
  assert.equal(build.ttlMinutes, 45);
  assert.equal(build.expiresAt, "");
  assert.equal(build.delivery.expiresAt, "");
}));

test("archive hides an app without deleting its build history", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const appID = build.app.identity;
  store.setAppArchived(appID, true);
  assert.equal(store.listApps().length, 0);
  assert.equal(store.listApps({ includeArchived: true })[0].archivedAt.length > 0, true);
  assert.equal(store.get(build.id)?.state, "ready");
}));

test("install requests and verification persist without exposing a device id", () => withStore((store, directory) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "verified",
    verifiedAt: "2026-07-03T00:00:00.000Z",
    devices: [{ name: "Test iPhone", state: "installed", version: "1.0", build: "1" }],
  });
  const saved = store.get(build.id);
  assert.equal(saved.installation.state, "verified");
  assert.equal(saved.installation.devices[0].name, "Test iPhone");
  assert.equal(readFileSync(join(directory, "builds.json"), "utf8").includes("Test iPhone"), true);
}));

test("an inconclusive check preserves a known install request", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "unknown",
    verifiedAt: "2026-07-03T00:00:00.000Z",
    devices: [{ name: "Test iPhone", state: "unreachable", version: "", build: "" }],
  });

  const saved = store.get(build.id);
  assert.equal(saved.installation.state, "requested");
  assert.equal(saved.installation.verifiedAt, "");
  assert.equal(saved.installation.devices[0].state, "unreachable");
}));

test("a different installed version remains actionable", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "different-version",
    devices: [{ name: "Test iPhone", state: "different-version", version: "0.9", build: "8" }],
  });

  assert.equal(store.get(build.id).installation.state, "different-version");
}));

test("an expired build can generate a new install link from its saved app", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.expiresAt = "2026-01-01T00:00:00.000Z";
  build.remoteBaseUrl = "https://old-link.example.com";
  build.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: "2026-01-01T00:00:00.000Z",
  };
  store.save(build);

  const renewed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  assert.ok(Date.parse(renewed.expiresAt) > Date.now() + 59 * 60 * 1000);
  assert.equal(renewed.remoteBaseUrl, "");
  assert.equal(renewed.delivery.mode, "quick-tunnel");
  assert.equal(renewed.state, "ready");
}));

test("a phone rebuild clones the private recipe and preserves update identity", () => withStore((store) => {
  const source = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  source.project = "/private/Example.xcodeproj";
  source.configuration = "Debug";
  source.exportMethod = "development";
  source.buildSettings = ["PRODUCT_NAME=Example"];
  source.allowProvisioningUpdates = true;
  source.preserveData = false;
  store.save(source);

  const rebuild = store.createRebuild(source, {
    appID: source.app.identity,
    idempotencyKey: "request-1234",
  });

  assert.equal(rebuild.project, "/private/Example.xcodeproj");
  assert.equal(rebuild.configuration, "Debug");
  assert.deepEqual(rebuild.buildSettings, ["PRODUCT_NAME=Example"]);
  assert.equal(rebuild.allowProvisioningUpdates, true);
  assert.equal(rebuild.preserveData, true);
  assert.equal(rebuild.app.bundleIdentifier, "com.example.app");
  assert.equal(rebuild.rebuild.expectedTeamID, "TEAM123");
}));

test("phone rebuild lookup deduplicates retries and active requests", () => withStore((store) => {
  const source = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  source.project = "/private/Example.xcodeproj";
  store.save(source);
  const appID = source.app.identity;
  const rebuild = store.createRebuild(source, {
    appID,
    idempotencyKey: "request-1234",
  });

  assert.equal(store.findRebuild({ appID, idempotencyKey: "request-1234" })?.id, rebuild.id);
  assert.equal(store.findRebuild({ appID, activeOnly: true })?.id, rebuild.id);
  rebuild.state = "failed";
  store.save(rebuild);
  assert.equal(store.findRebuild({ appID, activeOnly: true }), null);
}));

test("only a successful build with a complete private recipe can be reused", () => withStore((store) => {
  const source = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  assert.equal(store.latestReusableBuildForApp(source.app.identity), null);
  source.workspace = "/private/Example.xcworkspace";
  store.save(source);
  assert.equal(store.latestReusableBuildForApp(source.app.identity)?.id, source.id);
}));
