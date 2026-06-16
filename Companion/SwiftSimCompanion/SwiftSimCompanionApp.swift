import SwiftUI

@main
struct SwiftSimCompanionApp: App {
    @StateObject private var sessionStore = SessionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(sessionStore)
                .onOpenURL { url in
                    sessionStore.open(url)
                }
        }
    }
}
