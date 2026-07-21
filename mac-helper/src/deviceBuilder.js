import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { homedir } from "node:os";
import { deviceAppIdentity } from "./deviceBuildStore.js";
import {
  registerLiveBuildResult,
  startLiveReload,
} from "./liveReload.js";

export class DeviceBuildError extends Error {}

export async function runDeviceBuild(build, { save, logger = () => {} } = {}) {
  const saveBuild = () => save?.(build);
  const log = (message) => {
    build.logs.push(message);
    logger(message);
    saveBuild();
  };

  try {
    build.state = "preparing";
    saveBuild();
    const target = resolveTarget(build);
    const requestedBuildSettingArgs = xcodeBuildSettingArgs(build.buildSettings);
    const liveEligible = String(build.configuration || "").toLowerCase() === "debug"
      && target.type === "project"
      && projectHasLivePackage(target);
    const buildSettingArgs = liveEligible
      ? [...requestedBuildSettingArgs, ...managedLiveBuildSettings()]
      : requestedBuildSettingArgs;
    const root = join(homedir(), ".swift-sim", "device-builds", build.id);
    const archivePath = join(root, `${safeName(build.scheme || "App")}.xcarchive`);
    const exportPath = join(root, "export");
    const manifestPath = join(root, "manifest.plist");
    const resultBundlePath = join(root, `${safeName(build.scheme || "App")}.xcresult`);
    mkdirSync(exportPath, { recursive: true });

    build.artifacts.root = root;
    build.artifacts.archivePath = archivePath;
    build.artifacts.exportPath = exportPath;
    build.artifacts.manifestPath = manifestPath;
    build.artifacts.resultBundlePath = resultBundlePath;
    saveBuild();

    log("Reading Xcode signing settings.");
    const settings = await readBuildSettings({
      target,
      scheme: build.scheme,
      configuration: build.configuration,
      allowProvisioningUpdates: build.allowProvisioningUpdates,
      buildSettingArgs,
    });
    build.app.bundleIdentifier = settings.PRODUCT_BUNDLE_IDENTIFIER || "";
    build.app.version = settings.MARKETING_VERSION || "";
    build.app.build = settings.CURRENT_PROJECT_VERSION || "";
    build.app.teamID = settings.DEVELOPMENT_TEAM || "";
    build.app.identity = deviceAppIdentity(build.app);
    build.signing.style = settings.CODE_SIGN_STYLE || "";
    build.signing.deviceInstallable = Boolean(build.app.bundleIdentifier && build.app.teamID);
    build.signing.updateSafe = build.preserveData ? "same-bundle-update" : "reinstall-requested";
    build.signing.warnings = updateSafetyWarnings(build);
    saveBuild();

    build.state = "archiving";
    saveBuild();
    let liveSession = null;
    if (liveEligible && target.type === "project") {
      try {
        liveSession = await startLiveReload({
          project: join(target.path, "project.pbxproj"),
        });
        if (liveSession.started) {
          build.liveReload = {
            eligible: true,
            engineReady: true,
            compilerReady: false,
            host: liveSession.host,
          };
          log("Preparing Swift Sim's private live patch lane.");
        }
      } catch (error) {
        build.liveReload = {
          eligible: true,
          engineReady: false,
          compilerReady: false,
          error: error instanceof Error ? error.message : String(error),
        };
        log("Live patch preparation was unavailable; the signed install will still continue.");
      }
    }
    if (liveSession?.started) {
      build.state = "building";
      saveBuild();
      const derivedDataPath = join(root, "DerivedData");
      log("Building the signed live-enabled Debug app.");
      await runLogged("xcodebuild", [
        ...targetArgs(target),
        "-scheme", required(build.scheme, "scheme"),
        "-configuration", build.configuration || "Debug",
        ...buildSettingArgs,
        "-destination", "generic/platform=iOS",
        "-derivedDataPath", derivedDataPath,
        "-resultBundlePath", resultBundlePath,
        ...(build.allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
        "build",
      ], log, {
        env: {
          ...process.env,
          INJECTION_HOST: liveSession.host,
        },
      });

      const appPath = findBuiltApp(join(derivedDataPath, "Build", "Products"), build.scheme);
      if (!appPath) {
        throw new DeviceBuildError("Xcode finished, but the signed Debug app could not be found.");
      }
      if (!containsDebugDylib(appPath)) {
        throw new DeviceBuildError(
          "Xcode did not produce the required Debug dylib. Swift Sim cannot safely enable hot reload for this build."
        );
      }
      try {
        const capture = await registerLiveBuildResult({ resultBundle: resultBundlePath });
        build.liveReload = {
          eligible: true,
          engineReady: true,
          compilerReady: true,
          host: liveSession.host,
          capturedCompilations: capture.registered,
        };
        log(`Captured ${capture.registered} live Swift compilation ${capture.registered === 1 ? "command" : "commands"}.`);
      } catch (error) {
        throw new DeviceBuildError(
          `The app built, but its live compilation map was incomplete: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      build.state = "exporting";
      saveBuild();
      log("Packaging the signed Debug app as an installable IPA.");
      const ipaPath = packageBuiltApp(appPath, exportPath, build.scheme);
      build.artifacts.ipaPath = ipaPath;
      build.app.name = displayNameFromIpa(ipaPath) || build.scheme || basename(ipaPath, ".ipa");
      build.state = "ready";
      saveBuild();
      log("Build is ready to install and hot reload.");
      return build;
    }

    log("Archiving for generic iOS device.");
    await runLogged("xcodebuild", [
      ...targetArgs(target),
      "-scheme", required(build.scheme, "scheme"),
      "-configuration", build.configuration || "Release",
      ...buildSettingArgs,
      "-destination", "generic/platform=iOS",
      "-archivePath", archivePath,
      ...(build.allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
      "archive",
    ], log);

    build.state = "exporting";
    saveBuild();
    log("Exporting signed IPA.");
    const exportOptionsPath = join(root, "ExportOptions.plist");
    writeFileSync(exportOptionsPath, exportOptionsPlist(build), "utf8");
    await runLogged("xcodebuild", [
      "-exportArchive",
      "-archivePath", archivePath,
      "-exportPath", exportPath,
      "-exportOptionsPlist", exportOptionsPath,
      ...(build.allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    ], log);

    const ipaPath = findIpa(exportPath);
    if (!ipaPath) throw new DeviceBuildError("Xcode export finished, but no IPA was produced.");
    build.artifacts.ipaPath = ipaPath;
    build.app.name = displayNameFromIpa(ipaPath) || build.scheme || basename(ipaPath, ".ipa");

    build.state = "ready";
    saveBuild();
    log("Build is ready to install.");
    return build;
  } catch (error) {
    build.state = "failed";
    build.logs.push(error instanceof Error ? error.message : String(error));
    saveBuild();
    throw error;
  }
}

export function buildManifest(build, remoteBaseUrl) {
  const base = normalizeBaseUrl(remoteBaseUrl || build.remoteBaseUrl);
  if (!base) throw new DeviceBuildError("A remote base URL is required before creating the install manifest.");
  const ipaURL = `${base}/api/device-builds/${encodeURIComponent(build.id)}/artifact/ipa?token=${encodeURIComponent(build.token)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>
          <string>software-package</string>
          <key>url</key>
          <string>${escapeXml(ipaURL)}</string>
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>
        <string>${escapeXml(build.app.bundleIdentifier || "unknown.bundle")}</string>
        <key>bundle-version</key>
        <string>${escapeXml(build.app.build || build.app.version || "1")}</string>
        <key>kind</key>
        <string>software</string>
        <key>title</key>
        <string>${escapeXml(build.app.name || build.scheme || "iOS App")}</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

export function deviceBuildLinks(build, remoteBaseUrl = "") {
  const base = normalizeBaseUrl(remoteBaseUrl || build.remoteBaseUrl);
  const universalLink = base
    ? `${base}/d/${encodeURIComponent(build.id)}?token=${encodeURIComponent(build.token)}`
    : "";
  const manifestURL = base
    ? `${base}/api/device-builds/${encodeURIComponent(build.id)}/artifact/manifest?token=${encodeURIComponent(build.token)}`
    : "";
  return {
    universalLink,
    customScheme: `swift-sim://device-build/${encodeURIComponent(build.id)}?token=${encodeURIComponent(build.token)}${base ? `&base=${encodeURIComponent(base)}` : ""}`,
    installURL: manifestURL ? `itms-services://?action=download-manifest&url=${encodeURIComponent(manifestURL)}` : "",
  };
}

export function publicDeviceBuild(build) {
  const liveReloadEligible = String(build.configuration || "").toLowerCase() === "debug"
    && Boolean(build.liveReload?.eligible
      || (build.buildSettings || []).some((setting) => String(setting).includes("-interposable")));
  return {
    id: build.id,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    expiresAt: build.expiresAt,
    state: build.state,
    configuration: build.configuration || "Release",
    liveReload: {
      eligible: liveReloadEligible,
      mode: "debug-only",
      engineReady: Boolean(build.liveReload?.engineReady),
      compilerReady: Boolean(build.liveReload?.compilerReady),
      capturedCompilations: Number(build.liveReload?.capturedCompilations || 0),
      error: build.liveReload?.error || "",
    },
    app: build.app,
    signing: {
      method: build.signing.method,
      deviceInstallable: build.signing.deviceInstallable,
      updateSafe: build.signing.updateSafe,
      warnings: build.signing.warnings,
    },
    delivery: build.delivery || {
      mode: build.remoteBaseUrl ? "custom" : "quick-tunnel",
      provider: build.remoteBaseUrl ? "user-configured" : "cloudflare-quick-tunnel",
      expiresAt: build.expiresAt,
    },
    preserveData: build.preserveData,
    installation: publicInstallation(build.installation),
    links: deviceBuildLinks(build, build.remoteBaseUrl),
  };
}

export function publicDeviceApp(app) {
  const builds = (app.builds || []).map(publicDeviceBuild);
  return {
    id: app.id,
    name: app.name,
    bundleIdentifier: app.bundleIdentifier,
    archivedAt: app.archivedAt || "",
    latestBuild: builds[0] || null,
    builds,
  };
}

function resolveTarget(build) {
  const project = build.project || "";
  const workspace = build.workspace || "";
  if (workspace) return { type: "workspace", path: workspace };
  if (project) {
    const extension = extname(project);
    if (extension === ".xcworkspace") return { type: "workspace", path: project };
    return { type: "project", path: project };
  }
  throw new DeviceBuildError("Missing project or workspace path.");
}

async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs }) {
  const result = await runBuffered("xcodebuild", [
    ...targetArgs(target),
    "-scheme", required(scheme, "scheme"),
    "-configuration", configuration || "Release",
    ...buildSettingArgs,
    "-destination", "generic/platform=iOS",
    ...(allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    "-showBuildSettings",
  ]);
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || "Unable to read Xcode build settings.");
  }
  return parseBuildSettings(result.stdout);
}

function xcodeBuildSettingArgs(buildSettings) {
  if (!Array.isArray(buildSettings)) return [];
  return buildSettings.map((setting) => {
    const value = String(setting || "");
    if (!/^[A-Z][A-Z0-9_]*=.+$/.test(value)) {
      throw new DeviceBuildError("Build settings must use KEY=VALUE format.");
    }
    return value;
  });
}

function parseBuildSettings(output) {
  const settings = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  return settings;
}

function targetArgs(target) {
  return target.type === "workspace"
    ? ["-workspace", target.path]
    : ["-project", target.path];
}

async function runLogged(command, args, log, { env = process.env } = {}) {
  const result = await runBuffered(command, args, {
    onLine: log,
    timeoutMs: 30 * 60 * 1000,
    env,
  });
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || `${command} failed with exit code ${result.code}`);
  }
  return result;
}

function runBuffered(command, args, { onLine, timeoutMs = 120_000, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    let stdoutPending = "";
    let stderrPending = "";
    let settled = false;

    const flushLines = (chunk, isError) => {
      const value = chunk.toString("utf8");
      const combined = (isError ? stderrPending : stdoutPending) + value;
      const lines = combined.split(/\r?\n/);
      const pending = lines.pop() || "";
      if (isError) stderrPending = pending;
      else stdoutPending = pending;
      for (const line of lines) {
        if (line.trim()) onLine?.(line);
      }
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: null, stdout, stderr, error: `${command} timed out` });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      flushLines(chunk, false);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      flushLines(chunk, true);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (stdoutPending.trim()) onLine?.(stdoutPending);
      if (stderrPending.trim()) onLine?.(stderrPending);
      resolve({ code, stdout, stderr, error: code === 0 ? "" : (stderr || stdout) });
    });
  });
}

function exportOptionsPlist(build) {
  const teamID = build.app.teamID ? `<key>teamID</key>\n  <string>${escapeXml(build.app.teamID)}</string>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${escapeXml(build.exportMethod || "development")}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
  ${teamID}
</dict>
</plist>
`;
}

function findIpa(exportPath) {
  if (!existsSync(exportPath)) return "";
  const candidates = readdirSync(exportPath)
    .filter((file) => file.endsWith(".ipa"))
    .map((file) => join(exportPath, file));
  return candidates[0] || "";
}

function projectHasLivePackage(target) {
  try {
    return /SwiftSimLive|github\.com\/Miguelosaurus\/InjectionNext/i.test(
      readFileSync(join(target.path, "project.pbxproj"), "utf8")
    );
  } catch {
    return false;
  }
}

function managedLiveBuildSettings() {
  return [
    "ENABLE_DEBUG_DYLIB=YES",
    "ENABLE_PREVIEWS=NO",
    "ENABLE_XOJIT_PREVIEWS=YES",
    "SWIFT_OPTIMIZATION_LEVEL=-Onone",
    "EMIT_FRONTEND_COMMAND_LINES=YES",
    "COMPILATION_CACHE_ENABLE_CACHING=NO",
    "OTHER_SWIFT_FLAGS=$(inherited) -Xfrontend -enable-implicit-dynamic -enable-private-imports",
    "OTHER_LDFLAGS=$(inherited) -Xlinker -interposable",
  ];
}

function findBuiltApp(directory, scheme) {
  if (!existsSync(directory)) return "";
  const preferred = `${safeName(scheme)}.app`;
  const apps = [];
  const visit = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const candidate = join(path, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) apps.push(candidate);
      else if (entry.isDirectory()) visit(candidate);
    }
  };
  visit(directory);
  return apps.find((path) => basename(path) === preferred)
    || apps.find((path) => !path.includes("PackageFrameworks"))
    || "";
}

function containsDebugDylib(appPath) {
  return readdirSync(appPath).some((name) => name.endsWith(".debug.dylib"));
}

function packageBuiltApp(appPath, exportPath, scheme) {
  const staging = join(exportPath, ".ipa-staging");
  const payload = join(staging, "Payload");
  const ipaPath = join(exportPath, `${safeName(scheme || basename(appPath, ".app"))}.ipa`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(payload, { recursive: true });
  cpSync(appPath, join(payload, basename(appPath)), { recursive: true, preserveTimestamps: true });
  const result = spawnSync("/usr/bin/ditto", [
    "-c", "-k", "--sequesterRsrc", "--keepParent", payload, ipaPath,
  ], { encoding: "utf8" });
  rmSync(staging, { recursive: true, force: true });
  if (result.status !== 0 || !existsSync(ipaPath)) {
    throw new DeviceBuildError(String(result.stderr || "Unable to package the signed Debug app.").trim());
  }
  return ipaPath;
}

function displayNameFromIpa(ipaPath) {
  const name = basename(ipaPath, ".ipa").trim();
  return name || "";
}

function updateSafetyWarnings(build) {
  const warnings = [];
  if (!build.app.bundleIdentifier) {
    warnings.push("Swift Sim could not identify this app, so iOS may not update the existing copy.");
  }
  if (!build.app.teamID) {
    warnings.push("Xcode signing is not ready, so the install may fail.");
  }
  if (build.exportMethod !== "development" && build.exportMethod !== "ad-hoc") {
    warnings.push("This build must use development or ad hoc signing to install directly.");
  }
  return warnings;
}

function publicInstallation(installation = {}) {
  return {
    state: installation.state || "unknown",
    requestedAt: installation.requestedAt || "",
    verifiedAt: installation.verifiedAt || "",
    devices: (installation.devices || []).map((device) => ({
      name: device.name || "iPhone",
      state: device.state || "unknown",
      version: device.version || "",
      build: device.build || "",
    })),
  };
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "App";
}

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function required(value, name) {
  if (!value) throw new DeviceBuildError(`Missing ${name}.`);
  return value;
}

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
