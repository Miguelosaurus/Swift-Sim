import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        ZStack {
            HomeCanvas()

            if let session = sessionStore.currentSession {
                SimulatorSessionView(session: session)
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
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Swift Sim")
                    .font(.system(size: 34, weight: .bold, design: .rounded))
                Text("Remote simulator sessions")
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
                Text("Paired Mac")
                    .font(.headline.weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 7) {
                    Circle()
                        .fill(.green)
                        .frame(width: 8, height: 8)
                    Text("Tailscale private access ready")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            Button {
                showingMacSettings = true
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 44, height: 44)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: .white.opacity(0.2), interactive: true)
            .accessibilityLabel("Mac settings")
        }
        .padding(14)
        .liquidGlassPanel(cornerRadius: 30, tint: Color.white.opacity(0.18), interactive: false)
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
                        Button {
                            sessionStore.reopen(recent)
                        } label: {
                            SessionRow(recent: recent)
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

                TextField("Find a session", text: $searchText)
                    .font(.body.weight(.medium))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 16)
            .frame(height: 58)
            .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

            Button {
                Task { await sessionStore.refresh() }
            } label: {
                Label("Scan", systemImage: "dot.radiowaves.left.and.right")
                    .labelStyle(.iconOnly)
                    .font(.system(size: 22, weight: .semibold))
                    .frame(width: 58, height: 58)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color.blue.opacity(0.16), interactive: true)
            .accessibilityLabel("Scan for sessions")
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

    var body: some View {
        NavigationStack {
            List {
                Section("Mac") {
                    Label("Paired Mac", systemImage: "macbook")
                    Label("Tailscale private access", systemImage: "lock.shield")
                    Label("Xcode Simulator runtime", systemImage: "iphone.gen3")
                }
            }
            .navigationTitle("Mac Helper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
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
