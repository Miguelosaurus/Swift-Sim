import Foundation
import SwiftUI
import Testing
@testable import SwiftSimLive

#if DEBUG
@MainActor @Test
func nativePolicyPreservesIdentityOnlyForAnExactSupportedBaseline() {
    _ = Text("Host").swiftSimLive()
    let observer = SwiftSimLiveObserver.shared
    let baseline = observer.revision
    let generation = observer.remountGeneration
    let id = UUID().uuidString
    let digest = String(repeating: "a", count: 64)
    let policy: [String: Any] = ["request_id": id, "patch_digest": digest,
        "baseline_revision": baseline, "refresh_strategy": "preserve-state-v1"]
    var ack: [AnyHashable: Any]?
    let token = NotificationCenter.default.addObserver(forName: Notification.Name("SWIFT_SIM_LIVE_REVISION_APPLIED"), object: nil, queue: nil) { ack = $0.userInfo }
    defer { NotificationCenter.default.removeObserver(token) }
    NotificationCenter.default.post(name: Notification.Name("SWIFT_SIM_NATIVE_REFRESH_POLICY"), object: nil, userInfo: policy)
    NotificationCenter.default.post(name: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"), object: nil)
    #expect(observer.revision == baseline + 1)
    #expect(observer.remountGeneration == generation)
    #expect(ack?["refresh_strategy"] as? String == "preserve-state-v1")
    #expect(ack?["request_id"] as? String == id)
    #expect(ack?["patch_digest"] as? String == digest)
    #expect(ack?["baseline_revision"] as? Int == baseline)
    // A policy is consumed once. Legacy/manual injection still remounts.
    NotificationCenter.default.post(name: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"), object: nil)
    #expect(observer.remountGeneration == generation + 1)
    NotificationCenter.default.post(name: Notification.Name("SWIFT_SIM_NATIVE_REFRESH_POLICY"), object: nil, userInfo: policy)
    NotificationCenter.default.post(name: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"), object: nil)
    #expect(observer.remountGeneration == generation + 2)
}

@Test func malformedOrUnsupportedStatePoliciesCannotPreserveTheRoot() {
    let valid: [String: Any] = ["request_id": UUID().uuidString, "patch_digest": String(repeating: "a", count: 64),
        "baseline_revision": 4, "refresh_strategy": "preserve-state-v1"]
    #expect(SwiftSimRootRefreshPolicy.preservesState(valid, baseline: 4))
    #expect(!SwiftSimRootRefreshPolicy.preservesState(nil, baseline: 4))
    for change: [String: Any] in [["request_id": "invalid"], ["patch_digest": "bad"],
                                 ["baseline_revision": 3], ["refresh_strategy": "unknown"]] {
        #expect(!SwiftSimRootRefreshPolicy.preservesState(valid.merging(change) { _, latest in latest }, baseline: 4))
    }
}
#endif
