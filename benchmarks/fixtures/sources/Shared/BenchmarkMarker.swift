import Foundation
import SwiftUI

@MainActor
enum BenchmarkMarker {
    private static var revision = 0

    static func emit(caseID: String, value: String) {
        let resolvedCaseID = caseID == "baseline" ? derivedCaseID(for: value) : caseID
        revision &+= 1
        let data = try? JSONSerialization.data(withJSONObject: [
            "case": resolvedCaseID,
            "value": value,
            "revision": revision,
        ], options: [.sortedKeys])
        let payload = data.flatMap { String(data: $0, encoding: .utf8) } ?? "{\"case\":\"baseline\",\"value\":\"\",\"revision\":0}"
        print("SWIFT_SIM_BENCHMARK \(payload)")
    }

    private static func derivedCaseID(for value: String) -> String {
        guard let marker = value.range(of: "-edited-") else { return "baseline" }
        let prefix = String(value[..<marker.lowerBound])
        let suffix = String(value[marker.upperBound...])
        let category: String
        switch prefix {
        case "action": category = "closure-action"
        case "computed": category = "computed-view"
        case "helper": category = "helper-function"
        case "async": category = "async-task"
        case "nested": category = "nested-extension-view"
        case "generic": category = "generic-actor-body"
        default: return "baseline"
        }
        return "\(category)-\(suffix)"
    }
}

struct BenchmarkMarkerView: View {
    let caseID: String
    let value: String

    init(caseID: String = "baseline", value: String) {
        self.caseID = caseID
        self.value = value
    }

    var body: some View {
        Color.clear
            .frame(width: 1, height: 1)
            .accessibilityHidden(true)
            .task(id: "\(caseID):\(value)") {
                BenchmarkMarker.emit(caseID: caseID, value: value)
            }
    }
}
