#!/usr/bin/env node
// Task-owned filesystem observers, ordinary durable delivery, no helper hooks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { deliverChange } from "../../../../dist/mac-helper/src/changeDelivery.js";
import { liveDeliveryService } from "../../../../dist/mac-helper/src/liveDeliveryService.js";
import { deliveryRuntimeHealth } from "../../../../dist/mac-helper/src/helperDeliveryReadiness.js";

assert.equal(process.argv[2], "--phone-ready");
const output = resolve(process.argv[3]), resume = process.argv[4] === "--resume";
assert.equal(existsSync(output), resume);
mkdirSync(output, { recursive: true, mode: 0o700 });
const root = join(homedir(), ".swift-sim/live"), service = liveDeliveryService();
const manifest = JSON.parse(readFileSync(join(root, "compilations.json")));
const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
const path = context.sources.find(path => path.endsWith("/JournalView.swift"));
const original = readFileSync(path, "utf8"), hash = value => createHash("sha256").update(value).digest("hex");
assert.equal(hash(original), manifest.sourceBaselines[path]);
const needle = '.navigationTitle("Zenics")'; assert.equal(original.split(needle).length, 2);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const result = resume ? JSON.parse(readFileSync(join(output, "result.json")))
  : { startedAt: new Date().toISOString(), complete: false, restorationRequired: false, steps: [] };
assert(!result.complete);
const events = [], seenQueue = new Set(), seenArtifacts = new Set();
const floor = service.queue.list().at(-1)?.sequence || 0;
let activeStart = performance.now();
const event = (phase, data = {}) => { events.push({ phase, ms: performance.now() - activeStart, wallMs: Date.now(), ...data }); };
const queueWatcher = watch(service.queue.rootPath, (_type, filename) => {
  if (filename !== "queue.json") return;
  try {
    for (const record of service.queue.list()) {
      if (record.sequence <= floor || !record.files.some(file => file.path === path)) continue;
      const key = `${record.requestId}:${record.state}:${Boolean(record.preparedPatch)}`;
      if (seenQueue.has(key)) continue; seenQueue.add(key);
      event(record.state, { requestId: record.requestId, journalMs: record.updatedAt, prepared: Boolean(record.preparedPatch) });
    }
  } catch { /* atomic publication can race an observation */ }
});
const artifactWatcher = watch(join(root, "queued-artifacts"), (_type, filename) => {
  if (!filename?.endsWith(".dylib.json")) return;
  try {
    const marker = JSON.parse(readFileSync(join(root, "queued-artifacts", filename)));
    const phase = marker.unsignedArtifactDigest ? "signed-marker" : marker.artifactDigest ? "compiled-marker" : "compile-input-ready";
    const key = marker.requestId + ":" + phase;
    if (seenArtifacts.has(key)) return; seenArtifacts.add(key); event(phase, { requestId: marker.requestId });
  } catch { /* observe final marker publication only */ }
});
const variants = Array.from({ length: 3 }, (_, round) => {
  const next = original.replace(needle, `.navigationTitle("Zenics · Timing ${round + 1}")`);
  return [[original, next], [next, original]].map(([beforeSource, afterSource], index) =>
    ({ round, action: index ? "restore" : "edit", path, beforeSource, afterSource }));
}).flat();
try {
  for (const [index, file] of variants.entries()) {
    activeStart = performance.now(); events.length = 0;
    let step = result.steps[index];
    if (!step) {
      event("delivery-start");
      const queued = await deliverChange({ project: manifest.binding.projectPath, scheme: manifest.binding.scheme,
        liveOnly: true, files: [file],
        runtimeCheck: async () => { event("health-start"); const value = await deliveryRuntimeHealth(); event("health-end"); return value; },
        queueLive: async input => { event("binding-start"); const value = await service.enqueue(input); event("enqueued", { requestId: value.delivery.requestId }); return value; } });
      save(`submitted-${index}.json`, queued); assert.equal(queued.outcome, "queued");
      step = { round: file.round, action: file.action, requestId: queued.delivery.requestId, confirmed: false };
      result.steps.push(step); result.restorationRequired = true; save("result.json", result);
    } else {
      const retained = service.queue.get(step.requestId); assert(retained);
      assert.equal(retained.files[0].beforeSource, file.beforeSource); assert.equal(retained.files[0].afterSource, file.afterSource);
    }
    let record; const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const status = service.status(step.requestId);
      if (status.outcome === "hot-reloaded") { record = service.queue.get(status.delivery.requestId); break; }
      save("latest-status.json", status);
      if (status.outcome !== "queued" && status.reasonCode !== "QUEUE_APPLY_UNCONFIRMED") throw Error(status.reasonCode || status.outcome);
      await new Promise(done => setTimeout(done, 100));
    }
    assert(record, "Retained request deadline; do not resubmit");
    assert(record.proof.applied && record.proof.refreshed);
    assert.equal(record.proof.refreshStrategy, "preserve-state-v1");
    assert.equal(record.proof.replacementCoverage.dynamic_replacements, 1);
    assert(record.proof.replacementCoverage.complete_replacement_coverage);
    if (index) { assert.equal(record.scope.sessionIdentity, result.steps[0].sessionIdentity); assert(record.proof.revision > result.steps[index - 1].revision); }
    Object.assign(step, { confirmed: true, totalMs: performance.now() - activeStart, sessionIdentity: record.scope.sessionIdentity,
      revision: record.proof.revision, events: [...events] });
    result.restorationRequired = file.action !== "restore";
    save(`record-${index}.json`, record); save("result.json", result);
    console.log(JSON.stringify({ index, action: file.action, totalMs: Math.round(step.totalMs), revision: step.revision,
      events: events.filter(e => e.requestId === record.requestId || !e.requestId).map(({ phase, ms }) => ({ phase, ms: Math.round(ms) })) }));
  }
  result.complete = true;
} catch (error) { result.error = String(error.message).slice(0, 300); throw error; }
finally {
  queueWatcher.close(); artifactWatcher.close();
  result.sourceUnchanged = readFileSync(path, "utf8") === original;
  result.finishedAt = new Date().toISOString(); save("result.json", result);
}
assert(result.complete && !result.restorationRequired && result.sourceUnchanged);
