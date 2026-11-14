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
    #expect(abs(contactTime - SwiftSimReloadChoreography.minimumSweepDuration) < 0.000001)
    #expect(choreography.frame(at: 0.05).auraOpacity == 0.25)
    #expect(choreography.frame(at: 0.7).reveal < 0.75)
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
func theSweepKeepsOneSteadySpeedAndStageEventsCannotChangeIt() {
    var choreography = SwiftSimReloadChoreography(estimatedDuration: 4)
    #expect(abs(choreography.frame(at: 1).reveal - 0.25) < 0.000001)
    #expect(abs(choreography.frame(at: 2).reveal - 0.5) < 0.000001)
    #expect(abs(choreography.frame(at: 3).reveal - 0.75) < 0.000001)
    let before = choreography.frame(at: 1.2).reveal
    choreography.retarget(at: 1.2, estimatedRemaining: 0.1)
    choreography.retarget(at: 1.3, estimatedRemaining: 60)
    #expect(choreography.frame(at: 1.2).reveal == before)
    #expect(abs(choreography.frame(at: 2).reveal - 0.5) < 0.000001, "no brake or sprint at a stage event")
    var previous = 0.0
    for tick in 1...18000 {
        let frame = choreography.frame(at: Double(tick) / 30)
        #expect(frame.reveal >= previous && frame.reveal <= SwiftSimReloadChoreography.waitingReveal && !frame.waveStarted)
        previous = frame.reveal
    }
}

@Test
func receiptOnScheduleFinishesAtTheSameSpeedAndAnEarlyOneNeverSlowsDown() throws {
    for confirmation in [0.05, 1.0, 2.5, 4, 20] {
        var choreography = SwiftSimReloadChoreography(estimatedDuration: 3)
        let delta = 0.00001
        let position = choreography.frame(at: confirmation).reveal
        let incomingSpeed = (position - choreography.frame(at: confirmation - delta).reveal) / delta
        choreography.confirm(at: confirmation)
        let contact = try #require(choreography.contactAt)
        #expect(contact - confirmation <= max(SwiftSimReloadChoreography.maximumFinishDuration + 0.000001,
            SwiftSimReloadChoreography.minimumSweepDuration - confirmation + 0.000001))
        #expect(abs(choreography.frame(at: confirmation).reveal - position) < 0.000001)
        let outgoingSpeed = (choreography.frame(at: confirmation + delta).reveal - position) / delta
        #expect(outgoingSpeed >= incomingSpeed - 0.0001, "the finish never brakes")
        var previous = position
        for tick in 1...100 {
            let frame = choreography.frame(at: confirmation + (contact - confirmation) * Double(tick) / 100)
            #expect(frame.reveal >= previous && frame.reveal <= 1)
            previous = frame.reveal
        }
        #expect(choreography.frame(at: contact).waveStarted)
    }
    // Arriving on schedule keeps exactly the bar's own speed into the top.
    var onTime = SwiftSimReloadChoreography(estimatedDuration: 3)
    onTime.confirm(at: 2.7)
    let speed = (onTime.frame(at: 2.71).reveal - onTime.frame(at: 2.7).reveal) / 0.01
    #expect(abs(speed - 1.0 / 3) < 0.001)
}

@Test
func learnedFastForecastsAndStageRetargetsKeepTheSweepReadable() throws {
    for estimate in [0.001, 0.05, 0.5, 1.4, 4] {
        for confirmation in [0.02, 0.05, 0.5, 1.3, 2.0] {
            var choreography = SwiftSimReloadChoreography(startedAt: 100, estimatedDuration: estimate)
            #expect(choreography.frame(at: 100).reveal == 0)
            choreography.retarget(at: 100.01, estimatedRemaining: 0.001)
            #expect(choreography.frame(at: 100.01).reveal < 0.02)
            choreography.confirm(at: 100 + confirmation)
            let contact = try #require(choreography.contactAt)
            #expect(contact >= 100 + SwiftSimReloadChoreography.minimumSweepDuration - 0.000001)
            let confirmedAt = 100 + confirmation
            var previous = choreography.frame(at: confirmedAt).reveal
            for tick in 1...300 {
                let now = confirmedAt + (contact - confirmedAt) * Double(tick) / 300
                let frame = choreography.frame(at: now)
                #expect(frame.reveal >= previous && frame.reveal <= 1)
                if now < contact { #expect(!frame.waveStarted) }
                previous = frame.reveal
            }
            #expect(choreography.frame(at: contact).waveStarted)
            #expect(choreography.frame(at: contact).waveProgress == 0)
            #expect(choreography.frame(at: contact + SwiftSimReloadChoreography.waveDuration).finished)
        }
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
func coldPreparationDoesNotConsumeTheVisibleSweepAndStallsCannotSkipIt() {
    let state = SwiftSimDeliveryFeedbackState(requestID: UUID().uuidString,
        patchDigest: String(repeating: "a", count: 64), baselineRevision: 0,
        sequence: 4, phase: .refreshed, revision: 1)
    var timeline = SwiftSimReloadVisualTimeline()
    for now in [100.0, 101, 102.8] {
        let sample = timeline.sampled(at: now, ready: false, state: state, estimatedRemaining: 0)
        #expect(sample.frame.reveal == 0 && !sample.frame.waveStarted)
        #expect(sample.timeline.elapsed == 0)
        timeline = sample.timeline
    }
    var sample = timeline.sampled(at: 103, ready: true, state: state, estimatedRemaining: 0)
    #expect(sample.frame.reveal == 0 && sample.timeline.elapsed == 0)
    timeline = sample.timeline
    var wallTime = 103.0
    for _ in 0..<15 {
        wallTime += 1.0 / 30
        sample = timeline.sampled(at: wallTime, ready: true, state: state, estimatedRemaining: 0)
        timeline = sample.timeline
    }
    let beforeStall = sample.frame.reveal
    let elapsed = timeline.elapsed
    wallTime += 2
    sample = timeline.sampled(at: wallTime, ready: true, state: state, estimatedRemaining: 0)
    #expect(sample.timeline.elapsed - elapsed <= 1.0 / 15 + 0.000001)
    #expect(sample.frame.reveal - beforeStall < 0.1)
    #expect(!sample.frame.waveStarted)
    timeline = sample.timeline
    var previous = sample.frame
    for _ in 0..<120 {
        wallTime += 1.0 / 60
        sample = timeline.sampled(at: wallTime, ready: true, state: state, estimatedRemaining: 0)
        #expect(sample.frame.reveal >= previous.reveal)
        if sample.frame.waveStarted && !previous.waveStarted {
            #expect(sample.frame.reveal == 1 && previous.reveal < 1)
            #expect(sample.frame.waveProgress < 1.0 / 60)
            #expect(sample.timeline.elapsed >= SwiftSimReloadChoreography.minimumSweepDuration)
        }
        timeline = sample.timeline
        previous = sample.frame
    }
    #expect(sample.frame.waveStarted)
}

@Test
func displayClockNeverClosesAnUnconfirmedUpdate() {
    let state = SwiftSimDeliveryFeedbackState(requestID: UUID().uuidString,
        patchDigest: String(repeating: "a", count: 64), baselineRevision: 0,
        sequence: 3, phase: .waitingForRefresh, revision: nil)
    var timeline = SwiftSimReloadVisualTimeline()
    for tick in 0..<6000 {
        let sample = timeline.sampled(at: Double(tick) / 30, ready: true, state: state, estimatedRemaining: 1)
        #expect(sample.frame.reveal < 1 && !sample.frame.waveStarted)
        timeline = sample.timeline
    }
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
func pacingOnlyConfirmsAfterTheObserverAdmitsTheNativeReceipt() throws {
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
    let waiting = try #require(observer.presentation)
    #expect(waiting.phase == .waitingForRefresh)
    var timeline = SwiftSimReloadVisualTimeline()
    for tick in 0..<120 {
        let sample = timeline.sampled(at: Double(tick) / 60, ready: true,
            state: waiting, estimatedRemaining: observer.estimatedRemaining)
        #expect(!sample.frame.waveStarted)
        timeline = sample.timeline
    }
    receipt["applied"] = true
    receipt["dynamic_replacements"] = 1
    receipt["refresh_acknowledged"] = true
    receipt["revision"] = 5
    observer.receive(receipt)
    let confirmed = try #require(observer.presentation)
    #expect(confirmed.phase == .refreshed)
    var startedWave = false
    for tick in 120..<240 {
        let sample = timeline.sampled(at: Double(tick) / 60, ready: true,
            state: confirmed, estimatedRemaining: observer.estimatedRemaining)
        startedWave = startedWave || sample.frame.waveStarted
        timeline = sample.timeline
    }
    #expect(startedWave)
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

@Test
func preparingStartsTheGlowWithTheMacEstimateAndAdmissionContinuesIt() {
    var reducer = SwiftSimDeliveryFeedbackReducer()
    func consume(_ info: [AnyHashable: Any]) -> Bool { reducer.consume(info) }
    let id = UUID().uuidString
    var preparing = event(id, 1, "preparing", digest: String(repeating: "0", count: 64))
    preparing["estimate_ms"] = 2_400
    #expect(consume(preparing))
    #expect(reducer.current?.phase == .preparing)
    #expect(reducer.current?.estimate == 2.4)
    #expect(!consume(event(id, 2, "preparing", digest: String(repeating: "0", count: 64))))
    #expect(consume(event(id, 3, "receiving")))
    #expect(reducer.current?.patchDigest == String(repeating: "a", count: 64))
    #expect(reducer.current?.estimate == 2.4)
    #expect(!consume(event(id, 4, "receiving")), "Only an early glow can be continued by admission")
    #expect(consume(event(id, 5, "applying")))
}
