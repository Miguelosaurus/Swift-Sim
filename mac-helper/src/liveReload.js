import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
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
} from "node:fs";
import { createConnection } from "node:net";
import { arch, homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";
import { abortPendingLiveEngine } from "./liveEngineOwnershipPreload.js";
import { buildLiveSessionDescriptor, publishLiveSessionDescriptor, readLiveSessionDescriptor } from "./liveSessionDescriptor.js";
import { machoUUID, normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
import { ensureDirectoryModeSync, NodeAtomicFileStore } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeCommandRunner } from "./infrastructure/nodeCommandRunner.js";
import { fileURLToPath } from "node:url";
import { readLocalEngineCandidate, validateLocalEngineAppMetadata } from "./liveEngineCandidate.js";
import { createFullCallableCompiler, compilerResourceDigest } from "./fullCallableCompiler.js";
import { normalizeReplacementProof, replacementCoverageDigest } from "./replacementProof.js";

export const ROUTING_SCHEMA_VERSION = 1;
export const CLASSIFIER_VERSION = 2;
export const LIVE_ENGINE_CONTROL_TIMEOUT_MS = 750;
export const LIVE_COMPILER_REGISTRATION_TIMEOUT_MS = 30_000;
export const LIVE_COMPILER_REGISTRATION_BUDGET_MS = 180_000;

export const LIVE_REASON_CODES = Object.freeze({
  NO_CHANGE: "NO_CHANGE",
  IMPLEMENTATION_ONLY: "IMPLEMENTATION_ONLY",
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
const ENGINE_VERSION = LOCAL_ENGINE_CANDIDATE.candidate?.version || "0.4.0";
const ENGINE_SHA256 = LOCAL_ENGINE_CANDIDATE.candidate?.sha256 || "17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696";
const ENGINE_URL = `https://github.com/Miguelosaurus/InjectionNext/releases/download/swift-sim-engine-${ENGINE_VERSION}/swift-sim-engine-${ENGINE_VERSION}-arm64-signed.zip?sha256=${ENGINE_SHA256}`;
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

export function classifyLiveChange({ beforePath, afterPath }) {
  return classifyEditSet({
    files: [{
      path: afterPath || beforePath,
      status: "modified",
      kind: "swift",
      beforePath,
      afterPath,
    }],
  }).changes[0];
}

export function classifyLiveChanges({ beforePaths = [], afterPaths = [] }) {
  if (beforePaths.length === 0 || beforePaths.length !== afterPaths.length) {
    throw new Error("Pass the same nonzero number of --before and --after Swift files.");
  }
  return classifyEditSet({
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
export function classifyEditSet({ files = [] } = {}) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Pass a nonempty edit set.");
  }

  const changes = files.map((file) => classifyEditFile(file));
  const rebuild = changes.find((change) => change.route === "rebuild-required");
  if (rebuild) {
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
  return classifySwiftSource(before, after, paths);
}

export function classifySwiftSource(before, after, paths = {}) {
  if (before === after) {
    return result(
      "no-change",
      true,
      "The Swift source is unchanged.",
      paths,
      LIVE_REASON_CODES.NO_CHANGE,
    );
  }

  const beforeSurface = declarationSurface(before);
  const afterSurface = declarationSurface(after);
  const rebuild = (reason, reasonCode, category = "unsupported-live-edit", kinds = []) => {
    const storage = reasonCode === LIVE_REASON_CODES.STORED_PROPERTY_CHANGED;
    const select = (member) => (!kinds.length || kinds.includes(member.kind)) && (!storage || member.storedValue !== undefined);
    const beforeMembers = (beforeSurface.members || []).filter(select);
    const afterMembers = (afterSurface.members || []).filter(select);
    const key = storage ? "storedValue" : "signature";
    const index = afterMembers.findIndex((member, position) => member[key] !== beforeMembers[position]?.[key]);
    const member = afterMembers[index] || (beforeMembers.length > afterMembers.length ? beforeMembers[afterMembers.length] : null);
    return { ...result("rebuild-required", false, reason, paths, reasonCode), diagnostic: { category, ...(member ? { member: member.member, line: member.line } : {}) } };
  };
  if (beforeSurface.unsupported || afterSurface.unsupported) {
    return rebuild(
      beforeSurface.unsupported || afterSurface.unsupported,
      LIVE_REASON_CODES.MACRO_OR_EXPLICIT_REPLACEMENT,
    );
  }

  if (beforeSurface.imports !== afterSurface.imports) {
    return rebuild(
      "Imports changed.",
      LIVE_REASON_CODES.IMPORT_CHANGED,
    );
  }
  if (beforeSurface.compilerConditions !== afterSurface.compilerConditions) {
    return rebuild(
      "A conditional-compilation or availability condition changed.",
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }
  if (beforeSurface.attributes !== afterSurface.attributes) {
    return rebuild(
      "A declaration attribute or property-wrapper argument changed.",
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }
  if (beforeSurface.modifiers !== afterSurface.modifiers) {
    return rebuild(
      "A declaration access modifier or attribute changed.",
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }
  if (beforeSurface.storedProperties !== afterSurface.storedProperties) {
    return rebuild(
      "A stored property or its initializer changed.",
      LIVE_REASON_CODES.STORED_PROPERTY_CHANGED,
      "installed-structure", ["let", "var"],
    );
  }
  if (beforeSurface.signatures !== afterSurface.signatures) {
    const kinds = ["func", "init", "subscript", "typealias", "operator", "precedencegroup"];
    const previous = beforeSurface.members.filter((member) => kinds.includes(member.kind));
    const current = afterSurface.members.filter((member) => kinds.includes(member.kind));
    const existing = previous.length === current.length && previous.every((member, index) => member.member === current[index].member && member.kind === current[index].kind);
    return rebuild(
      "A function, initializer, subscript, or type signature changed.",
      LIVE_REASON_CODES.SIGNATURE_CHANGED,
      existing ? "installed-structure" : "unsupported-live-edit", kinds,
    );
  }
  if (beforeSurface.declarations !== afterSurface.declarations) {
    return rebuild(
      "A declaration, stored property, type shape, or function signature changed.",
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }

  return result(
    "hot-reload",
    true,
    "Only implementation bodies or literal values changed.",
    paths,
    LIVE_REASON_CODES.IMPLEMENTATION_ONLY,
  );
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
  if (installedEngineMatchesManifest()) {
    return {
      id: "live-engine",
      label: "Live patch engine",
      state: "unchanged",
      detail: `Engine ${ENGINE_VERSION} is ready`,
    };
  }
  if (arch() !== "arm64") {
    throw new Error("Remote hot reload currently requires an Apple silicon Mac.");
  }

  mkdirSync(ENGINE_ROOT, { recursive: true });
  const archivePath = join(ENGINE_ROOT, `engine-${ENGINE_VERSION}.zip`);
  const stagingPath = join(ENGINE_ROOT, `.staging-${process.pid}`);
  let bytes;
  if (LOCAL_ENGINE_CANDIDATE.candidate) bytes = readFileSync(LOCAL_ENGINE_CANDIDATE.candidate.archivePath);
  else {
    const response = await fetch(ENGINE_URL, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Unable to download the Swift Sim live engine (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ENGINE_SHA256) {
    throw new Error("The downloaded Swift Sim live engine failed its integrity check.");
  }
  writeFileSync(archivePath, bytes, { mode: 0o600 });
  rmSync(stagingPath, { recursive: true, force: true });
  mkdirSync(stagingPath, { recursive: true });
  const unpack = spawnSync("/usr/bin/ditto", ["-x", "-k", archivePath, stagingPath], {
    encoding: "utf8",
  });
  const stagedApp = join(stagingPath, "InjectionNext.app");
  if (unpack.status !== 0 || !existsSync(join(stagedApp, "Contents", "MacOS", "InjectionNext"))) {
    throw new Error(String(unpack.stderr || "Unable to unpack the Swift Sim live engine.").trim());
  }
  const signature = spawnSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", stagedApp], {
    encoding: "utf8",
  });
  if (signature.status !== 0) {
    throw new Error("The Swift Sim live engine signature could not be verified.");
  }
  if (LOCAL_ENGINE_CANDIDATE.candidate) {
    const metadata = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", join(stagedApp, "Contents", "Info.plist")], { encoding: "utf8" });
    if (metadata.status !== 0) throw new Error("The local candidate app metadata could not be read.");
    validateLocalEngineAppMetadata(JSON.parse(metadata.stdout));
  }
  spawnSync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", stagedApp], { encoding: "utf8" });
  await stopLiveEngine();
  rmSync(ENGINE_APP, { recursive: true, force: true });
  renameSync(stagedApp, ENGINE_APP);
  writeFileSync(ENGINE_MANIFEST, `${JSON.stringify({
    version: ENGINE_VERSION,
    sha256: ENGINE_SHA256,
    sourceRevision: LOCAL_ENGINE_CANDIDATE.candidate?.sourceRevision || "abdf6467318599abd3e952c941fed12e0caef04e",
    localCandidate: Boolean(LOCAL_ENGINE_CANDIDATE.candidate),
  }, null, 2)}\n`, { mode: 0o600 });
  rmSync(stagingPath, { recursive: true, force: true });
  rmSync(archivePath, { force: true });

  return {
    id: "live-engine",
    label: "Live patch engine",
    state: "installed",
    detail: `Engine ${ENGINE_VERSION} installed privately for this user`,
  };
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

export function inspectLiveBuildResult({ resultBundle, appPath = "", projectPath = "", scheme = "", runtime = {} }) {
  const path = resolve(resultBundle || "");
  if (!resultBundle || !existsSync(path) || lstatSync(path).isSymbolicLink()) throw registrationError("LIVE_CAPTURE_RESULT_MISSING", "The preserved Xcode result bundle is missing or unsafe.");
  const log = runtime.buildLog ?? readXcodeBuildLog(path);
  const commands = [...new Set(frontendCommandLines(log))].map((command) => {
    const tokens = splitShellCommand(command); const executable = tokens.shift() || "";
    if (!executable.endsWith("/swift-frontend")) return null;
    return { arguments: tokens, working_directory: frontendWorkingDirectory(tokens) };
  }).filter(Boolean);
  if (!commands.length || commands.length > 1024) throw registrationError("LIVE_CAPTURE_COMMANDS_INVALID", "The result bundle does not contain a bounded complete Swift frontend compilation map.");
  const compilations = commands.map(dynamicReplacementContext).filter(Boolean);
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
  return { commands, compilations, provenance, presentation };
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

export function validateQueuedLivePatchCoverage(record) {
  if (classifyEditSet({ files: record.files.map((file) => ({ ...file, kind: "swift", status: "modified" })) }).route !== "hot-reload") throw Object.assign(new Error("The queued snapshot is not an implementation-only edit."), { code: "QUEUED_EDIT_NOT_COMPATIBLE" });
  for (const file of record.files) {
    if (!generateDynamicReplacementSource({ source: file.afterSource, beforeSource: file.beforeSource, sourcePath: file.path, moduleName: "SwiftSimCoverageValidation" })) throw unsupportedReplacement();
  }
}

export function prepareQueuedLivePatch(record, { artifactRoot = join(LIVE_ROOT, "queued-artifacts") } = {}) {
  if (classifyEditSet({ files: record.files.map((file) => ({ ...file, kind: "swift", status: "modified" })) }).route !== "hot-reload") throw Object.assign(new Error("The queued snapshot is not an implementation-only edit."), { code: "QUEUED_EDIT_NOT_COMPATIBLE" });
  ensureDirectoryModeSync(artifactRoot, 0o700);
  const key = createHash("sha256").update(JSON.stringify([record.requestId, record.snapshotDigest, record.scope.binaryIdentity])).digest("hex");
  const path = join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`);
  const marker = `${path}.json`;
  const previous = readJSONFile(marker);
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0 || previous?.key !== key || previous.requestId !== record.requestId || previous.snapshotDigest !== record.snapshotDigest) throw Object.assign(new Error("The queued artifact cannot be reused safely."), { code: "PATCH_ARTIFACT_INVALID" });
    validateQueuedLivePatchCoverage(record);
    return { path, mode: "swift-dynamic-replacement-bundle" };
  }
  const entries = readdirSync(artifactRoot);
  if (entries.length > 1024) throw Object.assign(new Error("Queued artifact capacity is exhausted."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  const volume = statfsSync(artifactRoot);
  if (queuedArtifactUsage(artifactRoot) > 120 * 1024 * 1024 || Number(volume.bavail) * Number(volume.bsize) < 128 * 1024 * 1024) throw Object.assign(new Error("There is not enough bounded storage for a queued patch."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  // Publish ownership before compilation too, so an interrupted/failed compile
  // has a bounded deterministic directory which expiry cleanup can reclaim.
  writeFileSync(marker, JSON.stringify({ version: 1, key, requestId: record.requestId, snapshotDigest: record.snapshotDigest, binaryIdentity: record.scope.binaryIdentity, expiresAt: record.expiresAt }), { flag: "w", mode: 0o600 });
  const generated = compileDynamicReplacementBundle(record.files.map((file) => ({ sourcePath: file.path, sourceText: file.afterSource, beforeSourceText: file.beforeSource })), { identifier: `queued_${key}` });
  if (!generated) throw Object.assign(new Error("This edit cannot be prepared as a queued replacement."), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
  const size = statSync(generated.dylibPath).size;
  if (size > 32 * 1024 * 1024 || queuedArtifactUsage(artifactRoot) + size + 1024 * 1024 > 128 * 1024 * 1024) {
    rmSync(dirname(generated.dylibPath), { recursive: true, force: true });
    throw Object.assign(new Error("The prepared patch exceeds its storage quota."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  }
  // A deterministic owner marker makes a failed publication reusable and gives
  // expiry cleanup exact ownership; no unrelated app/build artifact is touched.
  writeFileSync(path, readFileSync(generated.dylibPath), { flag: "wx", mode: 0o600 });
  return { path, mode: "swift-dynamic-replacement-bundle" };
}

// Complete coverage is a negotiated SDK/engine contract. Legacy callers retain
// their qualified compiler; new requests never infer coverage from nonzero TX.
export function prepareCompleteQueuedLivePatch(record, { artifactRoot = join(LIVE_ROOT, "queued-artifacts"), manifestPath = LIVE_MANIFEST,
  runner = new NodeCommandRunner({ spawn, spawnSync }), compiler, patchRoot = LIVE_PATCH_ROOT } = {}) {
  assertCompleteEditSet(record);
  const manifest = readJSONFile(manifestPath);
  const identity = normalizedLiveBinaryIdentity(manifest?.binaryIdentity);
  if (`${identity.executable_uuid}:${identity.debug_dylib_uuid}` !== record.scope.binaryIdentity) throw completeArtifactError();
  const contexts = record.files.map(file => manifest.compilations?.find(context => context.sources?.some(path => resolve(path) === resolve(file.path))));
  const reference = contexts[0];
  if (!reference || contexts.some(context => !context || context.moduleName !== reference.moduleName
    || context.workingDirectory !== reference.workingDirectory || JSON.stringify(context.compilerArguments) !== JSON.stringify(reference.compilerArguments))) throw completeArtifactError();
  const resourceDigest = compilerResourceDigest();
  const key = createHash("sha256").update(JSON.stringify(["complete-v3", record.requestId, record.snapshotDigest, record.scope.binaryIdentity, resourceDigest])).digest("hex");
  const path = join(artifactRoot, `eval_injection_swift_sim_dynamic_${key}.dylib`);
  const marker = `${path}.json`;
  ensureDirectoryModeSync(artifactRoot, 0o700);
  const fullCompiler = compiler || createFullCallableCompiler({ runner, cacheRoot: join(LIVE_ROOT, "compiler-cache") });
  const generation = fullCompiler.generate({ module: reference.moduleName, generation: key.slice(0, 32),
    files: record.files.map(file => ({ path: file.path, before: file.beforeSource, after: file.afterSource })) });
  const moduleName = `SwiftSimLivePatch_${key}`;
  const previous = existsSync(marker) ? readCompleteMarker(marker) : null;
  if (existsSync(path)) {
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o077) !== 0
      || (process.getuid && stats.uid !== process.getuid()) || previous?.key !== key || previous.requestId !== record.requestId
      || previous.snapshotDigest !== record.snapshotDigest || previous.binaryIdentity !== record.scope.binaryIdentity || previous.resourceDigest !== resourceDigest) throw completeArtifactError();
    if (previous.artifactDigest !== createHash("sha256").update(readFileSync(path)).digest("hex")) throw completeArtifactError();
    const coverage = fullCompiler.inspectCoverage({ dylibPath: path, generation, moduleName });
    if (coverage.coverageDigest !== previous.coverageDigest) throw completeArtifactError();
    return completePrepared(path, coverage, resourceDigest);
  }
  const volume = statfsSync(artifactRoot);
  const initialUsage = queuedArtifactUsage(artifactRoot, patchRoot);
  if (!Number.isFinite(initialUsage)) throw completeArtifactError();
  if (readdirSync(artifactRoot).length > 1024 || initialUsage > 120 * 1024 * 1024
    || Number(volume.bavail) * Number(volume.bsize) < 128 * 1024 * 1024) throw Object.assign(new Error("Insufficient bounded patch storage."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  const directory = join(patchRoot, `queued_${key}`);
  ensureDirectoryModeSync(directory, 0o700);
  const owner = { version: 1, key, requestId: record.requestId, snapshotDigest: record.snapshotDigest,
    binaryIdentity: record.scope.binaryIdentity, expiresAt: record.expiresAt, resourceDigest };
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
  const result = runner.runSync({ executable: "/usr/bin/xcrun", args: ["swiftc", "-emit-library", ...paths, "-module-name", moduleName,
    ...reference.compilerArguments, "-Xfrontend", "-disable-access-control", "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup", "-o", dylibPath],
    cwd: reference.workingDirectory,
    environment: { inherit: ["HOME", "PATH", "TMPDIR", "DEVELOPER_DIR", "TOOLCHAINS"], overrides: {}, unset: ["SDKROOT"] },
    policy: { timeoutMs: 60_000, outputLimitBytes: 32 * 1024 * 1024, processGroup: "inherit", acceptedExitCodes: [0] } });
  if (result.code !== 0 || result.error || result.timedOut || !existsSync(dylibPath)) throw unsupportedReplacement();
  const coverage = fullCompiler.inspectCoverage({ dylibPath, generation, moduleName });
  const size = statSync(dylibPath).size;
  if (size > 32 * 1024 * 1024 || queuedArtifactUsage(artifactRoot, patchRoot) + size + 1024 * 1024 > 128 * 1024 * 1024) {
    throw Object.assign(new Error("The complete patch exceeds its storage quota."), { code: "PATCH_STORAGE_INSUFFICIENT" });
  }
  writeFileSync(path, readFileSync(dylibPath), { mode: 0o600, flag: "wx" });
  writeCompleteMarker(marker, { ...owner, coverageDigest: coverage.coverageDigest, artifactDigest: coverage.artifactDigest });
  return completePrepared(path, coverage, resourceDigest);
}

function assertCompleteEditSet(record) {
  if (classifyEditSet({ files: record.files.map(file => ({ ...file, kind: "swift", status: "modified" })) }).route !== "hot-reload") {
    throw Object.assign(new Error("The queued snapshot changes compiled structure."), { code: "QUEUED_EDIT_NOT_COMPATIBLE" });
  }
}
function completePrepared(path, coverage, resourceDigest) {
  const replacementProof = normalizeReplacementProof(coverage.replacementProof);
  return { path, mode: "swift-complete-replacement-bundle", replacementProof,
    coverageDigest: replacementCoverageDigest(replacementProof), compilerResourceDigest: resourceDigest, artifactDigest: coverage.artifactDigest };
}
function completeArtifactError() { return Object.assign(new Error("The complete patch artifact is not trusted."), { code: "PATCH_ARTIFACT_INVALID" }); }

export function validateCompleteQueuedLivePatchCoverage(record) {
  assertCompleteEditSet(record);
  if (!/^[a-f0-9]{64}$/.test(record.snapshotDigest || "") || record.preparedPatch?.sourceSnapshotDigest !== record.snapshotDigest
    || record.preparedPatch.compilerResourceDigest !== compilerResourceDigest()
    || record.preparedPatch.coverageDigest !== replacementCoverageDigest(record.preparedPatch.replacementProof)) throw completeArtifactError();
  const path = record.preparedPatch.path;
  assertCompleteFile(path);
  const marker = readCompleteMarker(`${path}.json`);
  if (marker.requestId !== record.requestId || marker.snapshotDigest !== record.snapshotDigest || marker.binaryIdentity !== record.scope.binaryIdentity
    || marker.resourceDigest !== record.preparedPatch.compilerResourceDigest || marker.coverageDigest !== record.preparedPatch.coverageDigest
    || marker.artifactDigest !== record.preparedPatch.patchDigest
    || createHash("sha256").update(readFileSync(path)).digest("hex") !== marker.artifactDigest) throw completeArtifactError();
}

export function sealCompleteQueuedLivePatch(record, raw, signedDigest) {
  assertCompleteFile(raw.path);
  const marker = readCompleteMarker(`${raw.path}.json`);
  if (marker.requestId !== record.requestId || marker.snapshotDigest !== record.snapshotDigest || marker.binaryIdentity !== record.scope.binaryIdentity || marker.artifactDigest !== raw.artifactDigest
    || marker.coverageDigest !== raw.coverageDigest || marker.resourceDigest !== raw.compilerResourceDigest
    || !/^[a-f0-9]{64}$/.test(signedDigest) || createHash("sha256").update(readFileSync(raw.path)).digest("hex") !== signedDigest) throw completeArtifactError();
  writeCompleteMarker(`${raw.path}.json`, { ...marker, unsignedArtifactDigest: marker.unsignedArtifactDigest || raw.artifactDigest, artifactDigest: signedDigest });
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

export function cleanupQueuedLiveArtifacts(records, { artifactRoot = join(LIVE_ROOT, "queued-artifacts"), now = Date.now() } = {}) {
  if (!existsSync(artifactRoot)) return;
  const root = lstatSync(artifactRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077) !== 0) return;
  const retained = new Set(records.filter((record) => record.expiresAt > now).map((record) => record.requestId));
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
    const compilation = join(LIVE_PATCH_ROOT, `queued_${marker.key}`);
    if (existsSync(compilation) && !lstatSync(compilation).isSymbolicLink()) rmSync(compilation, { recursive: true, force: true });
    rmSync(markerPath, { force: true });
  }
}

export async function prepareQueuedLivePatchAsync(record, { cancellationSignal, completeCoverage = false } = {}) {
  const runner = new NodeCommandRunner({ spawn, spawnSync });
  const result = await runner.run({
    executable: process.execPath,
    args: [fileURLToPath(new URL("../bin/swift-sim-live-prepare.js", import.meta.url)), ...(completeCoverage ? ["--complete-coverage-v3"] : [])],
    input: Buffer.from(JSON.stringify(record)),
    ...(cancellationSignal ? { cancellationSignal } : {}),
    environment: { inherit: ["HOME", "PATH", "TMPDIR", "DEVELOPER_DIR", "SDKROOT", "TOOLCHAINS"], overrides: {}, unset: [] },
    policy: { timeoutMs: completeCoverage ? 150_000 : 60_000, outputLimitBytes: 1024 * 1024, processGroup: "new", acceptedExitCodes: [0] },
  });
  if (result.code !== 0 || result.timedOut || result.cancellationError) {
    let failure;
    try { failure = JSON.parse(result.stderr.trim()); } catch {}
    const allowed = ["QUEUED_MECHANISM_UNSUPPORTED", "QUEUED_EDIT_NOT_COMPATIBLE", "PATCH_STORAGE_INSUFFICIENT", "PATCH_ARTIFACT_INVALID"];
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

function compilerRegistrationContext(command, index, total) {
  const args = command.arguments || [];
  const moduleName = argumentValue(args, "-module-name") || "unknown module";
  const sourceCount = args.filter((value) => String(value).endsWith(".swift")).length;
  const sourceLabel = `${sourceCount} Swift source${sourceCount === 1 ? "" : "s"}`;
  const workingDirectory = command.working_directory || "unknown working directory";
  return `module ${moduleName}, ${sourceLabel}, command ${index + 1}/${total}, working directory ${workingDirectory}`;
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
    "-I", "-F", "-Fsystem", "-L", "-D", "-swift-version",
    "-enable-upcoming-feature", "-enable-experimental-feature",
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

export async function routeLiveChange({ beforePath, afterPath, project = "", host = "", scheme = "" }) {
  return routeLiveChanges({
    beforePaths: [beforePath],
    afterPaths: [afterPath],
    project,
    host,
    scheme,
  });
}

export async function routeLiveChanges({ beforePaths = [], afterPaths = [], project = "", host = "", scheme = "", runtime } = {}) {
  if (beforePaths.length === 0 || beforePaths.length !== afterPaths.length) {
    throw new Error("Pass the same nonzero number of --before and --after Swift files.");
  }
  return routeLiveEditSet({
    files: beforePaths.map((beforePath, index) => ({
      path: afterPaths[index] || beforePath,
      status: "modified",
      kind: "swift",
      beforePath,
      afterPath: afterPaths[index],
    })),
    project,
    host,
    scheme,
    runtime,
  });
}

export async function routeLiveEditSet(options = {}) {
  const runtime = options.runtime || {};
  const injectedLifecycle = Boolean(
    runtime.inspect || runtime.inject || runtime.preflight || runtime.recover
  );
  if (!injectedLifecycle && runtime.lifecycleLocked !== true) {
    return withLiveEngineLifecycleLock(() => routeLiveEditSet({
      ...options,
      runtime: { ...runtime, lifecycleLocked: true },
    }));
  }
  const { project = "", host = "", scheme = "" } = options;
  const recoveryEnabled = runtime.disableRecovery !== true
    && Number(runtime.recoveryAttempt || 0) < 1
    && (!injectedLifecycle || typeof runtime.recover === "function");
  const result = await routeLiveEditSetOnce({ ...options, runtime: { ...runtime, disableRecovery: true } });
  if (!recoveryEnabled || !shouldAttemptProductionRecovery(result)) return result;

  const recovery = await (runtime.recover || defaultRecoverLiveSession)({
    project,
    host,
    scheme,
    lifecycleLocked: runtime.lifecycleLocked === true,
  });
  if (!recovery?.ready) {
    return {
      ...result,
      recovery: {
        attempted: true,
        succeeded: false,
        attemptCount: 1,
        initialReasonCode: result.reasonCode,
        error: recovery?.error || "The live session could not be recovered.",
      },
    };
  }

  const retry = await routeLiveEditSetOnce({
    ...options,
    runtime: { ...runtime, disableRecovery: true, recoveryAttempt: 1 },
  });
  return {
    ...retry,
    recovery: {
      attempted: true,
      succeeded: retry.action === "hot-reload",
      attemptCount: 1,
      initialReasonCode: result.reasonCode,
      initialRequestId: result.requestId,
    },
  };
}

async function routeLiveEditSetOnce({ files = [], project = "", host = "", scheme = "", runtime = {} } = {}) {
  const now = runtime.now || (() => Date.now());
  const startedAt = now();
  const requestId = runtime.requestId || randomUUID();
  const change = runtime.classify
    ? runtime.classify({ files })
    : classifyEditSet({ files });
  const classificationMs = Math.max(0, now() - startedAt);
  if (change.route === "no-change") {
    return routeResult({
      action: "none",
      change,
      live: null,
      requestId,
      timing: { classificationMs, totalMs: Math.max(0, now() - startedAt) },
      message: "The Swift sources are unchanged.",
    });
  }
  if (change.route === "rebuild-required") {
    return routeResult({ action: "build-device", change, live: null, reasonCode: change.reasonCode, requestId, timing: { classificationMs, totalMs: Math.max(0, now() - startedAt) }, message: "The edit changes compiled structure. Create a new Swift Sim update link." });
  }
  const inspect = runtime.inspect || runtime.warmInspect || (runtime.lifecycleLocked
    ? ((options) => inspectLiveReloadWarmUnlocked(options))
    : ((options) => inspectLiveReloadWarm(options)));
  const inject = runtime.inject || (runtime.lifecycleLocked
    ? ((sourcePath, options = {}) => injectLiveSourceUnlocked(sourcePath, { ...runtime, ...options }))
    : ((sourcePath, options = {}) => injectLiveSource(sourcePath, { ...runtime, ...options })));
  const live = await inspect({ project, host, scheme });
  if (change.hotReloadable && live.ready) {
    const hotFiles = change.changes.filter((item) => item.route === "hot-reload");
    const preparedPatches = await preflightMultiFilePatches({ hotFiles, runtime });
    if (preparedPatches?.error) {
      return routeResult({
        action: "hot-reload-failed",
        change,
        reasonCode: LIVE_REASON_CODES.PATCH_COMPILE_FAILED,
        live,
        patches: [],
        // A failed bundle was never loaded, but it is not an atomic
        // application result. Reserve `atomic:true` for a successfully
        // prepared bundle (or a single-file patch).
        atomic: hotFiles.length <= 1,
        partialApplication: false,
        requestId,
        timing: {
          classificationMs,
          compileMs: preparedPatches.compileMs,
          totalMs: Math.max(0, now() - startedAt),
        },
        message: preparedPatches.error,
      });
    }
    if (preparedPatches?.bundle) {
      const patch = await inject(hotFiles[0].after, {
        beforePath: hotFiles[0].before,
        preparedPatch: preparedPatches.bundle,
        sourceLabel: hotFiles.map((file) => file.after).join(","),
      });
      const patches = [patch];
      const missingDynamicReplacement = patch.mode !== "interposition" && hasZeroDynamicReplacements(patch);
      if (!patch.succeeded || missingDynamicReplacement || hasUnacknowledgedRefresh(patch)) {
        return routeResult({
          action: "hot-reload-failed",
          change,
          reasonCode: patchFailureReason(patch),
          live: await inspect({ project, host, scheme }),
          patch,
          patches,
          patchBundle: {
            atomic: true,
            sourceCount: hotFiles.length,
            sourcePaths: hotFiles.map((file) => file.after),
          },
          atomic: true,
          partialApplication: false,
          requestId: patch.requestID || requestId,
          timing: {
            classificationMs,
            compileMs: patch.compileMs || preparedPatches.compileMs || 0,
            loadAckMs: patch.loadAckMs || 0,
            refreshAckMs: patch.refreshAckMs || 0,
            totalMs: Math.max(0, now() - startedAt),
          },
          message: patch.error
            || "The atomic live patch did not complete. Create a new signed update link.",
        });
      }
      return routeResult({
        action: "hot-reload",
        change,
        live: await inspect({ project, host, scheme }),
        patch,
        patches,
        patchBundle: {
          atomic: true,
          sourceCount: hotFiles.length,
          sourcePaths: hotFiles.map((file) => file.after),
        },
        atomic: true,
        partialApplication: false,
        requestId: patch.requestID || requestId,
        timing: {
          classificationMs,
          compileMs: patch.compileMs || preparedPatches.compileMs || 0,
          loadAckMs: patch.loadAckMs || 0,
          refreshAckMs: patch.refreshAckMs || 0,
          totalMs: Math.max(0, now() - startedAt),
        },
        message: `${hotFiles.length} replacements applied atomically in ${patch.durationMs || 0} ms without a new build or install.`,
      });
    }
    const patches = [];
    for (const [index, file] of hotFiles.entries()) {
      const patch = await inject(file.after, {
        beforePath: file.before,
        forceInterposition: swiftAsyncImplementationChanged(file.before, file.after),
        preparedPatch: preparedPatches?.patches?.[index],
      });
      patches.push(patch);
      const missingDynamicReplacement = patch.mode !== "interposition" && hasZeroDynamicReplacements(patch);
      if (!patch.succeeded || missingDynamicReplacement || hasUnacknowledgedRefresh(patch)) {
        return routeResult({
          action: "hot-reload-failed",
          change,
          reasonCode: patchFailureReason(patch),
          live: await inspect({ project, host, scheme }),
          patch,
          patches,
          atomic: hotFiles.length <= 1 || Boolean(preparedPatches?.atomic),
          partialApplication: patches.slice(0, -1).some((candidate) => candidate.succeeded === true),
          requestId: patch.requestID || requestId,
          timing: {
            classificationMs,
            compileMs: patch.compileMs || 0,
            loadAckMs: patch.loadAckMs || 0,
            refreshAckMs: patch.refreshAckMs || 0,
            totalMs: Math.max(0, now() - startedAt),
          },
          message: patch.error
            || "The live patch did not complete. Fix the compile error or create a new signed update link.",
        });
      }
    }
    const durationMs = patches.reduce((total, patch) => total + patch.durationMs, 0);
    return routeResult({
      action: "hot-reload",
      change,
      live: await inspect({ project, host, scheme }),
      patch: patches[0],
      patches,
      atomic: hotFiles.length <= 1 || Boolean(preparedPatches?.atomic),
      partialApplication: false,
      requestId: patches.at(-1)?.requestID || requestId,
      timing: {
        classificationMs,
        compileMs: patches.reduce((total, patch) => total + (patch.compileMs || 0), 0),
        loadAckMs: patches.reduce((total, patch) => total + (patch.loadAckMs || 0), 0),
        refreshAckMs: patches.reduce((total, patch) => total + (patch.refreshAckMs || 0), 0),
        totalMs: Math.max(0, now() - startedAt),
      },
      message: `${patches.length === 1 ? "Patch" : `${patches.length} patches`} applied in ${durationMs} ms without a new build or install.`,
    });
  }
  return routeResult({
    action: "build-device",
    change,
    reasonCode: change.hotReloadable ? LIVE_REASON_CODES.LIVE_NOT_READY : change.reasonCode,
    live,
    requestId,
    timing: { classificationMs, totalMs: Math.max(0, now() - startedAt) },
    message: change.hotReloadable
      ? "The edit is hot-reloadable, but the live lane is not ready. Create a new Swift Sim update link."
      : "The edit changes compiled structure. Create a new Swift Sim update link.",
  });
}

async function preflightMultiFilePatches({ hotFiles, runtime }) {
  if (hotFiles.length <= 1) return null;
  const forceInterposition = hotFiles.some((file) => swiftAsyncImplementationChanged(file.before, file.after));
  const canBundle = !forceInterposition && (!runtime.inject || runtime.compileBundle);
  if (canBundle) {
    try {
      const startedAt = Date.now();
      const bundle = runtime.compileBundle
        ? await runtime.compileBundle({ files: hotFiles })
        : prepareLivePatchBundle(hotFiles.map((file) => ({
          sourcePath: file.after,
          beforePath: file.before,
        })));
      if (!bundle) throw new Error("The multi-file edit did not produce a replacement bundle.");
      return {
        bundle,
        compileMs: Number(bundle?.compileMs || (Date.now() - startedAt)),
        preflighted: true,
        atomic: true,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        compileMs: 0,
      };
    }
  }
  const preflight = runtime.preflight;
  if (!preflight && runtime.inject) return null;
  const patches = [];
  let compileMs = 0;
  try {
    for (const file of hotFiles) {
      const startedAt = Date.now();
      const prepared = preflight
        ? await preflight({
          sourcePath: file.after,
          beforePath: file.before,
          forceInterposition: swiftAsyncImplementationChanged(file.before, file.after),
        })
        : prepareLivePatch(file.after, {
          beforePath: file.before,
          forceInterposition: swiftAsyncImplementationChanged(file.before, file.after),
        });
      patches.push(prepared);
      compileMs += Number(prepared?.compileMs || (Date.now() - startedAt));
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      compileMs,
    };
  }
  return { patches, compileMs, preflighted: true, atomic: false };
}

const RECOVERABLE_ROUTE_FAILURES = new Set([
  LIVE_REASON_CODES.LIVE_NOT_READY,
  LIVE_REASON_CODES.PATCH_TIMEOUT,
  LIVE_REASON_CODES.PATCH_LOAD_FAILED,
  LIVE_REASON_CODES.REFRESH_NOT_ACKNOWLEDGED,
]);

function shouldAttemptProductionRecovery(result) {
  if (!result) return false;
  if (result.action === "build-device") {
    return result.change?.hotReloadable === true
      && result.reasonCode === LIVE_REASON_CODES.LIVE_NOT_READY;
  }
  if (result.action !== "hot-reload-failed") return false;
  if (result.partialApplication === true || result.reasonCode === LIVE_REASON_CODES.PATCH_COMPILE_FAILED) return false;
  if (!RECOVERABLE_ROUTE_FAILURES.has(result.reasonCode)) return false;
  const report = result.patch?.report;
  if (report?.applied === true || report?.applied === 1) return false;
  if (result.reasonCode === LIVE_REASON_CODES.PATCH_LOAD_FAILED && hasZeroDynamicReplacements(result.patch)) return false;
  return true;
}

async function defaultRecoverLiveSession({ project, host, scheme, lifecycleLocked = false }) {
  const start = lifecycleLocked ? startLiveReloadUnlocked : startLiveReload;
  const inspect = lifecycleLocked ? inspectLiveReloadUnlocked : inspectLiveReload;
  try {
    const restarted = await start({ project, host, scheme, forceRestart: true });
    if (!restarted?.started) {
      return { ready: false, error: restarted?.error || "The live engine did not restart." };
    }
    const deadline = Date.now() + 8_000;
    let status = await inspect({ project, host, scheme });
    while (Date.now() < deadline) {
      if (status.ready) return { ready: true, status };
      await delay(250);
      status = await inspect({ project, host, scheme });
    }
    return { ready: false, error: "The live-enabled app did not reconnect after the live engine restarted." };
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function hasZeroDynamicReplacements(patch = {}) {
  const report = patch.report;
  if (!report || typeof report !== "object") return false;
  const count = report.dynamic_replacements ?? report.dynamicReplacements;
  return count !== undefined && Number(count) === 0;
}

function hasUnacknowledgedRefresh(patch = {}) {
  const report = patch.report;
  if (!report || typeof report !== "object") return false;
  const acknowledged = report.refresh_acknowledged ?? report.refreshAcknowledged;
  return acknowledged !== undefined && acknowledged !== true;
}

function routeResult({
  action,
  change,
  live,
  reasonCode,
  requestId = "",
  patch,
  patches,
  patchBundle,
  timing,
  message,
  atomic,
  partialApplication,
}) {
  return {
    schemaVersion: ROUTING_SCHEMA_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    action,
    reasonCode: reasonCode || change.reasonCode,
    requestId,
    files: change.changes || [],
    change,
    live,
    ...(patch ? { patch } : {}),
    ...(patches ? { patches } : {}),
    ...(patchBundle ? { patchBundle } : {}),
    ...(atomic !== undefined ? { atomic } : {}),
    ...(partialApplication !== undefined ? { partialApplication } : {}),
    timing: {
      classificationMs: timing?.classificationMs || 0,
      compileMs: timing?.compileMs || 0,
      loadAckMs: timing?.loadAckMs || 0,
      refreshAckMs: timing?.refreshAckMs || 0,
      oracleMs: timing?.oracleMs || 0,
      totalMs: timing?.totalMs || 0,
    },
    ...(message ? { message } : {}),
  };
}

function patchFailureReason(patch = {}) {
  if (hasUnacknowledgedRefresh(patch)) return LIVE_REASON_CODES.REFRESH_NOT_ACKNOWLEDGED;
  if (/timed out/i.test(patch.error || "")) return LIVE_REASON_CODES.PATCH_TIMEOUT;
  if (/compile|replacement could not be compiled/i.test(patch.error || "")) {
    return LIVE_REASON_CODES.PATCH_COMPILE_FAILED;
  }
  if (/refresh|revision|acknowledge/i.test(patch.error || "")) {
    return LIVE_REASON_CODES.REFRESH_NOT_ACKNOWLEDGED;
  }
  return LIVE_REASON_CODES.PATCH_LOAD_FAILED;
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

function prepareLivePatch(sourcePath, { beforePath = "", forceInterposition = false } = {}) {
  const startedAt = Date.now();
  const generated = forceInterposition
    ? null
    : compileDynamicReplacement(sourcePath, { beforePath });
  return {
    mode: generated ? "swift-dynamic-replacement" : "interposition",
    generated,
    compileMs: Math.max(0, Date.now() - startedAt),
  };
}

export async function injectLiveSource(sourcePath, runtime = {}) {
  if (typeof runtime.engineControl === "function") {
    return injectLiveSourceUnlocked(sourcePath, runtime);
  }
  return withLiveEngineLifecycleLock(() => injectLiveSourceUnlocked(sourcePath, runtime));
}

async function injectLiveSourceUnlocked(sourcePath, runtime = {}) {
  const source = resolve(sourcePath || "");
  const now = runtime.now || (() => Date.now());
  const control = runtime.engineControl || engineControl;
  const compile = runtime.compile || compileDynamicReplacement;
  const wait = runtime.delay || delay;
  const startedAt = now();
  let mode = "interposition";
  let queued;
  let compileMs = 0;
  let loadAckMs = 0;
  let refreshAckMs = 0;
  try {
    const prepared = runtime.preparedPatch;
    const compileStartedAt = now();
    const generated = prepared === undefined
      ? (runtime.forceInterposition ? null : compile(source, { beforePath: runtime.beforePath }))
      : prepared?.generated || null;
    compileMs = prepared?.compileMs !== undefined
      ? Number(prepared.compileMs) || 0
      : Math.max(0, now() - compileStartedAt);
    if (prepared?.mode) mode = prepared.mode;
    if (generated) {
      mode = prepared?.mode || "swift-dynamic-replacement";
      queued = await control({
        action: "inject_dylib",
        path: generated.dylibPath,
        source: runtime.sourceLabel || source,
      });
    } else {
      queued = await control({ action: "inject_source", path: source });
    }
  } catch (error) {
    return {
      succeeded: false,
      mode,
      compileMs,
      loadAckMs,
      refreshAckMs,
      durationMs: Math.max(0, now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!queued?.success) {
    return {
      succeeded: false,
      mode,
      compileMs,
      loadAckMs,
      refreshAckMs,
      durationMs: Math.max(0, now() - startedAt),
      error: queued?.error || "The live engine did not accept the source file.",
    };
  }
  const requestID = Number(queued.data?.request_id || 0);
  const loadStartedAt = now();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await control({ action: "status" });
    const completed = Number(status?.data?.completed_injection_request_id || 0);
    if (completed >= requestID) {
      loadAckMs = Math.max(0, now() - loadStartedAt);
      const succeeded = status?.data?.last_injection_succeeded === true;
      const report = status?.data?.last_patch_report || null;
      refreshAckMs = Number(report?.refreshAckMs ?? report?.refresh_ack_ms ?? 0) || 0;
      return {
        succeeded,
        mode,
        requestID,
        compileMs,
        loadAckMs,
        refreshAckMs,
        durationMs: Math.max(0, now() - startedAt),
        report,
        error: succeeded
          ? ""
          : status?.data?.last_error || "The patch was compiled but the running app rejected it.",
      };
    }
    await wait(200);
  }
  return {
    succeeded: false,
    mode,
    requestID,
    compileMs,
    loadAckMs,
    refreshAckMs,
    durationMs: Math.max(0, now() - startedAt),
    error: "The live patch timed out. Keep the app foregrounded or create a new signed update link.",
  };
}

function compileDynamicReplacement(sourcePath, { beforePath = "" } = {}) {
  return compileDynamicReplacementBundle([{ sourcePath, beforePath }]);
}

function prepareLivePatchBundle(files) {
  const startedAt = Date.now();
  const generated = compileDynamicReplacementBundle(files);
  if (!generated) throw new Error("The multi-file edit could not be compiled as one dynamic-replacement bundle.");
  return {
    mode: "swift-dynamic-replacement-bundle",
    generated,
    compileMs: Math.max(0, Date.now() - startedAt),
  };
}

function compileDynamicReplacementBundle(files, { identifier: requestedIdentifier = "" } = {}) {
  const manifest = readJSONFile(LIVE_MANIFEST);
  const entries = files.map(({ sourcePath, beforePath = "", sourceText, beforeSourceText }) => {
    const source = sourceText ?? readFileSync(sourcePath, "utf8");
    const context = manifest?.compilations?.find((item) =>
      item.sources?.some((candidate) => resolve(candidate) === resolve(sourcePath))
    );
    if (!context) throw new Error(`No captured compiler context exists for ${basename(sourcePath)}.`);
    const replacement = generateDynamicReplacementSource({
      source,
      beforeSource: beforeSourceText ?? (beforePath && existsSync(beforePath) ? readFileSync(beforePath, "utf8") : ""),
      sourcePath,
      moduleName: context.moduleName,
    });
    if (!replacement) throw new Error(`No dynamic replacement was generated for ${basename(sourcePath)}.`);
    return { sourcePath, context, replacement };
  });
  if (entries.length === 0) return null;
  const reference = entries[0].context;
  const sameContext = entries.every((entry) =>
    entry.context.moduleName === reference.moduleName
    && entry.context.workingDirectory === reference.workingDirectory
    && JSON.stringify(entry.context.compilerArguments || []) === JSON.stringify(reference.compilerArguments || [])
  );
  if (!sameContext) {
    throw new Error("Multi-file replacements must belong to one captured Swift module and compiler context.");
  }
  const replacement = entries.map((entry) => entry.replacement).join("\n");
  const identifier = requestedIdentifier || `${Date.now()}-${process.pid}`;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(identifier)) throw new Error("Invalid replacement artifact identity.");
  const patchDirectory = join(LIVE_PATCH_ROOT, identifier);
  const moduleName = `SwiftSimLivePatch_${identifier.replaceAll("-", "_")}`;
  const generatedPath = join(patchDirectory, "SwiftSimLivePatch.swift");
  const dylibPath = join(patchDirectory, `eval_injection_swift_sim_dynamic_${identifier}.dylib`);
  mkdirSync(patchDirectory, { recursive: true });
  writeFileSync(generatedPath, replacement, { mode: 0o600 });
  const result = spawnSync("xcrun", [
    "swiftc", "-emit-library", generatedPath,
    "-module-name", moduleName,
    ...(reference.compilerArguments || []),
    "-Xfrontend", "-disable-access-control",
    "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup",
    "-o", dylibPath,
  ], {
    cwd: reference.workingDirectory || process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || !existsSync(dylibPath)) {
    throw new Error(cleanCompilerError(result.stderr || result.stdout));
  }
  return {
    dylibPath,
    generatedPath,
    sourcePaths: entries.map((entry) => entry.sourcePath),
    sourceCount: entries.length,
    bundle: entries.length > 1,
  };
}

function swiftUIBodyChanged(beforePath, afterPath) {
  if (!beforePath || !afterPath || !existsSync(beforePath) || !existsSync(afterPath)) return false;
  const before = swiftUIViewBodies(readFileSync(beforePath, "utf8"));
  const after = swiftUIViewBodies(readFileSync(afterPath, "utf8"));
  if (before.length !== after.length) return true;
  return before.some((view, index) => view.qualifiedName !== after[index]?.qualifiedName || view.body !== after[index]?.body);
}

function swiftAsyncImplementationChanged(beforePath, afterPath) {
  if (!beforePath || !afterPath || !existsSync(beforePath) || !existsSync(afterPath)) return false;
  const before = new Map(swiftMemberImplementations(readFileSync(beforePath, "utf8"))
    .filter((member) => member.effects?.includes("async"))
    .map((member) => [member.key, member.body]));
  return swiftMemberImplementations(readFileSync(afterPath, "utf8"))
    .some((member) => member.effects?.includes("async") && before.get(member.key) !== member.body);
}

function cleanCompilerError(output) {
  const lines = String(output || "The SwiftUI replacement could not be compiled.")
    .split(/\r?\n/)
    .filter((line) => !line.includes("remark: Incremental compilation"));
  return lines.slice(-20).join("\n").trim();
}

export function generateDynamicReplacementSource({ source, beforeSource = "", sourcePath, moduleName }) {
  const views = swiftUIViewBodies(source);
  const beforeViews = beforeSource ? swiftUIViewBodies(beforeSource) : [];
  const beforeViewBodies = new Map(beforeViews.map((view) => [view.qualifiedName, view.body]));
  const members = swiftMemberImplementations(source);
  let complete = true;
  if (beforeSource) {
    const outer = (text) => implementationBindingRanges(maskCommentsAndStrings(text)).filter((range, _, ranges) =>
      !ranges.some((owner) => owner.open < range.open && range.close < owner.close));
    const previous = outer(beforeSource);
    const current = outer(source);
    complete = previous.length === current.length && current.every((range, index) =>
      source.slice(range.open, range.close + 1) === beforeSource.slice(previous[index].open, previous[index].close + 1)
      || [...views, ...members].some((member) => member.bodyOpen === range.open));
  }
  const beforeMembers = new Map(swiftMemberImplementations(beforeSource).map((member) => [member.key, member]));
  const changedMembers = beforeSource
    ? members.filter((member) => beforeMembers.get(member.key)?.body !== member.body)
    : [];
  const changedAsyncMembers = changedMembers.filter((member) => member.effects?.includes("async"));
  const changedInitializerMembers = changedMembers.filter((member) => member.kind === "initializer");
  const changedSubscriptMembers = changedMembers.filter((member) => member.kind === "subscript");
  // Do not silently omit changed implementations from a successful bundle.
  // The legacy inlining forms remain limited to their exact supported shapes.
  const unsupportedAsync = changedAsyncMembers.some((member) => member.parameters || !member.body.slice(1, -1).trim() || /[{};]/.test(member.body.slice(1, -1))
    || !views.some((view) => new RegExp(`\\bawait\\s+${escapeRegExp(member.name)}\\(\\)`).test(view.body)));
  const unsupportedInline = views.length && (changedInitializerMembers.some((member) => !/\{\s*self\.[A-Za-z_][A-Za-z0-9_]*\s*=\s*"(?:\\.|[^"\\])*"\s*\}/s.test(member.body))
    || changedSubscriptMembers.some((member) => !/\{\s*(?:"(?:\\.|[^"\\])*"|[-+]?\d+(?:\.\d+)?)\s*\}/s.test(member.body)));
  const supportedMembers = changedMembers.filter((member) =>
    !member.effects?.includes("async")
    && (views.length === 0 || (member.kind !== "initializer" && member.kind !== "subscript"))
  );
  const changedViews = beforeSource
    ? views
      .map((view) => ({
        ...view,
        body: inlineImplementationReplacements(
          view.body,
          changedAsyncMembers,
          changedInitializerMembers,
          changedSubscriptMembers,
        ),
      }))
      .filter((view) => beforeViewBodies.get(view.qualifiedName) !== view.body)
    : views;
  if (changedViews.length === 0 && supportedMembers.length === 0) return "";
  if (!complete || unsupportedAsync || unsupportedInline) throw unsupportedReplacement();
  const imports = [...source.matchAll(/^\s*(?:@testable\s+)?import\s+([A-Za-z_][A-Za-z0-9_]*)[^\n]*$/gm)]
    .map((match) => match[0].trim())
    .filter((line) => !line.endsWith(` ${moduleName}`));
  const sourceFile = basename(sourcePath).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const replacements = changedViews.map((view, index) => `
${view.availability ? `${view.availability}\n` : ""}extension ${view.qualifiedName} {
    @_dynamicReplacement(for: body)
    private var __swiftSim_body_${index + 1}: some View ${view.body}
}`).join("\n");
  const memberReplacements = new Map();
  for (const member of supportedMembers) {
    const target = member.typeName ? `extension ${member.typeName} {` : "";
    let replacement;
    if (member.kind === "function") {
      replacement = `    @_dynamicReplacement(for: ${member.name}(${member.labels.map((label) => `${label}:`).join("")}))\n    private ${member.isStatic ? "static " : ""}func __swiftSim_${member.name}${member.genericParameters || ""}(${member.parameters})${member.effects ? ` ${member.effects}` : ""}${member.returnType ? ` -> ${member.returnType}` : ""} ${member.body}`;
    } else if (member.kind === "initializer") {
      replacement = `    @_dynamicReplacement(for: init(${member.labels.map((label) => `${label}:`).join("")}))\n    private init(${member.parameters})${member.effects ? ` ${member.effects}` : ""} ${member.body}`;
    } else if (member.kind === "subscript") {
      replacement = `    @_dynamicReplacement(for: subscript(${member.labels.map((label) => `${label}:`).join("")}))\n    private subscript${member.genericParameters || ""}(${member.parameters}) -> ${member.returnType} ${member.body}`;
    } else {
      replacement = `    @_dynamicReplacement(for: ${member.name})\n    private var __swiftSim_${member.name}: ${member.returnType} ${member.body}`;
    }
    const existing = memberReplacements.get(target) || [];
    existing.push(replacement);
    memberReplacements.set(target, existing);
  }
  const memberSource = [...memberReplacements.entries()].map(([target, entries]) =>
    `${target}\n${entries.join("\n")}\n}`
  ).join("\n");
  return `@_private(sourceFile: "${sourceFile}") import ${moduleName}\n${imports.join("\n")}\n${replacements}\n${memberSource}\n`;
}

function unsupportedReplacement() {
  return Object.assign(new Error("The current live compiler cannot represent every changed implementation in one complete replacement. No patch was applied."), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
}

function inlineAsyncReplacements(body, members) {
  return members.reduce((current, member) => {
    if (member.parameters) return current;
    const expression = member.body.slice(1, -1).trim();
    if (!expression || /[{};]/.test(expression)) return current;
    return current.replace(new RegExp(`\\bawait\\s+${member.name}\\(\\)`, "g"), expression);
  }, body);
}

function inlineImplementationReplacements(body, asyncMembers, initializerMembers, subscriptMembers) {
  let current = inlineAsyncReplacements(body, asyncMembers);
  for (const member of initializerMembers) {
    const assignment = member.body.match(/\{\s*self\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*")\s*\}/s);
    if (!assignment) continue;
    const typeName = escapeRegExp(member.typeName);
    const property = escapeRegExp(assignment[1]);
    current = current.replace(
      new RegExp(`\\b${typeName}\\s*\\([^(){}]*\\)\\s*\\.\\s*${property}\\b`, "g"),
      assignment[2],
    );
  }
  for (const member of subscriptMembers) {
    const expression = member.body.match(/\{\s*("(?:\\.|[^"\\])*"|[-+]?\d+(?:\.\d+)?)\s*\}/s)?.[1];
    if (!expression) continue;
    const typeName = escapeRegExp(member.typeName);
    current = current.replace(
      new RegExp(`\\b${typeName}\\s*\\([^(){}]*\\)\\s*\\[[^\\]]+\\]`, "g"),
      expression,
    );
  }
  return current;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function swiftMemberImplementations(source) {
  if (!source) return [];
  const masked = maskCommentsAndStrings(source);
  const types = swiftTypeDeclarations(masked);
  const output = [];
  for (const type of types) {
    const memberSource = masked.slice(type.open + 1, type.close);
    const functionPattern = /\b(?:(static)\s+)?func\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<([^>{}\n]*)>)?\s*\(([^(){}\n]*)\)\s*((?:(?:async|throws|rethrows)\s+)*)(?:->\s*([^{}\n]+?))?\s*\{/g;
    for (const match of memberSource.matchAll(functionPattern)) {
      const declarationOffset = type.open + 1 + match.index;
      if (braceDepth(masked, type.open + 1, declarationOffset) !== 0) continue;
      const bodyOpen = declarationOffset + match[0].lastIndexOf("{");
      const bodyClose = matchingBrace(masked, bodyOpen);
      if (bodyClose < 0 || bodyClose > type.close) continue;
      const parameters = compact(match[4]);
      output.push({
        key: `${type.qualifiedName}#function#${match[2]}#${compact(match[3] || "")}#${parameters}`,
        typeName: type.qualifiedName,
        kind: "function",
        name: match[2],
        genericParameters: match[3] ? `<${compact(match[3])}>` : "",
        parameters: compact(match[4]),
        labels: replacementParameterLabels(compact(match[4])),
        effects: match[5].trim(),
        returnType: match[6]?.trim() || "",
        isStatic: Boolean(match[1]),
        bodyOpen, bodyClose,
        body: source.slice(bodyOpen, bodyClose + 1),
      });
    }
    const initializerPattern = /\binit(?:\?|!)?\s*\(([^(){}\n]*)\)\s*((?:(?:async|throws|rethrows)\s+)*)(?:->\s*([^{}\n]+?))?\s*\{/g;
    for (const match of memberSource.matchAll(initializerPattern)) {
      const declarationOffset = type.open + 1 + match.index;
      if (braceDepth(masked, type.open + 1, declarationOffset) !== 0) continue;
      const bodyOpen = declarationOffset + match[0].lastIndexOf("{");
      const bodyClose = matchingBrace(masked, bodyOpen);
      if (bodyClose < 0 || bodyClose > type.close) continue;
      const parameters = compact(match[1]);
      output.push({
        key: `${type.qualifiedName}#initializer#${parameters}`,
        typeName: type.qualifiedName,
        kind: "initializer",
        name: "init",
        parameters,
        labels: replacementParameterLabels(parameters),
        effects: match[2].trim(),
        returnType: match[3]?.trim() || "",
        bodyOpen, bodyClose,
        body: source.slice(bodyOpen, bodyClose + 1),
      });
    }
    const subscriptPattern = /\bsubscript\s*(?:<([^>{}\n]*)>)?\s*\(([^(){}\n]*)\)\s*->\s*([^{}\n]+?)\s*\{/g;
    for (const match of memberSource.matchAll(subscriptPattern)) {
      const declarationOffset = type.open + 1 + match.index;
      if (braceDepth(masked, type.open + 1, declarationOffset) !== 0) continue;
      const bodyOpen = declarationOffset + match[0].lastIndexOf("{");
      const bodyClose = matchingBrace(masked, bodyOpen);
      if (bodyClose < 0 || bodyClose > type.close) continue;
      const parameters = compact(match[2]);
      output.push({
        key: `${type.qualifiedName}#subscript#${compact(match[1] || "")}#${parameters}`,
        typeName: type.qualifiedName,
        kind: "subscript",
        name: "subscript",
        genericParameters: match[1] ? `<${compact(match[1])}>` : "",
        parameters,
        labels: replacementParameterLabels(parameters),
        effects: "",
        returnType: compact(match[3]),
        bodyOpen, bodyClose,
        body: source.slice(bodyOpen, bodyClose + 1),
      });
    }
    const propertyPattern = /\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^{}\n]+?)\s*\{/g;
    for (const match of memberSource.matchAll(propertyPattern)) {
      const declarationOffset = type.open + 1 + match.index;
      if (match[1] === "body" || braceDepth(masked, type.open + 1, declarationOffset) !== 0) continue;
      const bodyOpen = declarationOffset + match[0].lastIndexOf("{");
      const bodyClose = matchingBrace(masked, bodyOpen);
      if (bodyClose < 0 || bodyClose > type.close) continue;
      output.push({
        key: `${type.qualifiedName}#property#${match[1]}`,
        typeName: type.qualifiedName,
        kind: "property",
        name: match[1],
        returnType: match[2].trim(),
        bodyOpen, bodyClose,
        body: source.slice(bodyOpen, bodyClose + 1),
      });
    }
  }
  return output;
}

function swiftTypeDeclarations(masked) {
  const declaration = /\b(?:actor|class|enum|extension|struct)\s+([A-Za-z_][A-Za-z0-9_.]*)[^{}\n]*\{/g;
  const candidates = [];
  for (const match of masked.matchAll(declaration)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(masked, open);
    if (close >= 0) candidates.push({ name: match[1], open, close });
  }
  candidates.sort((left, right) => left.open - right.open);
  for (const candidate of candidates) {
    const parent = candidates
      .filter((possible) => possible.open < candidate.open && possible.close > candidate.close)
      .sort((left, right) => right.open - left.open)[0];
    candidate.qualifiedName = parent
      ? `${parent.qualifiedName || parent.name}.${candidate.name}`
      : candidate.name;
  }
  return candidates;
}

function replacementParameterLabels(parameters) {
  if (!parameters) return [];
  return splitTopLevel(parameters, ",").map((parameter) => {
    const colon = topLevelIndex(parameter, ":");
    if (colon < 0) return "_";
    const head = compact(parameter.slice(0, colon));
    const labels = head.split(/\s+/).filter(Boolean);
    if (labels.length === 0 || labels[0] === "_") return "_";
    return labels[0];
  });
}

function splitTopLevel(value, separator) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ("([{<".includes(character)) depth += 1;
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function topLevelIndex(value, target) {
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ("([{<".includes(character)) depth += 1;
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1);
    else if (character === target && depth === 0) return index;
  }
  return -1;
}

function swiftUIViewBodies(source) {
  const masked = maskCommentsAndStrings(source);
  const candidates = [];
  const declaration = /\b(struct|class|extension)\s+([A-Za-z_][A-Za-z0-9_.]*)[^{}\n]*\{/g;
  for (const match of masked.matchAll(declaration)) {
    if (match[1] !== "extension" && !/\bView\b/.test(match[0])) continue;
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    candidates.push({
      name: match[2],
      kind: match[1],
      open,
      close,
      availability: declarationAvailability(source, match.index),
    });
  }
  candidates.sort((left, right) => left.open - right.open);
  for (const candidate of candidates) {
    const parent = candidates
      .filter((possible) => possible.open < candidate.open && possible.close > candidate.close)
      .sort((left, right) => right.open - left.open)[0];
    candidate.qualifiedName = parent
      ? `${parent.qualifiedName || parent.name}.${candidate.name}`
      : candidate.name;
    candidate.availability = candidate.availability || parent?.availability || "";
  }

  const output = [];
  for (const candidate of candidates) {
    const memberSource = masked.slice(candidate.open + 1, candidate.close);
    const bodyPattern = /\bvar\s+body\s*:\s*some\s+(?:SwiftUI\.)?View\s*\{/g;
    for (const match of memberSource.matchAll(bodyPattern)) {
      const declarationOffset = candidate.open + 1 + match.index;
      if (braceDepth(masked, candidate.open + 1, declarationOffset) !== 0) continue;
      const bodyOpen = declarationOffset + match[0].lastIndexOf("{");
      const bodyClose = matchingBrace(masked, bodyOpen);
      if (bodyClose < 0 || bodyClose > candidate.close) continue;
      output.push({
        qualifiedName: candidate.qualifiedName,
        availability: candidate.availability,
        bodyOpen, bodyClose,
        body: source.slice(bodyOpen, bodyClose + 1),
      });
      break;
    }
  }
  return output;
}

function declarationAvailability(source, declarationOffset) {
  const prefix = String(source).slice(0, declarationOffset);
  const lines = prefix.split(/\r?\n/);
  const attributes = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      if (attributes.length > 0) break;
      continue;
    }
    if (!line.startsWith("@available(")) break;
    attributes.unshift(line);
  }
  return attributes.join("\n");
}

function matchingBrace(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function braceDepth(source, start, end) {
  let depth = 0;
  for (let index = start; index < end; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") depth -= 1;
  }
  return depth;
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
  const targetName = String(settings.TARGET_NAME || "").trim();
  const projectFile = normalizedProjectDefinitionPath(settings.PROJECT_FILE_PATH, projectPath);
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

async function stopLiveEngine() {
  if (existsSync(ENGINE_PID)) {
    const pid = Number(readFileSync(ENGINE_PID, "utf8").trim());
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // A stale PID file is harmless.
      }
      await delay(300);
    }
  }
  rmSync(ENGINE_PID, { force: true });
  rmSync(ENGINE_SESSION, { force: true });
  rmSync(ENGINE_SOCKET, { force: true });
}

function resolveSigningIdentity(projectPath) {
  return resolveSigningIdentities(projectPath)[0] || "";
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

function declarationSurface(source) {
  const lexical = {};
  const clean = maskCommentsAndStrings(source, lexical);
  if (!lexical.complete || !balancedSwiftDelimiters(clean)) {
    return { unsupported: "Incomplete Swift syntax requires a rebuild." };
  }
  if (/#(?:externalMacro|freestanding|attached)\b|@_dynamicReplacement\b/.test(clean)) {
    return { unsupported: "Macros and explicit dynamic replacement require a rebuild." };
  }
  if (swiftRegexLiteralPresent(source, clean)) {
    return { unsupported: "Swift regex literals require a rebuild." };
  }

  const imports = [...clean.matchAll(/^\s*(?:@testable\s+)?import\s+[^\n;]+/gm)]
    .map((match) => compact(match[0]))
    .sort()
    .join("\n");
  const declarations = [];
  const signatures = [];
  const storedProperties = [];
  const compilerConditions = [
    ...[...clean.matchAll(/^\s*#(?:if|elseif|else|endif)\b[^\n]*/gm)]
      .map((match) => compact(match[0])),
    ...swiftRuntimeAvailabilitySurface(source, clean),
  ].join("\n");
  const attributes = swiftAttributeSurface(source, clean);
  const modifiers = [...clean.matchAll(/(?<![A-Za-z0-9_.])((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\s*\((?:[^()\n]|\([^()]*\))*\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b)/gm)]
    .map((match) => {
      const captureOffset = match[0].indexOf(match[1]);
      const start = match.index + captureOffset;
      return compact(source.slice(start, start + match[1].length));
    })
    .join("\n");
  const declarationPattern = /\b(actor|associatedtype|case|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b/gm;
  const typeRanges = typeDeclarationRanges(clean);
  const implementationRanges = implementationBindingRanges(clean);
  const members = [];
  let lineNumber = 1;
  let lineCursor = 0;

  for (const match of clean.matchAll(declarationPattern)) {
    if (match[1] === "class" && /^\s+(?:func|var|subscript)\b/.test(clean.slice(match.index + match[0].length))) {
      continue;
    }
    const start = match.index;
    if (["let", "var", "case"].includes(match[1]) && implementationRanges.some((range) =>
      range.open < start && start < range.close
      && !typeRanges.some((type) => range.open < type.open && type.open < start && start < type.close)
    )) continue;
    const signature = readDeclarationSignature(clean, start, match[1]);
    while (lineCursor < start) if (source[lineCursor++] === "\n") lineNumber++;
    const member = { kind: match[1], signature: compact(signature), member: signature.match(/^\w+\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1] || match[1], line: lineNumber };
    members.push(member);
    declarations.push(compact(signature));
    if (["func", "init", "subscript", "typealias", "operator", "precedencegroup"].includes(match[1])) {
      signatures.push(compact(signature));
    }
    if (["let", "var"].includes(match[1]) && isStoredProperty(clean, start, typeRanges, signature)) {
      member.storedValue = compact(readStoredProperty(source, start));
      storedProperties.push(member.storedValue);
    }
  }
  return {
    imports,
    declarations: declarations.join("\n"),
    signatures: signatures.join("\n"),
    storedProperties: storedProperties.join("\n"),
    compilerConditions,
    attributes,
    modifiers,
    members,
    unsupported: "",
  };
}

// Only bindings enclosed by an existing callable/computed implementation are
// omitted. Their containing declaration is still compared, as are nested type
// declarations, attributes, conditional compilation and stored initializers.
function implementationBindingRanges(clean) {
  const ranges = [];
  for (const match of clean.matchAll(/\b(func|init|deinit|subscript|var)\b/g)) {
    const previous = clean[match.index - 1];
    const next = clean[match.index + match[0].length];
    // Swift identifiers may contain Unicode and escaped keywords. Only admit
    // a keyword at a declaration boundary, never a substring of an identifier.
    if ((previous && !/[\s{;}]/u.test(previous)) || (next && !/[\s(<{?!]/u.test(next))) continue;
    const signature = readDeclarationSignature(clean, match.index, match[1]);
    // A protocol/external declaration has no body. Do not scan through its
    // boundary and mistake a following nominal type's brace for that body.
    if (/[{}]/.test(signature) || /\b(?:actor|class|enum|extension|protocol|struct|func|let|var|init|deinit|subscript)\b/.test(signature.slice(match[0].length))) continue;
    const open = match.index + signature.length;
    if (clean[open] !== "{") continue;
    if (match[1] === "var" && /^\s*(?:willSet|didSet)\b/.test(clean.slice(open + 1))) continue;
    const close = matchingBrace(clean, open);
    if (close >= 0) ranges.push({ open, close });
  }
  return ranges;
}

function balancedSwiftDelimiters(clean) {
  const stack = [];
  for (const character of clean) {
    if ("({[".includes(character)) stack.push(character);
    else if (")}]".includes(character) && stack.pop() !== ({ ")": "(", "}": "{", "]": "[" })[character]) return false;
  }
  return stack.length === 0;
}

function swiftRegexLiteralPresent(source, clean) {
  for (let index = 0; index < clean.length; index += 1) {
    let hashCount = 0;
    let slashIndex = index;
    if (clean[index] === "#") {
      while (clean[slashIndex] === "#") {
        hashCount += 1;
        slashIndex += 1;
      }
      if (clean[slashIndex] !== "/") continue;
    } else if (clean[index] !== "/" || clean[index + 1] === "/" || clean[index + 1] === "*") {
      continue;
    }
    if (!swiftRegexCanStart(clean, index)) continue;

    let escaped = false;
    let characterClass = false;
    for (let cursor = slashIndex + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (hashCount > 0) {
        if (character === "/"
            && source.startsWith("#".repeat(hashCount), cursor + 1)) {
          return true;
        }
        continue;
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "[") {
        characterClass = true;
        continue;
      }
      if (character === "]") {
        characterClass = false;
        continue;
      }
      if (character === "/" && !characterClass) return true;
      if (character === "\n") break;
    }
  }
  return false;
}

function swiftRegexCanStart(clean, index) {
  const prefix = clean.slice(0, index);
  const previous = prefix.match(/\S(?=\s*$)/)?.[0] || "";
  if (!previous || "=([{,:;!?&|".includes(previous)) return true;
  return /\b(?:return|throw|case|in|where|try|await|yield)\s*$/.test(prefix);
}

function swiftAttributeSurface(source, clean) {
  const attributes = [];
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] !== "@") continue;
    const previous = clean[index - 1] || "";
    if (/[A-Za-z0-9_]/.test(previous)) continue;
    let end = index + 1;
    if (!/[A-Za-z_]/.test(clean[end] || "")) continue;
    while (/[A-Za-z0-9_.]/.test(clean[end] || "")) end += 1;
    let cursor = end;
    while (/\s/.test(clean[cursor] || "")) cursor += 1;
    if (clean[cursor] === "(") {
      let depth = 0;
      for (; cursor < clean.length; cursor += 1) {
        if (clean[cursor] === "(") depth += 1;
        else if (clean[cursor] === ")") {
          depth -= 1;
          if (depth === 0) {
            cursor += 1;
            break;
          }
        }
      }
      if (depth === 0) end = cursor;
    }
    attributes.push(source.slice(index, end).trim());
    index = Math.max(index, end - 1);
  }
  return attributes.join("\n");
}

function swiftRuntimeAvailabilitySurface(source, clean) {
  const conditions = [];
  const tokens = ["#available", "#unavailable"];
  for (let index = 0; index < clean.length; index += 1) {
    const token = tokens.find((candidate) => clean.startsWith(candidate, index));
    if (!token) continue;
    const previous = clean[index - 1] || "";
    const next = clean[index + token.length] || "";
    if (/[A-Za-z0-9_]/.test(previous) || /[A-Za-z0-9_]/.test(next)) continue;
    let cursor = index + token.length;
    while (/\s/.test(clean[cursor] || "")) cursor += 1;
    if (clean[cursor] !== "(") continue;
    let depth = 0;
    let end = clean.length;
    for (; cursor < clean.length; cursor += 1) {
      if (clean[cursor] === "(") depth += 1;
      else if (clean[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }
    conditions.push(compact(source.slice(index, end)));
    index = Math.max(index, end - 1);
  }
  return conditions;
}

function typeDeclarationRanges(source) {
  const ranges = [];
  const declaration = /\b(?:actor|class|enum|extension|protocol|struct)\b[^{}]*\{/g;
  for (const match of source.matchAll(declaration)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(source, open);
    if (close >= 0) ranges.push({ open, close });
  }
  return ranges;
}

function isStoredProperty(source, start, ranges, signature) {
  const owner = ranges
    .filter((range) => range.open < start && range.close > start)
    .sort((left, right) => right.open - left.open)[0];
  const signatureEnd = start + String(signature).length;
  const next = source.slice(signatureEnd).match(/\S/)?.[0] || "";
  if (next === "{") return false;
  if (!owner) return braceDepth(source, 0, start) === 0;
  return braceDepth(source, owner.open + 1, start) === 0;
}

function readStoredProperty(source, start) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"') {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      if (depth === 0) return source.slice(start, index);
      depth -= 1;
    } else if ((char === "\n" || char === ";") && depth === 0) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function readDeclarationSignature(source, start, kind) {
  let parens = 0;
  let brackets = 0;
  let angles = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") parens += 1;
    else if (char === ")") parens = Math.max(0, parens - 1);
    else if (char === "[") brackets += 1;
    else if (char === "]") brackets = Math.max(0, brackets - 1);
    else if (char === "<") angles += 1;
    else if (char === ">") angles = Math.max(0, angles - 1);
    if (parens || brackets || angles) continue;

    if (char === "{") return source.slice(start, index);
    if (char === ";") return source.slice(start, index);
    if (char === "\n" && ["case", "import", "operator", "typealias", "associatedtype"].includes(kind)) {
      return source.slice(start, index);
    }
    if (char === "=" && ["let", "var"].includes(kind)) {
      return source.slice(start, index);
    }
    if (char === "\n" && ["let", "var"].includes(kind)) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function maskCommentsAndStrings(source, lexical = null) {
  let output = "";
  let mode = "code";
  let escaped = false;
  let blockCommentDepth = 0;
  let stringDelimiter = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") {
        mode = "code";
        output += char;
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "/" && next === "*") {
        output += "  ";
        index += 1;
        blockCommentDepth += 1;
      } else if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      const closingLength = swiftStringClosingLength(source, index, stringDelimiter);
      if (closingLength > 0 && !escaped) {
        output += " ".repeat(closingLength);
        index += closingLength - 1;
        mode = "code";
        stringDelimiter = null;
        continue;
      }
      if (stringDelimiter.hashCount === 0 && !escaped && char === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
      blockCommentDepth = 1;
    } else {
      const opening = swiftStringOpeningDelimiter(source, index);
      if (opening) {
        output += " ".repeat(opening.length);
        index += opening.length - 1;
        mode = "string";
        escaped = false;
        stringDelimiter = opening;
      } else {
        output += char;
      }
    }
  }
  if (lexical) lexical.complete = mode === "code" || mode === "line-comment";
  return output;
}

function swiftStringOpeningDelimiter(source, index) {
  let cursor = index;
  let hashCount = 0;
  while (source[cursor] === "#") {
    hashCount += 1;
    cursor += 1;
  }
  if (source.startsWith('"""', cursor)) {
    return { hashCount, quoteLength: 3, length: hashCount + 3 };
  }
  if (source[cursor] === '"') {
    return { hashCount, quoteLength: 1, length: hashCount + 1 };
  }
  return null;
}

function swiftStringClosingLength(source, index, delimiter) {
  if (!delimiter) return 0;
  const quotes = '"'.repeat(delimiter.quoteLength);
  if (!source.startsWith(quotes, index)) return 0;
  const hashes = "#".repeat(delimiter.hashCount);
  return source.startsWith(hashes, index + delimiter.quoteLength)
    ? delimiter.quoteLength + delimiter.hashCount
    : 0;
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").trim();
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
