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
    @State private var checkingRequest = true
    @AppStorage("appTesting.durationMinutes") private var selectedMinutes = 10

    private var sessionMinutes: Int { approved ? (request?.minutes ?? 10) : selectedMinutes }

    private var actionTitle: String {
        if checkingRequest { return "Checking Request…" }
        if launching { return approved ? "Stopping Testing…" : "Opening App Testing…" }
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
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if !approved {
                        Picker("Duration", selection: $selectedMinutes) {
                            ForEach([5, 10, 30, 60], id: \.self) { minutes in
                                Text(minutes == 60 ? "1 hour" : "\(minutes) minutes").tag(minutes)
                            }
                        }
                        .disabled(checkingRequest || launching || approvalToRetry != nil)
                    }
                    Button(action: start) {
                        HStack {
                            Text(actionTitle)
                            Spacer()
                            if launching { ProgressView() }
                            else { Image(systemName: approved ? "stop.circle.fill" : "arrow.up.forward.app") }
                        }
                    }
                    .foregroundStyle(approved ? Color.red : Color.blue)
                    .disabled(checkingRequest || launching || (request != nil && !approved && approvalToRetry == nil && request?.canAllow != true))
                    if let message {
                        Label(message, systemImage: returned ? "checkmark.circle" : "info.circle")
                            .font(.callout)
                            .foregroundStyle(.primary)
                    }
                } footer: {
                    Text(request != nil ? "Allow gives your agent this app for testing. Testing stops automatically after \(sessionMinutes) minutes. Stop sooner at any time." : "Testing stops automatically after \(selectedMinutes) minutes. Opening testing does not give an agent permission to use your phone. Begin only when you have agreed to a testing session.")
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
                defer { checkingRequest = false }
                if ![5, 10, 30, 60].contains(selectedMinutes) { selectedMinutes = 10 }
                request = sessionStore.appTestingRequest
                approved = request?.state == "consumed" || request?.state == "approved"
                consumeReturn()
                if pending == nil, approvalToRetry == nil, !launching {
                    do {
                        request = try await sessionStore.activity.testingRequest(id: request?.id, app: appBundleID)
                        approved = request?.state == "consumed" || request?.state == "approved"
                    } catch {
                        message = "The testing request could not be refreshed. Check your Mac connection."
                        return
                    }
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
        var intent = request
        intent?.minutes = selectedMinutes
        let launch = AppTestingHandoff(approval: intent, minutes: selectedMinutes)
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
                request = item
                message = "Your agent can now test \(item.name). Testing stops automatically after \(item.minutes ?? 10) minutes."
            } catch { message = "The Mac could not confirm approval. Retry Connection when it reconnects; testing will not start automatically." }
            launching = false
        }
    }
}
