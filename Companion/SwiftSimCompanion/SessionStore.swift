import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var currentSession: SimulatorSession?
    @Published var isConnected = false
    @Published var logs: [String] = []
    @Published private(set) var pairedMac: PairedMac?
    @Published private(set) var helperStatus: HelperConnectionStatus = .notPaired
    @Published private(set) var recentSessions: [RecentSession] = []

    private let recentSessionsKey = "recentSessions"
    private let pairedMacKey = "pairedMac"

    init() {
        loadRecentSessions()
        loadPairedMac()
        Task { await refreshHelperStatus() }
    }

    @discardableResult
    func open(_ url: URL) -> Bool {
        if let pairing = PairedMac(url: url) {
            pairedMac = pairing
            savePairedMac()
            helperStatus = .checking
            Task { await refreshHelperStatus() }
            return true
        }

        guard let session = SimulatorSession(url: url) else { return false }
        currentSession = session
        upsertRecentSession(RecentSession(session: session, displayName: nil))
        Task { await refresh() }
        return true
    }

    func reopen(_ recent: RecentSession) {
        currentSession = recent.session
        upsertRecentSession(recent.touch())
        Task { await refresh() }
    }

    func closeCurrentSession() {
        currentSession = nil
        isConnected = false
        logs = []
    }

    func refresh() async {
        guard let session = currentSession else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: session.statusURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                isConnected = false
                return
            }
            if let status = try? JSONDecoder().decode(SessionStatus.self, from: data) {
                let name = status.scheme.isEmpty ? nil : status.scheme
                upsertRecentSession(RecentSession(session: session, displayName: name))
            }
            isConnected = true
            await fetchLogs()
        } catch {
            isConnected = false
        }
    }

    func fetchLogs() async {
        guard let session = currentSession else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: session.logsURL)
            let decoded = try JSONDecoder().decode(SessionLogs.self, from: data)
            logs = decoded.logs
        } catch {
            logs = ["Unable to load logs: \(error.localizedDescription)"]
        }
    }

    func sendControl(_ control: String) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.controlURL(control))
        request.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func typeText(_ text: String) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.typeURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["text": text])
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func tapSimulator(x: Double, y: Double) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.tapURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode([
            "x": min(max(x, 0), 1),
            "y": min(max(y, 0), 1),
        ])
        _ = try? await URLSession.shared.data(for: request)
    }

    func sendGesture(_ event: SimulatorGestureEvent) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.gestureURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(event)
        _ = try? await URLSession.shared.data(for: request)
    }

    func refreshHelperStatus() async {
        guard let mac = pairedMac else {
            helperStatus = .notPaired
            return
        }

        helperStatus = .checking
        do {
            let (data, response) = try await URLSession.shared.data(from: mac.statusURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                helperStatus = .offline
                return
            }
            let decoded = try JSONDecoder().decode(PairingStatus.self, from: data)
            pairedMac = mac.updated(name: decoded.macName)
            savePairedMac()
            helperStatus = .online
        } catch {
            helperStatus = .offline
        }
    }

    func forgetPairedMac() {
        pairedMac = nil
        helperStatus = .notPaired
        UserDefaults.standard.removeObject(forKey: pairedMacKey)
    }

    private func loadRecentSessions() {
        guard let data = UserDefaults.standard.data(forKey: recentSessionsKey),
              let decoded = try? JSONDecoder().decode([RecentSession].self, from: data) else {
            recentSessions = []
            return
        }
        recentSessions = decoded.sorted { $0.lastOpened > $1.lastOpened }
    }

    private func saveRecentSessions() {
        guard let data = try? JSONEncoder().encode(recentSessions) else { return }
        UserDefaults.standard.set(data, forKey: recentSessionsKey)
    }

    private func upsertRecentSession(_ recent: RecentSession) {
        var next = recentSessions.filter { $0.id != recent.id }
        next.insert(recent, at: 0)
        recentSessions = Array(next.prefix(8))
        saveRecentSessions()
    }

    private func loadPairedMac() {
        guard let data = UserDefaults.standard.data(forKey: pairedMacKey),
              let decoded = try? JSONDecoder().decode(PairedMac.self, from: data) else {
            pairedMac = nil
            helperStatus = .notPaired
            return
        }
        pairedMac = decoded
        helperStatus = .checking
    }

    private func savePairedMac() {
        guard let pairedMac,
              let data = try? JSONEncoder().encode(pairedMac) else { return }
        UserDefaults.standard.set(data, forKey: pairedMacKey)
    }
}

enum HelperConnectionStatus {
    case notPaired
    case checking
    case online
    case offline

    var title: String {
        switch self {
        case .notPaired: "Not paired"
        case .checking: "Checking"
        case .online: "Online"
        case .offline: "Offline"
        }
    }

    var detail: String {
        switch self {
        case .notPaired: "Open a pairing link from the Mac helper"
        case .checking: "Testing helper connection"
        case .online: "Private access ready"
        case .offline: "Open Tailscale or relink this Mac"
        }
    }
}

struct PairedMac: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let pairedAt: Date
    let lastSeenAt: Date?

    var baseURL: URL {
        URL(string: baseURLString)!
    }

    var hostDisplayName: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    var statusURL: URL {
        baseURL.appending(path: "api/pairing/status").appending(queryItems: [.init(name: "token", value: token)])
    }

    init(token: String, baseURL: URL, displayName: String = "Paired Mac") {
        self.id = baseURL.absoluteString
        self.token = token
        self.baseURLString = baseURL.absoluteString
        self.displayName = displayName
        self.pairedAt = Date()
        self.lastSeenAt = nil
    }

    init?(url: URL) {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        guard !token.isEmpty else { return nil }

        if url.scheme == "swift-sim" {
            guard url.host == "pair" else { return nil }
            let base = components?.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
            guard let baseURL = URL(string: base) else { return nil }
            self.init(token: token, baseURL: baseURL)
            return
        }

        guard url.scheme == "https" || url.scheme == "http",
              url.path == "/pair" else { return nil }
        var baseComponents = URLComponents()
        baseComponents.scheme = url.scheme
        baseComponents.host = url.host
        baseComponents.port = url.port
        guard let baseURL = baseComponents.url else { return nil }
        self.init(token: token, baseURL: baseURL)
    }

    func updated(name: String) -> PairedMac {
        PairedMac(
            id: id,
            token: token,
            baseURLString: baseURLString,
            displayName: name.isEmpty ? displayName : name,
            pairedAt: pairedAt,
            lastSeenAt: Date()
        )
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, pairedAt: Date, lastSeenAt: Date?) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.pairedAt = pairedAt
        self.lastSeenAt = lastSeenAt
    }
}

struct SimulatorSession: Identifiable, Equatable {
    let id: String
    let token: String
    let baseURL: URL

    init(id: String, token: String, baseURL: URL) {
        self.id = id
        self.token = token
        self.baseURL = baseURL
    }

    var fallbackWebURL: URL {
        baseURL.appending(path: "s/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var streamURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/stream").appending(queryItems: [.init(name: "token", value: token)])
    }

    var statusURL: URL {
        baseURL.appending(path: "api/sessions/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var logsURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/logs").appending(queryItems: [.init(name: "token", value: token)])
    }

    func controlURL(_ control: String) -> URL {
        baseURL.appending(path: "api/sessions/\(id)/control/\(control)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var typeURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/type").appending(queryItems: [.init(name: "token", value: token)])
    }

    var tapURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/tap").appending(queryItems: [.init(name: "token", value: token)])
    }

    var gestureURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/gesture").appending(queryItems: [.init(name: "token", value: token)])
    }

    init?(url: URL) {
        if url.scheme == "swift-sim" {
            guard url.host == "session" else { return nil }
            let id = url.pathComponents.dropFirst().first ?? ""
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
            let base = components?.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
            guard !id.isEmpty, !token.isEmpty, let baseURL = URL(string: base) else { return nil }
            self.id = id
            self.token = token
            self.baseURL = baseURL
            return
        }

        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        let parts = url.pathComponents
        guard parts.count >= 3, parts[1] == "s", !token.isEmpty else { return nil }
        self.id = parts[2]
        self.token = token
        var baseComponents = URLComponents()
        baseComponents.scheme = url.scheme
        baseComponents.host = url.host
        baseComponents.port = url.port
        guard let baseURL = baseComponents.url else { return nil }
        self.baseURL = baseURL
    }
}

struct SimulatorGestureEvent: Encodable {
    let type: String
    let x: Double
    let y: Double
}

struct RecentSession: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let lastOpened: Date

    var session: SimulatorSession {
        SimulatorSession(id: id, token: token, baseURL: URL(string: baseURLString)!)
    }

    var hostDisplayName: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    var initials: String {
        let pieces = displayName.split(separator: " ")
        let letters = pieces.prefix(2).compactMap { $0.first }
        let result = String(letters).uppercased()
        return result.isEmpty ? "SS" : result
    }

    init(session: SimulatorSession, displayName: String?) {
        self.id = session.id
        self.token = session.token
        self.baseURLString = session.baseURL.absoluteString
        self.displayName = displayName ?? "Session \(session.id.prefix(6))"
        self.lastOpened = Date()
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, lastOpened: Date) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.lastOpened = lastOpened
    }

    func touch() -> RecentSession {
        RecentSession(id: id, token: token, baseURLString: baseURLString, displayName: displayName, lastOpened: Date())
    }
}

private struct SessionStatus: Decodable {
    let scheme: String
}

private struct SessionLogs: Decodable {
    let logs: [String]
}

private struct PairingStatus: Decodable {
    let macName: String
}

private extension URL {
    func appending(path: String) -> URL {
        var url = self
        for component in path.split(separator: "/") {
            url.append(path: String(component))
        }
        return url
    }

    func appending(queryItems: [URLQueryItem]) -> URL {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        let existing = components?.queryItems ?? []
        components?.queryItems = existing + queryItems
        return components?.url ?? self
    }
}
