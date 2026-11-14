import XCTest
@testable import SwiftSimCompanion

final class SupportIssueTests: XCTestCase {
    func testReportsRemoveCapabilitiesCredentialsAndPrivateMaterial() {
        let diagnostic = """
        Fetch https://mac.example/private/path-secret?token=query-secret
        swift-sim://pair/path-capability
        Authorization: Bearer header-secret
        Cookie: session=cookie-secret
        {"Authorization":"Basic basic-secret"}
        {"Cookie":"session=json-cookie-secret"}
        {"deviceToken":"device-secret", "api_key": "api-secret", "password":"password-secret"}
        pairingCode=pair-secret
        -----BEGIN PRIVATE KEY-----
        key-secret
        -----END PRIVATE KEY-----
        /Users/example-developer/Projects/App/File.swift:25: error: missing member
        Build ID: build-123
        Request ID: request-456
        """
        let report = SupportIssue(title: "Build didn't finish", message: "Ask your agent to check the build log.", screen: "Install update", context: ["Build ID": "build-123"], diagnostic: diagnostic).report
        for secret in ["path-secret", "query-secret", "path-capability", "header-secret", "cookie-secret", "basic-secret", "json-cookie-secret", "device-secret", "api-secret", "password-secret", "pair-secret", "key-secret", "/Users/example-developer"] {
            XCTAssertFalse(report.contains(secret), "Leaked \(secret)")
        }
        XCTAssertTrue(report.contains("~/Projects/App/File.swift:25"))
        XCTAssertTrue(report.contains("missing member"))
        XCTAssertTrue(report.contains("build-123"))
        XCTAssertTrue(report.contains("request-456"))
    }

    func testRedactionPrecedesTruncationAndHandlesUnclosedPrivateKey() {
        let text = "-----BEGIN PRIVATE KEY-----\n" + String(repeating: "secret", count: 5_000)
        XCTAssertEqual(AgentReport.redact(text), "[private material removed]")
    }

    func testAllContextIsSanitizedAndReportPreservesUncertainty() {
        let issue = SupportIssue(title: "Stop isn't confirmed", message: "Testing may still be running. Tap Stop Server.", screen: "Testing", context: ["Unexpected": "https://private.example/path-token", "Request ID": "abc-123"], diagnostic: "status=503")
        XCTAssertFalse(issue.report.contains("path-token"))
        XCTAssertTrue(issue.report.contains("Testing may still be running"))
        XCTAssertTrue(issue.report.contains("abc-123"))
        XCTAssertTrue(issue.report.contains("status=503"))
        XCTAssertTrue(issue.report.contains("Check the current request before retrying"))
    }

    func testReportIsBoundedAndRedactionIsIdempotent() {
        let text = "token=secret " + String(repeating: "log line\n", count: 4_000)
        let report = AgentReport.redact(text)
        XCTAssertLessThan(report.count, 24_100)
        XCTAssertFalse(report.contains("secret"))
        XCTAssertEqual(AgentReport.redact(report), report)
    }

    func testAttentionEventIncludesUsefulIdentityWithoutLaunchCapability() throws {
        let json = #"{"id":"event-1","sequence":1,"kind":"attention","title":"Internal failure","message":"Failed at https://mac.example/secret-path?token=secret","createdAt":"2026-11-09T12:00:00Z","state":"failed","buildId":"build-1","requestId":"request-1","revision":2,"targetAppName":"Zenics","launchURL":"zenics://private-secret"}"#
        let event = try JSONDecoder().decode(ActivityEvent.self, from: Data(json.utf8))
        let issue = event.supportIssue
        XCTAssertEqual(issue.title, "Update needs attention")
        XCTAssertFalse(issue.message.contains("https"))
        XCTAssertTrue(issue.message.hasPrefix("Failed at"), "the helper's reason is shown, with private links removed")
        for value in ["event-1", "build-1", "request-1", "Zenics"] { XCTAssertTrue(issue.report.contains(value)) }
        XCTAssertFalse(issue.report.contains("secret-path"))
        XCTAssertFalse(issue.report.contains("private-secret"))
    }
    func testExpiredPairingOffersANewLinkAndKeychainFailureDoesNotBlameNetwork() {
        XCTAssertEqual(SupportIssue.pairing("This pairing invitation expired.").message, "Ask your agent for a new QR code or connection link.")
        XCTAssertFalse(SupportIssue.pairing("The saved pairing credential is unavailable.").message.contains("Tailscale"))
        XCTAssertTrue(SupportIssue.pairing("Network offline").message.contains("Tailscale"))
    }

    func testRawInstallFailuresStayOutOfVisibleCopyAndPendingStaysPending() {
        let message = SupportIssue.installMessage("SIGNING_PROFILE_INVALID: code 403")
        XCTAssertFalse(message.contains("SIGNING_PROFILE"))
        XCTAssertTrue(message.contains("agent"))
        let pending = "Install requested. Swift Sim will verify it when your Mac reconnects."
        XCTAssertEqual(SupportIssue.installMessage(pending), pending)
        XCTAssertFalse(SupportIssue.installMessage(pending).contains("installed"))
    }

    @MainActor
    func testAttentionBannerRetainsEventContextAndHidesInternalCopy() throws {
        let json = #"{"id":"event-2","sequence":2,"kind":"attention","title":"CODE_SIGN_FAILED","message":"Compiler and provision details","createdAt":"2026-11-09T12:00:00Z","state":"failed","buildId":"build-2","targetAppName":"Zenics"}"#
        let event = try JSONDecoder().decode(ActivityEvent.self, from: Data(json.utf8))
        let store = SessionStore()
        store.activity.onForegroundEvent?(event)
        let notice = try XCTUnwrap(store.libraryActionNotice)
        XCTAssertEqual(notice.kind, .error)
        XCTAssertFalse(notice.message.contains("CODE_SIGN"))
        XCTAssertTrue(notice.supportIssue?.report.contains("build-2") == true)
        store.dismissLibraryActionMessage()
        XCTAssertNil(store.libraryActionNotice)
    }

}
