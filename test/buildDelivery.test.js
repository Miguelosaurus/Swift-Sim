import test from "node:test";
import assert from "node:assert/strict";
import { deliverSavedBuild, holdChangedBuild } from "../mac-helper/src/buildDelivery.js";
const buildID = "11111111-1111-1111-1111-111111111111";
function fixture() {
  const calls = [];
  const build = { id: buildID, state: "ready", signing: { deviceInstallable: true }, preserveData: true,
    expiresAt: new Date(Date.now() + 100000).toISOString(), project: "/tmp/App.xcodeproj", scheme: "App" };
  return { calls, build, input: { buildID, project: build.project, scheme: build.scheme,
    readBuild: () => build,
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
  const f = fixture(); f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" }); f.input.foregroundClear = () => false;
  assert.equal((await deliverSavedBuild(f.input)).state, "unconfirmed"); assert.equal(f.calls.length, 0);
});
for (const mutate of [f => f.input.project = "/other/App.xcodeproj", f => f.build.preserveData = false,
  f => f.build.expiresAt = new Date(0).toISOString(), f => f.build.signing.deviceInstallable = false]) test("invalid build/scope never contacts phone", async () => {
  const f = fixture(); mutate(f); assert.equal((await deliverSavedBuild(f.input)).state, "blocked"); assert.equal(f.calls.length, 0);
});

test("a fresh native-only install does not require a running hot reload engine", async () => {
  const f = fixture(); f.input.prompt = async () => ({ code: "INSTALL_REQUEST_UNAVAILABLE" });
  f.input.foregroundClear = () => true;
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
