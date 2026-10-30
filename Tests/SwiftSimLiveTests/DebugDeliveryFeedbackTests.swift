#if DEBUG
import Foundation
import Testing
import SwiftUI
import InjectionBundle
@testable import SwiftSimLive

private func event(_ id: String, _ sequence: Int, _ phase: String, digest: String = String(repeating: "a", count: 64)) -> [AnyHashable: Any] {
    ["schema_version": 1, "request_id": id, "patch_digest": digest,
     "baseline_revision": 4, "sequence": sequence, "phase": phase]
}

@Test
func feedbackRequiresAReceivedRequestAndItsActualCompleteReceipt() {
    var reducer = SwiftSimDeliveryFeedbackReducer()
    func consume(_ info: [AnyHashable: Any]) -> Bool { reducer.consume(info) }
    let id = UUID().uuidString
    #expect(!consume(event(id, 1, "queued")))
    #expect(!consume(event(id, 2, "refreshed")))
    #expect(reducer.current == nil)
    #expect(consume(event(id, 3, "receiving")))
    #expect(consume(event(id, 4, "applying")))
    #expect(consume(event(id, 5, "waiting-for-refresh")))
    var success = event(id, 6, "refreshed")
    success["applied"] = true; success["dynamic_replacements"] = 1
    success["refresh_acknowledged"] = true; success["revision"] = 5
    for (key, bad) in [("applied", false), ("dynamic_replacements", 0), ("refresh_acknowledged", false), ("revision", 4)] as [(String, Any)] {
        var missing = success; missing[key] = bad
        #expect(!consume(missing))
        #expect(reducer.current?.phase == .waitingForRefresh)
    }
    #expect(consume(success))
    #expect(reducer.current?.phase == .refreshed)
    #expect(!consume(event(id, 7, "failed")))
}

@Test
func staleAndForeignFeedbackCannotChangeCurrentPresentation() {
    var reducer = SwiftSimDeliveryFeedbackReducer()
    func consume(_ info: [AnyHashable: Any]) -> Bool { reducer.consume(info) }
    let a = UUID().uuidString; let b = UUID().uuidString
    #expect(consume(event(a, 1, "receiving")))
    #expect(consume(event(a, 2, "applying")))
    #expect(!consume(event(a, 1, "receiving")))
    #expect(consume(event(b, 3, "receiving")))
    #expect(!consume(event(a, 4, "failed")))
    #expect(!consume(event(b, 4, "applying", digest: String(repeating: "b", count: 64))))
    #expect(consume(event(b, 5, "applying")))
    #expect(!consume(event(b, 6, "receiving")))
    #expect(reducer.current?.requestID == b)
    #expect(reducer.current?.phase == .applying)
}

@MainActor
@Test
func feedbackAndPresentationDismissalDoNotAdvanceTheHostRevisionOrFabricateSuccess() {
    _ = Text("Host content").swiftSimLive()
    let before = InjectionClientExecutionState() as? [String: Any] ?? [:]
    let observer = SwiftSimDeliveryFeedbackObserver(center: NotificationCenter())
    let id = UUID().uuidString
    observer.receive(event(id, 1, "receiving"))
    observer.receive(event(id, 2, "applying"))
    observer.dismissPresentation(requestID: id, sequence: 1)
    #expect(observer.presentation?.phase == .applying)
    observer.dismissPresentation(requestID: id, sequence: 2)
    #expect(observer.presentation == nil)
    #expect(observer.reducer.current?.phase == .applying)
    let after = InjectionClientExecutionState() as? [String: Any] ?? [:]
    #expect(after["root_revision"] as? Int == before["root_revision"] as? Int)
    #expect(after["root_ready"] as? Bool == before["root_ready"] as? Bool)
}
#endif
