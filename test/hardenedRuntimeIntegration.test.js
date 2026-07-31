import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import {
  GATEWAY_RUNTIME_ROLE,
  HELPER_RUNTIME_ROLE,
  SWIFT_SIM_RUNTIME_PROTOCOL,
  SWIFT_SIM_VERSION,
} from "../mac-helper/src/runtimeHealth.js";

const preloadURL = pathToFileURL(
  new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url).pathname
).href;

for (const [scriptName, role] of [
  ["swift-sim-device-gateway.js", GATEWAY_RUNTIME_ROLE],
  ["swift-sim-helper.js", HELPER_RUNTIME_ROLE],
]) {
  test(`NODE_OPTIONS hardens a raw ${scriptName} child`, () => {
    const directory = mkdtempSync(join(tmpdir(), "swift-sim-runtime-integration-"));
    const scriptPath = join(directory, scriptName);
    writeFileSync(scriptPath, `
      import { createServer } from "node:http";
      const server = createServer((_req, res) => {
        res.writeHead(418, { "content-type": "text/plain" });
        res.end("downstream");
      });
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        const response = await fetch("http://127.0.0.1:" + address.port + "/health");
        console.log(JSON.stringify({ status: response.status, body: await response.json() }));
        server.close();
      });
    `, "utf8");
    try {
      const result = spawnSync(process.execPath, [scriptPath], {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          HOME: directory,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${preloadURL}`.trim(),
        },
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const output = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
      assert.equal(output.status, 200);
      assert.deepEqual(output.body, {
        ok: true,
        helper: role,
        version: SWIFT_SIM_VERSION,
        protocol: SWIFT_SIM_RUNTIME_PROTOCOL,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
