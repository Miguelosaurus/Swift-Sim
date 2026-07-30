import XCTest
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
