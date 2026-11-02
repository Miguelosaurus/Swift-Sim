#if DEBUG && canImport(UIKit) && os(iOS)
import UIKit

/// Exists only during explicit inspection. A frozen snapshot, never a display loop.
@MainActor
final class SwiftSimInspectionOverlay: UIView, UIGestureRecognizerDelegate {
    private let snapshot: SwiftSimScreenInspection
    private let outline = CAShapeLayer()
    private let selectionOutline = CAShapeLayer()
    private let details = UILabel()
    private let bottom = UIView()
    private let onClose: () -> Void
    private(set) var selectionPoint: CGPoint?
    private(set) var selectedCandidate: SwiftSimScreenInspection.Element?
    private var initialSize = CGSize.zero
    private weak var picker: UIAlertController?
    var presentingPicker: Bool { picker?.presentingViewController != nil }

    init(snapshot: SwiftSimScreenInspection, onClose: @escaping () -> Void) {
        self.snapshot = snapshot; self.onClose = onClose
        super.init(frame: .zero)
        backgroundColor = .clear
        accessibilityViewIsModal = true
        outline.fillColor = UIColor.clear.cgColor
        outline.strokeColor = UIColor.systemTeal.withAlphaComponent(0.5).cgColor
        outline.lineWidth = 1
        selectionOutline.fillColor = UIColor.systemTeal.withAlphaComponent(0.12).cgColor
        selectionOutline.strokeColor = UIColor.systemTeal.cgColor
        selectionOutline.lineWidth = 3
        layer.addSublayer(outline); layer.addSublayer(selectionOutline)
        let header = UIStackView(); header.axis = .horizontal; header.spacing = 12; header.alignment = .center
        header.backgroundColor = .secondarySystemBackground; header.layer.cornerRadius = 16
        header.isLayoutMarginsRelativeArrangement = true
        header.layoutMargins = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        let title = UILabel(); title.text = "Inspect screen"; title.font = .preferredFont(forTextStyle: .headline)
        title.adjustsFontForContentSizeCategory = true
        let done = UIButton(type: .system); done.setTitle("Done", for: .normal)
        done.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        done.addAction(UIAction { [weak self] _ in self?.onClose() }, for: .touchUpInside)
        let choose = UIButton(type: .system); choose.setTitle("Elements", for: .normal)
        choose.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        choose.addAction(UIAction { [weak self, weak choose] _ in
            guard let self, let choose else { return }; self.chooseElement(from: choose)
        }, for: .touchUpInside)
        header.addArrangedSubview(title); header.addArrangedSubview(choose); header.addArrangedSubview(done)
        bottom.backgroundColor = .secondarySystemBackground; bottom.layer.cornerRadius = 16
        details.font = .preferredFont(forTextStyle: .subheadline); details.adjustsFontForContentSizeCategory = true
        details.numberOfLines = 5
        details.text = snapshot.elements.isEmpty
            ? (snapshot.truncated ? "Inspection reached its work limit before elements were available. Close and inspect again when the screen is settled."
                : "No elements exposed by this screen. Custom drawing and some SwiftUI content cannot be inspected.")
            : "Tap an outlined element for details.\(snapshot.truncated ? " Showing a partial snapshot." : "")\nThis is a snapshot; close inspection to interact with the app."
        bottom.addSubview(details)
        for view in [header, bottom, details] { view.translatesAutoresizingMaskIntoConstraints = false }
        addSubview(header); addSubview(bottom)
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 8),
            header.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            header.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            bottom.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -8),
            bottom.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            bottom.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            details.topAnchor.constraint(equalTo: bottom.topAnchor, constant: 12),
            details.bottomAnchor.constraint(equalTo: bottom.bottomAnchor, constant: -12),
            details.leadingAnchor.constraint(equalTo: bottom.leadingAnchor, constant: 12),
            details.trailingAnchor.constraint(equalTo: bottom.trailingAnchor, constant: -12),
        ])
        let tap = UITapGestureRecognizer(target: self, action: #selector(selected(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        addGestureRecognizer(tap)
        accessibilityLabel = "Screen inspector"
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init(snapshot:onClose:)") }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        var view = touch.view
        while let current = view, current !== self {
            if current is UIControl { return false }
            view = current.superview
        }
        return true
    }

    private func chooseElement(from button: UIButton) {
        guard !presentingPicker, var presenter = window?.rootViewController else { return }
        while let next = presenter.presentedViewController { presenter = next }
        guard !presenter.isBeingDismissed, !presenter.isBeingPresented else { return }
        let list = UIAlertController(title: "Screen elements", message: "Choose an element to inspect.", preferredStyle: .actionSheet)
        for element in snapshot.elements {
            list.addAction(UIAlertAction(title: "\(element.id) · \(element.label ?? element.role)", style: .default) { [weak self] _ in
                self?.select(element)
            })
        }
        list.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        list.popoverPresentationController?.sourceView = button
        list.popoverPresentationController?.sourceRect = button.bounds
        picker = list
        presenter.present(list, animated: !UIAccessibility.isReduceMotionEnabled)
    }

    override func willMove(toSuperview newSuperview: UIView?) {
        if newSuperview == nil { picker?.dismiss(animated: false); picker = nil }
        super.willMove(toSuperview: newSuperview)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        if initialSize != .zero && initialSize != bounds.size {
            // Never leave stale rectangles over a rotated layout.
            onClose(); return
        }
        initialSize = bounds.size
        let path = UIBezierPath()
        for element in snapshot.elements { path.append(UIBezierPath(rect: rect(element))) }
        CATransaction.begin(); CATransaction.setDisableActions(true)
        outline.frame = bounds; outline.path = path.cgPath; selectionOutline.frame = bounds
        CATransaction.commit()
    }

    @objc private func selected(_ recognizer: UITapGestureRecognizer) {
        let point = recognizer.location(in: self)
        guard let id = SwiftSimScreenInspection.selection(at: point, in: snapshot.elements),
              let element = snapshot.elements.first(where: { $0.id == id }) else { return }
        select(element, point: point)
    }

    private func select(_ element: SwiftSimScreenInspection.Element, point: CGPoint? = nil) {
        selectedCandidate = element
        selectionPoint = point ?? CGPoint(x: rect(element).midX, y: rect(element).midY)
        let state = element.enabled.map { $0 ? "Enabled" : "Disabled" }
        details.text = [element.label ?? "Unlabelled \(element.role)",
            [element.role, state, element.selected ? "Selected" : nil].compactMap { $0 }.joined(separator: " · "),
            "\(Int(element.frame[2])) × \(Int(element.frame[3])) pt",
            element.identifier.map { "ID: \($0)" }].compactMap { $0 }.joined(separator: "\n")
        CATransaction.begin(); CATransaction.setDisableActions(true)
        selectionOutline.path = UIBezierPath(rect: rect(element)).cgPath
        CATransaction.commit()
        UIAccessibility.post(notification: .announcement, argument: details.text)
    }

    private func rect(_ element: SwiftSimScreenInspection.Element) -> CGRect {
        CGRect(x: element.frame[0], y: element.frame[1], width: element.frame[2], height: element.frame[3])
    }
}
#endif
