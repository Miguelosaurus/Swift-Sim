import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { prepareCompleteQueuedLivePatch, sealCompleteQueuedLivePatch, validateCompleteQueuedLivePatchCoverage } from "../mac-helper/src/liveReload.js";
import { replacementCoverageDigest } from "../mac-helper/src/replacementProof.js";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";

const fixtureFiles = new NodeAtomicFileStore();

const hash = value => createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-complete-artifact-"));
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

test("complete artifacts compile immutable snapshots and bind cached machine-code bytes", t => {
  const f = fixture(t); const raw = f.prepare();
  assert.equal(f.state.generatedInputs[0].files[0].after, f.record.files[0].afterSource);
  assert.equal(f.prepare().path, raw.path); assert.equal(f.state.compileCount, 1);
  const inspected = f.state.inspected;
  writeFileSync(raw.path, "different machine code with identical symbols", { mode: 0o600 });
  assert.throws(f.prepare, { code: "PATCH_ARTIFACT_INVALID" });
  assert.equal(f.state.inspected, inspected, "byte mutation must reject before trusting the same symbol inventory");
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
    { patchDigest: "0".repeat(64) }, { sourceSnapshotDigest: "0".repeat(64) },
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
