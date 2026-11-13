import { spawn, spawnSync } from "node:child_process";
import { COMPONENTS, engineMatchesContract } from "./componentCompatibility.js";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  createReadStream,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createConnection } from "node:net";
import { arch, homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";
import { abortPendingLiveEngine, readPublishedLiveEngineRecord, kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";
import { buildLiveSessionDescriptor, publishLiveSessionDescriptor, readLiveSessionDescriptor } from "./liveSessionDescriptor.js";
import { machoUUID, normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
import { ensureDirectoryModeSync, NodeAtomicFileStore } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeCommandRunner } from "./infrastructure/nodeCommandRunner.js";
import { fileURLToPath } from "node:url";
import { readLocalEngineCandidate, validateLocalEngineAppMetadata } from "./liveEngineCandidate.js";
import { createFullCallableCompiler, compilerResourceDigest } from "./fullCallableCompiler.js";
import { normalizeReplacementProof, replacementCoverageDigest } from "./replacementProof.js";
import { inspectStatefulBuild, statefulBodyIndex } from "./statefulBuild.js";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { statefulOriginsDigest, verifyStatefulOrigins } from "./liveStatefulOrigins.js";
import { statefulCompilerOrigins, completeStatefulMetadata, privatizeStatefulModule, guardStatefulModuleOutputs, validateStatefulMarker, signedStatefulMetadata } from "./liveStatefulArtifacts.js";

export const ROUTING_SCHEMA_VERSION = 1;
export const CLASSIFIER_VERSION = 2;
export const LIVE_ENGINE_CONTROL_TIMEOUT_MS = 750;
export const LIVE_COMPILER_REGISTRATION_TIMEOUT_MS = 30_000;
export const LIVE_COMPILER_REGISTRATION_BUDGET_MS = 180_000;

export const LIVE_REASON_CODES = Object.freeze({
  NO_CHANGE: "NO_CHANGE",
  IMPLEMENTATION_ONLY: "IMPLEMENTATION_ONLY",
  PRIVATE_ADDITIVE: "PRIVATE_ADDITIVE",
  SHARED_ADDITIVE: "SHARED_ADDITIVE",
  NON_SWIFT_FILE: "NON_SWIFT_FILE",
  FILE_ADDED_OR_REMOVED: "FILE_ADDED_OR_REMOVED",
  IMPORT_CHANGED: "IMPORT_CHANGED",
  DECLARATION_CHANGED: "DECLARATION_CHANGED",
  STORED_PROPERTY_CHANGED: "STORED_PROPERTY_CHANGED",
  SIGNATURE_CHANGED: "SIGNATURE_CHANGED",
  MACRO_OR_EXPLICIT_REPLACEMENT: "MACRO_OR_EXPLICIT_REPLACEMENT",
  MIXED_EDIT_SET: "MIXED_EDIT_SET",
  LIVE_NOT_READY: "LIVE_NOT_READY",
  PATCH_COMPILE_FAILED: "PATCH_COMPILE_FAILED",
  PATCH_LOAD_FAILED: "PATCH_LOAD_FAILED",
  REFRESH_NOT_ACKNOWLEDGED: "REFRESH_NOT_ACKNOWLEDGED",
  PATCH_TIMEOUT: "PATCH_TIMEOUT",
});

const LOCAL_ENGINE_CANDIDATE = readLocalEngineCandidate();
const ENGINE_VERSION = LOCAL_ENGINE_CANDIDATE.candidate?.version || COMPONENTS.engine.version;
const ENGINE_SHA256 = LOCAL_ENGINE_CANDIDATE.candidate?.sha256 || COMPONENTS.engine.sha256;
const ENGINE_ROOT = join(homedir(), ".swift-sim", "engine");
const ENGINE_APP = join(ENGINE_ROOT, "InjectionNext.app");
const ENGINE_EXECUTABLE = join(ENGINE_APP, "Contents", "MacOS", "InjectionNext");
const ENGINE_MANIFEST = join(ENGINE_ROOT, "manifest.json");
const ENGINE_PID = join(ENGINE_ROOT, "engine.pid");
const ENGINE_SESSION = join(ENGINE_ROOT, "session.json");
const LIVE_ROOT = join(homedir(), ".swift-sim", "live");
const ENGINE_SOCKET = join(LIVE_ROOT, "engine.sock");
const ENGINE_LOG = join(LIVE_ROOT, "engine.log");
const LIVE_MANIFEST = join(LIVE_ROOT, "compilations.json");
const LIVE_PATCH_ROOT = join(LIVE_ROOT, "patches");

export function classifyLiveChange({ beforePath, afterPath, compiler }) {
  return classifyEditSet({
    allowAdditive: true,
    compiler,
    files: [{
      path: afterPath || beforePath,
      status: "modified",
      kind: "swift",
      beforePath,
      afterPath,
    }],
  }).changes[0];
}

export function classifyLiveChanges({ beforePaths = [], afterPaths = [], compiler }) {
  if (beforePaths.length === 0 || beforePaths.length !== afterPaths.length) {
    throw new Error("Pass the same nonzero number of --before and --after Swift files.");
  }
  return classifyEditSet({
    allowAdditive: true,
    compiler,
    files: beforePaths.map((beforePath, index) => ({
      path: afterPaths[index] || beforePath,
      status: "modified",
      kind: "swift",
      beforePath,
      afterPath: afterPaths[index],
    })),
  });
}

/**
 * Classify a complete edit operation. This is the canonical internal API used
 * by the benchmark and by the compatibility wrappers above. A single
 * structural or non-Swift member makes the complete operation rebuild-safe.
 */
export function classifyEditSet({ files = [], allowAdditive = false, additiveOptions, compiler } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Pass a nonempty edit set.");
  }

  const changes = files.map((file) => classifyEditFile(file));
  // Swift pairs are classified together by the same SwiftSyntax rule the patch compiler uses.
  const pending = changes.flatMap((change, index) => change.swift ? [index] : []);
  if (pending.length) {
    const results = swiftClassifier(compiler).classify(pending.map((index) => changes[index].swift));
    pending.forEach((changeIndex, index) => { changes[changeIndex] = swiftResult(results[index], changes[changeIndex].paths); });
  }
  const rebuild = changes.find((change) => change.route === "rebuild-required");
  if (rebuild) {
    if (allowAdditive) {
      const additive = classifyPrivateAdditiveEditSet(files, additiveOptions);
      if (additive) return additive;
    }
    return normalizedClassification({
      route: "rebuild-required",
      hotReloadable: false,
      reason: rebuild.reason,
      reasonCode: changes.length > 1
        && changes.some((change) => change.route === "hot-reload")
        ? LIVE_REASON_CODES.MIXED_EDIT_SET
        : rebuild.reasonCode,
      changes,
    });
  }

  const changed = changes.filter((change) => change.route === "hot-reload");
  return normalizedClassification({
    route: changed.length > 0 ? "hot-reload" : "no-change",
    hotReloadable: true,
    reason: changed.length > 0
      ? `${changed.length} implementation ${changed.length === 1 ? "file is" : "files are"} hot-reloadable.`
      : "The Swift sources are unchanged.",
    reasonCode: changed.length > 0
      ? LIVE_REASON_CODES.IMPLEMENTATION_ONLY
      : LIVE_REASON_CODES.NO_CHANGE,
    changes,
  });
}

// This path runs only after the cheap implementation classifier rejects a
// requested durable delivery. It creates no worker, engine, phone or watcher.
export function classifyPrivateAdditiveEditSet(files, { manifest: suppliedManifest, compiler,
  baselineForFile, manifestPath = LIVE_MANIFEST } = {}) {
  try {
    if (!Array.isArray(files) || !files.length || files.length > 32 || files.some(file =>
      String(file.kind || "swift").toLowerCase() !== "swift" || !["modified", "added", "removed"].includes(String(file.status || "modified").toLowerCase())
      || !String(file.path || file.afterPath || "").endsWith(".swift"))) return null;
    let manifest = suppliedManifest;
    if (!manifest) {
      const stats = lstatSync(manifestPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o077)
        || stats.size > 8 * 1024 * 1024 || (process.getuid && stats.uid !== process.getuid())) return null;
      manifest = readJSONFile(manifestPath);
    }
    const identity = normalizedLiveBinaryIdentity(manifest.binaryIdentity);
    const binaryIdentity = `${identity.executable_uuid}:${identity.debug_dylib_uuid}`;
    const queue = createLiveDeliveryQueue();
    const deltas = files.map(file => ({ path: resolve(file.path || file.afterPath),
      beforeSource: file.beforeSource ?? (file.status === "added" && !file.beforePath ? "" : readFileSync(file.beforePath, "utf8")),
      afterSource: file.afterSource ?? (file.status === "removed" && !file.afterPath ? "" : readFileSync(file.afterPath, "utf8")) }));
    const projected = queue.compilationPreview({ binaryIdentity, files: deltas });
    const { snapshots, reference } = additiveSnapshots(projected, manifest, { baselineForFile, queue, binaryIdentity });
    const fullCompiler = compiler || createFullCallableCompiler({ runner: new NodeCommandRunner({ spawn, spawnSync }), cacheRoot: join(LIVE_ROOT, "compiler-cache") });
    let addedStateBodies, statefulConstants;
    try { ({ bodies: addedStateBodies, constants: statefulConstants } = statefulBodyIndex(manifest.stateful, reference.moduleName)); }
    catch { throw registrationError("FULL_CALLABLE_STATEFUL_ABI_INVALID", "The captured state-preserving view ABI could not be verified. No patch or signed build was started."); }
    const generation = generateAdditive(fullCompiler, { module: reference.moduleName,
      generation: createHash("sha256").update(JSON.stringify(snapshots)).digest("hex").slice(0, 32),
      allowAdditive: true, allowAddedState: true, stateGeneration: 1,
      statefulBodies: addedStateBodies, ...(Object.keys(statefulConstants).length ? { statefulConstants } : {}),
      availableModules: availableAdditiveModules(reference, snapshots), files: snapshots },
    () => sharedModuleSources(manifest, reference, snapshots, { baselineForFile, queue, binaryIdentity }));
    const constantOnly = generation.constantProtocol === 1 && generation.additiveProtocol !== 1;
    if (!constantOnly && (generation.additiveProtocol !== 1 || generation.requiresPrivateScopes !== true)) return null;
    if (!constantOnly && manifest.compilerContextProtocol !== 2) throw registrationError("LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED",
      "Additions need the concurrency-aware compiler capture. Re-capture the original build metadata before retrying; no app rebuild was started.");
    const reasonCode = constantOnly ? LIVE_REASON_CODES.IMPLEMENTATION_ONLY
      : generation.sharedAdditive ? LIVE_REASON_CODES.SHARED_ADDITIVE : LIVE_REASON_CODES.PRIVATE_ADDITIVE;
    const changes = deltas.map(file => result(file.beforeSource === file.afterSource ? "no-change" : "hot-reload", true,
      "Additions have complete callable representation against the installed source baseline.", { path: file.path }, reasonCode));
    return { ...normalizedClassification({ route: "hot-reload", hotReloadable: true,
      reason: "Additions and their callable consumers can hot reload.", reasonCode, changes }), requiresCompleteCoverage: true, ...(generation.addedStateProtocol === 1 ? { requiresAddedState: true } : {}) };
  } catch (error) {
    if (/^(?:FULL_CALLABLE_|LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED$)/.test(error?.code || "")) throw error;
    return null;
  }
}

function additiveSnapshots(files, manifest, { baselineForFile, queue, binaryIdentity } = {}) {
  const reference = files.map(file => manifest.compilations?.find(context => context.sources?.includes(file.path))).find(Boolean);
  if (!reference) throw completeArtifactError();
  const snapshots = files.map(file => {
    const path = resolve(file.path);
    const before = file.beforeSource, after = file.afterSource;
    const expected = manifest.sourceBaselines?.[path];
    const context = manifest.compilations?.find(item => item.sources?.includes(path));
    if (context && (context.moduleName !== reference.moduleName || context.workingDirectory !== reference.workingDirectory
      || JSON.stringify(context.compilerArguments) !== JSON.stringify(reference.compilerArguments))) throw completeArtifactError();
    let installedBaseline = file.installedBaseline ?? before;
    if (!context) {
      // Unknown files are patch-local source units in this project, never a
      // guessed member of another target or a borrowed private source identity.
      if (expected !== undefined || !validNewSwiftPath(path, manifest, reference)) throw completeArtifactError();
      installedBaseline = file.installedBaseline ?? baselineForFile?.(path) ?? queueOriginal(queue, binaryIdentity, path) ?? before;
      if (installedBaseline !== "") throw completeArtifactError();
      return { path, before, after, installedBaseline: "", isNewFile: true };
    }
    if (!/^[a-f0-9]{64}$/.test(expected || "")) throw completeArtifactError();
    if (createHash("sha256").update(installedBaseline).digest("hex") !== expected)
      installedBaseline = baselineForFile?.(path) ?? queueOriginal(queue, binaryIdentity, path);
    if (typeof installedBaseline !== "string" || createHash("sha256").update(installedBaseline).digest("hex") !== expected) throw completeArtifactError();
    return { path, before, after, installedBaseline };
  });
  return { snapshots, reference };
}
function queueOriginal(queue, binaryIdentity, path) {
  const scope = queue?.list().find(record => record.scope.binaryIdentity === binaryIdentity && record.files.some(file => file.path === path))?.scope
    || queue?.desiredStates().find(item => item.scope.binaryIdentity === binaryIdentity)?.scope;
  return scope ? queue.binaryBaseline(scope, path)?.beforeSource : undefined;
}
function validNewSwiftPath(path, manifest, reference) {
  const root = manifest.binding?.projectRoot;
  if (typeof root !== "string" || !path.startsWith(resolve(root) + "/") || !path.endsWith(".swift")
    || manifest.compilations.some(context => context.sources?.some(source => basename(source) === basename(path)))) return false;
  // Reject symlink traversal even when the new source has not been written yet.
  let parent = path;
  while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
  return realpathSync(parent) === parent && realpathSync(root) === resolve(root)
    && reference.workingDirectory && !path.slice(resolve(root).length).split("/").some(part => [".git", ".build"].includes(part));
}
function sharedModuleSources(manifest, reference, snapshots, { baselineForFile, queue, binaryIdentity } = {}) {
  const paths = [...new Set(manifest.compilations.filter(context => context.moduleName === reference.moduleName).flatMap(context => context.sources || []))].sort();
  if (!paths.length || paths.length > 2048) throw completeArtifactError();
  let bytes = 0;
  return paths.map(path => {
    const expected = manifest.sourceBaselines?.[path];
    let source = snapshots.find(file => file.path === path)?.installedBaseline ?? baselineForFile?.(path) ?? queueOriginal(queue, binaryIdentity, path);
    if (source === undefined) {
      try { if (statSync(path).size <= 1024 * 1024) source = readFileSync(path, "utf8"); } catch { /* exact originals required */ }
    }
    if (typeof source !== "string" || createHash("sha256").update(source).digest("hex") !== expected
      || (bytes += Buffer.byteLength(source)) > 6 * 1024 * 1024) throw Object.assign(new Error("The exact original module sources are unavailable for shared-declaration qualification."), { code: "FULL_CALLABLE_ORIGINALS_UNAVAILABLE" });
    return { path, source };
  });
}
function generateAdditive(compiler, input, originals) {
  if (!input.files.some(file => file.isNewFile)) {
    try { return compiler.generate(input); }
    catch (error) { if (error?.code !== "QUEUED_MECHANISM_UNSUPPORTED") throw error; }
  }
  return compiler.generate({ ...input, allowSharedAdditive: true, allowStatefulAdditive: true, allowAddedState: true, moduleSources: originals() });
}

function classifyEditFile(file = {}) {
  const path = String(file.path || file.afterPath || file.beforePath || "");
  const kind = String(file.kind || (extname(path).toLowerCase() === ".swift" ? "swift" : "other"))
    .toLowerCase();
  const status = String(file.status || "modified").toLowerCase();
  const paths = {
    beforePath: file.beforePath || "",
    afterPath: file.afterPath || "",
    path,
  };

  if (kind !== "swift" || extname(path).toLowerCase() !== ".swift") {
    return result(
      "rebuild-required",
      false,
      "A non-Swift file changed.",
      paths,
      LIVE_REASON_CODES.NON_SWIFT_FILE,
    );
  }
  const hasBefore = Boolean(file.beforePath) || file.beforeSource !== undefined;
  const hasAfter = Boolean(file.afterPath) || file.afterSource !== undefined;
  if (status !== "modified" || !hasBefore || !hasAfter) {
    return result(
      "rebuild-required",
      false,
      "A Swift file was added, removed, or renamed.",
      paths,
      LIVE_REASON_CODES.FILE_ADDED_OR_REMOVED,
    );
  }

  const before = file.beforeSource ?? requiredSwiftSource(file.beforePath, "before");
  const after = file.afterSource ?? requiredSwiftSource(file.afterPath, "after");
  // Filled in by classifyEditSet's single batched SwiftSyntax pass.
  return { paths, swift: { path, before, after } };
}

export function classifySwiftSource(before, after, paths = {}, { compiler } = {}) {
  const path = paths.path || paths.afterPath || paths.beforePath || "Source.swift";
  return swiftResult(swiftClassifier(compiler).classify([{ path, before, after }])[0], paths);
}

let defaultSwiftClassifier;
function swiftClassifier(compiler) {
  return compiler || (defaultSwiftClassifier ||= createFullCallableCompiler({ runner: new NodeCommandRunner({ spawn, spawnSync }),
    cacheRoot: join(LIVE_ROOT, "compiler-cache") }));
}
function swiftResult(value, paths) {
  const route = value.route;
  const classified = result(route, route !== "rebuild-required", value.reason, paths, value.reasonCode);
  return value.diagnostic ? { ...classified, diagnostic: value.diagnostic } : classified;
}

export async function inspectLiveReload(options = {}) {
  return withLiveEngineLifecycleLock(() => inspectLiveReloadUnlocked(options));
}

export async function inspectLiveReloadWarm(options = {}) {
  return (options?.runtime?.lock || withLiveEngineLifecycleLock)(() => inspectLiveReloadWarmUnlocked(options));
}

async function inspectLiveReloadWarmUnlocked({ project = "", host = "", scheme = "", runtime = {} } = {}) {
  const descriptor = (runtime.readDescriptor || readLiveSessionDescriptor)({ projectPath: project, scheme, host });
  if (!descriptor.valid) {
    const deep = runtime.deepInspect ? await runtime.deepInspect({ project, host, scheme }) : await inspectLiveReloadUnlocked({ project, host, scheme });
    return { ...deep, readinessMode: "deep", descriptor: { valid: false, errors: descriptor.errors } };
  }
  const value = descriptor.descriptor;
  const control = runtime.engineControl ? await runtime.engineControl({ action: "status" }) : await engineControl({ action: "status" });
  const engineStatus = control?.success ? control.data : null;
  const watchingProject = Boolean(engineStatus?.watching_directories?.some((path) => resolve(path) === value.project.root));
  const ready = Boolean(control?.success && watchingProject && engineStatus?.has_connected_client && Number(engineStatus?.captured_compilations || 0) > 0 && engineStatus?.injection_state !== "Error");
  return { ...statusFromLiveSessionDescriptor(value, { engineStatus, ready }), readinessMode: "warm", descriptor: { valid: true } };
}

async function inspectLiveReloadUnlocked({ project = "", host = "", scheme = "" } = {}) {
  const requestedProjectPath = project ? resolve(project) : "";
  const projectPath = requestedProjectPath && existsSync(requestedProjectPath)
    && statSync(requestedProjectPath).isDirectory()
    && (requestedProjectPath.endsWith(".xcodeproj") || requestedProjectPath.endsWith(".xcworkspace"))
    ? join(requestedProjectPath, requestedProjectPath.endsWith(".xcodeproj") ? "project.pbxproj" : "contents.xcworkspacedata")
    : requestedProjectPath;
  const availableSchemes = isXcodeContainerProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
  const schemeSelection = selectLiveScheme(projectPath, scheme, availableSchemes);
  const projectConfiguration = liveProjectConfiguration(projectPath, schemeSelection.scheme);
  const projectSource = projectConfiguration.source;
  const tailnet = host
    ? { command: "", prefix: [], socket: "", host }
    : discoverTailnet();
  const tailscaleHost = host || tailnet.host;
  const packageConfigured = projectConfiguration.packageConfigured;
  const interposableConfigured = projectConfiguration.interposableConfigured;
  const engineInstalled = installedEngineMatchesManifest();
  const control = engineInstalled ? await engineControl({ action: "status" }) : null;
  const engineStatus = control?.success ? control.data : null;
  const projectRoot = projectRootFor(projectPath);
  const engineSession = readJSONFile(ENGINE_SESSION);
  const matchingEngineSession = liveEngineSessionMatches(engineSession, {
    projectRoot,
    scheme: schemeSelection.scheme,
  });
  const watchingProject = Boolean(
    matchingEngineSession
    && engineStatus?.watching_directories?.some((path) => resolve(path) === projectRoot)
  );
  const connected = Boolean(engineStatus?.has_connected_client);
  const compilerReady = Number(engineStatus?.captured_compilations || 0) > 0;
  const configured = Boolean(
    tailscaleHost
    && packageConfigured
    && engineInstalled
    && !schemeSelection.error
  );

  const status = {
    ready: Boolean(
      configured
      && watchingProject
      && connected
      && compilerReady
      && engineStatus?.injection_state !== "Error"
    ),
    canStart: configured,
    mode: "debug-only",
    transport: tailscaleHost ? "private-tailscale" : "unavailable",
    host: tailscaleHost,
    port: 8887,
    engine: {
      installed: engineInstalled,
      version: ENGINE_VERSION,
      running: Boolean(engineStatus),
      watchingProject,
      connected,
      preparedDeliveryProtocol: Number(engineStatus?.prepared_delivery_protocol || 0),
      localCandidate: Boolean(LOCAL_ENGINE_CANDIDATE.candidate),
      injectionState: engineStatus?.injection_state || "Stopped",
      lastSource: engineStatus?.last_source || "",
      lastError: engineStatus?.last_error || "",
      signingReady: Boolean(engineStatus?.codesigning_identity_configured),
      compilerReady,
      capturedCompilations: Number(engineStatus?.captured_compilations || 0),
    },
    tailnet: {
      detected: Boolean(tailnet.host),
      userspace: Boolean(tailnet.socket),
      privateForwardConfigured: tailnet.socket
        ? isPrivateForwardConfigured(tailnet)
        : Boolean(tailscaleHost),
    },
    project: {
      path: projectPath,
      root: projectRoot,
      readable: Boolean(projectSource),
      packageConfigured,
      interposableConfigured,
      buildSettingsManagedBySwiftSim: packageConfigured,
      scheme: schemeSelection.scheme,
      availableSchemes: schemeSelection.availableSchemes,
      schemeRequired: schemeSelection.required,
      schemeError: schemeSelection.error,
      applicationTarget: projectConfiguration.applicationTarget || "",
    },
    requiredBuildSettings: {
      configuration: "Debug",
      INJECTION_HOST: tailscaleHost || "<mac-tailscale-ip>",
      EMIT_FRONTEND_COMMAND_LINES: "YES",
      COMPILATION_CACHE_ENABLE_CACHING: "NO",
      ENABLE_DEBUG_DYLIB: "YES",
      ENABLE_XOJIT_PREVIEWS: "YES",
      SWIFT_OPTIMIZATION_LEVEL: "-Onone",
      OTHER_SWIFT_FLAGS: ["$(inherited)", "-Xfrontend", "-enable-implicit-dynamic", "-enable-private-imports"],
      OTHER_LDFLAGS: ["$(inherited)", "-Xlinker", "-interposable"],
    },
    limitations: [
      "Implementation-body and SwiftUI composition edits only",
      "The iPhone and Mac must both be connected to the same private tailnet",
      "A structural change requires a new signed build and install link",
      "Never enable this lane in App Store or Release builds",
    ],
  };
  if (status.ready) publishDescriptorFromStatus(status, engineSession);
  return status;
}

function publishDescriptorFromStatus(status, engineSession) {
  if (!engineSession?.nonce || !status?.project?.path || !status?.project?.scheme) return;
  try {
    publishLiveSessionDescriptor(buildLiveSessionDescriptor({ projectPath: status.project.path, projectRoot: status.project.root, scheme: status.project.scheme, applicationTarget: status.project.applicationTarget, availableSchemes: status.project.availableSchemes, host: status.host, packageConfigured: status.project.packageConfigured, interposableConfigured: status.project.interposableConfigured, tailnet: status.tailnet, engineSession, engineVersion: status.engine.version }));
  } catch {}
}

function statusFromLiveSessionDescriptor(descriptor, { engineStatus = null, ready = false } = {}) {
  const project = descriptor.project;
  const watchingProject = Boolean(engineStatus?.watching_directories?.some((path) => resolve(path) === project.root));
  return {
    ready, canStart: true, mode: "debug-only", transport: "private-tailscale", host: descriptor.liveHost, port: 8887,
    engine: { installed: true, version: descriptor.engine.version, preparedDeliveryProtocol: Number(engineStatus?.prepared_delivery_protocol || 0), localCandidate: Boolean(LOCAL_ENGINE_CANDIDATE.candidate), running: Boolean(engineStatus), watchingProject, connected: Boolean(engineStatus?.has_connected_client), injectionState: engineStatus?.injection_state || "Stopped", lastSource: engineStatus?.last_source || "", lastError: engineStatus?.last_error || "", signingReady: Boolean(engineStatus?.codesigning_identity_configured), compilerReady: Number(engineStatus?.captured_compilations || 0) > 0, capturedCompilations: Number(engineStatus?.captured_compilations || 0) },
    tailnet: { detected: Boolean(descriptor.liveHost), userspace: Boolean(descriptor.tailnet?.userspace), privateForwardConfigured: Boolean(descriptor.tailnet?.privateForwardConfigured) },
    project: { path: project.path, root: project.root, readable: true, packageConfigured: Boolean(project.packageConfigured), interposableConfigured: Boolean(project.interposableConfigured), buildSettingsManagedBySwiftSim: Boolean(project.packageConfigured), scheme: project.scheme, availableSchemes: project.availableSchemes || [], schemeRequired: false, schemeError: "", applicationTarget: project.applicationTarget || "" },
    requiredBuildSettings: { configuration: "Debug", INJECTION_HOST: descriptor.liveHost, EMIT_FRONTEND_COMMAND_LINES: "YES", COMPILATION_CACHE_ENABLE_CACHING: "NO", ENABLE_DEBUG_DYLIB: "YES", ENABLE_XOJIT_PREVIEWS: "YES", SWIFT_OPTIMIZATION_LEVEL: "-Onone", OTHER_SWIFT_FLAGS: ["$(inherited)", "-Xfrontend", "-enable-implicit-dynamic", "-enable-private-imports"], OTHER_LDFLAGS: ["$(inherited)", "-Xlinker", "-interposable"] },
    limitations: ["Implementation-body and SwiftUI composition edits only", "The iPhone and Mac must both be connected to the same private tailnet", "A structural change requires a new signed build and install link", "Never enable this lane in App Store or Release builds"],
  };
}

export async function ensureLiveEngineInstalled() {
  return withLiveEngineLifecycleLock(() => ensureLiveEngineInstalledUnlocked());
}

async function ensureLiveEngineInstalledUnlocked() {
  if (LOCAL_ENGINE_CANDIDATE.error) throw new Error(LOCAL_ENGINE_CANDIDATE.error);
  const candidate = LOCAL_ENGINE_CANDIDATE.candidate;
  return installLiveEngineForSetup({
    spec: { ...COMPONENTS.engine, ...(candidate ? { version: candidate.version, sha256: candidate.sha256, sourceRevision: candidate.sourceRevision } : {}) },
    localArchive: candidate?.archivePath || "", localCandidate: Boolean(candidate),
  });
}

export function readInstalledEngineManifest(rootPath = ENGINE_ROOT) {
  try {
    const path = join(rootPath, "manifest.json"); const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384 || info.uid !== process.getuid()) return null;
    if (!existsSync(join(rootPath, "InjectionNext.app", "Contents", "MacOS", "InjectionNext"))) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch { return null; }
}

function verifySetupEngineApp(path, run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", timeout: 30000 })) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) return false;
    const signature = run("/usr/bin/codesign", ["--verify", "--deep", "--strict", path]);
    const metadata = run("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(path, "Contents", "Info.plist")]);
    if (signature.status !== 0 || metadata.status !== 0) return false;
    validateLocalEngineAppMetadata(JSON.parse(metadata.stdout)); return true;
  } catch { return false; }
}

export function inspectInstalledEngineForSetup(rootPath = ENGINE_ROOT) {
  const manifest = readInstalledEngineManifest(rootPath);
  return manifest && verifySetupEngineApp(join(rootPath, "InjectionNext.app")) ? manifest : null;
}

// Explicit setup/update only. Alternate roots are for isolated qualification;
// they cannot stop the user's process without an explicitly supplied callback.
export async function installLiveEngineForSetup({ rootPath = ENGINE_ROOT, spec = COMPONENTS.engine,
  localArchive = "", localCandidate = false, runtime = {} } = {}) {
  const { installEngineTransaction, recoverEngineInstall } = await import("./engineInstallTransaction.js");
  const fail = code => Object.assign(new Error(code), { code });
  if (!/^\d+\.\d+\.\d+$/.test(spec.version || "") || !/^[a-f0-9]{64}$/.test(spec.sha256 || "")
    || !/^[a-f0-9]{40}$/.test(spec.sourceRevision || "") || !Number.isSafeInteger(spec.maxArchiveBytes) || spec.maxArchiveBytes < 1 || spec.maxArchiveBytes > 134217728
    || !rootPath || !resolve(rootPath).startsWith("/")) throw fail("ENGINE_CONTRACT_INVALID");
  try { const info = lstatSync(rootPath); if (info.isSymbolicLink() || !info.isDirectory() || info.uid !== process.getuid()) throw fail("ENGINE_ROOT_UNSAFE"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  ensureDirectoryModeSync(rootPath, 0o700);
  const app = join(rootPath, "InjectionNext.app"), stage = join(rootPath, ".install-staging");
  const staged = join(stage, "InjectionNext.app"), backup = join(rootPath, ".previous-engine");
  const journal = join(rootPath, "install-state.json"), manifest = join(rootPath, "manifest.json");
  const files = runtime.files || new NodeAtomicFileStore();
  const id = path => { try { const s = lstatSync(path); if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid()) throw fail("ENGINE_ROOT_UNSAFE"); return `${s.dev}:${s.ino}`; } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
  const read = (path, limit) => { try { const s = lstatSync(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || s.size > limit) throw fail("ENGINE_MANIFEST_INVALID"); return readFileSync(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
  const write = (path, bytes) => files.writeText(path, bytes.toString("utf8"), { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
  const run = runtime.run || ((cmd, args) => spawnSync(cmd, args, { encoding: "utf8", timeout: 30000 }));
  const verifyApp = runtime.verifyApp || (path => verifySetupEngineApp(path, run));
  const verifyCurrent = async expected => engineMatchesContract(readInstalledEngineManifest(rootPath), expected) && await verifyApp(app);
  const io = {
    currentIdentity: () => id(app), backupIdentity: () => id(backup), stagedIdentity: () => id(staged),
    stageExists: () => id(stage) !== null,
    readManifest: () => read(manifest, 16384), readJournal: () => { const bytes = read(journal, 32768); return bytes ? JSON.parse(bytes) : null; },
    writeJournal: value => files.writeJSON(journal, value, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true }),
    writeManifest: value => files.writeJSON(manifest, value, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true }),
    restoreManifest: bytes => bytes === null ? rmSync(manifest, { force: true }) : write(manifest, bytes),
    backupCurrent: () => renameSync(app, backup), publishStaged: () => renameSync(staged, app), restoreBackup: () => renameSync(backup, app),
    removeCurrent: () => rmSync(app, { recursive: true, force: true }), removeBackup: () => rmSync(backup, { recursive: true, force: true }),
    removeStage: () => rmSync(stage, { recursive: true, force: true }), removeJournal: () => rmSync(journal, { force: true }),
  };
  await recoverEngineInstall({ io, verifyCurrent });
  const desired = { version: spec.version, sha256: spec.sha256, sourceRevision: spec.sourceRevision, localCandidate };
  if (await verifyCurrent(desired)) return { id: "live-engine", label: "Live patch engine", state: "unchanged", detail: `Engine ${spec.version} is verified`, compatible: engineMatchesContract(desired) };
  if ((runtime.arch || arch()) !== "arm64") throw fail("ENGINE_APPLE_SILICON_REQUIRED");
  const prepare = async () => {
    mkdirSync(stage, { mode: 0o700 });
    const archive = join(stage, "engine.zip"); let source;
    if (localArchive) source = createReadStream(localArchive, { highWaterMark: 65536 });
    else {
      const response = await (runtime.fetch || fetch)(spec.url, { redirect: "follow", signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw fail("ENGINE_DOWNLOAD_UNAVAILABLE");
      const length = Number(response.headers.get("content-length"));
      if ((Number.isFinite(length) && length > spec.maxArchiveBytes) || !response.body) throw fail("ENGINE_ARCHIVE_LIMIT");
      source = response.body;
    }
    const fd = openSync(archive, "wx", 0o600); const hash = createHash("sha256"); let size = 0;
    try { for await (const part of source) { const bytes = Buffer.from(part); size += bytes.length; if (size > spec.maxArchiveBytes) throw fail("ENGINE_ARCHIVE_LIMIT"); hash.update(bytes); let offset = 0; while (offset < bytes.length) { const written = writeSync(fd, bytes, offset, bytes.length - offset); if (written <= 0) throw fail("ENGINE_DOWNLOAD_UNAVAILABLE"); offset += written; } } }
    finally { closeSync(fd); }
    if (!size || hash.digest("hex") !== spec.sha256) throw fail("ENGINE_CHECKSUM_MISMATCH");
    if (run("/usr/bin/ditto", ["-x", "-k", archive, stage]).status !== 0 || !await verifyApp(staged)) throw fail("ENGINE_SIGNATURE_INVALID");
    run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", staged]);
  };
  const outcome = await installEngineTransaction({ desired, io, prepare, verifyCurrent,
    stop: runtime.stop || (rootPath === ENGINE_ROOT ? stopLiveEngine : async () => {}) });
  return { id: "live-engine", label: "Live patch engine", state: outcome.cleanupPending ? "needs-attention" : "installed",
    detail: outcome.cleanupPending ? "The matching engine is installed. Run setup again to finish removing its one previous copy." : `Engine ${spec.version} installed and verified`,
    compatible: engineMatchesContract(desired), cleanupPending: outcome.cleanupPending };
}

export async function registerLiveBuildResult(options) {
  return (options?.runtime?.lock || withLiveEngineLifecycleLock)(() => registerLiveBuildResultUnlocked(options));
}

export async function withLiveBuildSession(options, operation, runtime = {}) {
  if (typeof operation !== "function") throw new TypeError("A live build operation is required.");
  const lock = runtime.lock || withLiveEngineLifecycleLock;
  const start = runtime.start || startLiveReloadUnlocked;
  const register = runtime.register || registerLiveBuildResultUnlocked;
  return lock(async () => {
    await runtime.beforeStart?.();
    const liveSession = await start(options);
    return operation({
      liveSession,
      registerLiveBuildResult: (registration) => register({ ...registration, projectPath: options.project, scheme: options.scheme }),
    });
  });
}

/** Explicit, signed app opt-in only; URL schemes alone may be OAuth callbacks. */
export function liveAppPresentation(info = {}) {
  const targetAppName = String(info.CFBundleDisplayName || info.CFBundleName || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 100);
  const result = targetAppName ? { targetAppName } : {};
  const value = info.SwiftSimLaunchURL;
  if (typeof value !== "string" || value.length > 512 || /[\s\x00-\x1f\x7f]/.test(value)) return result;
  try {
    const url = new URL(value);
    const scheme = url.protocol.slice(0, -1).toLowerCase();
    const declared = (Array.isArray(info.CFBundleURLTypes) ? info.CFBundleURLTypes : []).flatMap((type) => Array.isArray(type?.CFBundleURLSchemes) ? type.CFBundleURLSchemes : []).map((item) => String(item).toLowerCase());
    if (!declared.includes(scheme) || /^(https?|file|data|javascript|tel|sms|mailto|itms-services|swiftsim)$/.test(scheme) || url.username || url.password || url.search || url.hash) return result;
    return { ...result, launchURL: url.href };
  } catch { return result; }
}

// Shared by normal result-bundle capture and bounded operator recovery of
// preserved Xcode activity records. Parsing grants no registration authority.
export function capturedFrontendCompilationMap(log) {
  const commands = [...new Set(frontendCommandLines(log))].map((command) => {
    const tokens = splitShellCommand(command); const executable = tokens.shift() || "";
    if (!executable.endsWith("/swift-frontend")) return null;
    return { arguments: tokens, working_directory: frontendWorkingDirectory(tokens) };
  }).filter(Boolean);
  if (!commands.length || commands.length > 1024) throw registrationError("LIVE_CAPTURE_COMMANDS_INVALID", "The result bundle does not contain a bounded complete Swift frontend compilation map.");
  const compilations = commands.map(dynamicReplacementContext).filter(Boolean);
  return { commands, compilations };
}

// Pure metadata enrichment. The exact already-registered map digest is the
// authority; a project setting or guessed compiler default is insufficient.
export function enrichCapturedCompilerContext(manifest, commands) {
  if (!Array.isArray(commands) || !commands.length || commands.length > 1024
    || createHash("sha256").update(JSON.stringify(commands)).digest("hex") !== manifest?.registration?.mapDigest) throw completeArtifactError();
  const compilations = commands.map(dynamicReplacementContext).filter(Boolean);
  if (compilations.length !== manifest.compilations?.length || compilations.some((context, index) => {
    const previous = manifest.compilations[index];
    if (context.moduleName !== previous.moduleName || context.workingDirectory !== previous.workingDirectory
      || JSON.stringify(context.sources) !== JSON.stringify(previous.sources)) return true;
    let cursor = 0;
    for (const argument of context.compilerArguments) if (argument === previous.compilerArguments[cursor]) cursor += 1;
    return cursor !== previous.compilerArguments.length;
  })) throw completeArtifactError();
  return { ...manifest, compilations, compilerContextProtocol: 2 };
}

export function inspectLiveBuildResult({ resultBundle, appPath = "", projectPath = "", scheme = "", runtime = {} }) {
  const path = resolve(resultBundle || "");
  if (!resultBundle || !existsSync(path) || lstatSync(path).isSymbolicLink()) throw registrationError("LIVE_CAPTURE_RESULT_MISSING", "The preserved Xcode result bundle is missing or unsafe.");
  const log = runtime.buildLog ?? readXcodeBuildLog(path);
  const { commands, compilations } = capturedFrontendCompilationMap(log);
  const sourcePaths = new Set(); const extraInputs = new Set(runtime.inputPaths || []);
  for (const command of commands) {
    for (let index = 0; index < command.arguments.length; index += 1) {
      const arg = command.arguments[index];
      if (arg.endsWith(".swift")) sourcePaths.add(resolveFrom(command.working_directory, arg));
      if (arg === "-filelist" && command.arguments[index + 1]) {
        const listPath = resolveFrom(command.working_directory, command.arguments[++index]);
        registrationFileFingerprint(listPath, 16 * 1024 * 1024);
        extraInputs.add(listPath);
        for (const line of readFileSync(listPath, "utf8").split(/\r?\n/).filter(Boolean)) sourcePaths.add(resolveFrom(command.working_directory, line));
      }
    }
  }
  if (!sourcePaths.size || sourcePaths.size > 8192) throw registrationError("LIVE_CAPTURE_SOURCES_INVALID", "The result bundle does not identify bounded Swift source inputs.");
  const overlays = new Set(commands.flatMap(command => command.arguments.flatMap((arg, index) =>
    arg === "-vfsoverlay" && basename(command.arguments[index + 1] || "") === "swift-sim-stateful-overlay.json"
      ? [resolveFrom(command.working_directory, command.arguments[index + 1])] : [])));
  if (overlays.size > 1) throw registrationError("STATEFUL_BUILD_INVALID", "The build captured conflicting state-preserving source overlays.");
  let stateful;
  for (const overlay of overlays) {
    const inspected = inspectStatefulBuild(overlay, sourcePaths);
    stateful = inspected.index;
    for (const input of inspected.inputs) extraInputs.add(input);
  }
  const binaryIdentity = appPath ? readBuiltLiveIdentity(appPath) : null;
  let appFingerprint = [];
  let presentation = {};
  if (appPath) {
    if (lstatSync(appPath).isSymbolicLink() || !lstatSync(appPath).isDirectory()) throw registrationError("LIVE_CAPTURE_APP_INVALID", "The preserved signed app is unsafe.");
    const verify = runtime.verifySignature || ((value) => spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", value], { encoding: "utf8", timeout: 15_000 }).status === 0);
    if (!verify(appPath)) throw registrationError("LIVE_CAPTURE_SIGNATURE_INVALID", "The preserved Debug app signature could not be verified.");
    const info = JSON.parse(spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(appPath, "Info.plist")], { encoding: "utf8", timeout: 10_000 }).stdout);
    presentation = liveAppPresentation(info);
    appFingerprint = ["Info.plist", info.CFBundleExecutable, `${info.CFBundleExecutable}.debug.dylib`, "_CodeSignature/CodeResources"].map((name) => ({ name, ...registrationFileFingerprint(join(appPath, name), 512 * 1024 * 1024) }));
  }
  if (projectPath) {
    const project = resolve(projectPath);
    const container = ["project.pbxproj", "contents.xcworkspacedata"].includes(basename(project)) ? dirname(project) : project;
    for (const input of [container.endsWith(".xcodeproj") ? join(container, "project.pbxproj") : container.endsWith(".xcworkspace") ? join(container, "contents.xcworkspacedata") : container,
      join(container, "project.xcworkspace", "xcshareddata", "swiftpm", "Package.resolved"), join(container, "xcshareddata", "swiftpm", "Package.resolved"), join(dirname(container), "Package.resolved")]) if (existsSync(input)) extraInputs.add(input);
  }
  let sourceBytes = 0;
  const sourceFiles = [...sourcePaths].sort().map((source) => {
    sourceBytes += statSync(source).size;
    if (sourceBytes > 128 * 1024 * 1024) throw registrationError("LIVE_CAPTURE_SOURCE_LIMIT", "The bounded compiler source capture is too large.");
    return { path: source, ...registrationSourceFingerprint(source, { projectPath, resultBundle: path, allowedRoots: runtime.allowedSourceRoots || [] }) };
  });
  const provenance = {
    version: 1, resultBundle: { path, logDigest: registrationDigest(log) }, projectPath: projectPath ? resolve(projectPath) : "", scheme: String(scheme),
    binaryIdentity, appFingerprint,
    sourceFiles,
    projectFiles: [...extraInputs].map((input) => resolve(input)).sort().map((input) => ({ path: input, ...registrationFileFingerprint(input, 16 * 1024 * 1024) })),
  };
  return { commands, compilations, provenance, presentation, linkerCommands: capturedLinkerCommands(log), ...(stateful ? { stateful } : {}) };
}

async function registerLiveBuildResultUnlocked(options) {
  const { runtime = {}, expectedProvenance } = options;
  const capture = inspectLiveBuildResult(options);
  if (expectedProvenance && registrationDigest(expectedProvenance) !== registrationDigest(capture.provenance)) throw registrationError("LIVE_CAPTURE_PROVENANCE_CHANGED", "The preserved app, result bundle, project inputs or Swift sources changed. No compiler map was published.");
  const control = runtime.engineControl || engineControl;
  const clock = runtime.now || (() => Date.now());
  const wait = runtime.wait || ((ms) => new Promise((done) => setTimeout(done, ms)));
  const handshake = await control({ action: "compilation_registration_status" }, { timeoutMs: 5_000 });
  const engine = handshake?.success ? handshake.data : null;
  if (engine?.compilation_registration_protocol !== 1 || typeof engine.engine_instance_nonce !== "string") throw registrationError("LIVE_ENGINE_REGISTRATION_UPDATE_REQUIRED", "The local engine needs transactional compiler registration before this preserved build can resume. No rebuild was started.");
  const payloadJSON = JSON.stringify(capture.commands);
  if (Buffer.byteLength(payloadJSON) > 4 * 1024 * 1024) throw registrationError("LIVE_CAPTURE_COMMANDS_TOO_LARGE", "The bounded compiler registration payload is too large.");
  const mapDigest = createHash("sha256").update(payloadJSON).digest("hex");
  const provenanceDigest = registrationDigest(capture.provenance);
  const engineNonce = engine.engine_instance_nonce;
  if (engine.pending_registration && (engine.pending_registration.map_digest !== mapDigest || engine.pending_registration.provenance_digest !== provenanceDigest)) throw registrationError("LIVE_REGISTRATION_BUSY", "Another compiler map is still pending in this engine generation. Wait for its receipt before resuming this preserved build.");
  const matchingOperation = engine.pending_registration || ((engine.current_registration?.map_digest === mapDigest && engine.current_registration?.provenance_digest === provenanceDigest) ? engine.current_registration : null);
  const transactionDigest = registrationDigest([engineNonce, mapDigest, provenanceDigest, engine.activation_generation || 0]);
  const generatedRequestId = `${transactionDigest.slice(0, 8)}-${transactionDigest.slice(8, 12)}-4${transactionDigest.slice(13, 16)}-a${transactionDigest.slice(17, 20)}-${transactionDigest.slice(20, 32)}`;
  const requestId = matchingOperation?.registration_id || generatedRequestId;
  const binding = { registration_id: requestId, map_digest: mapDigest, provenance_digest: provenanceDigest, expected_engine_nonce: engineNonce };
  const deadline = clock() + LIVE_COMPILER_REGISTRATION_BUDGET_MS;
  const submission = { action: "register_compilation_map", ...binding, payload_json: payloadJSON, expires_at_ms: deadline, command_count: capture.commands.length };
  if (Buffer.byteLength(JSON.stringify(submission)) > 8 * 1024 * 1024 - 1) throw registrationError("LIVE_CAPTURE_COMMANDS_TOO_LARGE", "The bounded compiler registration envelope is too large.");
  let response = await control(submission, { timeoutMs: LIVE_COMPILER_REGISTRATION_TIMEOUT_MS });
  let lastState = "unknown";
  while (true) {
    const receipt = response?.success ? response.data : null;
    if (receipt && (receipt.engine_instance_nonce !== engineNonce || receipt.registration_id !== requestId || receipt.map_digest !== mapDigest || receipt.provenance_digest !== provenanceDigest)) throw registrationError("LIVE_REGISTRATION_RECEIPT_MISMATCH", "The compiler map acknowledgement belongs to another engine or capture. No map was published.");
    if (receipt?.state === "committed") {
      if (receipt.current_registration_id !== requestId || receipt.command_count !== capture.commands.length || !Number.isSafeInteger(receipt.registered_count) || receipt.registered_count < 1 || !Array.isArray(receipt.sources)) throw registrationError("LIVE_REGISTRATION_RECEIPT_INVALID", "The compiler map acknowledgement is incomplete.");
      const current = inspectLiveBuildResult(options);
      if (registrationDigest(current.provenance) !== provenanceDigest) throw registrationError("LIVE_CAPTURE_PROVENANCE_CHANGED", "Build inputs changed while compiler registration completed. No map was published.");
      const finalResponse = await control({ action: "compilation_registration_status", ...binding }, { timeoutMs: 5_000 });
      const finalReceipt = finalResponse?.success ? finalResponse.data : null;
      if (!finalReceipt || finalReceipt.state !== "committed" || finalReceipt.current_registration_id !== requestId
        || finalReceipt.registration_id !== requestId || finalReceipt.map_digest !== mapDigest
        || finalReceipt.provenance_digest !== provenanceDigest || finalReceipt.engine_instance_nonce !== engineNonce) throw registrationError("LIVE_REGISTRATION_SUPERSEDED", "The registered compiler map changed before local publication. Resume the preserved capture; no compiler readiness is claimed.");
      const manifestPath = resolve(String(runtime.liveManifestPath || LIVE_MANIFEST));
      const sourceBaselines = Object.fromEntries(capture.provenance.sourceFiles.map((source) => [source.path, source.hash]));
      const fileStore = runtime.fileStore || new NodeAtomicFileStore();
      await fileStore.writeJSON(manifestPath, {
        version: 1, capturedAt: new Date(clock()).toISOString(), compilations: capture.compilations, presentation: capture.presentation,
        ...(capture.stateful ? { stateful: capture.stateful } : {}),
        compilerContextProtocol: 2,
        ...(capture.provenance.binaryIdentity ? { binaryIdentity: capture.provenance.binaryIdentity, sourceBaselines, binding: { projectPath: capture.provenance.projectPath, scheme: capture.provenance.scheme, projectRoot: projectRootFor(capture.provenance.projectPath) } } : {}),
        registration: { requestId, mapDigest, provenanceDigest, engineNonce, commandCount: receipt.command_count },
      }, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
      return { registered: receipt.registered_count, sources: [...new Set(receipt.sources)].sort(), provenance: capture.provenance, presentation: capture.presentation, registration: { requestId, mapDigest, provenanceDigest, engineNonce } };
    }
    if (receipt?.state === "superseded") throw registrationError("LIVE_REGISTRATION_SUPERSEDED", "Another compiler map replaced this registration. Resume the preserved capture to qualify a new activation.");
    if (receipt?.state === "failed" || receipt?.state === "cancelled") throw registrationError("LIVE_REGISTRATION_FAILED", `Transactional compiler registration ${receipt.state}; no compiler map was published.`);
    if (response?.success === false && response.error !== "COMPILATION_REGISTRATION_BUSY") throw registrationError("LIVE_REGISTRATION_REJECTED", `Transactional compiler registration was rejected: ${String(response.error || "unknown").slice(0, 160)}.`);
    lastState = receipt?.state || lastState;
    if (clock() >= deadline) throw registrationError("LIVE_REGISTRATION_PENDING", `Compiler registration remains ${lastState} after its bounded wait. Resume this preserved build to query the same operation; no rebuild or successful compiler readiness is claimed.`);
    await wait(250);
    response = await control({ action: "compilation_registration_status", ...binding }, { timeoutMs: Math.min(5_000, Math.max(1, deadline - clock())) });
  }
}

function registrationSourceFingerprint(path, { projectPath, resultBundle, allowedRoots }) {
  const stats = lstatSync(path);
  if (!stats.isSymbolicLink()) return registrationFileFingerprint(path, 16 * 1024 * 1024);
  const canonicalPath = realpathSync(path);
  const roots = [...allowedRoots, ...(projectPath ? [projectRootFor(projectPath)] : []), join(dirname(resultBundle), "DerivedData", "SourcePackages", "checkouts")];
  const inside = roots.some((root) => {
    if (!existsSync(root)) return false;
    const canonicalRoot = realpathSync(root);
    return canonicalPath.startsWith(`${canonicalRoot}/`) && resolve(path).startsWith(`${resolve(root)}/`);
  });
  if (!inside) throw registrationError("LIVE_CAPTURE_SOURCE_LINK_UNTRUSTED", "A Swift source link escapes its qualified project or package checkout.");
  return { ...registrationFileFingerprint(canonicalPath, 16 * 1024 * 1024), canonicalPath, linkTarget: readlinkSync(path), linkMtimeMs: stats.mtimeMs };
}

function registrationFileFingerprint(path, maximum) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > maximum) throw Object.assign(registrationError("LIVE_CAPTURE_INPUT_INVALID", "A preserved build input is missing, unsafe or oversized."), { inputPath: path, inputReason: stats.isSymbolicLink() ? "symlink" : !stats.isFile() ? "not-file" : "size", inputSize: stats.size });
  return { hash: createHash("sha256").update(readFileSync(path)).digest("hex"), size: stats.size, mtimeMs: stats.mtimeMs };
}
function registrationDigest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function registrationError(code, message) { return Object.assign(new Error(message), { code }); }

function readBuiltLiveIdentity(appPath) {
  const plist = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(appPath, "Info.plist")], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 10_000 });
  if (plist.status !== 0) throw new Error("The signed Debug app metadata could not be read.");
  const info = JSON.parse(plist.stdout);
  const executable = String(info.CFBundleExecutable || "");
  if (!executable || basename(executable) !== executable) throw new Error("The signed Debug app executable is invalid.");
  return normalizedLiveBinaryIdentity({
    bundle_id: String(info.CFBundleIdentifier || ""), bundle_version: String(info.CFBundleShortVersionString || ""), build_number: String(info.CFBundleVersion || ""),
    executable_uuid: machoUUID(readFileSync(join(appPath, executable))),
    debug_dylib_uuid: machoUUID(readFileSync(join(appPath, `${executable}.debug.dylib`))),
  });
}

export async function queuedLiveEngineControl(request, options = {}) {
  return engineControl(request, options);
}

export function prepareCompleteQueuedLivePatch(record, { artifactRoot = join(LIVE_ROOT, "queued-artifacts"), manifestPath = LIVE_MANIFEST,
  runner = new NodeCommandRunner({ spawn, spawnSync }), compiler, patchRoot = LIVE_PATCH_ROOT } = {}) {
  assertCompleteEditSet(record, { allowAdditive: true });
  const manifest = readJSONFile(manifestPath);
  const identity = normalizedLiveBinaryIdentity(manifest?.binaryIdentity);
  if (`${identity.executable_uuid}:${identity.debug_dylib_uuid}` !== record.scope.binaryIdentity) throw completeArtifactError();
  const contexts = record.files.map(file => manifest.compilations?.find(context => context.sources?.some(path => resolve(path) === resolve(file.path))));
  let reference = contexts.find(Boolean);
  if (!reference || contexts.some(context => context && (context.moduleName !== reference.moduleName
    || context.workingDirectory !== reference.workingDirectory || JSON.stringify(context.compilerArguments) !== JSON.stringify(reference.compilerArguments)))) throw completeArtifactError();
  const hasNewFiles = contexts.some(context => !context);
  const baselinesVerified = record.files.every((file, index) => contexts[index]
    ? typeof manifest.sourceBaselines?.[file.path] === "string" && createHash("sha256").update(file.installedBaseline ?? file.beforeSource).digest("hex") === manifest.sourceBaselines[file.path]
    : (file.installedBaseline ?? file.beforeSource) === "" && validNewSwiftPath(file.path, manifest, reference));
  if (!baselinesVerified && (hasNewFiles || record.files.some(file => file.installedBaseline !== undefined))) throw completeArtifactError();
  assertCompleteEditSet(record, { allowAdditive: baselinesVerified });
  const needsAdditive = baselinesVerified && (hasNewFiles || classifyEditSet({ files: record.files.map(file => ({ ...file, kind: "swift", status: "modified" })) }).route === "rebuild-required"
    || record.files.some(file => file.installedBaseline !== undefined && classifySwiftSource(file.installedBaseline, file.beforeSource).route === "rebuild-required"));
  const snapshots = needsAdditive ? additiveSnapshots(record.files, manifest).snapshots
    : record.files.map(file => ({ path: file.path, before: file.beforeSource, after: file.afterSource }));
  if (needsAdditive && manifest.compilerContextProtocol !== 2) throw registrationError("LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED", "The original compiler context needs its concurrency-aware metadata update. No patch was compiled.");
  const availableModules = needsAdditive ? availableAdditiveModules(reference, record.files) : [];
  const resourceDigest = compilerResourceDigest();
  const stateful = statefulBodyIndex(manifest.stateful, reference.moduleName);
  const componentInput = statefulCompilerOrigins(record, { artifactRoot, patchRoot, resourceDigest });
  const compilerContextDigest = createHash("sha256").update(JSON.stringify([reference.moduleName, reference.workingDirectory,
    reference.compilerArguments, manifest.compilerContextProtocol || 1, manifest.registration?.mapDigest || "", componentInput.digest, record.sequence ?? 0,
    record.files.map(file => [file.path, manifest.sourceBaselines?.[file.path] || "",
      createHash("sha256").update(JSON.stringify([file.beforeSource, file.afterSource, file.installedBaseline ?? file.beforeSource])).digest("hex")])])).digest("hex");
  const key = createHash("sha256").update(JSON.stringify(["complete-v3", record.requestId, record.snapshotDigest, record.scope.binaryIdentity, resourceDigest, stateful.digest, compilerContextDigest])).digest("hex");
  const path = join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`);
  const marker = `${path}.json`;
  ensureDirectoryModeSync(artifactRoot, 0o700);
  const fullCompiler = compiler || createFullCallableCompiler({ runner, cacheRoot: join(LIVE_ROOT, "compiler-cache") });
  const generationInput = { module: reference.moduleName, generation: key.slice(0, 32),
    statefulBodies: stateful.bodies, ...(Object.keys(stateful.constants).length ? { statefulConstants: stateful.constants } : {}),
    ...(baselinesVerified ? { preserveViewFunctions: true } : {}),
    ...(needsAdditive ? { allowAdditive: true, allowStatefulAdditive: true, allowAddedState: true, stateGeneration: record.sequence ?? 1, statefulOrigins: componentInput.descriptors, availableModules } : {}),
    files: snapshots };
  const generation = needsAdditive ? generateAdditive(fullCompiler, generationInput,
    () => sharedModuleSources(manifest, reference, snapshots, { queue: createLiveDeliveryQueue(), binaryIdentity: record.scope.binaryIdentity }))
    : fullCompiler.generate(generationInput);
  const addedStateMetadata = generation.addedStateProtocol === 1
    ? { addedStateProtocol: 1, addedStateGeneration: record.sequence } : {};
  if (generation.addedStateProtocol === 1 && (!Number.isSafeInteger(record.sequence) || record.sequence < 1
    || generation.addedStateGeneration !== record.sequence)) throw completeArtifactError();
  // Older helpers created the shared patch container as 0755. Tighten that
  // owned, non-writable container when first publishing private modules; never
  // weaken origin verification or follow a linked/foreign container.
  if (generation.statefulComponents?.length) {
    if (existsSync(patchRoot)) {
      const root = lstatSync(patchRoot);
      if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o022)
        || (process.getuid && root.uid !== process.getuid())) throw completeArtifactError();
    }
    ensureDirectoryModeSync(patchRoot, 0o700);
  }
  const refreshStrategy = generation.refreshStrategy || "remount";
  const moduleName = `SwiftSimLivePatch_${key}`;
  const directory = join(patchRoot, `queued_${key}`);
  const modulePath = join(directory, moduleName + ".swiftmodule");
  const metadata = artifactDigest => completeStatefulMetadata(generation, componentInput.origins,
    { record, moduleName, modulePath, artifactPath: path, artifactDigest, resourceDigest });
  const previous = existsSync(marker) ? readCompleteMarker(marker) : null;
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o077) !== 0
      || (process.getuid && stats.uid !== process.getuid()) || previous?.key !== key || previous.requestId !== record.requestId
      || previous.snapshotDigest !== record.snapshotDigest || previous.binaryIdentity !== record.scope.binaryIdentity || previous.resourceDigest !== resourceDigest
      || previous.refreshStrategy !== refreshStrategy || previous.statefulDigest !== stateful.digest) throw completeArtifactError();
    if (previous.artifactDigest !== createHash("sha256").update(readFileSync(path)).digest("hex")) throw completeArtifactError();
    const coverage = fullCompiler.inspectCoverage({ dylibPath: path, generation, moduleName });
    if (coverage.coverageDigest !== previous.coverageDigest) throw completeArtifactError();
    if ((previous.additiveProtocol || 0) !== (generation.additiveProtocol || 0) || Boolean(previous.sharedAdditive) !== Boolean(generation.sharedAdditive)) throw completeArtifactError();
    if (previous.compilerContextDigest !== compilerContextDigest) throw completeArtifactError();
    const stateMetadata = metadata(coverage.artifactDigest);
    validateStatefulMarker(previous, stateMetadata, record);
    validateAddedStateMarker(previous, addedStateMetadata, record);
    if (stateMetadata.statefulComponentProtocol === 1) verifyStatefulOrigins(stateMetadata.statefulOrigins, { scope: record.scope, artifactRoot, patchRoot, resourceDigest });
    return { ...completePrepared(path, coverage, resourceDigest, refreshStrategy, generation.additiveProtocol, compilerContextDigest, generation.sharedAdditive), ...addedStateMetadata, ...stateMetadata };
  }
  const volume = statfsSync(artifactRoot);
  const initialUsage = queuedArtifactUsage(artifactRoot, patchRoot);
  if (!Number.isFinite(initialUsage)) throw completeArtifactError();
  if (readdirSync(artifactRoot).length > 1024 || initialUsage > 120 * 1024 * 1024
    || Number(volume.bavail) * Number(volume.bsize) < 128 * 1024 * 1024) throw Object.assign(new Error("Insufficient bounded patch storage."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  ensureDirectoryModeSync(directory, 0o700);
  const owner = { version: 1, key, requestId: record.requestId, snapshotDigest: record.snapshotDigest,
    binaryIdentity: record.scope.binaryIdentity, expiresAt: record.expiresAt, resourceDigest, refreshStrategy, statefulDigest: stateful.digest,
    additiveProtocol: generation.additiveProtocol || 0, sharedAdditive: generation.sharedAdditive === true, ...addedStateMetadata };
  owner.compilerContextDigest = compilerContextDigest;
  if (generation.addedStateProtocol === 1) owner.processIdentity = record.scope.sessionIdentity;
  if (generation.statefulComponentProtocol === 1) Object.assign(owner, { statefulComponentProtocol: 1, processIdentity: record.scope.sessionIdentity });
  writeCompleteMarker(marker, owner);
  const paths = generation.sources.map((source, index) => {
    const generatedPath = join(directory, `Replacement${index}.swift`);
    if (existsSync(generatedPath)) assertCompleteFile(generatedPath);
    new NodeAtomicFileStore().writeTextSync(generatedPath, typeof source === "string" ? source : source.source,
      { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    return generatedPath;
  });
  const dylibPath = join(directory, `eval_injection_swift_sim_dynamic_queued_${key}.dylib`);
  if (existsSync(dylibPath)) { assertCompleteFile(dylibPath, false); rmSync(dylibPath); }
  if (generation.statefulComponents?.length) guardStatefulModuleOutputs(modulePath);
  const result = runner.runSync({ executable: "/usr/bin/xcrun", args: ["swiftc", "-emit-library", ...paths, "-module-name", moduleName,
    ...reference.compilerArguments, ...componentInput.importArguments,
    ...(generation.statefulComponents?.length ? ["-emit-module", "-emit-module-path", modulePath, "-enable-private-imports"] : []),
    ...(generation.requiresPrivateScopes ? [] : ["-Xfrontend", "-disable-access-control"]),
    "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup", "-o", dylibPath],
    cwd: reference.workingDirectory,
    environment: { inherit: ["HOME", "PATH", "TMPDIR", "DEVELOPER_DIR", "TOOLCHAINS"], overrides: {}, unset: ["SDKROOT"] },
    policy: { timeoutMs: 60_000, outputLimitBytes: 32 * 1024 * 1024, processGroup: "inherit", acceptedExitCodes: [0] } });
  if (result.code !== 0 || result.error || result.timedOut || !existsSync(dylibPath)) throw unsupportedReplacement();
  if (generation.statefulComponents?.length) privatizeStatefulModule(modulePath);
  const coverage = fullCompiler.inspectCoverage({ dylibPath, generation, moduleName });
  const size = statSync(dylibPath).size;
  if (size > 32 * 1024 * 1024 || queuedArtifactUsage(artifactRoot, patchRoot) + size + 1024 * 1024 > 128 * 1024 * 1024) {
    throw Object.assign(new Error("The complete patch exceeds its storage quota."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  }
  writeFileSync(path, readFileSync(dylibPath), { mode: 0o600, flag: "wx" });
  const stateMetadata = metadata(coverage.artifactDigest);
  writeCompleteMarker(marker, { ...owner, coverageDigest: coverage.coverageDigest, artifactDigest: coverage.artifactDigest,
    ...(stateMetadata.statefulComponentProtocol === 1 ? { statefulOriginsDigest: statefulOriginsDigest(stateMetadata.statefulOrigins) } : {}) });
  return { ...completePrepared(path, coverage, resourceDigest, refreshStrategy, generation.additiveProtocol, compilerContextDigest, generation.sharedAdditive), ...addedStateMetadata, ...stateMetadata };
}

function availableAdditiveModules(context, files) {
  const modules = new Set();
  const requested = new Set(files.flatMap(file => [...[file.beforeSource ?? file.before ?? "", file.afterSource ?? file.after ?? ""].join("\n").matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/gm)].map(match => match[1])));
  const args = context.compilerArguments || [];
  const sdk = args[args.indexOf("-sdk") + 1];
  if (typeof sdk === "string" && sdk.startsWith("/")) {
    if (!existsSync(sdk)) throw Object.assign(new Error("The captured Swift SDK is unavailable. Restore that compiler context before retrying."), { code: "FULL_CALLABLE_COMPILER_UNAVAILABLE" });
    for (const name of [...requested].slice(0, 128)) {
      if (existsSync(join(sdk, "System/Library/Frameworks", `${name}.framework`, "Modules"))) modules.add(name);
    }
  }
  return [...modules].sort().slice(0, 128);
}
function assertCompleteEditSet(record, { allowAdditive = record.preparedPatch?.additiveProtocol === 1 } = {}) {
  if (allowAdditive && Array.isArray(record.files) && record.files.length > 0 && record.files.length <= 32
    && record.files.every(file => typeof file.path === "string" && file.path.endsWith(".swift")
      && typeof file.beforeSource === "string" && typeof file.afterSource === "string"
      && Buffer.byteLength(file.beforeSource) <= 1024 * 1024 && Buffer.byteLength(file.afterSource) <= 1024 * 1024)) return;
  if (classifyEditSet({ files: record.files.map(file => ({ ...file, kind: "swift", status: "modified" })) }).route !== "hot-reload") {
    throw Object.assign(new Error("The queued snapshot changes compiled structure."), { code: "QUEUED_EDIT_NOT_COMPATIBLE" });
  }
}
function completePrepared(path, coverage, resourceDigest, refreshStrategy, additiveProtocol, compilerContextDigest, sharedAdditive) {
  const replacementProof = normalizeReplacementProof(coverage.replacementProof);
  return { path, mode: "swift-complete-replacement-bundle", replacementProof,
    coverageDigest: replacementCoverageDigest(replacementProof), compilerResourceDigest: resourceDigest, artifactDigest: coverage.artifactDigest, refreshStrategy,
    compilerContextDigest, ...(additiveProtocol === 1 ? { additiveProtocol: 1 } : {}), ...(sharedAdditive === true ? { sharedAdditive: true } : {}) };
}
function completeArtifactError() { return Object.assign(new Error("The complete patch artifact is not trusted."), { code: "PATCH_ARTIFACT_INVALID" }); }

export function validateCompleteQueuedLivePatchCoverage(record, { artifactRoot = join(LIVE_ROOT, "queued-artifacts"), patchRoot = LIVE_PATCH_ROOT } = {}) {
  assertCompleteEditSet(record);
  if (!/^[a-f0-9]{64}$/.test(record.snapshotDigest || "") || record.preparedPatch?.sourceSnapshotDigest !== record.snapshotDigest
    || record.preparedPatch.compilerResourceDigest !== compilerResourceDigest()
    || record.preparedPatch.coverageDigest !== replacementCoverageDigest(record.preparedPatch.replacementProof)) throw completeArtifactError();
  const path = record.preparedPatch.path;
  assertCompleteFile(path);
  const marker = readCompleteMarker(`${path}.json`);
  validateStatefulMarker(marker, record.preparedPatch, record);
  validateAddedStateMarker(marker, record.preparedPatch, record);
  if (record.preparedPatch.statefulComponentProtocol === 1) verifyStatefulOrigins(record.preparedPatch.statefulOrigins,
    { scope: record.scope, artifactRoot, patchRoot, resourceDigest: record.preparedPatch.compilerResourceDigest });
  if (marker.requestId !== record.requestId || marker.snapshotDigest !== record.snapshotDigest || marker.binaryIdentity !== record.scope.binaryIdentity
    || (marker.additiveProtocol || 0) !== (record.preparedPatch.additiveProtocol || 0)
    || Boolean(marker.sharedAdditive) !== Boolean(record.preparedPatch.sharedAdditive)
    || !/^[a-f0-9]{64}$/.test(record.preparedPatch.compilerContextDigest || "") || marker.compilerContextDigest !== record.preparedPatch.compilerContextDigest
    || marker.resourceDigest !== record.preparedPatch.compilerResourceDigest || marker.coverageDigest !== record.preparedPatch.coverageDigest
    || (marker.refreshStrategy || "remount") !== (record.preparedPatch.refreshStrategy || "remount")
    || marker.artifactDigest !== record.preparedPatch.patchDigest
    || createHash("sha256").update(readFileSync(path)).digest("hex") !== marker.artifactDigest) throw completeArtifactError();
}

export function sealCompleteQueuedLivePatch(record, raw, signedDigest) {
  assertCompleteFile(raw.path);
  const marker = readCompleteMarker(`${raw.path}.json`);
  validateStatefulMarker(marker, raw, record);
  validateAddedStateMarker(marker, raw, record);
  if (marker.requestId !== record.requestId || marker.snapshotDigest !== record.snapshotDigest || marker.binaryIdentity !== record.scope.binaryIdentity || marker.artifactDigest !== raw.artifactDigest
    || marker.compilerContextDigest !== raw.compilerContextDigest
    || marker.coverageDigest !== raw.coverageDigest || marker.resourceDigest !== raw.compilerResourceDigest
    || (marker.refreshStrategy || "remount") !== (raw.refreshStrategy || "remount")
    || !/^[a-f0-9]{64}$/.test(signedDigest) || createHash("sha256").update(readFileSync(raw.path)).digest("hex") !== signedDigest) throw completeArtifactError();
  const stateMetadata = signedStatefulMetadata(raw, record, signedDigest);
  writeCompleteMarker(`${raw.path}.json`, { ...marker, unsignedArtifactDigest: marker.unsignedArtifactDigest || raw.artifactDigest, artifactDigest: signedDigest,
    ...(stateMetadata.statefulComponentProtocol === 1 ? { statefulOriginsDigest: statefulOriginsDigest(stateMetadata.statefulOrigins) } : {}) });
  return stateMetadata;
}
function validateAddedStateMarker(marker, patch, record) {
  if ((marker.addedStateProtocol || 0) !== (patch.addedStateProtocol || 0)
    || (patch.addedStateProtocol !== undefined && patch.addedStateProtocol !== 1)
    || (patch.addedStateProtocol === 1 && (!Number.isSafeInteger(record.sequence) || record.sequence < 1
      || marker.addedStateGeneration !== record.sequence || patch.addedStateGeneration !== record.sequence
      || marker.processIdentity !== record.scope.sessionIdentity))
    || (patch.addedStateProtocol !== 1 && (patch.addedStateGeneration !== undefined || marker.addedStateGeneration !== undefined))) throw completeArtifactError();
}
function assertCompleteFile(path, ownerOnly = true) {
  const stats = lstatSync(path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (ownerOnly && (stats.mode & 0o077))
    || (process.getuid && stats.uid !== process.getuid())) throw completeArtifactError();
  return stats;
}
function readCompleteMarker(path) {
  if (assertCompleteFile(path).size > 16_384) throw completeArtifactError();
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw completeArtifactError(); }
}
function writeCompleteMarker(path, value) {
  if (existsSync(path)) assertCompleteFile(path);
  if (Buffer.byteLength(JSON.stringify(value)) > 16_384) throw completeArtifactError();
  new NodeAtomicFileStore().writeJSONSync(path, value, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
}

function queuedArtifactUsage(root, patchRoot = LIVE_PATCH_ROOT) {
  let bytes = 0;
  for (const name of readdirSync(root).slice(0, 1025)) {
    const stats = lstatSync(join(root, name));
    if (stats.isFile() && !stats.isSymbolicLink()) bytes += stats.size;
  }
  if (existsSync(patchRoot)) {
    const directories = readdirSync(patchRoot).filter((name) => /^queued_[a-f0-9]{64}$/.test(name));
    if (directories.length > 1024) return Infinity;
    for (const directory of directories) {
      const path = join(patchRoot, directory);
      if (lstatSync(path).isSymbolicLink()) return Infinity;
      const names = readdirSync(path);
      if (names.length > 64) return Infinity;
      for (const name of names) {
        const file = join(path, name);
        if (existsSync(file)) { const stats = lstatSync(file); if (stats.isSymbolicLink() || !stats.isFile()) return Infinity; bytes += stats.size; }
      }
    }
  }
  return bytes;
}

export function cleanupQueuedLiveArtifacts(records, { artifactRoot = join(LIVE_ROOT, "queued-artifacts"), patchRoot = LIVE_PATCH_ROOT, statefulOrigins = [], now = Date.now() } = {}) {
  if (!existsSync(artifactRoot)) return;
  const root = lstatSync(artifactRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077) !== 0) return;
  const retained = new Set([...records.filter((record) => record.expiresAt > now).map((record) => record.requestId),
    ...statefulOrigins.map(origin => origin.requestId),
    ...records.filter(record => record.expiresAt > now || ["applying", "applied", "uncertain"].includes(record.state)).flatMap(record => record.preparedPatch?.statefulOrigins || []).map(origin => origin.requestId)]);
  for (const name of readdirSync(artifactRoot).slice(0, 1024)) {
    if (!/^eval_injection_swift_sim_dynamic_[a-f0-9]{64}\.dylib\.json$/.test(name)) continue;
    const markerPath = join(artifactRoot, name); const stats = lstatSync(markerPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 16_384 || (stats.mode & 0o077) !== 0) continue;
    const marker = readJSONFile(markerPath);
    if (marker?.version !== 1 || !/^[a-f0-9]{64}$/.test(marker.key) || name !== `eval_injection_swift_sim_dynamic_${marker.key}.dylib.json`
      || retained.has(marker.requestId) || !Number.isSafeInteger(marker.expiresAt) || marker.expiresAt > now) continue;
    const path = markerPath.slice(0, -5);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) continue;
    rmSync(path, { force: true });
    // The compilation path is derived, never trusted from marker text.
    const compilation = join(patchRoot, `queued_${marker.key}`);
    if (existsSync(compilation) && !lstatSync(compilation).isSymbolicLink()) rmSync(compilation, { recursive: true, force: true });
    rmSync(markerPath, { force: true });
  }
}

export async function prepareQueuedLivePatchAsync(record, { cancellationSignal } = {}) {
  const runner = new NodeCommandRunner({ spawn, spawnSync });
  const result = await runner.run({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../bin/swift-sim-live-prepare.js", import.meta.url))],
    input: Buffer.from(JSON.stringify(record)),
    ...(cancellationSignal ? { cancellationSignal } : {}),
    environment: { inherit: ["HOME", "PATH", "TMPDIR", "DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"], overrides: {}, unset: [] },
    policy: { timeoutMs: 150_000, outputLimitBytes: 1024 * 1024, processGroup: "new", acceptedExitCodes: [0] },
  });
  if (result.code !== 0 || result.timedOut || result.cancellationError) {
    let failure;
    try { failure = JSON.parse(result.stderr.trim()); } catch {}
    const allowed = ["QUEUED_MECHANISM_UNSUPPORTED", "QUEUED_EDIT_NOT_COMPATIBLE", "PATCH_STORAGE_INSUFFICIENT", "PATCH_ARTIFACT_INVALID", "LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED", "LIVE_STATEFUL_ORIGIN_INVALID", "LIVE_CLIENT_UPDATE_REQUIRED"];
    const code = !result.timedOut && !result.cancellationError && allowed.includes(failure?.code) ? failure.code : "PATCH_COMPILE_FAILED";
    throw Object.assign(new Error("The queued replacement could not be prepared. No patch was applied or app rebuild started."), { code });
  }
  try { return JSON.parse(result.stdout); } catch { throw Object.assign(new Error("The queued compiler returned an invalid result."), { code: "PATCH_COMPILE_FAILED" }); }
}

function readXcodeBuildLog(path) {
  const result = spawnSync(
    "xcrun",
    ["xcresulttool", "get", "log", "--path", path, "--type", "build", "--compact"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 60_000 }
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || "Unable to read the Xcode build log.").trim());
  }
  return JSON.parse(result.stdout);
}

function dynamicReplacementContext(command) {
  const args = command.arguments || [];
  const moduleName = argumentValue(args, "-module-name");
  const sdk = argumentValue(args, "-sdk");
  const target = argumentValue(args, "-target");
  if (!moduleName || !sdk || !target) return null;

  const sources = args
    .filter((value) => value.endsWith(".swift") && existsSync(resolveFrom(command.working_directory, value)))
    .map((value) => resolveFrom(command.working_directory, value));
  if (sources.length === 0) return null;

  const compilerArguments = ["-sdk", sdk, "-target", target];
  const valueFlags = new Set([
    "-I", "-F", "-Fsystem", "-L", "-D", "-swift-version", "-module-cache-path", "-resource-dir",
    "-enable-upcoming-feature", "-enable-experimental-feature",
    "-default-isolation", "-strict-concurrency", "-package-name", "-module-alias",
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (valueFlags.has(value) && args[index + 1]) {
      compilerArguments.push(value, args[index + 1]);
      index += 1;
      continue;
    }
    if (value === "-Xcc" && args[index + 1]) {
      const clangArgument = args[index + 1];
      if (/^(?:-fmodule-map-file=|-I|-F|-isystem)/.test(clangArgument)) {
        compilerArguments.push(value, clangArgument);
      }
      index += 1;
    }
    const joined = value.match(/^-(default-isolation|package-name|module-alias)=(.+)$/);
    if (joined) compilerArguments.push(`-${joined[1]}`, joined[2]);
    if (/^-strict-concurrency=(?:minimal|targeted|complete)$/.test(value)
      || ["-enable-actor-data-race-checks", "-warn-concurrency", "-application-extension", "-enable-library-evolution", "-enable-bare-slash-regex"].includes(value)) compilerArguments.push(value);
    if (["-enable-anonymous-context-mangled-names", "-disable-clang-spi"].includes(value)) compilerArguments.push("-Xfrontend", value);
  }
  return {
    moduleName,
    sources,
    workingDirectory: command.working_directory || "",
    compilerArguments,
  };
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || "" : "";
}

function resolveFrom(workingDirectory, path) {
  return resolve(workingDirectory || process.cwd(), path);
}

// Explicit recovery only. An unreachable running process is not an absent engine.
export function assertStoppedLiveEngineForRecovery({ readRecord = readPublishedLiveEngineRecord, identity = kernelProcessIdentity } = {}) {
  try {
    const record = readRecord();
    if (!record || !Number.isInteger(record.pid) || record.pid < 2 || identity(record.pid))
      throw Object.assign(new Error("The existing engine cannot be replaced by recovery."), { code: "RECOVERY_ENGINE_ACTIVE" });
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

export async function startLiveReload(options = {}) {
  return withLiveEngineLifecycleLock(() => startLiveReloadUnlocked(options));
}

async function startLiveReloadUnlocked({ project = "", host = "", scheme = "", forceRestart = false } = {}) {
  await ensureLiveEngineInstalledUnlocked();
  let status = await inspectLiveReloadUnlocked({ project, host, scheme });
  if (!status.project.readable) {
    return {
      ...status,
      started: false,
      error: "Pass the path to an .xcodeproj/project.pbxproj or .xcworkspace/contents.xcworkspacedata file.",
    };
  }
  if (status.project.schemeError) {
    return { ...status, started: false, error: status.project.schemeError };
  }
  if (!status.host) {
    return { ...status, started: false, error: "Connect this Mac to Tailscale first." };
  }
  if (!status.project.packageConfigured) {
    return {
      ...status,
      started: false,
      error: "The project needs the SwiftSimLive package and one .swiftSimLive() modifier at its root view.",
    };
  }

  const tailnet = discoverTailnet();
  if (tailnet.socket) ensurePrivateTailnetForward(tailnet);
  let signingIdentities;
  try {
    signingIdentities = resolveSigningIdentities(status.project.path, status.project.scheme);
  } catch (error) {
    return {
      ...status,
      started: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (signingIdentities.length === 0) {
    return {
      ...status,
      started: false,
      error: "No matching Apple Development signing identity was found.",
    };
  }
  let signingIdentity = "";
  let signing = { ready: false, error: "" };
  for (const candidate of signingIdentities) {
    const result = verifySigningIdentity(candidate);
    if (result.ready) {
      signingIdentity = candidate;
      signing = result;
      break;
    }
    signing = result;
  }
  if (!signingIdentity) {
    return {
      ...status,
      started: false,
      error: signing.error,
    };
  }

  const running = await engineControl({ action: "status" });
  const session = readJSONFile(ENGINE_SESSION);
  const alreadyWatching = !forceRestart
    && running?.success
    && running.data?.watching_directories?.some(
      (path) => resolve(path) === status.project.root
    )
    && running.data?.codesigning_identity_configured
    && String(session?.nonce || "")
    && liveEngineSessionMatches(session, {
      projectRoot: status.project.root,
      scheme: status.project.scheme,
    })
    && session?.signingIdentity === signingIdentity;
  if (!alreadyWatching) {
    await stopLiveEngine();
    mkdirSync(LIVE_ROOT, { recursive: true });
    if (existsSync(ENGINE_LOG) && statSync(ENGINE_LOG).size > 8 * 1024 * 1024) {
      truncateSync(ENGINE_LOG, 0);
    }
    const output = openSync(ENGINE_LOG, "a");
    let child;
    let prepublicationError = null;
    try {
      child = spawn(ENGINE_EXECUTABLE, [], {
        detached: true,
        stdio: ["ignore", output, output],
        env: {
          ...process.env,
          SWIFT_SIM_ENGINE: "1",
          SWIFT_SIM_ENGINE_SOCKET: ENGINE_SOCKET,
          SWIFT_SIM_PROJECT_ROOT: status.project.root,
          SWIFT_SIM_CODESIGN_IDENTITY: signingIdentity,
        },
      });
      await waitForChildSpawn(child);
    } catch (error) {
      prepublicationError = error;
    }
    try {
      closeSync(output);
    } catch (error) {
      prepublicationError ||= error;
    }
    if (prepublicationError) {
      if (child?.pid) {
        try { abortPendingLiveEngine(child.pid); } catch {}
      }
      throw prepublicationError;
    }
    try {
      writeFileSync(ENGINE_PID, `${child.pid}\n`, { mode: 0o600 });
    } catch (error) {
      // The ownership boundary normally performs this rollback.
      // This also covers errors before the guarded write consumes
      // the verified pending process record.
      if (child?.pid) {
        try { abortPendingLiveEngine(child.pid); } catch {}
      }
      throw error;
    }
    const sessionNonce = randomUUID();
    try {
      writeFileSync(ENGINE_SESSION, `${JSON.stringify({
        projectRoot: status.project.root,
        scheme: status.project.scheme,
        signingIdentity,
        engineVersion: ENGINE_VERSION,
        nonce: sessionNonce,
      }, null, 2)}\n`, { mode: 0o600 });
    } catch (error) {
      // The durable PID record now authorizes an exact identity-checked stop.
      // Roll back the engine rather than leaving a process whose session was
      // never published and which future starts cannot safely reuse.
      await stopLiveEngine();
      throw error;
    }
    child.unref();
  }

  let control = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    control = await engineControl({ action: "status" });
    if (control?.success) break;
    await delay(250);
  }
  if (control?.success && !alreadyWatching) {
    await primeEngineWatcher(status.project.root);
  }
  status = await inspectLiveReloadUnlocked({ project, host, scheme });
  return {
    ...status,
    started: Boolean(control?.success),
    error: control?.success ? "" : `The live engine did not start. Check ${ENGINE_LOG}.`,
    message: status.engine.connected
      ? "Live patching is connected."
      : "The engine is ready. Launch the live-enabled Debug app on the iPhone to connect.",
  };
}

// Full-build qualification only; never runs in the warm edit path.
function capturedLinkerCommands(value, output = []) {
  if (Array.isArray(value)) { for (const item of value) capturedLinkerCommands(item, output); return output; }
  if (!value || typeof value !== "object") return output;
  if (typeof value.emittedOutput === "string") for (const line of value.emittedOutput.split(/\r?\n/)) {
    if (!line.includes("-interposable")) continue;
    const tokens = splitShellCommand(line.trim());
    if (/(?:^|\/)(?:clang|clang\+\+|ld)$/.test(tokens[0] || "")) output.push(tokens);
  }
  for (const nested of Object.values(value)) capturedLinkerCommands(nested, output);
  return output;
}

function frontendCommandLines(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) frontendCommandLines(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  if (typeof value.emittedOutput === "string") {
    for (const line of value.emittedOutput.split(/\r?\n/)) {
      if (line.includes("/swift-frontend -frontend -c ")) output.push(line.trim());
    }
  }
  for (const nested of Object.values(value)) frontendCommandLines(nested, output);
  return output;
}

function splitShellCommand(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;
  for (const character of String(command)) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else token += character;
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (escaped) token += "\\";
  if (token) tokens.push(token);
  return tokens;
}

function frontendWorkingDirectory(argumentsList) {
  const direct = argumentsList.indexOf("-file-compilation-dir");
  if (direct >= 0) return argumentsList[direct + 1] || "";
  for (let index = 0; index < argumentsList.length - 3; index += 1) {
    if (
      argumentsList[index] === "-Xcc"
      && argumentsList[index + 1] === "-working-directory"
      && argumentsList[index + 2] === "-Xcc"
    ) {
      return argumentsList[index + 3] || "";
    }
  }
  return "";
}

async function primeEngineWatcher(projectRoot) {
  const path = join(projectRoot, `.swift-sim-watcher-${process.pid}`);
  try {
    writeFileSync(path, "prime\n", { mode: 0o600 });
    await delay(350);
    writeFileSync(path, "ready\n", { mode: 0o600 });
    await delay(200);
  } finally {
    rmSync(path, { force: true });
  }
}

function verifySigningIdentity(identity) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-signing-"));
  const executable = join(directory, "signing-probe");
  try {
    copyFileSync(ENGINE_EXECUTABLE, executable);
    const result = spawnSync(
      "/usr/bin/codesign",
      ["--force", "--timestamp=none", "--sign", identity, executable],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }
    );
    if (result.status === 0) return { ready: true, error: "" };
    const detail = result.error?.code === "ETIMEDOUT"
      ? "macOS did not grant private-key access within 10 seconds."
      : String(result.stderr || result.stdout || "The signing probe failed.").trim();
    return {
      ready: false,
      error: `The matching Apple Development identity cannot sign a live patch noninteractively. ${detail} Open the app once from Xcode and choose Always Allow if macOS asks for key access.`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function unsupportedReplacement() {
  return Object.assign(new Error("The current live compiler cannot represent every changed implementation in one complete replacement. No patch was applied."), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function installedEngineMatchesManifest() {
  if (LOCAL_ENGINE_CANDIDATE.error) return false;
  if (!existsSync(ENGINE_EXECUTABLE) || !existsSync(ENGINE_MANIFEST)) return false;
  try {
    const manifest = JSON.parse(readFileSync(ENGINE_MANIFEST, "utf8"));
    return manifest.version === ENGINE_VERSION && manifest.sha256 === ENGINE_SHA256;
  } catch {
    return false;
  }
}

function readJSONFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function liveEngineSessionMatches(session, {
  projectRoot = "",
  scheme = "",
  expectedEngineVersion = ENGINE_VERSION,
} = {}) {
  return Boolean(
    session
    && String(session.projectRoot || "") === String(projectRoot || "")
    && String(session.scheme || "") === String(scheme || "")
    && session.engineVersion === expectedEngineVersion
  );
}

function projectRootFor(projectPath) {
  if (!projectPath) return "";
  const absolute = resolve(projectPath);
  if (absolute.endsWith("/project.pbxproj") || absolute.endsWith("/contents.xcworkspacedata")) {
    return dirname(dirname(absolute));
  }
  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) return dirname(absolute);
  return dirname(absolute);
}

function liveProjectConfiguration(projectPath, scheme = "") {
  if (!projectPath || !existsSync(projectPath)) {
    return { source: "", packageConfigured: false, interposableConfigured: false, applicationTarget: "" };
  }
  const source = readFileSync(projectPath, "utf8");
  if (!isXcodeContainerProjectPath(projectPath)) {
    return {
      source,
      packageConfigured: /SwiftSimLive|github\.com\/Miguelosaurus\/InjectionNext/i.test(source),
      interposableConfigured: /-interposable/.test(source),
      applicationTarget: "",
    };
  }

  const selected = selectedXcodeApplicationTarget(projectPath, scheme);
  if (!selected) {
    return { source, packageConfigured: false, interposableConfigured: false, applicationTarget: "" };
  }
  return {
    source: selected.source,
    packageConfigured: selectedTargetHasLivePackage(selected.source, selected.targetName),
    interposableConfigured: /(?:^|\s)-interposable(?:\s|$)/.test(
      String(selected.settings.OTHER_LDFLAGS || ""),
    ),
    applicationTarget: selected.targetName,
  };
}

export function selectedXcodeApplicationTarget(projectPath, scheme) {
  if (!scheme) return null;
  const settingsResult = spawnSync(
    "xcodebuild",
    [...xcodeContainerArguments(projectPath, scheme), "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (settingsResult.status !== 0 || settingsResult.error) return null;

  let settings;
  try {
    settings = selectLiveApplicationBuildSettings(settingsResult.stdout || "", scheme);
  } catch {
    return null;
  }
  return liveProjectTargetFromSettings(projectPath, settings);
}

// Signed builds already read their resolved application settings. Reuse that
// authority instead of resolving packages again through a short sync preflight.
export function liveProjectTargetFromSettings(projectPath, settings) {
  const targetName = String(settings?.TARGET_NAME || "").trim();
  const projectFile = normalizedProjectDefinitionPath(settings?.PROJECT_FILE_PATH, projectPath);
  if (!targetName || !projectFile || !existsSync(projectFile)) return null;
  return {
    targetName,
    settings,
    source: readFileSync(projectFile, "utf8"),
  };
}

function normalizedProjectDefinitionPath(value, containerPath) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const absolute = candidate.startsWith("/")
    ? resolve(candidate)
    : resolve(projectRootFor(containerPath), candidate);
  if (absolute.endsWith("/project.pbxproj")) return absolute;
  if (absolute.endsWith(".xcodeproj")) return join(absolute, "project.pbxproj");
  return "";
}

export function selectedTargetHasLivePackage(projectSource, targetName) {
  const source = String(projectSource || "");
  const expectedTarget = String(targetName || "").trim();
  if (!source || !expectedTarget) return false;
  const sectionMatch = source.match(
    /\/\* Begin PBXNativeTarget section \*\/([\s\S]*?)\/\* End PBXNativeTarget section \*\//,
  );
  if (!sectionMatch) return false;
  const section = sectionMatch[1];
  const sectionOffset = sectionMatch.index + sectionMatch[0].indexOf(section);
  for (const entry of section.matchAll(/^\s*([A-Fa-f0-9]{24})(?:\s+\/\*.*?\*\/)?\s*=\s*\{/gm)) {
    const absoluteEntry = sectionOffset + entry.index;
    const open = source.indexOf("{", absoluteEntry);
    const close = matchingBrace(source, open);
    if (open < 0 || close < 0) continue;
    const body = source.slice(open + 1, close);
    if (pbxScalar(body, "name") !== expectedTarget) continue;
    const dependencies = body.match(/\bpackageProductDependencies\s*=\s*\(([\s\S]*?)\);/)?.[1] || "";
    if (!dependencies) return false;
    const productIds = [...dependencies.matchAll(/\b([A-Fa-f0-9]{24})\b/g)]
      .map((match) => match[1]);
    return productIds.some((identifier) => {
      const productBody = pbxObjectBody(source, identifier);
      return /\bXCSwiftPackageProductDependency\b/.test(productBody)
        && pbxScalar(productBody, "productName") === "SwiftSimLive";
    });
  }
  return false;
}

function pbxObjectBody(source, identifier) {
  const entry = new RegExp(
    `^\\s*${escapeRegExp(identifier)}(?:\\s+\\/\\*.*?\\*\\/)?\\s*=\\s*\\{`,
    "m",
  ).exec(source);
  if (!entry) return "";
  const open = source.indexOf("{", entry.index);
  const close = matchingBrace(source, open);
  return open >= 0 && close >= 0 ? source.slice(open + 1, close) : "";
}

function pbxScalar(body, key) {
  const match = String(body || "").match(
    new RegExp(`\\b${escapeRegExp(key)}\\s*=\\s*(?:"((?:\\\\.|[^"\\\\])*)"|([^;]+));`),
  );
  return String(match?.[1] ?? match?.[2] ?? "")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .trim();
}

function listedLiveSchemes(projectPath) {
  const result = spawnSync(
    "xcodebuild",
    [...xcodeContainerArguments(projectPath), "-list", "-json"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) return [];
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return payload.workspace?.schemes || payload.project?.schemes || [];
  } catch {
    return [];
  }
}

function isXcodeContainerProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/project.pbxproj")
    || value.endsWith(".xcodeproj")
    || value.endsWith("/contents.xcworkspacedata")
    || value.endsWith(".xcworkspace");
}

function isWorkspaceProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/contents.xcworkspacedata") || value.endsWith(".xcworkspace");
}

function decodeXMLAttribute(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

async function engineControl(request, { timeoutMs = LIVE_ENGINE_CONTROL_TIMEOUT_MS, socketPath = ENGINE_SOCKET } = {}) {
  if (!existsSync(socketPath)) return null;
  return new Promise((resolveRequest) => {
    const socket = createConnection({ path: socketPath });
    let response = "";
    let responseBytes = 0;
    let settled = false;
    let absoluteDeadline;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(absoluteDeadline);
      socket.destroy();
      resolveRequest(value);
    };
    socket.setEncoding("utf8");
    absoluteDeadline = setTimeout(() => finish(null), Math.max(1, Number(timeoutMs) || LIVE_ENGINE_CONTROL_TIMEOUT_MS));
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      responseBytes += Buffer.byteLength(chunk);
      if (responseBytes > 32 * 1024 * 1024) return finish(null);
      response += chunk;
      if (!response.includes("\n")) return;
      try {
        finish(JSON.parse(response.split("\n")[0]));
      } catch {
        finish(null);
      }
    });
    socket.on("timeout", () => finish(null));
    socket.on("error", () => finish(null));
    socket.on("end", () => {
      if (!settled) {
        try {
          finish(JSON.parse(response.trim()));
        } catch {
          finish(null);
        }
      }
    });
  });
}

export async function stopLiveEngine({ pidPath = ENGINE_PID, sessionPath = ENGINE_SESSION,
  socketPath = ENGINE_SOCKET, stop = stopLiveEngineProcess,
  readRecord = readPublishedLiveEngineRecord, identity = kernelProcessIdentity,
  probe = (pid) => process.kill(pid, 0) } = {}) {
  if (existsSync(pidPath)) {
    // The installed entrypoint's ownership boundary validates the durable JSON
    // record and exposes its numeric PID. Direct module callers must not treat
    // an unparsed/rejected record as an absent process and orphan its listener.
    const raw = readFileSync(pidPath, "utf8").trim();
    const pid = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(pid) || pid <= 1) {
      // The ownership boundary hides an exited JSON record's numeric PID.
      // Reboot cleanup needs proof of absence, never permission to signal it.
      let absent = false;
      try {
        const record = readRecord(pidPath);
        if (record && Number.isSafeInteger(record.pid) && record.pid > 1 && !identity(record.pid)) {
          try { probe(record.pid); } catch (error) { absent = error.code === "ESRCH"; }
          if (absent) absent = await new Promise((done) => {
            const socket = createConnection(socketPath);
            const finish = (value) => { socket.destroy(); done(value); };
            socket.setTimeout(500);
            socket.once("connect", () => finish(false));
            socket.once("timeout", () => finish(false));
            socket.once("error", (error) => finish(["ENOENT", "ECONNREFUSED"].includes(error.code)));
          });
          if (absent) {
            absent = JSON.stringify(readRecord(pidPath)) === JSON.stringify(record) && !identity(record.pid);
            try { probe(record.pid); absent = false; } catch (error) { absent &&= error.code === "ESRCH"; }
          }
        }
      } catch { absent = false; }
      if (!absent) throw Object.assign(new Error("Live engine ownership could not be confirmed. Use the Swift Sim entrypoint; existing engine records and listeners were preserved."),
        { code: "LIVE_ENGINE_OWNERSHIP_UNCONFIRMED" });
    } else await stop(pid);
  }
  rmSync(pidPath, { force: true });
  rmSync(sessionPath, { force: true });
  rmSync(socketPath, { force: true });
}

export async function stopLiveEngineProcess(pid, { kill = (target, signal) => process.kill(target, signal), wait = delay,
  now = () => Date.now(), timeoutMs = 2_000 } = {}) {
  try { kill(pid, "SIGTERM"); }
  catch (error) { if (error?.code === "ESRCH") return; throw error; }
  const deadline = now() + timeoutMs;
  while (true) {
    try { kill(pid, 0); }
    catch (error) { if (error?.code === "ESRCH") return; throw error; }
    if (now() >= deadline) throw Object.assign(new Error("The prior live engine has not exited. Its ownership records and installation were preserved; no replacement engine was started."), { code: "LIVE_ENGINE_STOP_UNCONFIRMED" });
    await wait(50);
  }
}

export function xcodeContainerArguments(projectPath, scheme = "") {
  const sourcePath = resolve(String(projectPath || ""));
  const projectContainer = sourcePath.endsWith("/project.pbxproj")
    ? dirname(sourcePath)
    : sourcePath.endsWith("/contents.xcworkspacedata")
      ? dirname(sourcePath)
      : sourcePath;
  const argumentsList = [
    projectContainer.endsWith(".xcworkspace") ? "-workspace" : "-project",
    projectContainer,
  ];
  if (String(scheme || "").trim()) argumentsList.push("-scheme", String(scheme).trim());
  return argumentsList;
}

export function workspaceProjectReferences(workspaceSource, projectPath) {
  if (!isWorkspaceProjectPath(projectPath)) return [];
  const workspaceDirectory = dirname(resolve(String(projectPath)));
  const workspaceRoot = dirname(workspaceDirectory);
  const references = [];
  for (const match of String(workspaceSource || "").matchAll(/location\s*=\s*"([^"]+\.xcodeproj)"/g)) {
    const decoded = decodeXMLAttribute(match[1]);
    const separator = decoded.indexOf(":");
    const kind = separator >= 0 ? decoded.slice(0, separator) : "group";
    const value = separator >= 0 ? decoded.slice(separator + 1) : decoded;
    let container;
    if (kind === "absolute") container = resolve(value);
    else if (kind === "self") container = resolve(workspaceDirectory, value);
    else container = resolve(workspaceRoot, value);
    const projectFile = container.endsWith("/project.pbxproj")
      ? container
      : join(container, "project.pbxproj");
    if (!references.includes(projectFile)) references.push(projectFile);
  }
  return references;
}

export function selectLiveScheme(projectPath, requestedScheme = "", availableSchemes = []) {
  const requested = String(requestedScheme || "").trim();
  const available = [...new Set((availableSchemes || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!isXcodeContainerProjectPath(projectPath)) {
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
  if (requested) {
    if (available.length > 0 && !available.includes(requested)) {
      return {
        scheme: "",
        availableSchemes: available,
        required: true,
        error: `The Xcode project or workspace does not contain the '${requested}' scheme. Choose one of: ${available.join(", ")}.`,
      };
    }
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
  if (available.length === 1) {
    return { scheme: available[0], availableSchemes: available, required: false, error: "" };
  }
  return {
    scheme: "",
    availableSchemes: available,
    required: true,
    error: available.length > 1
      ? `This Xcode project or workspace has multiple schemes. Pass --scheme with one of: ${available.join(", ")}.`
      : "Swift Sim could not discover a shared scheme for this Xcode project or workspace. Pass --scheme explicitly.",
  };
}

export function selectLiveApplicationBuildSettings(output, scheme = "") {
  const collector = { sections: [], current: null, loose: {} };
  for (const line of String(output || "").split(/\r?\n/)) {
    const header = line.match(/^Build settings for action .* and target (.+):\s*$/);
    if (header) {
      const section = { target: header[1].trim(), settings: {} };
      collector.sections.push(section);
      collector.current = section;
      continue;
    }
    const setting = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!setting) continue;
    const destination = collector.current?.settings || collector.loose;
    destination[setting[1]] = setting[2].trim();
  }

  const normalizedScheme = String(scheme || "").trim();
  const candidates = collector.sections.filter(({ settings }) => {
    const productType = String(settings.PRODUCT_TYPE || "");
    return settings.WRAPPER_EXTENSION === "app"
      && !productType.includes("app-extension")
      && !productType.includes("unit-test")
      && !productType.includes("ui-testing");
  });
  const scored = candidates
    .map((section) => ({ section, score: liveApplicationSectionScore(section, normalizedScheme) }))
    .sort((left, right) => right.score - left.score || left.section.target.localeCompare(right.section.target));

  if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) {
    return scored[0].section.settings;
  }
  if (scored.length > 1) {
    const hostApps = scored.filter(({ section }) =>
      section.settings.PRODUCT_TYPE === "com.apple.product-type.application"
    );
    if (hostApps.length === 1) return hostApps[0].section.settings;
    const names = scored.map(({ section }) => section.target).join(", ");
    throw new Error(
      `Xcode reported multiple equally likely application targets for live scheme ${normalizedScheme || "(unknown)"}: ${names}.`
    );
  }
  if (collector.sections.length > 0) {
    throw new Error(
      `Xcode did not report a host application target for live scheme ${normalizedScheme || "(unknown)"}.`
    );
  }
  return collector.loose;
}

function liveApplicationSectionScore({ target, settings }, scheme) {
  const productType = String(settings.PRODUCT_TYPE || "");
  let score = 0;
  if (target === scheme || settings.TARGET_NAME === scheme || settings.PRODUCT_NAME === scheme) score += 100;
  if (productType === "com.apple.product-type.application") score += 80;
  if (settings.SKIP_INSTALL !== "YES") score += 20;
  if (/iphoneos|iphonesimulator/.test(String(settings.SUPPORTED_PLATFORMS || ""))) score += 10;
  if (productType.includes("on-demand-install-capable")) score -= 80;
  if (productType.includes("watchapp")) score -= 80;
  if (productType.includes("messages")) score -= 60;
  return score;
}

function expandedSigningIdentitiesFromSettings(settings) {
  const expanded = String(settings?.EXPANDED_CODE_SIGN_IDENTITY || "").trim();
  return /^[A-F0-9]{40}$/.test(expanded) ? [expanded] : [];
}

export function expandedSigningIdentities(output, scheme = "") {
  return expandedSigningIdentitiesFromSettings(
    selectLiveApplicationBuildSettings(output, scheme),
  );
}

function resolveSigningIdentities(projectPath, scheme = "") {
  const containerArguments = xcodeContainerArguments(projectPath, scheme);
  const settings = spawnSync(
    "xcodebuild",
    [...containerArguments, "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000 }
  );
  if (settings.status !== 0 || settings.error) {
    const detail = settings.error?.code === "ETIMEDOUT"
      ? "The Xcode build-settings query timed out."
      : String(settings.stderr || settings.stdout || settings.error?.message || "").trim();
    throw new Error(
      detail
        ? `Unable to determine host-app signing settings. ${detail}`
        : "Unable to determine host-app signing settings.",
    );
  }
  const output = String(settings.stdout || "");
  const selectedSettings = selectLiveApplicationBuildSettings(output, scheme);
  const expanded = expandedSigningIdentitiesFromSettings(selectedSettings);
  if (expanded.length > 0) return expanded;
  const team = String(selectedSettings.DEVELOPMENT_TEAM || "").trim();
  if (!team) {
    throw new Error("Xcode did not report a Development Team for the selected host application target.");
  }
  const identities = spawnSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" }
  );
  const matches = [...String(identities.stdout || "").matchAll(
    /^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gm
  )];
  const development = matches.filter((match) => /Apple Development/.test(match[2]));
  const available = new Set(development.map((match) => match[1]));
  const preferredHash = provisioningIdentityForTeam(team, available);
  const preferred = development.find((match) => match[1] === preferredHash)?.[2] || "";
  const teamMatch = development.find((match) => team && match[2].includes(`(${team})`))?.[2] || "";
  return [...new Set([
    preferred,
    teamMatch,
  ].filter(Boolean))];
}

function provisioningIdentityForTeam(team, available) {
  if (!team) return "";
  const directories = [
    join(homedir(), "Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"),
    join(homedir(), "Library", "MobileDevice", "Provisioning Profiles"),
  ];
  for (const directory of directories) {
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".mobileprovision")) continue;
      const profile = spawnSync(
        "security",
        ["cms", "-D", "-i", join(directory, name)],
        { encoding: "utf8" }
      );
      if (profile.status !== 0) continue;
      const profileTeam = spawnSync(
        "/usr/bin/plutil",
        ["-extract", "TeamIdentifier.0", "raw", "-"],
        { encoding: "utf8", input: profile.stdout }
      );
      if (profileTeam.status !== 0 || profileTeam.stdout.trim() !== team) continue;
      for (let index = 0; index < 10; index += 1) {
        const certificate = spawnSync(
          "/usr/bin/plutil",
          ["-extract", `DeveloperCertificates.${index}`, "raw", "-"],
          { encoding: "utf8", input: profile.stdout }
        );
        if (certificate.status !== 0) break;
        const identity = createHash("sha1")
          .update(Buffer.from(certificate.stdout.trim(), "base64"))
          .digest("hex")
          .toUpperCase();
        if (available.has(identity)) return identity;
      }
    }
  }
  return "";
}

function discoverTailnet() {
  const sockets = [
    process.env.SWIFT_SIM_TAILSCALE_SOCKET,
    join(homedir(), ".tailscale-userspace", "tailscaled.sock"),
  ].filter((path) => path && existsSync(path));
  const commands = [
    process.env.SWIFT_SIM_TAILSCALE_COMMAND,
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "tailscale",
  ].filter(Boolean);

  for (const command of [...new Set(commands)]) {
    // The regular CLI can spend several seconds waiting for the system daemon
    // when Swift Sim is using a userspace socket. Try known live sockets first.
    for (const socket of [...sockets, undefined]) {
      const prefix = socket ? [`--socket=${socket}`] : [];
      const result = spawnSync(command, [...prefix, "ip", "-4"], {
        encoding: "utf8",
        timeout: 2_000,
      });
      const host = validTailnetIPv4(result.status === 0 ? result.stdout : "");
      if (host) return { command, prefix, socket: socket || "", host };
    }
  }
  return { command: "", prefix: [], socket: "", host: "" };
}

function isPrivateForwardConfigured(tailnet) {
  if (!tailnet.command || !tailnet.socket) return false;
  const status = spawnSync(
    tailnet.command,
    [...tailnet.prefix, "serve", "status", "--json"],
    { encoding: "utf8", timeout: 2_000 }
  );
  try {
    const config = JSON.parse(status.stdout);
    return config?.TCP?.["8887"]?.TCPForward === "127.0.0.1:8887";
  } catch {
    return false;
  }
}

function ensurePrivateTailnetForward(tailnet) {
  if (isPrivateForwardConfigured(tailnet)) return;
  const result = spawnSync(
    tailnet.command,
    [
      ...tailnet.prefix,
      "serve",
      "--bg",
      "--yes",
      "--tcp",
      "8887",
      "tcp://127.0.0.1:8887",
    ],
    { encoding: "utf8", timeout: 5_000 }
  );
  if (result.status !== 0) {
    throw new Error(
      String(result.stderr || result.stdout || "Unable to configure the private Tailscale route.").trim()
    );
  }
}

function validTailnetIPv4(output) {
  const candidate = String(output || "")
    .split(/\s+/)
    .find((value) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value));
  if (!candidate) return "";
  const octets = candidate.split(".").map(Number);
  return octets.every((value) => value >= 0 && value <= 255)
    && octets[0] === 100
    ? candidate
    : "";
}

function waitForChildSpawn(child) {
  if (Number.isInteger(Number(child?.pid)) && Number(child.pid) > 1) {
    return Promise.resolve();
  }
  return new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requiredSwiftSource(path, label) {
  if (!path) throw new Error(`Missing --${label}.`);
  if (extname(path).toLowerCase() !== ".swift") {
    throw new Error(`--${label} must point to a .swift file.`);
  }
  return readFileSync(resolve(path), "utf8");
}

function normalizedClassification({
  route,
  hotReloadable,
  reason,
  reasonCode,
  changes,
}) {
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    route,
    hotReloadable,
    reason,
    reasonCode,
    changes,
  };
}

function result(route, hotReloadable, reason, paths, reasonCode) {
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    route,
    hotReloadable,
    reason,
    reasonCode,
    before: paths.beforePath || "",
    after: paths.afterPath || "",
    path: paths.path || "",
  };
}
