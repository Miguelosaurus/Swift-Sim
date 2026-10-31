import XCTest
import UserNotifications
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
        XCTAssertTrue(preferences.hotReload)
        XCTAssertFalse(preferences.launchConfirmed)
        let legacyPreferences = try JSONDecoder().decode(ActivityPreferences.self, from: Data("{}".utf8))
        XCTAssertEqual(legacyPreferences, preferences)
    }

    @MainActor
    func testQueuedUpdateStaysInActivityAndRequiresExplicitTrustedAppHandoff() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var item = event(buildID: "build-one", kind: "queued")
        item["requestId"] = "request-one"
        item["state"] = "waiting-for-device"
        item["targetAppName"] = "Example"
        item["launchURL"] = "example-debug://open"
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
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

    func testSignedBuildProgressAndUnpreparedChangesNeverOfferTheNoInstallAppHandoff() throws {
        for state in ["queued", "preparing", "building", "delivering", "applying", "applied"] {
            var item = event(kind: "queued"); item["state"] = state
            item["buildId"] = "build-one"
            XCTAssertFalse(try JSONDecoder().decode(ActivityFeed.self, from: feed([item])).events[0].canApplyQueuedChange)
            item["requestId"] = "request-one"
            XCTAssertFalse(try JSONDecoder().decode(ActivityFeed.self, from: feed([item])).events[0].canApplyQueuedChange)
        }
        var ready = event(kind: "queued"); ready["state"] = "waiting-for-foreground"; ready["requestId"] = "request-one"
        XCTAssertTrue(try JSONDecoder().decode(ActivityFeed.self, from: feed([ready])).events[0].canApplyQueuedChange)
    }

    @MainActor
    func testInitialHistoryDoesNotBecomeUnreadAndNewEventsDedupeAcrossReopen() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var items = [event()]
        let mac = PairedMac(token: "fixture-token", baseURL: URL(string: "https://paired.example")!)
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
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
        let restored = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in (Data("{\"removed\":true}".utf8), self.response(request)) })
        restored.connect(to: mac)
        XCTAssertEqual(restored.events.map(\.id), ["event-2", "event-1"])
        XCTAssertEqual(restored.unreadCount, 0)
        restored.connect(to: PairedMac(token: "rotated-token", baseURL: mac.baseURL))
        XCTAssertTrue(restored.events.isEmpty)
    }

    @MainActor
    func testNotificationTapResolvesOnlyAnAuthenticatedMatchingMacEvent() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications(defaults: store)
        let center = ActivityCenter(defaults: store, notifications: notifications, transport: { request in
            (try self.feed([self.event(buildID: "build-one")]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        var opened: [String] = []
        center.onOpenEvent = { opened.append($0.buildId ?? "missing-build") }
        notifications.received(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "foreign-installation", "buildId": "build-one"])!, foreground: false)
        await center.refresh()
        XCTAssertTrue(opened.isEmpty)
        // The push's optional build ID is not authority. The refreshed feed is.
        notifications.received(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "installation-one", "buildId": "different-build"])!, foreground: false)
        await center.refresh()
        for _ in 0..<5 { await Task.yield() }
        XCTAssertEqual(opened, ["build-one"])
        XCTAssertNil(notifications.pendingTap)
    }

    @MainActor
    func testOpeningStaleBuildRowUsesCurrentStateInsteadOfAnExpiredInstallHandoff() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var item = event(buildID: "build-one")
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
            (try self.feed([item]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        await center.refresh()
        let staleRow = try XCTUnwrap(center.events.first)
        item = event(sequence: 2, buildID: "build-one", kind: "queued")
        item["state"] = "expired"
        await center.refresh()
        var opened = false
        center.onOpenEvent = { _ in opened = true }
        await center.open(staleRow)
        XCTAssertFalse(opened)
        XCTAssertEqual(center.selectedEvent?.state, "expired")
        XCTAssertFalse(center.selectedEvent?.canApplyQueuedChange ?? true)
    }

    @MainActor
    func testPushReceivedBeforePairingAndInitialFeedWaitsForAuthenticatedExactBuild() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications(defaults: store)
        let target = try XCTUnwrap(ActivityPushTarget(userInfo: ["eventId": "event-1", "macID": "installation-one"]))
        notifications.received(target, foreground: false)
        let center = ActivityCenter(defaults: store, notifications: notifications, transport: { request in
            XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "after" })?.value, "0")
            return (try self.feed([self.event(buildID: "exact-build")]), self.response(request))
        })
        var opened: [String] = []
        center.onOpenEvent = { opened.append($0.buildId ?? "missing-build") }
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        await center.refresh(fromBeginning: true)
        for _ in 0..<5 { await Task.yield() }
        XCTAssertEqual(opened, ["exact-build"])
        XCTAssertNil(notifications.pendingTap)
    }

    @MainActor
    func testPresentationDiagnosticsDistinguishPermissionFromBannerAndSummarySettings() {
        XCTAssertNil(CompanionNotifications.deliveryMessage(authorization: .denied, alerts: .disabled, style: .none, scheduled: .disabled))
        XCTAssertTrue(CompanionNotifications.deliveryMessage(authorization: .provisional, alerts: .enabled, style: .banner, scheduled: .disabled)?.contains("quietly") == true)
        XCTAssertTrue(CompanionNotifications.deliveryMessage(authorization: .authorized, alerts: .disabled, style: .banner, scheduled: .disabled)?.contains("alerts are off") == true)
        XCTAssertTrue(CompanionNotifications.deliveryMessage(authorization: .authorized, alerts: .enabled, style: .none, scheduled: .disabled)?.contains("banners are off") == true)
        XCTAssertTrue(CompanionNotifications.deliveryMessage(authorization: .authorized, alerts: .enabled, style: .banner, scheduled: .enabled)?.contains("Scheduled Summary") == true)
        let allowed = CompanionNotifications.deliveryMessage(authorization: .authorized, alerts: .enabled, style: .banner, scheduled: .disabled)
        XCTAssertTrue(allowed?.contains("allow alerts") == true)
        XCTAssertFalse(allowed?.contains("delivered successfully") == true)
    }

    @MainActor
    func testObservedPushMetadataIsBoundedPersistedAndScopedToThePairedMac() throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let time = Date(timeIntervalSince1970: 1_793_400_000)
        let notifications = CompanionNotifications(defaults: store, now: { time })
        let foreground = try XCTUnwrap(ActivityPushTarget(userInfo: ["eventId": String(repeating: "a", count: 64), "macID": "installation-one"]))
        let tapped = try XCTUnwrap(ActivityPushTarget(userInfo: ["eventId": String(repeating: "b", count: 64), "macID": "other-installation"]))
        notifications.received(foreground, foreground: true)
        notifications.received(tapped, foreground: false)
        let restored = CompanionNotifications(defaults: store, now: { time })
        restored.recordPresentation(authorization: .authorized, alerts: .enabled, style: .banner, scheduled: .disabled)
        let local = try XCTUnwrap(restored.diagnostics)
        XCTAssertEqual(local.lastForegroundReceipt?.eventId, String(repeating: "a", count: 64))
        XCTAssertEqual(local.lastTap?.eventId, String(repeating: "b", count: 64))
        XCTAssertEqual(local.lastForegroundReceipt?.observedAt, time.ISO8601Format())
        XCTAssertNil(restored.pendingTap, "An old tap observation must not replay navigation after relaunch.")
        let paired = local.scoped(to: "installation-one")
        XCTAssertEqual(paired.lastForegroundReceipt?.eventId, String(repeating: "a", count: 64))
        XCTAssertNil(paired.lastTap)
        XCTAssertNil(local.scoped(to: nil).lastForegroundReceipt)
        XCTAssertNil(local.scoped(to: nil).lastTap)
        let encoded = String(decoding: try JSONEncoder().encode(paired), as: UTF8.self)
        XCTAssertFalse(encoded.contains("other-installation"))
        XCTAssertFalse(encoded.contains("token"))
        XCTAssertFalse(encoded.contains("displayed"))
    }

    @MainActor
    func testRegistrationSharesOnlyCurrentMacObservations() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications(defaults: store)
        var registrations: [[String: Any]] = []
        let center = ActivityCenter(defaults: store, notifications: notifications, transport: { request in
            if request.httpMethod == "POST" {
                registrations.append(try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(request.httpBody)) as? [String: Any]))
                return (Data("{\"notificationStatus\":{\"configured\":true}}".utf8), self.response(request))
            }
            return (try self.feed([]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        await center.refresh()
        notifications.recordPresentation(authorization: .authorized, alerts: .enabled, style: .banner, scheduled: .disabled)
        notifications.received(try XCTUnwrap(ActivityPushTarget(userInfo: ["eventId": String(repeating: "c", count: 64), "macID": "installation-one"])), foreground: true)
        notifications.received(try XCTUnwrap(ActivityPushTarget(userInfo: ["eventId": String(repeating: "d", count: 64), "macID": "other-installation"])), foreground: false)
        center.setActive(true)
        defer { center.setActive(false) }
        await center.synchronizeRegistration()
        for _ in 0..<10 { await Task.yield() }
        let diagnostics = try XCTUnwrap(registrations.compactMap { $0["diagnostics"] as? [String: Any] }.first)
        XCTAssertEqual(diagnostics["schemaVersion"] as? Int, 1)
        XCTAssertEqual((diagnostics["lastForegroundReceipt"] as? [String: Any])?["eventId"] as? String, String(repeating: "c", count: 64))
        XCTAssertNil(diagnostics["lastTap"])
        for payload in registrations {
            XCTAssertFalse(String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self).contains("other-installation"))
        }
    }

    @MainActor
    func testTapDuringPollingWaitsForCurrentFullFeedBeforePresentingQueuedStatus() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let notifications = CompanionNotifications(defaults: store)
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
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
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
    func testCurrentPreferenceDefaultsPreserveCustomizedLegacyChoices() {
        let original = ActivityPreferences(hotReload: false)
        XCTAssertTrue(original.adoptingCurrentDefaults(previousVersion: nil).hotReload)
        XCTAssertFalse(original.adoptingCurrentDefaults(previousVersion: 1).hotReload)
        let customized = ActivityPreferences(queued: false, hotReload: false)
        XCTAssertEqual(customized.adoptingCurrentDefaults(previousVersion: nil), customized)
    }

    @MainActor
    func testLegacyDefaultUpgradePersistsAndLaterExplicitOptOutSurvivesReconnect() throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        let mac = PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!)
        let initial = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store))
        initial.connect(to: mac)
        let key = try XCTUnwrap(store.dictionaryRepresentation().keys.first(where: { $0.hasPrefix("swiftSim.activity.") }))
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(store.data(forKey: key))) as? [String: Any])
        legacy.removeValue(forKey: "preferenceDefaultsVersion")
        legacy["preferences"] = ["queued": true, "buildReady": true, "attention": true, "hotReload": false, "launchConfirmed": false]
        store.set(try JSONSerialization.data(withJSONObject: legacy), forKey: key)
        let upgraded = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store))
        upgraded.connect(to: mac)
        XCTAssertTrue(upgraded.preferences.hotReload)
        let saved = try XCTUnwrap(JSONSerialization.jsonObject(with: try XCTUnwrap(store.data(forKey: key))) as? [String: Any])
        XCTAssertEqual(saved["preferenceDefaultsVersion"] as? Int, 1)
        var optedOut = upgraded.preferences
        optedOut.hotReload = false
        upgraded.updatePreferences(optedOut)
        let reopened = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store))
        reopened.connect(to: mac)
        XCTAssertFalse(reopened.preferences.hotReload)
    }

    @MainActor
    func testHistoricalExpiryDoesNotAnnounceAnErrorDuringAnotherBuildHandoff() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var next = event("current-build", sequence: 1, buildID: "current")
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
            (try self.feed([next]), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        var announced: [String] = []
        center.onForegroundEvent = { announced.append($0.id) }
        await center.refresh()
        for (index, state) in ["expired", "superseded", "unavailable"].enumerated() {
            next = event("old-\(state)", sequence: index + 2, buildID: "old-build", kind: "queued")
            next["state"] = state
            await center.refresh()
            XCTAssertTrue(announced.isEmpty)
            let historical = try XCTUnwrap(center.events.first(where: { $0.id == "old-\(state)" }))
            XCTAssertEqual(historical.state, state)
            await center.open(historical)
            XCTAssertEqual(center.selectedEvent?.state, state)
            XCTAssertFalse(center.selectedEvent?.canApplyQueuedChange ?? true)
        }
        next = event("new-build", sequence: 5, buildID: "new-build")
        await center.refresh()
        XCTAssertEqual(announced, ["new-build"])
        next = event("real-failure", sequence: 6, kind: "attention")
        next["state"] = "failed"
        await center.refresh()
        XCTAssertEqual(announced, ["new-build", "real-failure"])
    }

    @MainActor
    func testPresentationRefreshDoesNotReplayCachedOrUncachedHistoryButNewTransitionsAnnounce() async throws {
        let (store, name) = defaults(); defer { store.removePersistentDomain(forName: name) }
        var ready = event("ready-build", sequence: 1, buildID: "build-one")
        var success = event("applied-edit", sequence: 2, kind: "live-applied")
        success["state"] = "refreshed"
        success["revision"] = 1
        var items = [ready, success]
        let center = ActivityCenter(defaults: store, notifications: CompanionNotifications(defaults: store), transport: { request in
            (try self.feed(items), self.response(request))
        })
        center.connect(to: PairedMac(token: "fixture", baseURL: URL(string: "https://paired.example")!))
        var announced: [String] = []
        center.onForegroundEvent = { announced.append($0.id) }
        await center.refresh()

        // Older helpers may refresh copy without the additive presentation flag.
        ready["sequence"] = 3
        ready["title"] = "Zenics — Ready to install"
        ready["message"] = "Your new version is ready. Open Swift Sim to install it."
        success["sequence"] = 4
        success["title"] = "Zenics updated"
        success["message"] = "Your changes were applied successfully."
        items = [ready, success]
        await center.refresh()
        XCTAssertTrue(announced.isEmpty)
        XCTAssertEqual(center.events.first(where: { $0.id == "applied-edit" })?.title, "Zenics updated")

        // The server marks presentation migrations even when this phone did not
        // retain the original occurrence in its local cache.
        var uncached = event("old-uncached-build", sequence: 5, buildID: "old-build")
        uncached["presentationOnly"] = true
        items = [uncached]
        await center.refresh()
        XCTAssertTrue(announced.isEmpty)
        XCTAssertFalse(try XCTUnwrap(center.events.first(where: { $0.id == "old-uncached-build" })).isMeaningful)

        // A genuine state change, revision increase, or new build remains visible.
        ready["sequence"] = 6
        ready["kind"] = "attention"
        ready["state"] = "failed"
        items = [ready]
        await center.refresh()
        success["sequence"] = 7
        success["revision"] = 2
        items = [success]
        await center.refresh()
        uncached["sequence"] = 8
        uncached["kind"] = "attention"
        uncached["state"] = "failed"
        uncached["presentationOnly"] = false
        items = [uncached]
        await center.refresh()
        items = [event("new-build", sequence: 9, buildID: "new-build")]
        await center.refresh()
        XCTAssertEqual(announced, ["ready-build", "applied-edit", "old-uncached-build", "new-build"])
    }

}
