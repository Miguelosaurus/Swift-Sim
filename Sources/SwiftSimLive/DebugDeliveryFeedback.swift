#if DEBUG
import Combine
import Foundation
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Presentation consumes native lifecycle evidence. It never produces a
/// receipt, advances the host revision, or infers success from elapsed time.
struct SwiftSimDeliveryFeedbackState: Equatable {
    enum Phase: String {
        case receiving, applying
        case waitingForRefresh = "waiting-for-refresh"
        case refreshed, failed

        var rank: Int {
            switch self {
            case .receiving: 0
            case .applying: 1
            case .waitingForRefresh: 2
            case .refreshed, .failed: 3
            }
        }
        var title: String {
            switch self {
            case .receiving: "Receiving update"
            case .applying: "Applying update"
            case .waitingForRefresh: "Waiting for refresh"
            case .refreshed: "Updated"
            case .failed: "Update not confirmed"
            }
        }
        var symbol: String {
            switch self {
            case .receiving: "arrow.down.circle"
            case .applying, .waitingForRefresh: "arrow.triangle.2.circlepath"
            case .refreshed: "checkmark.circle.fill"
            case .failed: "exclamationmark.circle"
            }
        }
    }

    let requestID: String
    let patchDigest: String
    let baselineRevision: Int
    let sequence: Int
    let phase: Phase
    let revision: Int?
}

struct SwiftSimDeliveryFeedbackReducer {
    private(set) var current: SwiftSimDeliveryFeedbackState?
    private var highestSequence = 0

    mutating func consume(_ info: [AnyHashable: Any]) -> Bool {
        guard info["schema_version"] as? Int == 1,
              let requestID = info["request_id"] as? String,
              UUID(uuidString: requestID) != nil,
              let digest = info["patch_digest"] as? String,
              digest.count == 64, digest.allSatisfy({ $0.isHexDigit && !$0.isUppercase }),
              let baseline = info["baseline_revision"] as? Int, baseline >= 0,
              let sequence = info["sequence"] as? Int, sequence > highestSequence,
              let rawPhase = info["phase"] as? String,
              let phase = SwiftSimDeliveryFeedbackState.Phase(rawValue: rawPhase) else { return false }
        if phase == .receiving {
            if current?.requestID == requestID { return false }
        } else {
            guard let current, current.requestID == requestID,
                  current.patchDigest == digest, current.baselineRevision == baseline,
                  current.phase.rank < 3, phase.rank >= current.phase.rank else { return false }
        }
        let revision = info["revision"] as? Int
        if phase == .refreshed {
            guard info["applied"] as? Bool == true,
                  let replacements = info["dynamic_replacements"] as? Int, replacements > 0,
                  info["refresh_acknowledged"] as? Bool == true,
                  let revision, revision > baseline else { return false }
        }
        highestSequence = sequence
        current = SwiftSimDeliveryFeedbackState(requestID: requestID, patchDigest: digest,
            baselineRevision: baseline, sequence: sequence, phase: phase, revision: revision)
        return true
    }
}

@MainActor
final class SwiftSimDeliveryFeedbackObserver: ObservableObject {
    static let shared = SwiftSimDeliveryFeedbackObserver()
    @Published private(set) var presentation: SwiftSimDeliveryFeedbackState?
    private(set) var reducer = SwiftSimDeliveryFeedbackReducer()
    private var subscription: AnyCancellable?
    private var dismissal: Task<Void, Never>?

    init(center: NotificationCenter = .default) {
        subscription = center.publisher(for: Notification.Name("SWIFT_SIM_LIVE_DELIVERY_FEEDBACK"))
            .receive(on: RunLoop.main)
            .sink { [weak self] notification in self?.receive(notification.userInfo ?? [:]) }
    }

    func receive(_ info: [AnyHashable: Any]) {
        guard reducer.consume(info), let current = reducer.current else { return }
        dismissal?.cancel()
        presentation = current
        if current.phase.rank == 3 {
            #if canImport(UIKit)
            if UIAccessibility.isVoiceOverRunning {
                UIAccessibility.post(notification: .announcement,
                    argument: current.phase == .refreshed ? "Updated by Swift Sim" : "Swift Sim update not confirmed")
            }
            #endif
            dismissal = Task { [weak self] in
                try? await Task.sleep(for: .seconds(current.phase == .refreshed ? 2.75 : 5))
                guard !Task.isCancelled else { return }
                self?.dismissPresentation(requestID: current.requestID, sequence: current.sequence)
            }
        }
    }

    func dismissPresentation(requestID: String, sequence: Int) {
        guard presentation?.requestID == requestID, presentation?.sequence == sequence else { return }
        withAnimation(.easeOut(duration: 0.2)) { presentation = nil }
    }
}

/// Starts at top center and proceeds clockwise, independent of layout direction.
struct SwiftSimReloadPerimeter: Shape {
    var cornerRadius: CGFloat = 44

    func path(in bounds: CGRect) -> Path {
        let rect = bounds
        guard rect.width > 0, rect.height > 0 else { return Path() }
        let radius = min(cornerRadius, min(rect.width, rect.height) / 2)
        return Path { path in
            path.move(to: CGPoint(x: rect.midX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
            path.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius,
                startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
            path.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.maxY - radius), radius: radius,
                startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
            path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
            path.addArc(center: CGPoint(x: rect.minX + radius, y: rect.maxY - radius), radius: radius,
                startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
            path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
            path.addArc(center: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius,
                startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
            path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        }
    }
}

/// Flowing edge light, rather than a progress-track stroke. Drawing is scoped
/// to this temporary overlay and never samples or copies the host view.
struct SwiftSimReloadAura: View {
    var reveal: CGFloat
    let cornerRadius: CGFloat
    let failed: Bool
    let reduceMotion: Bool
    let reduceTransparency: Bool
    let active: Bool
    @Environment(\.colorScheme) private var colorScheme
    @State private var startedAt = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || failed || !active)) { timeline in
            Canvas { context, size in
                let bounds = CGRect(origin: .zero, size: size)
                let path = SwiftSimReloadPerimeter(cornerRadius: cornerRadius).path(in: bounds)
                let time = reduceMotion || failed ? 0 : max(0, timeline.date.timeIntervalSince(startedAt))
                let palette = colors
                var context = context
                context.clip(to: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).path(in: bounds))
                let shading = GraphicsContext.Shading.conicGradient(
                    Gradient(colors: palette + [palette[0]]),
                    center: CGPoint(x: size.width / 2, y: size.height / 2),
                    angle: .radians(time * 0.46))
                if reduceTransparency {
                    context.stroke(path, with: shading, style: StrokeStyle(lineWidth: 7))
                } else {
                    // A broad falloff carries the light inward. Unequal moving
                    // pools vary its depth and intensity around the perimeter.
                    context.drawLayer { bloom in
                        bloom.addFilter(.blur(radius: 14))
                        bloom.opacity = colorScheme == .dark ? 0.88 : 0.6
                        bloom.stroke(path, with: shading, style: StrokeStyle(lineWidth: 28))
                        for index in 0..<4 {
                            let position = (time * 0.035 + Double(index) * 0.247)
                                .truncatingRemainder(dividingBy: 1)
                            let length = 0.11 + 0.035 * sin(time * 0.7 + Double(index) * 1.8)
                            let width = 38 + 20 * sin(time * 1.1 + Double(index) * 2.1)
                            let style = StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
                            let color = GraphicsContext.Shading.color(palette[(index + 1) % palette.count])
                            bloom.stroke(path.trimmedPath(from: position, to: min(1, position + length)),
                                with: color, style: style)
                            if position + length > 1 {
                                bloom.stroke(path.trimmedPath(from: 0, to: position + length - 1),
                                    with: color, style: style)
                            }
                        }
                    }
                    context.drawLayer { lip in
                        lip.addFilter(.blur(radius: 2.5))
                        lip.opacity = 0.9
                        lip.stroke(path, with: shading, style: StrokeStyle(lineWidth: 6))
                    }
                    context.opacity = 0.9
                    context.stroke(path, with: shading, style: StrokeStyle(lineWidth: 2))
                }
            }
        }
        .mask {
            SwiftSimReloadPerimeter(cornerRadius: cornerRadius)
                .trim(from: 0, to: reveal)
                .stroke(.white, style: StrokeStyle(lineWidth: 140, lineCap: .round, lineJoin: .round))
                .blur(radius: 12)
        }
    }

    private var colors: [Color] {
        if failed { return [.orange, .yellow, .orange, Color(red: 0.9, green: 0.3, blue: 0.05)] }
        return [
            Color(red: 0.0, green: 0.48, blue: 0.43),
            Color(red: 0.0, green: 0.88, blue: 0.72),
            Color(red: 0.61, green: 1.0, blue: 0.91),
            Color(red: 0.0, green: 0.76, blue: 0.86),
            Color(red: 0.0, green: 0.55, blue: 0.51),
            Color(red: 0.16, green: 0.95, blue: 0.69),
        ]
    }
}

/// A narrow refractive ring, rather than a blurred copy of the host content.
struct SwiftSimReloadWave: Shape {
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let travel = hypot(rect.width / 2, rect.height) + 28
        let radius = 12 + max(0, min(progress, 1)) * travel
        let circle = CGRect(x: rect.midX - radius, y: 5 - radius, width: radius * 2, height: radius * 2)
        return Path(ellipseIn: circle).strokedPath(StrokeStyle(lineWidth: 12))
    }
}

struct SwiftSimDeliveryFeedbackEffect: View {
    let state: SwiftSimDeliveryFeedbackState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @State private var outlineProgress: CGFloat = 0
    @State private var waveProgress: CGFloat = 0
    @State private var showingWave = false
    @State private var auraOpacity: Double = 0
    @State private var entranceStartedAt: Date?

    private var teal: Color { Color(red: 0.03, green: 0.77, blue: 0.66) }
    private var animationKey: String { "\(state.sequence)-\(reduceMotion)-\(scenePhase == .active)" }

    var body: some View {
        GeometryReader { safeGeometry in
            GeometryReader { geometry in
                #if os(iOS)
                let corner: CGFloat = UIDevice.current.userInterfaceIdiom == .phone ? 55 : 24
                #else
                let corner: CGFloat = 22
                #endif
                ZStack(alignment: .top) {
                    SwiftSimReloadAura(reveal: reduceMotion ? 1 : outlineProgress,
                        cornerRadius: corner, failed: state.phase == .failed,
                        reduceMotion: reduceMotion, reduceTransparency: reduceTransparency,
                        active: scenePhase == .active && auraOpacity > 0)
                        .opacity(auraOpacity)
                    // Mount at zero radius before the delayed finish animation.
                    // Inserting the wave and advancing it in one turn skips motion.
                    if state.phase == .refreshed && !reduceMotion {
                        wave
                            .opacity(showingWave ? 0.48 * (1 - Double(waveProgress)) : 0)
                    }
                    if reduceMotion || state.phase == .failed {
                        Label(state.phase.title, systemImage: state.phase.symbol)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background {
                                if reduceTransparency { Capsule().fill(.background) }
                                else { Capsule().fill(.regularMaterial) }
                            }
                            .padding(.top, safeGeometry.safeAreaInsets.top + 10)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
            }
            .ignoresSafeArea()
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .opacity(scenePhase == .active ? 1 : 0)
        .task(id: animationKey) { await animateLifecycle() }
    }

    @ViewBuilder
    private var wave: some View {
        if reduceTransparency {
            SwiftSimReloadWave(progress: waveProgress).fill(teal.opacity(0.12))
        } else if #available(iOS 26, macOS 26, *) {
            Color.clear.glassEffect(.clear.tint(teal.opacity(0.08)), in: SwiftSimReloadWave(progress: waveProgress))
        } else {
            SwiftSimReloadWave(progress: waveProgress).fill(.ultraThinMaterial)
        }
    }

    @MainActor
    private func animateLifecycle() async {
        guard !reduceMotion, scenePhase == .active else {
            showingWave = false
            auraOpacity = 1
            outlineProgress = 1
            return
        }
        if state.phase == .failed {
            showingWave = false
            auraOpacity = 1
            outlineProgress = 1
            return
        }
        if entranceStartedAt == nil {
            entranceStartedAt = Date()
            withAnimation(.easeInOut(duration: 1.05)) { outlineProgress = 1 }
            withAnimation(.easeOut(duration: 0.3)) { auraOpacity = 1 }
        }
        if state.phase == .refreshed {
            // Fast reloads finish the clockwise entrance before their ripple.
            // The moving aura can otherwise wait indefinitely for real proof.
            let remaining = max(0, 1.05 - Date().timeIntervalSince(entranceStartedAt ?? Date()))
            do { try await Task.sleep(for: .seconds(remaining)) } catch { return }
            guard !Task.isCancelled else { return }
            showingWave = true
            waveProgress = 0
            withAnimation(.easeOut(duration: 1.1)) {
                waveProgress = 1
                auraOpacity = 0
            }
        }
    }
}
#endif
