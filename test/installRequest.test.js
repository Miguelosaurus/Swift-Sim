import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestAppInstall } from "../mac-helper/src/installRequest.js";

const id = "11111111-1111-1111-1111-111111111111";
const identity = { bundle_id: "dev.test.app", bundle_version: "1", build_number: "4",
  executable_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", debug_dylib_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
function fixture(overrides = {}) {
  const calls = [];
  const build = { id, state: "ready", preserveData: true, signing: { deviceInstallable: true },
    app: { bundleIdentifier: "dev.test.app", teamID: "fixture", version: "1", build: "5" },
    project: "/tmp/install-fixture/App.xcodeproj", scheme: "App", artifacts: { ipaPath: "/fixture.ipa" },
    remoteBaseUrl: "https://example.test", token: "abcdefghijklmnopqrstuvwx", expiresAt: new Date(2000000).toISOString() };
  const answer = state => ({ success: true, data: { build_id: id, state, expires_at: 2000, installed: false, requires_ios_confirmation: true } });
  const options = { buildID: id, cwd: "/tmp/install-fixture", now: () => 1000000,
    readBuild: async () => structuredClone(build), digest: async () => "a".repeat(64),
    listBuilds: async () => [launchedBuild()],
    control: async request => {
      calls.push(request);
      if (request.action === "status") return { success: true, data: {
        foreground_install_requests: true, client_identity: identity, client_capabilities: ["foreground-install-v1"] } };
      if (request.operation === "status") return { success: false, error: "INSTALL_REQUEST_NOT_FOUND" };
      return answer("waiting");
    }, ...overrides };
  return { options, build, calls, answer };
}
test("scopes a frozen signed build and emits no secrets or installation success", async () => {
  const f = fixture(); const result = await requestAppInstall(f.options);
  assert.equal(result.state, "waiting"); assert.equal(result.installed, false);
  const request = f.calls.at(-1); assert.equal(request.action, "install_request");
  assert.deepEqual(request.selector, identity);
  const value = JSON.parse(request.value);
  assert.equal(value.bundleID, identity.bundle_id); assert.equal(value.buildID, id); assert.equal(value.build, "5");
  assert.equal(value.sha256, "a".repeat(64));
  assert.equal(new URL(value.manifestURL).pathname, `/api/device-builds/${id}/artifact/manifest`);
  assert.ok(!JSON.stringify(result).includes(f.build.token));
  assert.ok(!JSON.stringify(result).includes("manifestURL"));
});
test("repeated command reads prior request without hashing or sending", async () => {
  const f = fixture(); const control = f.options.control;
  f.options.control = req => req.operation === "status" ? f.answer("unconfirmed") : control(req);
  f.options.digest = () => { throw new Error("must not hash again"); };
  assert.equal((await requestAppInstall(f.options)).state, "unconfirmed");
  assert.ok(!f.calls.some(x => x.operation === "enqueue"));
});
for (const [name, mutate, code] of [
  ["expired", f => f.build.expiresAt = new Date(1).toISOString(), "INSTALL_BUILD_UNAVAILABLE"],
  ["revoked", f => f.build.tokenExpiredAt = "revoked", "INSTALL_BUILD_UNAVAILABLE"],
  ["unsigned", f => f.build.signing.deviceInstallable = false, "INSTALL_BUILD_UNAVAILABLE"],
  ["destructive", f => f.build.preserveData = false, "INSTALL_BUILD_UNAVAILABLE"],
  ["wrong project", f => f.options.project = "/another/App.xcodeproj", "INSTALL_SCOPE_REQUIRED"],
  ["wrong scheme", f => f.options.scheme = "Other", "INSTALL_SCOPE_REQUIRED"],
  ["same build", f => f.build.app.build = "4", "INSTALL_ALREADY_RUNNING"],
  ["insecure delivery", f => f.build.remoteBaseUrl = "http://example.test", "INSTALL_BUILD_UNAVAILABLE"],
  ["URL credentials", f => f.build.remoteBaseUrl = "https://secret@example.test", "INSTALL_BUILD_UNAVAILABLE"],
  ["changed artifact", f => f.options.digest = async () => { f.build.artifacts.ipaPath = "/replaced.ipa"; return "a".repeat(64); }, "INSTALL_BUILD_CHANGED"],
  ["revoked during preparation", f => f.options.digest = async () => { f.build.tokenExpiredAt = "now"; return "a".repeat(64); }, "INSTALL_BUILD_CHANGED"],
]) test(`${name} refuses without sending`, async () => {
  const f = fixture(); mutate(f);
  assert.equal((await requestAppInstall(f.options)).code, code);
  assert.ok(!f.calls.some(x => x.operation === "enqueue"));
});
test("old engine and SDK are gated without automatic updates", async () => {
  for (const which of ["engine", "sdk"]) {
    const f = fixture(); const original = f.options.control;
    f.options.control = async request => {
      const response = await original(request);
      if (request.action === "status") {
        if (which === "engine") delete response.data.foreground_install_requests;
        else response.data.client_capabilities = [];
      }
      return response;
    };
    assert.equal((await requestAppInstall(f.options)).code, which === "engine" ? "INSTALL_ENGINE_UPDATE_REQUIRED" : "INSTALL_SDK_UPDATE_REQUIRED");
    assert.ok(!f.calls.some(x => x.operation === "enqueue"));
  }
});
test("offline request binds verified launch history, never the new compiler capture", async () => {
  const f = fixture(); const original = f.options.control;
  f.options.control = async req => { const response = await original(req); if (req.action === "status") delete response.data.client_identity; return response; };
  assert.equal((await requestAppInstall(f.options)).state, "waiting");
  assert.deepEqual(f.calls.at(-1).selector, identity);
  f.options.listBuilds = () => [launchedBuild({ app: { bundleIdentifier: "other" } })];
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_RUNNING_APP_REQUIRED");
});
test("status and cancel do not read artifact, build state, or app context", async () => {
  for (const operation of ["status", "cancel"]) {
    const f = fixture({ operation, readBuild: () => { throw new Error("unexpected"); } });
    f.options.control = async request => { f.calls.push(request); return f.answer(operation === "cancel" ? "cancelled" : "prompt-requested"); };
    const result = await requestAppInstall(f.options);
    assert.equal(f.calls.length, 1); assert.equal(result.installed, false);
    assert.equal(result.requiresIOSConfirmation, true);
  }
});
test("lost enqueue reply stays uncertain and never auto retries", async () => {
  const f = fixture(); const original = f.options.control;
  f.options.control = async request => { const value = await original(request); if (request.operation === "enqueue") throw new Error("lost"); return value; };
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_REQUEST_UNAVAILABLE");
  assert.equal(f.calls.filter(x => x.operation === "enqueue").length, 1);
});
test("actual artifact hashing and real project-directory scope", async t => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "App.xcodeproj")); writeFileSync(join(root, "App.ipa"), "signed fixture bytes");
  const f = fixture({ cwd: root }); delete f.options.digest;
  f.build.project = join(root, "App.xcodeproj"); f.build.artifacts.ipaPath = join(root, "App.ipa");
  assert.equal((await requestAppInstall(f.options)).state, "waiting");
  symlinkSync(join(root, "App.ipa"), join(root, "link.ipa")); f.build.artifacts.ipaPath = join(root, "link.ipa");
  const before = f.calls.filter(x => x.operation === "enqueue").length;
  assert.equal((await requestAppInstall(f.options)).outcome, "needs-user-action");
  assert.equal(f.calls.filter(x => x.operation === "enqueue").length, before);
});

test("a new-build compilation capture never counts as an installed app observation", async () => {
  const f = fixture(); const original = f.options.control;
  f.options.control = async request => {
    const result = await original(request);
    if (request.action === "status") delete result.data.client_identity;
    return result;
  };
  f.options.listBuilds = () => [];
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_RUNNING_APP_REQUIRED");
  assert.ok(!f.calls.some(x => x.operation === "enqueue"));
});

function launchedBuild(overrides = {}) {
  return { ...fixtureBuild(), configuration: "Debug", createdAt: new Date(100).toISOString(),
    liveReload: { eligible: true, compilerReady: true, recovery: { completedAt: 500,
      provenance: { binaryIdentity: identity } } },
    installation: { state: "launch-confirmed", lastSeenAt: new Date(1000).toISOString(),
      launchFingerprint: "c".repeat(64), launchProcessFingerprint: "c".repeat(64) }, ...overrides };
}
function fixtureBuild() {
  return { id: "22222222-2222-2222-2222-222222222222", state: "ready", signing: { deviceInstallable: true },
    project: "/tmp/install-fixture/App.xcodeproj", scheme: "App",
    app: { bundleIdentifier: identity.bundle_id, teamID: "fixture", version: "1", build: "4" } };
}
function offline(f) {
  const original = f.options.control;
  f.options.control = async request => {
    const result = await original(request);
    if (request.action === "status") delete result.data.client_identity;
    return result;
  };
}
for (const [name, mutate] of [
  ["wrong team", b => b.app.teamID = "other"],
  ["wrong scheme", b => b.scheme = "Other"],
  ["wrong project", b => b.project = "/other/App.xcodeproj"],
  ["unverified", b => b.installation.state = "requested"],
  ["missing receipt", b => delete b.installation.launchFingerprint],
  ["future receipt", b => b.installation.lastSeenAt = new Date(2000000).toISOString()],
  ["unsigned", b => b.signing.deviceInstallable = false],
  ["no compiler proof", b => b.liveReload.compilerReady = false],
  ["wrong binary", b => b.liveReload.recovery.provenance.binaryIdentity = { ...identity, build_number: "3" }],
]) test(`offline history rejects ${name}`, async () => {
  const f = fixture(); offline(f);
  const b = launchedBuild(); mutate(b); f.options.listBuilds = () => [b];
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_RUNNING_APP_REQUIRED");
  assert.ok(!f.calls.some(x => x.operation === "enqueue"));
});
test("latest verified launch wins, ties refuse, a confirmed target never falls back to an older build", async () => {
  const f = fixture(); offline(f);
  const old = launchedBuild();
  const current = structuredClone(old);
  current.installation.lastSeenAt = new Date(2000).toISOString();
  current.app.build = "6";
  current.liveReload.recovery.provenance.binaryIdentity.build_number = "6";
  f.options.listBuilds = () => [old, current];
  assert.equal((await requestAppInstall(f.options)).state, "waiting");
  assert.equal(f.calls.at(-1).selector.build_number, "6");
  old.installation.lastSeenAt = current.installation.lastSeenAt;
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_RUNNING_APP_REQUIRED");
  current.installation.lastSeenAt = new Date(3000).toISOString();
  current.app.build = "5"; current.liveReload.recovery.provenance.binaryIdentity.build_number = "5";
  assert.equal((await requestAppInstall(f.options)).code, "INSTALL_RUNNING_APP_REQUIRED");
});
test("connected app and status/cancel/duplicate do not scan launch history", async () => {
  const f = fixture({ listBuilds: () => { throw Error("unexpected history scan"); } });
  assert.equal((await requestAppInstall(f.options)).state, "waiting");
  for (const operation of ["status", "cancel"]) {
    f.options.operation = operation; f.options.control = () => f.answer("cancelled");
    assert.equal((await requestAppInstall(f.options)).state, "cancelled");
  }
});
