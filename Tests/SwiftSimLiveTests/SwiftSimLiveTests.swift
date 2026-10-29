import SwiftUI
import Foundation
#if DEBUG
import InjectionBundle
#endif
import Testing
@testable import SwiftSimLive

@MainActor
@Test
func modifierIsAvailableAtTheRoot() {
    _ = Text("Swift Sim").swiftSimLive()
}

#if DEBUG
@MainActor
@Test
func rootRegistersReadinessAndAdvancesTheNativeRevisionBeforeAcknowledgement() {
    _ = Text("Swift Sim").swiftSimLive()
    let before = InjectionClientExecutionState() as? [String: Any] ?? [:]
    #expect(before["root_ready"] as? Bool == true)
    let revision = before["root_revision"] as? Int ?? 0
    NotificationCenter.default.post(name: Notification.Name("INJECTION_BUNDLE_NOTIFICATION"), object: nil)
    let after = InjectionClientExecutionState() as? [String: Any] ?? [:]
    #expect(after["root_ready"] as? Bool == true)
    #expect(after["root_revision"] as? Int == revision + 1)
}
#endif
