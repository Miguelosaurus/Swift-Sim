#if DEBUG
import Foundation

/// Presentation identity is deliberately separate from native replacement proof.
struct SwiftSimRootIdentity: Hashable {
    let nativeRevision: Int
    let manualRevision: Int
}

/// Session-only placement, normalized so rotation never strands the launcher.
struct SwiftSimDeveloperLauncherPosition: Equatable {
    var leading = false
    var verticalFraction = 0.0

    func center(in safeRect: CGRect) -> CGPoint {
        let minY = min(safeRect.minY + 22, safeRect.midY)
        let maxY = max(safeRect.maxY - 22, safeRect.midY)
        let left = min(safeRect.minX + 22, safeRect.midX)
        let right = max(safeRect.maxX - 22, safeRect.midX)
        return CGPoint(x: leading ? left : right,
            y: minY + CGFloat(min(1, max(0, verticalFraction))) * (maxY - minY))
    }

    mutating func snap(from point: CGPoint, in safeRect: CGRect) {
        leading = point.x < safeRect.midX
        let minY = min(safeRect.minY + 22, safeRect.midY)
        let span = max(0, safeRect.maxY - 22 - minY)
        verticalFraction = span > 0 ? min(1, max(0, Double((point.y - minY) / span))) : 0
    }
}

struct SwiftSimDeveloperCaptureIdentity: Equatable {
    let nativeRevision: Int
    let deliverySequence: Int?
}

enum SwiftSimDeveloperReportLimits {
    static let pixels = 2_000_000.0
    static let imageBytes = 1_048_576
    static let metadataBytes = 16_384
    static let noteBytes = 2_048
    static let timeout = 10.0

    static func scale(width: Double, height: Double, nativeScale: Double) -> Double? {
        guard width.isFinite, height.isFinite, nativeScale.isFinite,
              width > 0, height > 0, nativeScale > 0 else { return nil }
        let area = width * height
        guard area.isFinite, area > 0 else { return nil }
        return min(nativeScale, sqrt(pixels / area))
    }

    static func boundedNote(_ text: String) -> String {
        boundedText(text, bytes: noteBytes)
    }

    static func boundedText(_ text: String, bytes limit: Int) -> String {
        var result = ""
        var bytes = 0
        for scalar in text.unicodeScalars {
            let count = scalar.utf8.count
            guard bytes + count <= limit else { break }
            result.unicodeScalars.append(scalar)
            bytes += count
        }
        return result
    }
}

/// Only a matching Mac acknowledgement can turn an accepted send into Saved.
struct SwiftSimDeveloperReportReceipt {
    enum State: Equatable {
        case idle
        case saving(String)
        case saved(String)
        case failed
    }

    private(set) var state: State = .idle
    private(set) var deadline: TimeInterval?

    mutating func begin(id: String, now: TimeInterval) -> Bool {
        guard UUID(uuidString: id) != nil, now.isFinite else { return false }
        if case .saving = state { return false }
        state = .saving(id)
        deadline = now + SwiftSimDeveloperReportLimits.timeout
        return true
    }

    @discardableResult
    mutating func acknowledge(id: String, saved: Bool, now: TimeInterval) -> Bool {
        guard case .saving(let pending) = state, pending == id,
              let deadline, now.isFinite, now < deadline else { return false }
        state = saved ? .saved(id) : .failed
        self.deadline = nil
        return true
    }

    @discardableResult
    mutating func expire(now: TimeInterval) -> Bool {
        guard case .saving = state, let deadline, now >= deadline else { return false }
        state = .failed
        self.deadline = nil
        return true
    }

    mutating func cancel() {
        state = .idle
        deadline = nil
    }
}

#if canImport(UIKit) && os(iOS)
import UIKit

extension SwiftSimDeveloperMenuCoordinator {
    enum TextSize: String, CaseIterable {
        case appDefault = "app-default", xs, s, m, l, xl, xxl, xxxl, ax1, ax2, ax3, ax4, ax5
        var title: String {
            switch self {
            case .appDefault: "App default"
            case .xs: "Extra small"; case .s: "Small"; case .m: "Medium"; case .l: "Large"
            case .xl: "Extra large"; case .xxl: "Extra extra large"; case .xxxl: "Extra extra extra large"
            case .ax1: "Accessibility 1"; case .ax2: "Accessibility 2"; case .ax3: "Accessibility 3"
            case .ax4: "Accessibility 4"; case .ax5: "Accessibility 5"
            }
        }
        var category: UIContentSizeCategory? {
            switch self {
            case .appDefault: nil
            case .xs: .extraSmall; case .s: .small; case .m: .medium; case .l: .large
            case .xl: .extraLarge; case .xxl: .extraExtraLarge; case .xxxl: .extraExtraExtraLarge
            case .ax1: .accessibilityMedium; case .ax2: .accessibilityLarge
            case .ax3: .accessibilityExtraLarge; case .ax4: .accessibilityExtraExtraLarge
            case .ax5: .accessibilityExtraExtraExtraLarge
            }
        }
    }
    enum LayoutDirection: String, CaseIterable {
        case appDefault = "app-default", ltr, rtl
        var title: String {
            switch self { case .appDefault: "App default"; case .ltr: "Left-to-right"; case .rtl: "Right-to-left" }
        }
        var direction: UITraitEnvironmentLayoutDirection? {
            switch self { case .appDefault: nil; case .ltr: .leftToRight; case .rtl: .rightToLeft }
        }
    }

}
#endif

#endif
