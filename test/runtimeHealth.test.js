import test from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_RUNTIME_ROLE,
  HELPER_RUNTIME_ROLE,
  SWIFT_SIM_RUNTIME_PROTOCOL,
  SWIFT_SIM_VERSION,
  inspectRuntimeHealth,
  runtimeHealthMatches,
  runtimeHealthPayload,
} from "../mac-helper/src/runtimeHealth.js";

test("runtime health identifies the exact helper version and protocol", () => {
  const payload = runtimeHealthPayload(HELPER_RUNTIME_ROLE);
  assert.deepEqual(payload, {
    ok: true,
    helper: HELPER_RUNTIME_ROLE,
    version: SWIFT_SIM_VERSION,
    protocol: SWIFT_SIM_RUNTIME_PROTOCOL,
  });
  assert.equal(runtimeHealthMatches(payload, HELPER_RUNTIME_ROLE), true);
  assert.equal(runtimeHealthMatches(payload, GATEWAY_RUNTIME_ROLE), false);
  assert.equal(runtimeHealthMatches({ ...payload, version: "0.4.0" }, HELPER_RUNTIME_ROLE), false);
  assert.equal(runtimeHealthMatches({ ...payload, protocol: 2 }, HELPER_RUNTIME_ROLE), false);
});

test("runtime inspection distinguishes reachable incompatible listeners", async () => {
  const expected = await inspectRuntimeHealth("http://127.0.0.1/health", {
    timeoutMs: 0,
    fetchImpl: async () => new Response(JSON.stringify(runtimeHealthPayload(HELPER_RUNTIME_ROLE)), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(expected.reachable, true);
  assert.equal(expected.ok, true);

  const wrong = await inspectRuntimeHealth("http://127.0.0.1/health", {
    timeoutMs: 0,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, helper: "another-service" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(wrong.reachable, true);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.status, 200);
});
