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
        case preparing, receiving, applying
        case waitingForRefresh = "waiting-for-refresh"
        case refreshed, failed

        var rank: Int {
            switch self {
            case .preparing, .receiving: 0
            case .applying: 1
            case .waitingForRefresh: 2
            case .refreshed, .failed: 3
            }
        }
        var title: String {
            switch self {
            case .preparing: "Preparing update"
            case .receiving: "Receiving update"
            case .applying: "Applying update"
            case .waitingForRefresh: "Waiting for refresh"
            case .refreshed: "Updated"
            case .failed: "Update not confirmed"
            }
        }
        var symbol: String {
            switch self {
            case .preparing, .receiving: "arrow.down.circle"
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
    /// The Mac's estimate for this edit, sent when it starts compiling.
    var estimate: Double? = nil
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
        if phase == .preparing {
            if current?.requestID == requestID { return false }
        } else if phase == .receiving {
            // Admission continues an early "preparing" glow for the same edit.
            if current?.requestID == requestID && current?.phase != .preparing { return false }
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
        let estimateMs = info["estimate_ms"] as? Int
        current = SwiftSimDeliveryFeedbackState(requestID: requestID, patchDigest: digest,
            baselineRevision: baseline, sequence: sequence, phase: phase, revision: revision,
            estimate: phase == .preparing ? estimateMs.map { Double(min(max($0, 0), 600_000)) / 1_000 } : current?.estimate)
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
        let phase = presentation?.phase ?? .receiving
        if phase == .preparing, let estimate = presentation?.estimate { return estimate }
        return timing.remaining(for: phase)
    }

    init(center: NotificationCenter = .default,
         clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.clock = clock
        subscription = center.publisher(for: Notification.Name("SWIFT_SIM_LIVE_DELIVERY_FEEDBACK"))
            .receive(on: RunLoop.main)
            .sink { [weak self] notification in self?.receive(notification.userInfo ?? [:]) }
        #if canImport(UIKit) && os(iOS)
        // Synchronous on the posting (main) thread: the engine posts "applying"
        // before it queues the refresh, so this captures the pre-edit screen.
        freezeObserver = center.addObserver(forName: Notification.Name("SWIFT_SIM_LIVE_DELIVERY_FEEDBACK"),
                                            object: nil, queue: nil) { [weak self] notification in
            guard Thread.isMainThread, notification.userInfo?["phase"] as? String == "applying",
                  let requestID = notification.userInfo?["request_id"] as? String else { return }
            if #available(iOS 17, *) { MainActor.assumeIsolated { self?.freeze(requestID: requestID) } }
        }
        #endif
    }

    #if canImport(UIKit) && os(iOS)
    /// The pre-edit screen, shown until the ripple uncovers the new content.
    /// The edit itself applies immediately underneath.
    @Published private(set) var frozenFrame: UIView?
    @Published private(set) var revealingFrozenFrame = false
    private var freezeObserver: NSObjectProtocol?
    private var frozenRequestID: String?
    private var freezeWatchdog: Task<Void, Never>?

    private func freeze(requestID: String) {
        guard frozenFrame == nil, presentation?.requestID == requestID,
              !UIAccessibility.isReduceMotionEnabled, !UIAccessibility.isReduceTransparencyEnabled,
              SwiftSimReloadWindowShape.motionSupported,
              let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
                .filter({ $0.activationState == .foregroundActive })
                .flatMap(\.windows).first(where: \.isKeyWindow),
              let snapshot = window.snapshotView(afterScreenUpdates: false) else { return }
        frozenRequestID = requestID
        frozenFrame = snapshot
        revealingFrozenFrame = false
        // Never hold a stale screen if the ripple does not arrive.
        freezeWatchdog = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            self?.releaseFrozenFrame()
        }
    }

    func revealFrozenFrame() {
        if frozenFrame != nil { revealingFrozenFrame = true }
    }

    func releaseFrozenFrame() {
        freezeWatchdog?.cancel()
        frozenFrame = nil; frozenRequestID = nil; revealingFrozenFrame = false
    }
    #endif

    func receive(_ info: [AnyHashable: Any]) {
        guard reducer.consume(info), let current = reducer.current else { return }
        dismissal?.cancel()
        let now = clock()
        timing.consume(current.phase, at: now)
        presentation = current
        #if canImport(UIKit) && os(iOS)
        if current.phase == .failed || (frozenRequestID != nil && frozenRequestID != current.requestID) { releaseFrozenFrame() }
        #endif
        if current.phase == .preparing {
            // A compile that never reaches the phone must not leave a glow.
            let limit = min(60, max(10, 3 * (current.estimate ?? 3)))
            dismissal = Task { [weak self] in
                try? await Task.sleep(for: .seconds(limit))
                guard !Task.isCancelled else { return }
                self?.dismissPresentation(requestID: current.requestID, sequence: current.sequence)
            }
        }
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
        #if canImport(UIKit) && os(iOS)
        releaseFrozenFrame()
        #endif
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
        guard next != phase || next.rank == 0 else { return false }
        if next.rank == 0 {
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

/// The perimeter is the edit's progress bar: one constant speed, set once from
/// the Mac's estimate. It eases only if the edit runs late, and closes faster
/// only if the edit finishes well ahead of it. Only an admitted native receipt
/// can schedule contact at 100%.
struct SwiftSimReloadChoreography {
    private static let forecastReveal = 0.85
    static let waitingReveal = 0.97
    static let minimumSweepDuration = 1.0
    static let maximumFinishDuration = 0.6
    static let waveDuration = 2.1
    private let startedAt: TimeInterval
    private let velocity: Double
    private var completion: (at: Double, reveal: Double, duration: Double)?

    init(startedAt: TimeInterval = 0, estimatedDuration: Double = 4) {
        self.startedAt = startedAt
        let duration = estimatedDuration.isFinite ? max(Self.minimumSweepDuration, estimatedDuration) : 4
        velocity = 1 / duration
    }

    /// Stage events no longer change the speed; a steady bar reads better
    /// than one that re-aims at every native step.
    mutating func retarget(at now: TimeInterval, estimatedRemaining: Double) {}

    mutating func confirm(at now: TimeInterval) {
        guard completion == nil, now >= startedAt else { return }
        let elapsed = now - startedAt
        let reveal = pending(elapsed: elapsed)
        let steady = (1 - reveal) / velocity
        // Native application stays immediate; only presentation has a floor.
        let duration = max(min(steady, Self.maximumFinishDuration), Self.minimumSweepDuration - elapsed, 0.05)
        completion = (elapsed, reveal, duration)
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
            return Frame(reveal: pending(elapsed: elapsed), waveProgress: 0, waveStarted: false,
                finished: false, auraOpacity: min(1, elapsed / 0.2))
        }
        // Compare boundaries in the same absolute clock as contactAt. Moving
        // through elapsed time can round the exact contact tick to either side.
        let contact = startedAt + completion.at + completion.duration
        if now < contact {
            let fraction = (elapsed - completion.at) / completion.duration
            return Frame(reveal: min(1.0.nextDown, completion.reveal + (1 - completion.reveal) * fraction), waveProgress: 0,
                waveStarted: false, finished: false, auraOpacity: min(1, elapsed / 0.2))
        }
        let progress = now >= contact + Self.waveDuration ? 1 : max(0, (now - contact) / Self.waveDuration)
        return Frame(reveal: 1, waveProgress: progress, waveStarted: true,
            finished: progress >= 1, auraOpacity: max(0, 1 - progress * 2))
    }

    /// Constant speed to 85%, then a soft approach to 97% only when the edit
    /// is running late. The slope is continuous at the boundary.
    private func pending(elapsed: Double) -> Double {
        let linear = velocity * elapsed
        if linear <= Self.forecastReveal { return linear }
        let tail = Self.waitingReveal - Self.forecastReveal
        return Self.forecastReveal + tail * (1 - exp(-(linear - Self.forecastReveal) / tail))
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
    var onWaveStart: () -> Void = {}
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
                        onUnavailable: { proceduralAvailable = false }, onFinished: onFinished, onWaveStart: onWaveStart)
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
                .onChange(of: frame.waveStarted) { started in
                    if started { onWaveStart() }
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

    /// The procedural ripple is what uncovers a frozen frame.
    static var motionSupported: Bool {
        #if canImport(MetalKit)
        SwiftSimReloadMetalView.isAvailable
        #else
        false
        #endif
    }

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

/// Holds the pre-edit screen above the already-updated app, then uncovers the
/// new content inside the ripple's front (same origin and speed as the shader).
struct SwiftSimFrozenFrame: UIViewRepresentable {
    let snapshot: UIView
    let revealing: Bool
    let onRevealed: () -> Void

    func makeUIView(context: Context) -> Host { Host(snapshot: snapshot) }
    func updateUIView(_ host: Host, context: Context) {
        if revealing { host.reveal(completion: onRevealed) }
    }

    final class Host: UIView {
        /// Hidden while the ripple captures the refreshed screen it refracts.
        static weak var current: Host?
        private let snapshot: UIView
        private var revealing = false

        init(snapshot: UIView) {
            self.snapshot = snapshot
            super.init(frame: .zero)
            isUserInteractionEnabled = false
            accessibilityElementsHidden = true
            addSubview(snapshot)
            Host.current = self
        }
        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            snapshot.frame = window.map { convert($0.bounds, from: $0) } ?? bounds
        }

        func reveal(completion: @escaping () -> Void) {
            guard !revealing else { return }
            revealing = true
            let frame = snapshot.frame
            let origin = CGPoint(x: frame.midX, y: frame.minY + 5)
            let travel = hypot(frame.width / 2, frame.height - 5)
            let duration = SwiftSimReloadChoreography.waveDuration - SwiftSimReloadRipple.trailingDuration
            func path(_ radius: CGFloat) -> CGPath {
                let path = UIBezierPath(rect: frame.insetBy(dx: -1, dy: -1))
                path.append(UIBezierPath(arcCenter: origin, radius: max(0.1, radius), startAngle: 0, endAngle: .pi * 2, clockwise: true))
                return path.cgPath
            }
            let mask = CAShapeLayer()
            mask.fillRule = .evenOdd
            mask.path = path(travel + 2)
            layer.mask = mask
            CATransaction.begin()
            CATransaction.setCompletionBlock { completion() }
            let animation = CABasicAnimation(keyPath: "path")
            animation.fromValue = path(0)
            animation.toValue = path(travel + 2)
            animation.duration = duration
            animation.timingFunction = CAMediaTimingFunction(name: .linear)
            mask.add(animation, forKey: "reveal")
            CATransaction.commit()
        }
    }
}
#endif
#endif
