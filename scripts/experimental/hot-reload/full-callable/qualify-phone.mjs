#!/usr/bin/env node
// Maintainer acceptance tool. Private snapshots only; no product file writes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, basename } from "node:path";
import { createLiveDeliveryAdapter } from "../../../../mac-helper/src/liveDeliveryAdapter.js";
import { createLiveDeliveryRuntime } from "../../../../mac-helper/src/liveDeliveryRuntime.js";
import { createLiveDeliveryQueue } from "../../../../mac-helper/src/liveDeliveryQueue.js";
import { liveRuntimeLockManager } from "../../../../mac-helper/src/liveEngineLifecycleLock.js";
import { queuedLiveEngineControl } from "../../../../mac-helper/src/liveReload.js";

assert.deepEqual(process.argv.slice(2, 4), ["--experimental-full-callable-v1", "--phone-ready"]);
const output = resolve(process.argv[4] || ".build/hot-reload-frontier/physical");
assert(!existsSync(output) || readdirSync(output).length === 0, "fresh isolated output directory required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const persistenceErrors = [];
function saveAfterMutation(name, value) {
  try { save(name, value); } catch (error) { persistenceErrors.push({ file: name, code: error.code || "WRITE_FAILED" }); }
}
const manifest = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
const generator = resolve(".build/hot-reload-frontier/full-callable/generate");
const coverage = JSON.parse(readFileSync(".build/hot-reload-frontier/zenics-captured/coverage.json", "utf8"));
const asyncOnly = process.argv[5] === "--async-only";
const names = ["ThumbnailPipeline.swift", "ThumbnailDiskCache.swift", "LibraryView.swift", "DataStore.swift", "ContentView.swift"]
  .filter(name => !asyncOnly || name !== "LibraryView.swift");
// Explicitly distinct qualification, never report this as the full four-file update.
const expectedReplacements = coverage.members.filter(member => names.includes(member.file)).length + 1;
const reference = manifest.compilations.find(context => context.moduleName === "ZenicsCalisthenicsVideo");
let files = names.map(name => {
  const path = reference.sources.find(path => basename(path) === name);
  assert(path, "expected captured source");
  const source = readFileSync(path, "utf8");
  assert.equal(hash(source), manifest.sourceBaselines[path], "installed source baseline must match");
  let after = Buffer.from(source);
  if (name === "ContentView.swift") {
    const needle = 'Tab("Library", systemImage:';
    assert.equal(source.split(needle).length, 2);
    after = Buffer.from(source.replace(needle, 'Tab("Library · Live", systemImage:'));
  } else {
    const members = coverage.members.filter(member => member.file === name).sort((a, b) => b.bodyStartUTF8 - a.bodyStartUTF8);
    assert(members.length);
    for (const member of members) {
      const open = after.indexOf(123, member.bodyStartUTF8);
      assert(open >= member.bodyStartUTF8 && open < member.bodyEndUTF8);
      const prefix = Buffer.from("\n        let __swiftSimFrontierQualification: Int = { var value = 0; value += 1; return value }()\n        _ = __swiftSimFrontierQualification\n");
      after = Buffer.concat([after.subarray(0, open + 1), prefix, after.subarray(open + 1)]);
    }
  }
  return { path, beforeSource: source, afterSource: after.toString("utf8") };
});
const recoveryDirectory = process.argv[6] === "--restore-from" ? resolve(process.argv[7]) : "";
if (recoveryDirectory) {
  files = JSON.parse(readFileSync(join(recoveryDirectory, "snapshots.json"), "utf8"));
  assert(files.every(file => hash(readFileSync(file.path)) === hash(file.beforeSource)), "recovery source baseline must remain unchanged");
}
save("snapshots.json", files);
const compiled = new Map();
let mutationAttempted = false;
let initialScope;
function compile(record) {
  const folder = join(output, record.requestId); mkdirSync(folder, { mode: 0o700 });
  const input = { module: reference.moduleName, files: record.files.map(file => ({ path: file.path, before: file.beforeSource, after: file.afterSource })) };
  const result = spawnSync(generator, ["--experimental-full-callable-v1"], { input: JSON.stringify(input), encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(folder, "generator.txt"), result.stderr || "", { mode: 0o600 });
  assert.equal(result.status, 0, "whole snapshot must generate");
  const report = JSON.parse(result.stdout); assert.equal(report.changedMemberCount, expectedReplacements);
  const sources = report.sources.map((source, index) => { const path = join(folder, `Replacement${index}.swift`); writeFileSync(path, source, { mode: 0o600 }); return path; });
  const dylib = join(folder, "eval_injection_swift_sim_dynamic_frontier.dylib");
  const build = spawnSync("xcrun", ["swiftc", "-emit-library", ...sources, "-module-name", `SwiftSimFrontier_${record.requestId.replaceAll("-", "_")}`,
    ...reference.compilerArguments, "-Xfrontend", "-disable-access-control", "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup", "-o", dylib],
    { cwd: reference.workingDirectory, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(folder, "compiler.txt"), build.stderr || build.stdout || "", { mode: 0o600 });
  assert.equal(build.status, 0, "complete snapshot must compile before admission");
  const symbols = spawnSync("nm", ["-j", dylib], { encoding: "utf8", timeout: 10_000 });
  assert.equal(symbols.status, 0);
  const count = new Set(symbols.stdout.split(/\r?\n/).filter(symbol => symbol.endsWith("TX"))).size;
  assert.equal(count, expectedReplacements, "every changed member must emit a real replacement definition");
  const artifactRoot = join(homedir(), ".swift-sim/live/queued-artifacts");
  const rootStats = lstatSync(artifactRoot);
  assert(rootStats.isDirectory() && !rootStats.isSymbolicLink() && (rootStats.mode & 0o077) === 0);
  const key = hash(JSON.stringify(["experimental-full-callable-v1", record.requestId, record.snapshotDigest]));
  const artifact = join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`);
  writeFileSync(`${artifact}.json`, JSON.stringify({ version: 1, key, requestId: record.requestId,
    snapshotDigest: record.snapshotDigest, binaryIdentity: record.scope.binaryIdentity, expiresAt: record.expiresAt }), { mode: 0o600, flag: "wx" });
  writeFileSync(artifact, readFileSync(dylib), { mode: 0o600, flag: "wx" });
  const value = { path: artifact, expected: count, snapshotDigest: record.snapshotDigest, scope: record.scope };
  compiled.set(record.requestId, value); save(`${record.requestId}-coverage.json`, { ...report, sources: undefined, emittedReplacements: count });
  return { path: artifact, mode: "experimental-full-callable-v1" };
}
const control = async (request, options) => {
  if (request.action === "inject_prepared") {
    assert(compiled.get(request.request_id)?.scope, "compiled immutable scope required before dispatch");
    initialScope = compiled.get(request.request_id).scope;
    mutationAttempted = true;
    save("restoration-obligation.json", { required: true, requestId: request.request_id,
      originalSnapshots: "snapshots.json", reason: "mutation dispatched; acknowledgement is not required for cleanup" });
  }
  const response = await queuedLiveEngineControl(request, options);
  if (response?.data?.report) {
    saveAfterMutation(`${request.request_id}-native.json`, response);
    const report = response.data.report;
    if (report.applied === true) assert.equal(report.dynamic_replacements, compiled.get(request.request_id)?.expected,
      "mismatched native count must fence uncertain state, never accept partial success");
  }
  return response;
};
const base = createLiveDeliveryAdapter({ control, compile });
const adapter = { ...base, cleanup: undefined,
  async prepare(record, options) {
    const prepared = await base.prepare(record, options);
    // This isolated queue must never present an experiment as stable coverage.
    const { coverageVersion: _coverage, ...rest } = prepared;
    return { ...rest, experimentalCapability: "experimental-full-callable-v1" };
  },
  validatePrepared(record) {
    const candidate = compiled.get(record.requestId);
    assert(candidate && candidate.snapshotDigest === record.snapshotDigest);
    assert.equal(record.preparedPatch.experimentalCapability, "experimental-full-callable-v1");
    const stats = lstatSync(candidate.path); assert(stats.isFile() && !stats.isSymbolicLink());
    assert.equal(hash(readFileSync(candidate.path)), record.preparedPatch.patchDigest);
  },
};
const queue = createLiveDeliveryQueue({ rootPath: join(output, "isolated-queue"), lockManager: liveRuntimeLockManager });
const runtime = createLiveDeliveryRuntime({ queue, adapter });
const receipt = { startedAt: new Date().toISOString(), sourceUnchanged: false, complete: false,
  qualification: asyncOnly ? "async-body-and-internal-callables" : "full-four-file-and-root", expectedReplacements,
  fullFourFileQualified: false };
save("result.json", receipt);
async function drive(requestId, activeRuntime = runtime) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    await activeRuntime.runOnce();
    const result = activeRuntime.status(requestId);
    saveAfterMutation("latest-status.json", result);
    if (result.outcome === "hot-reloaded") return result;
    if (result.outcome !== "queued" && result.reasonCode !== "QUEUE_APPLY_UNCONFIRMED") throw new Error(`qualification ended: ${result.outcome}`);
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("bounded qualification waiting deadline reached; no mutation retried");
}
let originalError;
try {
  if (recoveryDirectory) {
    const previous = JSON.parse(readFileSync(join(recoveryDirectory, "result.json"), "utf8"));
    const priorQueue = JSON.parse(readFileSync(join(recoveryDirectory, "isolated-queue/queue.json"), "utf8"));
    const record = priorQueue.records.find(record => record.requestId === previous.applyRequestId);
    assert(record?.proof && previous.apply?.outcome === "hot-reloaded");
    initialScope = record.scope;
    receipt.apply = previous.apply;
    receipt.recoveryFor = previous.applyRequestId;
    mutationAttempted = true;
  } else {
  const binding = await adapter.binding({ project: manifest.binding.projectPath, scheme: manifest.binding.scheme });
  initialScope = binding.scope;
  const queued = await runtime.enqueue({ files, project: manifest.binding.projectPath, scheme: manifest.binding.scheme });
  receipt.applyRequestId = queued.delivery.requestId; save("result.json", receipt);
  receipt.apply = await drive(receipt.applyRequestId); saveAfterMutation("result.json", receipt);
  console.log(JSON.stringify({ phase: "applied", revision: receipt.apply.delivery.revision }));
  }
} catch (error) {
  originalError = error;
  receipt.error = String(error.message).slice(0, 500);
} finally {
  try {
  // Always discharge desired state in the original queue. An uncertain native
  // operation is never retried. Compensation is a distinct request/queue with
  // a fresh authenticated revision in exactly the original binary/process.
  receipt.restorationRequired = mutationAttempted;
  saveAfterMutation("result.json", receipt);
  if (initialScope) {
    try { receipt.revoke = await queue.revokeDesired({ scope: initialScope }); }
    catch (error) { receipt.revokeError = String(error.code || "REVOCATION_FAILED"); }
  }
  if (mutationAttempted) {
    receipt.restorationRequired = true; saveAfterMutation("result.json", receipt);
    const observed = await adapter.inspect({ scope: initialScope });
    assert(observed.connected && observed.foreground && observed.rootReady && observed.matchesBinary,
      "restoration obligation persists until the matching process returns");
    assert.deepEqual(observed.scope, initialScope, "never compensate into a different binary/process");
    const restoreQueue = createLiveDeliveryQueue({ rootPath: join(output, "restoration-queue"), lockManager: liveRuntimeLockManager });
    const restoreRuntime = createLiveDeliveryRuntime({ queue: restoreQueue, adapter });
    try {
      const restore = await restoreQueue.enqueue({ scope: observed.scope, baselineRevision: observed.revision,
        files: files.map(file => ({ path: file.path, beforeSource: file.afterSource, afterSource: file.beforeSource })) });
      receipt.restoreRequestId = restore.requestId; saveAfterMutation("result.json", receipt);
      receipt.restore = await drive(receipt.restoreRequestId, restoreRuntime);
      try { await restoreQueue.revokeDesired({ scope: initialScope }); }
      catch (error) { receipt.restoreRevocationError = String(error.code || "REVOCATION_FAILED"); }
      receipt.restorationRequired = false;
      receipt.complete = Boolean(receipt.apply);
      saveAfterMutation("restoration-obligation.json", { required: false, restoreRequestId: receipt.restoreRequestId,
        restoredRevision: receipt.restore.delivery.revision, originalOperationRetried: false });
    } finally { await restoreRuntime.stop(); }
  }
  } catch (error) {
    receipt.recoveryError = String(error.message).slice(0, 500);
    throw error;
  } finally {
    try {
      receipt.sourceUnchanged = files.every(file => hash(readFileSync(file.path)) === hash(file.beforeSource));
      receipt.finishedAt = new Date().toISOString(); receipt.persistenceErrors = persistenceErrors;
      saveAfterMutation("result.json", receipt);
    } finally { await runtime.stop(); }
  }
}
if (originalError) throw originalError;
assert(receipt.complete && receipt.sourceUnchanged);
console.log(JSON.stringify({ phase: "restored", revision: receipt.restore.delivery.revision, complete: true, sourceUnchanged: true }));
