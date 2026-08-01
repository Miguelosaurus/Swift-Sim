import { spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { homedir } from "node:os";
import { deviceAppIdentity, MAX_DEVICE_BUILD_LOG_LINES } from "./deviceBuildStore.js";
import { withLiveBuildSession } from "./liveReload.js";

export class DeviceBuildError extends Error {}

export async function runDeviceBuild(build, {
  save,
  logger = () => {},
  nextBuildNumber = (_app, current) => current,
} = {}) {
  const saveBuild = () => save?.(build);
  let lastLogSaveAt = 0;
  const log = (message) => {
    build.logs.push(message);
    if (build.logs.length > MAX_DEVICE_BUILD_LOG_LINES) {
      build.logs.splice(0, build.logs.length - MAX_DEVICE_BUILD_LOG_LINES);
    }
    logger(message);
    const now = Date.now();
    if (now - lastLogSaveAt >= 1_000) {
      lastLogSaveAt = now;
      try {
        saveBuild();
      } catch (error) {
        // Deletion writes the cancellation marker before removing state. Do not
        // let a progress-log callback crash the helper while runBuffered is
        // already terminating the owned process group.
        if (error?.code !== "SWIFT_SIM_BUILD_CANCELLED") throw error;
      }
    }
  };

  try {
    build.state = "preparing";
    saveBuild();
    const target = resolveTarget(build);
    const requestedBuildSettingArgs = xcodeBuildSettingArgs(build.buildSettings);
    const liveEligible = String(build.configuration || "").toLowerCase() === "debug"
      && target.type === "project"
      && projectHasLivePackage(target);
    let buildSettingArgs = liveEligible
      ? [...requestedBuildSettingArgs, ...managedLiveBuildSettings()]
      : requestedBuildSettingArgs;
    throwIfBuildCancelled(build);
    const root = build.artifacts?.root || join(homedir(), ".swift-sim", "device-builds", build.id);
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
      build,
    });
    const resolvedIdentity = {
      bundleIdentifier: settings.PRODUCT_BUNDLE_IDENTIFIER || "",
      teamID: settings.DEVELOPMENT_TEAM || "",
    };
    assertRebuildIdentity(build, resolvedIdentity);
    const projectBuildNumber = settings.CURRENT_PROJECT_VERSION || "";
    const automaticBuildNumber = String(nextBuildNumber(resolvedIdentity, projectBuildNumber) || "");
    if (automaticBuildNumber && automaticBuildNumber !== projectBuildNumber) {
      buildSettingArgs = [
        ...buildSettingArgs.filter((setting) => !String(setting).startsWith("CURRENT_PROJECT_VERSION=")),
        `CURRENT_PROJECT_VERSION=${automaticBuildNumber}`,
      ];
      settings.CURRENT_PROJECT_VERSION = automaticBuildNumber;
      log(`Using build number ${automaticBuildNumber} so every Swift Sim build is distinct.`);
    }
    build.app.bundleIdentifier = resolvedIdentity.bundleIdentifier;
    build.app.version = settings.MARKETING_VERSION || "";
    build.app.build = settings.CURRENT_PROJECT_VERSION || "";
    build.app.teamID = resolvedIdentity.teamID;
    build.app.identity = deviceAppIdentity(build.app);
    build.signing.style = settings.CODE_SIGN_STYLE || "";
    build.signing.deviceInstallable = Boolean(build.app.bundleIdentifier && build.app.teamID);
    build.signing.updateSafe = build.preserveData ? "same-bundle-update" : "reinstall-requested";
    build.signing.warnings = updateSafetyWarnings(build);
    saveBuild();

    build.state = "archiving";
    saveBuild();
    let liveBuildEntered = false;
    if (liveEligible && target.type === "project") {
      try {
        const liveResult = await withLiveBuildSession({
          project: join(target.path, "project.pbxproj"),
          scheme: build.scheme,
        }, async ({ liveSession, registerLiveBuildResult: registerBuildResult }) => {
          if (!liveSession.started) return { completed: false, liveSession };
          liveBuildEntered = true;
          build.liveReload = {
            eligible: true,
            engineReady: true,
            compilerReady: false,
            host: liveSession.host,
          };
          log("Preparing Swift Sim's private live patch lane.");

          build.state = "building";
          saveBuild();
          const derivedDataPath = join(root, "DerivedData");
          const destination = build.allowProvisioningUpdates
            ? preferredPhysicalIOSDestination()
            : "generic/platform=iOS";
          log("Building the signed live-enabled Debug app.");
          await runLogged("xcodebuild", [
            ...targetArgs(target),
            "-scheme", required(build.scheme, "scheme"),
            "-configuration", build.configuration || "Debug",
            ...buildSettingArgs,
            "-destination", destination,
            "-derivedDataPath", derivedDataPath,
            "-resultBundlePath", resultBundlePath,
            ...(build.allowProvisioningUpdates
              ? [
                  "-allowProvisioningUpdates",
                  ...(destination === "generic/platform=iOS"
                    ? []
                    : ["-allowProvisioningDeviceRegistration"]),
                ]
              : []),
            "build",
          ], log, {
            env: {
              ...process.env,
              INJECTION_HOST: liveSession.host,
            },
            build,
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
            const capture = await registerBuildResult({ resultBundle: resultBundlePath });
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
          return { completed: true, liveSession };
        });
        if (liveResult.completed) return build;
        build.liveReload = {
          eligible: true,
          engineReady: false,
          compilerReady: false,
          error: liveResult.liveSession?.error || "The live engine was not ready.",
        };
        log("Live patch preparation was unavailable; the signed install will still continue.");
      } catch (error) {
        if (liveBuildEntered) throw error;
        build.liveReload = {
          eligible: true,
          engineReady: false,
          compilerReady: false,
          error: error instanceof Error ? error.message : String(error),
        };
        log("Live patch preparation was unavailable; the signed install will still continue.");
      }
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
    ], log, { build });

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
    ], log, { build });

    const ipaPath = findIpa(exportPath);
    if (!ipaPath) throw new DeviceBuildError("Xcode export finished, but no IPA was produced.");
    build.artifacts.ipaPath = ipaPath;
    build.app.name = displayNameFromIpa(ipaPath) || build.scheme || basename(ipaPath, ".ipa");

    build.state = "ready";
    saveBuild();
    log("Build is ready to install.");
    return build;
  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
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

export function assertRebuildIdentity(build, resolvedIdentity) {
  const expectedBundleIdentifier = build.rebuild?.expectedBundleIdentifier || "";
  const expectedTeamID = build.rebuild?.expectedTeamID || "";
  if (!expectedBundleIdentifier && !expectedTeamID) return;

  const bundleMatches = expectedBundleIdentifier === resolvedIdentity.bundleIdentifier;
  const teamMatches = expectedTeamID === resolvedIdentity.teamID;
  if (!bundleMatches || !teamMatches) {
    throw new DeviceBuildError(
      "Build stopped because the app identity or signing team changed. Open the project on your Mac and create a new trusted build recipe."
    );
  }
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

async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs, build }) {
  const collector = createBuildSettingsCollector();
  const result = await runBuffered("xcodebuild", [
    ...targetArgs(target),
    "-scheme", required(scheme, "scheme"),
    "-configuration", configuration || "Release",
    ...buildSettingArgs,
    "-destination", "generic/platform=iOS",
    ...(allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    "-showBuildSettings",
  ], {
    cancelPath: build?.control?.cancelPath || "",
    onLine: (line) => collectBuildSettingLine(collector, line),
  });
  if (result.cancellationError) throw result.cancellationError;
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || "Unable to read Xcode build settings.");
  }
  return selectApplicationBuildSettings(collector, scheme);
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

export function parseBuildSettings(output, scheme = "") {
  const collector = createBuildSettingsCollector();
  for (const line of String(output || "").split(/\r?\n/)) collectBuildSettingLine(collector, line);
  return selectApplicationBuildSettings(collector, scheme);
}

function createBuildSettingsCollector() {
  return { sections: [], current: null, loose: {} };
}

function collectBuildSettingLine(collector, line) {
  const header = String(line || "").match(/^Build settings for action .* and target (.+):\s*$/);
  if (header) {
    const section = { target: header[1].trim(), settings: {} };
    collector.sections.push(section);
    collector.current = section;
    return;
  }
  const match = String(line || "").match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (!match) return;
  const destination = collector.current?.settings || collector.loose;
  destination[match[1]] = match[2].trim();
}

function selectApplicationBuildSettings(collector, scheme = "") {
  const normalizedScheme = String(scheme || "").trim();
  const candidates = collector.sections.filter(({ settings }) => {
    const productType = String(settings.PRODUCT_TYPE || "");
    return settings.WRAPPER_EXTENSION === "app"
      && !productType.includes("app-extension")
      && !productType.includes("unit-test")
      && !productType.includes("ui-testing");
  });
  const scored = candidates
    .map((section) => ({ section, score: applicationSectionScore(section, normalizedScheme) }))
    .sort((a, b) => b.score - a.score || a.section.target.localeCompare(b.section.target));

  if (scored.length === 1 || (scored.length > 1 && scored[0].score > scored[1].score)) {
    return scored[0].section.settings;
  }
  if (scored.length > 1) {
    const hostApps = scored.filter(({ section }) =>
      section.settings.PRODUCT_TYPE === "com.apple.product-type.application"
    );
    if (hostApps.length === 1) return hostApps[0].section.settings;
    const names = scored.map(({ section }) => section.target).join(", ");
    throw new DeviceBuildError(
      `Xcode reported multiple equally likely application targets for scheme ${normalizedScheme || "(unknown)"}: ${names}.`
    );
  }
  if (Object.keys(collector.loose).length > 0
      && collector.loose.WRAPPER_EXTENSION === "app"
      && !String(collector.loose.PRODUCT_TYPE || "").includes("app-extension")) {
    return collector.loose;
  }
  throw new DeviceBuildError(`Xcode did not report an application target for scheme ${normalizedScheme || "(unknown)"}.`);
}

function applicationSectionScore({ target, settings }, scheme) {
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

function targetArgs(target) {
  return target.type === "workspace"
    ? ["-workspace", target.path]
    : ["-project", target.path];
}

async function runLogged(command, args, log, { env = process.env, build } = {}) {
  const result = await runBuffered(command, args, {
    onLine: log,
    timeoutMs: 30 * 60 * 1000,
    env,
    cancelPath: build?.control?.cancelPath || "",
  });
  if (result.cancellationError) throw result.cancellationError;
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || `${command} failed with exit code ${result.code}`);
  }
  return result;
}

export function runBuffered(command, args, {
  onLine,
  timeoutMs = 120_000,
  env = process.env,
  cancelPath = "",
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let stdoutPending = "";
    let stderrPending = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;
    let terminating = false;
    let cancellationTimer;
    let timer;
    let workerRecordError = null;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      try {
        mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
        writeFileSync(workerPath, JSON.stringify({
          pid: child.pid,
          startedAt: requiredProcessStartedAt(child.pid),
          command,
          createdAt: new Date().toISOString(),
        }), { mode: 0o600 });
      } catch (error) {
        workerRecordError = error;
      }
    }

    const invokeLine = (line) => {
      if (!line.trim() || !onLine) return null;
      try {
        onLine(line);
        return null;
      } catch (error) {
        return error;
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      if (workerPath && !result?.preserveWorkerRecord) rmSync(workerPath, { force: true });
      resolve(result);
    };

    const terminateOnce = (resultFactory) => {
      if (settled || terminating) return;
      terminating = true;
      clearInterval(cancellationTimer);
      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        finish({ ...resultFactory(terminated), preserveWorkerRecord: !terminated });
      });
    };

    if (workerRecordError) {
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: `Unable to persist the active build worker identity: ${workerRecordError instanceof Error ? workerRecordError.message : String(workerRecordError)}${terminated ? "" : "; process group could not be confirmed stopped"}`,
      }));
      return;
    }

    const outputCallbackFailed = (error) => {
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: `Output handler failed: ${error instanceof Error ? error.message : String(error)}${terminated ? "" : "; process group could not be confirmed stopped"}`,
      }));
    };

    const flushLines = (value, isError) => {
      const combined = (isError ? stderrPending : stdoutPending) + value;
      const lines = combined.split(/\r?\n/);
      const pending = lines.pop() || "";
      if (isError) stderrPending = pending;
      else stdoutPending = pending;
      for (const line of lines) {
        const error = invokeLine(line);
        if (error) return error;
      }
      return null;
    };

    if (cancelPath) {
      cancellationTimer = setInterval(() => {
        if (!existsSync(cancelPath) || settled || terminating) return;
        terminateOnce((_terminated) => {
          const error = new DeviceBuildError("Device build was cancelled.");
          error.code = "SWIFT_SIM_BUILD_CANCELLED";
          return { code: null, stdout, stderr, error: error.message, cancellationError: error };
        });
      }, 100);
      cancellationTimer.unref?.();
    }

    timer = setTimeout(() => {
      if (settled || terminating) return;
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: terminated
          ? `${command} timed out`
          : `${command} timed out and its process group could not be confirmed stopped`,
      }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (settled || terminating) return;
      const value = stdoutDecoder.write(chunk);
      stdout = appendBoundedOutput(stdout, value);
      const error = flushLines(value, false);
      if (error) outputCallbackFailed(error);
    });
    child.stderr.on("data", (chunk) => {
      if (settled || terminating) return;
      const value = stderrDecoder.write(chunk);
      stderr = appendBoundedOutput(stderr, value);
      const error = flushLines(value, true);
      if (error) outputCallbackFailed(error);
    });
    child.on("error", (error) => {
      if (terminating) return;
      finish({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (terminating || settled) return;
      const stdoutTail = stdoutDecoder.end();
      const stderrTail = stderrDecoder.end();
      stdout = appendBoundedOutput(stdout, stdoutTail);
      stderr = appendBoundedOutput(stderr, stderrTail);
      const pendingError = flushLines(stdoutTail, false)
        || flushLines(stderrTail, true)
        || invokeLine(stdoutPending)
        || invokeLine(stderrPending);
      if (pendingError) {
        outputCallbackFailed(pendingError);
        return;
      }
      terminating = true;
      void (async () => {
        const exited = await waitForProcessGroupExit(child.pid, 500);
        const terminated = exited || await terminateProcessGroup(child.pid, 2_000);
        if (!terminated) {
          finish({
            code: null,
            stdout,
            stderr,
            error: `${command} exited, but its process group could not be confirmed stopped`,
            preserveWorkerRecord: true,
          });
          return;
        }
        if (code === 0 && !exited) {
          finish({
            code: null,
            stdout,
            stderr,
            error: `${command} exited successfully while descendant processes were still running`,
          });
          return;
        }
        finish({ code, stdout, stderr, error: code === 0 ? "" : (stderr || stdout) });
      })();
    });
  });
}

async function terminateProcessGroup(pid, graceMs) {
  signalProcessGroup(pid, "SIGTERM");
  if (await waitForProcessGroupExit(pid, graceMs)) return true;
  signalProcessGroup(pid, "SIGKILL");
  return waitForProcessGroupExit(pid, 2_000);
}

export function requestDeviceBuildCancellation(build, reason = "Device build cancelled.") {
  const cancelPath = build?.control?.cancelPath || "";
  if (!cancelPath) return false;
  mkdirSync(dirname(cancelPath), { recursive: true, mode: 0o700 });
  writeFileSync(cancelPath, JSON.stringify({
    buildId: build.id,
    reason,
    cancelledAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return true;
}

export async function terminateRecordedDeviceBuildWorker(build) {
  const workerPath = build?.control?.cancelPath ? `${build.control.cancelPath}.worker.json` : "";
  if (!workerPath || !existsSync(workerPath)) return true;
  let record;
  try { record = JSON.parse(readFileSync(workerPath, "utf8")); } catch { return false; }
  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (record.startedAt && processStartedAt(pid) !== record.startedAt) {
    rmSync(workerPath, { force: true });
    return true;
  }
  const terminated = await terminateProcessGroup(pid, 2_000);
  if (terminated) rmSync(workerPath, { force: true });
  return terminated;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
  }
  throw new Error("Unable to establish the active build worker process identity.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function signalProcessGroup(pid, signal) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return;
  try { process.kill(-Number(pid), signal); } catch {
    try { process.kill(Number(pid), signal); } catch {}
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid) && Date.now() < deadline) {
    await sleep(50);
  }
  return !processGroupIsAlive(pid);
}

function processGroupIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(-Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function throwIfBuildCancelled(build) {
  if (!build.control?.cancelPath || !existsSync(build.control.cancelPath)) return;
  const error = new DeviceBuildError("Device build was cancelled.");
  error.code = "SWIFT_SIM_BUILD_CANCELLED";
  throw error;
}

function appendBoundedOutput(current, addition, maxCharacters = 1_000_000) {
  const combined = current + addition;
  return combined.length <= maxCharacters ? combined : combined.slice(-maxCharacters);
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

function preferredPhysicalIOSDestination() {
  const result = spawnSync("xcrun", ["xcdevice", "list", "--timeout", "3"], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return physicalIOSDestination(result.status === 0 ? result.stdout : "");
}

export function physicalIOSDestination(output) {
  try {
    const devices = JSON.parse(String(output || "[]"));
    const device = devices.find((candidate) =>
      candidate?.platform === "com.apple.platform.iphoneos"
      && candidate?.simulator === false
      && candidate?.available === true
      && typeof candidate?.identifier === "string"
      && candidate.identifier
    );
    return device ? `platform=iOS,id=${device.identifier}` : "generic/platform=iOS";
  } catch {
    return "generic/platform=iOS";
  }
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
