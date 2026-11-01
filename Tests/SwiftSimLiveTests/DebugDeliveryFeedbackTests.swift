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
func perimeterWaitsForProofAndContactStartsTheWaveOnTheSameClockTick() throws {
    var choreography = SwiftSimReloadChoreography()
    let pending = choreography.frame(at: 600)
    #expect(pending.reveal < 1 && !pending.waveStarted && pending.waveProgress == 0)
    let confirmation = 2.0
    choreography.confirm(at: confirmation)
    let contact = try #require(choreography.contactAt)
    let before = choreography.frame(at: contact - 0.00001)
    #expect(before.reveal < 1 && !before.waveStarted && before.waveProgress == 0)
    let touching = choreography.frame(at: contact)
    #expect(touching.reveal == 1 && touching.waveStarted && touching.waveProgress == 0)
    let after = choreography.frame(at: contact + 1.0 / 60)
    #expect(after.reveal == 1 && after.waveProgress > 0)
}

@Test
func fastProofStillCompletesTheClockwiseSweepAndTheWaitingGapCannotBeBlurredClosed() throws {
    var choreography = SwiftSimReloadChoreography()
    choreography.confirm(at: 0.05)
    let contactTime = try #require(choreography.contactAt)
    #expect(contactTime <= 0.65)
    let before = choreography.frame(at: contactTime - 0.00001)
    #expect(before.reveal < 1 && !before.waveStarted)
    let contact = choreography.frame(at: contactTime)
    #expect(contact.reveal == 1 && contact.waveStarted)
    let bounds = CGRect(x: 0, y: 0, width: 402, height: 874)
    let waiting = SwiftSimReloadReveal(progress: 0.93, cornerRadius: 55).path(in: bounds)
    #expect(!waiting.contains(CGPoint(x: 190, y: 2)))
    #expect(waiting.contains(CGPoint(x: 210, y: 2)))
    #expect(SwiftSimReloadReveal(progress: 1, cornerRadius: 55).path(in: bounds).contains(CGPoint(x: 190, y: 2)))
}

@Test
func estimatedSweepDoesNotSprintToTheEndAndPhaseChangesPreserveMotion() {
    var choreography = SwiftSimReloadChoreography(estimatedDuration: 4)
    #expect(abs(choreography.frame(at: 1).reveal - 0.2125) < 0.000001)
    #expect(abs(choreography.frame(at: 2).reveal - 0.425) < 0.000001)
    #expect(abs(choreography.frame(at: 3).reveal - 0.6375) < 0.000001)
    #expect(abs(choreography.frame(at: 3.8).reveal - 0.8075) < 0.000001)
    #expect(abs(choreography.frame(at: 4).reveal - 0.85) < 0.000001)
    let at = 1.2
    let delta = 0.00001
    let position = choreography.frame(at: at).reveal
    let incomingSpeed = (position - choreography.frame(at: at - delta).reveal) / delta
    choreography.retarget(at: at, estimatedRemaining: 6)
    #expect(abs(choreography.frame(at: at).reveal - position) < 0.000001)
    let outgoingSpeed = (choreography.frame(at: at + delta).reveal - position) / delta
    #expect(abs(incomingSpeed - outgoingSpeed) < 0.0001)
    #expect(choreography.frame(at: 2).reveal < 0.425)
    var previous = position
    for tick in 1...18000 {
        let frame = choreography.frame(at: at + Double(tick) / 30)
        #expect(frame.reveal >= previous && frame.reveal < 1 && !frame.waveStarted)
        previous = frame.reveal
    }
}

@Test
func receiptContinuesFromCurrentPositionAndSpeedWithoutATerminalCrawl() throws {
    for confirmation in [0.05, 2, 4, 20] {
        var choreography = SwiftSimReloadChoreography()
        let delta = 0.00001
        let position = choreography.frame(at: confirmation).reveal
        let incomingSpeed = (position - choreography.frame(at: confirmation - delta).reveal) / delta
        choreography.confirm(at: confirmation)
        let contact = try #require(choreography.contactAt)
        #expect(contact - confirmation <= 0.600001)
        #expect(abs(choreography.frame(at: confirmation).reveal - position) < 0.000001)
        let outgoingSpeed = (choreography.frame(at: confirmation + delta).reveal - position) / delta
        #expect(abs(incomingSpeed - outgoingSpeed) < 0.001)
        var previous = position
        for tick in 1...100 {
            let frame = choreography.frame(at: confirmation + (contact - confirmation) * Double(tick) / 100)
            #expect(frame.reveal >= previous && frame.reveal <= 1)
            previous = frame.reveal
        }
        #expect(choreography.frame(at: contact).waveStarted)
    }
}

@Test
func stageForecastLearnsSuccessfulTimingsAndIgnoresFailuresOrRepeatedStages() {
    var timing = SwiftSimReloadTiming()
    #expect(timing.remaining(for: .receiving) == 4)
    timing.consume(.receiving, at: 0)
    timing.consume(.applying, at: 0.5)
    let repeated = timing.consume(.applying, at: 1)
    #expect(!repeated)
    timing.consume(.waitingForRefresh, at: 2.5)
    timing.consume(.refreshed, at: 3)
    #expect(abs(timing.remaining(for: .receiving) - 3.7) < 0.000001)
    let learned = timing.remaining(for: .applying)
    timing.consume(.receiving, at: 4)
    timing.consume(.applying, at: 4.5)
    timing.consume(.failed, at: 40)
    #expect(timing.remaining(for: .applying) == learned)
    timing.consume(.receiving, at: 41)
    timing.consume(.refreshed, at: 50) // Missing stages must not be charged to receiving.
    #expect(abs(timing.remaining(for: .receiving) - 3.7) < 0.000001)
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
func pacingOnlyConfirmsAfterTheObserverAdmitsTheNativeReceipt() {
    var now = 100.0
    let observer = SwiftSimDeliveryFeedbackObserver(center: NotificationCenter(), clock: { now })
    let id = UUID().uuidString
    observer.receive(event(id, 1, "receiving"))
    now = 100.5
    observer.receive(event(id, 2, "applying"))
    now = 103
    observer.receive(event(id, 3, "waiting-for-refresh"))
    now = 104
    var receipt = event(id, 4, "refreshed")
    observer.receive(receipt)
    #expect(observer.choreography.contactAt == nil)
    #expect(!observer.choreography.frame(at: 10000).waveStarted)
    receipt["applied"] = true
    receipt["dynamic_replacements"] = 1
    receipt["refresh_acknowledged"] = true
    receipt["revision"] = 5
    observer.receive(receipt)
    #expect(observer.choreography.contactAt != nil)
    #expect(observer.choreography.frame(at: 105).waveStarted)
    observer.dismissPresentation(requestID: id, sequence: 4)
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
