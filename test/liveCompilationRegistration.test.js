import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { chmodSync } from "node:fs";
import { once } from "node:events";
import { inspectLiveBuildResult, registerLiveBuildResult, queuedLiveEngineControl, LIVE_COMPILER_REGISTRATION_TIMEOUT_MS, LIVE_COMPILER_REGISTRATION_BUDGET_MS } from "../mac-helper/src/liveReload.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
const fixtureFileStore = new NodeAtomicFileStore();

const sha = (value) => createHash("sha256").update(value).digest("hex");
function engineFixture() {
  let clock = 1_000_000;
  const state = { nonce: "registration-engine-one", generation: 0, operations: new Map(), current: null, pending: null, activations: 0, registerCalls: 0, queries: 0, failReply: false, hang: false, protocol: 1, receiptMutation: null, capturedCommands: [], terminalState: "committed" };
  function receipt(op) {
    return { compilation_registration_protocol: state.protocol, engine_instance_nonce: state.nonce,
      registration_id: op.id, map_digest: op.map, provenance_digest: op.provenance,
      state: op.state === "committed" && state.current !== op ? "superseded" : op.state,
      current_registration_id: state.current?.id || "", command_count: op.commands.length,
      registered_count: op.sources.length, sources: op.sources };
  }
  async function control(request, options) {
    if (request.action === "compilation_registration_status" && !request.registration_id) return { success: true, data: {
      compilation_registration_protocol: state.protocol, engine_instance_nonce: state.nonce, activation_generation: state.generation,
      ...(state.pending ? { pending_registration: receipt(state.pending) } : {}), ...(state.current ? { current_registration: receipt(state.current) } : {}),
    } };
    if (request.action === "register_compilation_map") {
      state.registerCalls++;
      assert.equal(options.timeoutMs, LIVE_COMPILER_REGISTRATION_TIMEOUT_MS);
      assert.equal(sha(request.payload_json), request.map_digest);
      let op = state.operations.get(request.registration_id);
      if (!op) {
        assert.equal(state.pending, null);
        const commands = JSON.parse(request.payload_json);
        state.capturedCommands = commands;
        op = { id: request.registration_id, map: request.map_digest, provenance: request.provenance_digest, state: "scheduled", commands,
          sources: [...new Set(commands.flatMap((command) => command.arguments.filter((arg) => arg.endsWith(".swift"))))] };
        state.operations.set(op.id, op); state.pending = op; state.activations++; state.generation++;
      }
      if (state.failReply) { state.failReply = false; return null; }
      return { success: true, data: receipt(op) };
    }
    state.queries++;
    const op = state.operations.get(request.registration_id);
    if (!op) return { success: true, data: { engine_instance_nonce: state.nonce, registration_id: request.registration_id, map_digest: request.map_digest, provenance_digest: request.provenance_digest, state: "unknown" } };
    if (op === state.pending && !state.hang) { op.state = state.terminalState; if (op.state === "committed") state.current = op; state.pending = null; }
    let result = receipt(op);
    if (state.receiptMutation) result = state.receiptMutation(result, request);
    return { success: true, data: result };
  }
  return { state, control, now: () => clock, wait: async (ms) => { clock += ms; } };
}
function fixture({ commands = 1, sources = 1, engine = engineFixture() } = {}) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-registration-"));
  const resultBundle = join(root, "Build.xcresult"); mkdirSync(resultBundle);
  const projectPath = join(root, "Fixture.xcodeproj"); mkdirSync(projectPath);
  writeFileSync(join(projectPath, "project.pbxproj"), "fixture project");
  const sourcePaths = Array.from({ length: sources }, (_, i) => join(root, `LongSourceFileNameForBoundedCompilerRegistration${i}.swift`));
  for (const source of sourcePaths) writeFileSync(source, "struct Fixture {}\n");
  const emittedOutput = Array.from({ length: commands }, (_, index) => `/usr/bin/swift-frontend -frontend -c -module-name Fixture${index} -sdk /tmp/iPhoneOS.sdk -target arm64-apple-ios16.0 ${sourcePaths.join(" ")} -file-compilation-dir ${root}`).join("\n");
  const liveManifestPath = join(root, "compilations.json");
  const options = { resultBundle, projectPath, scheme: "Fixture", runtime: { buildLog: { emittedOutput }, liveManifestPath, engineControl: engine.control, now: engine.now, wait: engine.wait, lock: (operation) => operation() } };
  return { root, options, sourcePaths, engine, manifest: () => JSON.parse(fixtureFileStore.readTextSync(liveManifestPath)), cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("a large dependency map registers once and publishes only after its current complete receipt", async () => {
  const f = fixture({ commands: 89, sources: 114 });
  try {
    const capture = inspectLiveBuildResult(f.options);
    assert.ok(Buffer.byteLength(JSON.stringify(capture.commands)) > 64 * 1024);
    const result = await registerLiveBuildResult({ ...f.options, expectedProvenance: capture.provenance });
    assert.equal(result.registered, 114); assert.equal(f.engine.state.activations, 1);
    assert.equal(f.engine.state.capturedCommands.length, 89);
    assert.equal(f.manifest().compilations.length, 89);
    assert.equal(f.manifest().registration.requestId, result.registration.requestId);
    assert.equal(f.manifest().registration.engineNonce, "registration-engine-one");
  } finally { f.cleanup(); }
});

test("lost registration reply reconciles the same operation and pending resume never schedules a second map", async () => {
  const f = fixture();
  try {
    f.engine.state.failReply = true;
    const first = await registerLiveBuildResult(f.options);
    const second = await registerLiveBuildResult(f.options);
    assert.equal(first.registration.requestId, second.registration.requestId);
    assert.equal(f.engine.state.activations, 1);
    assert.equal(f.engine.state.registerCalls, 2);
  } finally { f.cleanup(); }
});

test("a bounded pending timeout preserves the old manifest and resumes the exact pending ticket", async () => {
  const f = fixture();
  try {
    writeFileSync(f.options.runtime.liveManifestPath, '{"old":"qualified"}', { mode: 0o600 });
    f.engine.state.hang = true;
    const began = f.engine.now();
    await assert.rejects(registerLiveBuildResult(f.options), { code: "LIVE_REGISTRATION_PENDING" });
    const pendingId = f.engine.state.pending.id;
    assert.equal(f.engine.now() - began, LIVE_COMPILER_REGISTRATION_BUDGET_MS);
    assert.deepEqual(f.manifest(), { old: "qualified" });
    f.engine.state.hang = false;
    const result = await registerLiveBuildResult(f.options);
    assert.equal(result.registration.requestId, pendingId);
    assert.equal(f.engine.state.activations, 1);
  } finally { f.cleanup(); }
});

test("sequential A B A qualification requires a new current activation instead of historical A proof", async () => {
  const engine = engineFixture(); const a = fixture({ engine }); const b = fixture({ engine });
  try {
    const first = await registerLiveBuildResult(a.options);
    await registerLiveBuildResult(b.options);
    const again = await registerLiveBuildResult(a.options);
    assert.notEqual(again.registration.requestId, first.registration.requestId);
    assert.equal(engine.state.activations, 3);
    assert.equal(engine.state.current.id, again.registration.requestId);
    assert.equal(a.manifest().registration.requestId, again.registration.requestId);
  } finally { a.cleanup(); b.cleanup(); }
});

test("foreign and newly superseded receipts cannot replace an existing qualified manifest", async () => {
  for (const mutation of [(receipt) => ({ ...receipt, engine_instance_nonce: "different-engine" }), (receipt) => ({ ...receipt, current_registration_id: "different-map" })]) {
    const f = fixture();
    try {
      writeFileSync(f.options.runtime.liveManifestPath, '{"old":"qualified"}', { mode: 0o600 });
      f.engine.state.receiptMutation = mutation;
      await assert.rejects(registerLiveBuildResult(f.options), (error) => ["LIVE_REGISTRATION_RECEIPT_MISMATCH", "LIVE_REGISTRATION_RECEIPT_INVALID", "LIVE_REGISTRATION_SUPERSEDED"].includes(error.code));
      assert.deepEqual(f.manifest(), { old: "qualified" });
    } finally { f.cleanup(); }
  }
});

test("source drift before registration prevents engine mutation and drift during registration prevents publication", async () => {
  const f = fixture();
  try {
    const capture = inspectLiveBuildResult(f.options);
    writeFileSync(f.sourcePaths[0], "struct ChangedBeforeCapture {}\n");
    await assert.rejects(registerLiveBuildResult({ ...f.options, expectedProvenance: capture.provenance }), { code: "LIVE_CAPTURE_PROVENANCE_CHANGED" });
    assert.equal(f.engine.state.activations, 0);
    writeFileSync(f.options.runtime.liveManifestPath, '{"old":"qualified"}', { mode: 0o600 });
    f.engine.state.receiptMutation = (receipt) => { writeFileSync(f.sourcePaths[0], "struct ChangedDuringCapture {}\n"); return receipt; };
    await assert.rejects(registerLiveBuildResult(f.options), { code: "LIVE_CAPTURE_PROVENANCE_CHANGED" });
    assert.deepEqual(f.manifest(), { old: "qualified" });
  } finally { f.cleanup(); }
});

test("old engines require explicit transactional update without any partial map mutation", async () => {
  const f = fixture();
  try {
    f.engine.state.protocol = 0;
    await assert.rejects(registerLiveBuildResult(f.options), { code: "LIVE_ENGINE_REGISTRATION_UPDATE_REQUIRED" });
    assert.equal(f.engine.state.activations, 0);
  } finally { f.cleanup(); }
});

async function withSocketPeer(operation, run) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-control-peer-")); const socketPath = join(root, "engine.sock");
  const peers = new Set();
  const server = createServer((socket) => { peers.add(socket); socket.on("error", () => {}); socket.on("close", () => peers.delete(socket)); operation(socket); });
  server.listen(socketPath); await once(server, "listening"); chmodSync(socketPath, 0o600);
  try { await run(socketPath); } finally { for (const peer of peers) peer.destroy(); await new Promise((done) => server.close(done)); rmSync(root, { recursive: true, force: true }); }
}

test("actual control RPC has an absolute deadline even while a peer trickles bytes", async () => {
  await withSocketPeer((socket) => {
    socket.write('{"success":true,"data":{"value":"');
    const timer = setInterval(() => socket.write("x"), 10);
    socket.on("close", () => clearInterval(timer));
  }, async (socketPath) => {
    const start = Date.now();
    assert.equal(await queuedLiveEngineControl({ action: "status" }, { socketPath, timeoutMs: 70 }), null);
    assert.ok(Date.now() - start < 500);
  });
});

test("actual control RPC preserves Unicode split across socket chunks", async () => {
  await withSocketPeer((socket) => {
    const bytes = Buffer.from(JSON.stringify({ success: true, data: { value: "✓" } }) + "\n");
    const split = bytes.indexOf(Buffer.from("✓")) + 1;
    socket.write(bytes.subarray(0, split));
    setTimeout(() => socket.end(bytes.subarray(split)), 5);
  }, async (socketPath) => {
    assert.deepEqual(await queuedLiveEngineControl({ action: "status" }, { socketPath, timeoutMs: 500 }), { success: true, data: { value: "✓" } });
  });
});

test("actual control RPC rejects an oversized response without parsing or waiting indefinitely", async () => {
  await withSocketPeer((socket) => socket.end('{' + "x".repeat(32 * 1024 * 1024)), async (socketPath) => {
    assert.equal(await queuedLiveEngineControl({ action: "status" }, { socketPath, timeoutMs: 2000 }), null);
  });
});


test("a failed or expired metadata attempt can retry the same capture with a new bounded activation", async () => {
  for (const terminal of ["failed", "cancelled"]) {
    const f = fixture();
    try {
      f.engine.state.terminalState = terminal;
      await assert.rejects(registerLiveBuildResult(f.options), { code: "LIVE_REGISTRATION_FAILED" });
      const firstId = [...f.engine.state.operations.keys()][0];
      f.engine.state.terminalState = "committed";
      const recovered = await registerLiveBuildResult(f.options);
      assert.notEqual(recovered.registration.requestId, firstId);
      assert.equal(f.engine.state.activations, 2);
      assert.equal(f.manifest().registration.requestId, recovered.registration.requestId);
    } finally { f.cleanup(); }
  }
});
