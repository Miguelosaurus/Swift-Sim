import SwiftUI
import AVFoundation
import UIKit

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var activity: ActivityCenter
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            HomeCanvas()

            if let session = sessionStore.currentSession {
                SimulatorSessionView(session: session)
            } else if let build = sessionStore.currentDeviceBuild {
                DeviceBuildView(build: build)
            } else if let appID = sessionStore.selectedManagedAppID,
                      let app = sessionStore.managedApps.first(where: { $0.id == appID }) {
                ManagedAppDetailView(app: app)
            } else {
                HomeView()
            }
        }
        .overlay(alignment: .top) {
            if let notice = sessionStore.libraryActionNotice {
                LibraryActionBanner(notice: notice) {
                    sessionStore.dismissLibraryActionMessage()
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: sessionStore.libraryActionNotice)
        .sheet(item: $activity.presentation, onDismiss: sessionStore.presentPendingTestingRequest) { _ in
            ActivityInboxView()
                .environmentObject(activity)
        }
        .sheet(isPresented: $sessionStore.isMacSettingsPresented, onDismiss: sessionStore.presentPendingTestingRequest) {
            MacSettingsSheet()
                .environmentObject(sessionStore)
        }
        .sheet(isPresented: $sessionStore.isAppTestingPresented) {
            AppTestingView(appName: sessionStore.appTestingAppName, appBundleID: sessionStore.appTestingBundleID)
                .environmentObject(sessionStore)
        }
    }
}

private struct HomeView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var activity: ActivityCenter
    @AppStorage("swiftSim.homeMode") private var homeMode = HomeMode.installs.rawValue
    @State private var searchText = ""
    @State private var showingPasteLink = false
    @State private var showingArchivedApps = false

    private var filteredSessions: [RecentSession] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessionStore.recentSessions }
        return sessionStore.recentSessions.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
                || $0.hostDisplayName.localizedCaseInsensitiveContains(query)
        }
    }

    private var filteredApps: [ManagedApp] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let apps = sessionStore.managedApps.filter { $0.isArchived == showingArchivedApps }.sorted {
            let first = $0.latestBuild?.createdAt ?? .distantPast; let second = $1.latestBuild?.createdAt ?? .distantPast
            return first == second ? $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending : first > second
        }
        guard !query.isEmpty else { return apps }
        return apps.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
                || $0.bundleIdentifier.localizedCaseInsensitiveContains(query)
        }
    }

    private var selectedMode: HomeMode {
        HomeMode(rawValue: homeMode) ?? .installs
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 24) {
                header
                modePicker

                if selectedMode == .installs {
                    deviceBuildBoard
                    if sessionStore.pairedMac != nil || !sessionStore.managedApps.isEmpty { macInstallStatusPanel }
                } else {
                    macStatusPanel
                    sessionBoard
                }
            }
            .padding(.horizontal, 22)
            .padding(.top, 18)
            .padding(.bottom, 24)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            commandDock
        }
        .sheet(isPresented: $showingPasteLink) {
            PasteLinkSheet()
                .environmentObject(sessionStore)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .refreshable { await sessionStore.refreshHelperStatus() }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Swift Sim")
                    .font(.system(.largeTitle, design: .rounded).weight(.bold))
                Text(selectedMode == .installs ? "Apps from your Mac" : "Simulators on your Mac")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            Button { activity.isPresented = true } label: {
                Image(systemName: "bell")
                    .font(.title3.weight(.semibold))
                    .frame(width: 46, height: 46)
                    .background(.thinMaterial, in: Circle())
                    .overlay(alignment: .topTrailing) {
                        if activity.unreadCount > 0 {
                            Text(activity.unreadCount > 9 ? "9+" : String(activity.unreadCount))
                                .font(.caption2.bold())
                                .foregroundStyle(.white)
                                .padding(4)
                                .background(.blue, in: Capsule())
                        }
                    }
            }
            .accessibilityLabel(activity.unreadCount > 0 ? "Activity, \(activity.unreadCount) unread" : "Activity")
            .accessibilityIdentifier("activityInboxButton")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var modePicker: some View {
        Picker("Mode", selection: $homeMode) {
            Label("Apps", systemImage: "iphone.and.arrow.forward")
                .tag(HomeMode.installs.rawValue)
            Label("Simulator", systemImage: "play.rectangle.on.rectangle")
                .tag(HomeMode.simulator.rawValue)
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Swift Sim mode")
    }

    private var macInstallStatusPanel: some View {
        Button {
            sessionStore.isMacSettingsPresented = true
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "macbook.and.iphone")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(macInstallStatusColor)
                    .frame(width: 50, height: 50)
                    .liquidGlassCircle(tint: macInstallStatusColor.opacity(0.12), interactive: false)

                VStack(alignment: .leading, spacing: 4) {
                    Text(macInstallStatusTitle)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)
                    Text(macInstallStatusDetail)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
        .padding(14)
        .cardSurface(cornerRadius: 24, tint: macInstallStatusColor.opacity(0.07))
        .accessibilityLabel("Mac connection details")
        .accessibilityHint("Shows whether install status can update automatically")
    }

    private var macInstallStatusTitle: String {
        let macName = sessionStore.pairedMac?.displayName ?? "your Mac"
        switch sessionStore.helperStatus {
        case .online: return "Connected to \(macName)"
        case .checking: return "Connecting to \(macName)"
        case .offline: return "Mac offline"
        case .pairingExpired: return "Pairing expired"
        case .notPaired: return "Connect your Mac"
        }
    }

    private var macInstallStatusDetail: String {
        switch sessionStore.helperStatus {
        case .online: return "Builds and changes sync from your Mac."
        case .checking: return "Checking the private remote connection."
        case .offline: return "Check your Mac is awake and Tailscale is on."
        case .pairingExpired: return "Your Mac is reachable. Open a fresh pairing link to reconnect."
        case .notPaired: return "Connect once to send builds and changes."
        }
    }

    private var macInstallStatusColor: Color {
        switch sessionStore.helperStatus {
        case .online: return .green
        case .checking: return .blue
        case .offline, .pairingExpired, .notPaired: return .secondary
        }
    }

    private var macStatusPanel: some View {
        Button {
            sessionStore.isMacSettingsPresented = true
        } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [Color.blue, Color.cyan],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    Image(systemName: "macbook.and.iphone")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 58, height: 58)

                VStack(alignment: .leading, spacing: 4) {
                    Text(simulatorStatusTitle)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    HStack(spacing: 7) {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 8, height: 8)
                        Text(simulatorStatusDetail)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
        .padding(14)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
        .accessibilityLabel("Simulator connection details")
    }

    private var simulatorStatusTitle: String {
        guard !sessionStore.recentSessions.isEmpty else { return "Set Up Live Preview" }
        return sessionStore.simulatorCheck.state == .ready ? "Live Preview Ready" : "Saved Simulator Previews"
    }

    private var simulatorStatusDetail: String {
        let count = sessionStore.recentSessions.count
        guard count > 0 else { return "Open a Simulator link to begin" }
        if sessionStore.simulatorCheck.state == .ready {
            return count == 1 ? "1 recent project ready to open" : "\(count) recent projects ready to open"
        }
        return count == 1 ? "1 saved project" : "\(count) saved projects"
    }

    private var statusColor: Color {
        switch sessionStore.simulatorCheck.state {
        case .ready: return .green
        case .checking: return .yellow
        case .issue: return .red
        case .notConfigured: return .gray
        }
    }

    private var sessionBoard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Simulator Previews")
                    .font(.title3.weight(.bold))
                Spacer()
                Text("\(filteredSessions.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .liquidGlassCapsule(tint: .white.opacity(0.24), interactive: false)
            }

            if filteredSessions.isEmpty {
                EmptySessionCard()
            } else {
                VStack(spacing: 12) {
                    ForEach(filteredSessions) { recent in
                        SwipeToDeleteRow {
                            SessionRow(recent: recent)
                        } onOpen: {
                            sessionStore.reopen(recent)
                        } onDelete: {
                            withAnimation {
                                sessionStore.removeRecentSession(recent)
                            }
                        }
                    }
                }
            }
        }
    }

    private var deviceBuildBoard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(showingArchivedApps ? "Archived Apps" : "Apps")
                    .font(.title3.weight(.bold))
                Spacer()
                Button {
                    withAnimation(.snappy(duration: 0.25)) {
                        showingArchivedApps.toggle()
                    }
                } label: {
                    Image(systemName: showingArchivedApps ? "tray.full.fill" : "archivebox")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .liquidGlassCircle(tint: Color.white.opacity(0.18), interactive: true)
                .accessibilityLabel(showingArchivedApps ? "Show active apps" : "Show archived apps")
                .accessibilityHint(showingArchivedApps ? "Returns to your app library" : "Shows apps hidden from your library")

            }

            if filteredApps.isEmpty {
                EmptyDeviceBuildCard(isArchive: showingArchivedApps)
            } else {
                VStack(spacing: 12) {
                    ForEach(filteredApps) { app in
                        Button {
                            sessionStore.openManagedApp(app)
                        } label: {
                            ManagedAppRow(app: app)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var commandDock: some View {
        Group {
            if hasSearchableItems {
                HStack(spacing: 12) {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundStyle(.secondary)

                        TextField(selectedMode == .installs ? "Find an app" : "Find a Simulator preview", text: $searchText)
                            .font(.body.weight(.medium))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 58)
                    .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

                    Button {
                        showingPasteLink = true
                    } label: {
                        Label("Paste Link", systemImage: "link.badge.plus")
                            .labelStyle(.iconOnly)
                            .font(.system(size: 22, weight: .semibold))
                            .frame(width: 58, height: 58)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCircle(tint: Color.blue.opacity(0.16), interactive: true)
                    .accessibilityLabel("Paste Swift Sim link")
                }
            } else if selectedMode == .installs && !showingArchivedApps && sessionStore.pairedMac == nil {
                VStack(spacing: 12) {
                    Button {
                        sessionStore.isMacSettingsPresented = true
                    } label: {
                        Label("Connect your Mac", systemImage: "macbook.and.iphone")
                            .font(.headline.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 58)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCapsule(tint: Color.blue.opacity(0.16), interactive: true)
                    .accessibilityIdentifier("connectMacSetupButton")

                    Button("Open an install link") { showingPasteLink = true }
                        .frame(minHeight: 44)
                        .font(.subheadline.weight(.semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(.blue)
                }
            } else {
                Button {
                    showingPasteLink = true
                } label: {
                    Label(selectedMode == .installs ? "Paste Install Link" : "Paste Simulator Link", systemImage: "doc.on.clipboard")
                        .font(.headline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 58)
                }
                .buttonStyle(.plain)
                .liquidGlassCapsule(tint: Color.blue.opacity(0.16), interactive: true)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background {
            LinearGradient(
                colors: [
                    Color(.systemBackground).opacity(0),
                    Color(.systemBackground).opacity(0.92),
                    Color(.systemBackground)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }

    private var hasSearchableItems: Bool {
        if selectedMode == .simulator {
            return !sessionStore.recentSessions.isEmpty
        }
        return sessionStore.managedApps.contains { $0.isArchived == showingArchivedApps }
    }
}

private enum HomeMode: String {
    case installs
    case simulator
}

private struct PasteLinkSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var linkText = ""
    @State private var errorText = ""
    @State private var isOpeningLink = false
    @FocusState private var linkFieldIsFocused: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Open link")
                        .font(.title2.weight(.bold))
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .bold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCircle(tint: Color.white.opacity(0.18), interactive: true)
                }

                HStack(spacing: 12) {
                    Image(systemName: "link")
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(.secondary)
                    TextField("Paste Swift Sim link", text: $linkText)
                        .font(.body.weight(.medium))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .focused($linkFieldIsFocused)
                    .onChange(of: linkText) { _, _ in errorText = "" }
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 58)
                .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

                if !errorText.isEmpty {
                    Text(errorText)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await openLink() }
                } label: {
                    Group {
                        if isOpeningLink {
                            ProgressView()
                                .tint(.blue)
                        } else {
                            Label("Open link", systemImage: "arrow.right")
                        }
                    }
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 56)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
                .tint(.blue)
                .contentShape(Capsule())
                .disabled(linkText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isOpeningLink)

                Text("Paste the link your agent sent you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear {
            linkFieldIsFocused = true
        }
    }

    private func openLink() async {
        let trimmed = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else {
            errorText = "That link is not valid."
            return
        }

        if PairedMac(url: url) != nil {
            isOpeningLink = true
            errorText = ""
            let paired = await sessionStore.pairMac(using: url)
            isOpeningLink = false
            if paired {
                dismiss()
            } else {
                errorText = sessionStore.pairingErrorMessage ?? "Could not verify that Mac."
            }
            return
        }

        if sessionStore.open(url) {
            dismiss()
        } else {
            errorText = "That is not a valid Swift Sim link."
        }
    }
}

private struct ManagedAppDetailView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var activity: ActivityCenter
    let app: ManagedApp
    @State private var showingDeleteConfirmation = false
    @State private var showingBuildConfirmation = false
    @State private var showingOlderBuilds = false

    var body: some View {
        ZStack {
            HomeCanvas()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    topBar
                    appOverview
                    deliveryNotice
                    if let detected = app.recentDetectedBuild {
                        DisclosureGroup("Build \(detected.build) isn't saved") {
                            Text("This build came from Xcode. Create a new build here to save an installable copy.")
                                .font(.subheadline).foregroundStyle(.secondary).padding(.top, 8)
                        }
                        .font(.subheadline.weight(.medium))
                        .padding(16)
                        .cardSurface(cornerRadius: 22, tint: Color.white.opacity(0.18))
                    }
                    buildHistorySection
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, 40)
            }
        }
        .alert("Delete build history?", isPresented: $showingDeleteConfirmation) {
            Button("Delete history", role: .destructive) {
                sessionStore.deleteManagedApp(app)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the app and its saved versions from Swift Sim. The installed app stays on your iPhone.")
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                sessionStore.closeManagedApp()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 23, weight: .bold))
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.2), interactive: true)

            Spacer()

            Text("Builds")
                .font(.headline.weight(.bold))

            Spacer()

            Menu {
                Button {
                    sessionStore.archiveManagedApp(app, archived: !app.isArchived)
                } label: {
                    Label(app.isArchived ? "Restore App" : "Archive App", systemImage: app.isArchived ? "arrow.uturn.backward" : "archivebox")
                }

                Divider()

                Button(role: .destructive) {
                    showingDeleteConfirmation = true
                } label: {
                    Label("Delete history", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 21, weight: .bold))
                    .frame(width: 50, height: 50)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.2), interactive: true)
            .accessibilityLabel("App actions")
        }
    }

    private var appOverview: some View {
        VStack(alignment: .leading, spacing: 16) {
            appIdentity
            Divider()
            if let latest = app.latestBuild {
                Button { sessionStore.reopen(latest) } label: {
                    Text(latestActionTitle(latest))
                        .font(.headline)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .liquidGlassCapsule(tint: .blue, interactive: true)
                .accessibilityIdentifier("latestBuildButton")
                Divider()
            }
            agentTestingButton
        }
        .padding(20)
        .cardSurface(cornerRadius: 28, tint: Color.blue.opacity(0.08))
    }

    private var appIdentity: some View {
        HStack(spacing: 16) {
            AppBadge(text: app.initials, isEmpty: false, accent: statusColor, icon: sessionStore.iconReference(for: app))
            VStack(alignment: .leading, spacing: 6) {
                Text(app.displayName.swiftSimDisplayName)
                    .font(.system(.title2, design: .rounded).weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                if let latest = app.latestBuild {
                    Text(buildSummary(latest))
                        .font(.subheadline).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Label(latestBuildDetail(latest), systemImage: latest.state == "failed" ? "exclamationmark.circle" : latest.isPreparing ? "hammer" : latest.installationStatus.isInstalled ? "checkmark.circle.fill" : "arrow.down.circle")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(latest.state == "failed" ? Color.orange : latest.installationStatus.isInstalled ? Color.green : Color.blue)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if app.isArchived {
                    Label("Archived", systemImage: "archivebox")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private var deliveryNotice: some View {
        if let deliveryStatus,
           deliveryStatus.needsAttention || (deliveryStatus.requestId != nil && !deliveryStatus.completionVerified) {
            VStack(alignment: .leading, spacing: 6) {
                Label(deliveryStatus.label(for: app.displayName.swiftSimDisplayName), systemImage: deliveryStatus.symbol)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(deliveryStatus.needsAttention ? Color.orange : Color.blue)
                Text(deliveryStatus.message)
                    .font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .cardSurface(cornerRadius: 22, tint: Color.white.opacity(0.18))
        }
    }

    private var agentTestingButton: some View {
        Button {
            sessionStore.appTestingAppName = app.displayName.swiftSimDisplayName
            sessionStore.appTestingBundleID = app.bundleIdentifier
            sessionStore.appTestingRequest = nil
            sessionStore.appTestingAutoAllowRequestID = nil
            sessionStore.isAppTestingPresented = true
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "iphone.and.arrow.forward")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.blue)
                    .frame(width: 24)
                Text("Test with agent")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.blue)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Test with agent")
        .accessibilityIdentifier("testWithAgentButton")
    }

    private func buildSummary(_ build: ManagedBuild) -> String {
        [build.version.isEmpty ? nil : "Version \(build.version)",
         build.buildNumber.isEmpty ? nil : "Build \(build.buildNumber)"]
            .compactMap { $0 }.joined(separator: " · ")
    }

    private func latestActionTitle(_ build: ManagedBuild) -> String {
        if build.isPreparing { return "View build progress" }
        if build.state == "failed" || build.installationStatus.isInstalled || !build.isLinkActive { return "View build details" }
        return app.builds.count > 1 ? "Install update" : "Install app"
    }

    private var newBuildButton: some View {
        Button { showingBuildConfirmation = true } label: {
            HStack(spacing: 7) {
                if sessionStore.isStartingCurrentSourceBuild { ProgressView().tint(.blue) }
                else { Image(systemName: "hammer") }
                Text(sessionStore.isStartingCurrentSourceBuild ? "Starting…" : "New build")
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.blue)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
        }
        .buttonStyle(.plain)
        .liquidGlassCapsule(tint: Color.blue.opacity(0.08), interactive: !sessionStore.isStartingCurrentSourceBuild)
        .disabled(sessionStore.isStartingCurrentSourceBuild)
        .accessibilityIdentifier("newBuildButton")
        .alert("Build a new version?", isPresented: $showingBuildConfirmation) {
            Button("Build on Mac") { Task { await sessionStore.buildCurrentSource(for: app) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your Mac will build \(app.displayName.swiftSimDisplayName) using the current code, including changes you haven't committed. This can take a few minutes. Your iPhone app won't change until you install the new build.")
        }
    }

    private var buildHistorySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack {
                    Text("Build history").font(.title3.weight(.bold)).fixedSize()
                    Spacer(minLength: 12)
                    newBuildButton.fixedSize()
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("Build history").font(.title3.weight(.bold))
                    newBuildButton.fixedSize()
                }
            }
            if let message = sessionStore.buildCurrentSourceMessage {
                Text(message).font(.footnote).foregroundStyle(.secondary)
                if sessionStore.pairedMac == nil {
                    Button("Connect your Mac") { sessionStore.isMacSettingsPresented = true }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
            }
            let previous = app.builds.filter { $0.id != app.latestBuild?.id }.sorted { $0.createdAt > $1.createdAt }
            if previous.isEmpty {
                Text("No earlier builds.").font(.subheadline).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            ForEach(previous.prefix(4)) { build in historyButton(build) }
            if previous.count > 4 {
                DisclosureGroup("Older builds (\(previous.count - 4))", isExpanded: $showingOlderBuilds) {
                    ForEach(previous.dropFirst(4)) { build in historyButton(build) }
                }
                .font(.subheadline.weight(.semibold))
            }
        }
    }

    private func historyButton(_ build: ManagedBuild) -> some View {
        Button { sessionStore.reopen(build) } label: { BuildHistoryRow(build: build, isCurrent: false) }
            .buttonStyle(.plain)
    }

    private var deliveryStatus: AppDeliveryPresentation? { activity.deliveryStatus(for: app) }

    private var statusColor: Color {
        if app.isArchived { return .secondary }
        if let deliveryStatus { return deliveryStatus.completionVerified ? .green : deliveryStatus.needsAttention ? .orange : .blue }
        if app.latestBuild?.isPreparing == true { return .blue }
        if app.latestBuild?.state == "failed" { return .orange }
        switch app.latestBuild?.installationStatus {
        case .verified, .launchConfirmed: return .green
        case .requested, .differentVersion, .notInstalled: return .blue
        default: return .blue
        }
    }

    private func latestBuildDetail(_ build: ManagedBuild) -> String {
        if build.origin == "xcode" && !build.installationStatus.isInstalled { return "Built in Xcode • no exported copy" }
        if build.isPreparing { return "Building current code" }
        if build.state == "failed" { return "Build failed. View details." }
        switch build.installationStatus {
        case .launchConfirmed: return "Installed & launched"
        case .verified: return "Installed"
        case .requested: return "Install requested"
        case .differentVersion: return "Update available"
        case .notInstalled: return "Ready to install"
        case .unknown: return build.isLinkActive ? "Ready to install" : "Install link expired"
        }
    }
}

private struct BuildHistoryRow: View {
    let build: ManagedBuild
    let isCurrent: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 36, height: 36)
                .liquidGlassCircle(tint: color.opacity(0.1), interactive: false)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(build.buildNumber.isEmpty ? "Build" : "Build \(build.buildNumber)")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                    if !dynamicTypeSize.isAccessibilitySize, let configuration = build.configuration, ["debug", "release"].contains(configuration.lowercased()) {
                        Text(configuration.capitalized)
                            .font(.caption2.monospaced().weight(.semibold))
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .background(.quaternary, in: Capsule())
                    }
                    if isCurrent {
                        Text("LATEST")
                            .font(.system(size: 9, weight: .heavy))
                            .foregroundStyle(.blue)
                    }
                }
                if !build.version.isEmpty {
                    Text("Version \(build.version)").font(.caption).foregroundStyle(.secondary)
                }
                Text(build.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if dynamicTypeSize.isAccessibilitySize {
                    Text(buildStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color)
                }
            }

            Spacer()

            if !dynamicTypeSize.isAccessibilitySize {
                Text(buildStatus)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(color)
                    .fixedSize()
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
        .frame(maxWidth: .infinity)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .cardSurface(cornerRadius: 22, tint: Color.white.opacity(0.12))
    }

    private var icon: String {
        if build.isPreparing { return "hammer.circle.fill" }
        if build.state == "failed" { return "exclamationmark.triangle.fill" }
        switch build.installationStatus {
        case .verified, .launchConfirmed: return "checkmark.circle.fill"
        case .requested: return "arrow.down.circle.fill"
        case .differentVersion: return "arrow.triangle.2.circlepath.circle.fill"
        case .notInstalled: return "iphone.and.arrow.forward"
        default: return build.isLinkActive ? "arrow.down.circle.fill" : "clock.arrow.circlepath"
        }
    }

    private var color: Color {
        if build.isPreparing { return .blue }
        if build.state == "failed" { return .orange }
        switch build.installationStatus {
        case .verified, .launchConfirmed: return .green
        case .requested, .differentVersion, .notInstalled: return .blue
        default: return build.isLinkActive ? .blue : .secondary
        }
    }

    private var buildStatus: String {
        if build.origin == "xcode" && !build.installationStatus.isInstalled { return "Built in Xcode" }
        if build.isPreparing { return "Building" }
        if build.state == "failed" { return "Failed" }
        switch build.installationStatus {
        case .launchConfirmed: return "Installed & launched"
        case .verified: return "Installed"
        case .requested: return "Install requested"
        case .differentVersion: return "Update available"
        case .notInstalled: return "Ready to install"
        default: return build.isLinkActive ? "Ready to install" : "Link expired"
        }
    }
}

private struct DeviceBuildView: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var showingAppDetails = false
    @State private var showingBuildDetails = false
    @State private var showingDataRemovalConfirmation = false
    let build: DeviceBuildSession

    private var status: DeviceBuildStatus? {
        sessionStore.deviceBuildStatus
    }

    var body: some View {
        NavigationStack {
            ZStack {
                HomeCanvas()

                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 16) {
                        buildHero
                        installStatusCard
                        if status?.liveReload?.eligible == true {
                            liveReloadCard
                        }
                        installDetailsCard
                        if !actionableWarnings.isEmpty {
                            warningCard
                        }
                        if status?.state == "failed" || !sessionStore.deviceBuildLogs.isEmpty {
                            buildDetailsDisclosure
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 24)
                }
                .refreshable {
                    await sessionStore.refreshAppState()
                }
            }
            .navigationTitle("Install update")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        sessionStore.closeCurrentBuild()
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                            .labelStyle(.iconOnly)
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await sessionStore.refreshAppState() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .labelStyle(.iconOnly)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                installDock
            }
            .task {
                while !Task.isCancelled {
                    await sessionStore.refreshAppState()
                    try? await Task.sleep(nanoseconds: 8_000_000_000)
                }
            }
            .alert("Delete this app's data?", isPresented: $showingDataRemovalConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Install and delete data", role: .destructive) {
                    startInstall()
                }
            } message: {
                Text("This update will delete the app's current data from your iPhone. Continue only if you want to remove it.")
            }
        }
    }

    private var buildHero: some View {
        HStack(spacing: 16) {
            AppBadge(text: appInitials, isEmpty: false, icon: currentManagedBuild.flatMap { sessionStore.iconReference(for: $0) })
                .frame(width: 74, height: 74)

            VStack(alignment: .leading, spacing: 7) {
                Text(appName)
                    .font(.system(.title2, design: .rounded).weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(buildSubtitle)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
        .accessibilityElement(children: .combine)
    }

    private var installStatusCard: some View {
        HStack(alignment: .top, spacing: 14) {
            Group {
                if isPreparingBuild {
                    ProgressView()
                        .tint(installStatusColor)
                } else {
                    Image(systemName: installStatusSymbol)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(installStatusColor)
                }
            }
            .frame(width: 44, height: 44)
            .liquidGlassCircle(tint: installStatusColor.opacity(0.12), interactive: false)

            VStack(alignment: .leading, spacing: 5) {
                Text(installStatusTitle)
                    .font(.headline.weight(.semibold))
                Text(installStatusDetail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(17)
        .cardSurface(cornerRadius: 24, tint: installStatusColor.opacity(0.07))
        .accessibilityElement(children: .combine)
    }

    private var installDetailsCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("About this build")
                .font(.headline.weight(.semibold))

            LabeledContent("Version", value: conciseVersionLabel)

            Divider()

            VStack(alignment: .leading, spacing: 5) {
                LabeledContent("App data") {
                    Text(status.map { $0.preserveData ? "Kept" : "Will be deleted" } ?? "Checking…")
                        .fontWeight(.semibold)
                        .foregroundStyle(status?.preserveData == false ? Color.orange : Color.primary)
                }
                Text(dataPreservationDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Divider()

            LabeledContent("Link expires", value: installLinkDetail)

            Divider()

            DisclosureGroup("Technical details", isExpanded: $showingAppDetails) {
                VStack(spacing: 12) {
                    if !appBundleIdentifier.isEmpty {
                        LabeledContent("App ID", value: appBundleIdentifier)
                    }
                    LabeledContent("Build saved on", value: "Your Mac")
                }
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.top, 12)
                .textSelection(.enabled)
            }
            .font(.callout.weight(.semibold))
        }
        .font(.callout)
        .padding(17)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.16))
    }

    private var liveReloadCard: some View {
        let live = status?.liveReload
        let isReady = live?.engineReady == true && live?.compilerReady == true
        let tint: Color = isReady ? .mint : .secondary

        return HStack(alignment: .top, spacing: 14) {
            Image(systemName: isReady ? "bolt.horizontal.circle.fill" : "bolt.horizontal.circle")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .liquidGlassCircle(tint: tint.opacity(0.14), interactive: false)

            VStack(alignment: .leading, spacing: 5) {
                Text(isReady ? "Hot reload ready" : "Hot reload needs setup")
                    .font(.headline.weight(.semibold))
                Text(isReady
                     ? "Compatible changes can apply without reinstalling this app."
                     : "Ask your agent to finish setting up this build.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(17)
        .cardSurface(cornerRadius: 24, tint: tint.opacity(0.08))
        .accessibilityElement(children: .combine)
    }

    private var warningCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Needs Attention", systemImage: "exclamationmark.triangle.fill")
                .font(.headline.weight(.semibold))
                .foregroundStyle(.orange)

            ForEach(actionableWarnings, id: \.self) { warning in
                Text(warning)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(17)
        .cardSurface(cornerRadius: 24, tint: Color.orange.opacity(0.08))
    }

    private var buildDetailsDisclosure: some View {
        DisclosureGroup("Build log", isExpanded: $showingBuildDetails) {
            Text(sessionStore.deviceBuildLogs.isEmpty ? "No additional details are available." : sessionStore.deviceBuildLogs.joined(separator: "\n"))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .padding(.top, 12)
        }
        .font(.callout.weight(.semibold))
        .padding(17)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.12))
    }

    private var installDock: some View {
        VStack(spacing: 10) {
            if installationStatus.isInstalled {
                Label("Build installed", systemImage: "checkmark.circle.fill")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 58)
                    .foregroundStyle(.secondary)
                    .liquidGlassCapsule(tint: Color.green.opacity(0.12), interactive: false)
                    .accessibilityIdentifier("buildInstalledStatus")
            } else if isInstallLinkExpired {
                Button {
                    Task { await sessionStore.renewCurrentDeviceBuildLink() }
                } label: {
                    Group {
                        if sessionStore.isRenewingDeviceBuildLink {
                            HStack(spacing: 10) {
                                ProgressView()
                                Text("Creating link…")
                            }
                        } else {
                            Label("Create new install link", systemImage: "link.badge.plus")
                        }
                    }
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 58)
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .liquidGlassCapsule(tint: Color.blue.opacity(0.18), interactive: !sessionStore.isRenewingDeviceBuildLink)
                .disabled(sessionStore.isRenewingDeviceBuildLink)
            } else {
                Button {
                    if status?.preserveData == false {
                        showingDataRemovalConfirmation = true
                    } else {
                        startInstall()
                    }
                } label: {
                    Label(installButtonTitle, systemImage: "iphone.and.arrow.forward")
                        .font(.headline.weight(.bold))
                        .frame(maxWidth: .infinity)
                        .frame(minHeight: 58)
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .liquidGlassCapsule(tint: canInstall ? Color.blue.opacity(0.18) : Color.gray.opacity(0.12), interactive: canInstall)
                .disabled(!canInstall || sessionStore.isStartingInstallation)
                .accessibilityIdentifier("installBuildButton")
            }

            if let message = sessionStore.deviceBuildActionMessage {
                Text(message)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(message == "New install link created." ? Color.green : Color.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .background {
            LinearGradient(
                colors: [
                    Color(.systemBackground).opacity(0),
                    Color(.systemBackground).opacity(0.92),
                    Color(.systemBackground)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }

    private var appInitials: String {
        let name = appName
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        let text = String(letters).uppercased()
        return text.isEmpty ? "IB" : text
    }

    private var currentManagedBuild: ManagedBuild? {
        sessionStore.managedApps
            .flatMap(\.builds)
            .first { $0.id == build.id }
    }

    private var installationStatus: InstallationState {
        sessionStore.currentBuildInstallationState
    }

    private var actionableWarnings: [String] {
        (status?.signing.warnings ?? []).filter {
            !$0.localizedCaseInsensitiveContains("app data is preserved only when")
        }
    }

    private var appName: String {
        if let name = status?.app.name, !name.isEmpty { return name.swiftSimDisplayName }
        return (currentManagedBuild?.displayName ?? "iPhone Build").swiftSimDisplayName
    }

    private var buildSubtitle: String {
        let version = status?.app.version.isEmpty == false ? status?.app.version : currentManagedBuild?.version
        let buildNumber = status?.app.build.isEmpty == false ? status?.app.build : currentManagedBuild?.buildNumber
        if let buildNumber, !buildNumber.isEmpty { return "Build \(buildNumber)" }
        if let version, !version.isEmpty { return "Version \(version)" }
        return "Checking build…"
    }

    private var canInstall: Bool {
        guard !installationStatus.isInstalled, sessionStore.currentBuildInstallURL() != nil else { return false }
        if status == nil { return true }
        guard status?.isReady == true else { return false }
        guard let expiry = status?.expiryDate else { return currentManagedBuild?.isLinkActive == true }
        return expiry > Date()
    }

    private var isInstallLinkExpired: Bool {
        guard status?.isReady == true else { return false }
        guard let expiry = status?.expiryDate else { return currentManagedBuild?.isLinkActive == false }
        return expiry <= Date()
    }

    private var installButtonTitle: String {
        if installationStatus.isInstalled { return "Build installed" }
        if sessionStore.isStartingInstallation { return "Opening installer…" }
        guard canInstall else { return status == nil || isPreparingBuild ? "Preparing install…" : "Install unavailable" }
        let buildCount = sessionStore.managedApps.first(where: { $0.id == currentManagedBuild?.appID })?.builds.count ?? 1
        return buildCount > 1 ? "Install update" : "Install on iPhone"
    }

    private func startInstall() {
        // The view prepares its URL while loading. Only a synchronous button
        // event opens the system installer; preparation never auto-installs.
        guard canInstall, let installURL = sessionStore.currentBuildInstallURL(),
              let attemptID = sessionStore.beginCurrentBuildInstall() else { return }
        openURL(installURL) { opened in
            Task { @MainActor in
                let accepted = sessionStore.finishCurrentBuildInstallHandoff(opened: opened, attemptID: attemptID)
                if accepted { await sessionStore.syncCurrentBuildInstallRequested() }
            }
        }
    }

    private var conciseVersionLabel: String {
        let version = status?.app.version.isEmpty == false ? status?.app.version : currentManagedBuild?.version
        guard let version, !version.isEmpty else { return "Checking…" }
        return version
    }

    private var appBundleIdentifier: String {
        if let identifier = status?.app.bundleIdentifier, !identifier.isEmpty { return identifier }
        return currentManagedBuild?.bundleIdentifier ?? ""
    }

    private var dataPreservationDetail: String {
        guard status != nil else { return "Waiting for build details from your Mac." }
        if status?.preserveData == false {
            return "Installing this version removes the app's current data."
        }
        return "Your current app data stays on this iPhone."
    }

    private var installLinkDetail: String {
        if isInstallLinkExpired { return "Expired" }
        if let state = status?.state, !["ready", "failed"].contains(state) {
            return "Not ready"
        }
        guard let expiry = status?.expiryDate else {
            return currentManagedBuild?.isLinkActive == true ? "Not reported" : "Unavailable"
        }
        let time = expiry.formatted(date: .omitted, time: .shortened)
        if Calendar.current.isDateInToday(expiry) { return time }
        if Calendar.current.isDateInTomorrow(expiry) { return "Tomorrow, \(time)" }
        return expiry.formatted(date: .abbreviated, time: .shortened)
    }

    private var verifiedDevice: VerifiedDevice? {
        status?.installation?.devices.first
    }

    private var installedVersionLabel: String? {
        guard let device = verifiedDevice, !device.version.isEmpty else { return nil }
        guard !device.build.isEmpty else { return "Version \(device.version)" }
        return "Version \(device.version) (\(device.build))"
    }

    private var isPreparingBuild: Bool {
        switch status?.state {
        case "queued", "preparing", "building", "archiving", "exporting", "delivering", nil: return true
        default: return false
        }
    }

    private var installStatusTitle: String {
        if status?.origin == "xcode" && !installationStatus.isInstalled { return "Built in Xcode" }
        switch installationStatus {
        case .launchConfirmed: return "Installed & launched"
        case .verified: return "Installed"
        case .requested: return "Install requested"
        case .differentVersion: return "Update available"
        case .notInstalled: return "Ready to install"
        case .unknown: break
        }
        if isInstallLinkExpired { return "Install link expired" }
        switch status?.state ?? "loading" {
        case "queued", "loading": return "Waiting to build"
        case "preparing": return "Checking project"
        case "building", "archiving": return "Building current code"
        case "exporting": return "Exporting app"
        case "delivering": return "Creating install link"
        case "ready": return "Ready to install"
        case "failed": return "Couldn't prepare app"
        default: return "Checking status"
        }
    }

    private var installStatusDetail: String {
        if status?.origin == "xcode" && !installationStatus.isInstalled {
            return "Recorded from Xcode. A downloadable copy has not been exported. Installation is confirmed when the connected Debug app opens."
        }
        switch installationStatus {
        case .launchConfirmed:
            let seen = status?.installation?.lastSeenAt ?? status?.installation?.launchConfirmedAt
            if let date = SwiftSimISO8601.date(from: seen) {
                return "This exact Debug build launched successfully. Last confirmed \(date.formatted(date: .abbreviated, time: .shortened))."
            }
            return "This exact Debug build reported a successful launch over the private connection."
        case .verified:
            if let installedVersionLabel, let name = verifiedDevice?.name, !name.isEmpty {
                return "\(installedVersionLabel) is installed on \(name)."
            }
            return "This version is installed on your iPhone."
        case .requested:
            return "The install request was sent to iOS. Approve its prompt when it appears. Installation is confirmed separately."
        case .differentVersion:
            if let installedVersionLabel {
                return "\(installedVersionLabel) is installed. This link has Version \(conciseVersionLabel)."
            }
            return "A different version is installed. Install this version to update it."
        case .notInstalled:
            return "This version is ready to install."
        case .unknown: break
        }
        if isInstallLinkExpired { return "Create a new link to install this version." }
        switch status?.state {
        case "queued": return "Waiting to start."
        case "preparing": return "Reading the project and signing settings on your Mac."
        case "building", "archiving": return "Xcode is compiling the current working tree on your Mac."
        case "exporting": return "Xcode is signing and packaging the install file."
        case "delivering": return "Swift Sim is creating the temporary install link."
        case "ready": return "Confirm the update in the iOS installer."
        case "failed": return "Open Build Details for more information."
        default: return "Swift Sim is checking the latest status."
        }
    }

    private var installStatusSymbol: String {
        switch installationStatus {
        case .verified, .launchConfirmed: return "checkmark.circle.fill"
        case .requested: return "arrow.down.circle.fill"
        case .differentVersion: return "arrow.triangle.2.circlepath.circle.fill"
        case .notInstalled: return "iphone.and.arrow.forward"
        case .unknown: break
        }
        if isInstallLinkExpired { return "clock.badge.exclamationmark" }
        return status?.state == "failed" ? "xmark.circle.fill" : "iphone.and.arrow.forward"
    }

    private var installStatusColor: Color {
        switch installationStatus {
        case .verified, .launchConfirmed: return .green
        case .requested, .differentVersion, .notInstalled: return .blue
        case .unknown: break
        }
        if status?.state == "failed" { return .red }
        return isInstallLinkExpired ? .secondary : .blue
    }
}

private struct SessionRow: View {
    let recent: RecentSession

    var body: some View {
        HStack(spacing: 14) {
            AppBadge(text: recent.initials, isEmpty: false)

            VStack(alignment: .leading, spacing: 5) {
                Text(recent.displayName)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Label("Simulator", systemImage: "iphone")
                    Text(recent.hostDisplayName)
                        .lineLimit(1)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: "play.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 36, height: 36)
                .background(.blue.gradient, in: Circle())
        }
        .padding(14)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
    }
}

private struct ManagedAppRow: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @EnvironmentObject private var activity: ActivityCenter
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let app: ManagedApp

    var body: some View {
        HStack(spacing: 14) {
            AppBadge(text: app.initials, isEmpty: false, accent: appAccent, icon: sessionStore.iconReference(for: app))
            VStack(alignment: .leading, spacing: 8) {
                Text(app.displayName.swiftSimDisplayName)
                    .font(.headline.weight(.semibold)).foregroundStyle(.primary)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { buildStamp; statusStamp }.fixedSize(horizontal: true, vertical: false)
                    VStack(alignment: .leading, spacing: 5) { buildStamp; statusStamp }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22), interactive: true)
    }

    private var buildStamp: some View {
        Text(app.recentDetectedBuild.map { "Build \($0.build)" } ?? app.latestBuild.map { $0.buildNumber.isEmpty ? "Saved build" : "Build \($0.buildNumber)" } ?? "No builds")
            .font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: true, vertical: false)
    }

    private var statusStamp: some View {
        HStack(spacing: 5) {
            Circle().fill(appAccent).frame(width: 5, height: 5)
            Text(statusLabel).font(.caption.weight(.semibold)).foregroundStyle(appAccent)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var deliveryStatus: AppDeliveryPresentation? { activity.deliveryStatus(for: app) }

    private var statusLabel: String {
        if let deliveryStatus { return deliveryStatus.label(for: app.displayName.swiftSimDisplayName) }
        return app.recentDetectedBuild == nil ? (app.latestBuild?.libraryStatusText ?? "No builds yet") : "Untracked Debug build detected" }

    private var appAccent: Color {
        if let deliveryStatus { return deliveryStatus.completionVerified ? .green : deliveryStatus.needsAttention ? .orange : .blue }
        if app.recentDetectedBuild != nil { return .blue }
        if app.latestBuild?.state == "failed" { return .orange }
        switch app.latestBuild?.installationStatus {
        case .verified, .launchConfirmed: return .green
        case .requested, .differentVersion, .notInstalled: return .blue
        default: return .blue
        }
    }
}

private struct SwipeToDeleteRow<Content: View>: View {
    private let actionWidth: CGFloat = 82

    @State private var offset: CGFloat = 0
    @State private var isOpen = false

    @ViewBuilder let content: () -> Content
    let onOpen: () -> Void
    let onDelete: () -> Void

    var body: some View {
        ZStack(alignment: .trailing) {
            Button(role: .destructive) {
                onDelete()
            } label: {
                VStack(spacing: 5) {
                    Image(systemName: "trash.fill")
                        .font(.system(size: 18, weight: .semibold))
                    Text("Delete")
                        .font(.caption2.weight(.semibold))
                }
                .foregroundStyle(.white)
                .frame(width: actionWidth)
                .frame(maxHeight: .infinity)
            }
            .buttonStyle(.plain)
            .background(.red)
            .frame(width: max(-offset, 0), alignment: .trailing)
            .clipped()
            .allowsHitTesting(isOpen)

            content()
                .offset(x: offset)
                .contentShape(Rectangle())
                .simultaneousGesture(rowGesture)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction {
                    onOpen()
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var rowGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let restingOffset = isOpen ? -actionWidth : 0
                offset = min(0, max(-actionWidth, restingOffset + value.translation.width))
            }
            .exclusively(before: TapGesture())
            .onEnded { value in
                switch value {
                case .first(let drag):
                    guard abs(drag.translation.width) > abs(drag.translation.height) else { return }
                    let restingOffset = isOpen ? -actionWidth : 0
                    let shouldOpen = restingOffset + drag.predictedEndTranslation.width < -actionWidth / 2
                    isOpen = shouldOpen
                    withAnimation(.snappy(duration: 0.22)) {
                        offset = shouldOpen ? -actionWidth : 0
                    }
                case .second:
                    if isOpen {
                        isOpen = false
                        withAnimation(.snappy(duration: 0.22)) {
                            offset = 0
                        }
                    } else {
                        onOpen()
                    }
                }
            }
    }
}

private struct EmptySessionCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppBadge(text: nil, isEmpty: true, symbol: "play.rectangle.on.rectangle")

            VStack(alignment: .leading, spacing: 6) {
                Text("No Simulator previews yet")
                    .font(.title3.weight(.bold))
                Text("Open the Simulator link you receive, or paste it here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .cardSurface(cornerRadius: 24, tint: Color.cyan.opacity(0.08))
    }
}

private struct EmptyDeviceBuildCard: View {
    let isArchive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppBadge(text: nil, isEmpty: true, symbol: "iphone.and.arrow.forward")

            VStack(alignment: .leading, spacing: 6) {
                Text(isArchive ? "No archived apps" : "No apps yet")
                    .font(.title3.weight(.bold))
                Text(isArchive ? "Apps you archive appear here." : "Connect your Mac to see your apps and builds.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .cardSurface(cornerRadius: 24, tint: Color.blue.opacity(0.04))
    }
}

private struct LibraryActionBanner: View {
    let notice: LibraryActionNotice
    let dismiss: () -> Void

    private var accent: Color {
        switch notice.kind {
        case .success: .green
        case .error: .red
        case .information: .blue
        }
    }

    private var symbol: String {
        switch notice.kind {
        case .success: "checkmark.circle.fill"
        case .error: "exclamationmark.triangle.fill"
        case .information: "clock"
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(accent)

            Text(notice.message)
                .font(.callout.weight(.semibold))
                .frame(maxWidth: .infinity, alignment: .leading)

            Button(action: dismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .bold))
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss")
        }
        .padding(.leading, 16)
        .padding(.trailing, 10)
        .padding(.vertical, 10)
        .cardSurface(cornerRadius: 22, tint: accent.opacity(0.12))
    }
}

private struct AppBadge: View {
    let text: String?
    let isEmpty: Bool
    var symbol = "terminal.fill"
    var accent: Color = .blue
    var icon: AppIconReference? = nil
    @State private var image: UIImage?
    @State private var loadedDigest: String?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 21, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: isEmpty ? [accent.opacity(0.12), accent.opacity(0.06)] : [accent, accent.opacity(0.72)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if let image {
                Image(uiImage: image).resizable().scaledToFill().frame(width: 70, height: 70)
                    .clipShape(RoundedRectangle(cornerRadius: 21, style: .continuous))
            } else if let text {
                Text(text)
                    .font(.system(size: 23, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(accent)
            }
        }
        .frame(width: 70, height: 70)
        .accessibilityHidden(true)
        .task(id: icon) {
            guard let icon else { image = nil; loadedDigest = nil; return }
            guard loadedDigest != icon.digest || image == nil else { return }
            image = nil
            guard let data = await AppIconCache.shared.data(for: icon), !Task.isCancelled else { return }
            image = AppIconCache.image(from: data); loadedDigest = icon.digest
        }
    }
}

private struct MacSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var showingPasteLink = false
    @State private var showingQRScanner = false
    @State private var showingForgetConfirmation = false

    var body: some View {
        NavigationStack {
            ZStack {
                HomeCanvas()
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let mac = sessionStore.pairedMac {
                            connectedMacCard(mac)
                            connectionDetails
                        } else {
                            setupCard
                        }
                        if sessionStore.isPairingMac {
                            Label("Connecting…", systemImage: "arrow.triangle.2.circlepath")
                                .font(.subheadline).foregroundStyle(.secondary)
                        }
                        if let error = sessionStore.pairingErrorMessage {
                            Label(error, systemImage: "exclamationmark.circle")
                                .font(.subheadline).foregroundStyle(.red)
                        }
                        helpCard
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Mac connection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .alert("Forget this Mac?", isPresented: $showingForgetConfirmation) {
                Button("Forget Mac", role: .destructive) { sessionStore.forgetPairedMac() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You'll need to pair again for remote controls. Your apps and build history stay on this iPhone.")
            }
            .task { await sessionStore.refreshConnectionChecks() }
            .sheet(isPresented: $showingPasteLink) { PasteLinkSheet().environmentObject(sessionStore) }
            .sheet(isPresented: $showingQRScanner) {
                PairingQRScannerSheet { code in
                    showingQRScanner = false
                    guard let url = URL(string: code), PairingInvite(url: url) != nil || PairedMac(url: url) != nil else { return }
                    _ = sessionStore.open(url)
                }
            }
        }
    }

    private func connectedMacCard(_ mac: PairedMac) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: "macbook")
                    .font(.title2).foregroundStyle(.blue)
                    .frame(width: 48, height: 48)
                    .liquidGlassCircle(tint: Color.blue.opacity(0.12), interactive: false)
                VStack(alignment: .leading, spacing: 5) {
                    Text(mac.displayName).font(.headline)
                    Label(connectionTitle, systemImage: sessionStore.helperStatus == .online ? "checkmark.circle.fill" : "wifi.exclamationmark")
                        .font(.subheadline).foregroundStyle(helperStatusColor)
                }
            }
            if sessionStore.helperStatus != .online {
                Text(sessionStore.helperStatus == .pairingExpired
                     ? "Use a new pairing link to reconnect."
                     : "Check your Mac is awake and Tailscale is on.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if sessionStore.helperStatus == .pairingExpired {
                    Button("Paste pairing link") { showingPasteLink = true }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                } else {
                    Button("Reconnect") { Task { await sessionStore.refreshHelperStatus() } }
                        .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22))
    }

    private var setupCard: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: "macbook.and.iphone")
                .font(.largeTitle).foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 7) {
                Text("Connect your Mac").font(.title2.weight(.bold))
                Text("Your coding agent can handle setup and send you a pairing link.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            ShareLink(item: agentPairingRequest) {
                Label("Set up with agent", systemImage: "paperplane")
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: Color.blue.opacity(0.18), interactive: true)
            HStack(spacing: 12) {
                Button { showingQRScanner = true } label: { Label("Scan code", systemImage: "qrcode.viewfinder") }
                Spacer(minLength: 8)
                Button { showingPasteLink = true } label: { Label("Paste link", systemImage: "link") }
            }
            .font(.subheadline.weight(.semibold))
            .frame(minHeight: 44)
        }
        .padding(20)
        .cardSurface(cornerRadius: 26, tint: Color.white.opacity(0.22))
    }

    private var connectionDetails: some View {
        DisclosureGroup("Connection details") {
            VStack(alignment: .leading, spacing: 14) {
                connectionRow("Tailscale", check: sessionStore.tailscaleCheck)
                Divider()
                connectionRow("Swift Sim on Mac", check: sessionStore.macHelperCheck)
                if !sessionStore.recentSessions.isEmpty {
                    Divider()
                    connectionRow("Simulator", check: sessionStore.simulatorCheck)
                }
                Button("Refresh status") { Task { await sessionStore.refreshConnectionChecks() } }
                    .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
            }
            .padding(.top, 16)
        }
        .font(.subheadline.weight(.semibold))
        .padding(18)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
    }

    private func connectionRow(_ title: String, check: ConnectionCheck) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.subheadline)
                Spacer()
                Text(check.state == .ready ? "Connected" : check.state == .checking ? "Checking…" : "Not connected")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(check.state == .ready ? Color.green : Color.secondary)
            }
            if check.state != .ready {
                Text(check.detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var helpCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            if sessionStore.pairedMac != nil {
                NavigationLink { AppTestingView().environmentObject(sessionStore) } label: {
                    HStack {
                        Label("Test with agent", systemImage: "iphone.and.arrow.forward")
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(.tertiary)
                    }.frame(minHeight: 44)
                }
                Divider()
            }
            DisclosureGroup("Setup and help") {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Install Tailscale on your Mac and iPhone, then sign in to the same account. They can use different networks.")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Link("Setup guide", destination: URL(string: "https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md")!)
                    DisclosureGroup("Manual setup") {
                        Text("On your Mac, run swift-sim setup, then swift-sim pair. Open the pairing link on this iPhone.")
                            .font(.subheadline).foregroundStyle(.secondary).padding(.top, 8)
                    }
                    if sessionStore.pairedMac != nil {
                        Button("Scan a new code") { showingQRScanner = true }.frame(minHeight: 44)
                        Button("Paste a new link") { showingPasteLink = true }.frame(minHeight: 44)
                        Button("Forget Mac", role: .destructive) { showingForgetConfirmation = true }
                            .foregroundStyle(.red).frame(minHeight: 44)
                    }
                    Text("Xcode may need a cable once to trust a new iPhone.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Link("Privacy policy", destination: URL(string: "https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/PRIVACY.md")!)
                }
                .padding(.top, 14)
            }
        }
        .font(.subheadline.weight(.medium))
        .padding(18)
        .cardSurface(cornerRadius: 24, tint: Color.white.opacity(0.18))
    }

    private var connectionTitle: String {
        switch sessionStore.helperStatus {
        case .online: "Connected"
        case .checking: "Connecting…"
        case .pairingExpired: "Reconnect needed"
        default: "Offline"
        }
    }

    private var helperStatusColor: Color {
        switch sessionStore.helperStatus {
        case .online: .green
        case .checking: .blue
        case .pairingExpired: .orange
        default: .secondary
        }
    }

    private var agentPairingRequest: String {
        """
        Set up Swift Sim remote access and pair this iPhone. Use the installed Swift Sim workflow. Check swift-sim doctor --json and swift-sim setup-status, confirm this Mac's name, and resolve anything you can on the Mac. Stop if Tailscale backends conflict. Guide me through only the missing iPhone steps, run swift-sim pair, and send the pairing link. Explain any first-time Xcode device trust separately. Verify the iPhone connection before claiming pairing succeeded.
        """
    }
}

private struct PairingQRScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let onCode: (String) -> Void

    var body: some View {
        NavigationStack {
            PairingQRScanner(onCode: onCode)
                .ignoresSafeArea(edges: .bottom)
                .navigationTitle("Scan Pairing QR")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Cancel") { dismiss() }
                    }
                }
        }
    }
}

private struct PairingQRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode)
    }

    func makeUIViewController(context: Context) -> PairingQRScannerViewController {
        PairingQRScannerViewController(onCode: context.coordinator.onCode)
    }

    func updateUIViewController(_ viewController: PairingQRScannerViewController, context: Context) {}

    final class Coordinator {
        let onCode: (String) -> Void

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
        }
    }
}

private final class PairingQRScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let onCode: (String) -> Void
    private let captureSession = AVCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var didScan = false

    init(onCode: @escaping (String) -> Void) {
        self.onCode = onCode
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureCaptureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted {
                        self.configureCaptureSession()
                    } else {
                        self.showUnavailableMessage()
                    }
                }
            }
        case .denied, .restricted:
            showUnavailableMessage()
        @unknown default:
            showUnavailableMessage()
        }
    }

    private func configureCaptureSession() {
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              captureSession.canAddInput(input) else {
            showUnavailableMessage()
            return
        }
        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            showUnavailableMessage()
            return
        }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard captureSession.inputs.isEmpty == false,
              captureSession.outputs.isEmpty == false,
              !captureSession.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async { [captureSession] in
            captureSession.startRunning()
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        guard captureSession.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async { [captureSession] in
            captureSession.stopRunning()
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !didScan,
              let value = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        didScan = true
        captureSession.stopRunning()
        onCode(value)
    }

    private func showUnavailableMessage() {
        guard view.viewWithTag(7101) == nil else { return }
        let label = UILabel()
        label.tag = 7101
        label.text = "Camera access is unavailable. Use Open or Paste Pairing Link instead."
        label.textColor = .white
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 28),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -28),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }
}

struct HomeCanvas: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)

            LinearGradient(
                colors: [
                    Color.cyan.opacity(0.12),
                    Color(.systemBackground),
                    Color.blue.opacity(0.08)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
    }
}

private extension String {
    var swiftSimDisplayName: String {
        replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(
                of: "([a-z0-9])([A-Z])",
                with: "$1 $2",
                options: .regularExpression
            )
    }
}

extension View {
    @ViewBuilder
    func cardSurface(cornerRadius: CGFloat, tint: Color, interactive: Bool = false) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26, *) {
            self.glassEffect(interactive ? .regular.tint(tint).interactive() : .regular.tint(tint), in: shape)
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .background(tint, in: shape)
                .overlay { shape.stroke(.white.opacity(0.24), lineWidth: 1) }
                .shadow(color: .black.opacity(0.08), radius: 20, x: 0, y: 10)
        }
    }

    @ViewBuilder
    func liquidGlassCapsule(tint: Color, interactive: Bool) -> some View {
        if #available(iOS 26, *) {
            self
                .background(.clear, in: Capsule())
                .glassEffect(interactive ? .regular.tint(tint).interactive() : .regular.tint(tint), in: Capsule())
        } else {
            self
                .background(.ultraThinMaterial, in: Capsule())
                .overlay {
                    Capsule().stroke(.white.opacity(0.24), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.06), radius: 18, x: 0, y: 10)
        }
    }

    @ViewBuilder
    func liquidGlassCircle(tint: Color, interactive: Bool) -> some View {
        if #available(iOS 26, *) {
            self
                .background(.clear, in: Circle())
                .glassEffect(interactive ? .regular.tint(tint).interactive() : .regular.tint(tint), in: Circle())
        } else {
            self
                .background(.ultraThinMaterial, in: Circle())
                .overlay {
                    Circle().stroke(.white.opacity(0.24), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.06), radius: 18, x: 0, y: 10)
        }
    }
}
