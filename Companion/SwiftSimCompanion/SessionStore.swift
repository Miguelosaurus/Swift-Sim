import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var currentSession: SimulatorSession?
    @Published var isConnected = false
    @Published var logs: [String] = []

    func open(_ url: URL) {
        guard let session = SimulatorSession(url: url) else { return }
        currentSession = session
        Task { await refresh() }
    }

    func refresh() async {
        guard let session = currentSession else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: session.statusURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                isConnected = false
                return
            }
            _ = data
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
}

struct SimulatorSession: Identifiable, Equatable {
    let id: String
    let token: String
    let baseURL: URL

    var webURL: URL {
        baseURL.appending(path: "s/\(id)").appending(queryItems: [.init(name: "token", value: token)])
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

private struct SessionLogs: Decodable {
    let logs: [String]
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
