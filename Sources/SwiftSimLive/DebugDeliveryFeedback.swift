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
                try? await Task.sleep(for: .seconds(current.phase == .refreshed ? 3.1 : 5))
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

/// One clock owns both the final perimeter contact and the first wave frame.
/// Confirmation comes only from the admitted native feedback, never this clock.
struct SwiftSimReloadChoreography {
    static let entranceDuration = 1.05
    static let waitingReveal = 0.93
    static let closingDuration = 0.24
    static let waveDuration = 1.35

    struct Frame {
        let reveal: CGFloat
        let waveProgress: CGFloat
        let waveStarted: Bool
        let finished: Bool
        let auraOpacity: Double
    }

    static func frame(elapsed: Double, confirmedAt: Double?) -> Frame {
        let elapsed = max(0, elapsed)
        let pending = waitingReveal * ease(min(1, elapsed / entranceDuration))
        guard let confirmation = confirmedAt, confirmation.isFinite,
              confirmation >= 0, elapsed >= confirmation else {
            return Frame(reveal: pending, waveProgress: 0, waveStarted: false,
                finished: false, auraOpacity: min(1, elapsed / 0.2))
        }
        let before = waitingReveal * ease(min(1, confirmation / entranceDuration))
        let closing = max(closingDuration, entranceDuration - confirmation)
        let contact = confirmation + closing
        if elapsed < contact {
            let fraction = ease((elapsed - confirmation) / closing)
            return Frame(reveal: min(1.0.nextDown, before + (1 - before) * fraction), waveProgress: 0,
                waveStarted: false, finished: false, auraOpacity: 1)
        }
        let progress = min(1, (elapsed - contact) / waveDuration)
        return Frame(reveal: 1, waveProgress: progress, waveStarted: true,
            finished: progress >= 1, auraOpacity: max(0, 1 - progress * 2))
    }

    private static func ease(_ value: Double) -> Double {
        let value = max(0, min(1, value))
        return value * value * (3 - 2 * value)
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

/// Clips the glow at its actual perimeter position. Rounded stroke end caps
/// and blur would otherwise bridge the waiting gap before it really closes.
struct SwiftSimReloadReveal: Shape {
    var progress: CGFloat
    let cornerRadius: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        guard progress > 0 else { return Path() }
        guard progress < 1 else { return Path(rect) }
        var path = SwiftSimReloadPerimeter(cornerRadius: cornerRadius)
            .path(in: rect).trimmedPath(from: 0, to: progress)
        path.addLine(to: CGPoint(x: rect.midX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY))
        path.closeSubpath()
        return path
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
            SwiftSimReloadReveal(progress: reveal, cornerRadius: cornerRadius).fill(.white)
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

/// A growing live glass surface, masked inside its bevel to hide the hard rim.
/// The backdrop stays live and includes UIKit, without filtering the host view.
struct SwiftSimReloadLens: Shape {
    var progress: CGFloat
    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let travel = hypot(rect.width / 2, rect.height) + 28
        let radius = 12 + max(0, min(progress, 1)) * travel
        let circle = CGRect(x: rect.midX - radius, y: 5 - radius, width: radius * 2, height: radius * 2)
        return Path(ellipseIn: circle)
    }
}

struct SwiftSimReloadLiquidWave: View {
    let progress: CGFloat
    let reduceTransparency: Bool

    var body: some View {
        GeometryReader { geometry in
            let travel = hypot(geometry.size.width / 2, geometry.size.height) + 28
            let radius = 12 + progress * travel
            let width = min(110, max(28, radius * 0.55))
            let origin = UnitPoint(x: 0.5, y: 5 / max(1, geometry.size.height))
            let lens = SwiftSimReloadLens(progress: progress)
            Group {
                if reduceTransparency {
                    lens.fill(Color.teal.opacity(0.08))
                } else if #available(iOS 26, macOS 26, *) {
                    Color.clear.glassEffect(.clear, in: lens)
                } else {
                    lens.fill(.ultraThinMaterial)
                }
            }
            .mask {
                RadialGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .white.opacity(0.1), location: 0.2),
                    .init(color: .white.opacity(0.8), location: 0.65),
                    .init(color: .white, location: 0.83),
                    .init(color: .clear, location: 1),
                ], center: origin, startRadius: max(0, radius - width), endRadius: radius)
            }
            .opacity(pow(sin(Double(progress) * .pi), 0.45))
        }
    }
}

struct SwiftSimDeliveryFeedbackEffect: View {
    let state: SwiftSimDeliveryFeedbackState
    var onFinished: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @State private var startedAt = Date()
    @State private var confirmedAt: Date?
    @State private var animationFinished = false
    private var animationKey: String { "\(state.sequence)-\(reduceMotion)-\(scenePhase == .active)" }

    var body: some View {
        GeometryReader { safeGeometry in
            TimelineView(.animation(minimumInterval: state.phase == .refreshed ? 1.0 / 60 : 1.0 / 30,
              paused: reduceMotion || state.phase == .failed || scenePhase != .active || animationFinished)) { timeline in
                GeometryReader { geometry in
                    let frame = SwiftSimReloadChoreography.frame(elapsed: timeline.date.timeIntervalSince(startedAt),
                        confirmedAt: confirmedAt.map { $0.timeIntervalSince(startedAt) })
                    #if os(iOS)
                    let corner: CGFloat = UIDevice.current.userInterfaceIdiom == .phone ? 55 : 24
                    #else
                    let corner: CGFloat = 22
                    #endif
                    ZStack(alignment: .top) {
                        SwiftSimReloadAura(reveal: reduceMotion || state.phase == .failed ? 1 : frame.reveal,
                            cornerRadius: corner, failed: state.phase == .failed,
                            reduceMotion: reduceMotion, reduceTransparency: reduceTransparency,
                            active: scenePhase == .active && frame.auraOpacity > 0)
                            .opacity(reduceMotion || state.phase == .failed ? 1 : frame.auraOpacity)
                        if state.phase == .refreshed && frame.waveStarted && !frame.finished && !reduceMotion {
                            SwiftSimReloadLiquidWave(progress: frame.waveProgress, reduceTransparency: reduceTransparency)
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
                    .onChange(of: frame.finished) { finished in
                        if finished {
                            animationFinished = true
                            onFinished()
                        }
                    }
                }
                .ignoresSafeArea()
            }
        }
        .transaction { $0.animation = nil }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .opacity(scenePhase == .active ? 1 : 0)
        .task(id: animationKey) {
            if state.phase == .refreshed && confirmedAt == nil { confirmedAt = Date() }
        }
    }
}
#endif
