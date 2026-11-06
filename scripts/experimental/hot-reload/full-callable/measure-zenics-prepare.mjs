#!/usr/bin/env node
// Task-only timing of real captured Zenics compilation. No phone/engine requests.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { prepareCompleteQueuedLivePatch, classifyEditSet } from "../../../../dist/mac-helper/src/liveReload.js";
import { NodeCommandRunner } from "../../../../dist/mac-helper/src/infrastructure/nodeCommandRunner.js";

const output = resolve(process.argv[2]);
assert(!existsSync(output), "fresh timing output required");
mkdirSync(output, { recursive: true, mode: 0o700 });
const manifestPath = join(homedir(), ".swift-sim/live/compilations.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const context = manifest.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo");
assert(context);
const hash = value => createHash("sha256").update(value).digest("hex");
const sourceFile = name => {
  const path = context.sources.find(path => basename(path) === name);
  const source = readFileSync(path, "utf8"); assert.equal(hash(source), manifest.sourceBaselines[path]);
  return { path, source };
};
const root = sourceFile("ContentView.swift"), journal = sourceFile("JournalView.swift");
const cases = [
  { name: "journal-body", original: journal, needle: '.navigationTitle("Zenics")', replacement: '.navigationTitle("Zenics · Timing")' },
  { name: "root-body", original: root, needle: 'Tab("Library", systemImage:', replacement: 'Tab("Library · Timing", systemImage:' },
];
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2), { mode: 0o600 });
const baseRunner = new NodeCommandRunner({ spawn, spawnSync });
const results = [];
for (let round = 0; round < 3; round++) for (const fixture of cases) {
  assert.equal(fixture.original.source.split(fixture.needle).length, 2);
  const file = { path: fixture.original.path, beforeSource: fixture.original.source,
    afterSource: fixture.original.source.replace(fixture.needle, fixture.replacement), kind: "swift", status: "modified" };
  const classifyStart = performance.now();
  const classification = classifyEditSet({ files: [file], allowAdditive: true });
  const classificationMs = performance.now() - classifyStart; assert.equal(classification.route, "hot-reload");
  const commands = [];
  const runner = { runSync(request) {
    const start = performance.now(), result = baseRunner.runSync(request);
    const args = request.args || [];
    const command = args.includes("-emit-library") ? "swiftc-library" : args.includes("--version") ? "swiftc-version"
      : args.includes("--find") ? "find-swiftc" : args.includes("--show-sdk-path") ? "sdk-path"
        : args[0] === "--full-callable-generator-v1" ? "syntax-generator" : ["nm", "otool", "swift-demangle"].includes(args[0]) ? args[0] : basename(request.executable);
    commands.push({ command, ms: performance.now() - start, code: result.code }); return result;
  } };
  const record = { requestId: `timing-${randomUUID()}`, snapshotDigest: hash(JSON.stringify(file)),
    expiresAt: Date.now() + 3600_000, scope: { binaryIdentity: `${manifest.binaryIdentity.executable_uuid}:${manifest.binaryIdentity.debug_dylib_uuid}` }, files: [file] };
  const started = performance.now();
  const prepared = prepareCompleteQueuedLivePatch(record, { manifestPath, runner,
    artifactRoot: join(output, "artifacts"), patchRoot: join(output, "patches") });
  const preparationMs = performance.now() - started;
  assert.equal(prepared.replacementProof.swift_replacements, 1); assert.equal(prepared.refreshStrategy, "preserve-state-v1");
  const result = { round, case: fixture.name, classificationMs, preparationMs, commands,
    nonCommandMs: preparationMs - commands.reduce((sum, item) => sum + item.ms, 0), completeCoverage: true,
    refreshStrategy: prepared.refreshStrategy };
  results.push(result); save("results.json", results);
  console.log(JSON.stringify({ round, case: fixture.name, classificationMs: Math.round(classificationMs), preparationMs: Math.round(preparationMs), commands }));
}
for (const source of [root, journal]) assert.equal(readFileSync(source.path, "utf8"), source.source);
save("summary.json", { completed: true, sourceUnchanged: true, phoneRequests: 0, results });
