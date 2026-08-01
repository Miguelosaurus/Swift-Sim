import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { helperHealthURLsFromProcess } from "../mac-helper/src/cliRuntimeBoundary.js";
import { SWIFT_SIM_VERSION } from "../mac-helper/src/runtimeHealth.js";

const moduleURL = pathToFileURL(fileURLToPath(
  new URL("../mac-helper/src/cliRuntimeBoundary.js", import.meta.url)
)).href;

test("setup-status derives the exact custom helper health endpoint", () => {
  assert.deepEqual(
    helperHealthURLsFromProcess([
      process.execPath,
      "/tmp/mac-helper/bin/swift-sim-helper.js",
      "setup-status",
      "--host", "localhost",
      "--port=48123",
    ]),
    [
      "http://127.0.0.1:47217/health",
      "http://localhost:48123/health",
    ],
  );
});

test("CLI health checks reject reachable incompatible helpers", () => {
  const source = `
    let payload = { ok: true, helper: "old-helper", version: "0.4.0", protocol: 1 };
    globalThis.fetch = async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const boundary = await import(${JSON.stringify(moduleURL)});
    boundary.installCompatibleHelperHealthFetchBoundary({
      healthURLs: ["http://localhost:48123/health"],
    });
    const rejected = await fetch("http://localhost:48123/health");
    payload = {
      ok: true,
      helper: "swift-sim-helper",
      version: ${JSON.stringify(SWIFT_SIM_VERSION)},
      protocol: 1,
    };
    const accepted = await fetch("http://localhost:48123/health");
    console.log(JSON.stringify({ rejected: rejected.status, accepted: accepted.status }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, SWIFT_SIM_PORT: "47217" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { rejected: 503, accepted: 200 });
});
