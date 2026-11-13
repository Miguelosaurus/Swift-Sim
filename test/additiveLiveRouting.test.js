import { testCompiler } from "./testCompiler.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyEditSet as original_classifyEditSet, classifyPrivateAdditiveEditSet as original_classifyPrivateAdditiveEditSet } from "../mac-helper/src/liveReload.js";

const original = 'struct Card { func label() -> String { "old" } }';
const path = "/private/fixture/Card.swift";
const next =
  'struct Card { func label() -> String { helper() } }\nprivate func helper() -> String { "new" }';
const identity = {
  bundle_id: "dev.fixture.app",
  bundle_version: "1",
  build_number: "1",
  executable_uuid: "11111111-1111-1111-1111-111111111111",
  debug_dylib_uuid: "22222222-2222-2222-2222-222222222222",
};
function fixture() {
  const calls = [];
  const manifest = {
    compilerContextProtocol: 2,
    binaryIdentity: identity,
    sourceBaselines: { [path]: createHash("sha256").update(original).digest("hex") },
    compilations: [
      {
        moduleName: "Fixture",
        sources: [path],
        workingDirectory: "/private/fixture",
        compilerArguments: [],
      },
    ],
  };
  const compiler = {
    generate(input) {
      calls.push(input);
      return { additiveProtocol: 1, requiresPrivateScopes: true };
    },
  };
  return { calls, manifest, compiler };
}
const file = { path, kind: "swift", status: "modified", beforeSource: original, afterSource: next };

function sharedFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "swift-sim-shared-routing-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const f = fixture();
  const consumer = join(root, "Card.swift"), existing = join(root, "Installed.swift");
  const installed = "struct ExistingModel { let value: Int }";
  writeFileSync(consumer, original); writeFileSync(existing, installed);
  f.manifest.binding = { projectRoot: root };
  f.manifest.sourceBaselines = {
    [consumer]: createHash("sha256").update(original).digest("hex"),
    [existing]: createHash("sha256").update(installed).digest("hex"),
  };
  Object.assign(f.manifest.compilations[0], { sources: [consumer, existing], workingDirectory: root });
  f.compiler.generate = input => {
    f.calls.push(input);
    return { additiveProtocol: 1, requiresPrivateScopes: true, sharedAdditive: input.allowSharedAdditive === true };
  };
  const consumerFile = { ...file, path: consumer, afterSource: original.replace('"old"', "sharedTitle()") };
  const newFile = { path: join(root, "Shared.swift"), kind: "swift", status: "added", beforeSource: "",
    afterSource: 'func sharedTitle() -> String { "new" }' };
  return { ...f, root, existing, installed, consumerFile, newFile };
}

test("additive classification uses captured installed source and requires full coverage", () => {
  const f = fixture();
  const result = classifyEditSet({ files: [file], allowAdditive: true, additiveOptions: f });
  assert.equal(result.route, "hot-reload");
  assert.equal(result.requiresCompleteCoverage, true);
  assert.equal(f.calls[0].files[0].installedBaseline, original);
  assert.equal(f.calls[0].allowAdditive, true);
  assert.equal(
    classifyEditSet({ files: [file] }).route,
    "rebuild-required",
    "legacy routes remain implementation-only",
  );
});

test("restoration resolves original capture rather than importing a prior patch's helpers", () => {
  const f = fixture();
  const restore = { ...file, beforeSource: next, afterSource: original };
  assert.equal(
    classifyPrivateAdditiveEditSet([restore], { ...f, baselineForFile: () => "wrong original" }),
    null,
  );
  const result = classifyPrivateAdditiveEditSet([restore], {
    ...f,
    baselineForFile: () => original,
  });
  assert.equal(result.route, "hot-reload");
  assert.equal(f.calls[0].files[0].before, next);
  assert.equal(f.calls[0].files[0].after, original);
  assert.equal(f.calls[0].files[0].installedBaseline, original);
});

test("unavailable compiler does not turn an additive intent into a signed build", () => {
  const f = fixture();
  f.compiler.generate = () => {
    throw Object.assign(new Error("tool unavailable"), {
      code: "FULL_CALLABLE_COMPILER_UNAVAILABLE",
    });
  };
  assert.throws(() => classifyEditSet({ files: [file], allowAdditive: true, additiveOptions: f }), {
    code: "FULL_CALLABLE_COMPILER_UNAVAILABLE",
  });
  f.compiler.generate = () => {
    throw Object.assign(new Error("unsupported storage"), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
  };
  assert.equal(
    classifyEditSet({ files: [file], allowAdditive: true, additiveOptions: f }).route,
    "rebuild-required",
  );
});

test("ordinary implementation edits and mixed resources avoid the additive compiler", () => {
  const f = fixture();
  assert.equal(
    classifyEditSet({
      files: [{ ...file, afterSource: original.replace('"old"', '"new"') }],
      allowAdditive: true,
      additiveOptions: f,
    }).route,
    "hot-reload",
  );
  assert.equal(f.calls.length, 0);
  assert.equal(
    classifyEditSet({
      files: [file, { path: "asset.png", kind: "resource" }],
      allowAdditive: true,
      additiveOptions: f,
    }).route,
    "rebuild-required",
  );
  assert.equal(f.calls.length, 0);
});

test("new shared files use an anchored empty baseline and exact original module inventory", t => {
  const f = sharedFixture(t);
  const result = classifyEditSet({ files: [f.consumerFile, f.newFile], allowAdditive: true, additiveOptions: f });
  assert.equal(result.route, "hot-reload");
  assert.equal(result.reasonCode, "SHARED_ADDITIVE");
  assert.equal(result.requiresCompleteCoverage, true);
  assert.equal(f.calls.length, 1, "a new file goes directly to shared admission");
  const input = f.calls[0], added = input.files.find(item => item.path === f.newFile.path);
  assert.equal(input.allowSharedAdditive, true);
  assert.equal(added.isNewFile, true);
  assert.equal(added.installedBaseline, "");
  assert.equal(added.after, f.newFile.afterSource);
  assert.deepEqual(input.moduleSources, [
    { path: f.consumerFile.path, source: original },
    { path: f.existing, source: f.installed },
  ]);
});

test("shared declarations in captured files retry only representation rejection", t => {
  const f = sharedFixture(t);
  f.compiler.generate = input => {
    f.calls.push(input);
    if (!input.allowSharedAdditive) throw Object.assign(new Error("shared function"), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
    return { additiveProtocol: 1, requiresPrivateScopes: true, sharedAdditive: true };
  };
  const edit = { ...f.consumerFile, afterSource: f.consumerFile.afterSource + "\n" + f.newFile.afterSource };
  assert.equal(classifyPrivateAdditiveEditSet([edit], f).reasonCode, "SHARED_ADDITIVE");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].allowSharedAdditive, undefined);
  assert.equal(f.calls[1].allowSharedAdditive, true);
  assert.equal(f.calls[1].moduleSources.find(item => item.path === f.consumerFile.path).source, original);
  f.calls.length = 0;
  f.compiler.generate = input => {
    f.calls.push(input);
    throw Object.assign(new Error("tool unavailable"), { code: "FULL_CALLABLE_COMPILER_UNAVAILABLE" });
  };
  assert.throws(() => classifyPrivateAdditiveEditSet([edit], f), { code: "FULL_CALLABLE_COMPILER_UNAVAILABLE" });
  assert.equal(f.calls.length, 1, "tool failure must not be retried as broader syntax");
});

test("shared admission requires every original source but private and ordinary edits avoid that scan", t => {
  const f = sharedFixture(t);
  rmSync(f.existing);
  assert.throws(() => classifyPrivateAdditiveEditSet([f.consumerFile, f.newFile], f), { code: "FULL_CALLABLE_ORIGINALS_UNAVAILABLE" });
  assert.equal(f.calls.length, 0, "missing collision authority rejects before shared generation");
  const privateEdit = { ...f.consumerFile, afterSource: next };
  assert.equal(classifyPrivateAdditiveEditSet([privateEdit], f).route, "hot-reload");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].moduleSources, undefined);
  f.calls.length = 0;
  assert.equal(classifyEditSet({ files: [{ ...f.consumerFile, afterSource: original.replace('"old"', '"ordinary"') }],
    allowAdditive: true, additiveOptions: f }).route, "hot-reload");
  assert.equal(f.calls.length, 0);
  writeFileSync(f.existing, "struct WrongOriginal {}");
  assert.throws(() => classifyPrivateAdditiveEditSet([f.consumerFile, f.newFile], f), { code: "FULL_CALLABLE_ORIGINALS_UNAVAILABLE" });
});

test("new files cannot escape project scope, borrow a captured basename, or span target modules", t => {
  const f = sharedFixture(t);
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "swift-sim-shared-outside-")));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  symlinkSync(outside, join(f.root, "linked"));
  mkdirSync(join(f.root, "nested"));
  const invalid = [
    { ...f.newFile, path: join(outside, "Outside.swift") },
    { ...f.newFile, path: join(f.root, "linked", "Linked.swift") },
    { ...f.newFile, path: join(f.root, "nested", "Card.swift") },
    { ...f.newFile, path: join(f.root, ".git", "Hidden.swift") },
    { ...f.newFile, beforeSource: "struct UncapturedOriginal {}" },
    { ...f.newFile, status: "renamed" },
  ];
  for (const added of invalid) assert.equal(classifyPrivateAdditiveEditSet([f.consumerFile, added], f), null, added.path);
  assert.equal(classifyPrivateAdditiveEditSet([f.newFile], f), null, "a new-file-only patch has no captured consumer");
  const alias = join(outside, "project-alias");
  symlinkSync(f.root, alias);
  f.manifest.binding.projectRoot = alias;
  assert.equal(classifyPrivateAdditiveEditSet([f.consumerFile, { ...f.newFile, path: join(alias, "Shared.swift") }], f), null,
    "a symlinked project root cannot change canonical source identity");
  f.manifest.binding.projectRoot = f.root;
  f.manifest.compilations.push({ ...f.manifest.compilations[0], moduleName: "OtherTarget", sources: [f.newFile.path] });
  f.manifest.sourceBaselines[f.newFile.path] = createHash("sha256").update("").digest("hex");
  assert.equal(classifyPrivateAdditiveEditSet([f.consumerFile, f.newFile], f), null);
  assert.equal(f.calls.length, 0);
});

test("new-file removal resolves its original empty baseline rather than deleting installed source", t => {
  const f = sharedFixture(t);
  const restore = { ...f.consumerFile, beforeSource: f.consumerFile.afterSource, afterSource: original };
  const remove = { ...f.newFile, status: "removed", beforeSource: f.newFile.afterSource, afterSource: "" };
  const result = classifyPrivateAdditiveEditSet([restore, remove], { ...f,
    baselineForFile: sourcePath => sourcePath === f.newFile.path ? "" : sourcePath === f.consumerFile.path ? original : undefined });
  assert.equal(result.route, "hot-reload");
  assert.equal(f.calls[0].files.find(item => item.path === remove.path).installedBaseline, "");
  assert.equal(f.calls[0].files.find(item => item.path === remove.path).isNewFile, true);
  assert.equal(f.calls[0].files.find(item => item.path === restore.path).installedBaseline, original);
});

test("added State classification negotiates its client support and uses captured body ownership",()=>{
 const f=fixture();f.compiler.generate=input=>{f.calls.push(input);return{additiveProtocol:1,requiresPrivateScopes:true,addedStateProtocol:1};};
 const classified=classifyPrivateAdditiveEditSet([file],f);
 assert.equal(classified.requiresCompleteCoverage,true);assert.equal(classified.requiresAddedState,true);
 assert.equal(f.calls[0].allowAddedState,true);assert.equal(f.calls[0].stateGeneration,1);assert.deepEqual(f.calls[0].statefulBodies,{});
});

test("an unverified installed body capture never falls back to a guessed additive classification",()=>{
 const f=fixture();f.manifest.stateful={version:1,manifestPath:"/missing/state-capture.json"};
 assert.throws(()=>classifyPrivateAdditiveEditSet([file],f),{code:"FULL_CALLABLE_STATEFUL_ABI_INVALID"});
 assert.equal(f.calls.length,0);
});

const classifyEditSet = (options = {}) => original_classifyEditSet({ ...options, compiler: options.compiler || testCompiler });
const classifyPrivateAdditiveEditSet = (files, options = {}) => original_classifyPrivateAdditiveEditSet(files, { ...options, compiler: options.compiler || testCompiler });
