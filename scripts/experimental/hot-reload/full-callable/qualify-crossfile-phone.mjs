#!/usr/bin/env node
// Explicit qualification via the ordinary installed helper. Never direct inject.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { deliverChange } from "../../../../dist/mac-helper/src/changeDelivery.js";
import { liveDeliveryService } from "../../../../dist/mac-helper/src/liveDeliveryService.js";
import { readAppContext } from "../../../../dist/mac-helper/src/appContext.js";

assert.equal(process.argv[2], "--phone-ready", "confirm phone availability first");
const input = JSON.parse(readFileSync(resolve(process.argv[3]), "utf8"));
const output = resolve(process.argv[4]);
const resume = process.argv[5] === "--resume";
assert.equal(existsSync(output), resume, "fresh output or explicit retained-request resume required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const { originals, variants } = input;
assert.deepEqual(variants.map(files => files.length), [3, 1, 3]);
const manifest = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
const hash = source => createHash("sha256").update(source).digest("hex");
const unchanged = () => Object.entries(originals).every(([path, source]) => source === ""
  ? !existsSync(path) : hash(readFileSync(path)) === hash(source) && hash(source) === manifest.sourceBaselines[path]);
assert(unchanged());
for (const file of variants[2]) assert.equal(file.afterSource, originals[file.path]);
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const service = liveDeliveryService();
const result = resume ? JSON.parse(readFileSync(join(output, "result.json"), "utf8"))
  : { startedAt: new Date().toISOString(), complete: false, restorationRequired: false, steps: [] };
assert(!result.complete);
assert(result.steps.length <= variants.length);
for (const [index, step] of result.steps.entries()) {
  assert.equal(step.variant, index + 1);
  const retained = service.queue.get(step.requestId);
  assert(retained, "missing retained intent; do not resubmit");
  assert.equal(retained.files.length, variants[index].length);
  for (const file of variants[index]) {
    const saved = retained.files.find(item => item.path === file.path);
    assert(saved);
    assert.equal(saved.beforeSource, file.beforeSource); assert.equal(saved.afterSource, file.afterSource);
  }
}
delete result.error; save("result.json", result);
async function waitFor(requestId) {
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    const status = service.status(requestId); save("latest-status.json", status);
    if (status.outcome === "hot-reloaded") return service.queue.get(status.delivery.requestId);
    if (status.outcome !== "queued" && status.reasonCode !== "QUEUE_APPLY_UNCONFIRMED")
      throw Error(`Qualification stopped: ${status.reasonCode || status.outcome}`);
    await new Promise(done => setTimeout(done, 500));
  }
  throw Error("Request retained at deadline; never resubmit or discard restoration obligation");
}
try {
  for (const [index, files] of variants.entries()) {
    let step = result.steps[index];
    if (!step) {
      const queued = await deliverChange({ project: manifest.binding.projectPath, scheme: manifest.binding.scheme, liveOnly: true, files });
      save(`submitted-${index + 1}.json`, queued); assert.equal(queued.outcome, "queued");
      step = { variant: index + 1, requestId: queued.delivery.requestId, confirmed: false };
      result.steps.push(step); result.restorationRequired = true; save("result.json", result);
    }
    const record = await waitFor(step.requestId); save(`record-${index + 1}.json`, record);
    assert.equal(record.preparedPatch.sharedAdditive, true);
    assert.equal(record.proof?.applied, true); assert.equal(record.proof?.refreshed, true);
    assert.equal(record.proof?.refreshStrategy, "preserve-state-v1");
    assert.equal(record.proof.replacementCoverage.complete_replacement_coverage, true);
    assert.equal(record.proof.replacementCoverage.dynamic_replacements, 1);
    assert.equal(record.proof.replacementCoverage.objc_replacements, 0);
    if (index) {
      assert.equal(record.scope.binaryIdentity, result.steps[0].binaryIdentity);
      assert.equal(record.scope.sessionIdentity, result.steps[0].sessionIdentity);
      assert(record.proof.revision > result.steps[index - 1].revision);
    }
    Object.assign(step, { confirmed: true, revision: record.proof.revision,
      binaryIdentity: record.scope.binaryIdentity, sessionIdentity: record.scope.sessionIdentity });
    save("result.json", result);
    // Separate on-demand rendering evidence. Failure here never prevents undo.
    await new Promise(done => setTimeout(done, 2_000));
    const context = await readAppContext({ project: manifest.binding.projectPath, scheme: manifest.binding.scheme,
      elements: true, screenshot: true, artifactRoot: output });
    save(`context-${index + 1}.json`, context);
    step.visualObservationAvailable = context.outcome === "context-ready";
    if (step.visualObservationAvailable) {
      const screen = JSON.stringify(context.screen);
      step.expectedLabelObserved = index < 2 ? screen.includes(`Library · Cross-file ${index + 1}`) : !screen.includes("Cross-file");
    }
    save("result.json", result);
    console.log(JSON.stringify({ variant: index + 1, confirmed: true, revision: step.revision, labelObserved: step.expectedLabelObserved ?? null }));
  }
  result.complete = true; result.restorationRequired = false;
} catch (error) { result.error = String(error.message).slice(0, 400); throw error; }
finally {
  result.sourceUnchanged = unchanged(); result.finishedAt = new Date().toISOString(); save("result.json", result);
}
assert(result.complete && result.sourceUnchanged && !result.restorationRequired);
console.log(JSON.stringify({ restored: true, sourceUnchanged: true, sameBinaryAndProcess: true }));
