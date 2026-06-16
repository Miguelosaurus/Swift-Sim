import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        NavigationStack {
            Group {
                if let session = sessionStore.currentSession {
                    SimulatorSessionView(session: session)
                } else {
                    SetupView()
                }
            }
            .navigationTitle("Swift Sim")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct SetupView: View {
    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(.blue)

            Text("Open a Simulator Session")
                .font(.title2.bold())

            Text("Use the link Codex prints after a successful build/run. Universal links open this app directly; the fallback setup page appears when the app is not installed.")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }
}
