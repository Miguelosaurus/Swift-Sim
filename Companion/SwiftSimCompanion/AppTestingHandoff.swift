import Foundation

/// A launch receipt is only a handoff hint. The Mac authenticates the runner
/// independently before opening a testing session or sending any app input.
struct AppTestingHandoff: Codable, Equatable {
    let attempt: UUID
    let startedAt: Date

    static let storageKey = "swiftSim.appTesting.pendingLaunch"
    static let lifetime: TimeInterval = 90

    init(attempt: UUID = UUID(), startedAt: Date = Date()) {
        self.attempt = attempt
        self.startedAt = startedAt
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
