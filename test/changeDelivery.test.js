import test from "node:test";
import assert from "node:assert/strict";
import { deliverChange } from "../mac-helper/src/changeDelivery.js";
import { deliveryEnvelope, validateDeliveryEnvelope } from "../mac-helper/src/changeDeliveryContract.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOT = [{ path: "Card.swift", kind: "swift", status: "modified", beforeSource: "struct Card { var body: String { \"old\" } }", afterSource: "struct Card { var body: String { \"new\" } }" }];
const STRUCTURAL = [{ path: "Model.swift", kind: "swift", status: "modified", beforeSource: "struct Model { var count = 0 }", afterSource: "struct Model { var count = 0; var title = \"new\" }" }];
const build = () => ({ state: "ready", expiresAt: "2026-08-02T12:00:00.000Z", preserveData: true, signing: { warnings: [] }, installation: { state: "unknown" }, links: { universalLink: "https://mac.example.test/d/build-1?token=opaque-token", customScheme: "swift-sim://device-build/build-1?token=opaque-token" } });

test("hot delivery returns a compact proven live envelope without building", async () => {
  let builds = 0; const result = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), queueLive: async () => deliveryEnvelope({ outcome: "hot-reloaded", message: "Proven refreshed receipt.", delivery: { kind: "live", revision: 42 } }), buildDevice: async () => { builds += 1; return build(); } });
  assert.equal(result.outcome, "hot-reloaded"); assert.equal(result.delivery.revision, 42); assert.equal(builds, 0); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
});
test("no-change returns before runtime or build adapters", async () => {
  let checks = 0; let builds = 0; const result = await deliverChange({ files: [{ ...HOT[0], afterSource: HOT[0].beforeSource }], runtimeCheck: async () => { checks += 1; return { ok: false }; }, buildDevice: async () => { builds += 1; return build(); } });
  assert.equal(result.outcome, "no-change"); assert.equal(checks, 0); assert.equal(builds, 0);
});
test("structural edits go directly to one signed build and preserve workspace settings", async () => {
  const calls = []; const result = await deliverChange({ files: STRUCTURAL, workspace: "/private/project/App.xcworkspace", scheme: "App", build: { configuration: "Debug", "build-setting": ["FOO=bar", "BAZ=qux"] }, runtimeCheck: async () => ({ ok: true }), queueLive: async () => { throw new Error("must not queue structural edits live"); }, buildDevice: async (input) => { calls.push(input); return build(); } });
  assert.equal(result.outcome, "install-link-ready"); assert.equal(calls.length, 1); assert.equal(calls[0].workspace, "/private/project/App.xcworkspace"); assert.deepEqual(calls[0]["build-setting"], ["FOO=bar", "BAZ=qux"]); assert.match(result.delivery.universalLink, /token=opaque-token/);
});
test("signing warnings remain typed", async () => {
  const result = await deliverChange({ files: STRUCTURAL, runtimeCheck: async () => ({ ok: true }), buildDevice: async () => ({ ...build(), signing: { warnings: ["The device profile may need renewal."] } }) });
  assert.equal(result.outcome, "install-link-ready"); assert.equal(result.warning.code, "SIGNING_WARNING");
});
test("compatible edits wait durably instead of rebuilding when the app is absent", async () => {
  let builds = 0; let queued = 0;
  for (const state of ["waiting-for-device", "waiting-for-foreground", "compiling", "applied"]) {
    const result = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), queueLive: async () => {
      queued += 1;
      return deliveryEnvelope({ outcome: "queued", message: "Waiting for the matching app.", delivery: { kind: "pending", requestId: "request-pending-1", state, expiresAt: "2026-11-01T00:00:00Z" } });
    }, buildDevice: async () => { builds += 1; return build(); } });
    assert.equal(result.outcome, "queued"); assert.equal(result.delivery.state, state);
  }
  assert.equal(queued, 4); assert.equal(builds, 0);
});
test("queue failure and missing proof never become a signed build", async () => {
  let queued = 0; let builds = 0;
  const buildDevice = async () => { builds += 1; return build(); };
  const a = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), queueLive: async () => { queued += 1; throw Object.assign(new Error("Updated SDK required."), { code: "LIVE_BINARY_PROVENANCE_REQUIRED" }); }, buildDevice });
  assert.equal(a.outcome, "needs-user-action"); assert.equal(a.reasonCode, "LIVE_BINARY_PROVENANCE_REQUIRED");
  const b = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), queueLive: async () => { queued += 1; return deliveryEnvelope({ outcome: "hot-reloaded", message: "incomplete", delivery: { kind: "live" } }); }, buildDevice });
  assert.equal(b.outcome, "failed"); assert.equal(b.reasonCode, "INVALID_DELIVERY_ENVELOPE");
  assert.equal(queued, 2); assert.equal(builds, 0);
});
test("a failed signed fallback retains its original routing reason", async () => {
  const result = await deliverChange({ files: STRUCTURAL, runtimeCheck: async () => ({ ok: true }), buildDevice: async () => { throw new Error("CodeSign failed: internal error in Code Signing subsystem"); } });
  assert.equal(result.outcome, "failed"); assert.equal(result.reasonCode, "SIGNING_FAILED");
  assert.equal(result.fallbackReasonCode, "STORED_PROPERTY_CHANGED");
});
test("concurrent identical deliveries coalesce their build", async () => {
  let builds = 0; const buildDevice = async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return build(); };
  const options = { files: STRUCTURAL, runtimeCheck: async () => ({ ok: true }), buildDevice }; const [a, b] = await Promise.all([deliverChange(options), deliverChange(options)]);
  assert.deepEqual(a, b); assert.equal(a.outcome, "install-link-ready"); assert.equal(builds, 1);
});

test("live-only structural requests and an old helper never start a build", async () => {
  let builds = 0; let queued = 0;
  const ports = { buildDevice: async () => { builds += 1; }, queueLive: async () => { queued += 1; } };
  const a = await deliverChange({ ...ports, files: STRUCTURAL, liveOnly: true, runtimeCheck: async () => ({ ok: true }) });
  assert.equal(a.error.code, "REBUILD_REQUIRED");
  const b = await deliverChange({ ...ports, files: HOT, runtimeCheck: async () => ({ ok: true, queueReady: false }) });
  assert.equal(b.error.code, "HELPER_UPDATE_REQUIRED");
  assert.equal(builds, 0); assert.equal(queued, 0);
});

test("the queued bytes are the same immutable bytes classified before asynchronous readiness", async () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-edit-snapshot-"));
  try {
    const before = join(root, "Before.swift"); const after = join(root, "Card.swift");
    writeFileSync(before, HOT[0].beforeSource); writeFileSync(after, HOT[0].afterSource);
    let observed;
    const result = await deliverChange({
      files: [{ path: after, beforePath: before, afterPath: after }],
      runtimeCheck: async () => { writeFileSync(after, 'struct Card { var stored = 1; var body: String { "changed" } }'); return { ok: true }; },
      queueLive: async (input) => { observed = input.files[0]; return deliveryEnvelope({ outcome: "queued", message: "Queued.", delivery: { kind: "pending", requestId: "immutable-request", state: "queued", expiresAt: "2026-11-01T00:00:00Z" } }); },
    });
    assert.equal(result.outcome, "queued");
    assert.equal(observed.beforeSource, HOT[0].beforeSource); assert.equal(observed.afterSource, HOT[0].afterSource);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("queued guidance is additive for older clients and rejects malformed typed fields", () => {
  const pending = deliveryEnvelope({
    outcome: "queued", message: "Waiting for the app.",
    delivery: { kind: "pending", requestId: "request-guidance-contract", state: "waiting-for-foreground", expiresAt: "2026-11-01T00:00:00Z" },
  });
  assert.equal(validateDeliveryEnvelope(pending).valid, true);
  const fields = { prepared: true, normalWaiting: true, guidanceCode: "OPEN_TARGET_APP", requiredAppState: "foreground-ready" };
  const typed = { ...pending, delivery: { ...pending.delivery, ...fields } };
  assert.equal(validateDeliveryEnvelope(typed).valid, true);
  for (const guidanceCode of ["OPEN_TARGET_APP", "PREPARING_UPDATE", "WAIT_FOR_APPLICATION", "WAIT_FOR_REFRESH"]) {
    assert.equal(validateDeliveryEnvelope({ ...typed, delivery: { ...typed.delivery, guidanceCode } }).valid, true);
  }
  for (const invalid of [{ prepared: "true" }, { normalWaiting: 1 }, { guidanceCode: "REBUILD_NOW" }, { requiredAppState: "background" }]) {
    assert.equal(validateDeliveryEnvelope({ ...typed, delivery: { ...typed.delivery, ...invalid } }).valid, false, JSON.stringify(invalid));
  }
});
