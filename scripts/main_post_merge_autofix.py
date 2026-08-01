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


def patch_live_reload() -> None:
    path = "mac-helper/src/liveReload.js"
    source = read(path)
    source = replace_once(
        source,
        "  copyFileSync,\n  existsSync,",
        "  closeSync,\n  copyFileSync,\n  existsSync,",
        "live reload closeSync import",
    )
    source = replace_once(
        source,
        'import { basename, dirname, extname, join, resolve } from "node:path";\n',
        'import { basename, dirname, extname, join, resolve } from "node:path";\n'
        'import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";\n',
        "live reload lifecycle import",
    )
    source = replace_once(
        source,
        "  if (beforeSurface.modifiers !== afterSurface.modifiers) {\n",
        '''  if (beforeSurface.compilerConditions !== afterSurface.compilerConditions) {
    return result(
      "rebuild-required",
      false,
      "A conditional-compilation or availability condition changed.",
      paths,
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }
  if (beforeSurface.modifiers !== afterSurface.modifiers) {
''',
        "compiler condition comparison",
    )
    source = replace_once(
        source,
        "export async function ensureLiveEngineInstalled() {\n",
        '''export async function ensureLiveEngineInstalled() {
  return withLiveEngineLifecycleLock(() => ensureLiveEngineInstalledUnlocked());
}

async function ensureLiveEngineInstalledUnlocked() {
''',
        "engine install lifecycle wrapper",
    )
    source = replace_once(
        source,
        'export async function startLiveReload({ project = "", host = "", forceRestart = false } = {}) {\n'
        '  await ensureLiveEngineInstalled();\n',
        '''export async function startLiveReload(options = {}) {
  return withLiveEngineLifecycleLock(() => startLiveReloadUnlocked(options));
}

async function startLiveReloadUnlocked({ project = "", host = "", forceRestart = false } = {}) {
  await ensureLiveEngineInstalledUnlocked();
''',
        "engine start lifecycle wrapper",
    )
    source = replace_once(
        source,
        r'''  const modifiers = [...clean.matchAll(/^\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b)/gm)]
    .map((match) => compact(match[1]))
    .sort()
    .join("\n");''',
        r'''  const compilerConditions = [
    ...clean.matchAll(/^\s*#(?:if|elseif|else|endif)\b[^\n]*/gm),
    ...clean.matchAll(/#(?:available|unavailable)\s*\([^\n)]*\)/g),
  ]
    .map((match) => compact(match[0]))
    .join("\n");
  const modifiers = [...clean.matchAll(/^\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\s*\((?:[^()\n]|\([^()]*\))*\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b)/gm)]
    .map((match) => compact(match[1]))
    .sort()
    .join("\n");''',
        "attribute argument surface",
    )
    source = replace_once(
        source,
        '    storedProperties: storedProperties.join("\\n"),\n    modifiers,\n    unsupported: "",\n',
        '    storedProperties: storedProperties.join("\\n"),\n'
        '    compilerConditions,\n'
        '    modifiers,\n'
        '    unsupported: "",\n',
        "surface compiler conditions",
    )
    source = replace_once(
        source,
        '''    const output = openSync(ENGINE_LOG, "a");
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
    writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });''',
        '''    const output = openSync(ENGINE_LOG, "a");
    let child;
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
    } finally {
      closeSync(output);
    }
    writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });''',
        "engine spawn publication",
    )
    source = replace_once(
        source,
        '''function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
''',
        '''function waitForChildSpawn(child) {
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
''',
        "engine spawn wait helper",
    )
    source = replace_once(
        source,
        '''function resolveSigningIdentities(projectPath) {
  const projectContainer = projectPath.endsWith("/project.pbxproj")
    ? dirname(projectPath)
    : projectPath;
  const settings = spawnSync(
    "xcodebuild",
    ["-project", projectContainer, "-configuration", "Debug", "-showBuildSettings"],
''',
        '''export function xcodeContainerArguments(projectPath) {
  const sourcePath = resolve(String(projectPath || ""));
  const projectContainer = sourcePath.endsWith("/project.pbxproj")
    ? dirname(sourcePath)
    : sourcePath.endsWith("/contents.xcworkspacedata")
      ? dirname(sourcePath)
      : sourcePath;
  return [projectContainer.endsWith(".xcworkspace") ? "-workspace" : "-project", projectContainer];
}

function resolveSigningIdentities(projectPath) {
  const containerArguments = xcodeContainerArguments(projectPath);
  const settings = spawnSync(
    "xcodebuild",
    [...containerArguments, "-configuration", "Debug", "-showBuildSettings"],
''',
        "workspace-aware xcode container",
    )
    write(path, source)


def patch_helper_startup() -> None:
    path = "mac-helper/bin/swift-sim-helper.js"
    source = read(path)
    source = replace_once(
        source,
        '''  await recoverInterruptedDeviceBuilds();
  await drainDeliveryReferenceCleanupJobs();
  const activeSockets = new Set();
''',
        '''  await recoverInterruptedDeviceBuilds();
  setImmediate(() => {
    void drainDeliveryReferenceCleanupJobs().catch((error) => {
      console.warn(`Swift Sim delivery-reference cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });
  const activeSockets = new Set();
''',
        "delivery cleanup startup scheduling",
    )
    write(path, source)


def patch_session_store() -> None:
    path = "Companion/SwiftSimCompanion/SessionStore.swift"
    source = read(path)
    source = replace_once(
        source,
        '''    private var pairingRevision: UInt64 = 0
    private var deviceBuildViewRevision: UInt64 = 0
''',
        '''    private var pairingRevision: UInt64 = 0
    private var pairingAttemptRevision: UInt64 = 0
    private var connectionChecksRevision: UInt64 = 0
    private var deviceBuildViewRevision: UInt64 = 0
''',
        "companion revisions",
    )
    source = replace_once(
        source,
        '''        isPairingMac = true
        pairingErrorMessage = nil
        helperStatus = .checking
        defer { isPairingMac = false }
''',
        '''        pairingAttemptRevision &+= 1
        let attemptRevision = pairingAttemptRevision
        isPairingMac = true
        pairingErrorMessage = nil
        helperStatus = .checking
        defer {
            if Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) {
                isPairingMac = false
            }
        }
''',
        "pairing attempt revision",
    )
    source = replace_once(
        source,
        '''            let (data, response) = try await URLSession.shared.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard statusCode == 200 else {
''',
        '''            let (data, response) = try await URLSession.shared.data(for: request)
            guard Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) else { return false }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard statusCode == 200 else {
''',
        "pairing response attempt fence",
    )
    source = replace_once(
        source,
        '''        } catch {
            pairingErrorMessage = pairingFailureMessage(for: error, mac: candidate)
            helperStatus = pairedMac == nil ? .notPaired : .offline
            showLibraryAction(pairingErrorMessage ?? "Could not connect to this Mac.", kind: .error)
            return false
        }
    }

    func reopen(_ recent: RecentSession) {
''',
        '''        } catch {
            guard Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) else { return false }
            pairingErrorMessage = pairingFailureMessage(for: error, mac: candidate)
            helperStatus = pairedMac == nil ? .notPaired : .offline
            showLibraryAction(pairingErrorMessage ?? "Could not connect to this Mac.", kind: .error)
            return false
        }
    }

    func reopen(_ recent: RecentSession) {
''',
        "pairing error attempt fence",
    )
    source = replace_once(
        source,
        '''    func refresh() async {
        guard let session = currentSession else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: session.statusURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                isConnected = false
                simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
                return
            }
            var displayName = "Simulator"
            if let status = try? JSONDecoder().decode(SessionStatus.self, from: data) {
                let name = status.scheme.isEmpty ? nil : status.scheme
                displayName = name ?? displayName
                activeTransport = status.stream
                upsertRecentSession(
                    RecentSession(
                        session: session,
                        displayName: name,
                        recentProjectID: status.recentProjectID
                    )
                )
            }
            isConnected = true
            simulatorCheck = .ready("\\(displayName) is available to open")
            await fetchLogs()
        } catch {
            isConnected = false
            simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
        }
    }

    func fetchLogs() async {
        guard let session = currentSession else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: session.logsURL)
            let decoded = try JSONDecoder().decode(SessionLogs.self, from: data)
            logs = decoded.logs
        } catch {
            logs = ["Unable to load logs: \\(error.localizedDescription)"]
        }
    }
''',
        '''    func refresh() async {
        guard let session = currentSession else { return }
        let viewRevision = deviceBuildViewRevision
        do {
            let (data, response) = try await URLSession.shared.data(from: session.statusURL)
            guard Self.simulatorResponseIsCurrent(
                current: currentSession,
                expected: session,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                isConnected = false
                simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
                return
            }
            var displayName = "Simulator"
            if let status = try? JSONDecoder().decode(SessionStatus.self, from: data) {
                let name = status.scheme.isEmpty ? nil : status.scheme
                displayName = name ?? displayName
                activeTransport = status.stream
                upsertRecentSession(
                    RecentSession(
                        session: session,
                        displayName: name,
                        recentProjectID: status.recentProjectID
                    )
                )
            }
            isConnected = true
            simulatorCheck = .ready("\\(displayName) is available to open")
            await fetchLogs()
        } catch {
            guard Self.simulatorResponseIsCurrent(
                current: currentSession,
                expected: session,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            isConnected = false
            simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
        }
    }

    func fetchLogs() async {
        guard let session = currentSession else { return }
        let viewRevision = deviceBuildViewRevision
        do {
            let (data, _) = try await URLSession.shared.data(from: session.logsURL)
            guard Self.simulatorResponseIsCurrent(
                current: currentSession,
                expected: session,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            let decoded = try JSONDecoder().decode(SessionLogs.self, from: data)
            logs = decoded.logs
        } catch {
            guard Self.simulatorResponseIsCurrent(
                current: currentSession,
                expected: session,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            logs = ["Unable to load logs: \\(error.localizedDescription)"]
        }
    }
''',
        "simulator response fencing",
    )
    source = replace_once(
        source,
        '''        guard let mac = pairedMac else {
            buildCurrentSourceMessage = "Remote builds are not paired on this iPhone yet. Pair your Mac once—no cable or shared Wi-Fi is required."
            return
        }
        if helperStatus != .online {
''',
        '''        guard let mac = pairedMac else {
            buildCurrentSourceMessage = "Remote builds are not paired on this iPhone yet. Pair your Mac once—no cable or shared Wi-Fi is required."
            return
        }
        guard Self.managedAppOwnerIsCurrent(ownerPairingID: app.ownerPairingID, pairedMacID: mac.id) else {
            buildCurrentSourceMessage = "This app is not owned by the currently paired Mac. Refresh the library or pair the Mac that created it."
            return
        }
        let expectedPairingRevision = pairingRevision
        if helperStatus != .online {
''',
        "build current source owner",
    )
    source = replace_once(
        source,
        '''        guard helperStatus == .online else {
            buildCurrentSourceMessage = "Your Mac is offline or unreachable through Tailscale. Remote builds work from anywhere when both devices are online."
            return
        }

        isStartingCurrentSourceBuild = true
''',
        '''        guard Self.pairingResponseIsCurrent(
            current: pairedMac,
            expected: mac,
            currentRevision: pairingRevision,
            expectedRevision: expectedPairingRevision
        ) else { return }
        guard helperStatus == .online else {
            buildCurrentSourceMessage = "Your Mac is offline or unreachable through Tailscale. Remote builds work from anywhere when both devices are online."
            return
        }

        isStartingCurrentSourceBuild = true
''',
        "build current preflight pairing fence",
    )
    source = replace_once(
        source,
        '''            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 || httpResponse.statusCode == 202 else {
                buildCurrentSourceMessage = decodeServerError(data)
''',
        '''            let (data, response) = try await URLSession.shared.data(for: request)
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
            ) else { return }
            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 || httpResponse.statusCode == 202 else {
                buildCurrentSourceMessage = decodeServerError(data)
''',
        "build current response pairing fence",
    )
    source = replace_once(
        source,
        '''        } catch {
            buildCurrentSourceMessage = "Your Mac is unreachable through the private remote connection. Keep it awake and online, then try again."
        }
    }

    private func pairedDeviceBuildSession''',
        '''        } catch {
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
            ) else { return }
            buildCurrentSourceMessage = "Your Mac is unreachable through the private remote connection. Keep it awake and online, then try again."
        }
    }

    private func pairedDeviceBuildSession''',
        "build current error pairing fence",
    )
    source = replace_once(
        source,
        '''    static func pairingResponseIsCurrent(
        current: PairedMac?,
        expected: PairedMac,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        currentRevision == expectedRevision
            && current?.id == expected.id
            && current?.token == expected.token
    }
''',
        '''    static func pairingResponseIsCurrent(
        current: PairedMac?,
        expected: PairedMac,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        pairingContextIsCurrent(
            current: current,
            expected: expected,
            currentRevision: currentRevision,
            expectedRevision: expectedRevision
        )
    }

    static func pairingContextIsCurrent(
        current: PairedMac?,
        expected: PairedMac?,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        currentRevision == expectedRevision
            && current?.id == expected?.id
            && current?.token == expected?.token
    }

    static func revisionIsCurrent(current: UInt64, expected: UInt64) -> Bool {
        current == expected
    }

    static func simulatorResponseIsCurrent(
        current: SimulatorSession?,
        expected: SimulatorSession,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        currentRevision == expectedRevision && current == expected
    }

    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {
        ownerPairingID == pairedMacID
    }
''',
        "companion response helpers",
    )
    source = replace_once(
        source,
        '''    func refreshConnectionChecks() async {
        guard let baseURL = Self.preferredConnectionBaseURL(
            paired: pairedMac?.baseURL,
            recent: recentSessions.first?.session.baseURL
''',
        '''    func refreshConnectionChecks() async {
        connectionChecksRevision &+= 1
        let checkRevision = connectionChecksRevision
        let expectedMac = pairedMac
        let expectedPairingRevision = pairingRevision
        let recentSnapshot = recentSessions
        guard let baseURL = Self.preferredConnectionBaseURL(
            paired: expectedMac?.baseURL,
            recent: recentSnapshot.first?.session.baseURL
''',
        "connection checks snapshots",
    )
    source = replace_once(
        source,
        '        let connectionURL = pairedMac?.statusURL ?? baseURL.appending(path: "health")\n',
        '        let connectionURL = expectedMac?.statusURL ?? baseURL.appending(path: "health")\n',
        "connection check expected URL",
    )
    source = replace_once(
        source,
        '''            let (data, response) = try await URLSession.shared.data(for: healthRequest)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 200 {
                if let mac = pairedMac,
''',
        '''            let (data, response) = try await URLSession.shared.data(for: healthRequest)
            guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),
                  Self.pairingContextIsCurrent(
                    current: pairedMac,
                    expected: expectedMac,
                    currentRevision: pairingRevision,
                    expectedRevision: expectedPairingRevision
                  ) else { return }
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 200 {
                if let mac = expectedMac,
''',
        "connection check response fence",
    )
    source = replace_once(
        source,
        '''        } catch {
            tailscaleCheck = .issue("Your iPhone could not reach your Mac. Check Tailscale on both devices")
            macHelperCheck = .notConfigured("Not checked because the Mac could not be reached")
        }

        guard !recentSessions.isEmpty else { return }
''',
        '''        } catch {
            guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),
                  Self.pairingContextIsCurrent(
                    current: pairedMac,
                    expected: expectedMac,
                    currentRevision: pairingRevision,
                    expectedRevision: expectedPairingRevision
                  ) else { return }
            tailscaleCheck = .issue("Your iPhone could not reach your Mac. Check Tailscale on both devices")
            macHelperCheck = .notConfigured("Not checked because the Mac could not be reached")
        }

        guard !recentSnapshot.isEmpty else { return }
''',
        "connection check error fence",
    )
    source = replace_once(
        source,
        "            for recent in recentSessions {\n",
        "            for recent in recentSnapshot {\n",
        "connection recent snapshot",
    )
    source = replace_once(
        source,
        '''        if let availableSession {
            simulatorCheck = .ready("\\(availableSession.displayName) is available to open")
''',
        '''        guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),
              Self.pairingContextIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return }

        if let availableSession {
            simulatorCheck = .ready("\\(availableSession.displayName) is available to open")
''',
        "connection simulator result fence",
    )
    source = replace_once(
        source,
        '''    func forgetPairedMac() {
        pairingRevision &+= 1
''',
        '''    func forgetPairedMac() {
        pairingAttemptRevision &+= 1
        connectionChecksRevision &+= 1
        pairingRevision &+= 1
''',
        "forget pairing invalidation",
    )
    write(path, source)


def patch_companion_tests() -> None:
    path = "Companion/SwiftSimCompanionTests/InstallationStateTests.swift"
    source = read(path)
    anchor = '''    @MainActor
    func testConnectionChecksPreferPairedMacOverStaleSimulatorHost() {
        let paired = URL(string: "https://current-mac.example")!
        let staleSimulator = URL(string: "https://old-mac.example")!

        XCTAssertEqual(
            SessionStore.preferredConnectionBaseURL(paired: paired, recent: staleSimulator),
            paired
        )
    }
'''
    addition = anchor + '''
    @MainActor
    func testSimulatorResponsesAreRejectedAfterViewChanges() {
        let expected = SimulatorSession(
            id: "session-a",
            token: "token-a",
            baseURL: URL(string: "https://mac-a.example")!
        )
        let replacement = SimulatorSession(
            id: "session-b",
            token: "token-b",
            baseURL: URL(string: "https://mac-b.example")!
        )
        XCTAssertTrue(SessionStore.simulatorResponseIsCurrent(
            current: expected,
            expected: expected,
            currentRevision: 4,
            expectedRevision: 4
        ))
        XCTAssertFalse(SessionStore.simulatorResponseIsCurrent(
            current: replacement,
            expected: expected,
            currentRevision: 5,
            expectedRevision: 4
        ))
        XCTAssertFalse(SessionStore.simulatorResponseIsCurrent(
            current: nil,
            expected: expected,
            currentRevision: 5,
            expectedRevision: 4
        ))
    }

    @MainActor
    func testManagedAppMutationRequiresExactPairedMacOwner() {
        XCTAssertTrue(SessionStore.managedAppOwnerIsCurrent(
            ownerPairingID: "https://mac.example",
            pairedMacID: "https://mac.example"
        ))
        XCTAssertFalse(SessionStore.managedAppOwnerIsCurrent(
            ownerPairingID: nil,
            pairedMacID: "https://mac.example"
        ))
        XCTAssertFalse(SessionStore.managedAppOwnerIsCurrent(
            ownerPairingID: "https://old.example",
            pairedMacID: "https://mac.example"
        ))
    }

    @MainActor
    func testPairingAndDiagnosticRevisionsRejectStaleResponses() {
        XCTAssertTrue(SessionStore.revisionIsCurrent(current: 3, expected: 3))
        XCTAssertFalse(SessionStore.revisionIsCurrent(current: 4, expected: 3))
        let first = PairedMac(token: "first", baseURL: URL(string: "https://first.example")!)
        let second = PairedMac(token: "second", baseURL: URL(string: "https://second.example")!)
        XCTAssertFalse(SessionStore.pairingContextIsCurrent(
            current: second,
            expected: first,
            currentRevision: 2,
            expectedRevision: 1
        ))
    }
'''
    source = replace_once(source, anchor, addition, "companion revision tests")
    write(path, source)


def write_integration_tests() -> None:
    write(
        "test/mainPostMergeIntegration.test.js",
        '''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySwiftSource,
  LIVE_REASON_CODES,
  xcodeContainerArguments,
} from "../mac-helper/src/liveReload.js";

test("attribute argument changes require a rebuild", () => {
  const before = `import SwiftUI
struct ContentView: View {
  @State(initialValue: 1) private var count: Int
  var body: some View { Text("before") }
}`;
  const after = before
    .replace("initialValue: 1", "initialValue: 2")
    .replace('Text("before")', 'Text("after")');
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("availability attribute arguments require a rebuild", () => {
  const before = `import SwiftUI
@available(iOS 18, *)
struct ContentView: View { var body: some View { Text("before") } }`;
  const after = before
    .replace("iOS 18", "iOS 19")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("conditional compilation changes require a rebuild", () => {
  const before = `import SwiftUI
#if DEBUG
struct ContentView: View { var body: some View { Text("before") } }
#endif`;
  const after = before
    .replace("#if DEBUG", "#if RELEASE")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("runtime availability changes require a rebuild", () => {
  const before = `func value() -> Int { if #available(iOS 18, *) { return 1 }; return 0 }`;
  const after = before.replace("iOS 18", "iOS 19");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("delivery reference cleanup no longer blocks helper startup", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");
  const serveStart = source.indexOf("async function serve(");
  const createServer = source.indexOf("const server = createServer", serveStart);
  const startup = source.slice(serveStart, createServer);
  assert.doesNotMatch(startup, /await drainDeliveryReferenceCleanupJobs\\(\\)/);
  assert.match(startup, /setImmediate\\(\\(\\) =>/);
});

test("live reload selects project and workspace containers correctly", () => {
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcodeproj/project.pbxproj"),
    ["-project", "/tmp/App.xcodeproj"],
  );
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcworkspace/contents.xcworkspacedata"),
    ["-workspace", "/tmp/App.xcworkspace"],
  );
});
''',
    )


patch_live_reload()
patch_helper_startup()
patch_session_store()
patch_companion_tests()
write_integration_tests()
print("Applied merged-main review fixes.")
