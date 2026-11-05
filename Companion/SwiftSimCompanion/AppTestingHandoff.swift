import Foundation

/// A launch receipt is only a handoff hint. The Mac authenticates the runner
/// independently before opening a testing session or sending any app input.
struct AppTestingHandoff: Codable, Equatable {
    let attempt: UUID
    let startedAt: Date
    let approval: AppTestingRequest?

    static let storageKey = "swiftSim.appTesting.pendingLaunch"
    static let lifetime: TimeInterval = 90

    init(attempt: UUID = UUID(), startedAt: Date = Date(), approval: AppTestingRequest? = nil) {
        self.attempt = attempt
        self.startedAt = startedAt
        self.approval = approval
    }

    var launchURL: URL {
        var callback = URLComponents()
        callback.scheme = "swift-sim"
        callback.host = "app-testing"
        callback.path = "/return"
        callback.queryItems = [URLQueryItem(name: "attempt", value: attempt.uuidString)]
        var launch = URLComponents()
        launch.scheme = "ictrl"
        launch.host = "start"
        launch.queryItems = [URLQueryItem(name: "callback", value: callback.url!.absoluteString)]
        return launch.url!
    }

    static func handles(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "swift-sim" && url.host?.lowercased() == "app-testing"
    }

    enum Receipt: Equatable { case returned, failed }

    func receipt(from url: URL, now: Date = Date()) -> Receipt? {
        guard Self.handles(url), url.path == "/return", url.user == nil,
              url.password == nil, url.port == nil, url.fragment == nil,
              now >= startedAt, now.timeIntervalSince(startedAt) <= Self.lifetime,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let items = components.queryItems, items.count == 2,
              items.filter({ $0.name == "attempt" }).count == 1,
              items.filter({ $0.name == "status" }).count == 1,
              items.first(where: { $0.name == "attempt" })?.value == attempt.uuidString
        else { return nil }
        switch items.first(where: { $0.name == "status" })?.value {
        case "ready": return .returned
        case "failed": return .failed
        default: return nil
        }
    }
}

struct AppTestingRequest: Codable, Equatable {
    let id: String
    let app: String
    let name: String
    let expiresAt: TimeInterval
    let state: String

    var isValid: Bool {
        UUID(uuidString: id) != nil && id.count == 36 && !app.isEmpty && app.count <= 256
            && app.range(of: #"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$"#, options: .regularExpression) != nil
            && !app.hasPrefix("com.apple.") && !name.isEmpty && name.count <= 80
            && expiresAt.isFinite && ["pending", "approved", "consumed", "cancelled", "closed"].contains(state)
    }
    var canAllow: Bool { isValid && Date().timeIntervalSince1970 < expiresAt && ["pending", "approved"].contains(state) }
}

struct AppTestingPushTarget: Equatable {
    let requestID: String
    let macID: String
    let allowOnOpen: Bool
    init?(userInfo: [AnyHashable: Any], allowOnOpen: Bool = false) {
        guard let id = userInfo["appTestingRequestId"] as? String, id.count == 36, UUID(uuidString: id) != nil,
              let mac = userInfo["macID"] as? String, !mac.isEmpty, mac.count <= 128 else { return nil }
        requestID = id
        macID = mac
        self.allowOnOpen = allowOnOpen
    }
}
