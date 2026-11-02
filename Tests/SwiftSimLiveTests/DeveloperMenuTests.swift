#if DEBUG
import Foundation
import Testing
@testable import SwiftSimLive

@Test
func launcherSnapsWithinSafeAreaAndSurvivesRotation() {
    var placement = SwiftSimDeveloperLauncherPosition()
    let portrait = CGRect(x: 12, y: 70, width: 369, height: 730)
    placement.snap(from: CGPoint(x: -500, y: 2000), in: portrait)
    #expect(placement.leading)
    #expect(placement.verticalFraction == 1)
    #expect(placement.center(in: portrait) == CGPoint(x: 34, y: 778))
    let landscape = CGRect(x: 70, y: 12, width: 700, height: 340)
    #expect(placement.center(in: landscape) == CGPoint(x: 92, y: 330))
    placement.snap(from: CGPoint(x: 1000, y: -100), in: landscape)
    #expect(!placement.leading)
    #expect(placement.center(in: landscape) == CGPoint(x: 748, y: 34))
}

@Test
func reportRequiresExactAcknowledgementAndExpiresWithoutClaimingSaved() {
    var receipt = SwiftSimDeveloperReportReceipt()
    let id = UUID().uuidString
    let began = receipt.begin(id: id, now: 100)
    #expect(began)
    #expect(receipt.state == .saving(id))
    let duplicateBegan = receipt.begin(id: UUID().uuidString, now: 101)
    let mismatchedAck = receipt.acknowledge(id: UUID().uuidString, saved: true, now: 102)
    #expect(!duplicateBegan)
    #expect(!mismatchedAck)
    #expect(receipt.state == .saving(id))
    let expiredEarly = receipt.expire(now: 109.99)
    let expiredAtDeadline = receipt.expire(now: 110)
    #expect(!expiredEarly)
    #expect(expiredAtDeadline)
    #expect(receipt.state == .failed)
    let lateAck = receipt.acknowledge(id: id, saved: true, now: 111)
    #expect(!lateAck)
}

@Test
func cancellationRejectsLateAcknowledgementsAndNewReportsHaveIndependentIdentity() {
    var receipt = SwiftSimDeveloperReportReceipt()
    let old = UUID().uuidString
    let new = UUID().uuidString
    let oldBegan = receipt.begin(id: old, now: 0)
    #expect(oldBegan)
    receipt.cancel()
    let newBegan = receipt.begin(id: new, now: 1)
    let staleAck = receipt.acknowledge(id: old, saved: true, now: 2)
    let currentAck = receipt.acknowledge(id: new, saved: true, now: 3)
    #expect(newBegan)
    #expect(!staleAck)
    #expect(currentAck)
    #expect(receipt.state == .saved(new))
    let duplicateAck = receipt.acknowledge(id: new, saved: false, now: 4)
    #expect(!duplicateAck)
}

@Test
func malformedOrLateReportsCannotBeginOrComplete() {
    var receipt = SwiftSimDeveloperReportReceipt()
    let malformedBegan = receipt.begin(id: "not-a-report", now: 0)
    let invalidClockBegan = receipt.begin(id: UUID().uuidString, now: .infinity)
    #expect(!malformedBegan)
    #expect(!invalidClockBegan)
    let id = UUID().uuidString
    let began = receipt.begin(id: id, now: 10)
    let lateAck = receipt.acknowledge(id: id, saved: true, now: 20)
    let expired = receipt.expire(now: 20)
    #expect(began)
    #expect(!lateAck)
    #expect(expired)
}

@Test
func captureScaleBoundsRealPixelsAndRejectsInvalidGeometry() {
    for (width, height, native) in [(393.0, 852.0, 3.0), (1024.0, 1366.0, 2.0), (320.0, 568.0, 2.0)] {
        let scale = SwiftSimDeveloperReportLimits.scale(width: width, height: height, nativeScale: native)!
        #expect(scale <= native)
        #expect(width * height * scale * scale <= SwiftSimDeveloperReportLimits.pixels + 0.001)
    }
    #expect(SwiftSimDeveloperReportLimits.scale(width: 0, height: 100, nativeScale: 3) == nil)
    #expect(SwiftSimDeveloperReportLimits.scale(width: .infinity, height: 100, nativeScale: 3) == nil)
    #expect(SwiftSimDeveloperReportLimits.scale(width: 100, height: 100, nativeScale: .nan) == nil)
}

@Test
func notesAreBoundedByBytesWithoutBreakingUnicode() {
    let text = String(repeating: "🩵", count: 2_000)
    let bounded = SwiftSimDeveloperReportLimits.boundedNote(text)
    #expect(bounded.utf8.count <= SwiftSimDeveloperReportLimits.noteBytes)
    #expect(bounded == String(repeating: "🩵", count: 512))
    #expect(SwiftSimDeveloperReportLimits.boundedNote("A quick note") == "A quick note")
}

@Test
func manualPresentationIdentityDoesNotChangeNativeRevision() {
    let before = SwiftSimRootIdentity(nativeRevision: 7, manualRevision: 0)
    let refreshed = SwiftSimRootIdentity(nativeRevision: 7, manualRevision: 1)
    #expect(before != refreshed)
    #expect(before.nativeRevision == refreshed.nativeRevision)
}

@Test
func changedNativeRevisionOrDeliverySequenceInvalidatesAnEncodedCapture() {
    let captured = SwiftSimDeveloperCaptureIdentity(nativeRevision: 7, deliverySequence: 12)
    #expect(captured != SwiftSimDeveloperCaptureIdentity(nativeRevision: 8, deliverySequence: 12))
    #expect(captured != SwiftSimDeveloperCaptureIdentity(nativeRevision: 7, deliverySequence: 13))
    #expect(captured == SwiftSimDeveloperCaptureIdentity(nativeRevision: 7, deliverySequence: 12))
}

@Test
func inspectionClipsGeometryAndPicksTheSmallestCandidateWithoutClaimingHittability() {
    let visible = CGRect(x: 0, y: 0, width: 390, height: 844)
    #expect(SwiftSimScreenInspection.clippedFrame(CGRect(x: -20, y: 10, width: 70, height: 40), inside: visible) == [0, 10, 50, 40])
    #expect(SwiftSimScreenInspection.clippedFrame(CGRect(x: 10, y: 900, width: 10, height: 10), inside: visible) == nil)
    #expect(SwiftSimScreenInspection.clippedFrame(CGRect(x: CGFloat.infinity, y: 0, width: 10, height: 10), inside: visible) == nil)
    let elements = [
        SwiftSimScreenInspection.Element(id: "e1", role: "element", label: nil, identifier: nil, value: nil,
            frame: [0, 0, 300, 300], enabled: nil, selected: false, source: "accessibility"),
        SwiftSimScreenInspection.Element(id: "e2", role: "button", label: "Save", identifier: nil, value: nil,
            frame: [20, 20, 100, 44], enabled: false, selected: false, source: "uikit"),
    ]
    #expect(SwiftSimScreenInspection.selection(at: CGPoint(x: 30, y: 30), in: elements) == "e2")
    #expect(SwiftSimScreenInspection.selection(at: CGPoint(x: 380, y: 800), in: elements) == nil)
}

@Test
func inspectionBoundsEscapedMetadataAndDropsSelectionWhenItsElementIsTrimmed() {
    let elements = (1...64).map { i in
        SwiftSimScreenInspection.Element(id: "e\(i)", role: "button", label: String(repeating: "\u{0001}", count: 160),
            identifier: String(repeating: "\\", count: 160), value: nil, frame: [0, 0, 100, 44],
            enabled: true, selected: false, source: "accessibility")
    }
    let snapshot = SwiftSimScreenInspection(schemaVersion: 1, capturedAt: 1, revision: 0, width: 390, height: 844,
        elements: elements, truncated: false, selectedElement: "e64", coverage: SwiftSimScreenInspection.coverageNote)
    let dictionary = snapshot.dictionary()!
    #expect((try! JSONSerialization.data(withJSONObject: dictionary)).count <= SwiftSimScreenInspection.maxBytes)
    #expect(dictionary["truncated"] as? Bool == true)
    #expect(dictionary["selectedElement"] == nil)
    #expect(SwiftSimScreenInspection.text(String(repeating: "🩵", count: 100))!.utf8.count <= 160)
}
#endif
