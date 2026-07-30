#!/usr/bin/env python3
from pathlib import Path
import re

MARKER = "round4-final-fencing"

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing anchor: {label}")
    return text.replace(old, new, 1)

def regex_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected one match for {label}, got {count}")
    return next_text

# Complete Swift build-view fencing and owner provenance.
path = Path("Companion/SwiftSimCompanion/SessionStore.swift")
text = path.read_text()
if MARKER not in text:
    duplicate_guard = '''            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
'''
    single_guard = '''            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
'''
    text = replace_once(text, duplicate_guard, single_guard, "duplicate status guard")
    text = replace_once(text,
        '''            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
            let managedBuild = ManagedBuild(session: resolvedSession, status: decoded)
''',
        '''            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            if resolvedSession != build { deviceBuildViewRevision &+= 1 }
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
            let managedBuild = ManagedBuild(session: resolvedSession, status: decoded)
''',
        "status token generation")
    text = replace_once(text,
        '''        guard let session = SimulatorSession(url: url) else { return false }
        currentSession = session
        currentDeviceBuild = nil
''',
        '''        guard let session = SimulatorSession(url: url) else { return false }
        deviceBuildViewRevision &+= 1
        currentSession = session
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
''',
        "open simulator invalidates build")
    text = replace_once(text,
        '''    func reopen(_ recent: RecentSession) {
        currentSession = recent.session
        activeTransport = nil
''',
        '''    func reopen(_ recent: RecentSession) {
        deviceBuildViewRevision &+= 1
        currentSession = recent.session
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
        activeTransport = nil
''',
        "reopen simulator invalidates build")
    text = replace_once(text,
        '''    func openManagedApp(_ app: ManagedApp) {
        selectedManagedAppID = app.id
        currentSession = nil
        currentDeviceBuild = nil
''',
        '''    func openManagedApp(_ app: ManagedApp) {
        deviceBuildViewRevision &+= 1
        selectedManagedAppID = app.id
        currentSession = nil
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
''',
        "open app invalidates build")
    text = regex_once(text,
        r'''    func syncCurrentBuildInstallRequested\(\) async \{.*?\n    \}\n\n    func prepareCurrentBuildInstallURL''',
        '''    func syncCurrentBuildInstallRequested() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        var request = URLRequest(url: build.installRequestURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(DeviceBuildStatus.self, from: data),
              Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
              ) else {
            if Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) {
                deviceBuildActionMessage = "Install opened. Status will update when your Mac reconnects."
            }
            return
        }
        deviceBuildStatus = decoded
        upsertManagedBuild(ManagedBuild(session: build, status: decoded))
    }

    func prepareCurrentBuildInstallURL''',
        "install request fencing")
    text = replace_once(text,
        '''    func prepareCurrentBuildInstallURL() async -> URL? {
        guard let build = currentDeviceBuild else { return nil }

        if deviceBuildStatus?.isReady != true {
            await refreshDeviceBuild()
        }

        guard let status = deviceBuildStatus, status.isReady else {
''',
        '''    func prepareCurrentBuildInstallURL() async -> URL? {
        guard let build = currentDeviceBuild else { return nil }

        if deviceBuildStatus?.isReady != true {
            await refreshDeviceBuild()
        }

        guard currentDeviceBuild?.id == build.id else { return nil }
        guard let status = deviceBuildStatus, status.isReady else {
''',
        "install URL view fencing")
    text = replace_once(text,
        '''            let decoded = try await fetchDeviceBuildStatus(
                urls: preferredDeviceBuildURLs(
                    direct: build.verifyURL,
                    paired: pairedMac?.buildVerifyURL(build.id)
                ),
                method: "POST",
                timeout: 25
            )
            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            currentDeviceBuild = resolvedSession
''',
        '''            let decoded = try await fetchDeviceBuildStatus(
                urls: preferredDeviceBuildURLs(
                    direct: build.verifyURL,
                    paired: pairedMac?.buildVerifyURL(build.id)
                ),
                method: "POST",
                timeout: 25
            )
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            if resolvedSession != build { deviceBuildViewRevision &+= 1 }
            currentDeviceBuild = resolvedSession
''',
        "verification response fencing")
    text = replace_once(text,
        '''        if let index = managedApps.firstIndex(where: { $0.id == build.appID }) {
            managedApps[index] = managedApps[index].upserting(build)
        } else {
''',
        '''        if let index = managedApps.firstIndex(where: { $0.id == build.appID }) {
            let alreadyOwnedBuild = managedApps[index].builds.contains { $0.id == build.id }
            var updated = managedApps[index].upserting(build)
            if managedApps[index].ownerPairingID != nil && !alreadyOwnedBuild {
                // A link from an unknown Mac must not inherit authority to mutate
                // a same-identity app on the currently paired Mac.
                updated.ownerPairingID = nil
            }
            managedApps[index] = updated
        } else {
''',
        "foreign link provenance")
    text = replace_once(text,
        '''        currentRevision == expectedRevision && current?.id == expected.id
    }
''',
        '''        // round4-final-fencing
        currentRevision == expectedRevision && current == expected
    }
''',
        "full session response identity")
path.write_text(text)

# Preserve active install requests across transient unknown observations.
path = Path("mac-helper/src/deviceBuildStoreCore.js")
text = path.read_text()
if "ACTIVE_INSTALL_OBSERVATION_STATES" not in text:
    text = replace_once(text,
        '''const OWNERLESS_LOCK_GRACE_MS = 250;
''',
        '''const OWNERLESS_LOCK_GRACE_MS = 250;
const ACTIVE_INSTALL_OBSERVATION_STATES = new Set(["requested", "not-installed", "different-version"]);
''',
        "active install states")
    text = replace_once(text,
        '''      const nextState = reportedState === "unknown" && previous.state === "requested"
        ? "requested"
        : reportedState;
''',
        '''      const nextState = reportedState === "unknown"
        && ACTIVE_INSTALL_OBSERVATION_STATES.has(previous.state)
        ? previous.state
        : reportedState;
''',
        "preserve active observation")
path.write_text(text)

# Make worker-record creation fail safe and fence successful Xcode descendants.
path = Path("mac-helper/src/deviceBuilderCore.js")
text = path.read_text()
if "workerRecordError" not in text:
    text = replace_once(text,
        '''    let settled = false;
    let terminating = false;
    let cancellationTimer;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
      writeFileSync(workerPath, JSON.stringify({
        pid: child.pid,
        startedAt: requiredProcessStartedAt(child.pid),
        command,
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 });
    }
''',
        '''    let settled = false;
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
''',
        "builder worker record safety")
    text = replace_once(text,
        '''    const outputCallbackFailed = (error) => {
''',
        '''    if (workerRecordError) {
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: `Unable to persist the active build worker identity: ${workerRecordError instanceof Error ? workerRecordError.message : String(workerRecordError)}${terminated ? "" : "; process group could not be confirmed stopped"}`,
      }));
      return;
    }

    const outputCallbackFailed = (error) => {
''',
        "builder early worker failure")
    text = replace_once(text,
        '''    const timer = setTimeout(() => {
''',
        '''    timer = setTimeout(() => {
''',
        "builder timer declaration")
    text = regex_once(text,
        r'''    child\.on\("close", \(code\) => \{.*?\n    \}\);\n''',
        '''    child.on("close", (code) => {
      if (terminating || settled) return;
      const pendingError = invokeLine(stdoutPending) || invokeLine(stderrPending);
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
''',
        "builder normal descendant fence")
    text = replace_once(text,
        '''  return "";
}

function processStartedAt''',
        '''  throw new Error("Unable to establish the active build worker process identity.");
}

function processStartedAt''',
        "builder required identity")
path.write_text(text)

# Make validation worker-record creation fail safe too.
path = Path("mac-helper/src/buildValidation.js")
text = path.read_text()
if "validationWorkerRecordError" not in text:
    text = replace_once(text,
        '''    let settled = false;
    let terminating = false;
    let cancellationTimer;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
      writeFileSync(workerPath, JSON.stringify({
        pid: child.pid,
        startedAt: requiredProcessStartedAt(child.pid),
        command: "required-validation",
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 });
    }
''',
        '''    let settled = false;
    let terminating = false;
    let cancellationTimer;
    let timeoutTimer;
    let validationWorkerRecordError = null;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      try {
        mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
        writeFileSync(workerPath, JSON.stringify({
          pid: child.pid,
          startedAt: requiredProcessStartedAt(child.pid),
          command: "required-validation",
          createdAt: new Date().toISOString(),
        }), { mode: 0o600 });
      } catch (error) {
        validationWorkerRecordError = error;
      }
    }
''',
        "validation worker record safety")
    text = replace_once(text,
        '''    const timeoutTimer = setTimeout(() => {
''',
        '''    if (validationWorkerRecordError) {
      terminate(validationError(
        `Unable to persist the active validation worker identity: ${validationWorkerRecordError instanceof Error ? validationWorkerRecordError.message : String(validationWorkerRecordError)}`
      ));
      return;
    }

    timeoutTimer = setTimeout(() => {
''',
        "validation early worker failure")
    text = replace_once(text,
        '''  return "";
}

function signalProcessGroup''',
        '''  throw new Error("Unable to establish the active validation worker process identity.");
}

function signalProcessGroup''',
        "validation required identity")
path.write_text(text)

# Track CLI builds and renewals across signals/shutdown, and migrate legacy deadlines.
path = Path("mac-helper/bin/swift-sim-helper.js")
text = path.read_text()
if "runCLIDeviceBuild" not in text:
    text = replace_once(text,
        '''    const build = await createDeviceBuild(values);
    await runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) });
    build.state = "delivering";
    deviceBuildStore.save(build);
    await prepareDeviceDelivery(build);
''',
        '''    const build = await createDeviceBuild(values);
    await runCLIDeviceBuild(build);
''',
        "CLI build signal management")
    text = replace_once(text,
        '''        const renewedBuild = deviceBuildStore.renewInstallLink(build.id, { ttlMinutes: build.installTTLMinutes });
        try {
          await prepareDeviceDelivery(renewedBuild, { markBuildFailed: false });
        } catch (error) {
          renewedBuild.expiresAt = previousDelivery.expiresAt;
          renewedBuild.remoteBaseUrl = previousDelivery.remoteBaseUrl;
          renewedBuild.delivery = previousDelivery.delivery;
          deviceBuildStore.save(renewedBuild);
          throw error;
        }
        renewedBuild.logs.push("A new install link was generated from the saved app.");
        deviceBuildStore.save(renewedBuild);
''',
        '''        const renewedBuild = deviceBuildStore.renewInstallLink(build.id, { ttlMinutes: build.installTTLMinutes });
        const renewalKey = `renewal:${build.id}:${renewedBuild.pendingRenewal?.id || "unknown"}`;
        await trackDeviceBuildTask(renewalKey, renewedBuild, (async () => {
          try {
            await prepareDeviceDelivery(renewedBuild, { markBuildFailed: false });
          } catch (error) {
            renewedBuild.expiresAt = previousDelivery.expiresAt;
            renewedBuild.remoteBaseUrl = previousDelivery.remoteBaseUrl;
            renewedBuild.delivery = previousDelivery.delivery;
            deviceBuildStore.save(renewedBuild);
            throw error;
          }
          renewedBuild.logs.push("A new install link was generated from the saved app.");
          deviceBuildStore.save(renewedBuild);
        })());
''',
        "tracked renewal")
    text = replace_once(text,
        '''  const deadline = Date.parse(installation.verificationDeadlineAt || "");
  return Number.isFinite(deadline) && deadline > Date.now();
''',
        '''  const deadline = Date.parse(installation.verificationDeadlineAt || "");
  if (Number.isFinite(deadline)) return deadline > Date.now();
  const requestedAt = Date.parse(installation.requestedAt || "");
  return Number.isFinite(requestedAt) && requestedAt + 15 * 60 * 1000 > Date.now();
''',
        "legacy verification deadline")
    text = replace_once(text,
        '''function startManagedDeviceBuild(build) {
  const promise = runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) })
''',
        '''async function runCLIDeviceBuild(build) {
  const interrupt = () => requestDeviceBuildCancellation(build, "Swift Sim device build was interrupted.");
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  try {
    await runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) });
    build.state = "delivering";
    deviceBuildStore.save(build);
    await prepareDeviceDelivery(build);
  } finally {
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
  }
}

function trackDeviceBuildTask(key, build, operation) {
  const promise = Promise.resolve(operation).finally(() => {
    activeDeviceBuildTasks.delete(key);
  });
  activeDeviceBuildTasks.set(key, { build, promise });
  return promise;
}

function startManagedDeviceBuild(build) {
  const operation = runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) })
''',
        "tracked build helper")
    text = replace_once(text,
        '''    })
    .finally(() => {
      activeDeviceBuildTasks.delete(build.id);
    });
  activeDeviceBuildTasks.set(build.id, { build, promise });
  return promise;
}
''',
        '''    });
  return trackDeviceBuildTask(`build:${build.id}`, build, operation);
}
''',
        "tracked build completion")
path.write_text(text)

# Add regression coverage for the final fencing corrections.
path = Path("test/deviceBuildStore.test.js")
text = path.read_text()
if "transient unknown observation preserves a negative active install state" not in text:
    text += r'''

test("transient unknown observation preserves a negative active install state", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.install.retry", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "not-installed",
    devices: [{ name: "Phone", state: "not-installed", version: "", build: "" }],
  });
  store.saveVerification(build.id, {
    state: "unknown",
    devices: [{ name: "Phone", state: "unreachable", version: "", build: "" }],
  });
  assert.equal(store.get(build.id).installation.state, "not-installed");
}));
'''
path.write_text(text)

path = Path("test/deviceBuilderTimeout.test.js")
text = path.read_text()
if "a successful buffered command rejects surviving descendants" not in text:
    text += r'''

test("a successful buffered command rejects surviving descendants", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-success-descendant-"));
  const pidPath = join(directory, "descendant.pid");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
    `;
    const result = await runBuffered(process.execPath, ["-e", fixture], { timeoutMs: 8_000 });
    assert.match(result.error, /descendant processes were still running/);
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
path.write_text(text)

path = Path("Companion/SwiftSimCompanionTests/InstallationStateTests.swift")
text = path.read_text()
if "testDeviceBuildResponseIdentityIncludesCapabilityToken" not in text:
    text += r'''

extension InstallationStateTests {
    @MainActor
    func testDeviceBuildResponseIdentityIncludesCapabilityToken() {
        let old = DeviceBuildSession(id: "same", token: "old-token", baseURL: URL(string: "https://example.com")!)
        let renewed = DeviceBuildSession(id: "same", token: "new-token", baseURL: URL(string: "https://example.com")!)
        XCTAssertFalse(SessionStore.deviceBuildResponseIsCurrent(
            current: renewed,
            expected: old,
            currentRevision: 4,
            expectedRevision: 4
        ))
    }
}
'''
path.write_text(text)
