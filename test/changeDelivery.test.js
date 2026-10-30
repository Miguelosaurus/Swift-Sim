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
  assert.match(result.rebuildReason, /Model\.swift.*Stored state/);
  assert.match(result.rebuildReason, /title/);
  assert.equal(result.message, "This change needs a new signed build.");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 2048);
});

test("optional rebuild explanation rejects invalid or oversized text", () => {
  for (const rebuildReason of [null, {}, "", "x".repeat(601)]) {
    assert.equal(validateDeliveryEnvelope(deliveryEnvelope({ outcome: "failed", message: "Failed", rebuildReason })).valid, false);
  }
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

test("mixed live-only rejection names the offending file without applying a partial set", async () => {
  let builds = 0; let queued = 0;
  const files = [HOT[0], { ...STRUCTURAL[0], path: "/Users/private/project/Model.swift" }];
  const result = await deliverChange({ files, liveOnly: true, buildDevice: async () => { builds++; }, queueLive: async () => { queued++; } });
  assert.equal(result.outcome, "needs-user-action");
  assert.equal(result.reasonCode, "MIXED_EDIT_SET");
  assert.equal(result.error.code, "REBUILD_REQUIRED");
  assert.match(result.error.message, /^Model\.swift(?:[: (])/);
  assert.match(result.error.message, /Stored state or its initializer changed/);
  assert.doesNotMatch(JSON.stringify(result), /\/Users|private\/project|compiled structure/);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
  assert.equal(result.diagnostics, undefined);
  assert.equal(builds, 0); assert.equal(queued, 0);
});

test("unsupported import diagnostics distinguish current support and keep every file reason", async () => {
  const imported = { ...HOT[0], path: "/private/work/Imports.swift", afterSource: `import Foundation\n${HOT[0].afterSource}` };
  const result = await deliverChange({ files: [imported, STRUCTURAL[0]], liveOnly: true, verbose: true });
  assert.equal(result.outcome, "needs-user-action");
  assert.equal(result.reasonCode, "IMPORT_CHANGED");
  assert.match(result.error.message, /Imports\.swift/);
  assert.match(result.error.message, /not supported by the current live compiler/);
  assert.match(result.error.message, /1 additional file also requires a build/);
  assert.deepEqual(result.diagnostics.changes.map(({ file, reasonCode, category }) => ({ file, reasonCode, category })), [
    { file: "Imports.swift", reasonCode: "IMPORT_CHANGED", category: "unsupported-live-edit" },
    { file: "Model.swift", reasonCode: "STORED_PROPERTY_CHANGED", category: "installed-structure" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /\/private\/work|struct Card|impossible/);
  assert.equal(validateDeliveryEnvelope(result).valid, true);
});

test("additive helpers explain unsupported compatibility while existing signatures explain installed structure", async () => {
  const beforeSource = "struct Model { func value() -> Int { 1 } }";
  const helper = await deliverChange({ files: [{ path: "Model.swift", beforeSource, afterSource: "struct Model { func value() -> Int { 1 }; func helper() -> Int { 2 } }" }], liveOnly: true, verbose: true });
  assert.equal(helper.reasonCode, "SIGNATURE_CHANGED");
  assert.equal(helper.diagnostics.changes[0].category, "unsupported-live-edit");
  assert.match(helper.error.message, /Adding or removing helper declarations is not supported/);
  assert.doesNotMatch(helper.error.message, /installed type or callable signature/);
  const signature = await deliverChange({ files: [{ path: "Model.swift", beforeSource, afterSource: "struct Model { func value(input: Int) -> Int { input } }" }], liveOnly: true, verbose: true });
  assert.equal(signature.reasonCode, "SIGNATURE_CHANGED");
  assert.equal(signature.diagnostics.changes[0].category, "installed-structure");
  assert.match(signature.error.message, /installed type or callable signature changed/);
});

test("unsafe diagnostic filenames are replaced and maximum edit sets stay compact", async () => {
  for (const path of ["/tmp/token=private-value.swift", "/tmp/Bearer private-value.swift", "/tmp/Bad\nName.swift", `/tmp/${"A".repeat(80)}.swift`, "/tmp/Name%0Asecret.swift"]) {
    const result = await deliverChange({ files: [{ ...STRUCTURAL[0], path }], liveOnly: true, verbose: true });
    assert.equal(result.diagnostics.changes[0].file, "Swift source");
    assert.match(result.error.message, /^Swift source:/);
    assert.doesNotMatch(JSON.stringify(result), /private-value|Bad|Name%|\/tmp/);
  }
  const files = Array.from({ length: 32 }, (_, index) => ({ ...STRUCTURAL[0], path: `VeryLongButSafeFileName${index}.swift` }));
  const compact = await deliverChange({ files, liveOnly: true });
  assert.equal(compact.outcome, "needs-user-action");
  assert.match(compact.error.message, /31 additional files also require a build/);
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) <= 1024);
});

test("signed fallback retains its required message and exposes safe reasons only in verbose diagnostics", async () => {
  const compact = await deliverChange({ files: STRUCTURAL, buildDevice: async () => build() });
  assert.equal(compact.message, "This change needs a new signed build.");
  assert.equal(compact.diagnostics, undefined);
  const verbose = await deliverChange({ files: STRUCTURAL, verbose: true, buildDevice: async () => build() });
  assert.equal(verbose.message, compact.message);
  assert.equal(verbose.diagnostics.changes[0].file, "Model.swift");
  assert.equal(verbose.diagnostics.changes[0].reasonCode, "STORED_PROPERTY_CHANGED");
  assert.equal(validateDeliveryEnvelope(verbose).valid, true);
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
