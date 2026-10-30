import XCTest
@testable import SwiftSimCompanion

final class ActivityTests: XCTestCase {
    private func event(_ id: String = "event-1", sequence: Int = 1, buildID: String? = nil, kind: String = "build-ready") -> [String: Any] {
        var value: [String: Any] = ["id": id, "sequence": sequence, "kind": kind, "title": "Build ready", "message": "Open this build to install it.", "createdAt": "2026-10-30T12:00:00.000Z", "state": "ready"]
        if let buildID { value["buildId"] = buildID }
        return value
    }
    private func feed(_ events: [[String: Any]], macID: String = "installation-one") throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "events": events, "cursor": events.compactMap { $0["sequence"] as? Int }.max() ?? 0, "installationId": macID, "notificationStatus": ["configured": false]])
    }
    private func response(_ request: URLRequest) -> HTTPURLResponse { HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)! }
    private func defaults() -> (UserDefaults, String) {
        let name = "ActivityTests.\(UUID().uuidString)"
        return (UserDefaults(suiteName: name)!, name)
    }

    func testFeedRejectsMalformedEventsAndUnboundPayloads() throws {
        var invalid = event()
        invalid["id"] = "https://arbitrary.example/install?token=secret"
        let value = try JSONDecoder().decode(ActivityFeed.self, from: feed([invalid]))
        XCTAssertFalse(value.isValid)
        var updated = event()
        updated["updatedAt"] = "2026-10-30T12:05:00.000Z"
        let changed = try JSONDecoder().decode(ActivityFeed.self, from: feed([updated])).events[0]
        XCTAssertEqual(changed.date, SwiftSimISO8601.date(from: "2026-10-30T12:05:00.000Z"))
        XCTAssertNil(ActivityPushTarget(userInfo: ["eventId": "event-1", "url": "https://untrusted.example"]))
        XCTAssertNil(ActivityPushTarget(userInfo: ["eventId": "../bad?token=x", "macID": "installation-one"]))
        XCTAssertNotNil(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "installation-one"]))
        let preferences = ActivityPreferences()
        XCTAssertTrue(preferences.queued)
        XCTAssertTrue(preferences.buildReady)
        XCTAssertTrue(preferences.attention)
        XCTAssertFalse(preferences.hotReload)
        XCTAssertFalse(preferences.launchConfirmed)
        let legacyPreferences = try JSONDecoder().decode(ActivityPreferences.self, from: Data("{}".utf8))
        XCTAssertEqual(legacyPreferences, preferences)
    }

    @MainActor
    func testQueuedUpdateStaysInActivityAndRequiresExplicitTrustedAppHandoff() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var item = event(buildID: "build-one", kind: "queued")
        item["targetAppName"] = "Example"
        item["launchURL"] = "example-debug://open"
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(), transport: { request in
            (try self.feed([item]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        await center.refresh()
        var openedBuild = false
        center.onOpenEvent = { _ in openedBuild = true }
        let queued = try XCTUnwrap(center.events.first)
        await center.open(queued)
        XCTAssertFalse(openedBuild)
        XCTAssertEqual(center.selectedEvent?.id, queued.id)
        XCTAssertEqual(queued.supportedLaunchURL?.absoluteString, "example-debug://open")
        for state in ["expired", "superseded", "unavailable"] {
            item["state"] = state
            let settled = try JSONDecoder().decode(ActivityFeed.self, from: feed([item])).events[0]
            XCTAssertFalse(settled.canApplyQueuedChange)
            XCTAssertNotEqual(settled.statusLabel, "Queued")
        }
        for unsupported in ["file:///private/fixture", "itms-services://install", "example-debug://open?token=secret"] {
            item["launchURL"] = unsupported
            let invalid = try JSONDecoder().decode(ActivityFeed.self, from: feed([item]))
            XCTAssertFalse(invalid.isValid)
        }
    }

    @MainActor
    func testInitialHistoryDoesNotBecomeUnreadAndNewEventsDedupeAcrossReopen() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var items = [event()]
        let mac = PairedMac(token: "fixture-token", baseURL: URL(string: "https://paired.example")!)
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(), transport: { request in
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-token")
            XCTAssertNil(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" }))
            return (try self.feed(items), self.response(request))
        })
        center.connect(to: mac)
        await center.refresh()
        XCTAssertEqual(center.unreadCount, 0)
        items.append(event("event-2", sequence: 2))
        await center.refresh(); await center.refresh()
        XCTAssertEqual(center.events.count, 2)
        XCTAssertEqual(center.unreadCount, 1)
        center.markAllRead()
        let restored = ActivityCenter(defaults: store, notifications: CompanionNotifications(), transport: { request in (Data("{\"removed\":true}".utf8), self.response(request)) })
        restored.connect(to: mac)
        XCTAssertEqual(restored.events.map(\.id), ["event-2", "event-1"])
        XCTAssertEqual(restored.unreadCount, 0)
        restored.connect(to: PairedMac(token: "rotated-token", baseURL: mac.baseURL))
        XCTAssertTrue(restored.events.isEmpty)
    }

    @MainActor
    func testNotificationTapResolvesOnlyAnAuthenticatedMatchingMacEvent() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications()
        let center = ActivityCenter(defaults: store, notifications: notifications, transport: { request in
            (try self.feed([self.event(buildID: "build-one")]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        var opened: [String] = []
        center.onOpenEvent = { opened.append($0.id) }
        notifications.received(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "foreign-installation", "buildId": "build-one"])!, foreground: false)
        await center.refresh()
        XCTAssertTrue(opened.isEmpty)
        notifications.received(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "installation-one"])!, foreground: false)
        await center.refresh()
        for _ in 0..<5 { await Task.yield() }
        XCTAssertEqual(opened, ["event-1"])
        XCTAssertNil(notifications.pendingTap)
    }

    @MainActor
    func testTapDuringPollingWaitsForCurrentFullFeedBeforePresentingQueuedStatus() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications()
        var first: CheckedContinuation<(Data, HTTPURLResponse), Error>?
        var requests = 0
        let center = ActivityCenter(defaults: store, notifications: notifications, transport: { request in
            requests += 1
            if requests == 1 { return try await withCheckedThrowingContinuation { first = $0 } }
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "after" })?.value, "0")
            var expired = self.event(sequence: 2, kind: "queued")
            expired["state"] = "expired"
            return (try self.feed([expired]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        let polling = Task { await center.refresh() }
        while first == nil { await Task.yield() }
        notifications.received(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "installation-one"])!, foreground: false)
        for _ in 0..<5 { await Task.yield() }
        first?.resume(returning: (try feed([event(kind: "queued")]), HTTPURLResponse(url: URL(string: "https://paired.example")!, statusCode: 200, httpVersion: nil, headerFields: nil)!))
        await polling.value
        for _ in 0..<20 { await Task.yield() }
        XCTAssertEqual(requests, 2)
        XCTAssertEqual(center.selectedEvent?.state, "expired")
        XCTAssertFalse(center.selectedEvent?.canApplyQueuedChange ?? true)
    }

    @MainActor
    func testLateFeedFromReplacedPairingCannotPopulateNewMac() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(), transport: { request in
            if request.httpMethod == "DELETE" { return (Data("{\"removed\":true}".utf8), self.response(request)) }
            return try await withCheckedThrowingContinuation { continuation = $0 }
        })
        center.connect(to: PairedMac(token: "old", baseURL: URL(string: "https://first.example")!))
        let task = Task { await center.refresh() }
        while continuation == nil { await Task.yield() }
        center.connect(to: PairedMac(token: "new", baseURL: URL(string: "https://second.example")!))
        continuation?.resume(returning: (try feed([event()]), HTTPURLResponse(url: URL(string: "https://first.example")!, statusCode: 200, httpVersion: nil, headerFields: nil)!))
        await task.value
        XCTAssertTrue(center.events.isEmpty)
        XCTAssertFalse(center.isRefreshing)
    }

    func testLaunchConfirmedInstallationSurvivesOldCacheAndInstallRequestProjection() throws {
        XCTAssertEqual(InstallationState(serverValue: "launch-confirmed"), .launchConfirmed)
        let json: [String: Any] = [
            "id": "build-one", "createdAt": "2026-10-30T12:00:00Z", "updatedAt": "2026-10-30T12:00:00Z", "expiresAt": "2026-10-31T12:00:00Z", "state": "ready", "configuration": "Debug", "preserveData": true,
            "app": ["identity": "app-one", "name": "Example", "bundleIdentifier": "com.example.fixture", "version": "1", "build": "28", "teamID": "FIXTURE"],
            "signing": ["method": "development", "deviceInstallable": true, "updateSafe": "same-bundle-update", "warnings": []],
            "installation": ["state": "launch-confirmed", "requestedAt": "", "verifiedAt": "2026-10-30T12:00:00Z", "devices": [], "source": "live-client", "launchConfirmedAt": "2026-10-30T12:00:00Z", "lastSeenAt": "2026-10-30T12:01:00Z"]
        ]
        let status = try JSONDecoder().decode(DeviceBuildStatus.self, from: JSONSerialization.data(withJSONObject: json))
        let session = DeviceBuildSession(id: "build-one", token: "fixture", baseURL: URL(string: "https://paired.example")!)
        let managed = ManagedBuild(session: session, status: status)
        let roundtrip = try JSONDecoder().decode(ManagedBuild.self, from: JSONEncoder().encode(managed))
        XCTAssertEqual(roundtrip.installationStatus, .launchConfirmed)
        XCTAssertEqual(roundtrip.installationSource, "live-client")
        XCTAssertNotNil(roundtrip.lastSeenAt)
        XCTAssertEqual(roundtrip.markingInstallRequested().installationStatus, .launchConfirmed)
        XCTAssertEqual(DeviceBuildStatus(cached: roundtrip).markingInstallRequested().installation?.state, "launch-confirmed")
    }
}
