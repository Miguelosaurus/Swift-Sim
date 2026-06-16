import SwiftUI

struct SimulatorSessionView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let session: SimulatorSession
    @State private var showingLogs = false

    var body: some View {
        VStack(spacing: 0) {
            statusBar
            SimulatorWebView(url: session.webURL)
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            controlBar
        }
        .background(Color(.systemBackground))
        .task {
            await sessionStore.refresh()
        }
        .sheet(isPresented: $showingLogs) {
            LogsView(logs: sessionStore.logs)
        }
    }

    private var statusBar: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(sessionStore.isConnected ? Color.green : Color.orange)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(sessionStore.isConnected ? "Live Simulator" : "Reconnecting")
                    .font(.subheadline.bold())
                Text(session.id)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            Button {
                Task { await sessionStore.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.bordered)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color(.secondarySystemBackground))
    }

    private var controlBar: some View {
        HStack(spacing: 12) {
            Button {
                Task { await sessionStore.sendControl("home") }
            } label: {
                Label("Home", systemImage: "circle")
            }

            Button {
                Task { await sessionStore.sendControl("rotate") }
            } label: {
                Label("Rotate", systemImage: "rotate.right")
            }

            Button {
                showingLogs = true
            } label: {
                Label("Logs", systemImage: "doc.text")
            }
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderedProminent)
        .padding()
        .background(.thinMaterial)
    }
}

private struct LogsView: View {
    let logs: [String]

    var body: some View {
        NavigationStack {
            ScrollView {
                Text(logs.isEmpty ? "No logs yet." : logs.joined(separator: "\n"))
                    .font(.system(.footnote, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }
            .navigationTitle("Session Logs")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
