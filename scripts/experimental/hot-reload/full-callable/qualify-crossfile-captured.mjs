#!/usr/bin/env node
// Immutable device compilation only. Does not contact the engine or phone.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { classifyPrivateAdditiveEditSet, prepareCompleteQueuedLivePatch } from "../../../../mac-helper/src/liveReload.js";

const output = resolve(process.argv[2] || `.build/crossfile-captured-${Date.now()}`);
assert(!existsSync(output), "fresh output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = value => createHash("sha256").update(value).digest("hex");
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const manifestPath = join(homedir(), ".swift-sim/live/compilations.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
assert(context);
const path = context.sources.find(item => basename(item) === "ContentView.swift");
const original = readFileSync(path, "utf8");
assert.equal(hash(original), manifest.sourceBaselines[path]);
const helperPath = join(dirname(path), "SwiftSimCrossfileQualificationHelpers.swift");
const viewPath = join(dirname(path), "SwiftSimCrossfileQualificationBadge.swift");
assert(!existsSync(helperPath) && !existsSync(viewPath));
const title = 'Tab("Library", systemImage:';
const feedback = "        .sensoryFeedback(.selection, trigger: selectedTab)";
assert.equal(original.split(title).length, 2);
assert.equal(original.split(feedback).length, 2);
const root = original.replace(title, "Tab(swiftSimCrossfileQualificationTitle(), systemImage:")
  .replace(feedback, "        .overlay(alignment: .top) { SwiftSimCrossfileQualificationBadge().allowsHitTesting(false) }\n" + feedback);
const helper = number => `func swiftSimCrossfileQualificationTitle() -> String { "Library · Cross-file ${number}" }\n`;
const view = `import SwiftUI
struct SwiftSimCrossfileQualificationBadge: View {
    var body: some View {
        Text(swiftSimCrossfileQualificationTitle())
            .font(.caption.weight(.semibold)).padding(8)
            .background(.teal.opacity(0.15), in: Capsule())
    }
}
`;
const originals = { [path]: original, [helperPath]: "", [viewPath]: "" };
const file = (path, beforeSource, afterSource) => ({ path, beforeSource, afterSource, kind: "swift", status: "modified" });
const variants = [
  [file(path, original, root), file(helperPath, "", helper(1)), file(viewPath, "", view)],
  [file(helperPath, helper(1), helper(2))],
  [file(path, root, original), file(helperPath, helper(2), ""), file(viewPath, view, "")],
];
save("snapshots.json", { originals, variants });
const results = [];
for (const [index, deltas] of variants.entries()) {
  const projected = index === 1 ? [file(path, root, root), ...deltas, file(viewPath, view, view)] : deltas;
  const files = projected.map(file => ({ ...file, installedBaseline: originals[file.path] }));
  const classified = classifyPrivateAdditiveEditSet(files, { manifest, baselineForFile: path => originals[path] });
  assert.equal(classified?.route, "hot-reload");
  assert.equal(classified.reasonCode, "SHARED_ADDITIVE");
  const record = { requestId: `crossfile-captured-${Date.now()}-${index}`, snapshotDigest: hash(JSON.stringify(deltas)),
    expiresAt: Date.now() + 60 * 60_000,
    scope: { binaryIdentity: `${manifest.binaryIdentity.executable_uuid}:${manifest.binaryIdentity.debug_dylib_uuid}` }, files };
  const prepared = prepareCompleteQueuedLivePatch(record, { manifestPath, artifactRoot: join(output, "artifacts"), patchRoot: join(output, "patches") });
  assert.equal(prepared.sharedAdditive, true);
  assert.equal(prepared.replacementProof.swift_replacements, 1);
  assert.equal(prepared.refreshStrategy, "preserve-state-v1");
  results.push({ variant: index + 1, classified, prepared }); save("results.json", results);
  console.log(JSON.stringify({ variant: index + 1, compiled: true, replacements: 1, refreshStrategy: prepared.refreshStrategy }));
}
assert.equal(hash(readFileSync(path)), manifest.sourceBaselines[path]);
assert(!existsSync(helperPath) && !existsSync(viewPath));
console.log(JSON.stringify({ complete: true, sourceUnchanged: true, phoneRequests: 0, output }));
