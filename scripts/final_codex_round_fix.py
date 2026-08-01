from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, value: str) -> None:
    Path(path).write_text(value)


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


# 1. Make failed lock-creation cleanup conditional on the exact directory inode.
lock_path = "mac-helper/src/liveEngineLifecycleLock.js"
lock_source = read(lock_path)
lock_source = replace_once(
    lock_source,
    '''import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
''',
    '''import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
''',
    "lock fs imports",
)
lock_source = replace_once(
    lock_source,
    '''  let created = false;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    created = true;
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return () => releaseOwnedLock(lockPath, ownerPath, owner);
  } catch (error) {
    if (created) {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
      throw error;
    }
''',
    '''  let createdObservation = null;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    createdObservation = observePath(lockPath);
    if (!createdObservation) throw new Error("Unable to observe the new live-engine lifecycle lock.");
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return () => releaseOwnedLock(lockPath, ownerPath, owner);
  } catch (error) {
    if (createdObservation) {
      cleanupCreatedLockDirectory(lockPath, createdObservation);
      throw error;
    }
''',
    "created lock cleanup",
)
lock_source = replace_once(
    lock_source,
    '''function releaseOwnedLock(lockPath, ownerPath, owner) {
''',
    '''export function cleanupCreatedLockDirectory(lockPath, createdObservation) {
  const ownerPath = join(lockPath, "owner.json");
  if (existsSync(ownerPath)) return false;
  const currentObservation = observePath(lockPath);
  if (!samePath(currentObservation, createdObservation)) return false;
  const quarantinePath = `${lockPath}.abandoned.${process.pid}.${randomUUID()}`;
  try {
    renameSync(lockPath, quarantinePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  const quarantinedObservation = observePath(quarantinePath);
  if (!samePath(quarantinedObservation, createdObservation)) {
    try { renameSync(quarantinePath, lockPath); } catch {}
    return false;
  }
  try { rmSync(quarantinePath, { recursive: true, force: true }); } catch {}
  return true;
}

function releaseOwnedLock(lockPath, ownerPath, owner) {
''',
    "created lock cleanup helper",
)
write(lock_path, lock_source)


# 2. Normalize expanded signing identities and expose one lifecycle lease for
# the complete live-enabled build generation.
live_path = "mac-helper/src/liveReload.js"
live_source = read(live_path)
live_source = replace_once(
    live_source,
    '''export async function registerLiveBuildResult(options) {
  return withLiveEngineLifecycleLock(() => registerLiveBuildResultUnlocked(options));
}

async function registerLiveBuildResultUnlocked({ resultBundle }) {
''',
    '''export async function registerLiveBuildResult(options) {
  return withLiveEngineLifecycleLock(() => registerLiveBuildResultUnlocked(options));
}

export async function withLiveBuildSession(options, operation, runtime = {}) {
  if (typeof operation !== "function") throw new TypeError("A live build operation is required.");
  const lock = runtime.lock || withLiveEngineLifecycleLock;
  const start = runtime.start || startLiveReloadUnlocked;
  const register = runtime.register || registerLiveBuildResultUnlocked;
  return lock(async () => {
    const liveSession = await start(options);
    return operation({
      liveSession,
      registerLiveBuildResult: register,
    });
  });
}

async function registerLiveBuildResultUnlocked({ resultBundle }) {
''',
    "live build session lease",
)
live_source = replace_once(
    live_source,
    '''  const output = String(settings.stdout || "");
  const expanded = output.match(/^\\s*EXPANDED_CODE_SIGN_IDENTITY\\s*=\\s*([A-F0-9]{40})\\s*$/m)?.[1];
  if (expanded) return expanded;
''',
    '''  const output = String(settings.stdout || "");
  const expanded = expandedSigningIdentities(output);
  if (expanded.length > 0) return expanded;
''',
    "expanded signing return",
)
live_source = replace_once(
    live_source,
    '''function resolveSigningIdentities(projectPath, scheme = "") {
''',
    '''export function expandedSigningIdentities(output) {
  const expanded = String(output || "")
    .match(/^\\s*EXPANDED_CODE_SIGN_IDENTITY\\s*=\\s*([A-F0-9]{40})\\s*$/m)?.[1] || "";
  return expanded ? [expanded] : [];
}

function resolveSigningIdentities(projectPath, scheme = "") {
''',
    "expanded signing helper",
)
write(live_path, live_source)


# 3. Hold the lifecycle lease across start, compile, and registration.
builder_path = "mac-helper/src/deviceBuilderCore.js"
builder = read(builder_path)
builder = replace_once(
    builder,
    '''import {
  registerLiveBuildResult,
  startLiveReload,
} from "./liveReload.js";
''',
    '''import { withLiveBuildSession } from "./liveReload.js";
''',
    "device builder live import",
)
old_live_block = '''    let liveSession = null;
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
'''
new_live_block = '''    let liveBuildEntered = false;
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
'''
builder = replace_once(builder, old_live_block, new_live_block, "complete live build workflow")
write(builder_path, builder)


# Focused regressions for all three defects.
lock_test_path = "test/liveEngineLifecycleLock.test.js"
lock_test = read(lock_test_path)
lock_test = replace_once(
    lock_test,
    'import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";\n',
    'import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";\n',
    "lock test fs imports",
)
lock_test = replace_once(
    lock_test,
    'import { withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";\n',
    'import { cleanupCreatedLockDirectory, withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";\n',
    "lock test subject import",
)
if 'test("failed creator cleanup never deletes a replacement lock"' not in lock_test:
    lock_test += '''\n\ntest("failed creator cleanup never deletes a replacement lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-replacement-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  const displacedPath = join(directory, "displaced.lock");
  mkdirSync(lockPath, { recursive: true });
  const stat = statSync(lockPath);
  const originalObservation = { device: String(stat.dev), inode: String(stat.ino), mtimeMs: stat.mtimeMs };
  renameSync(lockPath, displacedPath);
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "sentinel"), "replacement");
  try {
    assert.equal(cleanupCreatedLockDirectory(lockPath, originalObservation), false);
    assert.equal(existsSync(join(lockPath, "sentinel")), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("failed creator cleanup removes only its unchanged ownerless directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-created-lock-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  const stat = statSync(lockPath);
  const observation = { device: String(stat.dev), inode: String(stat.ino), mtimeMs: stat.mtimeMs };
  try {
    assert.equal(cleanupCreatedLockDirectory(lockPath, observation), true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
write(lock_test_path, lock_test)

integration_path = "test/mainPostMergeIntegration.test.js"
integration = read(integration_path)
integration = replace_once(
    integration,
    '''  classifySwiftSource,
  LIVE_REASON_CODES,
''',
    '''  classifySwiftSource,
  expandedSigningIdentities,
  LIVE_REASON_CODES,
''',
    "integration signing import",
)
integration = replace_once(
    integration,
    '''  workspaceProjectReferences,
  xcodeContainerArguments,
''',
    '''  withLiveBuildSession,
  workspaceProjectReferences,
  xcodeContainerArguments,
''',
    "integration live session import",
)
if 'test("expanded signing identity remains one candidate"' not in integration:
    integration += '''\n\ntest("expanded signing identity remains one candidate", () => {
  const identity = "A".repeat(40);
  assert.deepEqual(
    expandedSigningIdentities(`    EXPANDED_CODE_SIGN_IDENTITY = ${identity}\\n`),
    [identity],
  );
});

test("live build session keeps start, build, and registration under one lock", async () => {
  const events = [];
  const result = await withLiveBuildSession(
    { project: "/tmp/App.xcodeproj/project.pbxproj" },
    async ({ liveSession, registerLiveBuildResult }) => {
      events.push(`build:${liveSession.host}`);
      await registerLiveBuildResult({ resultBundle: "/tmp/App.xcresult" });
      events.push("build-complete");
      return "done";
    },
    {
      lock: async (operation) => {
        events.push("lock-start");
        const value = await operation();
        events.push("lock-end");
        return value;
      },
      start: async () => {
        events.push("start");
        return { started: true, host: "100.64.0.1" };
      },
      register: async () => {
        events.push("register");
        return { registered: 1 };
      },
    },
  );
  assert.equal(result, "done");
  assert.deepEqual(events, [
    "lock-start",
    "start",
    "build:100.64.0.1",
    "register",
    "build-complete",
    "lock-end",
  ]);
});

test("device live build uses the complete lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/deviceBuilderCore.js", "utf8");
  assert.match(source, /await withLiveBuildSession\(/);
  assert.doesNotMatch(source, /await startLiveReload\(/);
  assert.doesNotMatch(source, /await registerLiveBuildResult\(/);
});
'''
write(integration_path, integration)

print("Applied final Codex lifecycle fixes.")
