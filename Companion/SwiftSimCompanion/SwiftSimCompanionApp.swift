import SwiftUI

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
