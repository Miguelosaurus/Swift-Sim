#if DEBUG
import Foundation
import SwiftUI

/// Used by Swift Sim's Debug compiler overlay, without source annotations.
/// SwiftUI owns the observation's lifetime; no state is copied or serialized.
@MainActor
@propertyWrapper
public struct SwiftSimRefresh: DynamicProperty {
    @ObservedObject private var observer = SwiftSimLiveObserver.shared
    public init() {}
    public var wrappedValue: Int { observer.revision }
}

enum SwiftSimRootRefreshPolicy {
    static func preservesState(_ info: [AnyHashable: Any]?, baseline: Int) -> Bool {
        guard let info, info["refresh_strategy"] as? String == "preserve-state-v1",
              info["baseline_revision"] as? Int == baseline,
              let id = info["request_id"] as? String, UUID(uuidString: id) != nil,
              let digest = info["patch_digest"] as? String, digest.count == 64,
              digest.allSatisfy({ $0.isHexDigit && !$0.isUppercase }) else { return false }
        return true
    }
}
#endif
