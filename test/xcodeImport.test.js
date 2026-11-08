import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPhase4ProductionStoreFactories } from "../mac-helper/src/persistence/phase4ProductionStores.js";
import { createSqliteDeviceBuildStore } from "../mac-helper/src/persistence/phase4DeviceBuildStore.js";
import {
  importXcodeMetadata,
  externalBuildDigest,
  qualifyXcodeBuild,
  exportXcodeBuild,
} from "../mac-helper/src/xcodeImport.js";
import { snapshotBuildInputs } from "../mac-helper/src/buildInputSnapshot.js";
import { publicDeviceBuild, deviceBuildLinks } from "../mac-helper/src/deviceBuilderCore.js";
const binary = {
  bundle_id: "example.app",
  bundle_version: "1",
  build_number: "42",
  executable_uuid: "11111111-1111-1111-1111-111111111111",
  debug_dylib_uuid: "22222222-2222-2222-2222-222222222222",
};
function fixture(t, backend) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-xcode-import-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const factory = createPhase4ProductionStoreFactories({
    stateRoot: root,
    deviceMaintenance: false,
  });
  t.after(() => factory.database.close());
  const store =
    backend === "sqlite"
      ? createSqliteDeviceBuildStore({
          database: factory.database,
          legacyPath: join(root, "builds.json"),
          maintenance: false,
        })
      : factory.createDeviceBuildStore();
  const baseline = store.create({ scheme: "App" });
  Object.assign(baseline, {
    state: "ready",
    project: join(root, "App.xcodeproj"),
    app: {
      ...baseline.app,
      bundleIdentifier: "example.app",
      teamID: "TEAM",
      version: "1",
      build: "41",
    },
  });
  store.save(baseline);
  const input = {
    project: baseline.project,
    scheme: "App",
    metadata: {
      schema: 1,
      appPath: join(root, "Xcode/App.app"),
      name: "App",
      teamID: "TEAM",
      binaryIdentity: binary,
      fingerprints: { "Info.plist": "a".repeat(64) },
    },
  };
  return { root, store, input };
}
for (const backend of ["legacy", "sqlite"])
  test(`${backend}: Xcode import is metadata-only, deduplicated, not installed or live-ready`, (t) => {
    const f = fixture(t, backend);
    const first = importXcodeMetadata(f.store, f.input);
    const again = importXcodeMetadata(f.store, f.input);
    assert.equal(first.imported, true);
    assert.equal(again.imported, false);
    assert.equal(first.build.id, again.build.id);
    assert.equal(f.store.listApps().length, 1);
    assert.equal(first.build.installation.state, "unknown");
    assert.equal(first.build.artifacts.root, "");
    assert.equal(first.build.artifacts.ipaPath, "");
    assert.equal(first.build.liveReload.compilerReady, false);
    assert.equal(publicDeviceBuild(first.build).origin, "xcode");
    assert.equal(deviceBuildLinks(first.build, "https://private.test").installURL, "");
    assert.doesNotMatch(
      JSON.stringify(publicDeviceBuild(first.build)),
      /appPath|fingerprints|executable_uuid/,
    );
  });
test("import rejects unregistered project/team and prunes only disposable metadata", (t) => {
  const f = fixture(t);
  assert.throws(
    () => importXcodeMetadata(f.store, { ...f.input, scheme: "Other" }),
    /REGISTRATION/,
  );
  const protectedIDs = [];
  for (let n = 0; n < 35; n++) {
    const input = structuredClone(f.input);
    input.metadata.binaryIdentity.build_number = String(n);
    input.metadata.binaryIdentity.executable_uuid = `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`;
    const b = importXcodeMetadata(f.store, input, Date.now() + n).build;
    if (n === 0) {
      f.store.saveVerification(b.id, { state: "verified", devices: [] });
      protectedIDs.push(b.id);
    }
  }
  assert.equal(f.store.list().filter((b) => b.origin === "xcode").length, 32);
  assert.ok(f.store.get(protectedIDs[0]));
});
test("an exact phone launch can confirm the imported binary without enabling its compiler", (t) => {
  const f = fixture(t);
  const b = importXcodeMetadata(f.store, f.input, Date.now() - 1000).build;
  const saved = f.store.saveLaunchConfirmation(b.id, {
    observedAt: Date.now(),
    binaryIdentity: binary,
    projectPath: f.input.project,
    scheme: "App",
    fingerprint: "c".repeat(64),
    processFingerprint: "c".repeat(64),
    provenanceDigest: externalBuildDigest(b.externalBuild),
  });
  assert.equal(saved.installation.state, "launch-confirmed");
  assert.equal(saved.liveReload.compilerReady, false);
  assert.equal(
    f.store.saveLaunchConfirmation(b.id, {
      observedAt: Date.now(),
      binaryIdentity: { ...binary, build_number: "43" },
      projectPath: f.input.project,
      scheme: "App",
      fingerprint: "d".repeat(64),
      processFingerprint: "d".repeat(64),
      provenanceDigest: externalBuildDigest(b.externalBuild),
    }),
    null,
  );
});

test("changed resources cannot reuse an imported binary identity", (t) => {
  const f = fixture(t);
  importXcodeMetadata(f.store, f.input);
  const changed = structuredClone(f.input);
  changed.metadata.fingerprints["Info.plist"] = "b".repeat(64);
  assert.throws(() => importXcodeMetadata(f.store, changed), /IDENTITY_REUSED/);
  assert.equal(f.store.list().filter((b) => b.origin === "xcode").length, 1);
});
test("protected history is bounded and never deletes products or compiler owners", (t) => {
  const f = fixture(t, "sqlite");
  const protectedIDs = [];
  for (let n = 0; n < 32; n++) {
    const input = structuredClone(f.input);
    input.metadata.binaryIdentity.build_number = String(n);
    const b = importXcodeMetadata(f.store, input).build;
    b.liveReload.compilerReady = true;
    f.store.save(b);
    protectedIDs.push(b.id);
  }
  const before = readdirSync(f.root).sort();
  assert.throws(() => importXcodeMetadata(f.store, f.input), /PROTECTED_CAPACITY/);
  assert.equal(f.store.list().filter((b) => b.origin === "xcode").length, 32);
  assert.ok(protectedIDs.every((id) => f.store.get(id)));
  assert.deepEqual(readdirSync(f.root).sort(), before);
});
test("metadata cannot qualify a compiler and explicit export never creates a cached copy", async (t) => {
  const f = fixture(t);
  const b = importXcodeMetadata(f.store, f.input).build;
  await assert.rejects(
    qualifyXcodeBuild({
      buildID: b.id,
      resultBundle: join(f.root, "build.xcresult"),
      store: f.store,
    }),
    /QUALIFICATION_REQUIRED/,
  );
  let calls = 0;
  const result = await exportXcodeBuild({
    buildID: b.id,
    output: join(f.root, "export.ipa"),
    store: f.store,
    run: async (command, args) => {
      calls++;
      assert.equal(command, "python3");
      assert.ok(args.includes("--fingerprints-sha"));
      return { code: 0, stdout: JSON.stringify({ outcome: "xcode-build-exported", bytes: 123 }) };
    },
  });
  assert.equal(result.bytes, 123);
  assert.equal(calls, 1);
  assert.equal(f.store.get(b.id).artifacts.ipaPath, "");
  assert.equal(f.store.get(b.id).liveReload.compilerReady, false);
});

test("compiler qualification reuses exact sources and refuses drift before registration", async (t) => {
  const f = fixture(t);
  mkdirSync(f.input.project);
  writeFileSync(join(f.input.project, "project.pbxproj"), "fixture");
  const source = join(f.root, "Card.swift");
  writeFileSync(source, "struct Card {}\n");
  const names = ["Info.plist", "App", "App.debug.dylib", "_CodeSignature/CodeResources"];
  f.input.metadata.fingerprints = Object.fromEntries(names.map((name) => [name, "a".repeat(64)]));
  const b = importXcodeMetadata(f.store, f.input).build;
  b.installation = {
    ...b.installation,
    state: "launch-confirmed",
    launchFingerprint: "c".repeat(64),
  };
  // Capture after store writes: the source root contains only project-owned inputs.
  const projectRoot = join(f.root, "sources");
  mkdirSync(projectRoot);
  const project = join(projectRoot, "App.xcodeproj");
  mkdirSync(project);
  const swift = join(projectRoot, "Card.swift");
  writeFileSync(swift, "struct Card {}\n");
  b.project = project;
  b.externalBuild.projectPath = project;
  b.externalBuild.sourceWitness = {
    fingerprint: snapshotBuildInputs(projectRoot).fingerprint,
    startedAt: new Date().toISOString(),
  };
  f.store.save(b);
  const captured = {
    provenance: {
      binaryIdentity: binary,
      appFingerprint: names.map((name) => ({ name, hash: "a".repeat(64) })),
    },
    commands: [
      {
        arguments: [
          "-module-name",
          "App",
          swift,
          "-enable-implicit-dynamic",
          "-enable-private-imports",
        ],
        working_directory: projectRoot,
      },
    ],
    linkerCommands: [
      ["/usr/bin/clang", "-interposable", "-o", join(b.externalBuild.appPath, "App.debug.dylib")],
    ],
  };
  let registrations = 0;
  let inspections = 0;
  const args = {
    buildID: b.id,
    resultBundle: join(f.root, "result.xcresult"),
    store: f.store,
    inspect: () => structuredClone(captured),
    verifyLinker: async (paths) => {
      inspections++;
      assert.equal(paths.length, 2);
    },
    register: async () => {
      registrations++;
      return { registered: 1, provenance: captured.provenance };
    },
  };
  const flags = captured.commands[0].arguments.pop();
  await assert.rejects(qualifyXcodeBuild(args), /COMPILER_FLAGS_REQUIRED/);
  assert.equal(registrations, 0);
  captured.commands[0].arguments.push(flags);
  const links = captured.linkerCommands;
  captured.linkerCommands = [];
  await assert.rejects(qualifyXcodeBuild(args), /LINKER_FLAGS_REQUIRED/);
  assert.equal(registrations, 0);
  captured.linkerCommands = links;
  assert.equal((await qualifyXcodeBuild(args)).outcome, "xcode-compiler-qualified");
  assert.equal(registrations, 1);
  assert.equal(inspections, 1);
  assert.equal(f.store.get(b.id).liveReload.compilerReady, true);
  writeFileSync(swift, "struct Changed {}\n");
  await assert.rejects(qualifyXcodeBuild(args), /SOURCE_CHANGED/);
  assert.equal(registrations, 1);
});
