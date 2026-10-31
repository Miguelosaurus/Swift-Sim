#!/usr/bin/env node
// Explicit experimental entrypoint. No production imports or delivery side effects.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const output = process.env.SWIFT_SIM_EXPERIMENT_OUTPUT || mkdtempSync(join(tmpdir(), "swift-sim-full-callable-"));
mkdirSync(output, { recursive: true, mode: 0o700 });
const attempts = [];
function run(command, args, options = {}, expect = 0) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024, ...options });
  attempts.push({ command, args, status: result.status, error: result.error?.message || "", stdout: result.stdout, stderr: result.stderr });
  writeFileSync(join(output, "attempts.json"), JSON.stringify(attempts, null, 2), { mode: 0o600 });
  if (expect !== null) assert.equal(result.status, expect, result.stderr || result.stdout);
  return result;
}
const toolchain = run("xcrun", ["--find", "swiftc"]).stdout.trim().replace(/\/bin\/swiftc$/, "");
const host = join(toolchain, "lib/swift/host");
const generator = join(output, "generate");
run("xcrun", ["swiftc", join(directory, "Generate.swift"), "-I", host, "-L", host,
  "-Xlinker", "-rpath", "-Xlinker", host, "-o", generator]);
const baseline = readFileSync(join(directory, "Fixture.swift"), "utf8");
writeFileSync(join(output, "Fixture.swift"), baseline, { mode: 0o600 });
const module = "SwiftSimFullCallableFixture";
run("xcrun", ["swiftc", "-emit-library", "-emit-module", "-enable-private-imports", "-module-name", module,
  "-Xfrontend", "-enable-implicit-dynamic", join(output, "Fixture.swift"), "-o", join(output, `lib${module}.dylib`)]);
let represented = 0;
for (const version of [2, 3]) {
  const after = baseline.replaceAll("/*VERSION*/1", `/*VERSION*/${version}`);
  const input = JSON.stringify({ module, files: [{ path: "Fixture.swift", before: baseline, after }] });
  const generated = JSON.parse(run(generator, ["--experimental-full-callable-v1"], { input }).stdout);
  assert.equal(generated.stableEligible, false);
  assert.equal(generated.changedMemberCount, 7);
  represented += generated.changedMemberCount;
  const source = join(output, `Patch${version}.swift`);
  writeFileSync(source, generated.sources.join("\n"), { mode: 0o600 });
  run("xcrun", ["swiftc", "-emit-library", "-module-name", `SwiftSimFullPatch${version}`, source,
    "-I", output, "-L", output, `-l${module}`, "-Xfrontend", "-disable-access-control",
    "-o", join(output, `patch${version}.dylib`)]);
  const symbols = run("nm", ["-j", join(output, `patch${version}.dylib`)]).stdout.split(/\r?\n/);
  assert.equal(new Set(symbols.filter(symbol => symbol.endsWith("TX"))).size, generated.changedMemberCount,
    "every changed declaration needs a native replacement definition before any load");
}
const negatives = [
  ["stored layout", baseline.replace("private var storage = 5", "private var storage = 5; var added = 1")],
  ["signature", baseline.replace("value: Int", "value: Double")],
  ["import", "import Dispatch\n" + baseline],
  ["partial unsupported constructor", baseline.replace("public init() {}", "public init() { storage = 9 }").replaceAll("/*VERSION*/1", "/*VERSION*/2")],
  ["malformed", baseline + "func broken( {"],
  ["nested metadata", baseline.replace("return value +", "struct Local { var state = 1 }; return value +")],
  ["conditional edit", "#if DEBUG\n" + baseline.replaceAll("/*VERSION*/1", "/*VERSION*/2") + "\n#endif"],
];
for (const [name, after] of negatives) {
  const result = run(generator, ["--experimental-full-callable-v1"], {
    input: JSON.stringify({ module, files: [{ path: "Fixture.swift", before: baseline, after }] }),
  }, null);
  assert.notEqual(result.status, 0, `${name} must reject entire bundle`);
}
const gate = run(generator, [], { input: "{}" }, null);
assert.notEqual(gate.status, 0);
const runner = join(output, "runner");
run("xcrun", ["swiftc", "-parse-as-library", join(directory, "Runner.swift"), "-I", output, "-L", output,
  `-l${module}`, "-Xlinker", "-rpath", "-Xlinker", output, "-o", runner]);
const result = run(runner, [join(output, "patch2.dylib"), join(output, "patch3.dylib")]);
writeFileSync(join(output, "summary.json"), JSON.stringify({ capability: "experimental-full-callable-v1",
  stableEligible: false, representedDeclarations: represented, negativeBundles: negatives.length,
  nativeResult: result.stdout.trim(), productionChanged: false }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ output, represented, negativeBundles: negatives.length, result: result.stdout.trim() }));
