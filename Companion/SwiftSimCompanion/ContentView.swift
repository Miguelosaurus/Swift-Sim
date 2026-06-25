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
            } else {
                HomeView()
            }
        }
    }
}

private struct HomeView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var searchText = ""
    @State private var showingMacSettings = false
    @State private var showingPasteLink = false

    private var filteredSessions: [RecentSession] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessionStore.recentSessions }
        return sessionStore.recentSessions.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
                || $0.hostDisplayName.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    macStatusPanel
                    deviceBuildBoard
                    sessionBoard
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
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Swift Sim")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Text("Simulator preview and iPhone installs")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                Task { await sessionStore.refresh() }
            } label: {
                Image(systemName: "arrow.trianglehead.clockwise")
                    .font(.system(size: 23, weight: .semibold))
                    .frame(width: 54, height: 54)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.3), interactive: true)
            .accessibilityLabel("Refresh sessions")
        }
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
        sessionStore.recentSessions.isEmpty ? "Set Up Simulator" : "Simulator Paired"
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
                Text("Recent Projects")
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
                Text("Device Builds")
                    .font(.title3.weight(.bold))
                Spacer()
                Text("\(sessionStore.recentDeviceBuilds.count)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .liquidGlassCapsule(tint: .white.opacity(0.24), interactive: false)
            }

            if sessionStore.recentDeviceBuilds.isEmpty {
                EmptyDeviceBuildCard()
            } else {
                VStack(spacing: 12) {
                    ForEach(sessionStore.recentDeviceBuilds) { build in
                        SwipeToDeleteRow {
                            DeviceBuildRow(build: build)
                        } onOpen: {
                            sessionStore.reopen(build)
                        } onDelete: {
                            withAnimation {
                                sessionStore.removeRecentDeviceBuild(build)
                            }
                        }
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

                TextField("Find a session", text: $searchText)
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
            .accessibilityLabel("Paste simulator link")
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

private struct PasteLinkSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var sessionStore: SessionStore
    @State private var linkText = ""
    @State private var errorText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Text("Open Session")
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

            Text("Use this if ChatGPT opens a simulator, build, or setup page in a browser instead of switching apps.")
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
                sessionStore.closeCurrentSession()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 25, weight: .bold))
                    .frame(width: 56, height: 56)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.24), interactive: true)

            Spacer()

            VStack(spacing: 3) {
                Text("Device Build")
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
                Text(status?.app.name.isEmpty == false ? status!.app.name : "iPhone Build")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                    .lineLimit(2)
                Text(status?.app.bundleIdentifier.isEmpty == false ? status!.app.bundleIdentifier : "Waiting for signing details")
                    .font(.callout.weight(.medium))
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }

            HStack(spacing: 10) {
                BuildFactChip(title: "Signing", value: status?.signing.method.capitalized ?? "Checking")
                BuildFactChip(title: "Data", value: status?.preserveData == false ? "Replace" : "Preserve")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .liquidGlassPanel(cornerRadius: 34, tint: Color.white.opacity(0.18), interactive: false)
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
                if let installURL = statusInstallURL ?? build.installURL {
                    openURL(installURL)
                } else {
                    openURL(build.installPageURL)
                }
            } label: {
                Label(status?.isReady == true ? "Install on iPhone" : "Build Not Ready", systemImage: "iphone.and.arrow.forward")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 58)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: status?.isReady == true ? Color.blue.opacity(0.2) : Color.gray.opacity(0.12), interactive: status?.isReady == true)
            .disabled(status?.isReady != true)

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
        let name = status?.app.name ?? "iPhone Build"
        let letters = name.split(separator: " ").prefix(2).compactMap(\.first)
        let text = String(letters).uppercased()
        return text.isEmpty ? "IB" : text
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

private struct DeviceBuildRow: View {
    let build: RecentDeviceBuild

    var body: some View {
        HStack(spacing: 14) {
            AppBadge(text: initials, isEmpty: false)

            VStack(alignment: .leading, spacing: 5) {
                Text(build.displayName)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Label(build.state.capitalized, systemImage: "iphone.and.arrow.forward")
                    if !build.bundleIdentifier.isEmpty {
                        Text(build.bundleIdentifier)
                            .lineLimit(1)
                    }
                }
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
            }

            Spacer()

            Image(systemName: build.state == "ready" ? "arrow.down.circle.fill" : "clock.fill")
                .font(.system(size: 31, weight: .semibold))
                .foregroundStyle(build.state == "ready" ? .blue : .secondary)
        }
        .padding(14)
        .liquidGlassPanel(cornerRadius: 26, tint: Color.white.opacity(0.18), interactive: true)
    }

    private var initials: String {
        let pieces = build.displayName.split(separator: " ")
        let letters = pieces.prefix(2).compactMap { $0.first }
        let result = String(letters).uppercased()
        return result.isEmpty ? "IB" : result
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
            AppBadge(text: nil, isEmpty: true)

            VStack(alignment: .leading, spacing: 6) {
                Text("No simulator sessions yet")
                    .font(.title3.weight(.bold))
                Text("Run the Codex companion skill and this board will fill with live Mac Simulator sessions.")
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
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            AppBadge(text: nil, isEmpty: true)

            VStack(alignment: .leading, spacing: 6) {
                Text("No iPhone builds yet")
                    .font(.title3.weight(.bold))
                Text("Ask Codex to build to your phone. Swift Sim will install updates over the existing app when signing and bundle ID stay the same.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .liquidGlassPanel(cornerRadius: 30, tint: Color.blue.opacity(0.08), interactive: false)
    }
}

private struct AppBadge: View {
    let text: String?
    let isEmpty: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 21, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: isEmpty ? [Color.gray.opacity(0.55), Color.gray.opacity(0.28)] : [Color.blue, Color.indigo],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if let text {
                Text(text)
                    .font(.system(size: 23, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: "terminal.fill")
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
                    Text("A saved simulator session can be reopened directly. Mac helper linking is a separate setup tool and is not required to open recent projects.")
                }

                Section {
                    ConnectionRequirementRow(
                        icon: "sparkles.rectangle.stack.fill",
                        tint: .blue,
                        title: "1. Codex + plugin",
                        detail: "Install the bundled Swift Sim companion plugin in the Codex desktop app on the Mac.",
                        check: .notConfigured("Required on the Mac")
                    )
                    ConnectionRequirementRow(
                        icon: "lock.shield.fill",
                        tint: .blue,
                        title: "2. Tailscale",
                        detail: "The Mac and iPhone must be signed in to the same Tailnet. They do not need to share Wi-Fi.",
                        check: sessionStore.tailscaleCheck
                    )
                    ConnectionRequirementRow(
                        icon: "server.rack",
                        tint: .blue,
                        title: "3. Mac helper",
                        detail: helperRequirementDetail,
                        check: sessionStore.macHelperCheck
                    )
                    ConnectionRequirementRow(
                        icon: "play.rectangle.on.rectangle.fill",
                        tint: .blue,
                        title: "4. Simulator session",
                        detail: "Ask Codex to build and launch the app, then use the plugin to send this iPhone a private simulator session link.",
                        check: sessionStore.simulatorCheck
                    )
                } header: {
                    Text("What Swift Sim Needs")
                } footer: {
                    Text("Tailscale Serve exposes only the local helper over private HTTPS. Do not use Tailscale Funnel.")
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
                        Text("Optional: open a Mac helper link to enable connection diagnostics. Your saved simulator sessions remain available without it.")
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
            .navigationTitle("Simulator Connection")
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
            return "The helper is linked to \(mac.displayName) and must be running with Tailscale Serve on port 47217."
        }
        return "The helper must be running on the Mac, with Tailscale Serve privately exposing port 47217."
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
