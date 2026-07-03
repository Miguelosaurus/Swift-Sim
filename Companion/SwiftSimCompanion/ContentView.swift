import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore

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
    }
}

private struct HomeView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @AppStorage("swiftSim.homeMode") private var homeMode = HomeMode.installs.rawValue
    @State private var searchText = ""
    @State private var showingMacSettings = false
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
        let apps = sessionStore.managedApps.filter { $0.isArchived == showingArchivedApps }
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
        ZStack(alignment: .bottom) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    modePicker

                    if selectedMode == .installs {
                        installStatusPanel
                        deviceBuildBoard
                    } else {
                        macStatusPanel
                        sessionBoard
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, 122)
            }

            commandDock
        }
        .sheet(isPresented: $showingMacSettings) {
            MacSettingsSheet()
                .environmentObject(sessionStore)
        }
        .sheet(isPresented: $showingPasteLink) {
            PasteLinkSheet()
                .environmentObject(sessionStore)
                .presentationDetents([.height(300)])
                .presentationDragIndicator(.visible)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Swift Sim")
                .font(.system(size: 34, weight: .bold, design: .rounded))
            Text(selectedMode == .installs ? "Install and update iPhone apps" : "Live Simulator preview")
                .font(.callout.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var modePicker: some View {
        Picker("Mode", selection: $homeMode) {
            Label("Install", systemImage: "iphone.and.arrow.forward")
                .tag(HomeMode.installs.rawValue)
            Label("Simulator", systemImage: "play.rectangle.on.rectangle")
                .tag(HomeMode.simulator.rawValue)
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Swift Sim mode")
    }

    private var installStatusPanel: some View {
        HStack(spacing: 14) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.system(size: 25, weight: .semibold))
                .foregroundStyle(.green)
                .frame(width: 50, height: 50)
                .liquidGlassCircle(tint: Color.green.opacity(0.12), interactive: false)

            VStack(alignment: .leading, spacing: 4) {
                Text("Ready for iPhone Builds")
                    .font(.headline.weight(.semibold))
                Text(appLibrarySummary)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)
        }
        .padding(14)
        .liquidGlassPanel(cornerRadius: 26, tint: Color.green.opacity(0.08), interactive: false)
    }

    private var appLibrarySummary: String {
        let activeCount = sessionStore.managedApps.filter { !$0.isArchived }.count
        guard activeCount > 0 else { return "Signed by Xcode. No Tailscale required." }
        return activeCount == 1 ? "1 prototype app with complete build history" : "\(activeCount) prototype apps with organized build history"
    }

    private var macStatusPanel: some View {
        Button {
            showingMacSettings = true
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
        .liquidGlassPanel(cornerRadius: 30, tint: Color.white.opacity(0.18), interactive: true)
        .accessibilityLabel("Simulator connection details")
    }

    private var simulatorStatusTitle: String {
        sessionStore.recentSessions.isEmpty ? "Set Up Live Preview" : "Simulator Paired"
    }

    private var simulatorStatusDetail: String {
        let count = sessionStore.recentSessions.count
        guard count > 0 else { return "Open a Swift Sim session link to begin" }
        return count == 1 ? "1 recent project ready to open" : "\(count) recent projects ready to open"
    }

    private var statusColor: Color {
        guard !sessionStore.recentSessions.isEmpty else { return .gray }
        return .green
    }

    private var sessionBoard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text("Simulator Sessions")
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
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .liquidGlassCircle(tint: Color.white.opacity(0.18), interactive: true)
                .accessibilityLabel(showingArchivedApps ? "Show active apps" : "Show archived apps")

                Text("\(filteredApps.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .liquidGlassCapsule(tint: .white.opacity(0.24), interactive: false)
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
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(.secondary)

                TextField(selectedMode == .installs ? "Find an app" : "Find a Simulator session", text: $searchText)
                    .font(.body.weight(.medium))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 16)
            .frame(height: 58)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Open Swift Sim Link")
                    .font(.title2.weight(.bold))
                Spacer()
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 17, weight: .bold))
                        .frame(width: 42, height: 42)
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
            }
            .padding(.horizontal, 16)
            .frame(height: 58)
            .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

            if !errorText.isEmpty {
                Text(errorText)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.red)
            }

            Button {
                openLink()
            } label: {
                Label("Open in Swift Sim", systemImage: "play.fill")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: Color.blue.opacity(0.18), interactive: true)
            .disabled(linkText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            Text("Paste an install, Simulator, or pairing link from Codex.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(22)
    }

    private func openLink() {
        let trimmed = linkText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed) else {
            errorText = "That link is not valid."
            return
        }
        if sessionStore.open(url) {
            dismiss()
        } else {
            errorText = "That is not a Swift Sim session, device build, or pairing link."
        }
    }
}

private struct ManagedAppDetailView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let app: ManagedApp
    @State private var showingDeleteConfirmation = false

    var body: some View {
        ZStack {
            HomeCanvas()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 22) {
                    topBar
                    appHeader
                    latestBuildSection
                    buildHistorySection
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, 40)
            }
        }
        .alert("Delete Swift Sim History?", isPresented: $showingDeleteConfirmation) {
            Button("Delete History", role: .destructive) {
                sessionStore.deleteManagedApp(app)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the saved build timeline from Swift Sim. It does not uninstall the app from your iPhone.")
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

            Text("App History")
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
                    Label("Delete History", systemImage: "trash")
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

    private var appHeader: some View {
        HStack(alignment: .center, spacing: 16) {
            AppBadge(text: app.initials, isEmpty: false, accent: statusColor)
                .frame(width: 72, height: 72)

            VStack(alignment: .leading, spacing: 5) {
                Text(app.displayName)
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .lineLimit(2)
                Text(app.bundleIdentifier.isEmpty ? "Bundle identifier unavailable" : app.bundleIdentifier)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Label(statusText, systemImage: statusSymbol)
                    .font(.caption.weight(.bold))
                    .foregroundStyle(statusColor)
            }

            Spacer(minLength: 0)
        }
    }

    private var latestBuildSection: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("Current Build")
                .font(.title3.weight(.bold))

            if let latest = app.latestBuild {
                Button {
                    sessionStore.reopen(latest)
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: latest.installationState == "verified" ? "checkmark.circle.fill" : "iphone.and.arrow.forward")
                            .font(.system(size: 25, weight: .semibold))
                            .foregroundStyle(statusColor)
                            .frame(width: 46, height: 46)
                            .liquidGlassCircle(tint: statusColor.opacity(0.12), interactive: false)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(latest.versionLabel)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(.primary)
                            Text(latest.isLinkActive ? "Install link available" : "Build metadata saved")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(16)
                    .liquidGlassPanel(cornerRadius: 26, tint: statusColor.opacity(0.08), interactive: true)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var buildHistorySection: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("Build History")
                    .font(.title3.weight(.bold))
                Spacer()
                Text("\(app.builds.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
            }

            ForEach(app.builds.sorted { $0.createdAt > $1.createdAt }) { build in
                Button {
                    sessionStore.reopen(build)
                } label: {
                    BuildHistoryRow(build: build, isCurrent: build.id == app.latestBuild?.id)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var statusText: String {
        if app.isArchived { return "Archived" }
        switch app.latestBuild?.installationState {
        case "verified": return "Verified on iPhone"
        case "requested": return "Install requested"
        default: return "Ready for the next build"
        }
    }

    private var statusSymbol: String {
        if app.isArchived { return "archivebox.fill" }
        return app.latestBuild?.installationState == "verified" ? "checkmark.circle.fill" : "clock.arrow.circlepath"
    }

    private var statusColor: Color {
        if app.isArchived { return .secondary }
        switch app.latestBuild?.installationState {
        case "verified": return .green
        case "requested": return .orange
        default: return .blue
        }
    }
}

private struct BuildHistoryRow: View {
    let build: ManagedBuild
    let isCurrent: Bool

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 36, height: 36)
                .liquidGlassCircle(tint: color.opacity(0.1), interactive: false)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(build.versionLabel)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.primary)
                    if isCurrent {
                        Text("CURRENT")
                            .font(.system(size: 9, weight: .heavy))
                            .foregroundStyle(.blue)
                    }
                }
                Text(build.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(buildStatus)
                .font(.caption.weight(.semibold))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
        .liquidGlassPanel(cornerRadius: 22, tint: Color.white.opacity(0.12), interactive: true)
    }

    private var icon: String {
        switch build.installationState {
        case "verified": "checkmark.circle.fill"
        case "requested": "clock.fill"
        default: build.isLinkActive ? "arrow.down.circle.fill" : "clock.arrow.circlepath"
        }
    }

    private var color: Color {
        switch build.installationState {
        case "verified": .green
        case "requested": .orange
        default: build.isLinkActive ? .blue : .secondary
        }
    }

    private var buildStatus: String {
        switch build.installationState {
        case "verified": "Verified"
        case "requested": "Requested"
        default: build.isLinkActive ? "Available" : "Expired"
        }
    }
}

private struct DeviceBuildView: View {
    @Environment(\.openURL) private var openURL
    @EnvironmentObject private var sessionStore: SessionStore
    let build: DeviceBuildSession

    private var status: DeviceBuildStatus? {
        sessionStore.deviceBuildStatus
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            HomeCanvas()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 18) {
                    topBar
                    buildHero
                    installationPanel
                    updateSafety
                    logsPanel
                }
                .padding(.horizontal, 22)
                .padding(.top, 18)
                .padding(.bottom, 120)
            }

            installDock
        }
        .task {
            await sessionStore.refreshDeviceBuild()
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                sessionStore.closeCurrentBuild()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 25, weight: .bold))
                    .frame(width: 56, height: 56)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.24), interactive: true)

            Spacer()

            VStack(spacing: 3) {
                Text("Install on iPhone")
                    .font(.headline.weight(.bold))
                HStack(spacing: 6) {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 8, height: 8)
                    Text(statusLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            Button {
                Task { await sessionStore.refreshDeviceBuild() }
            } label: {
                Image(systemName: "arrow.trianglehead.clockwise")
                    .font(.system(size: 22, weight: .semibold))
                    .frame(width: 56, height: 56)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.24), interactive: true)
        }
    }

    private var buildHero: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppBadge(text: appInitials, isEmpty: false)
                .frame(width: 78, height: 78)

            VStack(alignment: .leading, spacing: 7) {
                Text(appName)
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .lineLimit(2)
                Text(bundleIdentifier.isEmpty ? "Waiting for signing details" : bundleIdentifier)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            HStack(spacing: 10) {
                BuildFactChip(title: "Signing", value: status?.signing.method.capitalized ?? "Checking")
                BuildFactChip(title: "Data", value: status?.preserveData == false ? "Replace" : "Preserve")
            }

            Label(
                status?.delivery?.mode == "quick-tunnel" ? "Available on any network" : "Custom delivery link",
                systemImage: "network"
            )
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .liquidGlassPanel(cornerRadius: 34, tint: Color.white.opacity(0.18), interactive: false)
    }

    private var installationPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label(installationTitle, systemImage: installationSymbol)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(installationColor)
                Spacer()
                Button {
                    Task { await sessionStore.verifyCurrentBuildInstallation() }
                } label: {
                    Label("Verify", systemImage: "arrow.clockwise")
                        .font(.caption.weight(.bold))
                }
                .buttonStyle(.borderless)
            }

            if let device = status?.installation?.devices.first(where: { $0.state == "installed" }) {
                Text("\(device.name) has version \(device.version) (\(device.build)).")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text(installationDetail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(18)
        .liquidGlassPanel(cornerRadius: 28, tint: installationColor.opacity(0.07), interactive: false)
    }

    private var updateSafety: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Update Safety", systemImage: "externaldrive.badge.checkmark")
                .font(.headline.weight(.bold))

            Text("Swift Sim installs over the existing app by default. Your login and app data stay in place when the bundle identifier, signing team, and entitlements match the installed app.")
                .font(.callout)
                .foregroundStyle(.secondary)

            if let warnings = status?.signing.warnings, !warnings.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(warnings, id: \.self) { warning in
                        Label(warning, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.orange)
                    }
                }
            }
        }
        .padding(18)
        .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.14), interactive: false)
    }

    private var logsPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Build Log")
                .font(.headline.weight(.bold))

            if sessionStore.deviceBuildLogs.isEmpty {
                Text("Waiting for build output.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(sessionStore.deviceBuildLogs.suffix(8), id: \.self) { line in
                    Text(line)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.14), interactive: false)
    }

    private var installDock: some View {
        VStack(spacing: 10) {
            Button {
                let statusInstallURL: URL?
                if let installURLString = status?.links?.installURL {
                    statusInstallURL = URL(string: installURLString)
                } else {
                    statusInstallURL = nil
                }
                let installURL = statusInstallURL ?? build.installURL ?? build.installPageURL
                Task {
                    await sessionStore.markCurrentBuildInstallRequested()
                    openURL(installURL)
                }
            } label: {
                Label(installButtonTitle, systemImage: "iphone.and.arrow.forward")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 58)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: canInstall ? Color.green.opacity(0.2) : Color.gray.opacity(0.12), interactive: canInstall)
            .disabled(!canInstall)

            if let expiry = status?.expiryDate {
                Text("Install page expires \(expiry.formatted(date: .omitted, time: .shortened))")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 22)
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

    private var appName: String {
        if let name = status?.app.name, !name.isEmpty { return name }
        return currentManagedBuild?.displayName ?? "iPhone Build"
    }

    private var bundleIdentifier: String {
        if let identifier = status?.app.bundleIdentifier, !identifier.isEmpty { return identifier }
        return currentManagedBuild?.bundleIdentifier ?? ""
    }

    private var canInstall: Bool {
        guard status?.isReady == true else { return false }
        guard let expiry = status?.expiryDate else { return currentManagedBuild?.isLinkActive == true }
        return expiry > Date()
    }

    private var installButtonTitle: String {
        guard canInstall else { return status?.isReady == true ? "Install Link Expired" : "Build Not Ready" }
        let buildCount = sessionStore.managedApps.first(where: { $0.id == currentManagedBuild?.appID })?.builds.count ?? 1
        return buildCount > 1 ? "Install Update" : "Install on iPhone"
    }

    private var installationTitle: String {
        switch status?.installation?.state ?? currentManagedBuild?.installationState {
        case "verified": "Verified on iPhone"
        case "requested": "Install requested"
        case "not-installed": "Not found on reachable iPhone"
        default: "Installation not verified"
        }
    }

    private var installationSymbol: String {
        switch status?.installation?.state ?? currentManagedBuild?.installationState {
        case "verified": "checkmark.circle.fill"
        case "requested": "clock.badge.checkmark"
        case "not-installed": "iphone.slash"
        default: "questionmark.circle"
        }
    }

    private var installationColor: Color {
        switch status?.installation?.state ?? currentManagedBuild?.installationState {
        case "verified": .green
        case "requested": .orange
        case "not-installed": .red
        default: .secondary
        }
    }

    private var installationDetail: String {
        switch status?.installation?.state ?? currentManagedBuild?.installationState {
        case "requested": "iOS accepted the install handoff. Swift Sim can verify the exact version when this iPhone is reachable from the Mac."
        case "not-installed": "The app was not present on the reachable iPhone during the last check."
        default: "Verification uses Apple developer tooling when this iPhone is reachable from the Mac."
        }
    }

    private var statusLabel: String {
        switch status?.state ?? "loading" {
        case "queued": "Queued"
        case "preparing": "Preparing"
        case "archiving": "Archiving"
        case "exporting": "Exporting"
        case "ready": "Ready"
        case "failed": "Failed"
        default: "Checking"
        }
    }

    private var statusColor: Color {
        switch status?.state {
        case "ready": .green
        case "failed": .red
        case "queued", "preparing", "archiving", "exporting": .yellow
        default: .gray
        }
    }
}

private struct BuildFactChip: View {
    let title: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.bold))
                .foregroundStyle(.primary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .liquidGlassPanel(cornerRadius: 18, tint: Color.white.opacity(0.12), interactive: false)
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
        .liquidGlassPanel(cornerRadius: 26, tint: Color.white.opacity(0.18), interactive: true)
    }
}

private struct ManagedAppRow: View {
    let app: ManagedApp

    var body: some View {
        HStack(spacing: 14) {
            AppBadge(text: app.initials, isEmpty: false, accent: appAccent)

            VStack(alignment: .leading, spacing: 5) {
                Text(app.displayName)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                HStack(spacing: 7) {
                    Circle()
                        .fill(appAccent)
                        .frame(width: 7, height: 7)
                    Text("\(statusLabel) - \(app.latestBuild?.versionLabel ?? "No build details")")
                        .lineLimit(1)
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 5) {
                Text("\(app.builds.count)")
                    .font(.headline.weight(.bold))
                Text(app.builds.count == 1 ? "build" : "builds")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.tertiary)
        }
        .padding(14)
        .liquidGlassPanel(cornerRadius: 26, tint: Color.white.opacity(0.18), interactive: true)
    }

    private var statusLabel: String {
        switch app.latestBuild?.installationState {
        case "verified": "Verified"
        case "requested": "Install requested"
        default: app.latestBuild?.isLinkActive == true ? "Ready to install" : "Build history"
        }
    }

    private var appAccent: Color {
        switch app.latestBuild?.installationState {
        case "verified": .green
        case "requested": .orange
        default: .blue
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
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
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
                Text("No Simulator sessions yet")
                    .font(.title3.weight(.bold))
                Text("Live previews from Codex appear here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .liquidGlassPanel(cornerRadius: 30, tint: Color.cyan.opacity(0.08), interactive: false)
    }
}

private struct EmptyDeviceBuildCard: View {
    let isArchive: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppBadge(text: nil, isEmpty: true, symbol: "iphone.and.arrow.forward")

            VStack(alignment: .leading, spacing: 6) {
                Text(isArchive ? "No archived apps" : "No prototype apps yet")
                    .font(.title3.weight(.bold))
                Text(isArchive ? "Archived apps stay organized here without cluttering your active library." : "Your first signed install link from Codex creates an app with its own build history.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .liquidGlassPanel(cornerRadius: 30, tint: Color.green.opacity(0.08), interactive: false)
    }
}

private struct AppBadge: View {
    let text: String?
    let isEmpty: Bool
    var symbol = "terminal.fill"
    var accent: Color = .blue

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 21, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: isEmpty ? [Color.gray.opacity(0.55), Color.gray.opacity(0.28)] : [accent, accent.opacity(0.62)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if let text {
                Text(text)
                    .font(.system(size: 23, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .frame(width: 70, height: 70)
    }
}

private struct MacSettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ConnectionRequirementRow(
                        icon: "iphone.gen3.radiowaves.left.and.right",
                        tint: .blue,
                        title: hasSavedSimulator ? "Simulator paired" : "No simulator added",
                        detail: simulatorSummary,
                        check: sessionStore.simulatorCheck
                    )

                    Button {
                        Task { await sessionStore.refreshConnectionChecks() }
                    } label: {
                        Label("Check Connection", systemImage: "arrow.clockwise")
                    }
                } footer: {
                    Text("Only needed for live Simulator preview. iPhone build installs work without this connection.")
                }

                Section {
                    ConnectionRequirementRow(
                        icon: "lock.shield.fill",
                        tint: .blue,
                        title: "1. Private Network",
                        detail: "Connect the Mac and iPhone to the same Tailscale Tailnet.",
                        check: sessionStore.tailscaleCheck
                    )
                    ConnectionRequirementRow(
                        icon: "server.rack",
                        tint: .blue,
                        title: "2. Mac Helper",
                        detail: helperRequirementDetail,
                        check: sessionStore.macHelperCheck
                    )
                    ConnectionRequirementRow(
                        icon: "play.rectangle.on.rectangle.fill",
                        tint: .blue,
                        title: "3. Live Session",
                        detail: "Open the Simulator link returned by Codex.",
                        check: sessionStore.simulatorCheck
                    )
                } header: {
                    Text("Optional Simulator Setup")
                } footer: {
                    Text("On the Mac, run swift-sim setup, then tailscale serve 47217. Do not use Tailscale Funnel.")
                }

                Section("Mac Helper Access") {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(helperStatusColor)
                            .frame(width: 11, height: 11)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(sessionStore.helperStatus.title)
                                .font(.headline)
                            Text(sessionStore.helperStatus.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if let mac = sessionStore.pairedMac {
                        Label(mac.displayName, systemImage: "macbook")
                        Label(mac.hostDisplayName, systemImage: "network")

                        Button {
                            Task { await sessionStore.refreshHelperStatus() }
                        } label: {
                            Label("Test Mac Helper", systemImage: "wave.3.right")
                        }

                        Button(role: .destructive) {
                            sessionStore.forgetPairedMac()
                        } label: {
                            Label("Forget Mac Helper", systemImage: "xmark.circle")
                        }
                    } else {
                        Text("Open a pairing link from Codex to add Mac status and connection diagnostics.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("About") {
                    Link(destination: URL(string: "https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/PRIVACY.md")!) {
                        Label("Privacy Policy", systemImage: "hand.raised.fill")
                    }
                    Link(destination: URL(string: "https://github.com/Miguelosaurus/Swift-Sim/blob/main/docs/SETUP.md")!) {
                        Label("Setup & Support", systemImage: "questionmark.circle.fill")
                    }
                }
            }
            .navigationTitle("Simulator Preview")
            .navigationBarTitleDisplayMode(.inline)
            .task {
                await sessionStore.refreshConnectionChecks()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var hasSavedSimulator: Bool {
        !sessionStore.recentSessions.isEmpty
    }

    private var simulatorSummary: String {
        let count = sessionStore.recentSessions.count
        guard count > 0 else { return "Open a session link from Codex to add your first simulator." }
        return count == 1 ? "1 recent project is ready to open." : "\(count) recent projects are ready to open."
    }

    private var helperRequirementDetail: String {
        if let mac = sessionStore.pairedMac {
            return "\(mac.displayName) must be running Swift Sim with Tailscale Serve on port 47217."
        }
        return "Run Swift Sim on the Mac and privately expose port 47217 with Tailscale Serve."
    }

    private var helperStatusColor: Color {
        switch sessionStore.helperStatus {
        case .notPaired: .gray
        case .checking: .yellow
        case .online: .green
        case .offline: .red
        }
    }
}

private struct ConnectionRequirementRow: View {
    let icon: String
    let tint: Color
    let title: String
    let detail: String
    let check: ConnectionCheck

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(title)
                        .font(.headline)
                    Spacer(minLength: 8)
                    ConnectionStatusLight(check: check)
                }
                Text(detail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(check.detail)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(check.state == .issue ? .red : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct ConnectionStatusLight: View {
    let check: ConnectionCheck

    var body: some View {
        Group {
            if check.state == .checking {
                ProgressView()
                    .controlSize(.small)
            } else {
                Circle()
                    .fill(color)
                    .overlay {
                        Circle().stroke(.white.opacity(0.7), lineWidth: 1)
                    }
            }
        }
        .frame(width: 12, height: 12)
        .accessibilityLabel(accessibilityLabel)
    }

    private var color: Color {
        switch check.state {
        case .notConfigured: .gray
        case .checking: .yellow
        case .ready: .green
        case .issue: .red
        }
    }

    private var accessibilityLabel: String {
        switch check.state {
        case .notConfigured: "Not configured"
        case .checking: "Checking"
        case .ready: "Ready"
        case .issue: "Needs attention"
        }
    }
}

private struct HomeCanvas: View {
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

private extension View {
    @ViewBuilder
    func liquidGlassPanel(cornerRadius: CGFloat, tint: Color, interactive: Bool) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if #available(iOS 26, *) {
            self
                .background(.clear, in: shape)
                .glassEffect(interactive ? .regular.tint(tint).interactive() : .regular.tint(tint), in: shape)
        } else {
            self
                .background(.ultraThinMaterial, in: shape)
                .overlay {
                    shape.stroke(.white.opacity(0.24), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.06), radius: 22, x: 0, y: 12)
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
