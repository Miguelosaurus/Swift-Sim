import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDeliveryAdapter } from "../mac-helper/src/liveDeliveryAdapter.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const identity = {
  bundle_id: "com.example.fixture", bundle_version: "1.0", build_number: "1",
  executable_uuid: "11111111-1111-1111-1111-111111111111",
  debug_dylib_uuid: "22222222-2222-2222-2222-222222222222",
  process_nonce: "fixture-process-one", connection_nonce: "fixture-connection-one",
  is_active: true, root_ready: true, root_revision: 3,
};

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-adapter-"));
  const manifestPath = join(root, "compilations.json"); const artifact = join(root, "prepared.dylib");
  const bytes = Buffer.from("synthetic signed fixture bytes"); writeFileSync(artifact, bytes, { mode: 0o600 });
  const status = { prepared_delivery_protocol: 1, client_capabilities: ["prepared-delivery-v1", "receipt-v1", "replacement-proof-v2"], client_identity: { ...identity }, has_connected_client: true };
  writeFileSync(manifestPath, JSON.stringify({ binaryIdentity: identity, binding: { projectPath: join(root, "Example.xcodeproj", "project.pbxproj"), projectRoot: root, scheme: "Example" }, sourceBaselines: {} }), { mode: 0o600 });
  let clock = 1000; const calls = []; let result; let prepareDigest = digest(bytes);
  const adapter = createLiveDeliveryAdapter({ manifestPath, compile: async (_record, options) => ({ path: artifact, mode: "swift-dynamic-replacement-bundle", receivedSignal: options?.cancellationSignal }),
    control: async (request) => { calls.push(structuredClone(request)); if (request.action === "status") return { success: true, data: status }; if (request.action === "prepare_dylib") return { success: true, data: { patch_digest: prepareDigest } }; return result; },
    lock: (operation) => operation(), now: () => clock, wait: async (ms) => { clock += Math.max(ms, 1000); },
  });
  const binding = await adapter.binding({});
  const record = { requestId: "fixture-request-one", scope: binding.scope, baselineRevision: 3, expiresAt: 100_000, claim: { token: "fixture-attempt-one" }, applyClaimToken: "fixture-attempt-one", preparedPatch: { path: artifact, patchDigest: digest(bytes) } };
  const observed = await adapter.inspect(record);
  const report = () => ({ request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest, client_identity: { ...identity }, applied: true, dynamic_replacements: 1, root_revision: 4, refreshed: true, refresh_acknowledged: true });
  return { adapter, status, record, observed, calls, report, manifestPath, artifact, setResult(value) { result = value; }, setPrepareDigest(value) { prepareDigest = value; }, advance(ms) { clock += ms; }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("prepared proof requires exact request, signed digest, binary, process, replacement and newer revision", async () => {
  const f = await fixture();
  try {
    const mutations = [
      { request_id: "another-request" }, { patch_digest: "f".repeat(64) },
      { client_identity: { ...identity, process_nonce: "another-process" } },
      { client_identity: { ...identity, debug_dylib_uuid: "33333333-3333-3333-3333-333333333333" } },
      { root_revision: 3 }, { dynamic_replacements: 0 }, { applied: false },
    ];
    for (const mutation of mutations) {
      f.setResult({ success: true, data: { state: "completed", report: { ...f.report(), ...mutation } } });
      assert.equal(await f.adapter.apply(f.record, f.observed), null);
    }
    f.setResult({ success: true, data: { state: "completed", report: f.report() } });
    const proof = await f.adapter.apply(f.record, f.observed);
    assert.equal(proof.refreshed, true); assert.equal(proof.revision, 4); assert.equal(proof.requestId, f.record.requestId);
    assert.equal("client_identity" in proof, false); assert.equal("path" in proof, false);
  } finally { f.cleanup(); }
});

test("application without refresh remains an incomplete applied proof", async () => {
  const f = await fixture();
  try {
    f.setResult({ success: true, data: { state: "completed", report: { ...f.report(), refreshed: false, refresh_acknowledged: false } } });
    const result = await f.adapter.apply(f.record, f.observed);
    assert.equal(result.applied, true); assert.equal(result.refreshed, false);
  } finally { f.cleanup(); }
});

test("an unknown or malformed native revision cannot establish a fresh-process baseline", async () => {
  const f = await fixture();
  try {
    for (const revision of [undefined, null, "0", -1, 0.5, NaN]) {
      f.status.client_identity.root_revision = revision;
      const observed = await f.adapter.inspect(f.record);
      assert.equal(observed.connected, false);
      assert.equal(observed.revision, null);
      assert.equal((await f.adapter.binding({})).verifiedProcess, false);
    }
    f.status.client_identity.root_revision = 0;
    assert.equal((await f.adapter.inspect(f.record)).connected, true);
    f.status.client_capabilities = "prepared-delivery-v1 receipt-v1 replacement-proof-v2";
    await assert.rejects(f.adapter.binding({}), { code: "LIVE_CLIENT_UPDATE_REQUIRED" });
  } finally { f.cleanup(); }
});

test("only authenticated current-attempt pre-admission rejection is retryable", async () => {
  const f = await fixture();
  try {
    const rejection = { ...f.report(), admission: "rejected-no-effect", error_code: "PREPARED_WAITING_FOR_FOREGROUND", applied: false, dynamic_replacements: 0, refreshed: false, refresh_acknowledged: false, attempt_id: f.record.claim.token };
    f.setResult({ success: true, data: { state: "rejected-no-effect", report: rejection } });
    const result = await f.adapter.apply(f.record, f.observed);
    assert.deepEqual(result.noEffect, { requestId: f.record.requestId, patchDigest: f.record.preparedPatch.patchDigest, sessionIdentity: f.record.scope.sessionIdentity, binaryIdentity: f.record.scope.binaryIdentity, attemptId: f.record.claim.token, admitted: false, applied: false, reasonCode: "PREPARED_WAITING_FOR_FOREGROUND" });
    for (const mutation of [{ attempt_id: "stale-attempt" }, { admission: "rejected" }, { refresh_acknowledged: true }, { dynamic_replacements: 1 }, { applied: true, dynamic_replacements: 0 }, { error_code: "ARBITRARY_FAILURE" }, { client_identity: { ...identity, process_nonce: "wrong-process" } }]) {
      f.setResult({ success: true, data: { state: "rejected-no-effect", report: { ...rejection, ...mutation } } });
      assert.equal(await f.adapter.apply(f.record, f.observed), null);
    }
  } finally { f.cleanup(); }
});

test("reachable old engines and clients require activation rather than promising queue completion", async () => {
  const f = await fixture();
  try {
    f.status.prepared_delivery_protocol = 0;
    await assert.rejects(f.adapter.binding({}), { code: "LIVE_ENGINE_UPDATE_REQUIRED" });
    f.status.prepared_delivery_protocol = 1; f.status.client_capabilities = [];
    await assert.rejects(f.adapter.binding({}), { code: "LIVE_CLIENT_UPDATE_REQUIRED" });
    f.status.client_capabilities = ["prepared-delivery-v1", "receipt-v1"];
    await assert.rejects(f.adapter.binding({}), { code: "LIVE_CLIENT_UPDATE_REQUIRED" });
    f.status.has_connected_client = false; delete f.status.client_identity;
    const binding = await f.adapter.binding({}); assert.equal(binding.verifiedProcess, false);
  } finally { f.cleanup(); }
});

test("preparation freezes the exact signed bytes and refuses changed signing output", async () => {
  const f = await fixture();
  try {
    const result = await f.adapter.prepare(f.record, {});
    assert.equal(result.patchDigest, f.record.preparedPatch.patchDigest);
    assert.equal(f.calls.filter((call) => call.action === "prepare_dylib").length, 1);
    f.setPrepareDigest("f".repeat(64));
    await assert.rejects(f.adapter.prepare(f.record, {}), { code: "PATCH_SIGNING_FAILED" });
  } finally { f.cleanup(); }
});

test("an engine-cache miss probes only the same native receipt identity", async () => {
  const f = await fixture();
  try {
    f.setResult({ success: true, data: { state: "unknown" } }); f.calls.length = 0;
    assert.equal(await f.adapter.receipt(f.record, f.observed), null);
    assert.deepEqual(f.calls.map((call) => call.action), ["prepared_receipt", "inject_prepared"]);
    const request = f.calls[1]; assert.equal(request.request_id, f.record.requestId); assert.equal(request.patch_digest, f.record.preparedPatch.patchDigest); assert.equal(request.attempt_id, f.record.claim.token); assert.equal(request.expected_identity.process_nonce, f.record.scope.sessionIdentity);
    f.calls.length = 0;
    await f.adapter.receipt(f.record, { ...f.observed, supportsReceipts: false });
    assert.deepEqual(f.calls.map((call) => call.action), ["prepared_receipt"]);
    f.advance(200_000); f.calls.length = 0;
    await f.adapter.receipt(f.record, f.observed);
    assert.deepEqual(f.calls.map((call) => call.action), ["prepared_receipt"]);
  } finally { f.cleanup(); }
});

test("unsafe capture metadata fails closed without exposing its private contents", async () => {
  const f = await fixture();
  try {
    chmodSync(f.manifestPath, 0o644);
    await assert.rejects(f.adapter.binding({}), (error) => error.code === "LIVE_BINARY_PROVENANCE_REQUIRED" && !error.message.includes(f.manifestPath));
  } finally { f.cleanup(); }
});
