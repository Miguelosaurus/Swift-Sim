#!/usr/bin/env node
// Compile-only experiment against private captured context. Never contacts engine.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

assert.equal(process.argv[2], "--experimental-full-callable-v1", "explicit experiment gate required");
const output = resolve(process.argv[3] || ".build/hot-reload-frontier/zenics-captured");
const generator = resolve(process.argv[4] || ".build/hot-reload-frontier/full-callable/generate");
mkdirSync(output, { recursive: true, mode: 0o700 });
const capture = JSON.parse(readFileSync(join(homedir(), ".swift-sim/live/compilations.json"), "utf8"));
const names = ["ThumbnailPipeline.swift", "ThumbnailDiskCache.swift", "LibraryView.swift", "DataStore.swift"];
const contexts = names.map(name => capture.compilations.find(item => item.moduleName === "ZenicsCalisthenicsVideo" && item.sources.some(path => basename(path) === name)));
assert(contexts.every(Boolean), "all four captured contexts required");
const reference = contexts[0];
assert(contexts.every(context => context.moduleName === reference.moduleName && context.workingDirectory === reference.workingDirectory && JSON.stringify(context.compilerArguments) === JSON.stringify(reference.compilerArguments)), "one coordinated compiler context required");
const files = names.map((name, index) => {
  const path = contexts[index].sources.find(path => basename(path) === name);
  return { path, before: readFileSync(join("/tmp/zenics-cache-scheduling.EgxxXW", name), "utf8"), after: readFileSync(path, "utf8") };
});
const hashes = files.map(file => createHash("sha256").update(file.after).digest("hex"));
const generate = spawnSync(generator, ["--experimental-full-callable-v1"], { input: JSON.stringify({ module: reference.moduleName, files }), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
writeFileSync(join(output, "generation-stderr.txt"), generate.stderr || "", { mode: 0o600 });
assert.equal(generate.status, 0, generate.stderr);
const report = JSON.parse(generate.stdout);
writeFileSync(join(output, "coverage.json"), JSON.stringify({ ...report, sources: undefined }, null, 2), { mode: 0o600 });
const paths = report.sources.map((source, index) => {
  const path = join(output, `Replacement${index}.swift`);
  writeFileSync(path, source, { mode: 0o600 });
  return path;
});
const dylib = join(output, "experimental-four-file.dylib");
const compile = spawnSync("xcrun", ["swiftc", "-emit-library", ...paths, "-module-name", "SwiftSimExperimentalFourFile",
  ...reference.compilerArguments, "-Xfrontend", "-disable-access-control", "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup", "-o", dylib],
  { cwd: reference.workingDirectory, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120_000 });
writeFileSync(join(output, "compiler.txt"), compile.stderr || compile.stdout || "", { mode: 0o600 });
assert(files.every((file, index) => createHash("sha256").update(readFileSync(file.path)).digest("hex") === hashes[index]), "product source must stay immutable");
const summary = { capability: report.capability, stableEligible: false, changedMemberCount: report.changedMemberCount,
  members: report.members, compilerStatus: compile.status, compilerSignal: compile.signal, artifactExists: existsSync(dylib),
  sourceUnchanged: true, engineContacted: false, applied: false, historicalBaselineAlreadyInstalled: true };
if (compile.status === 0) {
  const symbols = spawnSync("nm", ["-j", dylib], { encoding: "utf8", timeout: 10_000 });
  summary.swiftReplacementDefinitions = new Set((symbols.stdout || "").split(/\r?\n/).filter(symbol => symbol.endsWith("TX"))).size;
  summary.completeSwiftReplacementCoverage = symbols.status === 0 && summary.swiftReplacementDefinitions === report.changedMemberCount;
  summary.admission = "disabled; mixed Swift/Objective-C coverage needs its separate native proof";
}
writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, changedMemberCount: report.changedMemberCount, compilerStatus: compile.status, artifactExists: existsSync(dylib), applied: false }));
if (compile.status !== 0) process.exitCode = 1;
