import SwiftUI
import UIKit

/// Created only when the developer explicitly opens optional app testing.
struct AppTestingView: View {
    var appName: String? = nil
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var pending: AppTestingHandoff?
    @State private var launching = false
    @State private var message: String?
    @State private var returned = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label(appName.map { "Test \($0)" } ?? "Test with your coding agent", systemImage: "iphone.and.arrow.forward")
                        .font(.headline)
                    Text("Make your iPhone available while your agent checks an app. Your agent connects privately through Tailscale and stops testing when it finishes.")
                    Button(action: start) {
                        HStack {
                            Text(launching ? "Opening App Testing…" : "Start App Testing")
                            Spacer()
                            if launching { ProgressView() }
                            else { Image(systemName: "arrow.up.forward.app") }
                        }
                    }
                    .disabled(launching)
                    if let message {
                        Label(message, systemImage: returned ? "checkmark.circle" : "info.circle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text("Opening testing does not give an agent permission to use your phone. Begin only when you have agreed to a testing session.")
                }
                Section {
                    DisclosureGroup("Setup & Recovery") {
                        Text("Ask your agent to enable optional iPhone testing on your Mac. It uses a separate, development-signed testing app; your own apps need no additional code.")
                        Text("The first time, allow the iOS prompts and enable Remote Access in the testing app’s notification. Previously approved access is remembered.")
                        Text("After an iPhone restart, Apple’s developer support may need restoring. Ask your agent to check the phone before reinstalling anything. Recovery may require Wi-Fi or reconnecting to your Mac.")
                    }
                }
            }
            .navigationTitle("App Testing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .onAppear { consumeReturn() }
            .onChange(of: sessionStore.appTestingReturnURL) { _, _ in consumeReturn() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, launching else { return }
                launching = false
                message = "Waiting for testing to return. If iOS shows an approval prompt, complete it on your iPhone."
            }
        }
    }

    private func start() {
        guard !launching else { return }
        guard UIApplication.shared.canOpenURL(URL(string: "ictrl://start")!) else {
            message = "App testing is not installed yet. Ask your agent to set it up on your Mac."
            returned = false
            return
        }
        let launch = AppTestingHandoff()
        pending = launch
        UserDefaults.standard.set(try? JSONEncoder().encode(launch), forKey: AppTestingHandoff.storageKey)
        launching = true
        returned = false
        message = nil
        UIApplication.shared.open(launch.launchURL, options: [:]) { opened in
            guard !opened else { return }
            launching = false
            pending = nil
            UserDefaults.standard.removeObject(forKey: AppTestingHandoff.storageKey)
            message = "iOS could not open app testing. Ask your agent to check its installation."
        }
    }

    private func consumeReturn() {
        guard let url = sessionStore.appTestingReturnURL else { return }
        sessionStore.appTestingReturnURL = nil
        let saved = UserDefaults.standard.data(forKey: AppTestingHandoff.storageKey)
            .flatMap { try? JSONDecoder().decode(AppTestingHandoff.self, from: $0) }
        guard let handoff = pending ?? saved, let receipt = handoff.receipt(from: url) else {
            return
        }
        pending = nil
        launching = false
        UserDefaults.standard.removeObject(forKey: AppTestingHandoff.storageKey)
        returned = receipt == .returned
        message = returned
            ? "Testing opened. Your agent will verify the private connection before using the phone."
            : "Testing could not start. Ask your agent to check Apple’s developer support and the testing app."
    }
}
