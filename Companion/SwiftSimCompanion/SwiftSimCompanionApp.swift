import SwiftUI
import Security

@main
struct SwiftSimCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var sessionStore: SessionStore
    @State private var pendingPairing: PendingPairing?

    init() {
        PairingCredentialVault.prepareForSessionStore()
        PairingCredentialVault.startMonitoring()
        _sessionStore = StateObject(wrappedValue: SessionStore())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sessionStore)
                .onOpenURL { url in
                    if let pairing = PendingPairing(url: url) {
                        pendingPairing = pairing
                    } else {
                        _ = sessionStore.open(url)
                    }
                }
                .alert(item: $pendingPairing) { pairing in
                    Alert(
                        title: Text(sessionStore.pairedMac == nil ? "Connect this Mac?" : "Replace connected Mac?"),
                        message: Text("Swift Sim will trust \(pairing.host) and allow it to provide app history, build metadata, and install links. Only continue if you created this pairing link."),
                        primaryButton: .cancel(),
                        secondaryButton: .default(Text("Connect")) {
                            _ = sessionStore.open(pairing.url)
                        }
                    )
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await sessionStore.refreshAppState() }
                }
        }
    }
}

private struct PendingPairing: Identifiable {
    let id = UUID()
    let url: URL
    let host: String

    init?(url: URL) {
        guard let pairing = PairedMac(url: url) else { return nil }
        self.url = url
        self.host = pairing.hostDisplayName
    }
}

private enum PairingCredentialVault {
    private static let markerPrefix = "__swift_sim_keychain__:"
    private static let legacyMarker = "__swift_sim_keychain__"
    private static let defaultsKey = "pairedMac"
    private static let service = "dev.local.SwiftSimCompanion.pairing"
    private static let legacyAccount = "paired-mac-token"
    private static var defaultsObserver: NSObjectProtocol?

    static func prepareForSessionStore() {
        guard var object = pairedMacObject(),
              let id = object["id"] as? String,
              !id.isEmpty,
              let stored = object["token"] as? String,
              !stored.isEmpty else {
            if UserDefaults.standard.data(forKey: defaultsKey) == nil {
                deleteAllTokens()
            }
            return
        }

        let expectedAccount = account(for: id)
        if let storedAccount = account(fromMarker: stored) {
            guard storedAccount == expectedAccount,
                  readToken(account: storedAccount)?.isEmpty == false else {
                UserDefaults.standard.removeObject(forKey: defaultsKey)
                deleteAllTokens()
                return
            }
            deleteAllTokens(except: storedAccount)
            return
        }

        if stored == legacyMarker {
            guard let token = readToken(account: legacyAccount), !token.isEmpty,
                  storeToken(token, account: expectedAccount) else {
                UserDefaults.standard.removeObject(forKey: defaultsKey)
                deleteAllTokens()
                return
            }
            object["token"] = marker(for: expectedAccount)
            writePairedMacObject(object)
            deleteAllTokens(except: expectedAccount)
            return
        }

        guard storeToken(stored, account: expectedAccount) else {
            UserDefaults.standard.removeObject(forKey: defaultsKey)
            deleteAllTokens()
            return
        }
        object["token"] = marker(for: expectedAccount)
        writePairedMacObject(object)
        deleteAllTokens(except: expectedAccount)
    }

    static func startMonitoring() {
        guard defaultsObserver == nil else { return }
        defaultsObserver = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: UserDefaults.standard,
            queue: .main
        ) { _ in
            guard let object = pairedMacObject(),
                  let stored = object["token"] as? String,
                  let account = account(fromMarker: stored) else {
                if UserDefaults.standard.data(forKey: defaultsKey) == nil {
                    deleteAllTokens()
                }
                return
            }
            deleteAllTokens(except: account)
        }
    }

    static func tokenForDecoding(_ storedValue: String, pairingID: String) throws -> String {
        let expectedAccount = account(for: pairingID)
        if let storedAccount = account(fromMarker: storedValue) {
            guard storedAccount == expectedAccount,
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
        let account = account(for: pairingID)
        guard !token.isEmpty, storeToken(token, account: account) else {
            throw credentialError("The pairing credential could not be protected in Keychain.")
        }
        return marker(for: account)
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

    private static func deleteAllTokens(except retainedAccount: String? = nil) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return }
        let records: [[String: Any]]
        if let values = item as? [[String: Any]] {
            records = values
        } else if let value = item as? [String: Any] {
            records = [value]
        } else {
            return
        }
        for record in records {
            guard let account = record[kSecAttrAccount as String] as? String,
                  account != retainedAccount else { continue }
            let deleteQuery: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: account,
            ]
            SecItemDelete(deleteQuery as CFDictionary)
        }
    }

    private static func credentialError(_ message: String) -> NSError {
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
