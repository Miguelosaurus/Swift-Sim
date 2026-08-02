import test from "node:test";
import assert from "node:assert/strict";
import { deliverChange } from "../mac-helper/src/changeDelivery.js";

const HOT = [{ path: "Card.swift", kind: "swift", status: "modified", beforeSource: "struct Card { var body: String { \"old\" } }", afterSource: "struct Card { var body: String { \"new\" } }" }];
const STRUCTURAL = [{ path: "Model.swift", kind: "swift", status: "modified", beforeSource: "struct Model { var count = 0 }", afterSource: "struct Model { var count = 0; var title = \"new\" }" }];
const build = () => ({ state: "ready", expiresAt: "2026-08-02T12:00:00.000Z", preserveData: true, signing: { warnings: [] }, installation: { state: "unknown" }, links: { universalLink: "https://mac.example.test/d/build-1?token=opaque-token", customScheme: "swift-sim://device-build/build-1?token=opaque-token" } });

test("hot delivery returns a compact proven live envelope without building", async () => {
  let builds = 0; const result = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), route: async () => ({ action: "hot-reload", patch: { succeeded: true, mode: "swift-dynamic-replacement", report: { applied: true, dynamic_replacements: 1, refresh_acknowledged: true, root_revision: 42 } } }), buildDevice: async () => { builds += 1; return build(); } });
  assert.equal(result.outcome, "hot-reloaded"); assert.equal(result.delivery.revision, 42); assert.equal(builds, 0); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 1024);
});
test("no-change returns before runtime or build adapters", async () => {
  let checks = 0; let builds = 0; const result = await deliverChange({ files: [{ ...HOT[0], afterSource: HOT[0].beforeSource }], runtimeCheck: async () => { checks += 1; return { ok: false }; }, buildDevice: async () => { builds += 1; return build(); } });
  assert.equal(result.outcome, "no-change"); assert.equal(checks, 0); assert.equal(builds, 0);
});
test("structural edits go directly to one signed build and preserve workspace settings", async () => {
  const calls = []; const result = await deliverChange({ files: STRUCTURAL, workspace: "/private/project/App.xcworkspace", scheme: "App", build: { configuration: "Debug", "build-setting": ["FOO=bar", "BAZ=qux"] }, runtimeCheck: async () => ({ ok: true }), route: async () => { throw new Error("must not route structural edits live"); }, buildDevice: async (input) => { calls.push(input); return build(); } });
  assert.equal(result.outcome, "install-link-ready"); assert.equal(calls.length, 1); assert.equal(calls[0].workspace, "/private/project/App.xcworkspace"); assert.deepEqual(calls[0]["build-setting"], ["FOO=bar", "BAZ=qux"]); assert.match(result.delivery.universalLink, /token=opaque-token/);
});
test("signing warnings remain typed", async () => {
  const result = await deliverChange({ files: STRUCTURAL, runtimeCheck: async () => ({ ok: true }), buildDevice: async () => ({ ...build(), signing: { warnings: ["The device profile may need renewal."] } }) });
  assert.equal(result.outcome, "install-link-ready"); assert.equal(result.warning.code, "SIGNING_WARNING");
});
test("live-unavailable and exhausted recovery each build exactly once", async () => {
  let builds = 0; const buildDevice = async () => { builds += 1; return build(); };
  const a = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), route: async () => ({ action: "build-device", reasonCode: "LIVE_NOT_READY" }), buildDevice });
  const b = await deliverChange({ files: [{ ...HOT[0], path: "Other.swift" }], runtimeCheck: async () => ({ ok: true }), route: async () => ({ action: "hot-reload-failed", reasonCode: "PATCH_TIMEOUT" }), buildDevice });
  assert.equal(a.outcome, "install-link-ready"); assert.equal(b.outcome, "install-link-ready"); assert.equal(builds, 2);
});
test("missing live proof never claims success and is not retried", async () => {
  let routes = 0; let builds = 0; const result = await deliverChange({ files: HOT, runtimeCheck: async () => ({ ok: true }), route: async () => { routes += 1; return { action: "hot-reload", patch: { succeeded: true, report: { refresh_acknowledged: true } } }; }, buildDevice: async () => { builds += 1; return build(); } });
  assert.equal(result.outcome, "install-link-ready"); assert.equal(routes, 1); assert.equal(builds, 1);
});
test("concurrent identical deliveries coalesce their build", async () => {
  let builds = 0; const buildDevice = async () => { builds += 1; await new Promise((resolve) => setTimeout(resolve, 20)); return build(); };
  const options = { files: STRUCTURAL, runtimeCheck: async () => ({ ok: true }), buildDevice }; const [a, b] = await Promise.all([deliverChange(options), deliverChange(options)]);
  assert.deepEqual(a, b); assert.equal(a.outcome, "install-link-ready"); assert.equal(builds, 1);
});
