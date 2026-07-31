import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import "../mac-helper/src/runtimeHealthPreload.js";
import { createServer } from "node:http";
import {
  GATEWAY_RUNTIME_ROLE,
  SWIFT_SIM_RUNTIME_PROTOCOL,
  SWIFT_SIM_VERSION,
} from "../mac-helper/src/runtimeHealth.js";

test("runtime health preload intercepts health before the downstream listener", async () => {
  const previousRole = process.env.SWIFT_SIM_RUNTIME_ROLE;
  process.env.SWIFT_SIM_RUNTIME_ROLE = GATEWAY_RUNTIME_ROLE;
  const server = createServer((_req, res) => {
    res.writeHead(418, { "content-type": "text/plain" });
    res.end("downstream");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      helper: GATEWAY_RUNTIME_ROLE,
      version: SWIFT_SIM_VERSION,
      protocol: SWIFT_SIM_RUNTIME_PROTOCOL,
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");

    const downstream = await fetch(`http://127.0.0.1:${address.port}/other`);
    assert.equal(downstream.status, 418);
  } finally {
    if (previousRole === undefined) delete process.env.SWIFT_SIM_RUNTIME_ROLE;
    else process.env.SWIFT_SIM_RUNTIME_ROLE = previousRole;
    server.close();
  }
});
