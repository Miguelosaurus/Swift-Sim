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
