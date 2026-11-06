import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  STATEFUL_COMPONENT_PROTOCOL, compilationStatefulOrigins, normalizeStatefulOrigins,
  retainedStatefulOriginRequests, statefulOriginsDigest, verifyStatefulOrigins,
} from "../mac-helper/src/liveStatefulOrigins.js";

const fixtureFiles = new NodeAtomicFileStore();
const scope = { project: "/Fixture/Fixture.xcodeproj", scheme: "Fixture", appIdentity: "com.example.Fixture", binaryIdentity: "binary-one", sessionIdentity: "process-one" };
const hash = value => createHash("sha256").update(value).digest("hex");
const invalid = fn => assert.throws(fn, { code: "LIVE_STATEFUL_ORIGIN_INVALID" });
function origin(overrides = {}) {
  const key = "a".repeat(64), module = `SwiftSimLivePatch_${key}`;
  return { path: "/Fixture/Screen.swift", owner: "CounterCard", module, sourceFile: "Replacement0.swift", layoutDigest: hash("state-layout"),
    modulePath: `/private/patches/queued_${key}/${module}.swiftmodule`, moduleDigest: hash("module"),
    artifactPath: `/private/artifacts/eval_injection_swift_sim_dynamic_${key}.dylib`, artifactDigest: hash("signed-image"),
    requestId: "first-component-request", processIdentity: scope.sessionIdentity, binaryIdentity: scope.binaryIdentity, resourceDigest: hash("generator"), ...overrides };
}
function record(sequence, origins, overrides = {}) {
  return { sequence, scope: { ...scope }, state: "prepared", expiresAt: 2000,
    preparedPatch: { statefulComponentProtocol: STATEFUL_COMPONENT_PROTOCOL, statefulOrigins: origins }, ...overrides };
}
function desired(sequence, origins, overrides = {}) {
  return { scope: { ...scope }, confirmedThroughSequence: sequence, statefulOrigins: origins, ...overrides };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-state-origin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactRoot = join(root, "artifacts"), patchRoot = join(root, "patches");
  mkdirSync(artifactRoot, { mode: 0o700 }); mkdirSync(patchRoot, { mode: 0o700 });
  const key = "a".repeat(64), module = `SwiftSimLivePatch_${key}`;
  const current = origin({ artifactPath: join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`),
    modulePath: join(patchRoot, `queued_${key}`, `${module}.swiftmodule`) });
  mkdirSync(dirname(current.modulePath), { mode: 0o700 });
  writeFileSync(current.modulePath, "module", { mode: 0o600 });
  writeFileSync(current.artifactPath, "signed-image", { mode: 0o600 });
  const markerPath = current.artifactPath + ".json";
  const marker = { key, requestId: current.requestId, artifactDigest: current.artifactDigest,
    binaryIdentity: current.binaryIdentity, processIdentity: current.processIdentity,
    statefulComponentProtocol: STATEFUL_COMPONENT_PROTOCOL, resourceDigest: current.resourceDigest };
  const writeMarker = value => writeFileSync(markerPath, JSON.stringify(value), { mode: 0o600 });
  writeMarker(marker);
  return { root, current, marker, markerPath, writeMarker,
    options: { scope, artifactRoot, patchRoot, resourceDigest: current.resourceDigest } };
}

test("normalization produces bounded source-free canonical metadata and stable digests", () => {
  const first = origin(), second = origin({ path: "/Fixture/A.swift", owner: "Other", sourceFile: "Replacement31.swift" });
  invalid(() => normalizeStatefulOrigins([{ ...first, userState: { draft: "never persist" } }, second], scope));
  const normalized = normalizeStatefulOrigins([first, second], scope);
  assert.deepEqual(normalized, [second, first]);
  assert.equal(Object.hasOwn(normalized[1], "userState"), false);
  assert.notEqual(normalized[1], first);
  assert.equal(statefulOriginsDigest([first, second]), statefulOriginsDigest([second, first]));
  invalid(() => statefulOriginsDigest([second, { ...first, ignored: "extra" }]));
  invalid(() => normalizeStatefulOrigins([{ ...first, source: "hidden source" }]));
  assert.notEqual(statefulOriginsDigest([first]), statefulOriginsDigest([{ ...first, moduleDigest: hash("different") }]));
  assert.deepEqual(normalizeStatefulOrigins([]), []);
  assert.equal(normalizeStatefulOrigins(Array.from({ length: 32 }, (_, i) => origin({ owner: `Card${i}` }))).length, 32);
});

test("normalization rejects malformed, oversized, duplicate, unscoped and ambiguous origin descriptors", () => {
  for (const value of [undefined, null, {}, "[]", [null], [{}], Array(33).fill(origin()), [origin(), origin()]]) {
    invalid(() => normalizeStatefulOrigins(value));
  }
  const circular = []; circular.push(circular);
  invalid(() => normalizeStatefulOrigins(circular));
  invalid(() => normalizeStatefulOrigins(Array.from({ length: 24 }, (_, i) => origin({ owner: `Card${i}`, path: "/" + "p".repeat(3000) }))));
  for (const field of Object.keys(origin())) {
    for (const value of [null, 1, "", "bad\nvalue", "x".repeat(4097)]) invalid(() => normalizeStatefulOrigins([origin({ [field]: value })]));
  }
  for (const field of ["layoutDigest", "moduleDigest", "artifactDigest", "resourceDigest"]) {
    for (const value of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) invalid(() => normalizeStatefulOrigins([origin({ [field]: value })]));
  }
  for (const field of ["owner", "module"]) {
    for (const value of ["Outer.Card", "7Card", "Card<Type>", "Card-name"]) invalid(() => normalizeStatefulOrigins([origin({ [field]: value })]));
  }
  for (const value of ["Replacement32.swift", "Replacement00.swift", "Counter.swift", "../Replacement0.swift"]) {
    invalid(() => normalizeStatefulOrigins([origin({ sourceFile: value })]));
  }
  for (const field of ["path", "modulePath", "artifactPath"]) invalid(() => normalizeStatefulOrigins([origin({ [field]: "relative/file" })]));
  invalid(() => normalizeStatefulOrigins([origin({ modulePath: "/private/Wrong.swiftmodule" })]));
  invalid(() => normalizeStatefulOrigins([origin()], { ...scope, sessionIdentity: "fresh-process" }));
  invalid(() => normalizeStatefulOrigins([origin()], { ...scope, binaryIdentity: "other-binary" }));
});

test("compilation pins only the latest earlier origin generation in the exact verified process scope", () => {
  const confirmed = origin({ requestId: "confirmed" }), newer = origin({ requestId: "newer" }), latest = origin({ requestId: "latest" });
  const current = record(10, []);
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [], records: [] }, current, 1000), []);
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(2, [confirmed])], records: [] }, current, 1000), [confirmed]);
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(2, [confirmed])], records: [record(7, [latest]), record(4, [newer])] }, current, 1000), [latest]);
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(2, [confirmed])], records: [record(7, []), record(4, [newer])] }, current, 1000), []);
  for (const field of Object.keys(scope)) {
    const otherScope = { ...scope, [field]: "other" };
    assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(2, [confirmed], { scope: otherScope })],
      records: [record(7, [latest], { scope: otherScope })] }, current, 1000), [], field);
  }
});

test("expired, failed, future, revoked and unqualified origins cannot supply compilation authority", () => {
  const confirmed = origin({ requestId: "confirmed" }), rejected = origin({ requestId: "rejected" });
  const current = record(10, []), initial = desired(3, [confirmed]);
  for (const previous of [record(3, [rejected]), record(10, [rejected]), record(11, [rejected]),
    record(7, [rejected], { expiresAt: 1000 }), ...["failed", "expired", "superseded"].map(state => record(7, [rejected], { state })),
    record(7, [rejected], { preparedPatch: { statefulOrigins: [rejected] } }),
    record(7, [rejected], { preparedPatch: { statefulComponentProtocol: 2, statefulOrigins: [rejected] } })]) {
    assert.deepEqual(compilationStatefulOrigins({ desiredStates: [initial], records: [previous] }, current, 1000), [confirmed]);
  }
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(3, [confirmed], { revoked: true })], records: [record(2, [rejected])] }, current, 1000), []);
  assert.deepEqual(compilationStatefulOrigins({ desiredStates: [desired(10, [confirmed])], records: [] }, current, 1000), []);
  invalid(() => compilationStatefulOrigins({ desiredStates: [initial], records: [record(7, [origin({ processIdentity: "different" })])] }, current, 1000));
});

test("retention keeps original image requests referenced by desired, pending and unresolved native work", () => {
  const origins = id => [origin({ requestId: id })];
  const journal = { desiredStates: [desired(2, origins("confirmed")), desired(3, origins("revoked"), { revoked: true })], records: [
    record(1, origins("confirmed"), { state: "applied", expiresAt: 1 }),
    record(3, origins("pending")), record(4, origins("unresolved"), { state: "uncertain", expiresAt: 1 }),
    record(5, origins("applying"), { state: "applying", expiresAt: 1 }),
    record(6, origins("expired"), { expiresAt: 1000 }),
    ...["failed", "expired", "superseded"].map((state, i) => record(7 + i, origins(state), { state })),
  ] };
  assert.deepEqual(retainedStatefulOriginRequests(journal, 1000), ["confirmed", "pending", "unresolved", "applying"]);
  assert.deepEqual(retainedStatefulOriginRequests({ desiredStates: [], records: [] }, 1000), []);
});

test("valid private signed-image/module lineage is verified without reading live product source", t => {
  const { current, options } = fixture(t);
  assert.deepEqual(verifyStatefulOrigins([current], options), [current]);
  assert.deepEqual(verifyStatefulOrigins([], { ...options, artifactRoot: "/missing", patchRoot: "/missing" }), []);
});

test("origin verification rejects changed hashes, scope, resources, key linkage and escaped paths", async t => {
  const mutations = {
    moduleBytes: f => writeFileSync(f.current.modulePath, "changed-module"),
    imageBytes: f => writeFileSync(f.current.artifactPath, "changed-image"),
    process: f => { f.options.scope = { ...scope, sessionIdentity: "new-process" }; },
    binary: f => { f.options.scope = { ...scope, binaryIdentity: "new-binary" }; },
    resources: f => { f.options.resourceDigest = hash("new-generator"); },
    moduleDigest: f => { f.current.moduleDigest = hash("incorrect"); },
    artifactDigest: f => { f.current.artifactDigest = hash("incorrect"); },
    artifactEscape: f => { f.current.artifactPath = join(f.root, "elsewhere", f.current.artifactPath.split("/").at(-1)); },
    moduleEscape: f => { f.current.modulePath = join(f.root, "elsewhere", f.current.module + ".swiftmodule"); },
    key: f => { f.current.module = "SwiftSimLivePatch_" + "b".repeat(64); f.current.modulePath = join(dirname(f.current.modulePath), f.current.module + ".swiftmodule"); },
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, t => {
    const f = fixture(t); mutate(f); invalid(() => verifyStatefulOrigins([f.current], f.options));
  });
});

test("marker authority must match the signed first generation and current process", async t => {
  for (const field of ["key", "requestId", "artifactDigest", "binaryIdentity", "processIdentity", "statefulComponentProtocol", "resourceDigest"]) {
    await t.test(field, t => {
      const f = fixture(t); f.writeMarker({ ...f.marker, [field]: field === "statefulComponentProtocol" ? 2 : "wrong" });
      invalid(() => verifyStatefulOrigins([f.current], f.options));
    });
  }
  for (const [name, content] of [["null", "null"], ["invalid-json", "{"], ["oversized", " ".repeat(16_385)]]) {
    await t.test(name, t => {
      const f = fixture(t); writeFileSync(f.markerPath, content); invalid(() => verifyStatefulOrigins([f.current], f.options));
    });
  }
});

test("origin verification rejects missing, shared, linked, empty and oversized private resources", async t => {
  for (const target of ["modulePath", "artifactPath", "markerPath"]) {
    for (const mutation of ["missing", "shared", "symlink", "hardlink", "directory"]) await t.test(`${target}-${mutation}`, t => {
      const f = fixture(t), path = target === "markerPath" ? f.markerPath : f.current[target];
      if (mutation === "missing") rmSync(path);
      if (mutation === "shared") chmodSync(path, 0o640);
      if (mutation === "symlink") { const bytes = fixtureFiles.readTextSync(path); rmSync(path); const outside = join(f.root, "outside"); writeFileSync(outside, bytes, { mode: 0o600 }); symlinkSync(outside, path); }
      if (mutation === "hardlink") linkSync(path, join(f.root, "second-link"));
      if (mutation === "directory") { rmSync(path); mkdirSync(path, { mode: 0o700 }); }
      invalid(() => verifyStatefulOrigins([f.current], f.options));
    });
  }
  for (const [target, size] of [["modulePath", 0], ["artifactPath", 0], ["modulePath", 8 * 1024 * 1024 + 1], ["artifactPath", 32 * 1024 * 1024 + 1]]) {
    await t.test(`${target}-size-${size}`, t => { const f = fixture(t); truncateSync(f.current[target], size); invalid(() => verifyStatefulOrigins([f.current], f.options)); });
  }
  for (const target of ["artifactRoot", "patchRoot", "compilationDirectory"]) {
    for (const mutation of ["shared", "symlink"]) await t.test(`${target}-${mutation}`, t => {
      const f = fixture(t), path = target === "compilationDirectory" ? dirname(f.current.modulePath) : f.options[target];
      if (mutation === "shared") chmodSync(path, 0o750);
      else { rmSync(path, { recursive: true }); const outside = join(f.root, "external-root"); mkdirSync(outside, { mode: 0o700 }); symlinkSync(outside, path); }
      invalid(() => verifyStatefulOrigins([f.current], f.options));
    });
  }
});

test("optional original state names are canonical, bounded, and preserve legacy origin digests", () => {
  const legacy = origin();
  assert.deepEqual(normalizeStatefulOrigins([legacy]), [legacy]);
  assert.equal(statefulOriginsDigest([legacy]), hash(JSON.stringify([legacy])));
  assert.equal(Object.hasOwn(normalizeStatefulOrigins([legacy])[0], "stateNames"), false);
  const named = origin({ stateNames: ["draft", "count"] });
  assert.deepEqual(normalizeStatefulOrigins([named])[0].stateNames, ["count", "draft"]);
  assert.equal(statefulOriginsDigest([named]), statefulOriginsDigest([origin({ stateNames: ["count", "draft"] })]));
  assert.notEqual(statefulOriginsDigest([named]), statefulOriginsDigest([legacy]));
  assert.deepEqual(normalizeStatefulOrigins([origin({ stateNames: [] })])[0].stateNames, []);
  for (const stateNames of [null, "count", {}, [""], ["bad-name"], ["a.b"], ["7name"], ["a", "a"], [1], ["x".repeat(65)],
    Array.from({ length: 33 }, (_, i) => `field${i}`)]) invalid(() => normalizeStatefulOrigins([origin({ stateNames })]));
  const largestNames = Array.from({ length: 32 }, (_, i) => `field${i}`.padEnd(64, "x"));
  invalid(() => normalizeStatefulOrigins(Array.from({ length: 32 }, (_, i) => origin({ owner: `Card${i}`, stateNames: largestNames }))));
});
