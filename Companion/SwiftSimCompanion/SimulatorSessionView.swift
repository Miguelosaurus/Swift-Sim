import SwiftUI

struct SimulatorSessionView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let session: SimulatorSession
    @State private var showingConsole = false
    @State private var showingOptions = false
    @State private var showingKeyboard = false
    @State private var keyboardText = ""

    var body: some View {
        ZStack {
            SimulatorStageBackground()

            VStack(spacing: 0) {
                topControls
                    .padding(.horizontal, 28)
                    .padding(.top, 18)

                Spacer(minLength: 22)

                simulatorFrame
                    .padding(.horizontal, 30)

                Spacer(minLength: 20)

                bottomControls
                    .padding(.bottom, 26)
            }
        }
        .task {
            await sessionStore.refresh()
        }
        .sheet(isPresented: $showingConsole) {
            ConsoleSheet(logs: sessionStore.logs) {
                Task { await sessionStore.fetchLogs() }
            }
            .presentationDetents([.fraction(0.55), .large])
            .presentationDragIndicator(.visible)
        }
        .confirmationDialog("Simulator Options", isPresented: $showingOptions, titleVisibility: .visible) {
            Button("Rotate Left") {
                Task { await sessionStore.sendControl("rotate-left") }
            }
            Button("Rotate Right") {
                Task { await sessionStore.sendControl("rotate-right") }
            }
            Button("Lock") {
                Task { await sessionStore.sendControl("lock") }
            }
            Button("Siri") {
                Task { await sessionStore.sendControl("siri") }
            }
            Button("Press Side Button") {
                Task { await sessionStore.sendControl("side-button") }
            }
            Button("Press Action Button") {
                Task { await sessionStore.sendControl("action-button") }
            }
        } message: {
            Text("Hardware and accessibility controls")
        }
        .sheet(isPresented: $showingKeyboard) {
            KeyboardSheet(text: $keyboardText) { text in
                Task { await sessionStore.typeText(text) }
            }
            .presentationDetents([.height(220)])
            .presentationDragIndicator(.visible)
        }
    }

    private var topControls: some View {
        HStack {
            Button {
                sessionStore.closeCurrentSession()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 27, weight: .semibold))
                    .frame(width: 70, height: 70)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color.white.opacity(0.22), interactive: true)
            .accessibilityLabel("Back")

            Spacer()

            HStack(spacing: 18) {
                Button {
                    Task { await sessionStore.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 26, weight: .semibold))
                        .frame(width: 42, height: 56)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh simulator")

                Button {
                    showingConsole = true
                } label: {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 25, weight: .semibold))
                        .frame(width: 42, height: 56)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Console")
            }
            .padding(.horizontal, 18)
            .frame(height: 70)
            .liquidGlassCapsule(tint: Color.white.opacity(0.22), interactive: true)
        }
        .foregroundStyle(.primary)
    }

    private var simulatorFrame: some View {
        ZStack(alignment: .topTrailing) {
            RoundedRectangle(cornerRadius: 44, style: .continuous)
                .fill(Color.white.opacity(0.54))
                .overlay {
                    RoundedRectangle(cornerRadius: 44, style: .continuous)
                        .stroke(.white.opacity(0.82), lineWidth: 1.2)
                }
                .shadow(color: .black.opacity(0.12), radius: 34, x: 0, y: 24)

            SimulatorStreamView(url: session.streamURL) { x, y in
                Task {
                    await sessionStore.tapSimulator(x: x, y: y)
                }
            }
                .background(Color.black)
                .clipShape(RoundedRectangle(cornerRadius: 38, style: .continuous))
                .padding(8)

            connectionBadge
                .padding(.top, 18)
                .padding(.trailing, 18)
        }
        .aspectRatio(0.49, contentMode: .fit)
        .frame(maxHeight: 620)
        .accessibilityElement(children: .contain)
    }

    private var connectionBadge: some View {
        Circle()
            .fill(Color.white.opacity(0.72))
            .frame(width: 50, height: 50)
            .overlay {
                Image(systemName: sessionStore.isConnected ? "antenna.radiowaves.left.and.right" : "exclamationmark.triangle")
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(sessionStore.isConnected ? .green : .orange)
            }
            .liquidGlassCircle(tint: Color.white.opacity(0.2), interactive: false)
            .accessibilityLabel(sessionStore.isConnected ? "Simulator connected" : "Simulator reconnecting")
    }

    private var bottomControls: some View {
        HStack(spacing: 24) {
            Button {
                Task { await sessionStore.sendControl("home") }
            } label: {
                Image(systemName: "house.fill")
                    .frame(width: 42, height: 52)
            }
            .accessibilityLabel("Home")

            Button {
                Task { await sessionStore.sendControl("rotate-right") }
            } label: {
                Image(systemName: "rectangle.portrait.rotate")
                    .frame(width: 42, height: 52)
            }
            .accessibilityLabel("Rotate")

            Button {
                showingKeyboard = true
            } label: {
                Image(systemName: "keyboard")
                    .frame(width: 42, height: 52)
            }
            .accessibilityLabel("Keyboard")

            Button {
                showingOptions = true
            } label: {
                Image(systemName: "ellipsis")
                    .frame(width: 42, height: 52)
            }
            .accessibilityLabel("Simulator options")
        }
        .font(.system(size: 30, weight: .semibold))
        .foregroundStyle(.primary)
        .buttonStyle(.plain)
        .padding(.horizontal, 22)
        .frame(height: 74)
        .liquidGlassCapsule(tint: Color.white.opacity(0.24), interactive: true)
    }
}

private struct KeyboardSheet: View {
    @Binding var text: String
    let send: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 18) {
            Capsule()
                .fill(.tertiary)
                .frame(width: 46, height: 5)

            HStack(spacing: 12) {
                Image(systemName: "keyboard")
                    .font(.system(size: 22, weight: .semibold))
                TextField("Type into simulator", text: $text)
                    .font(.title3.weight(.medium))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.send)
                    .onSubmit {
                        submit()
                    }
            }
            .padding(.horizontal, 18)
            .frame(height: 64)
            .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

            Button {
                submit()
            } label: {
                Label("Send Text", systemImage: "paperplane.fill")
                    .font(.headline.weight(.bold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: Color.blue.opacity(0.18), interactive: true)
            .disabled(text.isEmpty)
        }
        .padding(.horizontal, 22)
        .padding(.top, 10)
    }

    private func submit() {
        guard !text.isEmpty else { return }
        send(text)
        text = ""
        dismiss()
    }
}

private struct ConsoleSheet: View {
    let logs: [String]
    let refresh: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var filter = ""

    private var filteredLogs: [String] {
        let query = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return logs }
        return logs.filter { $0.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                HStack(spacing: 14) {
                    Button(role: .destructive) { } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 24, weight: .medium))
                            .frame(width: 58, height: 58)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCircle(tint: Color.white.opacity(0.2), interactive: true)
                    .accessibilityLabel("Clear console")

                    Spacer()

                    Text("Console")
                        .font(.title2.weight(.bold))

                    Spacer()

                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 24, weight: .semibold))
                            .frame(width: 58, height: 58)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCircle(tint: Color.white.opacity(0.2), interactive: true)
                    .accessibilityLabel("Close console")
                }

                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 22, weight: .medium))
                    TextField("Filter", text: $filter)
                        .font(.title3.weight(.medium))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(.horizontal, 18)
                .frame(height: 64)
                .liquidGlassCapsule(tint: Color.white.opacity(0.18), interactive: true)

                if filteredLogs.isEmpty {
                    Spacer()
                    VStack(spacing: 8) {
                        Text("No console output yet")
                            .font(.title3.weight(.medium))
                            .foregroundStyle(.secondary)
                        Text("Logs from the running app will appear here.")
                            .font(.callout)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer()
                } else {
                    ScrollView {
                        Text(filteredLogs.joined(separator: "\n"))
                            .font(.system(.footnote, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding(16)
                    }
                    .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.14), interactive: false)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .background(.clear)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        refresh()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                }
            }
        }
    }
}

private struct SimulatorStageBackground: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)
            LinearGradient(
                colors: [
                    Color.white,
                    Color(.systemBackground),
                    Color.cyan.opacity(0.07)
                ],
                startPoint: .top,
                endPoint: .bottom
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
                .shadow(color: .black.opacity(0.08), radius: 24, x: 0, y: 12)
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
                .shadow(color: .black.opacity(0.08), radius: 22, x: 0, y: 12)
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
                .shadow(color: .black.opacity(0.08), radius: 22, x: 0, y: 12)
        }
    }
}
