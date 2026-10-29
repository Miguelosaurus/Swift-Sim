import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeHealthPayload, HELPER_RUNTIME_ROLE, inspectRuntimeHealth } from "../mac-helper/src/runtimeHealth.js";
import { deliveryRuntimeHealth } from "../mac-helper/src/helperDeliveryReadiness.js";
import { deliverChange } from "../mac-helper/src/changeDelivery.js";

const entrypoint = fileURLToPath(new URL("../mac-helper/bin/swift-sim-entry.js", import.meta.url));
const rawEntrypoint = fileURLToPath(new URL("../mac-helper/bin/swift-sim.js", import.meta.url));
const payload = runtimeHealthPayload(HELPER_RUNTIME_ROLE);
const hotFiles = [{ path: "Card.swift", kind: "swift", status: "modified", beforeSource: 'struct Card { var body: String { "old" } }', afterSource: 'struct Card { var body: String { "new" } }' }];

const cases = [
  { name: "stalled response headers", code: "HELPER_TIMEOUT", respond: () => {} },
  { name: "stalled response body", code: "HELPER_TIMEOUT", respond: (_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{"ok":'); } },
  { name: "malformed JSON", code: "HELPER_RESPONSE_INVALID", respond: (_req, res) => res.end("not-json token=private-value /Users/private/secret") },
  { name: "oversized body", code: "HELPER_RESPONSE_INVALID", respond: (_req, res) => res.end(JSON.stringify({ ...payload, private: "x".repeat(20_000) })) },
  { name: "invalid envelope", code: "HELPER_RESPONSE_INVALID", respond: (_req, res) => res.end(JSON.stringify({ ...payload, ok: "true" })) },
  { name: "wrong listener identity", code: "HELPER_IDENTITY_MISMATCH", respond: (_req, res) => res.end(JSON.stringify({ ...payload, helper: "unrelated-service" })) },
  { name: "outdated helper", code: "HELPER_VERSION_MISMATCH", respond: (_req, res) => res.end(JSON.stringify({ ...payload, version: "0.4.0" })) },
  { name: "incompatible protocol", code: "PROTOCOL_MISMATCH", respond: (_req, res) => res.end(JSON.stringify({ ...payload, protocol: 2 })) },
  { name: "unhealthy helper", code: "HELPER_UNHEALTHY", respond: (_req, res) => res.end(JSON.stringify({ ...payload, ok: false })) },
  { name: "HTTP failure", code: "HELPER_HTTP_ERROR", respond: (_req, res) => { res.writeHead(503); res.end("token=private-value /Users/private/secret"); } },
];

for (const scenario of cases) {
  test(`delivery diagnoses ${scenario.name} through raw and installed-shape entrypoints`, { timeout: 15_000 }, async () => {
    await withHealthServer(scenario.respond, async (port) => {
      const fixture = createFixture();
      try {
        for (const entry of [rawEntrypoint, fixture.installedEntry]) {
          const result = await runDelivery(entry, fixture, port);
          assert.equal(result.exitCode, 1, result.stderr);
          assert.equal(result.envelope.outcome, "needs-user-action");
          assert.equal(result.envelope.reasonCode, scenario.code);
          assert.equal(result.envelope.error.code, scenario.code);
          assert.equal(result.envelope.diagnostics.runtime.code, scenario.code);
          assert.doesNotMatch(JSON.stringify(result.envelope), /private-value|\/Users\/private|not-json|unrelated-service/);
          if (scenario.code !== "PROTOCOL_MISMATCH") assert.doesNotMatch(result.envelope.message, /new agent session/);
          if (scenario.code === "HELPER_HTTP_ERROR") assert.equal(result.envelope.diagnostics.runtime.cause.httpStatus, 503);
          assert.ok(result.envelope.timing.totalMs < 5_000);
        }
      } finally { rmSync(fixture.root, { recursive: true, force: true }); }
    });
  });
}

test("refused helper connections are actionable and retain sanitized transport cause", { timeout: 10_000 }, async () => {
  let port;
  await withHealthServer((_req, res) => res.end(), async (value) => { port = value; });
  const fixture = createFixture();
  try {
    const result = await runDelivery(fixture.installedEntry, fixture, port);
    assert.equal(result.envelope.reasonCode, "HELPER_CONNECTION_REFUSED");
    assert.match(result.envelope.message, /setup to start it/);
    assert.deepEqual(result.envelope.diagnostics.runtime.cause, { category: "transport", transportCode: "ECONNREFUSED" });
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

test("healthy response uses the same readiness contract and returns no raw payload", async () => {
  await withHealthServer((_req, res) => res.end(JSON.stringify(payload)), async (port) => {
    const report = await deliveryRuntimeHealth({ inspect: () => inspectRuntimeHealth(`http://127.0.0.1:${port}/health`) });
    assert.deepEqual(report, { ok: true, version: payload.version, protocol: payload.protocol });
  });
});

test("transport exceptions keep only allowlisted causes and block all delivery mutation", async () => {
  const inspector = () => inspectRuntimeHealth("http://127.0.0.1/health", {
    fetchImpl: async () => { throw new Error("Bearer private-value /Users/private/secret", { cause: Object.assign(new Error("token=secret"), { code: "ECONNRESET" }) }); },
  });
  const health = await deliveryRuntimeHealth({ inspect: inspector });
  assert.equal(health.code, "HELPER_TRANSPORT_ERROR");
  assert.deepEqual(health.diagnostic.cause, { category: "transport", transportCode: "ECONNRESET" });
  let routes = 0; let builds = 0;
  const result = await deliverChange({ files: hotFiles, verbose: true, runtimeCheck: () => deliveryRuntimeHealth({ inspect: inspector }), route: async () => { routes += 1; }, buildDevice: async () => { builds += 1; } });
  assert.equal(routes, 0); assert.equal(builds, 0);
  assert.equal(result.reasonCode, "HELPER_TRANSPORT_ERROR");
  assert.doesNotMatch(JSON.stringify(result), /private-value|\/Users\/private|token=secret/);
});

test("health deadline bounds a fetch implementation that ignores cancellation", async () => {
  const started = Date.now();
  const result = await inspectRuntimeHealth("http://127.0.0.1/health", { timeoutMs: 20, fetchImpl: () => new Promise(() => {}) });
  assert.equal(result.failureCode, "HELPER_TIMEOUT");
  assert.ok(Date.now() - started < 1_000);
});

test("health deadline cancels a stalled body even when its transport ignores the signal", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":')); },
    cancel() { cancelled = true; },
  });
  const result = await inspectRuntimeHealth("http://127.0.0.1/health", { timeoutMs: 20, fetchImpl: async () => new Response(body) });
  assert.equal(result.failureCode, "HELPER_TIMEOUT");
  assert.equal(cancelled, true);
});

async function withHealthServer(respond, run) {
  const server = createServer(respond);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { return await run(server.address().port); }
  finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-delivery-health-"));
  const bin = join(root, "bin"); mkdirSync(bin);
  const before = join(root, "Before.swift"); const after = join(root, "After.swift");
  writeFileSync(before, hotFiles[0].beforeSource); writeFileSync(after, hotFiles[0].afterSource);
  const installedEntry = join(bin, "swift-sim"); symlinkSync(entrypoint, installedEntry);
  return { root, before, after, installedEntry };
}

async function runDelivery(entry, fixture, port) {
  const child = spawn(process.execPath, [entry, "deliver-change", "--before", fixture.before, "--after", fixture.after, "--configuration", "Debug", "--verbose-json"], {
    env: { ...process.env, HOME: fixture.root, SWIFT_SIM_PORT: String(port), NODE_OPTIONS: "" },
    stdio: ["ignore", "pipe", "pipe"], timeout: 7_000, killSignal: "SIGKILL",
  });
  let stdout = ""; let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
  const [exitCode] = await once(child, "exit");
  return { exitCode, stderr, envelope: JSON.parse(stdout) };
}
