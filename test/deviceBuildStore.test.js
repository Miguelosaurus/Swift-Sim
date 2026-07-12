import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceBuildStore, deviceAppIdentity } from "../mac-helper/src/deviceBuildStore.js";

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

test("same bundle signed by another team remains a different app", () => withStore((store) => {
  completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  completeBuild(store, "Example", "com.example.app", "TEAM999", "1.0", "1");
  assert.equal(store.listApps().length, 2);
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
