#if DEBUG && canImport(UIKit) && os(iOS)
import UIKit

/// No observers, accessibility activation, private API or action invocation.
/// Custom host getters cannot be preempted; the work budget is checked between calls.
@MainActor
enum SwiftSimScreenInspector {
    static func capture(window: UIWindow, excluding: [UIView], revision: Int,
                        selection: CGPoint? = nil,
                        selectedCandidate: SwiftSimScreenInspection.Element? = nil) async -> SwiftSimScreenInspection? {
        guard window.isKeyWindow, !window.isHidden, window.alpha > 0,
              window.windowScene?.activationState == .foregroundActive,
              var controller = window.rootViewController else { return nil }
        while let next = controller.presentedViewController, !next.isBeingDismissed { controller = next }
        guard let root = controller.viewIfLoaded else { return nil }
        let bounds = window.bounds
        let deadline = ProcessInfo.processInfo.systemUptime + 0.25
        var sliceDeadline = ProcessInfo.processInfo.systemUptime + 0.008
        var visited = Set<ObjectIdentifier>()
        var elements: [SwiftSimScreenInspection.Element] = []
        var truncated = false
        var visits = 0

        func room(_ depth: Int) -> Bool {
            guard depth < 24, visits < SwiftSimScreenInspection.maxVisits,
                  elements.count < SwiftSimScreenInspection.maxElements,
                  !Task.isCancelled, ProcessInfo.processInfo.systemUptime < deadline else { truncated = true; return false }
            return true
        }
        @MainActor func walk(_ object: NSObject, clip: CGRect, depth: Int) async {
            if ProcessInfo.processInfo.systemUptime >= sliceDeadline {
                // Retain this request's progress while giving delivery/UI work a turn.
                await Task.yield()
                sliceDeadline = ProcessInfo.processInfo.systemUptime + 0.008
            }
            guard room(depth), visited.insert(ObjectIdentifier(object)).inserted else { return }
            guard window.isKeyWindow, window.windowScene?.activationState == .foregroundActive else { truncated = true; return }
            visits += 1
            let view = object as? UIView
            if let view {
                guard view.window === window, !view.isHidden, view.alpha > 0.01,
                      !view.accessibilityElementsHidden,
                      !excluding.contains(where: { view === $0 || view.isDescendant(of: $0) }) else { return }
            }
            let rect: CGRect
            if let view { rect = view.convert(view.bounds, to: window) }
            else { rect = window.convert(object.accessibilityFrame, from: window.screen.coordinateSpace) }
            let clipped = SwiftSimScreenInspection.clippedFrame(rect, inside: clip)
            // Non-view containers can have an empty frame but accessible children.
            if let view, clipped == nil && view.clipsToBounds { return }
            let traits = object.accessibilityTraits
            let field = view as? UITextField
            let textView = view as? UITextView
            let input = field != nil || textView != nil
            let isElement = object.isAccessibilityElement || view is UIControl || view is UILabel || input
            if isElement, let frame = clipped {
                let role: String
                if input { role = field?.isSecureTextEntry == true || textView?.isSecureTextEntry == true ? "secure-input" : "text-input" }
                else if view is UISwitch { role = "switch" }
                else if traits.contains(.button) || view is UIButton { role = "button" }
                else if traits.contains(.adjustable) || view is UISlider { role = "adjustable" }
                else if traits.contains(.header) { role = "heading" }
                else if traits.contains(.link) { role = "link" }
                else if traits.contains(.image) { role = "image" }
                else if traits.contains(.staticText) || view is UILabel { role = "text" }
                else { role = "element" }
                // Input values are always omitted, including custom secure fields
                // with unknown traits. Only native switch/slider state is exported.
                let value: String?
                if let toggle = view as? UISwitch { value = toggle.isOn ? "on" : "off" }
                else if let slider = view as? UISlider { value = String(slider.value) }
                else { value = nil }
                let label = object.accessibilityLabel ?? (view as? UILabel)?.text
                let identifier = view?.accessibilityIdentifier
                    ?? (object as? UIAccessibilityElement)?.accessibilityIdentifier
                elements.append(.init(id: "e\(elements.count + 1)", role: role,
                    label: SwiftSimScreenInspection.text(label), identifier: SwiftSimScreenInspection.text(identifier),
                    value: value, frame: frame,
                    enabled: (view as? UIControl).map(\.isEnabled) ?? (traits.contains(.notEnabled) ? false : nil),
                    selected: traits.contains(.selected) || (view as? UIControl)?.isSelected == true,
                    source: object.isAccessibilityElement ? "accessibility" : "uikit"))
                // Respect combined accessibility elements; don't duplicate their labels.
                if object.isAccessibilityElement { return }
            }
            guard room(depth) else { return }
            let childClip = view?.clipsToBounds == true ? clip.intersection(rect) : clip
            let count = object.accessibilityElementCount()
            if count > 0, count != NSNotFound {
                for index in 0..<min(count, SwiftSimScreenInspection.maxVisits) {
                    guard room(depth + 1) else { break }
                    if let child = object.accessibilityElement(at: index) as? NSObject {
                        await walk(child, clip: childClip, depth: depth + 1)
                    }
                }
                if count > SwiftSimScreenInspection.maxVisits { truncated = true }
            }
            if let view {
                // Fallback also covers UIKit views in mixed SwiftUI hierarchies.
                for child in view.subviews {
                    guard room(depth + 1) else { break }
                    await walk(child, clip: childClip, depth: depth + 1)
                }
            }
        }
        await walk(root, clip: bounds, depth: 0)
        guard window.bounds == bounds else { return nil }
        var current = window.rootViewController
        while let next = current?.presentedViewController, !next.isBeingDismissed { current = next }
        guard current === controller else { return nil }
        let selected = SwiftSimScreenInspection.selection(at: selection, in: elements)
        let sameSelection = elements.first(where: { $0.id == selected }).map {
            $0.role == selectedCandidate?.role && $0.label == selectedCandidate?.label
                && $0.identifier == selectedCandidate?.identifier && $0.frame == selectedCandidate?.frame
        } ?? false
        return .init(schemaVersion: 1, capturedAt: Date().timeIntervalSince1970 * 1_000,
            revision: revision, width: bounds.width, height: bounds.height,
            elements: elements, truncated: truncated,
            selectedElement: sameSelection ? selected : nil,
            coverage: SwiftSimScreenInspection.coverageNote)
    }
}
#endif
