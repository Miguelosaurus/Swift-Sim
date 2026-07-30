import SwiftUI
import Security
import Foundation

@main
struct SwiftSimCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var sessionStore: SessionStore
    @State private var pairingAlert: PairingAlert?

    init() {
        URLProtocol.registerClass(SwiftSimRequestFenceProtocol.self)
        PairingCredentialVault.prepareForSessionStore()
        PairingCredentialVault.startMonitoring()
        _sessionStore = StateObject(wrappedValue: SessionStore())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sessionStore)
                .onOpenURL { url in
                    guard PairedMac(url: url) != nil else {
                        _ = sessionStore.open(url)
                        return
                    }
                    do {
                        pairingAlert = .confirmation(try PendingPairing(url: url))
                    } catch {
                        pairingAlert = .failure(error.localizedDescription)
                    }
                }
                .alert(item: $pairingAlert) { item in
                    switch item {
                    case .confirmation(let pairing):
                        return Alert(
                            title: Text(sessionStore.pairedMac == nil ? "Connect this Mac?" : "Replace connected Mac?"),
                            message: Text("Swift Sim will trust \(pairing.host) and allow it to provide app history, build metadata, and install links. Only continue if you created this pairing link."),
                            primaryButton: .cancel {
                                PairingCredentialVault.cancelStagedPairing(pairingID: pairing.pairingID)
                            },
                            secondaryButton: .default(Text("Connect")) {
                                guard sessionStore.open(pairing.url) else {
                                    PairingCredentialVault.cancelStagedPairing(pairingID: pairing.pairingID)
                                    pairingAlert = .failure("The pairing could not be saved securely. Pair this Mac again.")
                                    return
                                }
                            }
                        )
                    case .failure(let message):
                        return Alert(
                            title: Text("Unable to connect this Mac"),
                            message: Text(message),
                            dismissButton: .default(Text("OK"))
                        )
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await sessionStore.refreshAppState() }
                }
        }
    }
}

private final class SwiftSimRequestFenceProtocol: URLProtocol, @unchecked Sendable {
    private struct LaneState {
        var running: SwiftSimRequestFenceProtocol?
        var pending: SwiftSimRequestFenceProtocol?
    }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var lanes: [String: LaneState] = [:]

    private var task: URLSessionDataTask?
    private var session: URLSession?
    private var completed = false

    override class func canInit(with request: URLRequest) -> Bool {
        guard request.value(forHTTPHeaderField: "X-Swift-Sim-Fenced") == nil,
              let path = request.url?.path else { return false }
        return path == "/api/pairing/status" || isSessionStatePath(path)
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let lane = Self.lane(for: request) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }

        var shouldStart = false
        var runningToCancel: SwiftSimRequestFenceProtocol?
        var pendingToSupersede: SwiftSimRequestFenceProtocol?
        Self.lock.lock()
        var state = Self.lanes[lane] ?? LaneState()
        if state.running == nil {
            state.running = self
            shouldStart = true
        } else {
            pendingToSupersede = state.pending
            state.pending = self
            runningToCancel = state.running
        }
        Self.lanes[lane] = state
        Self.lock.unlock()

        pendingToSupersede?.failBeforeStart()
        runningToCancel?.task?.cancel()
        if shouldStart { beginNetworkRequest() }
    }

    override func stopLoading() {
        task?.cancel()
    }

    private func beginNetworkRequest() {
        var forwarded = request
        forwarded.setValue("1", forHTTPHeaderField: "X-Swift-Sim-Fenced")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = []
        let session = URLSession(configuration: configuration)
        self.session = session
        task = session.dataTask(with: forwarded) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.client?.urlProtocol(self, didFailWithError: error)
            } else if let response {
                self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                if let data, !data.isEmpty {
                    self.client?.urlProtocol(self, didLoad: data)
                }
                self.client?.urlProtocolDidFinishLoading(self)
            } else {
                self.client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            }
            self.finishLane()
        }
        task?.resume()
    }

    private func failBeforeStart() {
        guard !completed else { return }
        completed = true
        client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
    }

    private func finishLane() {
        guard !completed, let lane = Self.lane(for: request) else { return }
        completed = true
        session?.finishTasksAndInvalidate()
        var next: SwiftSimRequestFenceProtocol?
        Self.lock.lock()
        var state = Self.lanes[lane] ?? LaneState()
        if state.running === self {
            next = state.pending
            state.running = next
            state.pending = nil
            if state.running == nil {
                Self.lanes.removeValue(forKey: lane)
            } else {
                Self.lanes[lane] = state
            }
        }
        Self.lock.unlock()
        next?.beginNetworkRequest()
    }

    private static func lane(for request: URLRequest) -> String? {
        guard let path = request.url?.path else { return nil }
        if path == "/api/pairing/status" { return "helper-status" }
        let parts = path.split(separator: "/")
        if parts.count == 4, parts[0] == "api", parts[1] == "sessions", parts[3] == "logs" {
            return "simulator-logs"
        }
        if parts.count == 3, parts[0] == "api", parts[1] == "sessions" {
            return "simulator-status"
        }
        return nil
    }

    private static func isSessionStatePath(_ path: String) -> Bool {
        let parts = path.split(separator: "/")
        return (parts.count == 3 && parts[0] == "api" && parts[1] == "sessions")
            || (parts.count == 4 && parts[0] == "api" && parts[1] == "sessions" && parts[3] == "logs")
    }
}

private enum PairingAlert: Identifiable {
    case confirmation(PendingPairing)
    case failure(String)

    var id: String {
        switch self {
        case .confirmation(let pairing):
            return "confirmation:\(pairing.id.uuidString)"
        case .failure(let message):
            return "failure:\(message)"
        }
    }
}

private struct PendingPairing: Identifiable {
    let id = UUID()
    let url: URL
    let host: String
    let pairingID: String

    init(url: URL) throws {
        guard let stableURL = Self.stablePairingURL(from: url),
              let pairing = PairedMac(url: stableURL) else {
            throw PairingCredentialVault.credentialError("This pairing link is invalid.")
        }
        guard PairingCredentialVault.stagePairing(token: pairing.token, pairingID: pairing.id) else {
            throw PairingCredentialVault.credentialError("The pairing credential could not be protected in Keychain. Unlock this iPhone and try again.")
        }
        self.url = stableURL
        self.host = pairing.hostDisplayName
        self.pairingID = pairing.id
    }

    private static func stablePairingURL(from url: URL) -> URL? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let token = components.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        let macID = components.queryItems?.first(where: { $0.name == "macID" })?.value ?? ""
        guard !token.isEmpty else { return nil }

        let baseValue: String
        if url.scheme == "swift-sim", url.host == "pair" {
            baseValue = components.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
        } else if url.scheme == "https" || url.scheme == "http", url.path == "/pair" {
            var base = URLComponents()
            base.scheme = url.scheme
            base.host = url.host
            base.port = url.port
            baseValue = base.url?.absoluteString ?? ""
        } else {
            return nil
        }
        guard var base = URLComponents(string: baseValue), base.url != nil else { return nil }
        base.fragment = "swift-sim-mac=\(macID.isEmpty ? token : macID)"
        guard let stableBase = base.url?.absoluteString else { return nil }

        var stable = URLComponents()
        stable.scheme = "swift-sim"
        stable.host = "pair"
        stable.queryItems = [
            URLQueryItem(name: "token", value: token),
            URLQueryItem(name: "base", value: stableBase),
        ]
        return stable.url
    }
}

enum PairingCredentialVault {
    private static let markerPrefix = "__swift_sim_keychain__:"
    private static let legacyMarker = "__swift_sim_keychain__"
    private static let defaultsKey = "pairedMac"
    private static let committedAccountKey = "pairedMacCredentialAccount"
    private static let pendingAccountKey = "pairedMacPendingCredentialAccount"
    private static let pendingPairingIDKey = "pairedMacPendingPairingID"
    private static let previousPendingAccountKey = "pairedMacPreviousPendingCredentialAccount"
    private static let previousPendingPairingIDKey = "pairedMacPreviousPendingPairingID"
    private static let pendingHistoryKey = "pairedMacPendingCredentialHistory"
    private static let service = "dev.local.SwiftSimCompanion.pairing"
    private static let legacyAccount = "paired-mac-token"
    private static var defaultsObserver: NSObjectProtocol?

    static func prepareForSessionStore() {
        let defaults = UserDefaults.standard
        guard let data = defaults.data(forKey: defaultsKey) else {
            cleanupWithoutMetadata()
            return
        }
        guard var object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = object["id"] as? String,
              !id.isEmpty,
              let stored = object["token"] as? String,
              !stored.isEmpty else {
            defaults.removeObject(forKey: defaultsKey)
            cleanupWithoutMetadata()
            return
        }

        let expectedLegacyAccount = account(for: id)
        if let storedAccount = account(fromMarker: stored) {
            discardAbandonedPendingAccount(except: storedAccount)
            guard accountIsAllowed(storedAccount, pairingID: id, legacyExpected: expectedLegacyAccount),
                  readToken(account: storedAccount)?.isEmpty == false else {
                defaults.removeObject(forKey: defaultsKey)
                cleanupWithoutMetadata()
                return
            }
            reconcileCommittedAccount(storedAccount)
            return
        }

        if stored == legacyMarker {
            guard let token = readToken(account: legacyAccount), !token.isEmpty,
                  storeToken(token, account: expectedLegacyAccount) else {
                defaults.removeObject(forKey: defaultsKey)
                cleanupWithoutMetadata()
                return
            }
            object["token"] = marker(for: expectedLegacyAccount)
            writePairedMacObject(object)
            reconcileCommittedAccount(expectedLegacyAccount)
            return
        }

        guard storeToken(stored, account: expectedLegacyAccount) else {
            defaults.removeObject(forKey: defaultsKey)
            cleanupWithoutMetadata()
            return
        }
        object["token"] = marker(for: expectedLegacyAccount)
        writePairedMacObject(object)
        reconcileCommittedAccount(expectedLegacyAccount)
    }

    static func startMonitoring() {
        guard defaultsObserver == nil else { return }
        defaultsObserver = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: UserDefaults.standard,
            queue: .main
        ) { _ in
            guard UserDefaults.standard.data(forKey: defaultsKey) != nil else {
                if UserDefaults.standard.string(forKey: pendingAccountKey) != nil { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                    if UserDefaults.standard.data(forKey: defaultsKey) == nil,
                       UserDefaults.standard.string(forKey: pendingAccountKey) == nil {
                        cleanupWithoutMetadata()
                    }
                }
                return
            }
            guard let object = pairedMacObject(),
                  let stored = object["token"] as? String,
                  let currentAccount = account(fromMarker: stored) else {
                UserDefaults.standard.removeObject(forKey: defaultsKey)
                cleanupWithoutMetadata()
                return
            }
            reconcileCommittedAccount(currentAccount)
        }
    }

    static func stagePairing(token: String, pairingID: String) -> Bool {
        guard !token.isEmpty else { return false }
        discardAllStagedPairings()
        let stagedAccount = stagingAccount(for: pairingID)
        let defaults = UserDefaults.standard
        defaults.set(stagedAccount, forKey: pendingAccountKey)
        defaults.set(pairingID, forKey: pendingPairingIDKey)
        defaults.synchronize()
        guard storeToken(token, account: stagedAccount) else {
            deleteToken(account: stagedAccount)
            clearAllPendingMetadata()
            return false
        }
        return true
    }

    static func cancelStagedPairing(pairingID: String) {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: pendingPairingIDKey) == pairingID else { return }
        discardAllStagedPairings()
    }

    static func tokenForDecoding(_ storedValue: String, pairingID: String) throws -> String {
        let expectedAccount = account(for: pairingID)
        if let storedAccount = account(fromMarker: storedValue) {
            guard accountIsAllowed(storedAccount, pairingID: pairingID, legacyExpected: expectedAccount),
                  let token = readToken(account: storedAccount), !token.isEmpty else {
                throw credentialError("The saved pairing credential is unavailable. Pair this Mac again.")
            }
            return token
        }
        if storedValue == legacyMarker {
            guard let token = readToken(account: legacyAccount), !token.isEmpty,
                  storeToken(token, account: expectedAccount) else {
                throw credentialError("The saved pairing credential is unavailable. Pair this Mac again.")
            }
            return token
        }
        guard !storedValue.isEmpty, storeToken(storedValue, account: expectedAccount) else {
            throw credentialError("The pairing credential could not be protected in Keychain.")
        }
        return storedValue
    }

    static func markerForEncoding(token: String, pairingID: String) throws -> String {
        let defaults = UserDefaults.standard
        if defaults.string(forKey: pendingPairingIDKey) == pairingID,
           let pendingAccount = defaults.string(forKey: pendingAccountKey),
           readToken(account: pendingAccount) == token {
            return marker(for: pendingAccount)
        }
        let tokenAccount = account(for: pairingID)
        guard !token.isEmpty, storeToken(token, account: tokenAccount) else {
            throw credentialError("The pairing credential could not be protected in Keychain.")
        }
        defaults.set(tokenAccount, forKey: pendingAccountKey)
        defaults.set(pairingID, forKey: pendingPairingIDKey)
        return marker(for: tokenAccount)
    }

    private static func reconcileCommittedAccount(_ currentAccount: String) {
        let defaults = UserDefaults.standard
        let committedAccount = defaults.string(forKey: committedAccountKey)
        let pendingAccount = defaults.string(forKey: pendingAccountKey)

        // A pending account that does not match the saved metadata means the
        // encoder has not committed that metadata yet. Preserve both accounts.
        if let pendingAccount, pendingAccount != currentAccount {
            return
        }
        if let committedAccount, committedAccount != currentAccount {
            deleteToken(account: committedAccount)
        }
        if currentAccount != legacyAccount {
            deleteToken(account: legacyAccount)
        }
        if committedAccount != currentAccount {
            defaults.set(currentAccount, forKey: committedAccountKey)
        }
        if pendingAccount != nil {
            defaults.removeObject(forKey: pendingAccountKey)
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        if let previous = defaults.string(forKey: previousPendingAccountKey), previous != currentAccount {
            deleteToken(account: previous)
        }
        for item in pendingHistory() where item.account != currentAccount {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        clearPreviousPendingTransaction()
    }

    private static func discardAbandonedPendingAccount(except currentAccount: String) {
        let defaults = UserDefaults.standard
        guard let pendingAccount = defaults.string(forKey: pendingAccountKey),
              pendingAccount != currentAccount else { return }
        deleteToken(account: pendingAccount)
        if let previous = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previous)
        }
        for item in pendingHistory() {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        defaults.removeObject(forKey: pendingAccountKey)
        defaults.removeObject(forKey: pendingPairingIDKey)
        clearPreviousPendingTransaction()
    }

    private static func discardAllStagedPairings() {
        let defaults = UserDefaults.standard
        let committed = defaults.string(forKey: committedAccountKey)
        let accounts = [
            defaults.string(forKey: pendingAccountKey),
            defaults.string(forKey: previousPendingAccountKey),
        ].compactMap { $0 } + pendingHistory().map(\.account)
        for account in Set(accounts) where account != committed {
            deleteToken(account: account)
        }
        clearAllPendingMetadata()
    }

    private static func clearAllPendingMetadata() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: pendingAccountKey)
        defaults.removeObject(forKey: pendingPairingIDKey)
        savePendingHistory([])
        clearPreviousPendingTransaction()
    }

    private static func cleanupWithoutMetadata() {
        let defaults = UserDefaults.standard
        if let committedAccount = defaults.string(forKey: committedAccountKey) {
            deleteToken(account: committedAccount)
        }
        if let pendingAccount = defaults.string(forKey: pendingAccountKey) {
            deleteToken(account: pendingAccount)
        }
        if let previousPendingAccount = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previousPendingAccount)
        }
        for item in pendingHistory() {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        deleteToken(account: legacyAccount)
        if defaults.object(forKey: committedAccountKey) != nil {
            defaults.removeObject(forKey: committedAccountKey)
        }
        if defaults.object(forKey: pendingAccountKey) != nil {
            defaults.removeObject(forKey: pendingAccountKey)
        }
        if defaults.object(forKey: pendingPairingIDKey) != nil {
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        clearPreviousPendingTransaction()
    }

    private struct PendingCredential: Codable {
        let account: String
        let pairingID: String
    }

    private static func pendingHistory() -> [PendingCredential] {
        guard let data = UserDefaults.standard.data(forKey: pendingHistoryKey),
              let decoded = try? JSONDecoder().decode([PendingCredential].self, from: data) else { return [] }
        return decoded
    }

    private static func savePendingHistory(_ history: [PendingCredential]) {
        let defaults = UserDefaults.standard
        guard !history.isEmpty else {
            if defaults.object(forKey: pendingHistoryKey) != nil {
                defaults.removeObject(forKey: pendingHistoryKey)
            }
            return
        }
        if let data = try? JSONEncoder().encode(history),
           defaults.data(forKey: pendingHistoryKey) != data {
            defaults.set(data, forKey: pendingHistoryKey)
        }
    }

    private static func clearPreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: previousPendingAccountKey) != nil {
            defaults.removeObject(forKey: previousPendingAccountKey)
        }
        if defaults.object(forKey: previousPendingPairingIDKey) != nil {
            defaults.removeObject(forKey: previousPendingPairingIDKey)
        }
    }

    private static func marker(for account: String) -> String {
        markerPrefix + account
    }

    private static func account(fromMarker value: String) -> String? {
        guard value.hasPrefix(markerPrefix) else { return nil }
        let account = String(value.dropFirst(markerPrefix.count))
        return account.isEmpty ? nil : account
    }

    private static func account(for pairingID: String) -> String {
        let encoded = Data(pairingID.utf8).base64EncodedString()
        return "paired-mac-token.\(encoded)"
    }

    private static func stagingAccount(for pairingID: String) -> String {
        "paired-mac-token.pending.\(Data(pairingID.utf8).base64EncodedString()).\(UUID().uuidString)"
    }

    private static func accountIsAllowed(_ candidate: String, pairingID: String, legacyExpected: String) -> Bool {
        let defaults = UserDefaults.standard
        if candidate == defaults.string(forKey: committedAccountKey) { return true }
        if candidate == defaults.string(forKey: pendingAccountKey),
           pairingID == defaults.string(forKey: pendingPairingIDKey) { return true }
        return candidate == legacyExpected
    }

    private static func pairedMacObject() -> [String: Any]? {
        guard let data = UserDefaults.standard.data(forKey: defaultsKey),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object
    }

    private static func writePairedMacObject(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        UserDefaults.standard.set(data, forKey: defaultsKey)
    }

    private static func storeToken(_ token: String, account: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return true }
        if status != errSecItemNotFound { return false }
        return SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess
    }

    private static func readToken(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func deleteToken(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func credentialError(_ message: String) -> NSError {
        NSError(domain: "SwiftSimPairingCredential", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

extension PairedMac {
    private enum CodingKeys: String, CodingKey {
        case id
        case token
        case baseURLString
        case displayName
        case pairedAt
        case lastSeenAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        let storedToken = try container.decode(String.self, forKey: .token)
        token = try PairingCredentialVault.tokenForDecoding(storedToken, pairingID: id)
        baseURLString = try container.decode(String.self, forKey: .baseURLString)
        displayName = try container.decode(String.self, forKey: .displayName)
        pairedAt = try container.decode(Date.self, forKey: .pairedAt)
        lastSeenAt = try container.decodeIfPresent(Date.self, forKey: .lastSeenAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(
            PairingCredentialVault.markerForEncoding(token: token, pairingID: id),
            forKey: .token
        )
        try container.encode(baseURLString, forKey: .baseURLString)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(pairedAt, forKey: .pairedAt)
        try container.encodeIfPresent(lastSeenAt, forKey: .lastSeenAt)
    }
}
