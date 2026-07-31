import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const preloadURL = pathToFileURL(fileURLToPath(
  new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url)
)).href;
const hardenedSource = readFileSync(
  new URL("../mac-helper/src/hardenedRuntimePreload.js", import.meta.url),
  "utf8",
);
const gatewaySource = readFileSync(
  new URL("../mac-helper/bin/swift-sim-device-gateway.js", import.meta.url),
  "utf8",
);

test("gateway and raw-helper production paths install their boundaries before use", () => {
  const directLock = gatewaySource.indexOf('import "../src/lockOwnershipPreload.js"');
  const capability = gatewaySource.indexOf('import "../src/deviceBuildCapabilityBoundaryPreload.js"');
  assert.ok(directLock >= 0);
  assert.ok(capability > directLock);
  assert.match(
    hardenedSource,
    /script === "swift-sim-device-gateway\.js"[\s\S]*lockOwnershipPreload\.js[\s\S]*runtimeHealthPreload\.js/,
  );
  assert.match(
    hardenedSource,
    /script === "swift-sim-helper\.js"[\s\S]*installCompatibleHelperHealthFetchBoundary\(\)/,
  );
});

test("raw public gateway child installs the claimed-lock guard", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-gateway-lock-"));
  const script = join(directory, "swift-sim-device-gateway.js");
  writeFileSync(script, `
    import { createRequire } from "node:module";
    const require = createRequire(import.meta.url);
    const fs = require("node:fs");
    console.log(fs.rmSync.name);
  `, "utf8");
  try {
    const result = spawnSync(process.execPath, [script], {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        HOME: directory,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${preloadURL}`.trim(),
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), "guardedRmSync");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("raw helper child rejects an incompatible custom health endpoint", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, helper: "legacy-or-unrelated" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-helper-health-"));
  const script = join(directory, "swift-sim-helper.js");
  writeFileSync(script, `
    const response = await fetch("http://127.0.0.1:${address.port}/health");
    console.log(response.status);
  `, "utf8");

  try {
    const child = spawn(process.execPath, [
      script,
      "setup-status",
      "--host", "127.0.0.1",
      "--port", String(address.port),
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: directory,
        SWIFT_SIM_PORT: "47217",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${preloadURL}`.trim(),
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr || stdout);
    assert.equal(stdout.trim().split(/\r?\n/).at(-1), "503");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
