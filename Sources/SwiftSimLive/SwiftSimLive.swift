import SwiftUI

#if DEBUG
import Combine
import InjectionBundle

@MainActor
final class SwiftSimLiveObserver: ObservableObject {
    static let shared = SwiftSimLiveObserver()

    @Published private(set) var revision = 0
    private(set) var remountGeneration = 0
    private var registeredRoot = false
    private var cancellable: AnyCancellable?
    private var policySubscription: AnyCancellable?
    private var pendingPolicy: [AnyHashable: Any]?

    private init() {
        policySubscription = NotificationCenter.default.publisher(for: Notification.Name("SWIFT_SIM_NATIVE_REFRESH_POLICY"))
            .sink { [weak self] event in self?.pendingPolicy = event.userInfo }
        cancellable = NotificationCenter.default.publisher(
            for: Notification.Name("INJECTION_BUNDLE_NOTIFICATION")
        )
        .sink { [weak self] event in
            guard let self, self.registeredRoot else { return }
            let policy = self.pendingPolicy ?? event.userInfo
            let preserve = SwiftSimRootRefreshPolicy.preservesState(policy, baseline: self.revision)
            self.pendingPolicy = nil
            if !preserve { self.remountGeneration &+= 1 }
            self.revision &+= 1
            InjectionSetRootReady(true, UInt(self.revision))
            NotificationCenter.default.post(
                name: Notification.Name("SWIFT_SIM_LIVE_REVISION_APPLIED"),
                object: nil,
                userInfo: ["revision": self.revision,
                    "refresh_strategy": preserve ? "preserve-state-v1" : "remount",
                    "request_id": policy?["request_id"] ?? "",
                    "patch_digest": policy?["patch_digest"] ?? "",
                    "baseline_revision": policy?["baseline_revision"] ?? -1]
            )
        }
    }

    func registerRoot() {
        guard !registeredRoot else { return }
        registeredRoot = true
        // Registration follows the revision subscription, so a queued patch
        // cannot race an unobserved first refresh at process startup.
        InjectionSetRootReady(true, UInt(revision))
    }
}

private struct SwiftSimLiveModifier: ViewModifier {
    // Subscribe to delivery feedback before the root observer opens readiness.
    @ObservedObject private var feedback = SwiftSimDeliveryFeedbackObserver.shared
    @ObservedObject private var observer = SwiftSimLiveObserver.shared
    @State private var manualRevision = 0

    init() { SwiftSimLiveObserver.shared.registerRoot() }

    func body(content: Content) -> some View {
        AnyView(content)
            .id(SwiftSimRootIdentity(nativeRevision: observer.remountGeneration, manualRevision: manualRevision))
            .overlay {
                if let state = feedback.presentation {
                    SwiftSimDeliveryFeedbackEffect(state: state, estimatedRemaining: feedback.estimatedRemaining) {
                        feedback.dismissPresentation(requestID: state.requestID, sequence: state.sequence)
                    }
                        .id(state.requestID)
                }
            }
            #if canImport(UIKit) && os(iOS)
            .background {
                SwiftSimDeveloperMenuAttachment(feedback: feedback.reducer.current) {
                    manualRevision &+= 1
                }
                .frame(width: 0, height: 0)
            }
            #endif
    }
}
#endif

public extension View {
    /// Enables Swift Sim's debug-only live patch refresh lane.
    ///
    /// Add this once to the root view of the app. Release builds return the
    /// original view and do not start the InjectionNext client.
    @ViewBuilder
    func swiftSimLive() -> some View {
        #if DEBUG
        modifier(SwiftSimLiveModifier())
        #else
        self
        #endif
    }
}
