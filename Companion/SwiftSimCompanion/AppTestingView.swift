import SwiftUI
import UIKit

/// Created only when the developer explicitly opens optional app testing.
struct AppTestingView: View {
    var appName: String? = nil
    var appBundleID: String? = nil
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore
    @Environment(\.scenePhase) private var scenePhase
    @State private var pending: AppTestingHandoff?
    @State private var launching = false
    @State private var message: String?
    @State private var returned = false
    @State private var request: AppTestingRequest?
    @State private var approvalToRetry: AppTestingRequest?
    @State private var approved = false

    private var actionTitle: String {
        if launching { return "Opening App Testing…" }
        if approved { return "Stop Testing" }
        if approvalToRetry != nil { return "Retry Connection" }
        if let request { return request.canAllow ? "Allow App Testing" : "Testing Finished" }
        return "Start App Testing"
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label((request?.name ?? appName).map { "Test \($0)" } ?? "Test with your coding agent", systemImage: "iphone.and.arrow.forward")
                        .font(.headline)
                    Text("Make your iPhone available while your agent checks an app. Your agent connects privately through Tailscale and stops testing when it finishes.")
                    Button(action: start) {
                        HStack {
                            Text(actionTitle)
                            Spacer()
                            if launching { ProgressView() }
                            else { Image(systemName: "arrow.up.forward.app") }
                        }
                    }
                    .disabled(launching || (request != nil && !approved && approvalToRetry == nil && request?.canAllow != true))
                    if let message {
                        Label(message, systemImage: returned ? "checkmark.circle" : "info.circle")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                } footer: {
                    Text(request != nil ? "Allow gives your agent this app for testing. The phone stops testing automatically within ten minutes. Stop at any time." : "Opening testing does not give an agent permission to use your phone. Begin only when you have agreed to a testing session.")
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
            .task {
                request = sessionStore.appTestingRequest
                approved = request?.state == "consumed" || request?.state == "approved"
                consumeReturn()
                if request == nil, pending == nil, approvalToRetry == nil, !approved {
                    request = try? await sessionStore.activity.testingRequest(app: appBundleID)
                    approved = request?.state == "consumed" || request?.state == "approved"
                }
                if let request, sessionStore.appTestingAutoAllowRequestID == request.id, request.canAllow {
                    sessionStore.appTestingAutoAllowRequestID = nil
                    start()
                }
            }
            .task(id: pending?.attempt) {
                guard let attempt = pending?.attempt else { return }
                try? await Task.sleep(nanoseconds: UInt64(AppTestingHandoff.lifetime * 1_000_000_000))
                guard !Task.isCancelled, pending?.attempt == attempt else { return }
                pending = nil
                launching = false
                UserDefaults.standard.removeObject(forKey: AppTestingHandoff.storageKey)
                message = "App testing has not returned yet. Check its iOS prompts and developer support before trying again."
            }
            .onChange(of: sessionStore.appTestingReturnURL) { _, _ in consumeReturn() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, launching, pending != nil else { return }
                message = "Waiting for testing to return. If iOS shows an approval prompt, complete it on your iPhone."
            }
        }
    }

    private func start() {
        guard !launching else { return }
        if approved, let request {
            launching = true
            Task {
                do {
                    try await sessionStore.activity.respondToTesting(request, action: "cancel")
                    approved = false
                    self.request = nil
                    message = "This testing session has ended."
                } catch { message = "Stopping could not be confirmed. Use Stop Server in the testing app’s notification." }
                launching = false
            }
            return
        }
        if let retry = approvalToRetry { sendApproval(retry); return }
        if let request, !request.canAllow { message = "This testing request is no longer active. Ask your agent to start a new one."; return }
        guard UIApplication.shared.canOpenURL(URL(string: "ictrl://start")!) else {
            message = "App testing is not installed yet. Ask your agent to set it up on your Mac."
            returned = false
            return
        }
        let launch = AppTestingHandoff(approval: request)
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
        if returned, let approval = handoff.approval {
            request = approval
            sendApproval(approval)
            return
        }
        message = returned
            ? "Testing opened. Your agent will verify the private connection before using the phone."
            : "Testing could not start. Ask your agent to check Apple’s developer support and the testing app."
    }

    private func sendApproval(_ item: AppTestingRequest) {
        launching = true
        approvalToRetry = item
        Task {
            do {
                try await sessionStore.activity.respondToTesting(item, action: "approve")
                approved = true
                approvalToRetry = nil
                message = "Your agent can now test \(item.name). Testing stops automatically within ten minutes."
            } catch { message = "The Mac could not confirm approval. Retry Connection when it reconnects; testing will not start automatically." }
            launching = false
        }
    }
}
