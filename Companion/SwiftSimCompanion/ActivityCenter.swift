import Foundation
import Combine
import CryptoKit
import UserNotifications
import UIKit

struct ActivityPreferences: Codable, Equatable {
    var queued = true
    var buildReady = true
    var attention = true
    var hotReload = true
    var launchConfirmed = false

    init(queued: Bool = true, buildReady: Bool = true, attention: Bool = true, hotReload: Bool = true, launchConfirmed: Bool = false) {
        self.queued = queued; self.buildReady = buildReady; self.attention = attention; self.hotReload = hotReload; self.launchConfirmed = launchConfirmed
    }
    // Only the complete original default profile is upgraded. Customized
    // legacy preferences and choices saved by the new version are preserved.
    func adoptingCurrentDefaults(previousVersion: Int?) -> Self {
        let originalDefaults = Self(hotReload: false)
        guard previousVersion == nil, self == originalDefaults else { return self }
        var updated = self
        updated.hotReload = true
        return updated
    }

    private enum CodingKeys: String, CodingKey { case queued, buildReady, attention, hotReload, launchConfirmed }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        queued = try values.decodeIfPresent(Bool.self, forKey: .queued) ?? true
        buildReady = try values.decodeIfPresent(Bool.self, forKey: .buildReady) ?? true
        attention = try values.decodeIfPresent(Bool.self, forKey: .attention) ?? true
        hotReload = try values.decodeIfPresent(Bool.self, forKey: .hotReload) ?? true
        launchConfirmed = try values.decodeIfPresent(Bool.self, forKey: .launchConfirmed) ?? false
    }
}

struct ActivityEvent: Identifiable, Codable, Equatable {
    let id: String
    let sequence: Int
    let kind: String
    let title: String
    let message: String
    let createdAt: String
    let updatedAt: String?
    let state: String
    let buildId: String?
    let requestId: String?
    let revision: Int?
    let targetAppName: String?
    let launchURL: String?
    let presentationOnly: Bool?

    var supportedLaunchURL: URL? {
        guard let launchURL, launchURL.count <= 512, let url = URL(string: launchURL),
              let scheme = url.scheme?.lowercased(), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              !["http", "file", "data", "javascript", "tel", "sms", "facetime", "mailto", "itms-services", "itms-apps", "swift-sim", "app-settings"].contains(scheme),
              scheme != "https" || url.host != nil else { return nil }
        return url
    }
    var date: Date? { SwiftSimISO8601.date(from: updatedAt ?? createdAt) }
    var canApplyQueuedChange: Bool { kind == "queued" && requestId != nil && ["waiting-for-device", "waiting-for-foreground"].contains(state) }
    var isAttention: Bool { kind == "attention" }
    var isMeaningful: Bool {
        // Retained history can expire while an unrelated current install opens.
        // Keep that state in the inbox without presenting it as a new action.
        presentationOnly != true && !["expired", "superseded", "unavailable"].contains(state)
            && ["queued", "build-ready", "attention", "live-applied", "launch-confirmed"].contains(kind)
    }
    func hasSameOccurrence(as other: ActivityEvent) -> Bool {
        id == other.id && kind == other.kind && state == other.state
            && revision == other.revision && launchURL == other.launchURL
    }
    var symbol: String {
        switch kind {
        case "build-ready": return "shippingbox.fill"
        case "live-applied": return "bolt.circle.fill"
        case "attention": return "exclamationmark.triangle.fill"
        case "launch-confirmed": return "checkmark.iphone"
        default: return "clock"
        }
    }
    var statusLabel: String {
        switch state {
        case "expired": return "Expired"
        case "superseded": return "Replaced by a newer change"
        case "unavailable": return "No longer available"
        default: break
        }
        switch kind {
        case "build-ready": return "Ready to install"
        case "live-applied": return "Applied successfully"
        case "attention": return "Needs attention"
        case "launch-confirmed": return "Installed & launched"
        default:
            return state == "waiting-for-foreground" ? "Waiting for the app" : "Queued"
        }
    }

    var isValid: Bool {
        Self.validID(id) && sequence > 0 && title.count <= 160 && message.count <= 800
            && createdAt.count <= 64 && SwiftSimISO8601.date(from: createdAt) != nil && date != nil
            && (updatedAt.map { $0.count <= 64 } ?? true) && kind.count <= 64 && state.count <= 80
            && (buildId.map(Self.validID) ?? true) && (requestId.map(Self.validID) ?? true)
            && (revision.map { $0 >= 0 } ?? true)
            && (targetAppName.map { !$0.isEmpty && $0.count <= 80 } ?? true)
            && (launchURL == nil || supportedLaunchURL != nil)
    }
    static func validID(_ value: String) -> Bool {
        !value.isEmpty && value.count <= 128 && value.unicodeScalars.allSatisfy {
            CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:-").contains($0)
        }
    }
}

struct ActivityProviderStatus: Codable, Equatable {
    let configured: Bool
    let reason: String?
}

struct AppDeliveryPresentation: Decodable, Equatable {
    let schemaVersion: Int
    let code: String
    let title: String
    let message: String
    let nextAction: String
    let completionVerified: Bool
    let updatedAt: String
    let buildId: String?
    let requestId: String?
    let revision: Int?

    var isValid: Bool {
        let codes = ["STATUS_UNAVAILABLE", "PREPARING", "CHANGES_APPLIED", "BUILD_INSTALLED", "READY_TO_INSTALL", "INSTALL_QUEUED", "CONFIRM_INSTALL", "INSTALL_CONFIRMING", "UNCONFIRMED", "CHECK_MAC", "NEEDS_ATTENTION", "EXPIRED", "SUPERSEDED", "WAITING_FOR_APP", "APPLYING", "BUILT_IN_XCODE", "INSTALL_CANCELLED", "MULTIPLE_PENDING", "MAC_UNREACHABLE"]
        return schemaVersion == 1 && codes.contains(code) && !title.isEmpty && title.count <= 160 && message.count <= 800
            && ["check-status", "check-mac", "wait", "open-app", "open-swift-sim", "confirm-install", "none"].contains(nextAction)
            && completionVerified == ["CHANGES_APPLIED", "BUILD_INSTALLED"].contains(code)
            && updatedAt.count <= 64 && SwiftSimISO8601.date(from: updatedAt) != nil
            && (buildId.map(ActivityEvent.validID) ?? true) && (requestId.map(ActivityEvent.validID) ?? true)
            && (revision.map { $0 > 0 } ?? true)
    }
    var needsAttention: Bool { ["STATUS_UNAVAILABLE", "UNCONFIRMED", "CHECK_MAC", "NEEDS_ATTENTION", "MULTIPLE_PENDING", "MAC_UNREACHABLE"].contains(code) }
    var symbol: String { completionVerified ? "checkmark.circle.fill" : needsAttention ? "exclamationmark.circle" : "clock.arrow.circlepath" }
    func label(for appName: String) -> String {
        let prefix = appName + " — "
        if title.hasPrefix(prefix) { return String(title.dropFirst(prefix.count)) }
        return title == appName + " updated" ? "Changes applied" : title
    }
    static func macUnavailable(previous: Self?) -> Self {
        Self(schemaVersion: 1, code: "MAC_UNREACHABLE", title: "Waiting for your Mac",
             message: previous?.code == "UNCONFIRMED" ? "Reconnect to confirm this update before trying again." : "Reconnect to your Mac to check this app’s latest update.",
             nextAction: "check-mac", completionVerified: false, updatedAt: Date().ISO8601Format(), buildId: previous?.buildId, requestId: previous?.requestId, revision: nil)
    }
}
struct AppDeliveryFeed: Decodable {
    let schemaVersion: Int
    let apps: [String: AppDeliveryPresentation]
    var isValid: Bool { schemaVersion == 1 && apps.count <= 128 && apps.keys.allSatisfy(ActivityEvent.validID) && apps.values.allSatisfy(\.isValid) }
}

struct ActivityFeed: Decodable {
    let schemaVersion: Int
    let events: [ActivityEvent]
    let cursor: Int
    let truncated: Bool?
    let installationId: String
    let notificationStatus: ActivityProviderStatus
    let preferences: ActivityPreferences?
    let deliveryStatus: AppDeliveryFeed?

    var isValid: Bool {
        schemaVersion == 1 && (deliveryStatus?.isValid ?? true) && cursor >= 0 && events.count <= 200 && !installationId.isEmpty
            && installationId.count <= 256 && events.allSatisfy(\.isValid)
            && Set(events.map(\.id)).count == events.count
            && events.allSatisfy { $0.sequence <= cursor }
    }
}

struct ActivityPushTarget: Codable, Equatable, Sendable {
    let eventId: String
    let macID: String

    init?(userInfo: [AnyHashable: Any]) {
        guard let event = userInfo["eventId"] as? String,
              let mac = userInfo["macID"] as? String,
              ActivityEvent.validID(event), !mac.isEmpty, mac.count <= 256 else { return nil }
        eventId = event
        macID = mac
    }
}

private struct ActivityCache: Codable {
    var events: [ActivityEvent] = []
    var cursor = 0
    var readCursor = 0
    var installationId: String?
    var preferences = ActivityPreferences()
    var hasSynced = false
    var preferenceDefaultsVersion: Int? = 1
}

enum ActivityPresentation: String, Identifiable {
    case inbox
    var id: String { rawValue }
}

@MainActor
final class ActivityCenter: ObservableObject {
    @Published private(set) var events: [ActivityEvent] = []
    @Published private(set) var deliveryStatuses: [String: AppDeliveryPresentation] = [:]
    @Published private(set) var unreadCount = 0
    @Published private(set) var preferences = ActivityPreferences()
    @Published private(set) var providerStatus: ActivityProviderStatus?
    @Published private(set) var isRefreshing = false
    @Published private(set) var errorMessage: String?
    @Published var presentation: ActivityPresentation?
    var isPresented: Bool { get { presentation != nil } set { presentation = newValue ? .inbox : nil } }
    @Published var selectedEvent: ActivityEvent?
    var onOpenEvent: ((ActivityEvent) async -> Void)?
    var onForegroundEvent: ((ActivityEvent) -> Void)?

    private var mac: PairedMac?
    private var generation: UInt64 = 0
    private var cache = ActivityCache()
    private var cacheKey: String?
    private var active = false
    private var poll: Task<Void, Never>?
    private var registrationRunning = false
    private var registrationNeeded = false
    private var baselineReceived = false
    private var pendingFullRefresh = false
    private var subscriptions: Set<AnyCancellable> = []
    private let defaults: UserDefaults
    private let transport: ((URLRequest) async throws -> (Data, HTTPURLResponse))?
    let notifications: CompanionNotifications

    init(defaults: UserDefaults = .standard, notifications: CompanionNotifications? = nil, transport: ((URLRequest) async throws -> (Data, HTTPURLResponse))? = nil) {
        self.defaults = defaults
        self.transport = transport
        self.notifications = notifications ?? .shared
        self.notifications.$deviceToken.dropFirst().sink { [weak self] _ in
            Task { @MainActor in await self?.synchronizeRegistration() }
        }.store(in: &subscriptions)
        self.notifications.$diagnostics.dropFirst().sink { [weak self] _ in
            Task { @MainActor in await self?.synchronizeRegistration() }
        }.store(in: &subscriptions)
        self.notifications.$pendingTap.compactMap { $0 }.sink { [weak self] _ in
            Task { @MainActor in await self?.handlePendingTap() }
        }.store(in: &subscriptions)
        self.notifications.$foregroundUpdate.compactMap { $0 }.sink { [weak self] _ in
            Task { @MainActor in await self?.refresh() }
        }.store(in: &subscriptions)
    }

    func connect(to next: PairedMac?) {
        if mac?.id == next?.id && mac?.token == next?.token { mac = next; return }
        let previous = mac
        if let previous { Task { try? await self.request(url: previous.baseURL.appending(path: "api/activity/device/\(self.deviceId)"), method: "DELETE", body: nil, mac: previous) } }
        generation &+= 1
        isRefreshing = false
        poll?.cancel()
        mac = next
        cache = ActivityCache()
        cacheKey = nil
        baselineReceived = false
        pendingFullRefresh = false
        providerStatus = nil
        deliveryStatuses = [:]
        errorMessage = nil
        selectedEvent = nil
        if let next {
            let digest = SHA256.hash(data: Data("\(next.id)\u{0}\(next.token)".utf8)).map { String(format: "%02x", $0) }.joined()
            let key = "swiftSim.activity.\(digest)"
            cacheKey = key
            if let data = defaults.data(forKey: key), data.count < 512 * 1024,
               let saved = try? JSONDecoder().decode(ActivityCache.self, from: data) {
                cache = saved
                cache.preferences = saved.preferences.adoptingCurrentDefaults(previousVersion: saved.preferenceDefaultsVersion)
                cache.preferenceDefaultsVersion = 1
                cache.events = saved.events.filter(\.isValid).suffix(200).map { $0 }
            }
        }
        publishCache()
        if active { startPolling() }
    }

    func setActive(_ value: Bool) {
        active = value
        poll?.cancel()
        if value {
            Task { await notifications.refreshAuthorization() }
            startPolling()
        }
    }

    private func startPolling() {
        poll?.cancel()
        guard mac != nil, active else { return }
        poll = Task { [weak self] in
            var turns = 0
            while !Task.isCancelled {
                if turns % 6 == 0 { await self?.synchronizeRegistration() }
                await self?.refresh()
                turns += 1
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    func refresh(fromBeginning: Bool = false) async {
        guard let mac else { return }
        if isRefreshing {
            if fromBeginning { pendingFullRefresh = true }
            return
        }
        let expected = generation
        isRefreshing = true
        defer {
            if generation == expected {
                isRefreshing = false
                if pendingFullRefresh {
                    pendingFullRefresh = false
                    Task { await refresh(fromBeginning: true) }
                }
            }
        }
        do {
            var url = mac.baseURL.appending(path: "api/activity")
            url = url.appending(queryItems: [.init(name: "after", value: String(fromBeginning ? 0 : cache.cursor)), .init(name: "deviceId", value: deviceId)])
            let data = try await request(url: url, method: "GET", body: nil, mac: mac)
            let feed = try JSONDecoder().decode(ActivityFeed.self, from: data)
            guard feed.isValid, feed.cursor >= cache.cursor else { throw URLError(.cannotParseResponse) }
            guard isCurrent(mac, expected) else { return }
            let previousCursor = cache.cursor
            let previousEvents = Dictionary(uniqueKeysWithValues: cache.events.map { ($0.id, $0) })
            var merged = previousEvents
            for event in feed.events { merged[event.id] = event }
            cache.events = merged.values.sorted { $0.sequence < $1.sequence }.suffix(200).map { $0 }
            cache.cursor = max(cache.cursor, feed.cursor)
            let previousInstallationID = cache.installationId
            cache.installationId = feed.installationId
            if previousInstallationID != feed.installationId {
                Task { await synchronizeRegistration() }
            }
            if !cache.hasSynced { cache.readCursor = cache.cursor }
            cache.hasSynced = true
            providerStatus = feed.notificationStatus
            let nextStatuses = feed.deliveryStatus?.apps ?? [:]
            if deliveryStatuses != nextStatuses { deliveryStatuses = nextStatuses }
            errorMessage = nil
            if baselineReceived, let event = feed.events.last(where: { event in
                event.sequence > previousCursor && event.isMeaningful
                    && !(previousEvents[event.id]?.hasSameOccurrence(as: event) ?? false)
            }) {
                onForegroundEvent?(event)
            }
            baselineReceived = true
            publishCache()
            if !pendingFullRefresh { await handlePendingTap(refreshFirst: false) }
        } catch {
            guard isCurrent(mac, expected) else { return }
            errorMessage = "Activity couldn’t refresh. Keep the Mac awake and check your private connection."
        }
    }

    func deliveryStatus(for app: ManagedApp) -> AppDeliveryPresentation? {
        guard let mac, app.ownerPairingID == mac.id else { return nil }
        let status = deliveryStatuses[app.id]
        return errorMessage == nil ? status : .macUnavailable(previous: status)
    }

    func updatePreferences(_ value: ActivityPreferences) {
        preferences = value
        cache.preferences = value
        saveCache()
        Task { await synchronizeRegistration() }
    }

    func enableNotifications() async {
        await notifications.requestPermission()
        await synchronizeRegistration()
    }

    func synchronizeRegistration() async {
        registrationNeeded = true
        guard !registrationRunning else { return }
        registrationRunning = true
        defer { registrationRunning = false }
        while registrationNeeded {
            registrationNeeded = false
            guard let mac, active else { return }
            let expected = generation
            var body: [String: Any] = ["deviceId": deviceId, "environment": Self.pushEnvironment, "preferences": ["queued": preferences.queued, "buildReady": preferences.buildReady, "attention": preferences.attention, "hotReload": preferences.hotReload, "launchConfirmed": preferences.launchConfirmed]]
            if notifications.authorization == .denied { body["token"] = "" }
            else if let token = notifications.deviceToken { body["token"] = token }
            if let diagnostics = notifications.diagnostics?.scoped(to: cache.installationId),
               let encoded = try? JSONEncoder().encode(diagnostics),
               let value = try? JSONSerialization.jsonObject(with: encoded) {
                body["diagnostics"] = value
            }
            do {
                let data = try await request(url: mac.baseURL.appending(path: "api/activity/device"), method: "POST", body: JSONSerialization.data(withJSONObject: body), mac: mac)
                guard isCurrent(mac, expected) else { continue }
                struct Registration: Decodable { let notificationStatus: ActivityProviderStatus }
                providerStatus = try JSONDecoder().decode(Registration.self, from: data).notificationStatus
            } catch {
                guard isCurrent(mac, expected) else { continue }
                errorMessage = "Notification preferences will sync when this Mac reconnects."
            }
        }
    }

    func markAllRead() {
        cache.readCursor = cache.cursor
        publishCache()
    }

    // On-demand only: ordinary activity refresh/registration never calls these.
    func testingRequest(id: String? = nil, app: String? = nil, expectedMacID: String? = nil) async throws -> AppTestingRequest? {
        guard let mac else { throw URLError(.userAuthenticationRequired) }
        let expected = generation
        if cache.installationId == nil { await refresh(fromBeginning: true) }
        guard isCurrent(mac, expected), let installation = cache.installationId,
              expectedMacID == nil || expectedMacID == installation else { throw URLError(.userAuthenticationRequired) }
        var url = mac.baseURL.appending(path: "api/app-testing/\(id ?? "pending")")
        var items = [URLQueryItem(name: "deviceId", value: deviceId)]
        if let app { items.append(.init(name: "app", value: app)) }
        url = url.appending(queryItems: items)
        let data = try await request(url: url, method: "GET", body: nil, mac: mac)
        struct Envelope: Decodable { let macID: String; let request: AppTestingRequest?; let maximumSeconds: Int? }
        let value = try JSONDecoder().decode(Envelope.self, from: data)
        guard isCurrent(mac, expected), value.macID == installation,
              value.request == nil || ([600, 3600].contains(value.maximumSeconds ?? 0) && value.request?.isValid == true) else { throw URLError(.badServerResponse) }
        return value.request
    }

    func respondToTesting(_ item: AppTestingRequest, action: String) async throws {
        guard let mac, item.isValid, ["approve", "cancel"].contains(action) else { throw URLError(.badURL) }
        let expected = generation
        var payload: [String: Any] = ["deviceId": deviceId, "action": action]
        if action == "approve" { payload["minutes"] = item.minutes ?? 10 }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let data = try await request(url: mac.baseURL.appending(path: "api/app-testing/\(item.id)"), method: "POST", body: body, mac: mac, timeout: action == "cancel" ? 55 : 12)
        struct Envelope: Decodable { let macID: String; let outcome: String }
        let value = try JSONDecoder().decode(Envelope.self, from: data)
        guard isCurrent(mac, expected), value.macID == cache.installationId,
              (action == "approve" ? ["request-approved", "request-consumed"].contains(value.outcome) : value.outcome == "request-cancelled") else { throw URLError(.badServerResponse) }
    }

    func open(_ requestedEvent: ActivityEvent) async {
        // A row can stay on screen while its build expires or is removed.
        // Route using the current authenticated event, never that stale row.
        guard let event = cache.events.first(where: { $0.id == requestedEvent.id }) else { return }
        cache.readCursor = max(cache.readCursor, event.sequence)
        publishCache()
        // A problem opens its explanation; other events open their app.
        if !event.isAttention, (event.buildId != nil || event.targetAppName != nil), let onOpenEvent {
            selectedEvent = nil
            isPresented = false
            await onOpenEvent(event)
        } else {
            isPresented = true
            selectedEvent = event
        }
    }

    private func handlePendingTap(refreshFirst: Bool = true) async {
        guard let target = notifications.pendingTap else { return }
        guard mac != nil else {
            errorMessage = "Connect to the original Mac to view this notification."
            isPresented = true
            return
        }
        if refreshFirst { await refresh(fromBeginning: true); return }
        guard target.macID == cache.installationId else {
            errorMessage = "Connect to the original Mac to view this notification."
            isPresented = true
            return
        }
        guard let event = cache.events.first(where: { $0.id == target.eventId }) else {
            errorMessage = "This update is no longer in recent activity."
            isPresented = true
            notifications.clearTap(target)
            return
        }
        notifications.clearTap(target)
        await open(event)
    }

    private var deviceId: String {
        let key = "swiftSim.notificationDeviceId"
        if let saved = defaults.string(forKey: key), UUID(uuidString: saved) != nil { return saved }
        let value = UUID().uuidString.lowercased()
        defaults.set(value, forKey: key)
        return value
    }
    static var pushEnvironment: String {
        Bundle.main.object(forInfoDictionaryKey: "SwiftSimPushEnvironment") as? String == "production" ? "production" : "sandbox"
    }
    private func isCurrent(_ expected: PairedMac, _ revision: UInt64) -> Bool {
        generation == revision && mac?.id == expected.id && mac?.token == expected.token
    }
    private func publishCache() {
        events = cache.events.reversed()
        preferences = cache.preferences
        unreadCount = cache.events.filter { $0.sequence > cache.readCursor }.count
        saveCache()
    }
    private func saveCache() {
        guard let cacheKey, let data = try? JSONEncoder().encode(cache), data.count < 512 * 1024 else { return }
        defaults.set(data, forKey: cacheKey)
    }
    private func request(url: URL, method: String, body: Data?, mac: PairedMac, timeout: TimeInterval = 12) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.timeoutInterval = timeout
        request.setValue("Bearer \(mac.token)", forHTTPHeaderField: "Authorization")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let transport {
            let (data, response) = try await transport(request)
            guard response.statusCode == 200, data.count < 512 * 1024 else { throw URLError(.badServerResponse) }
            return data
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForResource = timeout + 8
        let session = URLSession(configuration: configuration, delegate: ActivityRedirectFence(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, data.count < 512 * 1024 else { throw URLError(.badServerResponse) }
        return data
    }
}

private final class ActivityRedirectFence: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class CompanionNotifications: ObservableObject {
    static let shared = CompanionNotifications()
    @Published private(set) var deviceToken: String?
    @Published private(set) var pendingTap: ActivityPushTarget?
    @Published private(set) var pendingTestingTap: AppTestingPushTarget?
    @Published private(set) var foregroundUpdate: ActivityPushTarget?
    @Published private(set) var authorization: UNAuthorizationStatus = .notDetermined
    @Published private(set) var registrationMessage: String?
    @Published private(set) var deliveryMessage: String?
    @Published private(set) var diagnostics: CompanionNotificationDiagnostics?
    private let defaults: UserDefaults
    private let now: () -> Date
    private var observations: CompanionPushObservations
    private static let observationsKey = "swiftSim.notificationObservations.v1"

    init(defaults: UserDefaults = .standard, now: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.now = now
        if let data = defaults.data(forKey: Self.observationsKey), data.count < 2048,
           let saved = try? JSONDecoder().decode(CompanionPushObservations.self, from: data), saved.isValid {
            observations = saved
        } else {
            observations = CompanionPushObservations()
        }
    }

    func refreshAuthorization() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        recordPresentation(authorization: settings.authorizationStatus, alerts: settings.alertSetting, style: settings.alertStyle, scheduled: settings.scheduledDeliverySetting)
        if [.authorized, .provisional, .ephemeral].contains(authorization) { UIApplication.shared.registerForRemoteNotifications() }
    }
    func recordPresentation(authorization: UNAuthorizationStatus, alerts: UNNotificationSetting, style: UNAlertStyle, scheduled: UNNotificationSetting) {
        self.authorization = authorization
        deliveryMessage = Self.deliveryMessage(authorization: authorization, alerts: alerts, style: style, scheduled: scheduled)
        diagnostics = CompanionNotificationDiagnostics(authorization: Self.authorizationValue(authorization), alerts: Self.settingValue(alerts), alertStyle: Self.styleValue(style), scheduledDelivery: Self.settingValue(scheduled), observedAt: now().ISO8601Format(), lastForegroundReceipt: observations.lastForegroundReceipt, lastTap: observations.lastTap)
    }
    static func deliveryMessage(authorization: UNAuthorizationStatus, alerts: UNNotificationSetting, style: UNAlertStyle, scheduled: UNNotificationSetting) -> String? {
        if authorization == .provisional {
            return "Notifications are delivered quietly. Choose immediate alerts in iPhone Settings to see banners."
        }
        guard [.authorized, .ephemeral].contains(authorization) else { return nil }
        if alerts == .disabled {
            return "Notification alerts are off in iPhone Settings. Updates still appear in Swift Sim."
        }
        if style == .none {
            return "Notification banners are off in iPhone Settings. Updates may still appear in Notification Center."
        }
        if scheduled == .enabled {
            return "Scheduled Summary may delay alerts. Choose immediate delivery in iPhone Settings for timely updates."
        }
        return "iPhone Settings allow alerts. Focus, connectivity and iOS scheduling can still delay them."
    }
    func requestPermission() async {
        do { _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) }
        catch { registrationMessage = "Notification permission could not be requested. Try again in Settings." }
        await refreshAuthorization()
    }
    func registered(_ data: Data) {
        deviceToken = data.map { String(format: "%02x", $0) }.joined()
        registrationMessage = nil
    }
    func failedRegistration() {
        registrationMessage = "This build could not register for push. Install a push-enabled Swift Sim build and try again."
    }
    func received(_ target: ActivityPushTarget, foreground: Bool) {
        let observation = CompanionPushObservation(eventId: target.eventId, macID: target.macID, observedAt: now().ISO8601Format())
        if observation.isValid {
            if foreground { observations.lastForegroundReceipt = observation }
            else { observations.lastTap = observation }
            if let encoded = try? JSONEncoder().encode(observations), encoded.count < 2048 {
                defaults.set(encoded, forKey: Self.observationsKey)
            }
            if var current = diagnostics {
                current.lastForegroundReceipt = observations.lastForegroundReceipt
                current.lastTap = observations.lastTap
                diagnostics = current
            }
        }
        if foreground { foregroundUpdate = target } else { pendingTap = target }
    }
    func clearTap(_ target: ActivityPushTarget) { if pendingTap == target { pendingTap = nil } }
    func receivedTesting(_ target: AppTestingPushTarget) { pendingTestingTap = target }
    func clearTestingTap(_ target: AppTestingPushTarget) { if pendingTestingTap == target { pendingTestingTap = nil } }
    private static func authorizationValue(_ value: UNAuthorizationStatus) -> String {
        switch value {
        case .authorized: return "authorized"
        case .provisional: return "provisional"
        case .ephemeral: return "ephemeral"
        case .denied: return "denied"
        default: return "not-determined"
        }
    }
    private static func settingValue(_ value: UNNotificationSetting) -> String {
        switch value {
        case .enabled: return "enabled"
        case .disabled: return "disabled"
        default: return "unsupported"
        }
    }
    private static func styleValue(_ value: UNAlertStyle) -> String {
        switch value {
        case .banner: return "banner"
        case .alert: return "alert"
        default: return "none"
        }
    }
}

struct CompanionPushObservation: Codable, Equatable {
    let eventId: String
    let macID: String
    let observedAt: String
    var isValid: Bool { eventId.count == 64 && eventId.allSatisfy { "0123456789abcdef".contains($0) } && ActivityEvent.validID(macID) && observedAt.count <= 64 && SwiftSimISO8601.date(from: observedAt) != nil }
}

private struct CompanionPushObservations: Codable {
    var lastForegroundReceipt: CompanionPushObservation?
    var lastTap: CompanionPushObservation?
    var isValid: Bool { (lastForegroundReceipt?.isValid ?? true) && (lastTap?.isValid ?? true) }
}

struct CompanionNotificationDiagnostics: Codable, Equatable {
    var schemaVersion = 1
    let authorization: String
    let alerts: String
    let alertStyle: String
    let scheduledDelivery: String
    let observedAt: String
    var lastForegroundReceipt: CompanionPushObservation?
    var lastTap: CompanionPushObservation?

    func scoped(to installationID: String?) -> Self {
        var result = self
        if result.lastForegroundReceipt?.macID != installationID { result.lastForegroundReceipt = nil }
        if result.lastTap?.macID != installationID { result.lastTap = nil }
        return result
    }
}

final class CompanionNotificationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        let allow = UNNotificationAction(identifier: "ALLOW_APP_TESTING", title: "Allow Testing", options: [.foreground, .authenticationRequired])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: "SWIFT_SIM_APP_TESTING", actions: [allow], intentIdentifiers: [])
        ])
        return true
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in CompanionNotifications.shared.registered(deviceToken) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in CompanionNotifications.shared.failedRegistration() }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if AppTestingPushTarget(userInfo: notification.request.content.userInfo) != nil {
            completionHandler([.banner, .sound]); return
        }
        let target = ActivityPushTarget(userInfo: notification.request.content.userInfo)
        if let target { Task { @MainActor in CompanionNotifications.shared.received(target, foreground: true) } }
        completionHandler([])
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        if let testing = AppTestingPushTarget(userInfo: response.notification.request.content.userInfo,
            allowOnOpen: response.actionIdentifier == "ALLOW_APP_TESTING") {
            Task { @MainActor in CompanionNotifications.shared.receivedTesting(testing) }
            completionHandler(); return
        }
        let target = ActivityPushTarget(userInfo: response.notification.request.content.userInfo)
        if let target { Task { @MainActor in CompanionNotifications.shared.received(target, foreground: false) } }
        completionHandler()
    }
}
