#!/usr/bin/env node
// Compiles immutable iOS variants. No engine requests or phone mutations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { classifyPrivateAdditiveEditSet, prepareCompleteQueuedLivePatch } from "../../../../mac-helper/src/liveReload.js";

const output = resolve(process.argv[2] || `.build/additive-captured-${Date.now()}`);
assert(!existsSync(output), "fresh output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = source => createHash("sha256").update(source).digest("hex");
const manifestPath = join(homedir(), ".swift-sim/live/compilations.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
assert(context, "qualified Zenics capture required");
const path = context.sources.find(item => basename(item) === "ContentView.swift");
assert(path);
const original = readFileSync(path, "utf8");
assert.equal(hash(original), manifest.sourceBaselines[path]);
const needle = 'Tab("Library", systemImage:';
assert.equal(original.split(needle).length, 2);
let first = original.replace(needle, "Tab(swiftSimAdditiveQualificationTitle(), systemImage:");
if (!/^import Foundation\s*$/m.test(first)) first = "import Foundation\n" + first;
first += `
private struct SwiftSimAdditiveQualificationLabel { let text: String }
private func swiftSimAdditiveQualificationTitle() -> String {
    let label = SwiftSimAdditiveQualificationLabel(text: "Library · Additive")
    return label.text + " " + String(NSNumber(value: 1).intValue)
}
`;
const second = first.replace("NSNumber(value: 1)", "NSNumber(value: 2)");
assert.notEqual(first, second);
const variants = [[original, first], [first, second], [second, original]].map(([beforeSource, afterSource]) =>
  ({ path, beforeSource, afterSource, kind: "swift", status: "modified" }));
writeFileSync(join(output, "snapshots.json"), JSON.stringify(variants, null, 2), { mode: 0o600 });
const results = [];
for (const [index, file] of variants.entries()) {
  const classified = classifyPrivateAdditiveEditSet([file], { manifest, baselineForFile: () => original });
  assert.equal(classified?.route, "hot-reload", `classification ${index + 1}`);
  const record = { requestId: `additive-captured-${Date.now()}-${index}`,
    snapshotDigest: hash(JSON.stringify(file)), expiresAt: Date.now() + 60 * 60_000,
    scope: { binaryIdentity: `${manifest.binaryIdentity.executable_uuid}:${manifest.binaryIdentity.debug_dylib_uuid}` },
    files: [{ ...file, installedBaseline: original }] };
  const prepared = prepareCompleteQueuedLivePatch(record, { manifestPath,
    artifactRoot: join(output, "artifacts"), patchRoot: join(output, "patches") });
  assert.equal(prepared.additiveProtocol, 1);
  assert.equal(prepared.replacementProof.swift_replacements, 1);
  assert.equal(prepared.refreshStrategy, "preserve-state-v1");
  results.push({ variant: index + 1, classified, prepared });
  writeFileSync(join(output, "results.json"), JSON.stringify(results, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ variant: index + 1, compiled: true, replacements: 1, refreshStrategy: prepared.refreshStrategy }));
}
assert.equal(hash(readFileSync(path)), manifest.sourceBaselines[path]);
console.log(JSON.stringify({ complete: true, sourceUnchanged: true, phoneRequests: 0, output }));
