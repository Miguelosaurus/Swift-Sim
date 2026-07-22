import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { arch, homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const ENGINE_VERSION = "0.4.0";
const ENGINE_SHA256 = "17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696";
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
  const before = requiredSwiftSource(beforePath, "before");
  const after = requiredSwiftSource(afterPath, "after");
  return classifySwiftSource(before, after, { beforePath, afterPath });
}

export function classifySwiftSource(before, after, paths = {}) {
  if (before === after) {
    return result("no-change", true, "The Swift source is unchanged.", paths);
  }

  const beforeSurface = declarationSurface(before);
  const afterSurface = declarationSurface(after);
  if (beforeSurface.unsupported || afterSurface.unsupported) {
    return result(
      "rebuild-required",
      false,
      beforeSurface.unsupported || afterSurface.unsupported,
      paths
    );
  }

  if (beforeSurface.imports !== afterSurface.imports) {
    return result("rebuild-required", false, "Imports changed.", paths);
  }
  if (beforeSurface.declarations !== afterSurface.declarations) {
    return result(
      "rebuild-required",
      false,
      "A declaration, stored property, type shape, or function signature changed.",
      paths
    );
  }

  return result(
    "hot-reload",
    true,
    "Only implementation bodies or literal values changed.",
    paths
  );
}

export async function inspectLiveReload({ project = "", host = "" } = {}) {
  const projectPath = project ? resolve(project) : "";
  const projectSource = projectPath && existsSync(projectPath)
    ? readFileSync(projectPath, "utf8")
    : "";
  const tailnet = host
    ? { command: "", prefix: [], socket: "", host }
    : discoverTailnet();
  const tailscaleHost = host || tailnet.host;
  const packageConfigured = /SwiftSimLive|github\.com\/Miguelosaurus\/InjectionNext/i.test(projectSource);
  const interposableConfigured = /-interposable/.test(projectSource);
  const engineInstalled = installedEngineMatchesManifest();
  const control = engineInstalled ? await engineControl({ action: "status" }) : null;
  const engineStatus = control?.success ? control.data : null;
  const projectRoot = projectRootFor(projectPath);
  const watchingProject = Boolean(
    projectRoot
    && engineStatus?.watching_directories?.some((path) => resolve(path) === projectRoot)
  );
  const connected = Boolean(engineStatus?.has_connected_client);
  const compilerReady = Number(engineStatus?.captured_compilations || 0) > 0;
  const configured = Boolean(
    tailscaleHost
    && packageConfigured
    && engineInstalled
  );

  return {
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
}

export async function ensureLiveEngineInstalled() {
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
  const response = await fetch(ENGINE_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Unable to download the Swift Sim live engine (${response.status}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
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
  spawnSync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", stagedApp], { encoding: "utf8" });
  await stopLiveEngine();
  rmSync(ENGINE_APP, { recursive: true, force: true });
  renameSync(stagedApp, ENGINE_APP);
  writeFileSync(ENGINE_MANIFEST, `${JSON.stringify({
    version: ENGINE_VERSION,
    sha256: ENGINE_SHA256,
    sourceRevision: "abdf6467318599abd3e952c941fed12e0caef04e",
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

export async function registerLiveBuildResult({ resultBundle }) {
  const path = resolve(resultBundle || "");
  if (!existsSync(path)) {
    throw new Error("The Xcode result bundle is missing.");
  }
  const result = spawnSync(
    "xcrun",
    ["xcresulttool", "get", "log", "--path", path, "--type", "build", "--compact"],
    { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(String(result.stderr || "Unable to read the Xcode build log.").trim());
  }
  const log = JSON.parse(result.stdout);
  const commands = [...new Set(frontendCommandLines(log))]
    .map((command) => {
      const tokens = splitShellCommand(command);
      const executable = tokens.shift() || "";
      if (!executable.endsWith("/swift-frontend")) return null;
      return {
        arguments: tokens,
        working_directory: frontendWorkingDirectory(tokens),
      };
    })
    .filter(Boolean);
  let registered = 0;
  const sources = new Set();
  const compilationContexts = [];
  for (const command of commands) {
    const response = await engineControl({
      action: "register_compilations",
      commands: [command],
    });
    if (!response?.success) {
      throw new Error(response?.error || "The live engine rejected a compiler command.");
    }
    registered += Number(response.data?.registered_count || 0);
    for (const source of response.data?.sources || []) sources.add(source);
    const context = dynamicReplacementContext(command);
    if (context) compilationContexts.push(context);
  }
  if (registered === 0) {
    throw new Error(
      "The build completed without capturable Swift frontend commands. Make a clean Debug build with EMIT_FRONTEND_COMMAND_LINES=YES."
    );
  }
  mkdirSync(LIVE_ROOT, { recursive: true });
  writeFileSync(LIVE_MANIFEST, `${JSON.stringify({
    version: 1,
    capturedAt: new Date().toISOString(),
    compilations: compilationContexts,
  }, null, 2)}\n`, { mode: 0o600 });
  return { registered, sources: [...sources].sort() };
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

export async function startLiveReload({ project = "", host = "" } = {}) {
  await ensureLiveEngineInstalled();
  let status = await inspectLiveReload({ project, host });
  if (!status.project.readable) {
    return {
      ...status,
      started: false,
      error: "Pass the path to an .xcodeproj/project.pbxproj file.",
    };
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
  const signingIdentity = resolveSigningIdentity(status.project.path);
  if (!signingIdentity) {
    return {
      ...status,
      started: false,
      error: "No matching Apple Development signing identity was found.",
    };
  }

  const running = await engineControl({ action: "status" });
  const session = readJSONFile(ENGINE_SESSION);
  const alreadyWatching = running?.success
    && running.data?.watching_directories?.some(
      (path) => resolve(path) === status.project.root
    )
    && running.data?.codesigning_identity_configured
    && session?.projectRoot === status.project.root
    && session?.signingIdentity === signingIdentity
    && session?.engineVersion === ENGINE_VERSION;
  if (!alreadyWatching) {
    await stopLiveEngine();
    mkdirSync(LIVE_ROOT, { recursive: true });
    if (existsSync(ENGINE_LOG) && statSync(ENGINE_LOG).size > 8 * 1024 * 1024) {
      truncateSync(ENGINE_LOG, 0);
    }
    const output = openSync(ENGINE_LOG, "a");
    const child = spawn(ENGINE_EXECUTABLE, [], {
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
    writeFileSync(ENGINE_PID, `${child.pid}\n`, { mode: 0o600 });
    writeFileSync(ENGINE_SESSION, `${JSON.stringify({
      projectRoot: status.project.root,
      signingIdentity,
      engineVersion: ENGINE_VERSION,
    }, null, 2)}\n`, { mode: 0o600 });
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
  status = await inspectLiveReload({ project, host });
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

export async function routeLiveChange({ beforePath, afterPath, project = "", host = "" }) {
  const change = classifyLiveChange({ beforePath, afterPath });
  const live = await inspectLiveReload({ project, host });

  if (change.route === "no-change") {
    return { action: "none", change, live };
  }
  if (change.hotReloadable && live.ready) {
    const patch = await injectLiveSource(afterPath);
    if (!patch.succeeded) {
      return {
        action: "hot-reload-failed",
        change,
        live: await inspectLiveReload({ project, host }),
        patch,
        message: patch.error
          || "The live patch did not complete. Fix the compile error or create a new signed update link.",
      };
    }
    return {
      action: "hot-reload",
      change,
      live: await inspectLiveReload({ project, host }),
      patch,
      message: `Patch applied in ${patch.durationMs} ms without a new build or install.`,
    };
  }
  return {
    action: "build-device",
    change,
    live,
    message: change.hotReloadable
      ? "The edit is hot-reloadable, but the live lane is not ready. Create a new Swift Sim update link."
      : "The edit changes compiled structure. Create a new Swift Sim update link.",
  };
}

export async function injectLiveSource(sourcePath) {
  const source = resolve(sourcePath || "");
  const startedAt = Date.now();
  let mode = "interposition";
  let queued;
  try {
    const generated = compileDynamicReplacement(source);
    if (generated) {
      mode = "swift-dynamic-replacement";
      queued = await engineControl({
        action: "inject_dylib",
        path: generated.dylibPath,
        source,
      });
    } else {
      queued = await engineControl({ action: "inject_source", path: source });
    }
  } catch (error) {
    return {
      succeeded: false,
      mode: "swift-dynamic-replacement",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (!queued?.success) {
    return {
      succeeded: false,
      mode,
      durationMs: Date.now() - startedAt,
      error: queued?.error || "The live engine did not accept the source file.",
    };
  }
  const requestID = Number(queued.data?.request_id || 0);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await engineControl({ action: "status" });
    const completed = Number(status?.data?.completed_injection_request_id || 0);
    if (completed >= requestID) {
      const succeeded = status?.data?.last_injection_succeeded === true;
      return {
        succeeded,
        mode,
        requestID,
        durationMs: Date.now() - startedAt,
        report: status?.data?.last_patch_report || null,
        error: succeeded
          ? ""
          : status?.data?.last_error || "The patch was compiled but the running app rejected it.",
      };
    }
    await delay(200);
  }
  return {
    succeeded: false,
    mode,
    requestID,
    durationMs: Date.now() - startedAt,
    error: "The live patch timed out. Keep the app foregrounded or create a new signed update link.",
  };
}

function compileDynamicReplacement(sourcePath) {
  const source = readFileSync(sourcePath, "utf8");
  const manifest = readJSONFile(LIVE_MANIFEST);
  const context = manifest?.compilations?.find((item) =>
    item.sources?.some((candidate) => resolve(candidate) === sourcePath)
  );
  if (!context) return null;
  const replacement = generateDynamicReplacementSource({
    source,
    sourcePath,
    moduleName: context.moduleName,
  });
  if (!replacement) return null;

  const identifier = `${Date.now()}-${process.pid}`;
  const patchDirectory = join(LIVE_PATCH_ROOT, identifier);
  const moduleName = `SwiftSimLivePatch_${identifier.replaceAll("-", "_")}`;
  const generatedPath = join(patchDirectory, "SwiftSimLivePatch.swift");
  const dylibPath = join(patchDirectory, `eval_injection_swift_sim_dynamic_${identifier}.dylib`);
  mkdirSync(patchDirectory, { recursive: true });
  writeFileSync(generatedPath, replacement, { mode: 0o600 });
  const result = spawnSync("xcrun", [
    "swiftc", "-emit-library", generatedPath,
    "-module-name", moduleName,
    ...(context.compilerArguments || []),
    "-Xfrontend", "-disable-access-control",
    "-Xlinker", "-undefined", "-Xlinker", "dynamic_lookup",
    "-o", dylibPath,
  ], {
    cwd: context.workingDirectory || process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || !existsSync(dylibPath)) {
    throw new Error(cleanCompilerError(result.stderr || result.stdout));
  }
  return { dylibPath, generatedPath };
}

function cleanCompilerError(output) {
  const lines = String(output || "The SwiftUI replacement could not be compiled.")
    .split(/\r?\n/)
    .filter((line) => !line.includes("remark: Incremental compilation"));
  return lines.slice(-20).join("\n").trim();
}

export function generateDynamicReplacementSource({ source, sourcePath, moduleName }) {
  const views = swiftUIViewBodies(source);
  if (views.length === 0) return "";
  const imports = [...source.matchAll(/^\s*(?:@testable\s+)?import\s+([A-Za-z_][A-Za-z0-9_]*)[^\n]*$/gm)]
    .map((match) => match[0].trim())
    .filter((line) => !line.endsWith(` ${moduleName}`));
  const sourceFile = basename(sourcePath).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
  const replacements = views.map((view, index) => `
extension ${view.qualifiedName} {
    @_dynamicReplacement(for: body)
    private var __swiftSim_body_${index + 1}: some View ${view.body}
}`).join("\n");
  return `@_private(sourceFile: "${sourceFile}") import ${moduleName}\n${imports.join("\n")}\n${replacements}\n`;
}

function swiftUIViewBodies(source) {
  const masked = maskCommentsAndStrings(source);
  const candidates = [];
  const declaration = /\b(?:struct|class)\s+([A-Za-z_][A-Za-z0-9_]*)[^{}\n]*:\s*[^{}\n]*\bView\b[^{}]*\{/g;
  for (const match of masked.matchAll(declaration)) {
    const open = match.index + match[0].lastIndexOf("{");
    const close = matchingBrace(masked, open);
    if (close < 0) continue;
    candidates.push({ name: match[1], open, close });
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
        body: source.slice(bodyOpen, bodyClose + 1),
      });
      break;
    }
  }
  return output;
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

function projectRootFor(projectPath) {
  if (!projectPath) return "";
  const absolute = resolve(projectPath);
  if (absolute.endsWith("/project.pbxproj")) return dirname(dirname(absolute));
  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) {
    return dirname(absolute);
  }
  return dirname(absolute);
}

async function engineControl(request) {
  if (!existsSync(ENGINE_SOCKET)) return null;
  return new Promise((resolveRequest) => {
    const socket = createConnection({ path: ENGINE_SOCKET });
    let response = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveRequest(value);
    };
    socket.setTimeout(750);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
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
  const projectContainer = projectPath.endsWith("/project.pbxproj")
    ? dirname(projectPath)
    : projectPath;
  const settings = spawnSync(
    "xcodebuild",
    ["-project", projectContainer, "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000 }
  );
  const output = String(settings.stdout || "");
  const expanded = output.match(/^\s*EXPANDED_CODE_SIGN_IDENTITY\s*=\s*([A-F0-9]{40})\s*$/m)?.[1];
  if (expanded) return expanded;
  const team = output.match(/^\s*DEVELOPMENT_TEAM\s*=\s*(\S+)\s*$/m)?.[1] || "";
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
  return provisioningIdentityForTeam(team, available)
    || development.find((match) => team && match[2].includes(`(${team})`))?.[1]
    || development[0]?.[1]
    || "";
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
  const clean = maskCommentsAndStrings(source);
  if (/#(?:externalMacro|freestanding|attached)\b|@_dynamicReplacement\b/.test(clean)) {
    return { unsupported: "Macros and explicit dynamic replacement require a rebuild." };
  }

  const imports = [...clean.matchAll(/^\s*(?:@testable\s+)?import\s+[^\n;]+/gm)]
    .map((match) => compact(match[0]))
    .sort()
    .join("\n");
  const declarations = [];
  const declarationPattern = /\b(actor|associatedtype|case|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b/gm;

  for (const match of clean.matchAll(declarationPattern)) {
    if (match[1] === "class" && /^\s+(?:func|var|subscript)\b/.test(clean.slice(match.index + match[0].length))) {
      continue;
    }
    const start = match.index;
    const signature = readDeclarationSignature(clean, start, match[1]);
    declarations.push(compact(signature));
  }
  return { imports, declarations: declarations.join("\n"), unsupported: "" };
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

function maskCommentsAndStrings(source) {
  let output = "";
  let mode = "code";
  let escaped = false;
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
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") mode = "code";
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
    } else if (char === "\"") {
      output += " ";
      mode = "string";
    } else {
      output += char;
    }
  }
  return output;
}

function compact(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function result(route, hotReloadable, reason, paths) {
  return {
    route,
    hotReloadable,
    reason,
    before: paths.beforePath || "",
    after: paths.afterPath || "",
  };
}
