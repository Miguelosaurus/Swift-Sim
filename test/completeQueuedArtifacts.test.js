import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, chmodSync, mkdirSync, realpathSync, writeFileSync, rmSync, symlinkSync, linkSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { prepareCompleteQueuedLivePatch, sealCompleteQueuedLivePatch, validateCompleteQueuedLivePatchCoverage, cleanupQueuedLiveArtifacts } from "../mac-helper/src/liveReload.js";
import { replacementCoverageDigest } from "../mac-helper/src/replacementProof.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";

const fixtureFiles = new NodeAtomicFileStore();

const hash = value => createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "swift-sim-complete-artifact-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifacts"), patchRoot = join(root, "patches"), manifestPath = join(root, "manifest.json");
  mkdirSync(artifactRoot, { mode: 0o700 }); mkdirSync(patchRoot, { mode: 0o700 });
  const source = join(root, "Fixture.swift");
  const identity = { bundle_id: "com.example.fixture", bundle_version: "1", build_number: "1",
    executable_uuid: "11111111-1111-1111-1111-111111111111", debug_dylib_uuid: "22222222-2222-2222-2222-222222222222" };
  const record = { requestId: "fixture-request", snapshotDigest: "a".repeat(64), expiresAt: Date.now() + 60_000,
    scope: { binaryIdentity: `${identity.executable_uuid}:${identity.debug_dylib_uuid}` },
    files: [{ path: source, beforeSource: "struct Probe { func value() -> Int { 1 } }", afterSource: "struct Probe { func value() -> Int { 2 } }" }] };
  writeFileSync(source, "unrelated current editor bytes");
  writeFileSync(manifestPath, JSON.stringify({ binaryIdentity: identity, compilations: [{ moduleName: "Fixture", sources: [source], workingDirectory: root, compilerArguments: [] }] }), { mode: 0o600 });
  const replacementProof = { version: 3, swift_replacements: 1, objc_callbacks: [] };
  const state = { compileCount: 0, inspected: 0, generatedInputs: [] };
  const compiler = {
    generate(input) { state.generatedInputs.push(input); return { sources: [input.files[0].after] }; },
    inspectCoverage({ dylibPath }) { state.inspected++; return { replacementProof, coverageDigest: replacementCoverageDigest(replacementProof), artifactDigest: hash(fixtureFiles.readTextSync(dylibPath)) }; },
  };
  const runner = { runSync(request) { state.compileCount++; writeFileSync(request.args[request.args.indexOf("-o") + 1], "unsigned image", { mode: 0o600 }); return { code: 0, stdout: "", stderr: "" }; } };
  const options = { artifactRoot, patchRoot, manifestPath, compiler, runner };
  const prepare = () => prepareCompleteQueuedLivePatch(record, options);
  const seal = raw => {
    writeFileSync(raw.path, "signed image", { mode: 0o600 });
    const signedDigest = hash(fixtureFiles.readTextSync(raw.path)); sealCompleteQueuedLivePatch(record, raw, signedDigest);
    record.preparedPatch = { ...raw, patchDigest: signedDigest, sourceSnapshotDigest: record.snapshotDigest };
    return signedDigest;
  };
  return { root, record, state, prepare, seal, options };
}

function sharedFixture(t) {
  const f = fixture(t), consumer = f.record.files[0];
  consumer.installedBaseline = consumer.beforeSource;
  consumer.afterSource = consumer.afterSource.replace("{ 2 }", "{ sharedValue() }");
  const added = { path: join(f.root, "Shared.swift"), beforeSource: "", afterSource: "func sharedValue() -> Int { 2 }", installedBaseline: "" };
  f.record.files.push(added);
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.options.manifestPath));
  manifest.compilerContextProtocol = 2;
  manifest.binding = { projectRoot: f.root };
  manifest.sourceBaselines = { [consumer.path]: hash(consumer.installedBaseline) };
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  f.options.compiler.generate = input => {
    f.state.generatedInputs.push(input);
    return { sources: input.files.map(file => file.after), additiveProtocol: 1, sharedAdditive: true, requiresPrivateScopes: true };
  };
  return { ...f, consumer, added, manifest };
}

test("complete artifacts compile immutable snapshots and bind cached machine-code bytes", t => {
  const f = fixture(t); const raw = f.prepare();
  assert.equal(f.state.generatedInputs[0].files[0].after, f.record.files[0].afterSource);
  assert.equal(f.prepare().path, raw.path); assert.equal(f.state.compileCount, 1);
  const inspected = f.state.inspected;
  writeFileSync(raw.path, "different machine code with identical symbols", { mode: 0o600 });
  assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" });
  assert.equal(f.state.inspected, inspected, "byte mutation must reject before trusting the same symbol inventory");
});

test("additive compilation requires the exact captured baseline and preserves private source scopes", t => {
  const f = fixture(t);
  const file = f.record.files[0];
  file.installedBaseline = file.beforeSource;
  file.afterSource += "\nprivate func helper() -> Int { 3 }";
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.options.manifestPath));
  manifest.sourceBaselines = { [file.path]: hash(file.installedBaseline) };
  manifest.compilerContextProtocol = 2;
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  f.options.compiler.generate = input => {
    f.state.generatedInputs.push(input);
    return { sources: ["generated"], additiveProtocol: 1, requiresPrivateScopes: true };
  };
  let command;
  f.options.runner.runSync = request => {
    command = request;
    writeFileSync(request.args[request.args.indexOf("-o") + 1], "unsigned image", { mode: 0o600 });
    return { code: 0, stdout: "", stderr: "" };
  };
  const raw = f.prepare();
  assert.equal(raw.additiveProtocol, 1);
  assert.equal(f.state.generatedInputs[0].allowAdditive, true);
  assert.equal(f.state.generatedInputs[0].files[0].installedBaseline, file.beforeSource);
  assert(!command.args.includes("-disable-access-control"));
  f.seal(raw);
  assert.doesNotThrow(() => validateCompleteQueuedLivePatchCoverage(f.record));
  f.record.preparedPatch.additiveProtocol = 0;
  assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record));
  file.installedBaseline = "forged source";
  assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" });
});

test("constant-only patches stay valid through signing and application checks", t => {
  const f = fixture(t);
  const file = f.record.files[0];
  file.beforeSource = "enum Theme { static let accent: Int = 1 }\n";
  file.afterSource = "enum Theme { static let accent: Int = 2 }\n";
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.options.manifestPath));
  manifest.sourceBaselines = { [file.path]: hash(file.beforeSource) };
  manifest.compilerContextProtocol = 2;
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  f.options.compiler.generate = () => ({ sources: ["generated"], constantProtocol: 1 });
  const raw = f.prepare();
  assert.equal(raw.constantProtocol, 1);
  f.seal(raw);
  // The structural classifier alone rejects a changed static let; the
  // application-time check must accept the generator's constant proof.
  assert.doesNotThrow(() => validateCompleteQueuedLivePatchCoverage(f.record));
  delete f.record.preparedPatch.constantProtocol;
  assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record), { code: "QUEUED_EDIT_NOT_COMPATIBLE" });
});

test("signing explicitly seals the unsigned-to-signed transition before reuse or apply", t => {
  const f = fixture(t); const raw = f.prepare(); const signed = f.seal(raw);
  const marker = JSON.parse(fixtureFiles.readTextSync(raw.path + ".json"));
  assert.equal(marker.unsignedArtifactDigest, raw.artifactDigest); assert.equal(marker.artifactDigest, signed);
  assert.equal(f.prepare().artifactDigest, signed); assert.equal(f.state.compileCount, 1);
  assert.doesNotThrow(() => validateCompleteQueuedLivePatchCoverage(f.record));
  assert.throws(() => sealCompleteQueuedLivePatch(f.record, raw, "0".repeat(64)), { code: "PATCH_ARTIFACT_INVALID" });
});

test("corrupt expected proof, compiler resource, source digest and signed bytes fail validation", t => {
  const f = fixture(t); const raw = f.prepare(); f.seal(raw);
  const original = structuredClone(f.record.preparedPatch);
  for (const change of [{ compilerResourceDigest: "0".repeat(64) }, { coverageDigest: "0".repeat(64) },
    { patchDigest: "0".repeat(64) }, { sourceSnapshotDigest: "0".repeat(64) }, { refreshStrategy: "preserve-state-v1" },
    { replacementProof: { version: 3, swift_replacements: 2, objc_callbacks: [] } }]) {
    f.record.preparedPatch = { ...original, ...change };
    assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record));
  }
  f.record.preparedPatch = original;
  writeFileSync(raw.path, "mutated after signing", { mode: 0o600 });
  assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record), { code: "PATCH_ARTIFACT_INVALID" });
});

test("marker and generated-source links cannot overwrite a foreign file", t => {
  for (const kind of ["symlink", "hardlink"]) for (const target of ["marker", "source"]) {
    const f = fixture(t); const raw = f.prepare();
    const marker = JSON.parse(fixtureFiles.readTextSync(raw.path + ".json"));
    const foreign = join(f.root, "foreign"); writeFileSync(foreign, "keep foreign bytes", { mode: 0o600 });
    const path = target === "marker" ? raw.path + ".json" : join(f.options.patchRoot, `queued_${marker.key}`, "Replacement0.swift");
    rmSync(path); (kind === "symlink" ? symlinkSync : linkSync)(foreign, path);
    if (target === "source") rmSync(raw.path);
    assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" }, `${kind} ${target}`);
    assert.equal(fixtureFiles.readTextSync(foreign, "utf8"), "keep foreign bytes");
  }
});

test("artifact validation remains bound to request, snapshot and binary scope", t => {
  const f = fixture(t); const raw = f.prepare(); f.seal(raw);
  for (const change of [{ requestId: "different-request" }, { snapshotDigest: "b".repeat(64) },
    { scope: { binaryIdentity: "different-binary" } }]) {
    assert.throws(() => validateCompleteQueuedLivePatchCoverage({ ...f.record, ...change }), { code: "PATCH_ARTIFACT_INVALID" });
  }
  const wrongBinary = { ...f.record, scope: { binaryIdentity: "different-binary" } };
  assert.throws(() => prepareCompleteQueuedLivePatch(wrongBinary, f.options), { code: "PATCH_ARTIFACT_INVALID" });
  assert.match(basename(raw.path), /^eval_injection_swift_sim_dynamic_[a-f0-9]{64}\.dylib$/);
});

test("shared artifacts retain new-file and original-module authority through signing and validation", t => {
  const f = sharedFixture(t), run = f.options.runner.runSync;
  let command;
  f.options.runner.runSync = request => { command = request; return run(request); };
  const raw = f.prepare();
  assert.equal(raw.sharedAdditive, true);
  const input = f.state.generatedInputs[0];
  assert.equal(input.allowSharedAdditive, true);
  assert.deepEqual(input.moduleSources, [{ path: f.consumer.path, source: f.consumer.installedBaseline }]);
  assert.equal(input.files.find(file => file.path === f.added.path).isNewFile, true);
  assert.equal(input.files.find(file => file.path === f.added.path).installedBaseline, "");
  assert(!command.args.includes("-disable-access-control"), "shared files retain compiler-enforced private access boundaries");
  assert.equal(JSON.parse(fixtureFiles.readTextSync(raw.path + ".json")).sharedAdditive, true);
  f.seal(raw);
  assert.doesNotThrow(() => validateCompleteQueuedLivePatchCoverage(f.record));
  f.record.preparedPatch.sharedAdditive = false;
  assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record), { code: "PATCH_ARTIFACT_INVALID" });
  f.record.preparedPatch.sharedAdditive = true;
  const marker = JSON.parse(fixtureFiles.readTextSync(raw.path + ".json"));
  marker.sharedAdditive = false;
  writeFileSync(raw.path + ".json", JSON.stringify(marker), { mode: 0o600 });
  assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record), { code: "PATCH_ARTIFACT_INVALID" });
  assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" });
});

test("implicit consumer snapshots bind artifact identity even when accepted delta identity is unchanged", t => {
  const f = sharedFixture(t), accepted = { requestId: f.record.requestId, digest: f.record.snapshotDigest };
  const first = f.prepare();
  f.consumer.afterSource = f.consumer.afterSource.replace("sharedValue()", "sharedValue() + 10");
  const second = f.prepare();
  assert.equal(f.record.requestId, accepted.requestId);
  assert.equal(f.record.snapshotDigest, accepted.digest);
  assert.notEqual(first.compilerContextDigest, second.compilerContextDigest);
  assert.notEqual(first.path, second.path);
  assert.equal(f.state.compileCount, 2, "the old dylib cannot be reused for different implicit consumers");
  assert.equal(f.state.generatedInputs[1].files.find(file => file.path === f.consumer.path).after, f.consumer.afterSource);
});

test("shared preparation rejects a missing or drifted original before compiling any code", t => {
  const f = sharedFixture(t), missing = join(f.root, "Unchanged.swift"), source = "struct Unchanged {}";
  f.manifest.compilations[0].sources.push(missing);
  f.manifest.sourceBaselines[missing] = hash(source);
  writeFileSync(f.options.manifestPath, JSON.stringify(f.manifest), { mode: 0o600 });
  assert.throws(f.prepare, { code: "FULL_CALLABLE_ORIGINALS_UNAVAILABLE" });
  assert.equal(f.state.generatedInputs.length, 0);
  assert.equal(f.state.compileCount, 0);
  writeFileSync(missing, "struct WrongOriginal {}");
  assert.throws(f.prepare, { code: "FULL_CALLABLE_ORIGINALS_UNAVAILABLE" });
  assert.equal(f.state.compileCount, 0);
  writeFileSync(missing, source);
  assert.equal(f.prepare().sharedAdditive, true);
  assert.equal(f.state.compileCount, 1);
});

test("private additive preparation does not read unrelated module sources", t => {
  const f = fixture(t), consumer = f.record.files[0];
  consumer.installedBaseline = consumer.beforeSource;
  consumer.afterSource += "\nprivate func localHelper() -> Int { 3 }";
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.options.manifestPath));
  manifest.compilerContextProtocol = 2;
  manifest.sourceBaselines = { [consumer.path]: hash(consumer.installedBaseline) };
  manifest.compilations[0].sources.push(join(f.root, "Unavailable.swift"));
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  f.options.compiler.generate = input => {
    f.state.generatedInputs.push(input);
    return { sources: ["private additive"], additiveProtocol: 1, requiresPrivateScopes: true };
  };
  assert.equal(f.prepare().additiveProtocol, 1);
  assert.equal(f.state.generatedInputs.length, 1);
  assert.equal(f.state.generatedInputs[0].allowSharedAdditive, undefined);
  assert.equal(f.state.generatedInputs[0].moduleSources, undefined);
});

function statefulFixture(t) {
  const f = fixture(t), file = f.record.files[0];
  f.record.scope.sessionIdentity = "current-phone-process";
  file.installedBaseline = file.beforeSource;
  file.afterSource += "\nprivate struct Card: View { @State private var count = 0; var body: some View { Text(String(count)) } }";
  const manifest = JSON.parse(fixtureFiles.readTextSync(f.options.manifestPath));
  Object.assign(manifest, { compilerContextProtocol: 2, sourceBaselines: { [file.path]: hash(file.installedBaseline) } });
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const statefulOutput = { additiveProtocol: 1, requiresPrivateScopes: true, statefulComponentProtocol: 1,
    statefulComponents: [{ path: file.path, owner: "Card", layoutDigest: "b".repeat(64), sourceFileIndex: 0,
      slots: [{ member: "body", kind: "property", accessors: ["getter"], isStatic: false }] }], statefulOriginUses: [] };
  f.options.compiler.generate = input => { f.state.generatedInputs.push(input); return { sources: ["generated"], ...statefulOutput }; };
  const run = f.options.runner.runSync;
  f.state.commands = [];
  f.options.runner.runSync = request => {
    f.state.commands.push(request);
    const index = request.args.indexOf("-emit-module-path");
    if (index >= 0) writeFileSync(request.args[index + 1], "private serialized module", { mode: 0o644 });
    return run(request);
  };
  const seal = raw => {
    writeFileSync(raw.path, "signed image", { mode: 0o600 });
    const signedDigest = hash(fixtureFiles.readTextSync(raw.path));
    const stateMetadata = sealCompleteQueuedLivePatch(f.record, raw, signedDigest);
    f.record.preparedPatch = { ...raw, ...stateMetadata, patchDigest: signedDigest, sourceSnapshotDigest: f.record.snapshotDigest };
    return f.record.preparedPatch;
  };
  const validate = () => validateCompleteQueuedLivePatchCoverage(f.record, f.options);
  return { ...f, statefulOutput, seal, validate };
}

test("stateful origins publish private modules, seal signed bytes, and reuse only the same live process", t => {
  const f = statefulFixture(t), raw = f.prepare();
  assert.equal(raw.statefulComponentProtocol, 1);
  assert.equal(raw.statefulOrigins.length, 1);
  const origin = raw.statefulOrigins[0];
  assert.equal(origin.sourceFile, "Replacement0.swift");
  assert.equal(origin.processIdentity, f.record.scope.sessionIdentity);
  assert.equal(statSync(origin.modulePath).mode & 0o777, 0o600);
  assert(f.state.commands[0].args.includes("-enable-private-imports"));
  const signed = f.seal(raw);
  assert.notEqual(signed.statefulOrigins[0].artifactDigest, origin.artifactDigest);
  assert.doesNotThrow(f.validate);
  assert.equal(f.prepare().statefulOrigins[0].artifactDigest, signed.patchDigest);
  assert.equal(f.state.compileCount, 1);
  const originalProcess = f.record.scope.sessionIdentity;
  f.record.scope.sessionIdentity = "restarted-process";
  assert.throws(f.validate);
  f.record.scope.sessionIdentity = originalProcess;
  writeFileSync(origin.modulePath, "tampered module", { mode: 0o600 });
  assert.throws(f.validate);
  assert.throws(f.prepare);
});

test("subsequent stateful generations import pinned modules without re-emitting them", t => {
  const f = statefulFixture(t), first = f.seal(f.prepare()), origin = first.statefulOrigins[0];
  f.record.requestId = "follow-up-request";
  f.record.snapshotDigest = "c".repeat(64);
  f.record.statefulOrigins = first.statefulOrigins;
  f.record.files[0].beforeSource = f.record.files[0].afterSource;
  f.record.files[0].afterSource = f.record.files[0].afterSource.replace("Text(String(count))", "Text(\"Count: \\(count)\")");
  f.statefulOutput.statefulComponents = [];
  f.statefulOutput.statefulOriginUses = [Object.fromEntries(["path", "owner", "module", "sourceFile", "layoutDigest"].map(key => [key, origin[key]]))];
  const raw = f.prepare();
  assert.deepEqual(raw.statefulOrigins, first.statefulOrigins);
  assert(!f.state.commands[1].args.includes("-emit-module-path"));
  assert(f.state.commands[1].args.includes("-I"));
  assert(f.state.commands[1].args.includes(origin.modulePath.slice(0, origin.modulePath.lastIndexOf("/"))));
  assert.deepEqual(f.state.generatedInputs.at(-1).statefulOrigins, f.statefulOutput.statefulOriginUses);
  f.seal(raw); assert.doesNotThrow(f.validate);
  const count = f.state.compileCount;
  f.record.scope.sessionIdentity = "other-process";
  assert.throws(f.prepare, { code: "LIVE_STATEFUL_ORIGIN_INVALID" });
  assert.equal(f.state.compileCount, count);
});

test("origin metadata cannot drift through signing or admission, and cleanup retains referenced modules", t => {
  const f = statefulFixture(t), raw = f.prepare();
  const metadata = structuredClone(raw.statefulOrigins);
  raw.statefulOrigins[0].layoutDigest = "e".repeat(64);
  assert.throws(() => f.seal(raw), { code: "PATCH_ARTIFACT_INVALID" });
  raw.statefulOrigins = metadata;
  const prepared = f.seal(raw), origin = prepared.statefulOrigins[0];
  const marker = JSON.parse(fixtureFiles.readTextSync(raw.path + ".json"));
  marker.expiresAt = 1;
  writeFileSync(raw.path + ".json", JSON.stringify(marker), { mode: 0o600 });
  cleanupQueuedLiveArtifacts([], { ...f.options, statefulOrigins: prepared.statefulOrigins, now: Date.now() });
  assert(existsSync(origin.artifactPath)); assert(existsSync(origin.modulePath));
  cleanupQueuedLiveArtifacts([], { ...f.options, statefulOrigins: [], now: Date.now() });
  assert(!existsSync(origin.artifactPath)); assert(!existsSync(origin.modulePath));
});

test("serialized module outputs cannot follow existing hardlinks, symlinks, or dangling symlinks", t => {
  for (const kind of ["hardlink", "symlink", "dangling"]) for (const suffix of [".swiftmodule", ".swiftdoc", ".swiftsourceinfo"]) {
    const f = statefulFixture(t), raw = f.prepare(), origin = raw.statefulOrigins[0];
    const path = origin.modulePath.replace(/\.swiftmodule$/, suffix), foreign = join(f.root, "foreign-module");
    if (kind !== "dangling") writeFileSync(foreign, "preserve foreign module", { mode: 0o600 });
    rmSync(path, { force: true }); (kind === "hardlink" ? linkSync : symlinkSync)(foreign, path);
    rmSync(raw.path);
    const before = f.state.compileCount;
    assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" }, kind + suffix);
    assert.equal(f.state.compileCount, before, "compiler must not run through a foreign module output");
    assert.equal(existsSync(foreign), kind !== "dangling");
    if (kind !== "dangling") assert.equal(fixtureFiles.readTextSync(foreign), "preserve foreign module");
  }
});


test("first stateful publication privately migrates a safe legacy patch container before admission", t => {
  const f = statefulFixture(t);
  mkdirSync(f.options.patchRoot, {recursive:true,mode:0o755});chmodSync(f.options.patchRoot,0o755);
  const prepared=f.seal(f.prepare());
  assert.doesNotThrow(f.validate);
  assert.equal(statSync(f.options.patchRoot).mode & 0o777,0o700);
  assert.equal(prepared.statefulOrigins.length,1);
});

test("stateful publication refuses a writable patch container before compiling or chmod", t => {
  const f=statefulFixture(t);
  mkdirSync(f.options.patchRoot,{recursive:true,mode:0o700});chmodSync(f.options.patchRoot,0o777);
  assert.throws(f.prepare,{code:"PATCH_ARTIFACT_INVALID"});
  assert.equal(f.state.compileCount,0);
  assert.equal(statSync(f.options.patchRoot).mode & 0o777,0o777);
});

function addedStateArtifactFixture(t) {
  const f = fixture(t), file = f.record.files[0];
  f.record.sequence = 7; f.record.scope.sessionIdentity = "added-state-phone-process";
  file.installedBaseline = file.beforeSource;
  file.afterSource += "\nprivate struct Placeholder { @State private var added = 0 }";
  const manifest = fixtureFiles.readJSONSync(f.options.manifestPath);
  Object.assign(manifest, { compilerContextProtocol: 2, sourceBaselines: { [file.path]: hash(file.installedBaseline) } });
  writeFileSync(f.options.manifestPath, JSON.stringify(manifest), { mode: 0o600 });
  const output = { sources: ["generated"], additiveProtocol: 1, requiresPrivateScopes: true,
    addedStateProtocol: 1, addedStateGeneration: f.record.sequence };
  f.options.compiler.generate = input => { f.state.generatedInputs.push(input); return output; };
  return { ...f, output, validate: () => validateCompleteQueuedLivePatchCoverage(f.record, f.options) };
}

test("added-state artifacts bind the immutable sequence and process without component modules", t => {
  const f = addedStateArtifactFixture(t), raw = f.prepare();
  assert.equal(raw.addedStateProtocol, 1); assert.equal(raw.addedStateGeneration, 7);
  assert.equal(raw.statefulComponentProtocol, undefined); assert.equal(raw.statefulOrigins, undefined);
  assert.equal(f.state.generatedInputs[0].allowAddedState, true);
  assert.equal(f.state.generatedInputs[0].stateGeneration, 7);
  assert.equal(f.prepare().path, raw.path); assert.equal(f.state.compileCount, 1);
  const marker = fixtureFiles.readJSONSync(raw.path + ".json");
  assert.equal(marker.addedStateProtocol, 1); assert.equal(marker.addedStateGeneration, 7);
  assert.equal(marker.processIdentity, f.record.scope.sessionIdentity);
  f.seal(raw); assert.doesNotThrow(f.validate);
  assert.equal(f.prepare().addedStateGeneration, 7);
  assert.equal(f.state.compileCount, 1);
});

test("an added-state compiler generation cannot drift from queue ownership before compilation", t => {
  for (const sequence of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 8]) {
    const f = addedStateArtifactFixture(t);
    f.record.sequence = sequence;
    assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" });
    assert.equal(f.state.compileCount, 0);
  }
});

test("added-state marker and prepared sequence/protocol/process tampering rejects signing and admission", t => {
  const changes = [
    { target: "marker", patch: { addedStateProtocol: 0 } },
    { target: "marker", patch: { addedStateGeneration: 8 } },
    { target: "marker", patch: { processIdentity: "another-process" } },
    { target: "prepared", patch: { addedStateProtocol: 0 } },
    { target: "prepared", patch: { addedStateGeneration: 8 } },
  ];
  for (const change of changes) {
    const beforeSign = addedStateArtifactFixture(t), raw = beforeSign.prepare();
    if (change.target === "marker") {
      const path = raw.path + ".json", marker = fixtureFiles.readJSONSync(path);
      writeFileSync(path, JSON.stringify({ ...marker, ...change.patch }), { mode: 0o600 });
    } else Object.assign(raw, change.patch);
    assert.throws(() => beforeSign.seal(raw), { code: "PATCH_ARTIFACT_INVALID" });

    const beforeApply = addedStateArtifactFixture(t), preparedRaw = beforeApply.prepare(); beforeApply.seal(preparedRaw);
    if (change.target === "marker") {
      const path = preparedRaw.path + ".json", marker = fixtureFiles.readJSONSync(path);
      writeFileSync(path, JSON.stringify({ ...marker, ...change.patch }), { mode: 0o600 });
    } else Object.assign(beforeApply.record.preparedPatch, change.patch);
    assert.throws(beforeApply.validate, { code: "PATCH_ARTIFACT_INVALID" });
  }
  for (const mutate of [record => { record.sequence++; }, record => { record.scope.sessionIdentity = "new-process"; }]) {
    const f = addedStateArtifactFixture(t), raw = f.prepare(); f.seal(raw); mutate(f.record);
    assert.throws(f.validate, { code: "PATCH_ARTIFACT_INVALID" });
  }
});

test("ordinary artifacts cannot acquire detached added-state generation metadata", t => {
  for (const target of ["marker", "prepared"]) {
    const f = fixture(t), raw = f.prepare(); f.seal(raw);
    if (target === "marker") {
      const path = raw.path + ".json", marker = fixtureFiles.readJSONSync(path);
      writeFileSync(path, JSON.stringify({ ...marker, addedStateGeneration: 7 }), { mode: 0o600 });
    } else f.record.preparedPatch.addedStateGeneration = 7;
    assert.throws(() => validateCompleteQueuedLivePatchCoverage(f.record), { code: "PATCH_ARTIFACT_INVALID" });
  }
});
