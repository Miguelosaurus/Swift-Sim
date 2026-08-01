import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, value) {
  writeFileSync(path, value);
}

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing replacement anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Replacement anchor is not unique: ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchLiveReload() {
  const path = "mac-helper/src/liveReload.js";
  let source = read(path);
  source = replaceOnce(
    source,
    '  copyFileSync,\n  existsSync,',
    '  closeSync,\n  copyFileSync,\n  existsSync,',
    "live reload closeSync import",
  );
  source = replaceOnce(
    source,
    'import { basename, dirname, extname, join, resolve } from "node:path";\n',
    'import { basename, dirname, extname, join, resolve } from "node:path";\nimport { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";\n',
    "live reload lifecycle import",
  );
  source = replaceOnce(
    source,
    '  if (beforeSurface.modifiers !== afterSurface.modifiers) {\n',
    '  if (beforeSurface.compilerConditions !== afterSurface.compilerConditions) {\n    return result(\n      "rebuild-required",\n      false,\n      "A conditional-compilation directive changed.",\n      paths,\n      LIVE_REASON_CODES.DECLARATION_CHANGED,\n    );\n  }\n  if (beforeSurface.modifiers !== afterSurface.modifiers) {\n',
    "compiler condition comparison",
  );
  source = replaceOnce(
    source,
    'export async function ensureLiveEngineInstalled() {\n',
    'export async function ensureLiveEngineInstalled() {\n  return withLiveEngineLifecycleLock(() => ensureLiveEngineInstalledUnlocked());\n}\n\nasync function ensureLiveEngineInstalledUnlocked() {\n',
    "engine install lifecycle wrapper",
  );
  source = replaceOnce(
    source,
    'export async function startLiveReload({ project = "", host = "", forceRestart = false } = {}) {\n  await ensureLiveEngineInstalled();\n',
    'export async function startLiveReload(options = {}) {\n  return withLiveEngineLifecycleLock(() => startLiveReloadUnlocked(options));\n}\n\nasync function startLiveReloadUnlocked({ project = "", host = "", forceRestart = false } = {}) {\n  await ensureLiveEngineInstalledUnlocked();\n',
    "engine start lifecycle wrapper",
  );
  source = replaceOnce(
    source,
    String.raw`  const modifiers = [...clean.matchAll(/^\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b)/gm)]
    .map((match) => compact(match[1]))
    .sort()
    .join("\n");`,
    String.raw`  const compilerConditions = [...clean.matchAll(/^\s*#(?:if|elseif|else|endif)\b[^\n]*/gm)]
    .map((match) => compact(match[0]))
    .join("\n");
  const modifiers = [...clean.matchAll(/^\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\s*\((?:[^()\n]|\([^()]*\))*\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\b)/gm)]
    .map((match) => compact(match[1]))
    .sort()
    .join("\n");`,
    "attribute argument surface",
  );
  source = replaceOnce(
    source,
    '    storedProperties: storedProperties.join("\\n"),\n    modifiers,\n    unsupported: "",\n',
    '    storedProperties: storedProperties.join("\\n"),\n    compilerConditions,\n    modifiers,\n    unsupported: "",\n',
    "surface compiler conditions",
  );
  source = replaceOnce(
    source,
    String.raw`    const output = openSync(ENGINE_LOG, "a");
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
    writeFileSync(ENGINE_PID, `${child.pid}\n`, { mode: 0o600 });`,
    String.raw`    const output = openSync(ENGINE_LOG, "a");
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
    writeFileSync(ENGINE_PID, `${child.pid}\n`, { mode: 0o600 });`,
    "engine spawn publication",
  );
  source = replaceOnce(
    source,
    'function delay(milliseconds) {\n  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));\n}\n',
    'function waitForChildSpawn(child) {\n  if (Number.isInteger(Number(child?.pid)) && Number(child.pid) > 1) {\n    return Promise.resolve();\n  }\n  return new Promise((resolveSpawn, rejectSpawn) => {\n    child.once("spawn", resolveSpawn);\n    child.once("error", rejectSpawn);\n  });\n}\n\nfunction delay(milliseconds) {\n  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));\n}\n',
    "engine spawn wait helper",
  );
  write(path, source);
}

function patchHelperStartup() {
  const path = "mac-helper/bin/swift-sim-helper.js";
  let source = read(path);
  source = replaceOnce(
    source,
    '  await recoverInterruptedDeviceBuilds();\n  await drainDeliveryReferenceCleanupJobs();\n  const activeSockets = new Set();\n',
    '  await recoverInterruptedDeviceBuilds();\n  setImmediate(() => {\n    void drainDeliveryReferenceCleanupJobs().catch((error) => {\n      console.warn(`Swift Sim delivery-reference cleanup failed: ${error instanceof Error ? error.message : String(error)}`);\n    });\n  });\n  const activeSockets = new Set();\n',
    "delivery cleanup startup scheduling",
  );
  write(path, source);
}

function patchSessionStore() {
  const path = "Companion/SwiftSimCompanion/SessionStore.swift";
  let source = read(path);
  source = replaceOnce(
    source,
    '    private var pairingRevision: UInt64 = 0\n    private var deviceBuildViewRevision: UInt64 = 0\n',
    '    private var pairingRevision: UInt64 = 0\n    private var pairingAttemptRevision: UInt64 = 0\n    private var connectionChecksRevision: UInt64 = 0\n    private var deviceBuildViewRevision: UInt64 = 0\n',
    "companion revisions",
  );
  source = replaceOnce(
    source,
    '        isPairingMac = true\n        pairingErrorMessage = nil\n        helperStatus = .checking\n        defer { isPairingMac = false }\n',
    '        pairingAttemptRevision &+= 1\n        let attemptRevision = pairingAttemptRevision\n        isPairingMac = true\n        pairingErrorMessage = nil\n        helperStatus = .checking\n        defer {\n            if Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) {\n                isPairingMac = false\n            }\n        }\n',
    "pairing attempt revision",
  );
  source = replaceOnce(
    source,
    '            let (data, response) = try await URLSession.shared.data(for: request)\n            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0\n            guard statusCode == 200 else {\n',
    '            let (data, response) = try await URLSession.shared.data(for: request)\n            guard Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) else { return false }\n            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0\n            guard statusCode == 200 else {\n',
    "pairing response attempt fence",
  );
  source = replaceOnce(
    source,
    '        } catch {\n            pairingErrorMessage = pairingFailureMessage(for: error, mac: candidate)\n            helperStatus = pairedMac == nil ? .notPaired : .offline\n            showLibraryAction(pairingErrorMessage ?? "Could not connect to this Mac.", kind: .error)\n            return false\n        }\n    }\n\n    func reopen(_ recent: RecentSession) {\n',
    '        } catch {\n            guard Self.revisionIsCurrent(current: pairingAttemptRevision, expected: attemptRevision) else { return false }\n            pairingErrorMessage = pairingFailureMessage(for: error, mac: candidate)\n            helperStatus = pairedMac == nil ? .notPaired : .offline\n            showLibraryAction(pairingErrorMessage ?? "Could not connect to this Mac.", kind: .error)\n            return false\n        }\n    }\n\n    func reopen(_ recent: RecentSession) {\n',
    "pairing error attempt fence",
  );
  source = replaceOnce(
    source,
    String.raw`    func refresh() async {
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
            simulatorCheck = .ready("\(displayName) is available to open")
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
            logs = ["Unable to load logs: \(error.localizedDescription)"]
        }
    }`,
    String.raw`    func refresh() async {
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
            simulatorCheck = .ready("\(displayName) is available to open")
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
            logs = ["Unable to load logs: \(error.localizedDescription)"]
        }
    }`,
    "simulator response fencing",
  );
  source = replaceOnce(
    source,
    '        guard let mac = pairedMac else {\n            buildCurrentSourceMessage = "Remote builds are not paired on this iPhone yet. Pair your Mac once—no cable or shared Wi-Fi is required."\n            return\n        }\n        if helperStatus != .online {\n',
    '        guard let mac = pairedMac else {\n            buildCurrentSourceMessage = "Remote builds are not paired on this iPhone yet. Pair your Mac once—no cable or shared Wi-Fi is required."\n            return\n        }\n        guard Self.managedAppOwnerIsCurrent(ownerPairingID: app.ownerPairingID, pairedMacID: mac.id) else {\n            buildCurrentSourceMessage = "This app is not owned by the currently paired Mac. Refresh the library or pair the Mac that created it."\n            return\n        }\n        let expectedPairingRevision = pairingRevision\n        if helperStatus != .online {\n',
    "build current source owner",
  );
  source = replaceOnce(
    source,
    '        guard helperStatus == .online else {\n            buildCurrentSourceMessage = "Your Mac is offline or unreachable through Tailscale. Remote builds work from anywhere when both devices are online."\n            return\n        }\n\n        isStartingCurrentSourceBuild = true\n',
    '        guard Self.pairingResponseIsCurrent(\n            current: pairedMac,\n            expected: mac,\n            currentRevision: pairingRevision,\n            expectedRevision: expectedPairingRevision\n        ) else { return }\n        guard helperStatus == .online else {\n            buildCurrentSourceMessage = "Your Mac is offline or unreachable through Tailscale. Remote builds work from anywhere when both devices are online."\n            return\n        }\n\n        isStartingCurrentSourceBuild = true\n',
    "build current preflight pairing fence",
  );
  source = replaceOnce(
    source,
    '            let (data, response) = try await URLSession.shared.data(for: request)\n            guard let httpResponse = response as? HTTPURLResponse,\n                  httpResponse.statusCode == 200 || httpResponse.statusCode == 202 else {\n                buildCurrentSourceMessage = decodeServerError(data)\n',
    '            let (data, response) = try await URLSession.shared.data(for: request)\n            guard Self.pairingResponseIsCurrent(\n                current: pairedMac,\n                expected: mac,\n                currentRevision: pairingRevision,\n                expectedRevision: expectedPairingRevision\n            ) else { return }\n            guard let httpResponse = response as? HTTPURLResponse,\n                  httpResponse.statusCode == 200 || httpResponse.statusCode == 202 else {\n                buildCurrentSourceMessage = decodeServerError(data)\n',
    "build current response pairing fence",
  );
  source = replaceOnce(
    source,
    '        } catch {\n            buildCurrentSourceMessage = "Your Mac is unreachable through the private remote connection. Keep it awake and online, then try again."\n        }\n    }\n\n    private func pairedDeviceBuildSession',
    '        } catch {\n            guard Self.pairingResponseIsCurrent(\n                current: pairedMac,\n                expected: mac,\n                currentRevision: pairingRevision,\n                expectedRevision: expectedPairingRevision\n            ) else { return }\n            buildCurrentSourceMessage = "Your Mac is unreachable through the private remote connection. Keep it awake and online, then try again."\n        }\n    }\n\n    private func pairedDeviceBuildSession',
    "build current error pairing fence",
  );
  source = replaceOnce(
    source,
    '    static func pairingResponseIsCurrent(\n        current: PairedMac?,\n        expected: PairedMac,\n        currentRevision: UInt64,\n        expectedRevision: UInt64\n    ) -> Bool {\n        currentRevision == expectedRevision\n            && current?.id == expected.id\n            && current?.token == expected.token\n    }\n',
    '    static func pairingResponseIsCurrent(\n        current: PairedMac?,\n        expected: PairedMac,\n        currentRevision: UInt64,\n        expectedRevision: UInt64\n    ) -> Bool {\n        pairingContextIsCurrent(\n            current: current,\n            expected: expected,\n            currentRevision: currentRevision,\n            expectedRevision: expectedRevision\n        )\n    }\n\n    static func pairingContextIsCurrent(\n        current: PairedMac?,\n        expected: PairedMac?,\n        currentRevision: UInt64,\n        expectedRevision: UInt64\n    ) -> Bool {\n        currentRevision == expectedRevision\n            && current?.id == expected?.id\n            && current?.token == expected?.token\n    }\n\n    static func revisionIsCurrent(current: UInt64, expected: UInt64) -> Bool {\n        current == expected\n    }\n\n    static func simulatorResponseIsCurrent(\n        current: SimulatorSession?,\n        expected: SimulatorSession,\n        currentRevision: UInt64,\n        expectedRevision: UInt64\n    ) -> Bool {\n        currentRevision == expectedRevision && current == expected\n    }\n\n    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {\n        ownerPairingID == pairedMacID\n    }\n',
    "companion response helpers",
  );
  source = replaceOnce(
    source,
    '    func refreshConnectionChecks() async {\n        guard let baseURL = Self.preferredConnectionBaseURL(\n            paired: pairedMac?.baseURL,\n            recent: recentSessions.first?.session.baseURL\n',
    '    func refreshConnectionChecks() async {\n        connectionChecksRevision &+= 1\n        let checkRevision = connectionChecksRevision\n        let expectedMac = pairedMac\n        let expectedPairingRevision = pairingRevision\n        let recentSnapshot = recentSessions\n        guard let baseURL = Self.preferredConnectionBaseURL(\n            paired: expectedMac?.baseURL,\n            recent: recentSnapshot.first?.session.baseURL\n',
    "connection checks snapshots",
  );
  source = replaceOnce(
    source,
    '        let connectionURL = pairedMac?.statusURL ?? baseURL.appending(path: "health")\n',
    '        let connectionURL = expectedMac?.statusURL ?? baseURL.appending(path: "health")\n',
    "connection check expected URL",
  );
  source = replaceOnce(
    source,
    '            let (data, response) = try await URLSession.shared.data(for: healthRequest)\n            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0\n            if statusCode == 200 {\n                if let mac = pairedMac,\n',
    '            let (data, response) = try await URLSession.shared.data(for: healthRequest)\n            guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),\n                  Self.pairingContextIsCurrent(\n                    current: pairedMac,\n                    expected: expectedMac,\n                    currentRevision: pairingRevision,\n                    expectedRevision: expectedPairingRevision\n                  ) else { return }\n            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0\n            if statusCode == 200 {\n                if let mac = expectedMac,\n',
    "connection check response fence",
  );
  source = replaceOnce(
    source,
    '        } catch {\n            tailscaleCheck = .issue("Your iPhone could not reach your Mac. Check Tailscale on both devices")\n            macHelperCheck = .notConfigured("Not checked because the Mac could not be reached")\n        }\n\n        guard !recentSessions.isEmpty else { return }\n',
    '        } catch {\n            guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),\n                  Self.pairingContextIsCurrent(\n                    current: pairedMac,\n                    expected: expectedMac,\n                    currentRevision: pairingRevision,\n                    expectedRevision: expectedPairingRevision\n                  ) else { return }\n            tailscaleCheck = .issue("Your iPhone could not reach your Mac. Check Tailscale on both devices")\n            macHelperCheck = .notConfigured("Not checked because the Mac could not be reached")\n        }\n\n        guard !recentSnapshot.isEmpty else { return }\n',
    "connection check error fence",
  );
  source = replaceOnce(
    source,
    '            for recent in recentSessions {\n',
    '            for recent in recentSnapshot {\n',
    "connection recent snapshot",
  );
  source = replaceOnce(
    source,
    '        if let availableSession {\n            simulatorCheck = .ready("\\(availableSession.displayName) is available to open")\n',
    '        guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),\n              Self.pairingContextIsCurrent(\n                current: pairedMac,\n                expected: expectedMac,\n                currentRevision: pairingRevision,\n                expectedRevision: expectedPairingRevision\n              ) else { return }\n\n        if let availableSession {\n            simulatorCheck = .ready("\\(availableSession.displayName) is available to open")\n',
    "connection simulator result fence",
  );
  source = replaceOnce(
    source,
    '    func forgetPairedMac() {\n        pairingRevision &+= 1\n',
    '    func forgetPairedMac() {\n        pairingAttemptRevision &+= 1\n        pairingRevision &+= 1\n',
    "forget pairing attempt invalidation",
  );
  write(path, source);
}

function patchCompanionTests() {
  const path = "Companion/SwiftSimCompanionTests/InstallationStateTests.swift";
  let source = read(path);
  const anchor = String.raw`    @MainActor
    func testConnectionChecksPreferPairedMacOverStaleSimulatorHost() {
        let paired = URL(string: "https://current-mac.example")!
        let staleSimulator = URL(string: "https://old-mac.example")!

        XCTAssertEqual(
            SessionStore.preferredConnectionBaseURL(paired: paired, recent: staleSimulator),
            paired
        )
    }
`;
  const addition = anchor + String.raw`
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
`;
  source = replaceOnce(source, anchor, addition, "companion revision tests");
  write(path, source);
}

function writeIntegrationTests() {
  write("test/mainPostMergeIntegration.test.js", String.raw`import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifySwiftSource, LIVE_REASON_CODES } from "../mac-helper/src/liveReload.js";

test("attribute argument changes require a rebuild", () => {
  const before = ` + "`" + `import SwiftUI
struct ContentView: View {
  @State(initialValue: 1) private var count: Int
  var body: some View { Text("before") }
}` + "`" + `;
  const after = before
    .replace("initialValue: 1", "initialValue: 2")
    .replace('Text("before")', 'Text("after")');
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("availability attribute arguments require a rebuild", () => {
  const before = ` + "`" + `import SwiftUI
@available(iOS 18, *)
struct ContentView: View { var body: some View { Text("before") } }` + "`" + `;
  const after = before
    .replace("iOS 18", "iOS 19")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("conditional compilation changes require a rebuild", () => {
  const before = ` + "`" + `import SwiftUI
#if DEBUG
struct ContentView: View { var body: some View { Text("before") } }
#endif` + "`" + `;
  const after = before
    .replace("#if DEBUG", "#if RELEASE")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("delivery reference cleanup no longer blocks helper startup", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");
  const serveStart = source.indexOf("async function serve(");
  const createServer = source.indexOf("const server = createServer", serveStart);
  const startup = source.slice(serveStart, createServer);
  assert.doesNotMatch(startup, /await drainDeliveryReferenceCleanupJobs\(\)/);
  assert.match(startup, /setImmediate\(\(\) =>/);
});
`);
}

patchLiveReload();
patchHelperStartup();
patchSessionStore();
patchCompanionTests();
writeIntegrationTests();
console.log("Applied merged-main review fixes.");
