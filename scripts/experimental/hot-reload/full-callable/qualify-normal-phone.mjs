#!/usr/bin/env node
// Current installed helper owns preparation/application. This operator tool
// submits immutable snapshots through the ordinary delivery service exactly once.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { deliverChange } from "../../../../dist/mac-helper/src/changeDelivery.js";
import { liveDeliveryService } from "../../../../dist/mac-helper/src/liveDeliveryService.js";
import { createFullCallableCompiler } from "../../../../dist/mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../../../../dist/mac-helper/src/infrastructure/nodeCommandRunner.js";

assert.equal(process.argv[2], "--phone-ready");
const output = resolve(process.argv[3] || `.build/callback-v3-phone-${Date.now()}`);
assert(!existsSync(output), "fresh qualification directory required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const manifest = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
assert(context);
const compiler = createFullCallableCompiler({ runner: new NodeCommandRunner({ spawn, spawnSync }), cacheRoot: join(output, "compiler-cache") });
const names = ["ThumbnailPipeline.swift", "ThumbnailDiskCache.swift", "LibraryView.swift", "DataStore.swift", "ContentView.swift"];
const current = names.map(name => {
  const path = context.sources.find(path => basename(path) === name); assert(path);
  const text = readFileSync(path, "utf8"); assert.equal(hash(text), manifest.sourceBaselines[path], "installed baseline must match source");
  return { path, text };
});
const historical = compiler.generate({ module: context.moduleName, generation: "a".repeat(32), files: current.slice(0, 4).map(file => ({
  path: file.path, before: readFileSync(join("/tmp/zenics-cache-scheduling.EgxxXW", basename(file.path)), "utf8"), after: file.text,
})) });
assert.equal(historical.changedMemberCount, 7);
const files = current.map(file => {
  let buffer = Buffer.from(file.text);
  if (basename(file.path) === "ContentView.swift") {
    const needle = 'Tab("Library", systemImage:'; assert.equal(file.text.split(needle).length, 2);
    buffer = Buffer.from(file.text.replace(needle, 'Tab("Library · Live", systemImage:'));
  } else {
    const members = historical.members.filter(member => member.file === basename(file.path)).sort((a, b) => b.bodyStartUTF8 - a.bodyStartUTF8);
    for (const member of members) {
      const open = buffer.indexOf(123, member.bodyStartUTF8); assert(open >= member.bodyStartUTF8 && open < member.bodyEndUTF8);
      buffer = Buffer.concat([buffer.subarray(0, open + 1), Buffer.from("\n        let __swiftSimCallbackQualification = { var value = 0; value += 1; return value }()\n        _ = __swiftSimCallbackQualification\n"), buffer.subarray(open + 1)]);
    }
  }
  return { path: file.path, kind: "swift", status: "modified", beforeSource: file.text, afterSource: buffer.toString("utf8") };
});
save("snapshots.json", files);
const service = liveDeliveryService();
const result = { startedAt: new Date().toISOString(), complete: false, sourceUnchanged: false, normalDelivery: true };
save("result.json", result);
const options = { project: manifest.binding.projectPath, scheme: manifest.binding.scheme, liveOnly: true };
async function waitFor(requestId) {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    const status = service.status(requestId); save("latest-status.json", status);
    if (status.outcome === "hot-reloaded") return service.queue.get(status.delivery.requestId);
    if (status.outcome !== "queued" && status.reasonCode !== "QUEUE_APPLY_UNCONFIRMED") throw new Error(`qualification ${status.reasonCode || status.outcome}`);
    await new Promise(done => setTimeout(done, 500));
  }
  throw new Error("qualification waiting deadline reached; original request retained without mutation retry");
}
function check(record) {
  assert.equal(record.proof?.applied, true); assert.equal(record.proof?.refreshed, true);
  const coverage = record.proof.replacementCoverage;
  assert.equal(coverage?.dynamic_replacements, 7); assert.equal(coverage?.objc_replacements, 1);
  assert.equal(coverage?.represented_replacements, 8); assert.equal(coverage?.complete_replacement_coverage, true);
  assert.equal(coverage.objc_callback_proofs.length, 1); assert.equal(coverage.objc_callback_proofs[0].verified, true);
  assert.equal(coverage.objc_callback_proofs[0].selector, "scrollViewWillBeginDragging:");
}
let first;
try {
  const queued = await deliverChange({ ...options, files });
  result.applyRequestId = queued.delivery?.requestId;
  result.restorationRequired = Boolean(result.applyRequestId);
  save("submitted.json", queued); save("result.json", result);
  assert.equal(queued.outcome, "queued");
  first = await waitFor(result.applyRequestId); check(first); save("application-record.json", first);
  result.apply = { requestId: first.requestId, revision: first.proof.revision, coverage: first.proof.replacementCoverage };
  result.restorationRequired = true; save("result.json", result);
  console.log(JSON.stringify({ phase: "applied", swift: 7, callbacks: 1, revision: first.proof.revision }));
  const restoreFiles = files.map(file => ({ ...file, beforeSource: file.afterSource, afterSource: file.beforeSource }));
  const restoration = await deliverChange({ ...options, files: restoreFiles });
  result.restoreRequestId = restoration.delivery?.requestId;
  save("restoration-submitted.json", restoration); save("result.json", result);
  assert.equal(restoration.outcome, "queued");
  const restored = await waitFor(result.restoreRequestId); check(restored); save("restoration-record.json", restored);
  assert.equal(restored.scope.binaryIdentity, first.scope.binaryIdentity); assert.equal(restored.scope.sessionIdentity, first.scope.sessionIdentity);
  assert(restored.proof.revision > first.proof.revision);
  // Do not revoke project-wide intent: a concurrent or previously confirmed
  // user edit can share this binary. Proven baseline desire is safe to retain.
  result.desiredBaselineRetained = true;
  result.restore = { requestId: restored.requestId, revision: restored.proof.revision, coverage: restored.proof.replacementCoverage };
  result.sameBinaryAndProcess = true; result.restorationRequired = false; result.complete = true;
} catch (error) {
  result.error = String(error.message).slice(0, 500);
  // An admitted queued/compiling/waiting request can apply after this tool
  // times out. Retain that cleanup obligation until restoration is proven.
  result.restorationRequired = Boolean(result.applyRequestId && !result.restore);
  // Preserve the same request and its recovery obligation. Never retry an
  // uncertain mutation or silently remove some other pending logical edit.
  throw error;
} finally {
  result.sourceUnchanged = current.every(file => hash(readFileSync(file.path)) === hash(file.text));
  result.finishedAt = new Date().toISOString(); save("result.json", result);
}
assert(result.complete && result.sourceUnchanged);
console.log(JSON.stringify({ phase: "restored", revision: result.restore.revision, sameBinaryAndProcess: true, sourceUnchanged: true }));
