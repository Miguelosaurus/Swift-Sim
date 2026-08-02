import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildLiveSessionDescriptor,
  liveSessionDescriptorPath,
  publishLiveSessionDescriptor,
  readLiveSessionDescriptor,
  validateLiveSessionDescriptor,
} from "../mac-helper/src/liveSessionDescriptor.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-live-descriptor-"));
  const projectDirectory = join(root, "Example.xcodeproj");
  const projectPath = join(projectDirectory, "project.pbxproj");
  const schemeDirectory = join(projectDirectory, "xcshareddata", "xcschemes");
  const engineRoot = join(root, "engine");
  const liveRoot = join(root, "live");
  const engineSessionPath = join(engineRoot, "session.json");
  const compilerCapturePath = join(liveRoot, "compilations.json");
  mkdirSync(schemeDirectory, { recursive: true }); mkdirSync(engineRoot, { recursive: true }); mkdirSync(liveRoot, { recursive: true });
  writeFileSync(projectPath, "PBXProject Example"); writeFileSync(join(schemeDirectory, "Example.xcscheme"), "<Scheme />");
  const session = { projectRoot: root, scheme: "Example", engineVersion: "0.4.0", nonce: "engine-one" };
  writeFileSync(engineSessionPath, JSON.stringify(session)); writeFileSync(compilerCapturePath, JSON.stringify({ version: 1 }));
  const descriptor = buildLiveSessionDescriptor({ projectPath, projectRoot: root, scheme: "Example", applicationTarget: "Example", availableSchemes: ["Example"], host: "100.64.0.10", packageConfigured: true, interposableConfigured: true, tailnet: { privateForwardConfigured: true, userspace: true }, engineSession: session, compilerVersion: "0.4.0", compilerCapturePath, generation: 1 });
  return { root, projectPath, engineSessionPath, compilerCapturePath, liveRoot, descriptor };
}

test("publishes an atomic private descriptor and validates warm facts", () => {
  const value = fixture();
  assert.equal(publishLiveSessionDescriptor(value.descriptor, { rootPath: value.liveRoot }).published, true);
  assert.equal(statSync(liveSessionDescriptorPath(value.liveRoot)).mode & 0o077, 0);
  const loaded = readLiveSessionDescriptor({ rootPath: value.liveRoot, projectPath: value.projectPath, scheme: "Example", host: "100.64.0.10", engineSessionPath: value.engineSessionPath, compilerCapturePath: value.compilerCapturePath });
  assert.equal(loaded.valid, true);
  assert.equal(loaded.descriptor.project.applicationTarget, "Example");
});

test("configuration, compiler, engine, and identity drift fail closed", () => {
  const value = fixture(); publishLiveSessionDescriptor(value.descriptor, { rootPath: value.liveRoot });
  writeFileSync(value.projectPath, "PBXProject changed");
  let result = validateLiveSessionDescriptor(value.descriptor, { projectPath: value.projectPath, scheme: "Example", host: "100.64.0.10", engineSessionPath: value.engineSessionPath, compilerCapturePath: value.compilerCapturePath });
  assert.equal(result.valid, false); assert.match(result.errors.join(" "), /Configuration fingerprint changed/);
  writeFileSync(value.projectPath, "PBXProject Example"); writeFileSync(value.compilerCapturePath, "changed");
  result = validateLiveSessionDescriptor(value.descriptor, { projectPath: value.projectPath, scheme: "Example", host: "100.64.0.10", engineSessionPath: value.engineSessionPath, compilerCapturePath: value.compilerCapturePath });
  assert.equal(result.valid, false); assert.match(result.errors.join(" "), /Compiler capture fingerprint changed/);
  writeFileSync(value.engineSessionPath, JSON.stringify({ projectRoot: value.root, scheme: "Example", engineVersion: "0.4.0", nonce: "engine-two" }));
  result = validateLiveSessionDescriptor(value.descriptor, { projectPath: value.projectPath, scheme: "Example", host: "100.64.0.10", engineSessionPath: value.engineSessionPath, compilerCapturePath: value.compilerCapturePath });
  assert.equal(result.valid, false); assert.match(result.errors.join(" "), /nonce changed/);
});

test("malformed permissions, symlinks, and stale writers fail closed", () => {
  const value = fixture(); const path = liveSessionDescriptorPath(value.liveRoot); mkdirSync(value.liveRoot, { recursive: true }); writeFileSync(path, JSON.stringify({ schemaVersion: 99 })); chmodSync(path, 0o600);
  assert.equal(readLiveSessionDescriptor({ rootPath: value.liveRoot }).valid, false);
  assert.equal(publishLiveSessionDescriptor(value.descriptor, { rootPath: value.liveRoot }).published, true); chmodSync(path, 0o644);
  assert.match(readLiveSessionDescriptor({ rootPath: value.liveRoot }).errors.join(" "), /permissions/); chmodSync(path, 0o600);
  const newer = { ...value.descriptor, generation: 2, establishedAt: "2026-08-02T00:00:01.000Z" }; assert.equal(publishLiveSessionDescriptor(newer, { rootPath: value.liveRoot }).published, true);
  assert.equal(publishLiveSessionDescriptor(value.descriptor, { rootPath: value.liveRoot }).reason, "stale-writer");
  const symlinkPath = join(value.root, "descriptor-link.json"); symlinkSync(path, symlinkPath);
  assert.match(readLiveSessionDescriptor({ descriptorPath: symlinkPath }).errors.join(" "), /symlink/);
  assert.equal(JSON.parse(readFileSync(path, "utf8")).generation, 2);
});
