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
    private let clock: () -> TimeInterval
    private var timing = SwiftSimReloadTiming()

    var estimatedRemaining: Double {
        timing.remaining(for: presentation?.phase ?? .receiving)
    }

    init(center: NotificationCenter = .default,
         clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.clock = clock
        subscription = center.publisher(for: Notification.Name("SWIFT_SIM_LIVE_DELIVERY_FEEDBACK"))
            .receive(on: RunLoop.main)
            .sink { [weak self] notification in self?.receive(notification.userInfo ?? [:]) }
    }

    func receive(_ info: [AnyHashable: Any]) {
        guard reducer.consume(info), let current = reducer.current else { return }
        dismissal?.cancel()
        let now = clock()
        timing.consume(current.phase, at: now)
        presentation = current
        if current.phase.rank == 3 {
            // The view normally dismisses on its final displayed frame. This
            // watchdog must also allow cold renderer/capture preparation.
            let dismissalDelay = current.phase == .refreshed ? 10.0 : 5.0
            #if canImport(UIKit)
            if UIAccessibility.isVoiceOverRunning {
                UIAccessibility.post(notification: .announcement,
                    argument: current.phase == .refreshed ? "Updated by Swift Sim" : "Swift Sim update not confirmed")
            }
            #endif
            dismissal = Task { [weak self] in
                try? await Task.sleep(for: .seconds(dismissalDelay))
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

/// Three in-memory moving averages, updated only from admitted successful runs.
/// No timers, polling, disk writes, or byte-level progress tracking.
struct SwiftSimReloadTiming {
    private var estimates = [0.5, 2.5, 1.0]
    private var samples: [Double?] = [nil, nil, nil]
    private var phase: SwiftSimDeliveryFeedbackState.Phase?
    private var phaseStartedAt: TimeInterval = 0

    func remaining(for phase: SwiftSimDeliveryFeedbackState.Phase) -> Double {
        estimates.dropFirst(min(phase.rank, 3)).reduce(0, +)
    }

    @discardableResult
    mutating func consume(_ next: SwiftSimDeliveryFeedbackState.Phase, at now: TimeInterval) -> Bool {
        guard next != phase || next == .receiving else { return false }
        if next == .receiving {
            samples = [nil, nil, nil]
        } else if let phase, phase.rank < 3, next.rank == phase.rank + 1 {
            let duration = now - phaseStartedAt
            if duration.isFinite && duration >= 0.01 && duration <= 120 {
                samples[phase.rank] = duration
            }
        }
        if next == .refreshed {
            for index in estimates.indices {
                if let sample = samples[index] {
                    // One anomalous run cannot dominate the next estimate.
                    let bounded = min(estimates[index] * 4, max(estimates[index] / 4, sample))
                    estimates[index] += 0.3 * (bounded - estimates[index])
                }
            }
        }
        phase = next
        phaseStartedAt = now
        return true
    }
}

/// One monotonic clock owns estimated travel, final contact, and the wave.
/// Sparse native stage events retarget speed without jumping position/velocity.
/// Only an admitted native receipt can schedule contact at 100%.
struct SwiftSimReloadChoreography {
    private static let forecastReveal = 0.85
    static let waitingReveal = 0.97
    static let minimumSweepDuration = 1.4
    static let waveDuration = 2.1
    private static let velocityResponse = 0.25
    private let startedAt: TimeInterval
    private var segmentAt: TimeInterval = 0
    private var travel: Double = 0
    private var velocity: Double
    private var targetVelocity: Double
    private var completion: (at: Double, reveal: Double, velocity: Double, duration: Double)?

    init(startedAt: TimeInterval = 0, estimatedDuration: Double = 4) {
        self.startedAt = startedAt
        let duration = estimatedDuration.isFinite ? max(Self.minimumSweepDuration, estimatedDuration) : 4
        velocity = 1 / duration
        targetVelocity = velocity
    }

    mutating func retarget(at now: TimeInterval, estimatedRemaining: Double) {
        guard completion == nil, now >= startedAt + segmentAt,
              estimatedRemaining.isFinite, estimatedRemaining > 0 else { return }
        let elapsed = now - startedAt
        let current = motion(elapsed: elapsed)
        travel = current.travel
        velocity = current.velocity
        segmentAt = elapsed
        targetVelocity = min(1 / Self.minimumSweepDuration,
            max(0.12, 1 - travel) / max(0.15, estimatedRemaining))
    }

    mutating func confirm(at now: TimeInterval) {
        guard completion == nil, now >= startedAt + segmentAt else { return }
        let elapsed = now - startedAt
        let current = pending(elapsed: elapsed)
        let naturalFinish = min(0.6, max(0.12, (1 - current.reveal) / max(0.01, current.velocity)))
        // Native application stays immediate; only presentation has a floor.
        // Spread a fast success across the remaining sweep instead of holding
        // or flashing the whole outline, then start the wave at exact contact.
        let duration = max(naturalFinish, Self.minimumSweepDuration - elapsed)
        completion = (elapsed, current.reveal, current.velocity, duration)
    }

    var contactAt: TimeInterval? {
        completion.map { startedAt + $0.at + $0.duration }
    }

    func elapsed(at now: TimeInterval) -> Double { max(0, now - startedAt) }

    struct Frame {
        let reveal: CGFloat
        let waveProgress: CGFloat
        let waveStarted: Bool
        let finished: Bool
        let auraOpacity: Double
    }

    func frame(at now: TimeInterval) -> Frame {
        let elapsed = max(0, now - startedAt)
        guard let completion, elapsed >= completion.at else {
            return Frame(reveal: pending(elapsed: elapsed).reveal, waveProgress: 0, waveStarted: false,
                finished: false, auraOpacity: min(1, elapsed / 0.2))
        }
        // Compare boundaries in the same absolute clock as contactAt. Moving
        // through elapsed time can round the exact contact tick to either side.
        let contact = startedAt + completion.at + completion.duration
        if now < contact {
            let t = (elapsed - completion.at) / completion.duration
            let gap = 1 - completion.reveal
            // Cubic Hermite: carry current speed into completion; do not ease
            // back to zero before the wave. Bound tangents to stay monotonic.
            let initialSlope = min(3, completion.velocity * completion.duration / gap)
            let fraction = (-2 * t * t * t + 3 * t * t)
                + (t * t * t - 2 * t * t + t) * initialSlope + (t * t * t - t * t)
            return Frame(reveal: min(1.0.nextDown, completion.reveal + gap * fraction), waveProgress: 0,
                waveStarted: false, finished: false, auraOpacity: min(1, elapsed / 0.2))
        }
        let progress = now >= contact + Self.waveDuration ? 1 : max(0, (now - contact) / Self.waveDuration)
        return Frame(reveal: 1, waveProgress: progress, waveStarted: true,
            finished: progress >= 1, auraOpacity: max(0, 1 - progress * 2))
    }

    private func motion(elapsed: Double) -> (travel: Double, velocity: Double) {
        let dt = max(0, elapsed - segmentAt)
        let decay = exp(-dt / Self.velocityResponse)
        let difference = velocity - targetVelocity
        return (travel + targetVelocity * dt + difference * Self.velocityResponse * (1 - decay),
                targetVelocity + difference * decay)
    }

    private func pending(elapsed: Double) -> (reveal: Double, velocity: Double) {
        let current = motion(elapsed: elapsed)
        // Keep a completion margin in the forecast, so ordinary runs cruise
        // until their predicted receipt instead of slowing early at 80%.
        // Only overruns enter the soft boundary; time never closes the loop.
        let linear = current.travel * Self.forecastReveal
        let speed = current.velocity * Self.forecastReveal
        if linear <= Self.forecastReveal { return (linear, speed) }
        let tail = Self.waitingReveal - Self.forecastReveal
        let decay = exp(-(linear - Self.forecastReveal) / tail)
        return (min(Self.waitingReveal, Self.forecastReveal + tail * (1 - decay)), speed * decay)
    }
}

/// Presentation advances only on render-tick samples, never during cold
/// preparation. A stalled main thread cannot consume half the outline at once.
struct SwiftSimReloadVisualTimeline {
    private var choreography: SwiftSimReloadChoreography?
    private var lastWallTime: TimeInterval?
    private var sequence: Int?
    private var phase: SwiftSimDeliveryFeedbackState.Phase?
    private(set) var elapsed = 0.0

    func sampled(at now: TimeInterval, ready: Bool, state: SwiftSimDeliveryFeedbackState,
                 estimatedRemaining: Double) -> (timeline: Self, frame: SwiftSimReloadChoreography.Frame) {
        var next = self
        let delta = max(0, now - (lastWallTime ?? now))
        next.lastWallTime = now
        if ready {
            if next.choreography == nil {
                next.choreography = SwiftSimReloadChoreography(estimatedDuration: estimatedRemaining)
            } else {
                next.elapsed += min(delta, 1.0 / 15)
            }
            if next.sequence != state.sequence {
                if state.phase == .refreshed {
                    next.choreography?.confirm(at: next.elapsed)
                } else if state.phase.rank < 3 && next.phase != state.phase {
                    next.choreography?.retarget(at: next.elapsed, estimatedRemaining: estimatedRemaining)
                }
                next.sequence = state.sequence
                next.phase = state.phase
            }
        }
        let frame = next.choreography?.frame(at: next.elapsed)
            ?? SwiftSimReloadChoreography.Frame(reveal: 0, waveProgress: 0, waveStarted: false,
                finished: false, auraOpacity: 0)
        return (next, frame)
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
    let estimatedRemaining: Double
    var onFinished: () -> Void = {}
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.colorScheme) private var colorScheme
    @State private var animationFinished = false
    @State private var proceduralAvailable = true
    @State private var visualTimeline = SwiftSimReloadVisualTimeline()

    #if os(iOS)
    @State private var windowCornerRadius: CGFloat?
    private var cornerRadius: CGFloat { windowCornerRadius ?? SwiftSimReloadWindowShape.fallbackRadius }
    #else
    private var cornerRadius: CGFloat { 22 }
    #endif

    var body: some View {
        GeometryReader { safeGeometry in
            #if canImport(MetalKit)
            if !reduceMotion && !reduceTransparency && state.phase != .failed && proceduralAvailable && SwiftSimReloadMetalView.isAvailable {
                GeometryReader { _ in
                    SwiftSimReloadProceduralFeedback(input: SwiftSimReloadRenderInput(
                        state: state, estimatedRemaining: estimatedRemaining, cornerRadius: cornerRadius,
                        lightAppearance: colorScheme == .light, active: scenePhase == .active),
                        onUnavailable: { proceduralAvailable = false }, onFinished: onFinished)
                        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                }
                .ignoresSafeArea()
            } else {
                fallbackTimeline(topInset: safeGeometry.safeAreaInsets.top)
            }
            #else
            fallbackTimeline(topInset: safeGeometry.safeAreaInsets.top)
            #endif
        }
        .transaction { $0.animation = nil }
        #if os(iOS)
        .background(SwiftSimReloadWindowShape(cornerRadius: $windowCornerRadius))
        #endif
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .opacity(scenePhase == .active ? 1 : 0)
        .task(id: state.sequence) {
            if reduceMotion && state.phase == .refreshed {
                try? await Task.sleep(for: .seconds(SwiftSimReloadChoreography.waveDuration))
                if !Task.isCancelled { onFinished() }
            }
        }
    }

    private func fallbackTimeline(topInset: CGFloat) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 60,
            paused: reduceMotion || state.phase == .failed || scenePhase != .active || animationFinished)) { tick in
            let sample = visualTimeline.sampled(at: ProcessInfo.processInfo.systemUptime,
                ready: scenePhase == .active, state: state, estimatedRemaining: estimatedRemaining)
            let frame = sample.frame
            GeometryReader { _ in
                ZStack(alignment: .top) {
                    fallback(frame: frame, corner: cornerRadius)
                    if reduceMotion || state.phase == .failed {
                        Label(state.phase.title, systemImage: state.phase.symbol)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background {
                                if reduceTransparency { Capsule().fill(.background) }
                                else { Capsule().fill(.regularMaterial) }
                            }
                            .padding(.top, topInset + 10)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
                .onAppear { visualTimeline = sample.timeline }
                .onChange(of: tick.date) { _ in visualTimeline = sample.timeline }
                .onChange(of: state.sequence) { _ in visualTimeline = sample.timeline }
                .onChange(of: frame.finished) { finished in
                    if finished { animationFinished = true; onFinished() }
                }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder private func fallback(frame: SwiftSimReloadChoreography.Frame, corner: CGFloat) -> some View {
        SwiftSimReloadAura(reveal: reduceMotion || state.phase == .failed ? 1 : frame.reveal,
            cornerRadius: corner, failed: state.phase == .failed,
            reduceMotion: reduceMotion, reduceTransparency: reduceTransparency,
            active: scenePhase == .active && frame.auraOpacity > 0)
            .opacity(reduceMotion || state.phase == .failed ? 1 : frame.auraOpacity)
        if state.phase == .refreshed && frame.waveStarted && !frame.finished && !reduceMotion {
            SwiftSimReloadLiquidWave(progress: frame.waveProgress, reduceTransparency: reduceTransparency)
        }
    }
}

#if os(iOS)
/// The glow traces the app's window. A window that fills the screen follows the
/// display's physical corners; a smaller one (Split View, Stage Manager or a
/// compatibility-sized app) is already rounded by the system, so it stays square.
struct SwiftSimReloadWindowShape: UIViewRepresentable {
    @Binding var cornerRadius: CGFloat?

    static var fallbackRadius: CGFloat { UIDevice.current.userInterfaceIdiom == .phone ? 55 : 18 }

    @MainActor static func cornerRadius(for window: UIWindow) -> CGFloat {
        guard let screen = window.windowScene?.screen else { return fallbackRadius }
        let frame = window.convert(window.bounds, to: screen.coordinateSpace)
        let fills = abs(frame.minX) < 1 && abs(frame.minY) < 1
            && abs(frame.width - screen.bounds.width) < 1 && abs(frame.height - screen.bounds.height) < 1
        guard fills else { return 0 }
        // Debug-only: the display radius differs by model (0 on Home-button phones).
        let key = "_displayCornerRadius"
        if screen.responds(to: NSSelectorFromString(key)), let radius = screen.value(forKey: key) as? CGFloat { return radius }
        return fallbackRadius
    }

    func makeUIView(context: Context) -> Probe {
        let probe = Probe(); probe.isUserInteractionEnabled = false; probe.report = report; return probe
    }
    func updateUIView(_ probe: Probe, context: Context) { probe.report = report }
    private func report(_ radius: CGFloat) { if cornerRadius != radius { cornerRadius = radius } }

    final class Probe: UIView {
        var report: ((CGFloat) -> Void)?
        override func didMoveToWindow() { super.didMoveToWindow(); measure() }
        override func layoutSubviews() { super.layoutSubviews(); measure() }
        private func measure() {
            guard let window else { return }
            let radius = SwiftSimReloadWindowShape.cornerRadius(for: window)
            DispatchQueue.main.async { [weak self] in self?.report?(radius) }
        }
    }
}
#endif
#endif
