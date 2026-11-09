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
        if checkingRequest { return "Checking…" }
        if launching { return approved ? "Stopping…" : "Opening…" }
        if approved { return "Stop testing" }
        if approvalToRetry != nil { return "Retry" }
        if let request { return request.canAllow ? "Allow testing" : "Test ended" }
        return "Open testing app"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                HomeCanvas()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        intentCard
                        sessionActions
                        setupHelp
                    }.padding(20)
                }
            }
            .navigationTitle("Test with agent")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(approved ? "Close" : "Done") { dismiss() } } }
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
                        message = sessionStore.pairedMac == nil ? "Connect your Mac before starting a test." : "Your Mac could not load this test. Check the connection and try again."
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
                message = "Testing has not opened yet. Check the iPhone prompts before trying again."
            }
            .onChange(of: sessionStore.appTestingReturnURL) { _, _ in consumeReturn() }
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active, launching, pending != nil else { return }
                message = "Finish any iPhone approval prompts to continue."
            }
        }
    }

    private var intentCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text((request?.name ?? appName).map { "Test \($0)" } ?? "Test with agent")
                    .font(.title2.weight(.bold))
                Text("Your agent can see the screen and control this iPhone during an approved test.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Divider()
            if !approved {
                HStack {
                    Text("Time limit").font(.subheadline)
                    Spacer()
                    Picker("Time limit", selection: $selectedMinutes) {
                        ForEach([5, 10, 30, 60], id: \.self) { minutes in
                            Text(minutes == 60 ? "1 hour" : "\(minutes) minutes").tag(minutes)
                        }
                    }
                    .pickerStyle(.menu).labelsHidden()
                    .frame(minHeight: 44)
                    .disabled(checkingRequest || launching || approvalToRetry != nil)
                }
            } else {
                LabeledContent("Time limit", value: sessionMinutes == 60 ? "1 hour" : "\(sessionMinutes) minutes")
            }
        }
        .padding(20)
        .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22))
    }

    private var sessionActions: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: start) {
                HStack(spacing: 10) {
                    if launching { ProgressView() }
                    else { Image(systemName: approved ? "stop.circle.fill" : "arrow.up.forward.app") }
                    Text(actionTitle)
                }
                .font(.headline)
                .foregroundStyle(approved ? Color.red : Color.blue)
                .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: (approved ? Color.red : Color.blue).opacity(0.16), interactive: !launching)
            .disabled(checkingRequest || launching || (request != nil && !approved && approvalToRetry == nil && request?.canAllow != true))
            if let message {
                Label(message, systemImage: returned ? "checkmark.circle" : "info.circle")
                    .font(.subheadline)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardSurface(cornerRadius: 20, tint: Color.white.opacity(0.18))
            }
            Text(approved ? "Close hides this screen. Use Stop testing to end the test."
                 : request != nil ? "Allow only when your iPhone is available."
                 : "Your agent still needs approval before using the phone.")
                .font(.footnote).foregroundStyle(.secondary).padding(.horizontal, 4)
        }
    }

    private var setupHelp: some View {
        DisclosureGroup("Setup and help") {
            VStack(alignment: .leading, spacing: 12) {
                Text("Ask your agent to install the testing app on this iPhone.")
                Text("On first use, follow the iPhone prompts. If asked, tap Enable Remote Access in the testing app's notification.")
                Text("After a restart, ask your agent to reconnect testing. You may need to connect to your Mac's Wi-Fi.")
            }
            .font(.subheadline).foregroundStyle(.secondary).padding(.top, 14)
        }
        .font(.subheadline.weight(.medium)).padding(18)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
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
                    message = "Test ended."
                } catch { message = "Stop could not be confirmed. Tap Stop Server in the testing app's notification." }
                launching = false
            }
            return
        }
        if let retry = approvalToRetry { sendApproval(retry); return }
        if let request, !request.canAllow { message = "This test has ended. Ask your agent for a new request."; return }
        guard UIApplication.shared.canOpenURL(URL(string: "ictrl://start")!) else {
            message = "The testing app is missing. Ask your agent to install it."
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
            message = "The testing app could not open. Ask your agent to check it."
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
            ? "Testing opened. Your agent will check the connection before using the phone."
            : "Testing could not start. Ask your agent to reconnect the testing app."
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
                message = "Testing \(item.name). Stops after \(item.minutes ?? 10) minutes."
            } catch { message = "Your Mac has not confirmed approval. Reconnect, then tap Retry to check." }
            launching = false
        }
    }
}
