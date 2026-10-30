#if DEBUG
import Combine
import Foundation
import SwiftUI

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
            dismissal = Task { [weak self] in
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { return }
                self?.dismissPresentation(requestID: current.requestID, sequence: current.sequence)
            }
        }
    }

    func dismissPresentation(requestID: String, sequence: Int) {
        guard presentation?.requestID == requestID, presentation?.sequence == sequence else { return }
        presentation = nil
    }
}

struct SwiftSimDeliveryFeedbackBanner: View {
    let state: SwiftSimDeliveryFeedbackState

    var body: some View {
        Label(state.phase.title, systemImage: state.phase.symbol)
            .font(.caption.weight(.semibold))
            .foregroundStyle(state.phase == .failed ? Color.orange : Color.primary)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(.regularMaterial, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.primary.opacity(0.12)))
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Swift Sim Debug. \(state.phase.title). Update \(state.requestID.prefix(8)).")
    }
}
#endif
