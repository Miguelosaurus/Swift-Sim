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
        // This is a lifecycle cue, not a measured percentage. The final gap
        // closes only after the reducer admits a complete native receipt.
        var outlineProgress: CGFloat {
            switch self {
            case .receiving: 0.18
            case .applying: 0.68
            case .waitingForRefresh: 0.92
            case .refreshed, .failed: 1
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
                try? await Task.sleep(for: .seconds(current.phase == .refreshed ? 2.25 : 5))
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
        let rect = bounds.insetBy(dx: 5, dy: 5)
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
        return Path(ellipseIn: circle).strokedPath(StrokeStyle(lineWidth: 18))
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
    @State private var glowing = false

    private var teal: Color { Color(red: 0.03, green: 0.77, blue: 0.66) }
    private var tint: Color { state.phase == .failed ? .orange : teal }
    private var animationKey: String { "\(state.sequence)-\(reduceMotion)-\(scenePhase == .active)" }

    var body: some View {
        GeometryReader { safeGeometry in
            GeometryReader { geometry in
                #if os(iOS)
                let corner: CGFloat = UIDevice.current.userInterfaceIdiom == .phone ? 46 : 24
                #else
                let corner: CGFloat = 22
                #endif
                ZStack(alignment: .top) {
                    SwiftSimReloadPerimeter(cornerRadius: corner)
                        .stroke(tint.opacity(0.09), lineWidth: 2)
                    SwiftSimReloadPerimeter(cornerRadius: corner)
                        .trim(from: 0, to: reduceMotion ? 1 : outlineProgress)
                        .stroke(tint.gradient, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                        .shadow(color: tint.opacity(0.8), radius: 5)
                        .shadow(color: tint.opacity(0.35), radius: 13)
                        .opacity(glowing ? 1 : 0.7)
                    // Mount at zero radius before the delayed finish animation.
                    // Inserting the wave and advancing it in one turn skips motion.
                    if state.phase == .refreshed && !reduceMotion {
                        wave
                            .opacity(showingWave ? 1 - Double(waveProgress) : 0)
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
            glowing = false
            outlineProgress = state.phase.outlineProgress
            return
        }
        if state.phase == .failed {
            showingWave = false
            glowing = false
        }
        withAnimation(.easeInOut(duration: 0.45)) { outlineProgress = state.phase.outlineProgress }
        if state.phase == .refreshed {
            glowing = true
            do { try await Task.sleep(for: .milliseconds(450)) } catch { return }
            guard !Task.isCancelled else { return }
            showingWave = true
            waveProgress = 0
            withAnimation(.easeOut(duration: 1.1)) {
                waveProgress = 1
                glowing = false
            }
        } else if state.phase != .failed {
            withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { glowing = true }
        }
    }
}
#endif
