import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { classifyEditSet, classifyPrivateAdditiveEditSet } from "../mac-helper/src/liveReload.js";

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
