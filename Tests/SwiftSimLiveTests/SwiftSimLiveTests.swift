import SwiftUI
import Testing
@testable import SwiftSimLive

@MainActor
@Test
func modifierIsAvailableAtTheRoot() {
    _ = Text("Swift Sim").swiftSimLive()
}
