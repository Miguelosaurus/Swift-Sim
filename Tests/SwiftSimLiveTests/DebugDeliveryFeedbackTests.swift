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
func reloadOutlineStartsAtTheTopAndTravelsClockwise() throws {
    let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
    let path = SwiftSimReloadPerimeter().path(in: bounds)
    let top = try #require(path.trimmedPath(from: 0, to: 0.001).currentPoint)
    let right = try #require(path.trimmedPath(from: 0, to: 0.25).currentPoint)
    let bottom = try #require(path.trimmedPath(from: 0, to: 0.5).currentPoint)
    let left = try #require(path.trimmedPath(from: 0, to: 0.75).currentPoint)
    #expect(abs(top.y) < 1 && top.x > bounds.midX)
    #expect(abs(right.x - bounds.maxX) < 1 && abs(right.y - bounds.midY) < 2)
    #expect(abs(bottom.x - bounds.midX) < 2 && abs(bottom.y - bounds.maxY) < 1)
    #expect(abs(left.x) < 1 && abs(left.y - bounds.midY) < 2)
    #expect(SwiftSimReloadPerimeter().path(in: .zero).isEmpty)
}

@Test
func glassLensGrowsFromTheTop() {
    let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
    let lens = SwiftSimReloadLens(progress: 0).path(in: bounds)
    #expect(lens.contains(CGPoint(x: bounds.midX, y: 5)))
    #expect(!lens.contains(CGPoint(x: bounds.midX, y: 50)))
    #expect(SwiftSimReloadLens(progress: 1).path(in: bounds).contains(CGPoint(x: 1, y: 873)))
}

@Test
func perimeterWaitsForProofAndContactStartsTheWaveOnTheSameClockTick() {
    let pending = SwiftSimReloadChoreography.frame(elapsed: 600, confirmedAt: nil)
    #expect(pending.reveal < 1 && !pending.waveStarted && pending.waveProgress == 0)
    let confirmation = 2.0
    let contact = confirmation + SwiftSimReloadChoreography.closingDuration
    let before = SwiftSimReloadChoreography.frame(elapsed: contact - 0.00001, confirmedAt: confirmation)
    #expect(before.reveal < 1 && !before.waveStarted && before.waveProgress == 0)
    let touching = SwiftSimReloadChoreography.frame(elapsed: contact, confirmedAt: confirmation)
    #expect(touching.reveal == 1 && touching.waveStarted && touching.waveProgress == 0)
    let after = SwiftSimReloadChoreography.frame(elapsed: contact + 1.0 / 60, confirmedAt: confirmation)
    #expect(after.reveal == 1 && after.waveProgress > 0)
}

@Test
func fastProofStillCompletesTheClockwiseSweepAndTheWaitingGapCannotBeBlurredClosed() {
    let before = SwiftSimReloadChoreography.frame(elapsed: 0.9, confirmedAt: 0.05)
    #expect(before.reveal < 1 && !before.waveStarted)
    let contact = SwiftSimReloadChoreography.frame(elapsed: 1.05, confirmedAt: 0.05)
    #expect(contact.reveal == 1 && contact.waveStarted)
    let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
    let waiting = SwiftSimReloadReveal(progress: 0.93, cornerRadius: 55).path(in: bounds)
    #expect(!waiting.contains(CGPoint(x: 190, y: 2)))
    #expect(waiting.contains(CGPoint(x: 210, y: 2)))
    #expect(SwiftSimReloadReveal(progress: 1, cornerRadius: 55).path(in: bounds).contains(CGPoint(x: 190, y: 2)))
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
