import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  build.logs = Array.from({ length: MAX_DEVICE_BUILD_LOG_LINES + 25 }, (_, index) => `line-${index}`);
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

test("a stale builder save cannot erase requested installation state", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const stale = structuredClone(build);
  store.markInstallRequested(build.id);
  stale.installation = { state: "unknown", requestedAt: "", verifiedAt: "", updatedAt: "", devices: [] };
  store.save(stale);
  assert.equal(store.get(build.id).installation.state, "requested");
}));

test("a stale builder save cannot erase verified installation state", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const stale = structuredClone(build);
  store.saveVerification(build.id, {
    state: "verified",
    verifiedAt: "2026-07-03T00:00:00.000Z",
    devices: [{ name: "Test iPhone", state: "installed", version: "1.0", build: "1" }],
  });
  stale.installation = { state: "unknown", requestedAt: "", verifiedAt: "", updatedAt: "", devices: [] };
  store.save(stale);
  assert.equal(store.get(build.id).installation.state, "verified");
}));

test("a newer different-version observation supersedes stale verified state", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  store.saveVerification(build.id, {
    state: "verified",
    verifiedAt: "2026-07-03T00:00:00.000Z",
    devices: [{ name: "Test iPhone", state: "installed", version: "1.0", build: "1" }],
  });
  const staleVerified = store.get(build.id);
  staleVerified.installation.updatedAt = "2026-01-01T00:00:00.000Z";
  store.saveVerification(build.id, {
    state: "different-version",
    devices: [{ name: "Test iPhone", state: "different-version", version: "2.0", build: "9" }],
  });
  store.save(staleVerified);
  assert.equal(store.get(build.id).installation.state, "different-version");
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

test("staging renewal does not mutate the active link", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://old-link.example.com";
  build.delivery = { mode: "quick-tunnel", provider: "cloudflare-quick-tunnel", expiresAt: build.expiresAt };
  store.save(build);
  const oldToken = build.token;
  const oldExpiry = build.expiresAt;
  const candidate = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  const active = store.get(build.id);
  assert.equal(active.token, oldToken);
  assert.equal(active.expiresAt, oldExpiry);
  assert.equal(active.remoteBaseUrl, "https://old-link.example.com");
  assert.ok(active.pendingRenewal?.id);
  assert.equal(candidate.expiresAt, "");
  assert.equal(candidate.installTTLMinutes, 60);
}));

test("concurrent renewals join the same lease", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const first = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  const second = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  assert.equal(second.pendingRenewal.id, first.pendingRenewal.id);
  assert.equal(second.pendingRenewal.token, first.pendingRenewal.token);
  assert.equal(second.expiresAt, first.expiresAt);
}));

test("a renewed token is committed only after delivery becomes ready", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const oldToken = build.token;
  const renewed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  assert.equal(renewed.token, oldToken);
  assert.ok(renewed.pendingRenewal?.token);
  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  renewed.delivery.expiresAt = new Date(Date.now() + 70 * 60_000).toISOString();
  store.save(renewed);
  const committed = store.get(build.id);
  assert.notEqual(committed.token, oldToken);
  assert.equal(committed.pendingRenewal, undefined);
  assert.equal(committed.remoteBaseUrl, "https://new-link.example.com");
}));

test("a failed renewal waiter preserves the previous link and shared lease", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://old-link.example.com";
  build.delivery = { mode: "quick-tunnel", provider: "cloudflare-quick-tunnel", expiresAt: build.expiresAt };
  store.save(build);
  const oldToken = build.token;
  const oldExpiry = build.expiresAt;
  const oldDelivery = structuredClone(build.delivery);
  const renewed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  const leaseID = renewed.pendingRenewal.id;
  renewed.expiresAt = oldExpiry;
  renewed.remoteBaseUrl = "https://old-link.example.com";
  renewed.delivery = oldDelivery;
  store.save(renewed);
  const rolledBack = store.get(build.id);
  assert.equal(rolledBack.token, oldToken);
  assert.equal(rolledBack.expiresAt, oldExpiry);
  assert.equal(rolledBack.pendingRenewal.id, leaseID);
}));

test("one failed renewal waiter cannot cancel another successful waiter", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://old-link.example.com";
  build.delivery = { mode: "quick-tunnel", provider: "cloudflare-quick-tunnel", expiresAt: build.expiresAt };
  store.save(build);
  const oldToken = build.token;
  const failed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  const successful = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  failed.expiresAt = failed.pendingRenewal.previous.expiresAt;
  failed.remoteBaseUrl = failed.pendingRenewal.previous.remoteBaseUrl;
  failed.delivery = structuredClone(failed.pendingRenewal.previous.delivery);
  store.save(failed);
  successful.remoteBaseUrl = "https://new-link.example.com";
  successful.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  successful.delivery.expiresAt = new Date(Date.now() + 70 * 60_000).toISOString();
  store.save(successful);
  const committed = store.get(build.id);
  assert.notEqual(committed.token, oldToken);
  assert.equal(committed.remoteBaseUrl, "https://new-link.example.com");
  assert.equal(committed.pendingRenewal, undefined);
}));

test("an abandoned renewal lease rolls back on restart", () => withStore((store, directory) => {
  const path = join(directory, "builds.json");
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const oldToken = build.token;
  const oldExpiry = build.expiresAt;
  store.renewInstallLink(build.id, { ttlMinutes: 60 });
  const persisted = JSON.parse(readFileSync(path, "utf8"));
  persisted.builds[0].pendingRenewal.deadlineAt = "2026-01-01T00:00:00.000Z";
  writeFileSync(path, JSON.stringify(persisted, null, 2));
  const restarted = new DeviceBuildStore({ path });
  const recovered = restarted.get(build.id);
  assert.equal(recovered.pendingRenewal, undefined);
  assert.equal(recovered.token, oldToken);
  assert.equal(recovered.expiresAt, oldExpiry);
}));

test("clean read operations do not rewrite persistent build state", () => withStore((store, directory) => {
  const path = join(directory, "builds.json");
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const before = readFileSync(path, "utf8");
  store.get(build.id);
  store.list();
  store.listApps();
  store.getApp(build.app.identity);
  assert.equal(readFileSync(path, "utf8"), before);
}));

test("reading an expired build retains its token for a truthful expired response", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.expiresAt = "2026-01-01T00:00:00.000Z";
  store.save(build);
  const token = build.token;
  assert.equal(store.get(build.id).token, token);
  assert.equal(store.get(build.id).tokenExpiredAt, "");
}));

test("a stale writer cannot resurrect a deleted build", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const stale = structuredClone(build);
  assert.equal(store.deleteApp(build.app.identity, { deleteArtifacts: false }), true);
  assert.throws(() => store.save(stale), /cancelled or deleted/);
  assert.equal(store.get(build.id), undefined);
}));

test("artifact cleanup is durable and removed after successful deletion", () => withStore((store, directory) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const artifactRoot = join(directory, "artifact-root");
  mkdirSync(artifactRoot, { recursive: true });
  build.artifacts.root = artifactRoot;
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity), true);
  assert.equal(existsSync(artifactRoot), false);
  const persisted = JSON.parse(readFileSync(join(directory, "builds.json"), "utf8"));
  assert.deepEqual(persisted.artifactCleanupJobs, {});
  assert.equal("deletedBuildIDs" in persisted, false);
}));

test("active build artifacts are not removed until the worker deadline has passed", () => withStore((store, directory) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const artifactRoot = join(directory, "active-artifact-root");
  mkdirSync(artifactRoot, { recursive: true });
  build.state = "building";
  build.artifacts.root = artifactRoot;
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity), true);
  assert.equal(existsSync(artifactRoot), true);
  const persisted = JSON.parse(readFileSync(join(directory, "builds.json"), "utf8"));
  const jobs = Object.values(persisted.artifactCleanupJobs);
  assert.equal(jobs.length, 1);
  assert.ok(Date.parse(jobs[0].nextAttemptAt) > Date.now() + 60 * 60 * 1000);
}));

test("failed build artifacts retain the worker cleanup fence", () => withStore((store, directory) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const artifactRoot = join(directory, "failed-artifact-root");
  mkdirSync(artifactRoot, { recursive: true });
  build.state = "failed";
  build.artifacts.root = artifactRoot;
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity), true);
  assert.equal(existsSync(artifactRoot), true);
  const persisted = JSON.parse(readFileSync(join(directory, "builds.json"), "utf8"));
  const jobs = Object.values(persisted.artifactCleanupJobs);
  assert.equal(jobs.length, 1);
  assert.ok(Date.parse(jobs[0].nextAttemptAt) > Date.now() + 60 * 60 * 1000);
}));

test("a lock owned by a reused pid is reclaimed using process start time", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-test-"));
  const path = join(directory, "builds.json");
  const lockPath = `${path}.lock`;
  try {
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
      pid: process.pid,
      startedAt: "Mon Jan  1 00:00:00 1990",
      nonce: "old-owner",
    }));
    const store = new DeviceBuildStore({ path });
    assert.equal(store.list().length, 0);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test("queued builds do not spend install-link TTL before delivery", () => withStore((store) => {
  const build = store.create({ scheme: "Example", ttlMinutes: 5 });
  assert.equal(build.expiresAt, "");
  assert.equal(build.installTTLMinutes, 5);
}));

test("deleting a validating build persists cancellation and delayed cleanup", () => withStore((store, directory) => {
  const build = store.create({ scheme: "Example" });
  build.app = {
    identity: deviceAppIdentity({ bundleIdentifier: "com.example.cancel", teamID: "TEAM123" }),
    name: "Example",
    bundleIdentifier: "com.example.cancel",
    teamID: "TEAM123",
    version: "1",
    build: "1",
  };
  build.state = "validating";
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity), true);
  assert.equal(existsSync(build.control.cancelPath), true);
  const persisted = JSON.parse(readFileSync(join(directory, "builds.json"), "utf8"));
  const jobs = Object.values(persisted.artifactCleanupJobs);
  assert.equal(jobs.length, 1);
  assert.ok(Date.parse(jobs[0].nextAttemptAt) > Date.now() + 60 * 60 * 1000);
}));

test("a renewal commits when delivery timestamps are generated after the lease", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.installTTLMinutes = 5;
  build.remoteBaseUrl = "https://old-link.example.com";
  build.expiresAt = new Date(Date.now() + 30_000).toISOString();
  build.delivery = { mode: "quick-tunnel", provider: "cloudflare-quick-tunnel", expiresAt: build.expiresAt };
  store.save(build);
  const oldToken = build.token;
  const renewed = store.renewInstallLink(build.id);
  renewed.expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
  store.save(renewed);
  const committed = store.get(build.id);
  assert.notEqual(committed.token, oldToken);
  assert.equal(committed.remoteBaseUrl, "https://new-link.example.com");
  assert.equal(committed.installTTLMinutes, 5);
  assert.equal(committed.pendingRenewal, undefined);
}));

test("a failed renewal waiter cannot change the configured link TTL", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.installTTLMinutes = 5;
  store.save(build);
  const failed = store.renewInstallLink(build.id, { ttlMinutes: 120 });
  failed.remoteBaseUrl = "";
  failed.expiresAt = "";
  store.save(failed);
  assert.equal(store.get(build.id).installTTLMinutes, 5);
}));

test("an old PID-only build lock is reclaimed after its migration grace", () => withStore((store, directory) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  const lockPath = join(directory, "builds.json.lock");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: process.pid,
    nonce: "legacy",
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  assert.equal(store.get(build.id).id, build.id);
  assert.equal(existsSync(lockPath), false);
}));

test("renewal retains the previous bearer capability until its own expiry", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://old-link.example.com";
  build.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  build.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
    generation: "old-generation",
    referenceID: `build:${build.id}`,
  };
  store.save(build);
  const oldToken = build.token;
  const renewed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  renewed.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: new Date(Date.now() + 70 * 60_000).toISOString(),
    generation: "new-generation",
    referenceID: `renewal:${renewed.pendingRenewal.id}`,
  };
  store.save(renewed);
  const committed = store.get(build.id);
  const oldCapability = committed.capabilities.find((capability) => capability.token === oldToken);
  assert.ok(oldCapability);
  assert.equal(oldCapability.remoteBaseUrl, "https://old-link.example.com");
  assert.equal(oldCapability.delivery.generation, "old-generation");
  assert.notEqual(committed.token, oldToken);
}));


test("all unexpired capability generations remain valid beyond sixteen renewals", () => withStore((store) => {
  let build = completeBuild(store, "Example", "com.example.capabilities", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://generation-0.example.com";
  build.expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  build.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: build.expiresAt,
    generation: "generation-0",
    referenceID: `build:${build.id}`,
  };
  store.save(build);
  const tokens = [build.token];
  for (let index = 1; index <= 20; index += 1) {
    const renewed = store.renewInstallLink(build.id, { ttlMinutes: 120 });
    renewed.remoteBaseUrl = `https://generation-${index}.example.com`;
    renewed.expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    renewed.delivery = {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: renewed.expiresAt,
      generation: `generation-${index}`,
      referenceID: `renewal:${renewed.pendingRenewal.id}`,
    };
    store.save(renewed);
    build = store.get(build.id);
    tokens.push(build.token);
  }
  const saved = store.get(build.id);
  assert.equal(saved.capabilities.length, 20);
  for (const token of tokens.slice(0, -1)) {
    assert.ok(saved.capabilities.some((capability) => capability.token === token));
  }
}));

test("app deletion durably queues every delivery reference across restart", () => withStore((store, directory) => {
  const statePath = join(directory, "builds.json");
  const build = completeBuild(store, "Example", "com.example.cleanup", "TEAM123", "1.0", "1");
  build.delivery = {
    mode: "quick-tunnel",
    generation: "current-generation",
    referenceID: `build:${build.id}`,
  };
  build.capabilities = [{
    token: "old-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    remoteBaseUrl: "https://old.example.com",
    delivery: {
      mode: "quick-tunnel",
      generation: "old-generation",
      referenceID: "renewal:old",
    },
    installTTLMinutes: 5,
    createdAt: new Date().toISOString(),
  }];
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity, { deleteArtifacts: false }), true);
  const restarted = new DeviceBuildStore({ path: statePath });
  const jobs = restarted.listDeliveryReferenceCleanupJobs();
  assert.equal(jobs.length, 2);
  assert.deepEqual(new Set(jobs.map((job) => job.generation)), new Set(["current-generation", "old-generation"]));
}));

test("an early not-installed observation retains the install verification deadline", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.install", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "not-installed",
    devices: [{ name: "Phone", state: "not-installed", version: "", build: "" }],
  });
  const saved = store.get(build.id);
  assert.equal(saved.installation.state, "not-installed");
  assert.ok(Date.parse(saved.installation.verificationDeadlineAt) > Date.now());
}));


test("transient unknown observation preserves a negative active install state", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.install.retry", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "not-installed",
    devices: [{ name: "Phone", state: "not-installed", version: "", build: "" }],
  });
  store.saveVerification(build.id, {
    state: "unknown",
    devices: [{ name: "Phone", state: "unreachable", version: "", build: "" }],
  });
  assert.equal(store.get(build.id).installation.state, "not-installed");
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
