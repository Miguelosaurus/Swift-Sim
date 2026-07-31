import test from "node:test";
import assert from "node:assert/strict";
import {
  GATEWAY_RUNTIME_ROLE,
  runtimeHealthPayload,
} from "../mac-helper/src/runtimeHealth.js";
import {
  installGatewayHealthFetchBoundary,
  isGatewayHealthRequest,
} from "../mac-helper/src/gatewayHealthFetchBoundary.js";

test("gateway health URL matching is limited to loopback health requests", () => {
  assert.equal(isGatewayHealthRequest("http://127.0.0.1:47218/health"), true);
  assert.equal(isGatewayHealthRequest("http://localhost:47218/health"), true);
  assert.equal(isGatewayHealthRequest("https://example.com/health"), false);
  assert.equal(isGatewayHealthRequest("http://127.0.0.1:47218/other"), false);
});

test("quick tunnel health rejects an unrelated local HTTP service", async () => {
  const originalFetch = globalThis.fetch;
  let payload = { ok: true, helper: "unrelated-service" };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  installGatewayHealthFetchBoundary();
  try {
    const rejected = await fetch("http://127.0.0.1:47218/health");
    assert.equal(rejected.status, 503);

    payload = runtimeHealthPayload(GATEWAY_RUNTIME_ROLE);
    const accepted = await fetch("http://127.0.0.1:47218/health");
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
