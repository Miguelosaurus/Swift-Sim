import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        NavigationStack {
            Group {
                if let session = sessionStore.currentSession {
                    SimulatorSessionView(session: session)
                } else {
                    HomeView()
                }
            }
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct HomeView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                recentProjects
                connectionPanel
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 28)
        }
        .background(HomeBackground())
        .navigationTitle("Swift Sim")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await sessionStore.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(.blue.gradient)
                    Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white)
                }
                .frame(width: 58, height: 58)
                .shadow(color: .blue.opacity(0.28), radius: 18, x: 0, y: 10)

                VStack(alignment: .leading, spacing: 4) {
                    Text("Swift Sim")
                        .font(.system(.largeTitle, design: .rounded, weight: .bold))
                    Text("Remote Simulator companion")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }

            HStack(spacing: 10) {
                StatusPill(title: "Mac", value: "Ready", systemImage: "macbook")
                StatusPill(title: "Phone", value: "Companion", systemImage: "iphone")
            }
        }
    }

    private var recentProjects: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Recent Projects", count: sessionStore.recentSessions.count)

            if sessionStore.recentSessions.isEmpty {
                EmptyProjectsCard()
            } else {
                VStack(spacing: 10) {
                    ForEach(sessionStore.recentSessions) { recent in
                        Button {
                            sessionStore.reopen(recent)
                        } label: {
                            RecentProjectRow(recent: recent)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var connectionPanel: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(title: "Connection", count: nil)

            VStack(spacing: 0) {
                ConnectionRow(title: "Helper", value: "Local Mac", systemImage: "server.rack")
                Divider().padding(.leading, 44)
                ConnectionRow(title: "Remote Access", value: "Tailscale", systemImage: "lock.shield")
                Divider().padding(.leading, 44)
                ConnectionRow(title: "Runtime", value: "Xcode Simulator", systemImage: "play.rectangle.on.rectangle")
            }
            .padding(14)
            .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.quaternary, lineWidth: 1)
            }
        }
    }
}

private struct SectionHeader: View {
    let title: String
    let count: Int?

    var body: some View {
        HStack {
            Text(title)
                .font(.headline)
            Spacer()
            if let count {
                Text("\(count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}

private struct StatusPill: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: systemImage)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.blue)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.caption.weight(.semibold))
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(.background.opacity(0.82), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
    }
}

private struct EmptyProjectsCard: View {
    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(.blue.opacity(0.14))
                Image(systemName: "link.badge.plus")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.blue)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 4) {
                Text("No recent sessions")
                    .font(.subheadline.bold())
                Text("Open a Codex simulator link to pin it here.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            Spacer()
        }
        .padding(16)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
    }
}

private struct RecentProjectRow: View {
    let recent: RecentSession

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.blue.opacity(0.14))
                Text(recent.initials)
                    .font(.subheadline.bold())
                    .foregroundStyle(.blue)
            }
            .frame(width: 46, height: 46)

            VStack(alignment: .leading, spacing: 4) {
                Text(recent.displayName)
                    .font(.subheadline.bold())
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(recent.hostDisplayName)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption.weight(.bold))
                .foregroundStyle(.tertiary)
        }
        .padding(14)
        .background(.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.quaternary, lineWidth: 1)
        }
    }
}

private struct ConnectionRow: View {
    let title: String
    let value: String
    let systemImage: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(.blue)
                .frame(width: 32, height: 32)
                .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            Text(title)
                .font(.subheadline.weight(.medium))

            Spacer()

            Text(value)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 10)
    }
}

private struct HomeBackground: View {
    var body: some View {
        LinearGradient(
            colors: [
                Color(.systemGroupedBackground),
                Color(.secondarySystemGroupedBackground)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}
