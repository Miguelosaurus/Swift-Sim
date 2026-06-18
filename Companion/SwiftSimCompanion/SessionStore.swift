import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var currentSession: SimulatorSession?
    @Published var isConnected = false
    @Published var logs: [String] = []
    @Published var activeTransport: SessionTransport?
    @Published private(set) var pairedMac: PairedMac?
    @Published private(set) var helperStatus: HelperConnectionStatus = .notPaired
    @Published private(set) var recentSessions: [RecentSession] = []
    @Published private(set) var tailscaleCheck = ConnectionCheck.notConfigured("Add a simulator session before checking the private route")
    @Published private(set) var macHelperCheck = ConnectionCheck.notConfigured("No Mac helper address is available yet")
    @Published private(set) var simulatorCheck = ConnectionCheck.notConfigured("Open a session link from Codex to add a simulator")

    private let recentSessionsKey = "recentSessions"
    private let pairedMacKey = "pairedMac"
    private var keyboardTail: Task<Void, Never>?

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
        activeTransport = nil
        upsertRecentSession(RecentSession(session: session, displayName: nil))
        Task { await refresh() }
        return true
    }

    func reopen(_ recent: RecentSession) {
        currentSession = recent.session
        activeTransport = nil
        upsertRecentSession(recent.touch())
        Task { await refresh() }
    }

    func closeCurrentSession() {
        currentSession = nil
        isConnected = false
        activeTransport = nil
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
                activeTransport = status.stream
                upsertRecentSession(
                    RecentSession(
                        session: session,
                        displayName: name,
                        recentProjectID: status.recentProjectID
                    )
                )
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

    func typeText(_ text: String) {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.typeURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["text": text])
        enqueueKeyboardRequest(request)
    }

    func sendKey(_ key: String) {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.keyURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["key": key])
        enqueueKeyboardRequest(request)
    }

    private func enqueueKeyboardRequest(_ request: URLRequest) {
        let previous = keyboardTail
        keyboardTail = Task {
            await previous?.value
            _ = try? await URLSession.shared.data(for: request)
        }
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

    func sendMultiTouch(_ event: SimulatorMultiTouchEvent) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.multiTouchURL)
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

    func refreshConnectionChecks() async {
        guard let baseURL = recentSessions.first?.session.baseURL ?? pairedMac?.baseURL else {
            tailscaleCheck = .notConfigured("Add a simulator session before checking the private route")
            macHelperCheck = .notConfigured("No Mac helper address is available yet")
            simulatorCheck = .notConfigured("Open a session link from Codex to add a simulator")
            return
        }

        tailscaleCheck = .checking("Checking the private Tailnet route")
        macHelperCheck = .checking("Contacting the Mac helper")
        simulatorCheck = recentSessions.isEmpty
            ? .notConfigured("Open a session link from Codex to add a simulator")
            : .checking("Checking saved simulator sessions")

        var healthRequest = URLRequest(url: baseURL.appending(path: "health"))
        healthRequest.timeoutInterval = 8

        do {
            let (_, response) = try await URLSession.shared.data(for: healthRequest)
            if (response as? HTTPURLResponse)?.statusCode == 200 {
                tailscaleCheck = .ready("Private HTTPS route is reachable from this iPhone")
                macHelperCheck = .ready("Mac helper responded successfully")
            } else {
                tailscaleCheck = .issue("Private route responded unexpectedly; check Tailscale Serve")
                macHelperCheck = .issue("Helper health check failed")
            }
        } catch {
            tailscaleCheck = .issue("Cannot reach the Mac through Tailscale")
            macHelperCheck = .issue("Start the helper and confirm Tailscale Serve is running")
        }

        guard !recentSessions.isEmpty else { return }

        let availableSession = await withTaskGroup(of: RecentSession?.self) { group in
            for recent in recentSessions {
                group.addTask {
                    var request = URLRequest(url: recent.session.statusURL)
                    request.timeoutInterval = 8
                    guard let (_, response) = try? await URLSession.shared.data(for: request),
                          (response as? HTTPURLResponse)?.statusCode == 200 else {
                        return Optional<RecentSession>.none
                    }
                    return Optional.some(recent)
                }
            }

            for await recent in group {
                if let recent {
                    group.cancelAll()
                    return Optional.some(recent)
                }
            }
            return Optional<RecentSession>.none
        }

        if let availableSession {
            simulatorCheck = .ready("\(availableSession.displayName) is available to open")
            return
        }

        simulatorCheck = .issue("Saved sessions are unavailable; ask Codex to open a fresh simulator session")
    }

    func forgetPairedMac() {
        pairedMac = nil
        helperStatus = .notPaired
        UserDefaults.standard.removeObject(forKey: pairedMacKey)
    }

    func removeRecentSession(_ recent: RecentSession) {
        recentSessions.removeAll { $0.id == recent.id }
        saveRecentSessions()
    }

    private func loadRecentSessions() {
        guard let data = UserDefaults.standard.data(forKey: recentSessionsKey),
              let decoded = try? JSONDecoder().decode([RecentSession].self, from: data) else {
            recentSessions = []
            return
        }
        var seenLegacyProjects = Set<String>()
        recentSessions = decoded
            .sorted { $0.lastOpened > $1.lastOpened }
            .filter { recent in
                guard recent.recentProjectID == nil else { return true }
                let legacyKey = "\(recent.baseURLString)\u{0}\(recent.displayName)"
                return seenLegacyProjects.insert(legacyKey).inserted
            }
        saveRecentSessions()
    }

    private func saveRecentSessions() {
        guard let data = try? JSONEncoder().encode(recentSessions) else { return }
        UserDefaults.standard.set(data, forKey: recentSessionsKey)
    }

    private func upsertRecentSession(_ recent: RecentSession) {
        var next = recentSessions.filter { existing in
            if existing.id == recent.id { return false }
            if let identity = recent.recentProjectID,
               existing.recentProjectID == identity {
                return false
            }

            // Remove duplicate records created by older app versions once the
            // helper supplies the stable identity for this project.
            if existing.recentProjectID == nil,
               existing.baseURLString == recent.baseURLString,
               existing.displayName == recent.displayName {
                return false
            }
            return true
        }
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
        case .notPaired: "Mac helper not linked"
        case .checking: "Checking Mac helper"
        case .online: "Mac helper connected"
        case .offline: "Mac helper unavailable"
        }
    }

    var detail: String {
        switch self {
        case .notPaired: "Recent simulator sessions can still be opened"
        case .checking: "Testing the private Tailscale connection"
        case .online: "Private helper access is ready"
        case .offline: "Check Tailscale Serve and the helper process"
        }
    }
}

struct ConnectionCheck: Equatable {
    enum State: Equatable {
        case notConfigured
        case checking
        case ready
        case issue
    }

    let state: State
    let detail: String

    static func notConfigured(_ detail: String) -> Self {
        Self(state: .notConfigured, detail: detail)
    }

    static func checking(_ detail: String) -> Self {
        Self(state: .checking, detail: detail)
    }

    static func ready(_ detail: String) -> Self {
        Self(state: .ready, detail: detail)
    }

    static func issue(_ detail: String) -> Self {
        Self(state: .issue, detail: detail)
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

    var frameMaskURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/frame-mask").appending(queryItems: [.init(name: "token", value: token)])
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

    var keyURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/key").appending(queryItems: [.init(name: "token", value: token)])
    }

    var tapURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/tap").appending(queryItems: [.init(name: "token", value: token)])
    }

    var gestureURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/gesture").appending(queryItems: [.init(name: "token", value: token)])
    }

    var multiTouchURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/multitouch").appending(queryItems: [.init(name: "token", value: token)])
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
    var scale: Double?
    var velocity: Double?
}

struct SimulatorMultiTouchEvent: Encodable {
    let type: String
    let x1: Double
    let y1: Double
    let x2: Double
    let y2: Double

    func ending() -> Self {
        Self(type: "end", x1: x1, y1: y1, x2: x2, y2: y2)
    }
}

struct RecentSession: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let lastOpened: Date
    let recentProjectID: String?

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

    init(session: SimulatorSession, displayName: String?, recentProjectID: String? = nil) {
        self.id = session.id
        self.token = session.token
        self.baseURLString = session.baseURL.absoluteString
        self.displayName = displayName ?? "Session \(session.id.prefix(6))"
        self.lastOpened = Date()
        self.recentProjectID = recentProjectID
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, lastOpened: Date, recentProjectID: String?) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.lastOpened = lastOpened
        self.recentProjectID = recentProjectID
    }

    func touch() -> RecentSession {
        RecentSession(
            id: id,
            token: token,
            baseURLString: baseURLString,
            displayName: displayName,
            lastOpened: Date(),
            recentProjectID: recentProjectID
        )
    }
}

struct SessionTransport: Decodable, Equatable {
    let state: String
    let transport: String
    let quality: String
    let limitations: [String]

    var isFallback: Bool {
        transport == "serve-sim" || quality == "fallback"
    }

    var displayName: String {
        switch transport {
        case "native-companion":
            "Native stream"
        case "serve-sim":
            "Fallback stream"
        default:
            transport
        }
    }
}

private struct SessionStatus: Decodable {
    let scheme: String
    let stream: SessionTransport
    let recentProjectID: String?
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
