import SwiftUI
import Security

@main
struct SwiftSimCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var sessionStore: SessionStore
    @State private var pendingPairing: PendingPairing?

    init() {
        PairingCredentialVault.prepareForSessionStore()
        _sessionStore = StateObject(wrappedValue: SessionStore())
        PairingCredentialVault.sealUserDefaults()
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
                            PairingCredentialVault.sealUserDefaults()
                        }
                    )
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background || phase == .inactive {
                        PairingCredentialVault.sealUserDefaults()
                    }
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

/// Keeps the long-lived Mac pairing token out of UserDefaults while preserving
/// the existing Codable shape used by SessionStore.
private enum PairingCredentialVault {
    private static let defaultsKey = "pairedMac"
    private static let service = "dev.local.SwiftSimCompanion.pairing"
    private static let account = "paired-mac-token"
    private static let sealedMarker = "__swift_sim_keychain__"

    static func prepareForSessionStore() {
        guard var object = pairedMacObject(),
              (object["token"] as? String) == sealedMarker else { return }
        guard let token = readToken(), !token.isEmpty else {
            UserDefaults.standard.removeObject(forKey: defaultsKey)
            deleteToken()
            return
        }
        object["token"] = token
        writePairedMacObject(object)
    }

    static func sealUserDefaults() {
        guard var object = pairedMacObject(),
              let token = object["token"] as? String,
              !token.isEmpty,
              token != sealedMarker else { return }
        guard storeToken(token) else { return }
        object["token"] = sealedMarker
        writePairedMacObject(object)
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

    private static func storeToken(_ token: String) -> Bool {
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

    private static func readToken() -> String? {
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

    private static func deleteToken() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}