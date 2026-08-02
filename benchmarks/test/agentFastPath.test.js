import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_FAST_PATH_SCENARIOS,
  runAgentFastPathBaseline,
  summarizeBaseline,
} from "../src/agentFastPath.js";
import {
  DELIVERY_OUTCOMES,
  DELIVERY_SCHEMA_VERSION,
  deliveryEnvelope,
  validateDeliveryEnvelope,
} from "../../mac-helper/src/changeDeliveryContract.js";

test("Phase 1 baseline covers the current warm and fallback call graph", async () => {
  const result = await runAgentFastPathBaseline({ repeat: 1 });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scenarios.length, AGENT_FAST_PATH_SCENARIOS.length);
  assert.deepEqual(result.costSurface.warmHotLogicalPath, [
    "classify",
    "inspect-live",
    "preflight-or-generate",
    "inject",
    "inspect-live-after-success",
  ]);
  const summary = summarizeBaseline(result);
  assert.deepEqual(summary["no-change"].actions, ["none"]);
  assert.deepEqual(summary.structural.actions, ["build-device"]);
  assert.deepEqual(summary.mixed.actions, ["build-device"]);
  assert.deepEqual(summary["warm-hot"].actions, ["hot-reload"]);
  assert.deepEqual(summary["live-unavailable"].actions, ["build-device"]);
  assert.deepEqual(summary["transient-recovery"].actions, ["hot-reload"]);
  assert.deepEqual(summary["exhausted-recovery"].actions, ["hot-reload-failed"]);
});

test("Phase 1 records current repeated inspection work without private data", async () => {
  const result = await runAgentFastPathBaseline({ repeat: 1 });
  const byScenario = Object.fromEntries(result.scenarios.map((sample) => [sample.scenario, sample]));
  assert.equal(byScenario["no-change"].calls.inspect, 1);
  assert.equal(byScenario.structural.calls.inspect, 1);
  assert.equal(byScenario.mixed.calls.inspect, 1);
  assert.equal(byScenario["warm-hot"].calls.inspect, 2);
  assert.equal(byScenario["warm-hot"].calls.inject, 1);
  assert.equal(byScenario["transient-recovery"].calls.inspect, 4);
  assert.equal(byScenario["transient-recovery"].calls.recover, 1);
  assert.equal(byScenario["exhausted-recovery"].calls.recover, 1);
  assert.deepEqual(
    byScenario["warm-hot"].subprocesses.map(({ executable, args }) => `${executable} ${args.join(" ")}`),
    [
      "xcodebuild -list -json",
      "xcodebuild -configuration Debug -showBuildSettings",
      "tailscale ip -4",
      "tailscale ip -4",
      "tailscale ip -4",
      "xcodebuild -list -json",
      "xcodebuild -configuration Debug -showBuildSettings",
      "tailscale ip -4",
      "tailscale ip -4",
      "tailscale ip -4",
    ],
  );
  assert.ok(result.primarySkill.lines > 0);
  assert.ok(result.primarySkill.words > 0);
  assert.ok(result.primarySkill.bytes > 0);
  assert.ok(byScenario["warm-hot"].routeResultBytes > 0);
  for (const sample of result.scenarios) {
    let previousEnd = -Infinity;
    for (const boundary of sample.timingBoundaries) {
      assert.ok(boundary.endedAt >= boundary.startedAt);
      assert.ok(boundary.startedAt >= previousEnd);
      assert.ok(boundary.durationMs >= 0);
      previousEnd = boundary.endedAt;
    }
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /deviceUDID|teamID|archivePath|ipaPath|tailnetName|\/Users\//);
  assert.doesNotMatch(serialized, /trycloudflare|token=|bearer/i);
});

test("delivery contract defines the five terminal outcomes", () => {
  assert.deepEqual(DELIVERY_OUTCOMES, [
    "hot-reloaded",
    "install-link-ready",
    "no-change",
    "needs-user-action",
    "failed",
  ]);
  const hot = deliveryEnvelope({
    outcome: "hot-reloaded",
    message: "Hot reloaded successfully.",
    delivery: { kind: "live", revision: 4 },
    timing: { totalMs: 812 },
  });
  assert.equal(hot.schemaVersion, DELIVERY_SCHEMA_VERSION);
  assert.deepEqual(validateDeliveryEnvelope(hot), { valid: true, errors: [] });
});

test("delivery contract rejects unsafe or incomplete compact envelopes", () => {
  const missingRevision = deliveryEnvelope({
    outcome: "hot-reloaded",
    message: "Hot reloaded successfully.",
    delivery: { kind: "live" },
  });
  assert.equal(validateDeliveryEnvelope(missingRevision).valid, false);

  const unsafe = deliveryEnvelope({
    outcome: "failed",
    message: "Build failed.",
    error: { archivePath: "/private/build/archive.xcarchive" },
  });
  const unsafeResult = validateDeliveryEnvelope(unsafe);
  assert.equal(unsafeResult.valid, false);
  assert.match(unsafeResult.errors.join(" "), /archivePath/);

  const install = deliveryEnvelope({
    outcome: "install-link-ready",
    message: "This change needs a new signed build.",
    delivery: { kind: "install", universalLink: "https://example.test/d/build/opaque-placeholder" },
  });
  assert.deepEqual(validateDeliveryEnvelope(install), { valid: true, errors: [] });

  const warning = deliveryEnvelope({
    outcome: "install-link-ready",
    message: "This change needs a new signed build.",
    delivery: {
      kind: "install",
      universalLink: "https://example.test/d/build/opaque-placeholder",
      customScheme: "swift-sim://install/opaque-placeholder",
    },
    warning: { code: "PROVISIONING_WARNING", message: "The device profile may need renewal." },
  });
  assert.deepEqual(validateDeliveryEnvelope(warning), { valid: true, errors: [] });
  assert.equal(warning.warning.code, "PROVISIONING_WARNING");

  const userAction = deliveryEnvelope({
    outcome: "needs-user-action",
    message: "Update Swift Sim, then start a new agent session.",
    reasonCode: "PROTOCOL_MISMATCH",
    error: { code: "PROTOCOL_MISMATCH", action: "update" },
  });
  assert.deepEqual(validateDeliveryEnvelope(userAction), { valid: true, errors: [] });
  const untypedAction = deliveryEnvelope({
    outcome: "needs-user-action",
    message: "Action required.",
  });
  assert.equal(validateDeliveryEnvelope(untypedAction).valid, false);
});
