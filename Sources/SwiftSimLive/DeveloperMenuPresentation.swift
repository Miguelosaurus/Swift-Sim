#if DEBUG && canImport(UIKit) && os(iOS)
import UIKit
import Combine

/// UIKit keeps this small tool sheet independent of the host's SwiftUI
/// navigation/list caches. The entire hierarchy exists only while presented.
@MainActor
final class SwiftSimDeveloperMenuSheetController: UIViewController, UITextFieldDelegate {
    private let model: SwiftSimDeveloperMenuCoordinator
    private var observation: AnyCancellable?
    private var renderScheduled = false
    private let context = UIStackView()
    private let connection = UILabel()
    private let latest = UILabel()
    private let appearance = UIButton(type: .system)
    private let textSize = UIButton(type: .system)
    private let layoutDirection = UIButton(type: .system)
    private let tools = UISwitch()
    private let screenshot = UIImageView()
    private let include = UISwitch()
    private let note = UITextField()
    private let status = UILabel()
    private let save = UIButton(type: .system)
    private var refreshButton: UIButton?
    private var inspectButton: UIButton?
    private var shareButton: UIButton?
    private var imageRow: UIView?
    private var imageHeight: NSLayoutConstraint?

    init(model: SwiftSimDeveloperMenuCoordinator) {
        self.model = model
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("Use init(model:)") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemGroupedBackground
        view.tintColor = .systemTeal
        let title = label(model.page == .menu ? "Developer tools" : "Share a problem", style: .headline)
        let done = button("Done", symbol: nil) { [weak self] in self?.model.close() }
        done.setContentHuggingPriority(.required, for: .horizontal)
        let bar = UIStackView(arrangedSubviews: [title, done])
        bar.axis = .horizontal; bar.alignment = .center
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)

        let scroll = UIScrollView()
        scroll.keyboardDismissMode = .interactive
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        let stack = UIStackView()
        stack.axis = .vertical; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            bar.heightAnchor.constraint(greaterThanOrEqualToConstant: 40),
            scroll.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 12),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40),
        ])

        if model.page == .menu {
            buildMenu(in: stack)
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor).isActive = true
        } else {
            buildReport(in: stack)
            var config = UIButton.Configuration.filled()
            config.cornerStyle = .capsule
            config.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 20, bottom: 14, trailing: 20)
            save.configuration = config
            save.addAction(UIAction { [weak self] _ in self?.model.saveReport() }, for: .touchUpInside)
            save.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(save)
            NSLayoutConstraint.activate([
                save.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
                save.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
                save.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12),
                save.heightAnchor.constraint(greaterThanOrEqualToConstant: 50),
                scroll.bottomAnchor.constraint(equalTo: save.topAnchor, constant: -12),
            ])
        }
        render()
        observation = model.objectWillChange.sink { [weak self] _ in self?.scheduleRender() }
    }

    private func buildMenu(in stack: UIStackView) {
        context.axis = .vertical; context.spacing = 4
        context.addArrangedSubview(label(model.appName, style: .headline))
        context.addArrangedSubview(label(model.version, style: .caption1, secondary: true))
        configure(connection, style: .subheadline, secondary: true)
        configure(latest, style: .caption1, secondary: true)
        context.addArrangedSubview(connection); context.addArrangedSubview(latest)
        stack.addArrangedSubview(card(context))

        let actions = UIStackView(); actions.axis = .vertical; actions.spacing = 8
        actions.addArrangedSubview(button("Share a problem", symbol: "bubble.left.and.text.bubble.right") { [weak self] in self?.model.prepareReport() })
        let inspect = button("Inspect screen", symbol: "viewfinder") { [weak self] in self?.model.inspectScreen() }
        inspectButton = inspect
        actions.addArrangedSubview(inspect)
        let refresh = button("Refresh screen", symbol: "arrow.clockwise") { [weak self] in self?.model.refreshScreen() }
        refresh.accessibilityIdentifier = "swiftSimRefreshScreen"
        refresh.accessibilityHint = "Recreates the screen; may reset temporary screen state."
        refreshButton = refresh
        actions.addArrangedSubview(refresh)
        actions.addArrangedSubview(label("Recreates the screen; may reset temporary screen state.", style: .caption1, secondary: true))
        appearance.showsMenuAsPrimaryAction = true
        appearance.contentHorizontalAlignment = .leading
        appearance.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        actions.addArrangedSubview(appearance)
        if #available(iOS 17.0, *) {
            for control in [textSize, layoutDirection] {
                control.showsMenuAsPrimaryAction = true
                control.contentHorizontalAlignment = .leading
                control.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
                actions.addArrangedSubview(control)
            }
        }
        stack.addArrangedSubview(card(actions))
        tools.addAction(UIAction { [weak self] _ in
            guard let self else { return }; self.model.showLauncher = self.tools.isOn
        }, for: .valueChanged)
        stack.addArrangedSubview(row("Show tools button", control: tools))
        stack.addArrangedSubview(label("Hold three fingers to open these tools. Drag the tools button to move it. Environment changes last for this session.", style: .footnote, secondary: true))
    }

    private func buildReport(in stack: UIStackView) {
        screenshot.contentMode = .scaleAspectFit
        screenshot.isAccessibilityElement = true
        screenshot.accessibilityLabel = "Screenshot preview of the current app"
        imageHeight = screenshot.heightAnchor.constraint(equalToConstant: 240)
        imageHeight?.isActive = true
        stack.addArrangedSubview(screenshot)
        include.addAction(UIAction { [weak self] _ in
            guard let self else { return }; self.model.includeImage = self.include.isOn
        }, for: .valueChanged)
        let row = row("Include screenshot", control: include)
        imageRow = row; stack.addArrangedSubview(row)
        note.placeholder = "What happened? (optional)"
        note.accessibilityLabel = "What happened? (optional)"
        note.borderStyle = .roundedRect
        note.font = .preferredFont(forTextStyle: .body)
        note.adjustsFontForContentSizeCategory = true
        note.returnKeyType = .done; note.delegate = self
        note.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        note.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            let text = SwiftSimDeveloperReportLimits.boundedNote(self.note.text ?? "")
            if self.note.text != text { self.note.text = text }
            if self.model.note != text { self.model.note = text }
        }, for: .editingChanged)
        stack.addArrangedSubview(note)
        stack.addArrangedSubview(label("Includes this Debug build and Swift Sim update diagnostics. Review the screenshot before sharing; it may contain app data.", style: .footnote, secondary: true))
        let share = button("Share…", symbol: "square.and.arrow.up") { [weak self] in self?.model.shareReport() }
        shareButton = share; stack.addArrangedSubview(share)
        configure(status, style: .footnote, secondary: true)
        stack.addArrangedSubview(status)
        stack.addArrangedSubview(label("Your agent can retrieve the report when needed. Nothing is added to a chat automatically.", style: .footnote, secondary: true))
    }

    private func scheduleRender() {
        guard !renderScheduled else { return }
        renderScheduled = true
        DispatchQueue.main.async { [weak self] in
            self?.renderScheduled = false
            self?.render()
        }
    }

    private func render() {
        guard isViewLoaded else { return }
        connection.text = model.connection; latest.text = model.latest
        tools.setOn(model.showLauncher, animated: false)
        appearance.setTitle("Appearance · \(model.appearance.rawValue)  ⌄", for: .normal)
        appearance.accessibilityLabel = "Appearance, \(model.appearance.rawValue)"
        appearance.menu = UIMenu(children: SwiftSimDeveloperMenuCoordinator.Appearance.allCases.map { item in
            UIAction(title: item.rawValue, state: item == model.appearance ? .on : .off) { [weak model] _ in model?.appearance = item }
        })
        if #available(iOS 17.0, *) {
            textSize.setTitle("Text size · \(model.textSize.title)  ⌄", for: .normal)
            textSize.accessibilityLabel = "Text size, \(model.textSize.title)"
            textSize.menu = UIMenu(children: SwiftSimDeveloperMenuCoordinator.TextSize.allCases.map { item in
                UIAction(title: item.title, state: item == model.textSize ? .on : .off) { [weak model] _ in model?.textSize = item }
            })
            layoutDirection.setTitle("Layout direction · \(model.layoutDirection.title)  ⌄", for: .normal)
            layoutDirection.accessibilityLabel = "Layout direction, \(model.layoutDirection.title)"
            layoutDirection.menu = UIMenu(children: SwiftSimDeveloperMenuCoordinator.LayoutDirection.allCases.map { item in
                UIAction(title: item.title, state: item == model.layoutDirection ? .on : .off) { [weak model] _ in model?.layoutDirection = item }
            })
        }
        refreshButton?.isEnabled = model.refreshAllowed
        inspectButton?.isEnabled = model.refreshAllowed
        shareButton?.isEnabled = !model.isSaving && !model.didSave
        screenshot.image = model.image
        screenshot.isHidden = model.image == nil; imageRow?.isHidden = model.image == nil
        imageHeight?.constant = model.image == nil ? 0 : 240
        include.setOn(model.includeImage, animated: false); include.isEnabled = !model.isSaving
        note.isEnabled = !model.isSaving && !model.didSave
        if note.text != model.note { note.text = model.note }
        status.text = model.message; status.isHidden = model.message == nil
        save.setTitle(model.didSave ? "Saved to Mac" : "Save to Mac", for: .normal)
        save.isEnabled = !model.isSaving && !model.didSave
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }

    private func configure(_ value: UILabel, style: UIFont.TextStyle, secondary: Bool = false) {
        value.font = .preferredFont(forTextStyle: style); value.adjustsFontForContentSizeCategory = true
        value.numberOfLines = 0; value.textColor = secondary ? .secondaryLabel : .label
    }

    private func label(_ text: String, style: UIFont.TextStyle, secondary: Bool = false) -> UILabel {
        let result = UILabel(); configure(result, style: style, secondary: secondary); result.text = text; return result
    }

    private func button(_ title: String, symbol: String?, action: @escaping @MainActor () -> Void) -> UIButton {
        let result = UIButton(type: .system)
        var config = UIButton.Configuration.plain()
        config.title = title; config.image = symbol.flatMap { UIImage(systemName: $0) }
        config.imagePadding = 12; config.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0)
        result.configuration = config; result.contentHorizontalAlignment = .leading
        result.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        result.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return result
    }

    private func row(_ title: String, control: UISwitch) -> UIView {
        let text = label(title, style: .body); text.accessibilityElementsHidden = true
        control.accessibilityLabel = title
        let row = UIStackView(arrangedSubviews: [text, control]); row.axis = .horizontal
        row.alignment = .center; row.spacing = 12
        control.setContentHuggingPriority(.required, for: .horizontal)
        return row
    }

    private func card(_ content: UIStackView) -> UIView {
        let box = UIView(); box.backgroundColor = .secondarySystemGroupedBackground
        box.layer.cornerRadius = 20; box.layer.cornerCurve = .continuous
        content.translatesAutoresizingMaskIntoConstraints = false; box.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: box.topAnchor, constant: 16),
            content.bottomAnchor.constraint(equalTo: box.bottomAnchor, constant: -16),
            content.leadingAnchor.constraint(equalTo: box.leadingAnchor, constant: 16),
            content.trailingAnchor.constraint(equalTo: box.trailingAnchor, constant: -16),
        ])
        return box
    }
}
#endif
