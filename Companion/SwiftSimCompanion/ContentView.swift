import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var sessionStore: SessionStore

    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

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

    private var filteredSessions: [RecentSession] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sessionStore.recentSessions }
        return sessionStore.recentSessions.filter {
            $0.displayName.localizedCaseInsensitiveContains(query)
                || $0.hostDisplayName.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 30) {
                topBar
                projectGrid
                Spacer(minLength: 280)
            }
            .padding(.horizontal, 28)
            .padding(.top, 28)
            .padding(.bottom, 118)
        }
        .background(Color(.systemBackground).ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            bottomDock
        }
    }

    private var topBar: some View {
        HStack(alignment: .center) {
            RoundIconButton(systemImage: "macbook", accessibilityLabel: "Mac helper")

            Spacer()

            VStack(spacing: 2) {
                Text("Swift Sim")
                    .font(.title2.weight(.bold))
                Text("Remote Simulator")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Button {
                Task { await sessionStore.refresh() }
            } label: {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(.primary)
                    .frame(width: 72, height: 72)
                    .background(.ultraThinMaterial, in: Circle())
                    .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 14)
            }
            .accessibilityLabel("Refresh sessions")
        }
    }

    private var projectGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 164, maximum: 190), spacing: 18, alignment: .leading)],
            alignment: .leading,
            spacing: 18
        ) {
            if filteredSessions.isEmpty {
                EmptyProjectTile()
            } else {
                ForEach(filteredSessions) { recent in
                    Button {
                        sessionStore.reopen(recent)
                    } label: {
                        ProjectTile(recent: recent)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var bottomDock: some View {
        HStack(spacing: 16) {
            HStack(spacing: 13) {
                Image(systemName: "magnifyingglass")
                    .font(.title2.weight(.medium))
                    .foregroundStyle(.primary)

                TextField("Search Projects", text: $searchText)
                    .font(.title3.weight(.medium))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            .padding(.horizontal, 22)
            .frame(height: 70)
            .background(Color(.systemBackground), in: Capsule())
            .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 14)

            Button {
                Task { await sessionStore.refresh() }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 31, weight: .regular))
                    .foregroundStyle(.primary)
                    .frame(width: 72, height: 72)
                    .background(Color(.systemBackground), in: Circle())
                    .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 14)
            }
            .accessibilityLabel("Add simulator session")
        }
        .padding(.horizontal, 28)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .background {
            LinearGradient(
                colors: [
                    Color(.systemBackground).opacity(0),
                    Color(.systemBackground),
                    Color(.systemBackground)
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
        }
    }
}

private struct RoundIconButton: View {
    let systemImage: String
    let accessibilityLabel: String

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 28, weight: .medium))
            .foregroundStyle(.primary)
            .frame(width: 72, height: 72)
            .background(.ultraThinMaterial, in: Circle())
            .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 14)
            .accessibilityLabel(accessibilityLabel)
    }
}

private struct ProjectTile: View {
    let recent: RecentSession

    var body: some View {
        VStack(spacing: 15) {
            AppIconBadge(text: recent.initials, active: true)

            VStack(spacing: 4) {
                Text(recent.displayName)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)

                Label("iPhone", systemImage: "iphone")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 190)
        .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private struct EmptyProjectTile: View {
    var body: some View {
        VStack(spacing: 15) {
            AppIconBadge(text: nil, active: false)

            VStack(spacing: 4) {
                Text("No Projects")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.primary)

                Text("Open from Codex")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 190)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }
}

private struct AppIconBadge: View {
    let text: String?
    let active: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.blue.gradient)
                .frame(width: 94, height: 94)
                .shadow(color: .blue.opacity(0.22), radius: 20, x: 0, y: 12)

            if let text {
                Text(text)
                    .font(.system(size: 30, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
            } else {
                Image(systemName: "star.fill")
                    .font(.system(size: 44, weight: .bold))
                    .foregroundStyle(.white)
            }
        }
        .opacity(active ? 1 : 0.78)
    }
}
