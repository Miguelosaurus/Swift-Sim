import test from "node:test";
import assert from "node:assert/strict";
import "../mac-helper/src/deviceBuildCapabilityBoundaryPreload.js";
import { createServer } from "node:http";
import { once } from "node:events";

test("patched createServer intercepts capability routes before the downstream listener", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(418, { "content-type": "text/plain" });
    res.end("downstream");
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/device-builds/unknown?token=invalid`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized." });
  } finally {
    server.close();
  }
});
