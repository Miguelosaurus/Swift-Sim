import Foundation

@main
enum AppTestingHandoffTests {
    static func main() throws {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let handoff = AppTestingHandoff(startedAt: now)
        let launch = URLComponents(url: handoff.launchURL, resolvingAgainstBaseURL: false)!
        precondition(launch.scheme == "ictrl" && launch.host == "start")
        precondition(launch.queryItems!.count == 1)
        let callback = URL(string: launch.queryItems![0].value!)!
        precondition(handoff.receipt(from: callback, now: now) == nil)
        let ready = URL(string: callback.absoluteString + "&status=ready")!
        precondition(handoff.receipt(from: ready, now: now) == .returned)
        precondition(handoff.receipt(from: ready, now: now.addingTimeInterval(91)) == nil)
        precondition(handoff.receipt(from: ready, now: now.addingTimeInterval(-1)) == nil)
        let failed = URL(string: callback.absoluteString + "&status=failed")!
        precondition(handoff.receipt(from: failed, now: now) == .failed)
        for invalid in [
            ready.absoluteString + "&status=ready",
            ready.absoluteString + "&attempt=" + handoff.attempt.uuidString,
            ready.absoluteString + "&url=https://untrusted.example",
            ready.absoluteString + "#fragment",
            ready.absoluteString.replacingOccurrences(of: "/return?", with: "/start?"),
            ready.absoluteString.replacingOccurrences(of: "app-testing/", with: "elsewhere/"),
            ready.absoluteString.replacingOccurrences(of: handoff.attempt.uuidString, with: UUID().uuidString),
            ready.absoluteString.replacingOccurrences(of: "status=ready", with: "status=authorized"),
            ready.absoluteString.replacingOccurrences(of: "app-testing/", with: "app-testing:8200/"),
            ready.absoluteString.replacingOccurrences(of: "app-testing/", with: "user@app-testing/")
        ] {
            precondition(handoff.receipt(from: URL(string: invalid)!, now: now) == nil)
        }
        let restored = try JSONDecoder().decode(AppTestingHandoff.self, from: JSONEncoder().encode(handoff))
        precondition(restored == handoff)
        print("App testing handoff: launch encoding, cold return, nonce, expiry and untrusted callbacks passed")
    }
}
