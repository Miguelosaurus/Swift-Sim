#!/usr/bin/env node
// Explicit phone qualification through ordinary durable delivery, never a
// direct injection or product-source mutation. The installed helper does work.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { deliverChange } from "../../../../dist/mac-helper/src/changeDelivery.js";
import { liveDeliveryService } from "../../../../dist/mac-helper/src/liveDeliveryService.js";

assert.equal(process.argv[2], "--phone-ready", "confirm phone availability before running");
const snapshotsPath = resolve(process.argv[3]);
const output = resolve(process.argv[4] || `.build/additive-phone-${Date.now()}`);
assert(!existsSync(output), "fresh qualification output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const variants = JSON.parse(readFileSync(snapshotsPath, "utf8"));
assert.equal(variants.length, 3);
const manifest = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
const hash = source => createHash("sha256").update(source).digest("hex");
const sourcePath = variants[0].path;
const original = variants[0].beforeSource;
assert.equal(hash(original), manifest.sourceBaselines[sourcePath]);
assert.equal(hash(readFileSync(sourcePath)), hash(original));
assert(variants.every(file => file.path === sourcePath));
assert.equal(variants[1].beforeSource, variants[0].afterSource);
assert.equal(variants[2].beforeSource, variants[1].afterSource);
assert.equal(variants[2].afterSource, original);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const service = liveDeliveryService();
const result = { startedAt: new Date().toISOString(), complete: false, sourceUnchanged: true, restorationRequired: false, steps: [] };
save("result.json", result);
async function waitFor(requestId) {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const status = service.status(requestId);
    save("latest-status.json", status);
    if (status.outcome === "hot-reloaded") return service.queue.get(status.delivery.requestId);
    if (status.outcome !== "queued" && status.reasonCode !== "QUEUE_APPLY_UNCONFIRMED")
      throw Error(`Qualification stopped: ${status.reasonCode || status.outcome}`);
    await new Promise(done => setTimeout(done, 500));
  }
  throw Error("Request retained at waiting deadline; do not resubmit or discard restoration obligation");
}
try {
  for (const [index, file] of variants.entries()) {
    const queued = await deliverChange({ project: manifest.binding.projectPath, scheme: manifest.binding.scheme, liveOnly: true, files: [file] });
    save(`submitted-${index + 1}.json`, queued);
    assert.equal(queued.outcome, "queued");
    const step = { variant: index + 1, requestId: queued.delivery.requestId, confirmed: false };
    result.steps.push(step); result.restorationRequired = true; save("result.json", result);
    const record = await waitFor(step.requestId);
    save(`record-${index + 1}.json`, record);
    assert.equal(record.preparedPatch.additiveProtocol, 1);
    assert.equal(record.proof?.applied, true);
    assert.equal(record.proof?.refreshed, true);
    assert.equal(record.proof?.refreshStrategy, "preserve-state-v1");
    const coverage = record.proof.replacementCoverage;
    assert.equal(coverage.complete_replacement_coverage, true);
    assert.equal(coverage.dynamic_replacements, 1);
    assert.equal(coverage.objc_replacements, 0);
    if (index > 0) {
      assert.equal(record.scope.binaryIdentity, result.steps[0].binaryIdentity);
      assert.equal(record.scope.sessionIdentity, result.steps[0].sessionIdentity);
      assert(record.proof.revision > result.steps[index - 1].revision);
    }
    Object.assign(step, { confirmed: true, revision: record.proof.revision,
      binaryIdentity: record.scope.binaryIdentity, sessionIdentity: record.scope.sessionIdentity });
    save("result.json", result);
    console.log(JSON.stringify({ variant: index + 1, confirmed: true, revision: step.revision, refresh: record.proof.refreshStrategy }));
  }
  result.complete = true; result.restorationRequired = false;
} catch (error) {
  result.error = String(error.message).slice(0, 400);
  throw error;
} finally {
  result.sourceUnchanged = hash(readFileSync(sourcePath)) === hash(original);
  result.finishedAt = new Date().toISOString(); save("result.json", result);
}
assert(result.complete && result.sourceUnchanged && !result.restorationRequired);
console.log(JSON.stringify({ restored: true, sameBinaryAndProcess: true, sourceUnchanged: true }));
