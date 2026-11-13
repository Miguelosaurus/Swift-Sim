#if DEBUG && canImport(UIKit) && os(iOS)
import Foundation
import SwiftUI
import UIKit
import ImageIO
import UniformTypeIdentifiers
import InjectionBundle

private struct SwiftSimEncodedCapture: @unchecked Sendable {
    let data: Data
    let thumbnail: CGImage
}

private struct SwiftSimImmutableCapture: @unchecked Sendable {
    // CGImage is immutable. UIKit hierarchy access finishes on the main actor.
    let image: CGImage

    func encode() -> SwiftSimEncodedCapture? {
        autoreleasepool {
            for quality in [0.8, 0.6, 0.4] {
                let bytes = NSMutableData()
                guard let destination = CGImageDestinationCreateWithData(
                    bytes, UTType.jpeg.identifier as CFString, 1, nil
                ) else { return nil }
                CGImageDestinationAddImage(destination, image,
                    [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
                if CGImageDestinationFinalize(destination), bytes.length <= SwiftSimDeveloperReportLimits.imageBytes {
                    let data = bytes as Data
                    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                          let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                            kCGImageSourceCreateThumbnailFromImageAlways: true,
                            kCGImageSourceThumbnailMaxPixelSize: 560,
                            kCGImageSourceShouldCacheImmediately: true,
                          ] as CFDictionary) else { return nil }
                    return SwiftSimEncodedCapture(data: data, thumbnail: thumbnail)
                }
            }
            return nil
        }
    }
}

@MainActor
final class SwiftSimDeveloperMenuCoordinator: NSObject, ObservableObject,
    UIGestureRecognizerDelegate, UIAdaptivePresentationControllerDelegate {
    private final class WeakOwner {
        weak var value: SwiftSimDeveloperMenuCoordinator?
        init(_ value: SwiftSimDeveloperMenuCoordinator) { self.value = value }
    }

    private static var owners: [ObjectIdentifier: WeakOwner] = [:]
    private weak var window: UIWindow?
    private var hold: UILongPressGestureRecognizer?
    private var launcher: UIButton?
    private var launcherPosition = SwiftSimDeveloperLauncherPosition()
    private var launcherCenterX: NSLayoutConstraint?
    private var launcherCenterY: NSLayoutConstraint?
    private var launcherDragOrigin = CGPoint.zero
    private var draggingLauncher = false
    private var appearanceOriginal: UIUserInterfaceStyle?
    private var appearanceWritten: UIUserInterfaceStyle?
    private var textSizeOriginal: UIContentSizeCategory?
    private var textSizeWritten: UIContentSizeCategory?
    private var directionOriginal: UITraitEnvironmentLayoutDirection?
    private var directionWritten: UITraitEnvironmentLayoutDirection?
    private var observers: [NSObjectProtocol] = []
    private var captureTask: Task<Void, Never>?
    private var timeoutTask: Task<Void, Never>?
    private var operation = UUID()
    private var receipt = SwiftSimDeveloperReportReceipt()
    private var remoteOperation: String?
    private var jpeg: Data?
    private var metadata: [String: Any] = [:]
    private var refresh: (() -> Void)?
    private var feedback: SwiftSimDeliveryFeedbackState?
    private weak var sheet: UIViewController?
    private var inspector: SwiftSimInspectionOverlay?

    @Published private(set) var page = Page.menu
    @Published private(set) var connection = "Not connected to Mac"
    @Published private(set) var latest = "No hot reload confirmed in this session"
    @Published private(set) var refreshAllowed = true
    @Published private(set) var image: UIImage?
    @Published private(set) var message: String?
    @Published private(set) var isSaving = false
    @Published private(set) var didSave = false
    @Published var note = ""
    @Published var includeImage = true
    @Published var showLauncher = false { didSet { updateLauncher() } }
    @Published var appearance = Appearance.appDefault { didSet { applyAppearance() } }

    @Published var textSize = TextSize.appDefault { didSet { applyTextSize() } }
    @Published var layoutDirection = LayoutDirection.appDefault { didSet { applyLayoutDirection() } }

    enum Page { case menu, report }
    enum Appearance: String, CaseIterable, Identifiable {
        case appDefault = "App default", light = "Light", dark = "Dark"
        var id: Self { self }
        var style: UIUserInterfaceStyle {
            switch self { case .appDefault: .unspecified; case .light: .light; case .dark: .dark }
        }
    }

    var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "Debug app"
    }
    var version: String {
        let value = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return value.isEmpty ? "Build \(build) · Debug" : "Version \(value) · Build \(build) · Debug"
    }

    func update(feedback: SwiftSimDeliveryFeedbackState?, refresh: @escaping () -> Void) {
        if let feedback, feedback.phase.rank != 3 { closeInspection() }
        self.feedback = feedback
        self.refresh = refresh
        refreshAllowed = feedback == nil || feedback!.phase.rank == 3
        if let feedback {
            latest = feedback.phase == .refreshed
                ? "Hot reload applied · Revision \(feedback.revision ?? 0)" : feedback.phase.title
        }
        layoutLauncher()
    }

    func attach(to candidate: UIWindow?) {
        guard candidate !== window else { return }
        detach()
        guard let candidate else { return }
        let key = ObjectIdentifier(candidate)
        if let owner = Self.owners[key]?.value, owner !== self { return }
        Self.owners = Self.owners.filter { $0.value.value != nil }
        Self.owners[key] = WeakOwner(self)
        window = candidate
        let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        recognizer.numberOfTouchesRequired = 3
        recognizer.minimumPressDuration = 0.7
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        recognizer.delegate = self
        candidate.addGestureRecognizer(recognizer)
        hold = recognizer
        let center = NotificationCenter.default
        for name in [UIAccessibility.voiceOverStatusDidChangeNotification,
                     UIAccessibility.switchControlStatusDidChangeNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.updateLauncher() }
            })
        }
        observers.append(center.addObserver(forName: UIScene.willDeactivateNotification,
            object: candidate.windowScene, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.close() }
            })
        observers.append(center.addObserver(forName: Notification.Name("SWIFT_SIM_DEVELOPER_CONNECTION_CHANGED"),
            object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.readConnection() }
            })
        observers.append(center.addObserver(forName: Notification.Name("SWIFT_SIM_DEVELOPER_REPORT_RESULT"),
            object: nil, queue: .main) { [weak self] event in
                let id = event.userInfo?["report_id"] as? String
                let saved = event.userInfo?["saved"] as? Bool
                MainActor.assumeIsolated {
                    guard let id, let saved else { return }
                    self?.acknowledge(["report_id": id, "saved": saved])
                }
            })
        observers.append(center.addObserver(forName: Notification.Name("SWIFT_SIM_DEVELOPER_TOOL_REQUEST"),
            object: nil, queue: .main) { [weak self] event in
                let id = event.userInfo?["operation_id"] as? String
                let tool = event.userInfo?["tool"] as? String
                let value = event.userInfo?["value"] as? String
                let scene = event.userInfo?["target_scene"] as? String
                let revision = event.userInfo?["expected_revision"] as? Int
                let nonce = event.userInfo?["expected_connection_nonce"] as? String
                let expires = event.userInfo?["expires_at_uptime"] as? Double
                MainActor.assumeIsolated {
                    guard let id, let tool else { return }
                    var info: [AnyHashable: Any] = ["operation_id": id, "tool": tool]
                    if let value { info["value"] = value }
                    if let scene { info["target_scene"] = scene }
                    if let revision { info["expected_revision"] = revision }
                    if let nonce { info["expected_connection_nonce"] = nonce }
                    if let expires { info["expires_at_uptime"] = expires }
                    self?.performRemoteTool(info)
                }
            })
        updateLauncher()
    }

    func detach() {
        close(animated: false)
        restoreAppearance()
        restoreTextSize()
        restoreLayoutDirection()
        if let window {
            if let hold { window.removeGestureRecognizer(hold) }
            let key = ObjectIdentifier(window)
            if Self.owners[key]?.value === self { Self.owners.removeValue(forKey: key) }
        }
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        launcher?.removeFromSuperview()
        launcher = nil
        launcherCenterX = nil
        launcherCenterY = nil
        hold = nil
        window = nil
    }

    @objc private func held(_ recognizer: UILongPressGestureRecognizer) {
        if recognizer.state == .began { open() }
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        // The menu and accessibility launcher do not recursively activate the gesture.
        guard sheet == nil, inspector == nil, !UIAccessibility.isVoiceOverRunning,
              !UIAccessibility.isSwitchControlRunning else { return false }
        return true
    }

    private func updateLauncher() {
        let visible = showLauncher || UIAccessibility.isVoiceOverRunning || UIAccessibility.isSwitchControlRunning
        guard let window else { return }
        guard visible else {
            launcher?.removeFromSuperview(); launcher = nil
            launcherCenterX = nil; launcherCenterY = nil
            return
        }
        if launcher == nil {
            let button = UIButton(type: .system)
            var config = UIButton.Configuration.filled()
            config.image = UIImage(systemName: "hammer")
            config.baseBackgroundColor = .systemTeal
            config.cornerStyle = .capsule
            button.configuration = config
            button.accessibilityLabel = "Swift Sim developer menu"
            button.accessibilityHint = "Opens developer tools. Drag to move the button."
            button.accessibilityCustomActions = [
                UIAccessibilityCustomAction(name: "Move tools left", target: self, selector: #selector(moveLauncherLeft)),
                UIAccessibilityCustomAction(name: "Move tools right", target: self, selector: #selector(moveLauncherRight)),
                UIAccessibilityCustomAction(name: "Move tools up", target: self, selector: #selector(moveLauncherUp)),
                UIAccessibilityCustomAction(name: "Move tools down", target: self, selector: #selector(moveLauncherDown)),
            ]
            button.addTarget(self, action: #selector(open), for: .touchUpInside)
            let pan = UIPanGestureRecognizer(target: self, action: #selector(dragLauncher(_:)))
            pan.maximumNumberOfTouches = 1
            button.addGestureRecognizer(pan)
            button.translatesAutoresizingMaskIntoConstraints = false
            window.addSubview(button)
            let center = launcherPosition.center(in: launcherSafeRect(window))
            launcherCenterX = button.centerXAnchor.constraint(equalTo: window.leftAnchor, constant: center.x)
            launcherCenterY = button.centerYAnchor.constraint(equalTo: window.topAnchor, constant: center.y)
            NSLayoutConstraint.activate([
                button.widthAnchor.constraint(equalToConstant: 44), button.heightAnchor.constraint(equalToConstant: 44),
                launcherCenterX!, launcherCenterY!
            ])
            launcher = button
        }
        launcher?.isHidden = sheet != nil
    }

    private func launcherSafeRect(_ window: UIWindow) -> CGRect {
        window.safeAreaLayoutGuide.layoutFrame.insetBy(dx: 12, dy: 8)
    }

    fileprivate func layoutLauncher() {
        guard let window, launcher != nil, !draggingLauncher else { return }
        let center = launcherPosition.center(in: launcherSafeRect(window))
        launcherCenterX?.constant = center.x
        launcherCenterY?.constant = center.y
    }

    @objc private func dragLauncher(_ pan: UIPanGestureRecognizer) {
        guard let window, let launcher else { return }
        if pan.state == .began { launcherDragOrigin = launcher.center; draggingLauncher = true }
        let translation = pan.translation(in: window)
        let safe = launcherSafeRect(window)
        let topLeft = SwiftSimDeveloperLauncherPosition(leading: true, verticalFraction: 0).center(in: safe)
        let bottomRight = SwiftSimDeveloperLauncherPosition(leading: false, verticalFraction: 1).center(in: safe)
        let point = CGPoint(x: min(bottomRight.x, max(topLeft.x, launcherDragOrigin.x + translation.x)),
                            y: min(bottomRight.y, max(topLeft.y, launcherDragOrigin.y + translation.y)))
        if pan.state == .changed || pan.state == .began {
            launcherCenterX?.constant = point.x
            launcherCenterY?.constant = point.y
            window.layoutIfNeeded()
        } else if pan.state == .ended || pan.state == .cancelled {
            draggingLauncher = false
            launcherPosition.snap(from: point, in: safe)
            layoutLauncher()
            UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2) { window.layoutIfNeeded() }
        }
    }

    @objc private func moveLauncherLeft() -> Bool { launcherPosition.leading = true; layoutLauncher(); return true }
    @objc private func moveLauncherRight() -> Bool { launcherPosition.leading = false; layoutLauncher(); return true }
    @objc private func moveLauncherUp() -> Bool {
        launcherPosition.verticalFraction = max(0, launcherPosition.verticalFraction - 0.2); layoutLauncher(); return true
    }
    @objc private func moveLauncherDown() -> Bool {
        launcherPosition.verticalFraction = min(1, launcherPosition.verticalFraction + 0.2); layoutLauncher(); return true
    }

    private func readConnection() {
        guard sheet != nil else { return }
        let state = InjectionDeveloperConnectionState() as? [String: Any] ?? [:]
        connection = state["connected"] as? Bool == true ? "Connected to Mac" : "Not connected to Mac"
        if state["connected"] as? Bool != true, isSaving {
            timeoutTask?.cancel()
            receipt.cancel()
            isSaving = false
            message = "Connection lost. Saving is unconfirmed; check the report on your Mac before retrying."
        }
    }

    private func performRemoteTool(_ info: [AnyHashable: Any]?) {
        guard let info, let id = info["operation_id"] as? String, UUID(uuidString: id) != nil,
              let tool = info["tool"] as? String, ["appearance", "text-size", "layout-direction", "refresh", "inspect"].contains(tool) else { return }
        // Ignore broadcasts owned by another coordinator; its negative reply
        // must not race the selected scene's actual result.
        guard let window, let target = info["target_scene"] as? String,
              window.windowScene?.session.persistentIdentifier == target,
              window.isKeyWindow else { return }
        let native = InjectionDeveloperConnectionState() as? [String: Any] ?? [:]
        guard let expiry = info["expires_at_uptime"] as? Double, expiry.isFinite,
              ProcessInfo.processInfo.systemUptime < expiry,
              let expectedRevision = info["expected_revision"] as? Int,
              let expectedNonce = info["expected_connection_nonce"] as? String,
              native["root_revision"] as? Int == expectedRevision,
              native["connection_nonce"] as? String == expectedNonce else {
            _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_TOOL_UNCONFIRMED"])
            return
        }
        guard window.windowScene?.activationState == .foregroundActive,
              native["is_active"] as? Bool == true, native["root_ready"] as? Bool == true else {
            _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_FOREGROUND_REQUIRED"])
            return
        }
        guard remoteOperation == nil, captureTask == nil, !isSaving, refreshAllowed else {
            _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_BUSY"])
            return
        }
        remoteOperation = id
        defer { remoteOperation = nil }
        if tool == "inspect" {
            guard sheet == nil else {
                _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_INSPECTION_UNAVAILABLE"])
                return
            }
            let ticket = operation
            captureTask = Task { [weak self, weak window] in
                guard let self, let window else {
                    _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_INSPECTION_UNAVAILABLE"])
                    return
                }
                let snapshot = await self.inspectWhenReady(window: window)
                guard self.operation == ticket else {
                    _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_INSPECTION_UNAVAILABLE"])
                    return
                }
                self.captureTask = nil
                let current = InjectionDeveloperConnectionState() as? [String: Any] ?? [:]
                guard !Task.isCancelled, self.refreshAllowed,
                      current["connection_nonce"] as? String == expectedNonce,
                      current["root_ready"] as? Bool == true, current["is_active"] as? Bool == true,
                      let snapshot, let data = snapshot.dictionary(),
                      self.captureIdentity().nativeRevision == expectedRevision,
                      ProcessInfo.processInfo.systemUptime < expiry else {
                    _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_INSPECTION_UNAVAILABLE"])
                    return
                }
                _ = InjectionCompleteDeveloperTool(id, ["success": true, "tool": tool, "inspection": data])
            }
        } else if inspector != nil {
            _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_BUSY"])
        } else if tool == "appearance" {
            let mode: Appearance
            switch info["value"] as? String {
            case "app-default": mode = .appDefault
            case "light": mode = .light
            case "dark": mode = .dark
            default:
                _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_TOOL_UNSUPPORTED"])
                return
            }
            appearance = mode
            _ = InjectionCompleteDeveloperTool(id, ["success": true, "tool": tool])
        } else if tool == "text-size" || tool == "layout-direction" {
            guard #available(iOS 17.0, *), let value = info["value"] as? String else {
                _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_TOOL_UNSUPPORTED"])
                return
            }
            if tool == "text-size", let mode = TextSize(rawValue: value) {
                textSize = mode
            } else if tool == "layout-direction", let mode = LayoutDirection(rawValue: value) {
                layoutDirection = mode
            } else {
                _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_TOOL_UNSUPPORTED"])
                return
            }
            _ = InjectionCompleteDeveloperTool(id, ["success": true, "tool": tool])
        } else if let refresh {
            // An explicit agent action requests only local presentation recreation.
            // It does not advance native revision or emit a replacement receipt.
            refresh()
            _ = InjectionCompleteDeveloperTool(id, ["success": true, "tool": tool, "presentation_only": true])
        } else {
            _ = InjectionCompleteDeveloperTool(id, ["success": false, "error": "DEVELOPER_TOOL_UNAVAILABLE"])
        }
    }

    private func presenter() -> UIViewController? {
        guard let window, window.windowScene?.activationState == .foregroundActive,
              !window.isHidden, let root = window.rootViewController else { return nil }
        var current = root
        while let presented = current.presentedViewController { current = presented }
        guard !current.isBeingDismissed, !current.isBeingPresented,
              !(current is UIAlertController), !(current is UIActivityViewController) else { return nil }
        return current
    }

    @objc func open() {
        guard sheet == nil, inspector == nil else { return }
        resetReport()
        page = .menu
        present()
    }

    private func present() {
        guard sheet == nil, let presenter = presenter() else { return }
        let host = SwiftSimDeveloperMenuSheetController(model: self)
        host.modalPresentationStyle = .pageSheet
        host.sheetPresentationController?.detents = [.medium(), .large()]
        host.sheetPresentationController?.selectedDetentIdentifier = page == .report ? .large : .medium
        host.sheetPresentationController?.prefersGrabberVisible = true
        sheet = host
        host.presentationController?.delegate = self
        presenter.present(host, animated: !UIAccessibility.isReduceMotionEnabled)
        updateLauncher()
        readConnection()
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        sheet = nil
        resetReport()
        updateLauncher()
    }

    func close(animated: Bool = true) {
        closeInspection()
        let presented = sheet
        sheet = nil
        resetReport()
        presented?.dismiss(animated: animated && !UIAccessibility.isReduceMotionEnabled)
        updateLauncher()
    }

    private func inspect(window: UIWindow) async -> SwiftSimScreenInspection? {
        guard inspector?.presentingPicker != true else { return nil }
        let excluded = [launcher, inspector].compactMap { $0 }
        return await SwiftSimScreenInspector.capture(window: window, excluding: excluded,
            revision: captureIdentity().nativeRevision, selection: inspector?.selectionPoint,
            selectedCandidate: inspector?.selectedCandidate)
    }

    private func inspectWhenReady(window: UIWindow) async -> SwiftSimScreenInspection? {
        let identity = captureIdentity()
        guard !Task.isCancelled, refreshAllowed else { return nil }
        let snapshot = await inspect(window: window)
        guard !Task.isCancelled, captureIdentity() == identity, refreshAllowed,
              self.window === window, window.isKeyWindow,
              window.windowScene?.activationState == .foregroundActive else { return nil }
        return snapshot
    }

    func inspectScreen() {
        guard refreshAllowed, inspector == nil, let window, let presented = sheet else { return }
        sheet = nil
        resetReport()
        let ticket = operation
        presented.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) { [weak self, weak window] in
            guard let self, let window, self.operation == ticket, self.refreshAllowed else { return }
            self.captureTask = Task { [weak self, weak window] in
                guard let self, let window else { return }
                let snapshot = await self.inspectWhenReady(window: window)
                guard !Task.isCancelled, self.operation == ticket, self.refreshAllowed else { return }
                self.captureTask = nil
                guard let snapshot else { return }
                let overlay = SwiftSimInspectionOverlay(snapshot: snapshot) { [weak self] in self?.closeInspection() }
                self.inspector = overlay
                overlay.frame = window.bounds
                overlay.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                window.addSubview(overlay)
                self.launcher?.isHidden = true
            }
        }
    }

    private func closeInspection() {
        guard inspector != nil else { return }
        inspector?.removeFromSuperview()
        inspector = nil
        updateLauncher()
    }

    private func resetReport() {
        operation = UUID()
        captureTask?.cancel(); captureTask = nil
        timeoutTask?.cancel(); timeoutTask = nil
        receipt.cancel()
        jpeg = nil
        image = nil
        metadata = [:]
        note = ""
        includeImage = true
        message = nil
        isSaving = false
        didSave = false
    }

    func refreshScreen() {
        guard refreshAllowed else { return }
        let presented = sheet
        sheet = nil
        resetReport()
        presented?.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] in
            guard let self, self.refreshAllowed else { return }
            self.refresh?()
        }
        updateLauncher()
    }

    private func applyTextSize() {
        guard #available(iOS 17.0, *), let window else { return }
        guard let category = textSize.category else { restoreTextSize(); return }
        if textSizeWritten == nil || !window.traitOverrides.contains(UITraitPreferredContentSizeCategory.self)
            || window.traitOverrides.preferredContentSizeCategory != textSizeWritten {
            textSizeOriginal = window.traitOverrides.contains(UITraitPreferredContentSizeCategory.self)
                ? window.traitOverrides.preferredContentSizeCategory : nil
        }
        window.traitOverrides.preferredContentSizeCategory = category
        textSizeWritten = category
    }

    private func restoreTextSize() {
        if #available(iOS 17.0, *), let window, let written = textSizeWritten,
           window.traitOverrides.contains(UITraitPreferredContentSizeCategory.self),
           window.traitOverrides.preferredContentSizeCategory == written {
            if let original = textSizeOriginal { window.traitOverrides.preferredContentSizeCategory = original }
            else { window.traitOverrides.remove(UITraitPreferredContentSizeCategory.self) }
        }
        textSizeOriginal = nil; textSizeWritten = nil
    }

    private func applyLayoutDirection() {
        guard #available(iOS 17.0, *), let window else { return }
        guard let direction = layoutDirection.direction else { restoreLayoutDirection(); return }
        if directionWritten == nil || !window.traitOverrides.contains(UITraitLayoutDirection.self)
            || window.traitOverrides.layoutDirection != directionWritten {
            directionOriginal = window.traitOverrides.contains(UITraitLayoutDirection.self)
                ? window.traitOverrides.layoutDirection : nil
        }
        window.traitOverrides.layoutDirection = direction
        directionWritten = direction
    }

    private func restoreLayoutDirection() {
        if #available(iOS 17.0, *), let window, let written = directionWritten,
           window.traitOverrides.contains(UITraitLayoutDirection.self),
           window.traitOverrides.layoutDirection == written {
            if let original = directionOriginal { window.traitOverrides.layoutDirection = original }
            else { window.traitOverrides.remove(UITraitLayoutDirection.self) }
        }
        directionOriginal = nil; directionWritten = nil
    }

    private func applyAppearance() {
        guard let window else { return }
        guard appearance != .appDefault else { restoreAppearance(); return }
        if appearanceOriginal == nil || (appearanceWritten != nil && window.overrideUserInterfaceStyle != appearanceWritten) {
            appearanceOriginal = window.overrideUserInterfaceStyle
        }
        window.overrideUserInterfaceStyle = appearance.style
        appearanceWritten = appearance.style
    }

    private func restoreAppearance() {
        if let window, let original = appearanceOriginal, window.overrideUserInterfaceStyle == appearanceWritten {
            window.overrideUserInterfaceStyle = original
        }
        appearanceOriginal = nil
        appearanceWritten = nil
    }

    func prepareReport() {
        guard let window, window.windowScene?.activationState == .foregroundActive else { return }
        resetReport()
        let ticket = operation
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(SwiftSimDeveloperReportLimits.timeout))
            guard !Task.isCancelled, let self, self.operation == ticket else { return }
            self.operation = UUID()
            self.captureTask?.cancel(); self.captureTask = nil
            self.jpeg = nil; self.image = nil
            self.metadata = self.reportMetadata()
            self.page = .report
            self.message = "Screenshot capture timed out. You can still share the diagnostics."
            self.present()
        }
        let presented = sheet
        sheet = nil
        launcher?.isHidden = true
        presented?.dismiss(animated: !UIAccessibility.isReduceMotionEnabled) { [weak self, weak window] in
            guard let self, let window, self.operation == ticket else { return }
            self.captureTask = Task { [weak self, weak window] in
                await Task.yield()
                guard let self, let window, !Task.isCancelled, self.operation == ticket else { return }
                // Snapshot at the actual draw, not at the earlier menu tap.
                let identity = self.captureIdentity()
                self.metadata = self.reportMetadata()
                let capture = self.refreshAllowed ? self.capture(window: window) : nil
                let encoded = await Task.detached(priority: .userInitiated) { capture?.encode() }.value
                guard !Task.isCancelled, self.operation == ticket,
                      window.windowScene?.activationState == .foregroundActive else { return }
                if identity == self.captureIdentity() {
                    self.jpeg = encoded?.data
                    self.image = encoded.map { UIImage(cgImage: $0.thumbnail) }
                    if encoded == nil { self.message = "Screenshot unavailable. You can still share the diagnostics." }
                } else {
                    // A new native revision/phase invalidates the image-context pair.
                    self.metadata = self.reportMetadata()
                    self.message = "The app changed during capture. You can share the latest diagnostics without a screenshot."
                }
                self.page = .report
                self.captureTask = nil
                self.timeoutTask?.cancel(); self.timeoutTask = nil
                self.present()
            }
        }
    }

    private func captureIdentity() -> SwiftSimDeveloperCaptureIdentity {
        let native = InjectionDeveloperConnectionState() as? [String: Any] ?? [:]
        return SwiftSimDeveloperCaptureIdentity(nativeRevision: native["root_revision"] as? Int ?? -1,
            deliverySequence: feedback?.sequence)
    }

    private func reportMetadata() -> [String: Any] {
        var snapshot: [String: Any] = ["schema_version": 1, "report_id": UUID().uuidString.lowercased(),
            "app_name": SwiftSimDeveloperReportLimits.boundedText(appName, bytes: 256),
            "captured_at": Date().timeIntervalSince1970 * 1_000]
        if let feedback {
            snapshot["phase"] = feedback.phase.rawValue
            snapshot["request_id"] = feedback.requestID
            if let revision = feedback.revision { snapshot["revision"] = revision }
        }
        return snapshot
    }

    private func capture(window: UIWindow) -> SwiftSimImmutableCapture? {
        guard window === self.window, window.windowScene?.activationState == .foregroundActive,
              let scale = SwiftSimDeveloperReportLimits.scale(width: window.bounds.width,
                  height: window.bounds.height, nativeScale: window.screen.scale) else { return nil }
        let format = UIGraphicsImageRendererFormat()
        // Integer pixel dimensions avoid renderer rounding above the hard cap.
        format.scale = 1
        format.preferredRange = .standard
        format.opaque = true
        let size = CGSize(width: floor(window.bounds.width * scale), height: floor(window.bounds.height * scale))
        guard size.width > 0, size.height > 0 else { return nil }
        var complete = false
        let result = UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.systemBackground.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            context.cgContext.scaleBy(x: scale, y: scale)
            context.cgContext.translateBy(x: -window.bounds.minX, y: -window.bounds.minY)
            complete = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard complete, let image = result.cgImage,
              image.width * image.height <= Int(SwiftSimDeveloperReportLimits.pixels) else { return nil }
        return SwiftSimImmutableCapture(image: image)
    }

    func saveReport() {
        guard !isSaving, !didSave, let id = metadata["report_id"] as? String else { return }
        guard refreshAllowed else {
            message = "Wait for the hot reload to finish before saving the report."
            return
        }
        var snapshot = metadata
        let text = SwiftSimDeveloperReportLimits.boundedNote(note)
        if !text.isEmpty { snapshot["note"] = text }
        guard let bytes = try? JSONSerialization.data(withJSONObject: snapshot),
              bytes.count <= SwiftSimDeveloperReportLimits.metadataBytes,
              receipt.begin(id: id, now: ProcessInfo.processInfo.systemUptime) else { return }
        let data = includeImage ? (jpeg ?? Data()) : Data()
        isSaving = true
        message = "Saving to your connected Mac…"
        guard InjectionSubmitDeveloperReport(snapshot, data) else {
            receipt.cancel(); isSaving = false
            message = "Your Mac is unavailable or needs an update. You can use Share instead."
            return
        }
        timeoutTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(SwiftSimDeveloperReportLimits.timeout))
            guard !Task.isCancelled, let self,
                  self.receipt.expire(now: ProcessInfo.processInfo.systemUptime) else { return }
            self.isSaving = false
            self.message = "Saving is unconfirmed. Check the report on your Mac before retrying."
        }
    }

    private func acknowledge(_ info: [AnyHashable: Any]?) {
        guard let info, let id = info["report_id"] as? String, let saved = info["saved"] as? Bool,
              receipt.acknowledge(id: id, saved: saved, now: ProcessInfo.processInfo.systemUptime) else { return }
        timeoutTask?.cancel(); timeoutTask = nil
        isSaving = false
        didSave = saved
        message = saved ? "Saved to Mac. Your agent can retrieve this report." : "The report could not be saved. You can use Share instead."
        if saved { jpeg = nil; image = nil }
    }

    func shareReport() {
        guard let sheet, !isSaving else { return }
        var snapshot = metadata
        let text = SwiftSimDeveloperReportLimits.boundedNote(note)
        if !text.isEmpty { snapshot["note"] = text }
        guard let data = try? JSONSerialization.data(withJSONObject: snapshot, options: [.prettyPrinted]),
              let diagnostics = String(data: data, encoding: .utf8) else { return }
        var items: [Any] = [diagnostics]
        if includeImage, let jpeg, let original = UIImage(data: jpeg) { items.insert(original, at: 0) }
        let controller = UIActivityViewController(activityItems: items, applicationActivities: nil)
        controller.popoverPresentationController?.sourceView = sheet.view
        controller.popoverPresentationController?.sourceRect = CGRect(x: sheet.view.bounds.midX, y: sheet.view.bounds.midY, width: 1, height: 1)
        sheet.present(controller, animated: !UIAccessibility.isReduceMotionEnabled)
    }
}

struct SwiftSimDeveloperMenuAttachment: UIViewRepresentable {
    let feedback: SwiftSimDeliveryFeedbackState?
    let refresh: () -> Void

    func makeCoordinator() -> SwiftSimDeveloperMenuCoordinator { SwiftSimDeveloperMenuCoordinator() }

    func makeUIView(context: Context) -> AttachmentView {
        let view = AttachmentView()
        view.isUserInteractionEnabled = false
        view.coordinator = context.coordinator
        return view
    }

    func updateUIView(_ view: AttachmentView, context: Context) {
        context.coordinator.update(feedback: feedback, refresh: refresh)
        context.coordinator.attach(to: view.window)
    }

    static func dismantleUIView(_ view: AttachmentView, coordinator: SwiftSimDeveloperMenuCoordinator) {
        coordinator.detach()
    }

    final class AttachmentView: UIView {
        weak var coordinator: SwiftSimDeveloperMenuCoordinator?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            coordinator?.attach(to: window)
        }
        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            coordinator?.layoutLauncher()
        }
        override func layoutSubviews() {
            super.layoutSubviews()
            coordinator?.layoutLauncher()
        }
    }
}
#endif
