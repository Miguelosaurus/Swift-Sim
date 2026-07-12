import SwiftUI

struct SimulatorSessionView: View {
    @EnvironmentObject private var sessionStore: SessionStore
    let session: SimulatorSession
    @State private var showingConsole = false
    @State private var showingOptions = false
    @State private var showingKeyboard = false
    @State private var streamFrameSize: CGSize?
    @State private var streamRenderState: StreamRenderState = .connecting
    @State private var streamRefreshID = 0

    var body: some View {
        ZStack {
            SimulatorStageBackground()

            VStack(spacing: 0) {
                topControls
                    .padding(.horizontal, 18)
                    .padding(.top, 4)

                Spacer(minLength: 10)

                simulatorSurface
                    .padding(.horizontal, 18)

                Spacer(minLength: 10)

                bottomControls
                    .padding(.bottom, 4)
            }
        }
        .preferredColorScheme(.light)
        .task {
            await sessionStore.refresh()
        }
        .sheet(isPresented: $showingConsole) {
            ConsoleSheet(logs: sessionStore.logs) {
                Task { await sessionStore.fetchLogs() }
            }
            .presentationDetents([.fraction(0.55), .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(42)
        }
        .sheet(isPresented: $showingOptions) {
            SimulatorOptionsSheet { control in
                Task { await sessionStore.sendControl(control) }
            }
            .presentationDetents([.height(680), .large])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(42)
        }
        .sheet(isPresented: $showingKeyboard) {
            LiveKeyboardSheet(
                type: sessionStore.typeText,
                key: sessionStore.sendKey
            )
            .presentationDetents([.height(150)])
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(36)
        }
    }

    private var topControls: some View {
        HStack(alignment: .center, spacing: 12) {
            Button {
                sessionStore.closeCurrentSession()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .semibold))
                    .frame(width: 46, height: 46)
            }
            .buttonStyle(.plain)
            .liquidGlassCircle(tint: Color(.systemBackground).opacity(0.24), interactive: true)
            .accessibilityLabel("Back")

            Spacer(minLength: 4)

            VStack(spacing: 4) {
                Text("Live Simulator")
                    .font(.subheadline.weight(.bold))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Circle()
                        .fill(sessionStore.isConnected ? .green : .orange)
                        .frame(width: 6, height: 6)
                    Text(transportSubtitle)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            .frame(minWidth: 132, maxWidth: 162)

            Spacer(minLength: 4)

            HStack(spacing: 8) {
                Button {
                    restartStream()
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 20, weight: .semibold))
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Refresh simulator")

                Button {
                    showingConsole = true
                } label: {
                    Image(systemName: "list.bullet.rectangle")
                        .font(.system(size: 19, weight: .semibold))
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Console")
            }
            .padding(.horizontal, 9)
            .frame(height: 46)
            .liquidGlassCapsule(tint: Color(.systemBackground).opacity(0.24), interactive: true)
        }
        .frame(height: 50)
        .foregroundStyle(.primary)
    }

    private var simulatorSurface: some View {
        GeometryReader { proxy in
            let maxHeight = max(420, UIScreen.main.bounds.height - 220)
            let width = min(proxy.size.width, 430, maxHeight * streamAspectRatio)
            let height = width / streamAspectRatio

            ZStack {
                simulatorStream

                switch streamRenderState {
                case .connecting:
                    ProgressView()
                        .controlSize(.large)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(Color(.secondarySystemBackground).opacity(0.26))
                case .streaming:
                    EmptyView()
                case .failed(let message):
                    VStack(spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 22, weight: .semibold))
                        Text("Preview unavailable")
                            .font(.headline.weight(.bold))
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color(.secondarySystemBackground).opacity(0.26))
                }

                if sessionStore.activeTransport?.isFallback == true, streamRenderState == .streaming {
                    VStack {
                        HStack(spacing: 6) {
                            Image(systemName: "speedometer")
                                .font(.system(size: 11, weight: .semibold))
                            Text("Limited controls")
                                .font(.caption2.weight(.semibold))
                        }
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .liquidGlassCapsule(tint: Color(.systemBackground).opacity(0.18), interactive: false)
                        .padding(.top, 10)

                        Spacer()
                    }
                }
            }
            .frame(width: width, height: height)
            .clipped()
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
            .accessibilityElement(children: .contain)
        }
        .frame(maxWidth: 430, maxHeight: 660)
    }

    private var streamURL: URL {
        session.streamURL.appending(queryItems: [.init(name: "r", value: String(streamRefreshID))])
    }

    @ViewBuilder
    private var simulatorStream: some View {
        if sessionStore.activeTransport == nil {
            Color.clear
        } else if sessionStore.activeTransport?.transport == "native-companion" {
            NativeH264StreamView(
                url: streamURL,
                maskURL: session.frameMaskURL,
                tap: handleTap,
                gesture: handleGesture,
                multiTouch: handleMultiTouch,
                frameUpdate: handleFrameUpdate,
                streamState: handleStreamState
            )
        } else {
            SimulatorStreamView(
                url: streamURL,
                maskURL: session.frameMaskURL,
                tap: handleTap,
                gesture: handleGesture,
                multiTouch: handleMultiTouch,
                frameUpdate: handleFrameUpdate,
                streamState: handleStreamState
            )
        }
    }

    private func handleTap(_ x: Double, _ y: Double) {
        Task { await sessionStore.tapSimulator(x: x, y: y) }
    }

    private func handleGesture(_ event: SimulatorGestureEvent) {
        Task { await sessionStore.sendGesture(event) }
    }

    private func handleMultiTouch(_ event: SimulatorMultiTouchEvent) {
        Task { await sessionStore.sendMultiTouch(event) }
    }

    private func handleFrameUpdate(_ size: CGSize) {
        streamFrameSize = size
    }

    private func handleStreamState(_ state: StreamRenderState) {
        streamRenderState = state
    }

    private var streamAspectRatio: CGFloat {
        guard let streamFrameSize, streamFrameSize.width > 0, streamFrameSize.height > 0 else {
            return 368.0 / 800.0
        }
        return streamFrameSize.width / streamFrameSize.height
    }

    private var transportSubtitle: String {
        guard sessionStore.isConnected else { return "Reconnecting" }
        return sessionStore.activeTransport?.displayName ?? "Connected"
    }

    private func restartStream() {
        streamFrameSize = nil
        streamRenderState = .connecting
        streamRefreshID += 1
        Task { await sessionStore.refresh() }
    }

    private func bottomControl(_ systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 20, weight: .semibold))
                .frame(width: 38, height: 44)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var bottomControls: some View {
        HStack(spacing: 12) {
            bottomControl("house.fill", label: "Home") {
                Task { await sessionStore.sendControl("home") }
            }

            bottomControl("rectangle.portrait.rotate", label: "Rotate") {
                Task { await sessionStore.sendControl("rotate-right") }
            }

            bottomControl("keyboard", label: "Keyboard") {
                showingKeyboard = true
            }

            bottomControl("ellipsis", label: "Simulator options") {
                showingOptions = true
            }
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 14)
        .frame(height: 52)
        .liquidGlassCapsule(tint: Color(.systemBackground).opacity(0.24), interactive: true)
    }
}

private struct SimulatorOptionsSheet: View {
    let send: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text("Simulator")
                        .font(.title2.weight(.bold))
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .bold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.plain)
                    .liquidGlassCircle(tint: Color.white.opacity(0.18), interactive: true)
                }

                VStack(spacing: 0) {
                    optionRow("rectangle.portrait.rotate", "Rotate Left", control: "rotate-left")
                    Divider().padding(.leading, 54)
                    optionRow("rectangle.portrait.rotate", "Rotate Right", control: "rotate-right")
                    Divider().padding(.leading, 54)
                    optionRow("exclamationmark.triangle", "Memory Warning", control: "memory-warning")
                }
                .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.16), interactive: false)

                Text("Hardware Buttons")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)

                VStack(spacing: 0) {
                    optionRow("lock", "Lock", control: "lock")
                    Divider().padding(.leading, 54)
                    optionRow("sparkles", "Siri", control: "siri")
                    Divider().padding(.leading, 54)
                    optionRow("iphone.gen3.side.left", "Press Side Button", control: "side-button")
                    Divider().padding(.leading, 54)
                    optionRow("button.programmable", "Press Action Button", control: "action-button")
                }
                .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.16), interactive: false)

                Text("Accessibility")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)

                VStack(spacing: 0) {
                    optionRow("textformat.size", "Dynamic Type Larger", control: "text-size-increment")
                    Divider().padding(.leading, 54)
                    optionRow("textformat.size.smaller", "Dynamic Type Smaller", control: "text-size-decrement")
                    Divider().padding(.leading, 54)
                    optionRow("circle.lefthalf.filled", "Toggle Increase Contrast", control: "increase-contrast")
                    Divider().padding(.leading, 54)
                    optionRow("figure.walk.motion", "Toggle Reduce Motion", control: "reduce-motion")
                    Divider().padding(.leading, 54)
                    optionRow("circle.dashed", "Toggle Reduce Transparency", control: "reduce-transparency")
                }
                .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.16), interactive: false)

                Text("Appearance")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)

                VStack(spacing: 0) {
                    optionRow("sun.max", "Light Appearance", control: "appearance-light")
                    Divider().padding(.leading, 54)
                    optionRow("moon", "Dark Appearance", control: "appearance-dark")
                    Divider().padding(.leading, 54)
                    optionRow("sparkles.rectangle.stack", "Liquid Glass Clear", control: "liquid-glass-clear")
                    Divider().padding(.leading, 54)
                    optionRow("sparkles", "Liquid Glass Tinted", control: "liquid-glass-tinted")
                }
                .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.16), interactive: false)

                Text("Debug")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)

                VStack(spacing: 0) {
                    optionRow("slowmo", "Toggle Slow Animations", control: "slow-animations")
                    Divider().padding(.leading, 54)
                    optionRow("rectangle.dashed", "Toggle View Borders", control: "show-borders")
                }
                .liquidGlassPanel(cornerRadius: 28, tint: Color.white.opacity(0.16), interactive: false)
            }
            .padding(.horizontal, 22)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
    }

    private func optionRow(_ systemName: String, _ title: String, control: String) -> some View {
        Button {
            send(control)
            dismiss()
        } label: {
            HStack(spacing: 16) {
                Image(systemName: systemName)
                    .font(.system(size: 21, weight: .medium))
                    .frame(width: 32)
                Text(title)
                    .font(.title3.weight(.medium))
                Spacer()
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .frame(height: 58)
        }
        .buttonStyle(.plain)
    }
}

private struct LiveKeyboardSheet: View {
    let type: (String) -> Void
    let key: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "keyboard")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 44, height: 44)
                .liquidGlassCircle(tint: Color.blue.opacity(0.12), interactive: false)

            VStack(alignment: .leading, spacing: 3) {
                Text("Live Keyboard")
                    .font(.headline.weight(.bold))
                Text("Typing appears right away")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            LiveKeyboardInput(type: type, key: key)
                .frame(width: 1, height: 1)
                .opacity(0.01)

            Spacer()
            Button {
                dismiss()
            } label: {
                Text("Done")
                    .font(.headline.weight(.semibold))
                    .frame(height: 44)
                    .padding(.horizontal, 18)
            }
            .buttonStyle(.plain)
            .liquidGlassCapsule(tint: Color(.systemBackground).opacity(0.2), interactive: true)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
    }
}

private struct LiveKeyboardInput: UIViewRepresentable {
    let type: (String) -> Void
    let key: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(type: type, key: key)
    }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.smartQuotesType = .no
        field.smartDashesType = .no
        field.spellCheckingType = .no
        field.returnKeyType = .default
        DispatchQueue.main.async { field.becomeFirstResponder() }
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.type = type
        context.coordinator.key = key
        if !field.isFirstResponder {
            DispatchQueue.main.async { field.becomeFirstResponder() }
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var type: (String) -> Void
        var key: (String) -> Void

        init(type: @escaping (String) -> Void, key: @escaping (String) -> Void) {
            self.type = type
            self.key = key
        }

        func textField(
            _ textField: UITextField,
            shouldChangeCharactersIn range: NSRange,
            replacementString string: String
        ) -> Bool {
            if string.isEmpty {
                key("backspace")
            } else {
                type(string)
            }
            return false
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            key("enter")
            return false
        }
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
        Color(.systemBackground)
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
