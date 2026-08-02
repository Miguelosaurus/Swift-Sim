import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const LIVE_SESSION_DESCRIPTOR_SCHEMA_VERSION = 1;
export const LIVE_SESSION_PROTOCOL_VERSION = "1";
const LIVE_ROOT = join(homedir(), ".swift-sim", "live");
const ENGINE_SESSION = join(homedir(), ".swift-sim", "engine", "session.json");
const COMPILATIONS = join(LIVE_ROOT, "compilations.json");

export function liveSessionDescriptorPath(rootPath = LIVE_ROOT) { return join(rootPath, "session-descriptor.json"); }
export function canonicalProjectPath(value = "") {
  const path = resolve(String(value || ""));
  if (existsSync(path) && lstatSync(path).isDirectory() && (path.endsWith(".xcodeproj") || path.endsWith(".xcworkspace"))) return join(path, path.endsWith(".xcodeproj") ? "project.pbxproj" : "contents.xcworkspacedata");
  return String(value || "") ? path : "";
}
export function projectRootForDescriptor(value = "") {
  const path = canonicalProjectPath(value);
  if (!path) return "";
  return path.endsWith("/project.pbxproj") || path.endsWith("/contents.xcworkspacedata") ? dirname(dirname(path)) : dirname(path);
}
export function configurationPaths({ projectPath = "", projectRoot = "", scheme = "" } = {}) {
  const path = canonicalProjectPath(projectPath); const root = resolve(projectRoot || projectRootForDescriptor(path) || "."); const paths = [path];
  if (path.endsWith("/project.pbxproj")) {
    const dir = dirname(dirname(path)); paths.push(join(dir, "xcshareddata", "xcschemes", `${scheme}.xcscheme`), join(dir, "xcshareddata", "IDEWorkspaceChecks.plist"));
  } else if (path.endsWith("/contents.xcworkspacedata")) {
    const dir = dirname(path); paths.push(path, join(dir, "xcshareddata", "xcschemes", `${scheme}.xcscheme`));
  }
  paths.push(join(root, "Package.resolved"), join(root, ".swiftpm", "Package.resolved"));
  return [...new Set(paths.filter(Boolean))];
}
export function fingerprintFile(value) {
  const path = resolve(String(value || ""));
  try {
    const link = lstatSync(path); const realPath = realpathSync(path);
    if (!link.isFile()) return { path, realPath, kind: link.isSymbolicLink() ? "symlink" : "other", missing: false };
    const stats = statSync(path); const bytes = stats.size <= 16 * 1024 * 1024 ? readFileSync(path) : null;
    return { path, realPath, kind: link.isSymbolicLink() ? "symlink" : "file", size: stats.size, mtimeMs: stats.mtimeMs, sha256: bytes ? createHash("sha256").update(bytes).digest("hex") : "size-mtime-only" };
  } catch { return { path, missing: true }; }
}
export function fingerprintConfigurationFiles(paths = []) { return Object.fromEntries([...new Set(paths)].filter(Boolean).map((path) => [resolve(path), fingerprintFile(path)])); }
export function buildLiveSessionDescriptor({ projectPath = "", projectRoot = "", scheme = "", applicationTarget = "", availableSchemes = [], host = "", packageConfigured = false, interposableConfigured = false, tailnet = {}, engineSession = {}, engineVersion = "", compilerCapturePath = COMPILATIONS, targetLinkedSwiftSimLive = packageConfigured, establishedAt = new Date().toISOString(), reason = "deep-readiness", generation = Date.now() } = {}) {
  const path = canonicalProjectPath(projectPath); const root = resolve(projectRoot || projectRootForDescriptor(path) || ".");
  return { schemaVersion: LIVE_SESSION_DESCRIPTOR_SCHEMA_VERSION, protocolVersion: LIVE_SESSION_PROTOCOL_VERSION, generation, establishedAt, reason, project: { path, root, scheme: String(scheme), applicationTarget, availableSchemes, packageConfigured, interposableConfigured, targetLinkedSwiftSimLive }, liveHost: String(host), tailnet: { privateForwardConfigured: Boolean(tailnet.privateForwardConfigured), userspace: Boolean(tailnet.userspace) }, engine: { sessionNonce: String(engineSession.nonce || ""), version: String(engineSession.engineVersion || engineVersion) }, compilerCapture: fingerprintFile(compilerCapturePath), configurationFingerprints: fingerprintConfigurationFiles(configurationPaths({ projectPath: path, projectRoot: root, scheme })) };
}
export function validateLiveSessionDescriptorShape(value) {
  const errors = []; if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["Descriptor must be an object."] };
  if (value.schemaVersion !== 1) errors.push("Unsupported descriptor schema."); if (value.protocolVersion !== "1") errors.push("Unsupported descriptor protocol.");
  if (!Number.isInteger(value.generation) || value.generation < 1) errors.push("Descriptor generation is invalid."); if (!value.project?.path) errors.push("Descriptor project path is missing."); if (!value.project?.root) errors.push("Descriptor project root is missing."); if (!value.project?.scheme) errors.push("Descriptor scheme is missing."); if (!value.liveHost) errors.push("Descriptor live host is missing."); if (!value.engine?.sessionNonce) errors.push("Descriptor engine nonce is missing."); if (!value.engine?.version) errors.push("Descriptor engine version is missing."); if (!value.compilerCapture) errors.push("Compiler capture fingerprint is missing."); if (!value.configurationFingerprints) errors.push("Configuration fingerprints are missing.");
  return { valid: errors.length === 0, errors };
}
export function validateLiveSessionDescriptor(value, { projectPath = "", scheme = "", host = "", engineSessionPath = ENGINE_SESSION, compilerCapturePath = COMPILATIONS, checkFiles = true } = {}) {
  const shape = validateLiveSessionDescriptorShape(value); const errors = [...shape.errors]; if (!shape.valid) return { valid: false, errors };
  if (projectPath && canonicalProjectPath(projectPath) !== value.project.path) errors.push("Requested project differs from descriptor."); if (scheme && scheme !== value.project.scheme) errors.push("Requested scheme differs from descriptor."); if (host && host !== value.liveHost) errors.push("Requested live host differs from descriptor.");
  if (checkFiles) { const current = fingerprintConfigurationFiles(Object.keys(value.configurationFingerprints)); for (const [path, expected] of Object.entries(value.configurationFingerprints)) if (!sameFingerprint(expected, current[path])) errors.push(`Configuration fingerprint changed: ${basename(path)}.`); if (!sameFingerprint(value.compilerCapture, fingerprintFile(compilerCapturePath || value.compilerCapture.path))) errors.push("Compiler capture fingerprint changed."); }
  const session = readJSON(engineSessionPath); if (!session) errors.push("Live engine session is missing."); else { if (String(session.nonce || "") !== value.engine.sessionNonce) errors.push("Live engine session nonce changed."); if (String(session.engineVersion || "") !== value.engine.version) errors.push("Live engine version changed."); if (String(session.projectRoot || "") !== value.project.root) errors.push("Live engine project changed."); if (String(session.scheme || "") !== value.project.scheme) errors.push("Live engine scheme changed."); }
  return { valid: errors.length === 0, errors };
}
export function readLiveSessionDescriptor({ rootPath = LIVE_ROOT, descriptorPath = "", projectPath = "", scheme = "", host = "", engineSessionPath = ENGINE_SESSION, compilerCapturePath = COMPILATIONS, checkFiles = true } = {}) {
  const path = descriptorPath || liveSessionDescriptorPath(rootPath); let value;
  try { const stat = lstatSync(path); if (stat.isSymbolicLink()) return { valid: false, descriptor: null, errors: ["Descriptor symlink is not allowed."], path }; if ((stat.mode & 0o077) !== 0) return { valid: false, descriptor: null, errors: ["Descriptor permissions are too broad."], path }; value = JSON.parse(readFileSync(path, "utf8")); } catch { return { valid: false, descriptor: null, errors: ["Descriptor is missing or malformed."], path }; }
  const result = validateLiveSessionDescriptor(value, { projectPath, scheme, host, engineSessionPath, compilerCapturePath, checkFiles }); return { ...result, descriptor: result.valid ? value : null, path };
}
export function publishLiveSessionDescriptor(value, { rootPath = LIVE_ROOT, descriptorPath = liveSessionDescriptorPath(rootPath) } = {}) {
  const shape = validateLiveSessionDescriptorShape(value); if (!shape.valid) throw new Error(shape.errors.join(" ")); mkdirSync(rootPath, { recursive: true, mode: 0o700 }); chmodSync(rootPath, 0o700); const existing = readDescriptor(descriptorPath); const next = { ...value };
  if (existing && Number(existing.generation || 0) >= Number(next.generation || 0)) return { published: false, reason: "stale-writer", descriptor: existing, path: descriptorPath }; const temporary = `${descriptorPath}.tmp-${process.pid}-${randomUUID()}`; let fd;
  try { fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8"); fsyncSync(fd); closeSync(fd); fd = undefined; chmodSync(temporary, 0o600); renameSync(temporary, descriptorPath); chmodSync(descriptorPath, 0o600); } finally { if (fd !== undefined) closeSync(fd); }
  return { published: true, descriptor: next, path: descriptorPath };
}
function readDescriptor(path) { try { const stat = lstatSync(path); if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) return null; return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function readJSON(path) { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } }
function sameFingerprint(a, b) { if (!a || !b || Boolean(a.missing) !== Boolean(b.missing)) return false; if (a.missing) return true; return a.path === b.path && a.realPath === b.realPath && a.kind === b.kind && a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256; }
