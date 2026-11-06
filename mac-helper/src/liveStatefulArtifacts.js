import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { ensureFileModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { normalizeStatefulOrigins, statefulOriginsDigest, verifyStatefulOrigins } from "./liveStatefulOrigins.js";

const digest = value => createHash("sha256").update(value).digest("hex");
const descriptor = origin => Object.fromEntries(["path", "owner", "module", "sourceFile", "layoutDigest"].map(key => [key, origin[key]]));
export function statefulCompilerOrigins(record, roots) {
  const origins = verifyStatefulOrigins(record.statefulOrigins || [], { ...roots, scope: record.scope });
  return { origins, descriptors: origins.map(descriptor), digest: statefulOriginsDigest(origins),
    importArguments: [...new Set(origins.map(origin => origin.modulePath.slice(0, origin.modulePath.lastIndexOf("/"))))].flatMap(path => ["-I", path]) };
}
export function completeStatefulMetadata(generation, inputOrigins, { record, moduleName, modulePath, artifactPath, artifactDigest, resourceDigest }) {
  if (generation.statefulComponentProtocol !== 1) return {};
  // A serialized pinned module can import earlier origin modules. Keep the
  // process's bounded dependency closure until restoration/relaunch, even when
  // a previous component is no longer in desired source.
  const origins = [...inputOrigins];
  for (const use of generation.statefulOriginUses || []) {
    const origin = inputOrigins.find(item => ["path", "owner", "module", "sourceFile", "layoutDigest"].every(key => item[key] === use[key]));
    if (!origin) throw invalid();
  }
  if (generation.statefulComponents?.length) {
    const module = privateModule(modulePath);
    for (const component of generation.statefulComponents) origins.push({
      path: component.path, owner: component.owner, module: moduleName, sourceFile: `Replacement${component.sourceFileIndex}.swift`,
      layoutDigest: component.layoutDigest, modulePath, moduleDigest: digest(module), artifactPath, artifactDigest,
      requestId: record.requestId, processIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, resourceDigest,
    });
  }
  return { statefulComponentProtocol: 1, statefulOrigins: normalizeStatefulOrigins(origins, record.scope) };
}
const moduleOutputs = modulePath => [modulePath, modulePath.replace(/\.swiftmodule$/, ".swiftdoc"), modulePath.replace(/\.swiftmodule$/, ".swiftsourceinfo")];
export function guardStatefulModuleOutputs(modulePath) {
  for (const path of moduleOutputs(modulePath)) {
    const stats = existingModuleOutput(path);
    if (!stats) continue;
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (process.getuid && stats.uid !== process.getuid())) throw invalid();
  }
}
// swiftc inherits the Mac's umask; constrain serialized private declarations before publication.
export function privatizeStatefulModule(modulePath) {
  for (const path of moduleOutputs(modulePath)) {
    const stats = existingModuleOutput(path);
    if (!stats) continue;
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (process.getuid && stats.uid !== process.getuid())) throw invalid();
    ensureFileModeSync(path, 0o600);
  }
  privateModule(modulePath);
}
export function validateStatefulMarker(marker, patch, record) {
  const enabled = patch.statefulComponentProtocol === 1;
  if ((marker.statefulComponentProtocol || 0) !== (patch.statefulComponentProtocol || 0)) throw invalid();
  if (!enabled) {
    if (patch.statefulOrigins?.length || marker.statefulOriginsDigest !== undefined) throw invalid();
    return;
  }
  if (marker.processIdentity !== record.scope.sessionIdentity || marker.statefulOriginsDigest !== statefulOriginsDigest(normalizeStatefulOrigins(patch.statefulOrigins, record.scope))) throw invalid();
}
export function signedStatefulMetadata(raw, record, signedDigest) {
  if (raw.statefulComponentProtocol !== 1) return {};
  return { statefulComponentProtocol: 1, statefulOrigins: normalizeStatefulOrigins(raw.statefulOrigins.map(origin =>
    origin.requestId === record.requestId && origin.artifactPath === raw.path ? { ...origin, artifactDigest: signedDigest } : origin), record.scope) };
}
function existingModuleOutput(path) {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw invalid(); }
}
function privateModule(path) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > 8 * 1024 * 1024 || (stats.mode & 0o077)
    || (process.getuid && stats.uid !== process.getuid())) throw invalid();
  return readFileSync(path);
}
function invalid() { return Object.assign(new Error("The stateful component artifact is not trusted. No patch was admitted."), { code: "PATCH_ARTIFACT_INVALID" }); }
