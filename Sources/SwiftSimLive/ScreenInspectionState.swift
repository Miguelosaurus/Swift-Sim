#if DEBUG
import Foundation

/// One ephemeral observation. IDs are valid only within this snapshot, never selectors.
struct SwiftSimScreenInspection: Codable {
    struct Element: Codable {
        let id: String
        let role: String
        let label: String?
        let identifier: String?
        let value: String?
        let frame: [Double]
        let enabled: Bool?
        let selected: Bool
        let source: String
    }
    let schemaVersion: Int
    let capturedAt: Double
    let revision: Int
    let width: Double
    let height: Double
    let elements: [Element]
    let truncated: Bool
    let selectedElement: String?
    let coverage: String

    static let maxElements = 64
    static let maxBytes = 32 * 1024
    static let maxVisits = 512
    static let coverageNote = "On-screen candidates from public accessibility and UIKit APIs; custom drawing and some SwiftUI content may be absent. Frames use app-window points. Visibility is geometric, not proof of hittability. No source-file mapping."

    func dictionary() -> [String: Any]? {
        var limited = self
        while let data = try? JSONEncoder().encode(limited) {
            if data.count <= Self.maxBytes { return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] }
            guard !limited.elements.isEmpty else { return nil }
            let remaining = Array(limited.elements.dropLast())
            limited = .init(schemaVersion: schemaVersion, capturedAt: capturedAt, revision: revision,
                width: width, height: height, elements: remaining, truncated: true,
                selectedElement: remaining.contains(where: { $0.id == selectedElement }) ? selectedElement : nil,
                coverage: coverage)
        }
        return nil
    }

    static func clippedFrame(_ rect: CGRect, inside visible: CGRect) -> [Double]? {
        guard [rect.minX, rect.minY, rect.width, rect.height].allSatisfy({ $0.isFinite }),
              rect.width > 0, rect.height > 0 else { return nil }
        let intersection = rect.intersection(visible)
        guard !intersection.isNull, intersection.width >= 1, intersection.height >= 1 else { return nil }
        return [intersection.minX, intersection.minY, intersection.width, intersection.height].map { (Double($0) * 10).rounded() / 10 }
    }

    static func selection(at point: CGPoint?, in elements: [Element]) -> String? {
        guard let point else { return nil }
        return elements.filter {
            $0.frame.count == 4 && CGRect(x: $0.frame[0], y: $0.frame[1], width: $0.frame[2], height: $0.frame[3]).contains(point)
        }.min { $0.frame[2] * $0.frame[3] < $1.frame[2] * $1.frame[3] }?.id
    }

    static func text(_ string: String?) -> String? {
        guard let string, !string.isEmpty else { return nil }
        return SwiftSimDeveloperReportLimits.boundedText(string, bytes: 160)
    }
}
#endif
