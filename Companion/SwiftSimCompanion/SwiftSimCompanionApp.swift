import SwiftUI

@main
struct SwiftSimCompanionApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sessionStore)
                .onOpenURL { url in
                    sessionStore.open(url)
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else { return }
                    Task { await sessionStore.refreshAppState() }
                }
        }
    }
}
