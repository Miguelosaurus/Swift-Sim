import XCTest
import Security
@testable import SwiftSimCompanion

final class InstallationStateTests: XCTestCase {
    func testStartingInstallPreservesBuildDetailsAndMarksRequest() throws {
        let status = try JSONDecoder().decode(DeviceBuildStatus.self, from: Data(statusJSON.utf8))
        let requested = status.markingInstallRequested()
        XCTAssertEqual(requested.id, status.id)
        XCTAssertEqual(requested.app, status.app)
        XCTAssertEqual(requested.state, "ready")
        XCTAssertEqual(requested.installation?.state, "requested")
        XCTAssertFalse(requested.installation?.requestedAt.isEmpty ?? true)
    }

    func testStartingAnotherInstallDoesNotEraseVerifiedState() throws {
        let verifiedJSON = statusJSON.replacingOccurrences(
            of: #""state":"unknown""#,
            with: #""state":"verified""#
        )
        let status = try JSONDecoder().decode(DeviceBuildStatus.self, from: Data(verifiedJSON.utf8))
        XCTAssertEqual(status.markingInstallRequested().installation?.state, "verified")
    }

    @MainActor
    func testBuildStatusSourcesFallBackBetweenLinkAndPairedMac() {
        let direct = URL(string: "https://temporary.example/api/device-builds/1")!
        let paired = URL(string: "https://mac.example/api/device-builds/1")!
        XCTAssertEqual(
            SessionStore.preferredDeviceBuildURLs(direct: direct, paired: paired, helperIsOnline: true),
            [paired, direct]
        )
        XCTAssertEqual(
            SessionStore.preferredDeviceBuildURLs(direct: direct, paired: paired, helperIsOnline: false),
            [direct, paired]
        )
    }

    func testPairedMacBuildCurrentSourceURLUsesOnlyOpaqueAppIdentity() {
        let mac = PairedMac(
            token: "pairing-token",
            baseURL: URL(string: "https://mac.example")!
        )
        let url = mac.appBuildCurrentSourceURL("opaque-app-id")

        XCTAssertEqual(url.path, "/api/apps/opaque-app-id/build-current-source")
        XCTAssertEqual(
            URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "token" })?
                .value,
            "pairing-token"
        )
        XCTAssertFalse(url.absoluteString.contains("/Users/"))
    }

    @MainActor
    func testConnectionChecksPreferPairedMacOverStaleSimulatorHost() {
        let paired = URL(string: "https://current-mac.example")!
        let staleSimulator = URL(string: "https://old-mac.example")!

        XCTAssertEqual(
            SessionStore.preferredConnectionBaseURL(paired: paired, recent: staleSimulator),
            paired
        )
    }

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

    func testPairingLinkCarriesMacNameUntilVerificationCompletes() {
        let url = URL(
            string: "swift-sim://pair?token=secret&base=https%3A%2F%2Fcurrent-mac.example&name=Miguel%27s%20MacBook%20Air"
        )!
        let mac = PairedMac(url: url)

        XCTAssertEqual(mac?.displayName, "Miguel's MacBook Air")
        XCTAssertEqual(mac?.hostDisplayName, "current-mac.example")
    }

    @MainActor
    func testOpeningPairingLinkPresentsMacConnectionSheet() {
        let store = SessionStore()
        let url = URL(
            string: "swift-sim://pair?token=secret&base=https%3A%2F%2Fcurrent-mac.example&name=Miguel%27s%20MacBook%20Air"
        )!

        XCTAssertTrue(store.open(url))
        XCTAssertTrue(store.isMacSettingsPresented)
    }

    @MainActor
    func testReadyInstallURLIsAvailableSynchronouslyOnFirstTap() throws {
        let store = SessionStore()
        store.currentDeviceBuild = DeviceBuildSession(
            id: "build-1",
            token: "secret",
            baseURL: URL(string: "https://mac.example")!
        )
        let readyJSON = statusJSON
            .replacingOccurrences(
                of: #""expiresAt":"2026-07-10T02:00:00Z""#,
                with: #""expiresAt":"2099-07-10T02:00:00Z""#
            )
            .replacingOccurrences(
                of: #""links":null"#,
                with: #""links":{"universalLink":"https://mac.example/d/build-1","customScheme":"swift-sim://device-build/build-1","installURL":"itms-services://?action=download-manifest&url=https%3A%2F%2Fmac.example%2Fmanifest.plist"}"#
            )
        store.deviceBuildStatus = try JSONDecoder().decode(
            DeviceBuildStatus.self,
            from: Data(readyJSON.utf8)
        )

        XCTAssertEqual(
            store.currentBuildInstallURL()?.absoluteString,
            "itms-services://?action=download-manifest&url=https%3A%2F%2Fmac.example%2Fmanifest.plist"
        )
    }

    @MainActor
    func testExpiredInstallURLIsNotOpenedFromCachedStatus() throws {
        let store = SessionStore()
        store.currentDeviceBuild = DeviceBuildSession(
            id: "build-1",
            token: "secret",
            baseURL: URL(string: "https://mac.example")!
        )
        store.deviceBuildStatus = try JSONDecoder().decode(
            DeviceBuildStatus.self,
            from: Data(statusJSON.utf8)
        )

        XCTAssertNil(store.currentBuildInstallURL())
    }

    @MainActor
    func testPairingEncodingNeverSerializesThePlaintextToken() throws {
        let token = "pairing-secret-\(UUID().uuidString)"
        let mac = PairedMac(
            token: token,
            baseURL: URL(string: "https://first-\(UUID().uuidString).example")!
        )
        let data = try JSONEncoder().encode(mac)
        let encoded = String(decoding: data, as: UTF8.self)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let marker = try XCTUnwrap(object["token"] as? String)
        XCTAssertFalse(encoded.contains(token))
        XCTAssertTrue(marker.hasPrefix("__swift_sim_keychain__:"))
    }

    @MainActor
    func testEncodingAReplacementDoesNotOverwriteThePreviousPairingCredential() throws {
        let firstToken = "first-secret-\(UUID().uuidString)"
        let secondToken = "second-secret-\(UUID().uuidString)"
        let first = PairedMac(
            token: firstToken,
            baseURL: URL(string: "https://first-\(UUID().uuidString).example")!
        )
        let second = PairedMac(
            token: secondToken,
            baseURL: URL(string: "https://second-\(UUID().uuidString).example")!
        )
        let firstMetadata = try JSONEncoder().encode(first)
        _ = try JSONEncoder().encode(second)
        let restoredFirst = try JSONDecoder().decode(PairedMac.self, from: firstMetadata)
        XCTAssertEqual(restoredFirst.token, firstToken)
    }

    @MainActor
    func testMalformedPairingMetadataClearsCommittedAndPendingCredentials() throws {
        let defaults = UserDefaults.standard
        let committedAccount = "test-committed-\(UUID().uuidString)"
        let pendingAccount = "test-pending-\(UUID().uuidString)"
        try storeTestToken("committed-secret", account: committedAccount)
        try storeTestToken("pending-secret", account: pendingAccount)
        defaults.set(committedAccount, forKey: "pairedMacCredentialAccount")
        defaults.set(pendingAccount, forKey: "pairedMacPendingCredentialAccount")
        defaults.set("pending-pairing-id", forKey: "pairedMacPendingPairingID")
        defaults.set(Data("{malformed".utf8), forKey: "pairedMac")
        defer {
            deleteTestToken(account: committedAccount)
            deleteTestToken(account: pendingAccount)
            defaults.removeObject(forKey: "pairedMac")
            defaults.removeObject(forKey: "pairedMacCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPendingPairingID")
        }

        _ = SwiftSimCompanionApp()

        XCTAssertNil(defaults.data(forKey: "pairedMac"))
        XCTAssertNil(defaults.string(forKey: "pairedMacCredentialAccount"))
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingPairingID"))
        XCTAssertEqual(testTokenStatus(account: committedAccount), errSecItemNotFound)
        XCTAssertEqual(testTokenStatus(account: pendingAccount), errSecItemNotFound)
    }

    private func storeTestToken(_ token: String, account: String) throws {
        deleteTestToken(account: account)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "dev.local.SwiftSimCompanion.pairing",
            kSecAttrAccount as String: account,
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: nil)
        }
    }

    private func testTokenStatus(account: String) -> OSStatus {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "dev.local.SwiftSimCompanion.pairing",
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        return SecItemCopyMatching(query as CFDictionary, nil)
    }

    private func deleteTestToken(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "dev.local.SwiftSimCompanion.pairing",
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    @MainActor
    func testPendingPairingSurvivesDefaultsMonitoringUntilCancelled() throws {
        let defaults = UserDefaults.standard
        let pairingID = "https://pending-\(UUID().uuidString).example"
        let token = "pending-secret-\(UUID().uuidString)"
        defaults.removeObject(forKey: "pairedMac")
        defaults.removeObject(forKey: "pairedMacCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingPairingID")
        PairingCredentialVault.startMonitoring()
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: token, pairingID: pairingID))
        let account = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        defer {
            PairingCredentialVault.cancelStagedPairing(pairingID: pairingID)
            deleteTestToken(account: account)
        }
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        XCTAssertEqual(testTokenStatus(account: account), errSecSuccess)
    }

    @MainActor
    func testCancellingSameMacReplacementPreservesCommittedToken() throws {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "pairedMac")
        defaults.removeObject(forKey: "pairedMacCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingPairingID")
        let baseURL = URL(string: "https://same-mac-\(UUID().uuidString).example")!
        let oldToken = "old-secret-\(UUID().uuidString)"
        let newToken = "new-secret-\(UUID().uuidString)"
        let original = PairedMac(token: oldToken, baseURL: baseURL)
        let metadata = try JSONEncoder().encode(original)
        defaults.set(metadata, forKey: "pairedMac")
        PairingCredentialVault.prepareForSessionStore()
        let committed = try XCTUnwrap(defaults.string(forKey: "pairedMacCredentialAccount"))
        defer {
            deleteTestToken(account: committed)
            if let pending = defaults.string(forKey: "pairedMacPendingCredentialAccount") {
                deleteTestToken(account: pending)
            }
            defaults.removeObject(forKey: "pairedMac")
            defaults.removeObject(forKey: "pairedMacCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPendingPairingID")
        }
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: newToken, pairingID: original.id))
        PairingCredentialVault.cancelStagedPairing(pairingID: original.id)
        let restored = try JSONDecoder().decode(PairedMac.self, from: metadata)
        XCTAssertEqual(restored.token, oldToken)
    }

    private let statusJSON = #"""
    {
      "id":"build-1",
      "createdAt":"2026-07-10T00:00:00Z",
      "updatedAt":"2026-07-10T00:00:00Z",
      "expiresAt":"2026-07-10T02:00:00Z",
      "state":"ready",
      "app":{
        "identity":"app-1",
        "name":"Example",
        "bundleIdentifier":"com.example.app",
        "version":"1.0",
        "build":"1",
        "teamID":"TEAM123"
      },
      "signing":{
        "method":"development",
        "deviceInstallable":true,
        "updateSafe":"same-bundle-update",
        "warnings":[]
      },
      "delivery":null,
      "preserveData":true,
      "installation":{
        "state":"unknown",
        "requestedAt":"",
        "verifiedAt":"",
        "devices":[]
      },
      "links":null
    }
    """#
}

extension InstallationStateTests {
    @MainActor
    func testStalePairingResponseCannotReplaceCurrentMac() {
        let oldMac = PairedMac(
            token: "old-token",
            baseURL: URL(string: "https://old.example")!
        )
        let replacement = PairedMac(
            token: "replacement-token",
            baseURL: URL(string: "https://replacement.example")!
        )
        XCTAssertFalse(SessionStore.pairingResponseIsCurrent(
            current: replacement,
            expected: oldMac,
            currentRevision: 2,
            expectedRevision: 1
        ))
        XCTAssertTrue(SessionStore.pairingResponseIsCurrent(
            current: oldMac,
            expected: oldMac,
            currentRevision: 1,
            expectedRevision: 1
        ))
    }

    @MainActor
    func testStagedPairingUsesRecoverableTransactionPointer() throws {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "pairedMac")
        defaults.removeObject(forKey: "pairedMacCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingCredentialAccount")
        defaults.removeObject(forKey: "pairedMacPendingPairingID")
        let pairingID = "https://transaction-\(UUID().uuidString).example"
        XCTAssertTrue(PairingCredentialVault.stagePairing(
            token: "transaction-secret-\(UUID().uuidString)",
            pairingID: pairingID
        ))
        let account = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        defer {
            PairingCredentialVault.cancelStagedPairing(pairingID: pairingID)
            deleteTestToken(account: account)
        }
        XCTAssertTrue(account.hasPrefix("paired-mac-token.pending."))
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingPairingID"), pairingID)
        XCTAssertEqual(testTokenStatus(account: account), errSecSuccess)
    }
}

extension InstallationStateTests {
    @MainActor
    func testManagedAppOperationRevisionIsScopedPerApp() {
        XCTAssertTrue(SessionStore.appOperationIsCurrent(currentRevision: 2, expectedRevision: 2))
        XCTAssertFalse(SessionStore.appOperationIsCurrent(currentRevision: 1, expectedRevision: 2))
        XCTAssertFalse(SessionStore.appOperationIsCurrent(currentRevision: nil, expectedRevision: 1))
    }

    @MainActor
    func testReplacingStagedPairingDeletesSupersededCredential() throws {
        let defaults = UserDefaults.standard
        let firstID = "https://first-pending-\(UUID().uuidString).example"
        let secondID = "https://second-pending-\(UUID().uuidString).example"
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "first-\(UUID().uuidString)", pairingID: firstID))
        let firstAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "second-\(UUID().uuidString)", pairingID: secondID))
        let secondAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        defer {
            deleteTestToken(account: firstAccount)
            deleteTestToken(account: secondAccount)
            defaults.removeObject(forKey: "pairedMacPendingCredentialHistory")
            defaults.removeObject(forKey: "pairedMacPreviousPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPreviousPendingPairingID")
        }
        XCTAssertEqual(testTokenStatus(account: firstAccount), errSecItemNotFound)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingPairingID"), secondID)
        PairingCredentialVault.cancelStagedPairing(pairingID: secondID)
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingPairingID"))
        XCTAssertEqual(testTokenStatus(account: secondAccount), errSecItemNotFound)
    }
}

extension InstallationStateTests {
    @MainActor
    func testDeviceBuildResponsesAreBoundToCurrentViewGeneration() {
        let first = DeviceBuildSession(id: "first", token: "token-a", baseURL: URL(string: "https://a.example")!)
        let second = DeviceBuildSession(id: "second", token: "token-b", baseURL: URL(string: "https://b.example")!)
        XCTAssertTrue(SessionStore.deviceBuildResponseIsCurrent(
            current: first,
            expected: first,
            currentRevision: 3,
            expectedRevision: 3
        ))
        XCTAssertFalse(SessionStore.deviceBuildResponseIsCurrent(
            current: second,
            expected: first,
            currentRevision: 3,
            expectedRevision: 3
        ))
        XCTAssertFalse(SessionStore.deviceBuildResponseIsCurrent(
            current: first,
            expected: first,
            currentRevision: 4,
            expectedRevision: 3
        ))
    }

    @MainActor
    func testInstallVerificationRemainsActiveAcrossNegativeObservations() {
        XCTAssertTrue(SessionStore.installationVerificationIsActive("requested"))
        XCTAssertTrue(SessionStore.installationVerificationIsActive("not-installed"))
        XCTAssertTrue(SessionStore.installationVerificationIsActive("different-version"))
        XCTAssertFalse(SessionStore.installationVerificationIsActive("verified"))
    }

    @MainActor
    func testRepeatedStagingKeepsOnlyLatestCredential() throws {
        let defaults = UserDefaults.standard
        let firstID = "https://first-\(UUID().uuidString).example"
        let secondID = "https://second-\(UUID().uuidString).example"
        let thirdID = "https://third-\(UUID().uuidString).example"
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "first-\(UUID().uuidString)", pairingID: firstID))
        let firstAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "second-\(UUID().uuidString)", pairingID: secondID))
        let secondAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertEqual(testTokenStatus(account: firstAccount), errSecItemNotFound)
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "third-\(UUID().uuidString)", pairingID: thirdID))
        let thirdAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        defer {
            deleteTestToken(account: firstAccount)
            deleteTestToken(account: secondAccount)
            deleteTestToken(account: thirdAccount)
            defaults.removeObject(forKey: "pairedMacPendingCredentialHistory")
            defaults.removeObject(forKey: "pairedMacPreviousPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPreviousPendingPairingID")
        }
        XCTAssertEqual(testTokenStatus(account: secondAccount), errSecItemNotFound)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingCredentialAccount"), thirdAccount)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingPairingID"), thirdID)
        PairingCredentialVault.cancelStagedPairing(pairingID: thirdID)
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertNil(defaults.string(forKey: "pairedMacPendingPairingID"))
        XCTAssertEqual(testTokenStatus(account: thirdAccount), errSecItemNotFound)
    }
}

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


extension InstallationStateTests {
    @MainActor
    func testConnectionDiagnosticsRejectAChangedSimulatorView() {
        let mac = PairedMac(
            token: "token",
            baseURL: URL(string: "https://mac.example")!
        )
        XCTAssertTrue(SessionStore.connectionDiagnosticsAreCurrent(
            currentMac: mac,
            expectedMac: mac,
            currentPairingRevision: 4,
            expectedPairingRevision: 4,
            currentSimulatorViewRevision: 8,
            expectedSimulatorViewRevision: 8
        ))
        XCTAssertFalse(SessionStore.connectionDiagnosticsAreCurrent(
            currentMac: mac,
            expectedMac: mac,
            currentPairingRevision: 4,
            expectedPairingRevision: 4,
            currentSimulatorViewRevision: 9,
            expectedSimulatorViewRevision: 8
        ))
    }
}


extension InstallationStateTests {
    @MainActor
    func testMacSyncOnlyRemovesHistoryOwnedByThatMac() {
        let remoteIDs: Set<String> = ["present"]
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "ownerless", ownerPairingID: nil, syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "other-mac", ownerPairingID: "mac-b", syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertTrue(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "missing", ownerPairingID: "mac-a", syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "present", ownerPairingID: "mac-a", syncingMacID: "mac-a", remoteIDs: remoteIDs))
    }
}

extension InstallationStateTests {
    @MainActor
    func testMacSyncPreservesSameIdentityBuildsFromOtherSources() {
        let remoteIDs: Set<String> = ["remote-current"]
        XCTAssertFalse(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "remote-current",
            buildBaseURLString: "https://mac-a.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
        XCTAssertFalse(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "remote-stale",
            buildBaseURLString: "https://mac-a.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
        XCTAssertTrue(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "foreign-link",
            buildBaseURLString: "https://mac-b.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
    }
}
