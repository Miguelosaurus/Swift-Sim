import SwiftUI

#if DEBUG
import Combine
import InjectionBundle

@MainActor
private final class SwiftSimLiveObserver: ObservableObject {
    static let shared = SwiftSimLiveObserver()

    @Published private(set) var revision = 0
    private var cancellable: AnyCancellable?

    private init() {
        cancellable = NotificationCenter.default.publisher(
            for: Notification.Name("INJECTION_BUNDLE_NOTIFICATION")
        )
        .sink { [weak self] _ in
            guard let self else { return }
            self.revision &+= 1
            InjectionSetRootReady(true, UInt(self.revision))
            NotificationCenter.default.post(
                name: Notification.Name("SWIFT_SIM_LIVE_REVISION_APPLIED"),
                object: nil,
                userInfo: ["revision": self.revision]
            )
        }
        // Registration follows the revision subscription, so a queued patch
        // cannot race an unobserved first refresh at process startup.
        InjectionSetRootReady(true, UInt(revision))
    }
}

private struct SwiftSimLiveModifier: ViewModifier {
    @ObservedObject private var observer = SwiftSimLiveObserver.shared

    func body(content: Content) -> some View {
        AnyView(content)
            .id(observer.revision)
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
