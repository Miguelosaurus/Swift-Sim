import Foundation

@MainActor
final class SessionStore: ObservableObject {
    @Published var currentSession: SimulatorSession?
    @Published var currentDeviceBuild: DeviceBuildSession?
    @Published var isConnected = false
    @Published var deviceBuildStatus: DeviceBuildStatus?
    @Published var deviceBuildLogs: [String] = []
    @Published var logs: [String] = []
    @Published var activeTransport: SessionTransport?
    @Published private(set) var isRenewingDeviceBuildLink = false
    @Published private(set) var isStartingInstallation = false
    @Published private(set) var deviceBuildActionMessage: String?
    @Published private(set) var libraryActionMessage: String?
    @Published private(set) var pairedMac: PairedMac?
    @Published private(set) var helperStatus: HelperConnectionStatus = .notPaired
    @Published private(set) var recentSessions: [RecentSession] = []
    @Published private(set) var managedApps: [ManagedApp] = []
    @Published private(set) var selectedManagedAppID: String?
    @Published private(set) var tailscaleCheck = ConnectionCheck.notConfigured("Open a Simulator link before checking the connection")
    @Published private(set) var macHelperCheck = ConnectionCheck.notConfigured("Connect your Mac to check its status")
    @Published private(set) var simulatorCheck = ConnectionCheck.notConfigured("Open a Simulator link in Swift Sim")

    private let recentSessionsKey = "recentSessions"
    private let recentDeviceBuildsKey = "recentDeviceBuilds"
    private let managedAppsKey = "managedApps.v1"
    private let pairedMacKey = "pairedMac"
    private var keyboardTail: Task<Void, Never>?
    private var installRequestSnapshot: (build: ManagedBuild, status: DeviceBuildStatus?)?
    private var pairingRevision: UInt64 = 0
    private var deviceBuildViewRevision: UInt64 = 0
    private var managedAppsRevision: UInt64 = 0
    private var managedAppOperationRevisions: [String: UInt64] = [:]

    init() {
        loadRecentSessions()
        loadManagedApps()
        loadPairedMac()
        Task { await refreshHelperStatus() }
    }

    @discardableResult
    func open(_ url: URL) -> Bool {
        if let pairing = PairedMac(url: url) {
            let previousPairing = pairedMac
            pairedMac = pairing
            guard savePairedMac() else {
                pairedMac = previousPairing
                return false
            }
            pairingRevision &+= 1
            if previousPairing?.id != pairing.id {
                invalidateRemoteManagedAppsForPairingChange()
            }
            helperStatus = .checking
            Task { await refreshHelperStatus() }
            return true
        }

        if let build = DeviceBuildSession(url: url) {
            deviceBuildViewRevision &+= 1
            currentDeviceBuild = build
            currentSession = nil
            deviceBuildStatus = nil
            deviceBuildActionMessage = nil
            isStartingInstallation = false
            if !managedApps.contains(where: { app in app.builds.contains(where: { $0.id == build.id }) }) {
                upsertManagedBuild(ManagedBuild(pending: build))
            }
            Task { await refreshAppState() }
            return true
        }

        guard let session = SimulatorSession(url: url) else { return false }
        deviceBuildViewRevision &+= 1
        currentSession = session
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
        activeTransport = nil
        simulatorCheck = .checking("Checking this Simulator preview")
        upsertRecentSession(RecentSession(session: session, displayName: nil))
        Task { await refresh() }
        return true
    }

    func reopen(_ recent: RecentSession) {
        deviceBuildViewRevision &+= 1
        currentSession = recent.session
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
        activeTransport = nil
        simulatorCheck = .checking("Checking (recent.displayName)")
        upsertRecentSession(recent.touch())
        Task { await refresh() }
    }

    func closeCurrentSession() {
        deviceBuildViewRevision &+= 1
        currentSession = nil
        currentDeviceBuild = nil
        isConnected = false
        activeTransport = nil
        logs = []
        deviceBuildStatus = nil
        deviceBuildLogs = []
        selectedManagedAppID = nil
    }

    func openManagedApp(_ app: ManagedApp) {
        deviceBuildViewRevision &+= 1
        selectedManagedAppID = app.id
        currentSession = nil
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
        touchManagedApp(app.id)
    }

    func closeManagedApp() {
        selectedManagedAppID = nil
    }

    func reopen(_ build: ManagedBuild) {
        deviceBuildViewRevision &+= 1
        selectedManagedAppID = build.appID
        currentDeviceBuild = build.session
        currentSession = nil
        deviceBuildStatus = DeviceBuildStatus(cached: build)
        deviceBuildLogs = []
        deviceBuildActionMessage = nil
        touchManagedApp(build.appID)
        Task { await refreshAppState() }
    }

    func closeCurrentBuild() {
        deviceBuildViewRevision &+= 1
        currentDeviceBuild = nil
        deviceBuildStatus = nil
        deviceBuildLogs = []
        deviceBuildActionMessage = nil
        isStartingInstallation = false
        installRequestSnapshot = nil
    }

    func refresh() async {
        guard let session = currentSession else { return }
        do {
            let (data, response) = try await URLSession.shared.data(from: session.statusURL)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                isConnected = false
                simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
                return
            }
            var displayName = "Simulator"
            if let status = try? JSONDecoder().decode(SessionStatus.self, from: data) {
                let name = status.scheme.isEmpty ? nil : status.scheme
                displayName = name ?? displayName
                activeTransport = status.stream
                upsertRecentSession(
                    RecentSession(
                        session: session,
                        displayName: name,
                        recentProjectID: status.recentProjectID
                    )
                )
            }
            isConnected = true
            simulatorCheck = .ready("\(displayName) is available to open")
            await fetchLogs()
        } catch {
            isConnected = false
            simulatorCheck = .issue("This saved preview is unavailable. Open a new Simulator link")
        }
    }

    func fetchLogs() async {
        guard let session = currentSession else { return }
        do {
            let (data, _) = try await URLSession.shared.data(from: session.logsURL)
            let decoded = try JSONDecoder().decode(SessionLogs.self, from: data)
            logs = decoded.logs
        } catch {
            logs = ["Unable to load logs: \(error.localizedDescription)"]
        }
    }

    func refreshDeviceBuild() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        let pairingSnapshot = pairingRevision
        do {
            let decoded = try await fetchDeviceBuildStatus(
                urls: preferredDeviceBuildURLs(
                    direct: build.statusURL,
                    paired: pairedMac?.buildStatusURL(build.id)
                )
            )
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            if resolvedSession != build { deviceBuildViewRevision &+= 1 }
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
            let managedBuild = ManagedBuild(session: resolvedSession, status: decoded)
            upsertManagedBuild(managedBuild)
            selectedManagedAppID = managedBuild.appID
            await fetchDeviceBuildLogs()
        } catch {
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            deviceBuildLogs = ["Unable to load device build: \(error.localizedDescription)"]
        }
    }

    func refreshAppState() async {
        if currentDeviceBuild != nil {
            await refreshDeviceBuild()
            if Self.installationVerificationIsActive(deviceBuildStatus?.installation?.state) {
                await verifyCurrentBuildInstallation()
            }
        }
        await refreshHelperStatus()
    }

    private func decodeServerError(_ data: Data) -> String? {
        guard let decoded = try? JSONDecoder().decode(ServerError.self, from: data) else { return nil }
        return decoded.error
    }

    func fetchDeviceBuildLogs() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        do {
            let (data, _) = try await URLSession.shared.data(from: build.logsURL)
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            let decoded = try JSONDecoder().decode(DeviceBuildLogs.self, from: data)
            deviceBuildLogs = decoded.logs
        } catch {
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            deviceBuildLogs = ["Unable to load build logs: \(error.localizedDescription)"]
        }
    }

    func beginCurrentBuildInstall() {
        guard let build = currentDeviceBuild else { return }
        if let managedBuild = managedApps.lazy.flatMap(\.builds).first(where: { $0.id == build.id }) {
            installRequestSnapshot = (managedBuild, deviceBuildStatus)
        }
        isStartingInstallation = true
        deviceBuildActionMessage = nil
        updateManagedBuild(build.id) { existing in
            existing.markingInstallRequested()
        }
        deviceBuildStatus = deviceBuildStatus?.markingInstallRequested()
    }

    func finishCurrentBuildInstallHandoff(opened: Bool) {
        isStartingInstallation = false
        guard opened else {
            if let snapshot = installRequestSnapshot {
                upsertManagedBuild(snapshot.build)
                deviceBuildStatus = snapshot.status
            }
            installRequestSnapshot = nil
            deviceBuildActionMessage = "The install screen didn't open. Try again."
            return
        }
        installRequestSnapshot = nil
        deviceBuildActionMessage = "Install opened. This screen will update automatically."
    }

    func syncCurrentBuildInstallRequested() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        var request = URLRequest(url: build.installRequestURL)
        request.httpMethod = "POST"
        request.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(DeviceBuildStatus.self, from: data),
              Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
              ) else {
            if Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) {
                deviceBuildActionMessage = "Install opened. Status will update when your Mac reconnects."
            }
            return
        }
        deviceBuildStatus = decoded
        upsertManagedBuild(ManagedBuild(session: build, status: decoded))
    }

    func prepareCurrentBuildInstallURL() async -> URL? {
        guard let build = currentDeviceBuild else { return nil }

        if deviceBuildStatus?.isReady != true {
            await refreshDeviceBuild()
        }

        guard currentDeviceBuild?.id == build.id else { return nil }
        guard let status = deviceBuildStatus, status.isReady else {
            deviceBuildActionMessage = "This app is still being prepared. Try again in a moment."
            return nil
        }

        if let expiry = status.expiryDate, expiry <= Date() {
            deviceBuildActionMessage = "This install link has expired. Create a new one to continue."
            return nil
        }

        if let installURLString = status.links?.installURL,
           let installURL = URL(string: installURLString) {
            return installURL
        }
        return build.installURL ?? build.installPageURL
    }

    func verifyCurrentBuildInstallation() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        let pairingSnapshot = pairingRevision
        do {
            let decoded = try await fetchDeviceBuildStatus(
                urls: preferredDeviceBuildURLs(
                    direct: build.verifyURL,
                    paired: pairedMac?.buildVerifyURL(build.id)
                ),
                method: "POST",
                timeout: 25
            )
            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            if resolvedSession != build { deviceBuildViewRevision &+= 1 }
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
            upsertManagedBuild(ManagedBuild(session: resolvedSession, status: decoded))
        } catch {
            // Keep the last known install state when no verification source is reachable.
        }
    }

    private func preferredDeviceBuildURLs(direct: URL, paired: URL?) -> [URL] {
        Self.preferredDeviceBuildURLs(
            direct: direct,
            paired: paired,
            helperIsOnline: helperStatus == .online
        )
    }

    static func preferredDeviceBuildURLs(direct: URL, paired: URL?, helperIsOnline: Bool) -> [URL] {
        let ordered: [URL?]
        if helperIsOnline {
            ordered = [paired, direct]
        } else {
            ordered = [direct, paired]
        }
        var seen = Set<String>()
        return ordered.compactMap { url in
            guard let url, seen.insert(url.absoluteString).inserted else { return nil }
            return url
        }
    }

    private func fetchDeviceBuildStatus(
        urls: [URL],
        method: String = "GET",
        timeout: TimeInterval = 8
    ) async throws -> DeviceBuildStatus {
        var lastError: Error = SessionStoreRequestError.noReachableSource
        for url in urls {
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.timeoutInterval = timeout
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                    lastError = SessionStoreRequestError.unexpectedResponse
                    continue
                }
                return try JSONDecoder().decode(DeviceBuildStatus.self, from: data)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func renewedDeviceBuildSession(from status: DeviceBuildStatus) -> DeviceBuildSession? {
        guard let link = status.links?.customScheme,
              let url = URL(string: link) else { return nil }
        return DeviceBuildSession(url: url)
    }

    func renewCurrentDeviceBuildLink() async {
        guard let build = currentDeviceBuild else { return }
        guard let mac = pairedMac else {
            deviceBuildActionMessage = "Your Mac is needed to create a new link. Open Swift Sim on the Mac, then try again."
            return
        }

        let expectedPairingRevision = pairingRevision
        let viewRevision = deviceBuildViewRevision
        isRenewingDeviceBuildLink = true
        deviceBuildActionMessage = nil
        defer { isRenewingDeviceBuildLink = false }

        var request = URLRequest(url: mac.buildRenewURL(build.id))
        request.httpMethod = "POST"
        request.timeoutInterval = 60

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                deviceBuildActionMessage = decodeServerError(data) ?? "Swift Sim couldn't create a new link. Try again."
                return
            }
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
            ), Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            let decoded = try JSONDecoder().decode(DeviceBuildStatus.self, from: data)
            guard let link = decoded.links?.customScheme,
                  let url = URL(string: link),
                  let renewedSession = DeviceBuildSession(url: url) else {
                deviceBuildActionMessage = "Swift Sim couldn't create the link. Try again."
                return
            }
            deviceBuildViewRevision &+= 1
            currentDeviceBuild = renewedSession
            deviceBuildStatus = decoded
            upsertManagedBuild(ManagedBuild(session: renewedSession, status: decoded))
            deviceBuildActionMessage = "New install link created."
        } catch {
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
            ), Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ) else { return }
            deviceBuildActionMessage = "Your Mac is offline. Open Swift Sim on the Mac, then try again."
        }
    }

    func sendControl(_ control: String) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.controlURL(control))
        request.httpMethod = "POST"
        _ = try? await URLSession.shared.data(for: request)
        await refresh()
    }

    func typeText(_ text: String) {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.typeURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["text": text])
        enqueueKeyboardRequest(request)
    }

    func sendKey(_ key: String) {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.keyURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["key": key])
        enqueueKeyboardRequest(request)
    }

    private func enqueueKeyboardRequest(_ request: URLRequest) {
        let previous = keyboardTail
        keyboardTail = Task {
            await previous?.value
            _ = try? await URLSession.shared.data(for: request)
        }
    }

    func tapSimulator(x: Double, y: Double) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.tapURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode([
            "x": min(max(x, 0), 1),
            "y": min(max(y, 0), 1),
        ])
        _ = try? await URLSession.shared.data(for: request)
    }

    func sendGesture(_ event: SimulatorGestureEvent) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.gestureURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(event)
        _ = try? await URLSession.shared.data(for: request)
    }

    func sendMultiTouch(_ event: SimulatorMultiTouchEvent) async {
        guard let session = currentSession else { return }
        var request = URLRequest(url: session.multiTouchURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(event)
        _ = try? await URLSession.shared.data(for: request)
    }

    func refreshHelperStatus() async {
        guard let mac = pairedMac else {
            helperStatus = .notPaired
            return
        }
        let revision = pairingRevision

        helperStatus = .checking
        do {
            let (data, response) = try await URLSession.shared.data(from: mac.statusURL)
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: revision
            ) else { return }
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                helperStatus = .offline
                return
            }
            let decoded = try JSONDecoder().decode(PairingStatus.self, from: data)
            pairedMac = mac.updated(name: decoded.macName)
            _ = savePairedMac()
            helperStatus = .online
            await syncManagedAppsFromMac(expectedMac: mac, pairingRevision: revision)
        } catch {
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: revision
            ) else { return }
            helperStatus = .offline
        }
    }

    static func pairingResponseIsCurrent(
        current: PairedMac?,
        expected: PairedMac,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        currentRevision == expectedRevision
            && current?.id == expected.id
            && current?.token == expected.token
    }

    func refreshConnectionChecks() async {
        guard let baseURL = recentSessions.first?.session.baseURL ?? pairedMac?.baseURL else {
            tailscaleCheck = .notConfigured("Open a Simulator link before checking the connection")
            macHelperCheck = .notConfigured("Connect your Mac to check its status")
            simulatorCheck = .notConfigured("Open a Simulator link in Swift Sim")
            return
        }

        tailscaleCheck = .checking("Checking Tailscale")
        macHelperCheck = .checking("Looking for Swift Sim on your Mac")
        simulatorCheck = recentSessions.isEmpty
            ? .notConfigured("Open a Simulator link in Swift Sim")
            : .checking("Checking saved Simulator previews")

        var healthRequest = URLRequest(url: baseURL.appending(path: "health"))
        healthRequest.timeoutInterval = 8

        do {
            let (_, response) = try await URLSession.shared.data(for: healthRequest)
            if (response as? HTTPURLResponse)?.statusCode == 200 {
                tailscaleCheck = .ready("Your iPhone can reach your Mac")
                macHelperCheck = .ready("Swift Sim is running on your Mac")
            } else {
                tailscaleCheck = .issue("Your Mac answered unexpectedly. Check Tailscale on both devices")
                macHelperCheck = .issue("Swift Sim on your Mac did not answer")
            }
        } catch {
            tailscaleCheck = .issue("Your iPhone could not reach your Mac. Check Tailscale on both devices")
            macHelperCheck = .issue("Run swift-sim setup on your Mac, then try again")
        }

        guard !recentSessions.isEmpty else { return }

        let availableSession = await withTaskGroup(of: RecentSession?.self) { group in
            for recent in recentSessions {
                group.addTask {
                    var request = URLRequest(url: recent.session.statusURL)
                    request.timeoutInterval = 8
                    guard let (_, response) = try? await URLSession.shared.data(for: request),
                          (response as? HTTPURLResponse)?.statusCode == 200 else {
                        return Optional<RecentSession>.none
                    }
                    return Optional.some(recent)
                }
            }

            for await recent in group {
                if let recent {
                    group.cancelAll()
                    return Optional.some(recent)
                }
            }
            return Optional<RecentSession>.none
        }

        if let availableSession {
            simulatorCheck = .ready("\(availableSession.displayName) is available to open")
            return
        }

        simulatorCheck = .issue("Saved previews are unavailable. Open a new Simulator link")
    }

    func forgetPairedMac() {
        pairingRevision &+= 1
        pairedMac = nil
        invalidateRemoteManagedAppsForPairingChange()
        helperStatus = .notPaired
        UserDefaults.standard.removeObject(forKey: pairedMacKey)
    }

    func removeRecentSession(_ recent: RecentSession) {
        recentSessions.removeAll { $0.id == recent.id }
        saveRecentSessions()
    }

    func archiveManagedApp(_ app: ManagedApp, archived: Bool) {
        guard let index = managedApps.firstIndex(where: { $0.id == app.id }) else { return }
        let expectedMac = pairedMac
        let expectedPairingRevision = pairingRevision
        guard app.ownerPairingID == nil || app.ownerPairingID == expectedMac?.id else {
            libraryActionMessage = "This app belongs to a different Mac. Refresh the library before changing it."
            return
        }
        managedAppsRevision &+= 1
        let operationRevision = nextManagedAppOperationRevision(app.id)
        managedApps[index] = managedApps[index].settingArchived(archived)
        selectedManagedAppID = nil
        sortAndSaveManagedApps()
        libraryActionMessage = nil
        Task {
            guard await syncArchiveToMac(
                appID: app.id,
                archived: archived,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision,
                expectedOwnerPairingID: app.ownerPairingID
            ) == false else { return }
            guard rollbackContextIsCurrent(
                appID: app.id,
                operationRevision: operationRevision,
                ownerPairingID: app.ownerPairingID,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision
            ) else { return }
            if let index = managedApps.firstIndex(where: { $0.id == app.id }) {
                managedApps[index] = app
            } else {
                managedApps.append(app)
            }
            sortAndSaveManagedApps()
            libraryActionMessage = "Could not update your Mac. The app was restored here."
        }
    }

    func deleteManagedApp(_ app: ManagedApp) {
        let expectedMac = pairedMac
        let expectedPairingRevision = pairingRevision
        guard app.ownerPairingID == nil || app.ownerPairingID == expectedMac?.id else {
            libraryActionMessage = "This app belongs to a different Mac. Refresh the library before deleting it."
            return
        }
        managedAppsRevision &+= 1
        let operationRevision = nextManagedAppOperationRevision(app.id)
        managedApps.removeAll { $0.id == app.id }
        if selectedManagedAppID == app.id {
            selectedManagedAppID = nil
        }
        saveManagedApps()
        libraryActionMessage = nil
        Task {
            guard await syncDeleteToMac(
                appID: app.id,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision,
                expectedOwnerPairingID: app.ownerPairingID
            ) == false else { return }
            guard rollbackContextIsCurrent(
                appID: app.id,
                operationRevision: operationRevision,
                ownerPairingID: app.ownerPairingID,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision
            ) else { return }
            if !managedApps.contains(where: { $0.id == app.id }) {
                managedApps.append(app)
                sortAndSaveManagedApps()
            }
            libraryActionMessage = "Could not delete this history from your Mac. It was restored here."
        }
    }

    func dismissLibraryActionMessage() {
        libraryActionMessage = nil
    }

    private func loadRecentSessions() {
        guard let data = UserDefaults.standard.data(forKey: recentSessionsKey),
              let decoded = try? JSONDecoder().decode([RecentSession].self, from: data) else {
            recentSessions = []
            return
        }
        var seenLegacyProjects = Set<String>()
        recentSessions = decoded
            .sorted { $0.lastOpened > $1.lastOpened }
            .filter { recent in
                guard recent.recentProjectID == nil else { return true }
                let legacyKey = "\(recent.baseURLString)\u{0}\(recent.displayName)"
                return seenLegacyProjects.insert(legacyKey).inserted
            }
        saveRecentSessions()
    }

    private func saveRecentSessions() {
        guard let data = try? JSONEncoder().encode(recentSessions) else { return }
        UserDefaults.standard.set(data, forKey: recentSessionsKey)
    }

    private func loadManagedApps() {
        if let data = UserDefaults.standard.data(forKey: managedAppsKey),
           let decoded = try? JSONDecoder().decode([ManagedApp].self, from: data) {
            managedApps = decoded.sorted { $0.lastOpened > $1.lastOpened }
            return
        }

        guard let legacyData = UserDefaults.standard.data(forKey: recentDeviceBuildsKey),
              let legacyBuilds = try? JSONDecoder().decode([RecentDeviceBuild].self, from: legacyData) else {
            managedApps = []
            return
        }
        for legacy in legacyBuilds {
            upsertManagedBuild(ManagedBuild(legacy: legacy))
        }
        UserDefaults.standard.removeObject(forKey: recentDeviceBuildsKey)
    }

    private func upsertRecentSession(_ recent: RecentSession) {
        var next = recentSessions.filter { existing in
            if existing.id == recent.id { return false }
            if let identity = recent.recentProjectID,
               existing.recentProjectID == identity {
                return false
            }

            // Remove duplicate records created by older app versions once the
            // helper supplies the stable identity for this project.
            if existing.recentProjectID == nil,
               existing.baseURLString == recent.baseURLString,
               existing.displayName == recent.displayName {
                return false
            }
            return true
        }
        next.insert(recent, at: 0)
        recentSessions = Array(next.prefix(8))
        saveRecentSessions()
    }

    private func upsertManagedBuild(_ build: ManagedBuild) {
        managedApps.removeAll { app in
            app.id.hasPrefix("pending:") && app.builds.contains(where: { $0.id == build.id })
        }
        if let index = managedApps.firstIndex(where: { $0.id == build.appID }) {
            let alreadyOwnedBuild = managedApps[index].builds.contains { $0.id == build.id }
            var updated = managedApps[index].upserting(build)
            if managedApps[index].ownerPairingID != nil && !alreadyOwnedBuild {
                // A link from an unknown Mac must not inherit authority to mutate
                // a same-identity app on the currently paired Mac.
                updated.ownerPairingID = nil
            }
            managedApps[index] = updated
        } else {
            managedApps.append(ManagedApp(build: build))
        }
        sortAndSaveManagedApps()
    }

    private func updateManagedBuild(_ id: String, transform: (ManagedBuild) -> ManagedBuild) {
        for appIndex in managedApps.indices {
            guard let buildIndex = managedApps[appIndex].builds.firstIndex(where: { $0.id == id }) else { continue }
            managedApps[appIndex].builds[buildIndex] = transform(managedApps[appIndex].builds[buildIndex])
            sortAndSaveManagedApps()
            return
        }
    }

    private func touchManagedApp(_ id: String) {
        guard let index = managedApps.firstIndex(where: { $0.id == id }) else { return }
        managedApps[index].lastOpened = Date()
        sortAndSaveManagedApps()
    }

    private func sortAndSaveManagedApps() {
        managedApps.sort { $0.lastOpened > $1.lastOpened }
        saveManagedApps()
    }

    private func saveManagedApps() {
        guard let data = try? JSONEncoder().encode(managedApps) else { return }
        UserDefaults.standard.set(data, forKey: managedAppsKey)
    }

    private func syncManagedAppsFromMac(expectedMac: PairedMac? = nil, pairingRevision expectedPairingRevision: UInt64? = nil) async {
        guard let mac = expectedMac ?? pairedMac else { return }
        let syncRevision = managedAppsRevision
        let pairingSnapshot = expectedPairingRevision ?? pairingRevision
        do {
            let (data, response) = try await URLSession.shared.data(from: mac.appsURL)
            guard Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: mac,
                currentRevision: pairingRevision,
                expectedRevision: pairingSnapshot
            ), managedAppsRevision == syncRevision else { return }
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { return }
            let remote = try JSONDecoder().decode(RemoteAppList.self, from: data)
            let remoteIDs = Set(remote.apps.map(\.id))
            let existingRemoteIDs = Set(managedApps
                .filter { !$0.id.hasPrefix("local:") && !$0.id.hasPrefix("pending:") }
                .map(\.id))
            invalidateManagedAppOperations(existingRemoteIDs.union(remoteIDs))
            managedAppsRevision &+= 1
            managedApps.removeAll { app in
                !app.id.hasPrefix("local:")
                    && !app.id.hasPrefix("pending:")
                    && !remoteIDs.contains(app.id)
            }
            for app in remote.apps {
                let builds = app.builds.compactMap { status -> ManagedBuild? in
                    guard let link = status.links?.customScheme,
                          let url = URL(string: link),
                          let session = DeviceBuildSession(url: url) else { return nil }
                    return ManagedBuild(session: session, status: status)
                }
                guard let latest = builds.first else { continue }
                var managed = ManagedApp(build: latest)
                managed.ownerPairingID = mac.id
                managed.displayName = app.name
                managed.bundleIdentifier = app.bundleIdentifier
                managed.builds = builds.sorted { $0.createdAt > $1.createdAt }
                managed.archivedAt = Self.parseDate(app.archivedAt)
                managed.lastOpened = managed.builds.first?.lastOpened ?? Date()
                if let index = managedApps.firstIndex(where: { $0.id == managed.id }) {
                    let localLastOpened = managedApps[index].lastOpened
                    managed.lastOpened = max(localLastOpened, managed.lastOpened)
                    managedApps[index] = managed
                } else {
                    managedApps.append(managed)
                }
            }
            sortAndSaveManagedApps()
        } catch {
            // Link-ingested history remains available when optional Mac sync is offline.
        }
    }

    private func syncArchiveToMac(
        appID: String,
        archived: Bool,
        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64,
        expectedOwnerPairingID: String?
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedOwnerPairingID else { return true }
        guard let expectedMac, expectedMac.id == expectedOwnerPairingID,
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        var request = URLRequest(url: expectedMac.appArchiveURL(appID))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["archived": archived])
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    private func syncDeleteToMac(
        appID: String,
        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64,
        expectedOwnerPairingID: String?
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedOwnerPairingID else { return true }
        guard let expectedMac, expectedMac.id == expectedOwnerPairingID,
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        var request = URLRequest(url: expectedMac.appURL(appID))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 10
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        let status = (response as? HTTPURLResponse)?.statusCode
        return status == 200 || status == 404
    }


    private func nextManagedAppOperationRevision(_ appID: String) -> UInt64 {
        let next = (managedAppOperationRevisions[appID] ?? 0) &+ 1
        managedAppOperationRevisions[appID] = next
        return next
    }

    static func appOperationIsCurrent(currentRevision: UInt64?, expectedRevision: UInt64) -> Bool {
        currentRevision == expectedRevision
    }

    private func rollbackContextIsCurrent(
        appID: String,
        operationRevision: UInt64,
        ownerPairingID: String?,
        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64
    ) -> Bool {
        guard Self.appOperationIsCurrent(
            currentRevision: managedAppOperationRevisions[appID],
            expectedRevision: operationRevision
        ) else { return false }
        guard let ownerPairingID else { return true }
        guard let expectedMac, expectedMac.id == ownerPairingID else { return false }
        return Self.pairingResponseIsCurrent(
            current: pairedMac,
            expected: expectedMac,
            currentRevision: pairingRevision,
            expectedRevision: expectedPairingRevision
        )
    }

    private func invalidateRemoteManagedAppsForPairingChange() {
        let remoteIDs = Set(managedApps.compactMap { $0.ownerPairingID == nil ? nil : $0.id })
        invalidateManagedAppOperations(remoteIDs)
        managedApps.removeAll { $0.ownerPairingID != nil }
        if let selectedManagedAppID, remoteIDs.contains(selectedManagedAppID) {
            self.selectedManagedAppID = nil
        }
        managedAppsRevision &+= 1
        saveManagedApps()
    }

    private func invalidateManagedAppOperations(_ ids: Set<String>) {
        for id in ids {
            managedAppOperationRevisions[id] = (managedAppOperationRevisions[id] ?? 0) &+ 1
        }
    }

    static func deviceBuildResponseIsCurrent(
        current: DeviceBuildSession?,
        expected: DeviceBuildSession,
        currentRevision: UInt64,
        expectedRevision: UInt64
    ) -> Bool {
        // round4-final-fencing
        currentRevision == expectedRevision && current == expected
    }

    static func installationVerificationIsActive(_ state: String?) -> Bool {
        ["requested", "not-installed", "different-version"].contains(state ?? "")
    }

    private static func parseDate(_ value: String) -> Date? {
        SwiftSimISO8601.date(from: value)
    }

    private func loadPairedMac() {
        guard let data = UserDefaults.standard.data(forKey: pairedMacKey),
              let decoded = try? JSONDecoder().decode(PairedMac.self, from: data) else {
            pairedMac = nil
            helperStatus = .notPaired
            return
        }
        pairedMac = decoded
        helperStatus = .checking
    }

    @discardableResult
    private func savePairedMac() -> Bool {
        guard let pairedMac,
              let data = try? JSONEncoder().encode(pairedMac) else { return false }
        UserDefaults.standard.set(data, forKey: pairedMacKey)
        return UserDefaults.standard.data(forKey: pairedMacKey) == data
    }
}

enum HelperConnectionStatus: Equatable {
    case notPaired
    case checking
    case online
    case offline

    var title: String {
        switch self {
        case .notPaired: "No Mac connected"
        case .checking: "Connecting to Mac"
        case .online: "Mac connected"
        case .offline: "Mac is offline"
        }
    }

    var detail: String {
        switch self {
        case .notPaired: "Installs work without a Mac connection"
        case .checking: "Checking whether Swift Sim is open on your Mac"
        case .online: "Install status updates automatically"
        case .offline: "Installs still work and status updates when it reconnects"
        }
    }
}

struct ConnectionCheck: Equatable {
    enum State: Equatable {
        case notConfigured
        case checking
        case ready
        case issue
    }

    let state: State
    let detail: String

    static func notConfigured(_ detail: String) -> Self {
        Self(state: .notConfigured, detail: detail)
    }

    static func checking(_ detail: String) -> Self {
        Self(state: .checking, detail: detail)
    }

    static func ready(_ detail: String) -> Self {
        Self(state: .ready, detail: detail)
    }

    static func issue(_ detail: String) -> Self {
        Self(state: .issue, detail: detail)
    }
}

struct PairedMac: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let pairedAt: Date
    let lastSeenAt: Date?

    var baseURL: URL {
        URL(string: baseURLString)!
    }

    var hostDisplayName: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    var statusURL: URL {
        baseURL.appending(path: "api/pairing/status").appending(queryItems: [.init(name: "token", value: token)])
    }

    var appsURL: URL {
        baseURL.appending(path: "api/apps").appending(queryItems: [
            .init(name: "token", value: token),
            .init(name: "archived", value: "true"),
        ])
    }

    func appURL(_ id: String) -> URL {
        baseURL.appending(path: "api/apps/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    func appArchiveURL(_ id: String) -> URL {
        baseURL.appending(path: "api/apps/\(id)/archive").appending(queryItems: [.init(name: "token", value: token)])
    }

    func buildStatusURL(_ id: String) -> URL {
        buildURL(id)
    }

    func buildVerifyURL(_ id: String) -> URL {
        buildURL(id, action: "verify")
    }

    private func buildURL(_ id: String, action: String? = nil) -> URL {
        var url = baseURL.appending(path: "api/device-builds/\(id)")
        if let action { url = url.appending(path: action) }
        return url.appending(queryItems: [.init(name: "token", value: token)])
    }

    func buildRenewURL(_ id: String) -> URL {
        baseURL.appending(path: "api/device-builds/\(id)/renew").appending(queryItems: [.init(name: "token", value: token)])
    }

    init(token: String, baseURL: URL, displayName: String = "Paired Mac") {
        self.id = baseURL.absoluteString
        self.token = token
        self.baseURLString = baseURL.absoluteString
        self.displayName = displayName
        self.pairedAt = Date()
        self.lastSeenAt = nil
    }

    init?(url: URL) {
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        guard !token.isEmpty else { return nil }

        if url.scheme == "swift-sim" {
            guard url.host == "pair" else { return nil }
            let base = components?.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
            guard let baseURL = URL(string: base) else { return nil }
            self.init(token: token, baseURL: baseURL)
            return
        }

        guard url.scheme == "https" || url.scheme == "http",
              url.path == "/pair" else { return nil }
        var baseComponents = URLComponents()
        baseComponents.scheme = url.scheme
        baseComponents.host = url.host
        baseComponents.port = url.port
        guard let baseURL = baseComponents.url else { return nil }
        self.init(token: token, baseURL: baseURL)
    }

    func updated(name: String) -> PairedMac {
        PairedMac(
            id: id,
            token: token,
            baseURLString: baseURLString,
            displayName: name.isEmpty ? displayName : name,
            pairedAt: pairedAt,
            lastSeenAt: Date()
        )
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, pairedAt: Date, lastSeenAt: Date?) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.pairedAt = pairedAt
        self.lastSeenAt = lastSeenAt
    }
}

struct SimulatorSession: Identifiable, Equatable {
    let id: String
    let token: String
    let baseURL: URL

    init(id: String, token: String, baseURL: URL) {
        self.id = id
        self.token = token
        self.baseURL = baseURL
    }

    var fallbackWebURL: URL {
        baseURL.appending(path: "s/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var streamURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/stream").appending(queryItems: [.init(name: "token", value: token)])
    }

    var frameMaskURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/frame-mask").appending(queryItems: [.init(name: "token", value: token)])
    }

    var statusURL: URL {
        baseURL.appending(path: "api/sessions/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var logsURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/logs").appending(queryItems: [.init(name: "token", value: token)])
    }

    func controlURL(_ control: String) -> URL {
        baseURL.appending(path: "api/sessions/\(id)/control/\(control)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var typeURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/type").appending(queryItems: [.init(name: "token", value: token)])
    }

    var keyURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/key").appending(queryItems: [.init(name: "token", value: token)])
    }

    var tapURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/tap").appending(queryItems: [.init(name: "token", value: token)])
    }

    var gestureURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/gesture").appending(queryItems: [.init(name: "token", value: token)])
    }

    var multiTouchURL: URL {
        baseURL.appending(path: "api/sessions/\(id)/multitouch").appending(queryItems: [.init(name: "token", value: token)])
    }

    init?(url: URL) {
        if url.scheme == "swift-sim" {
            guard url.host == "session" else { return nil }
            let id = url.pathComponents.dropFirst().first ?? ""
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
            let base = components?.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
            guard !id.isEmpty, !token.isEmpty, let baseURL = URL(string: base) else { return nil }
            self.id = id
            self.token = token
            self.baseURL = baseURL
            return
        }

        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        let parts = url.pathComponents
        guard parts.count >= 3, parts[1] == "s", !token.isEmpty else { return nil }
        self.id = parts[2]
        self.token = token
        var baseComponents = URLComponents()
        baseComponents.scheme = url.scheme
        baseComponents.host = url.host
        baseComponents.port = url.port
        guard let baseURL = baseComponents.url else { return nil }
        self.baseURL = baseURL
    }
}

struct DeviceBuildSession: Identifiable, Equatable {
    let id: String
    let token: String
    let baseURL: URL

    var statusURL: URL {
        baseURL.appending(path: "api/device-builds/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var logsURL: URL {
        baseURL.appending(path: "api/device-builds/\(id)/logs").appending(queryItems: [.init(name: "token", value: token)])
    }

    var installRequestURL: URL {
        baseURL.appending(path: "api/device-builds/\(id)/install-request").appending(queryItems: [.init(name: "token", value: token)])
    }

    var verifyURL: URL {
        baseURL.appending(path: "api/device-builds/\(id)/verify").appending(queryItems: [.init(name: "token", value: token)])
    }

    var installPageURL: URL {
        baseURL.appending(path: "d/\(id)").appending(queryItems: [.init(name: "token", value: token)])
    }

    var manifestURL: URL {
        baseURL.appending(path: "api/device-builds/\(id)/artifact/manifest").appending(queryItems: [.init(name: "token", value: token)])
    }

    var installURL: URL? {
        let escapedManifest = manifestURL.absoluteString.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? manifestURL.absoluteString
        return URL(string: "itms-services://?action=download-manifest&url=\(escapedManifest)")
    }

    init(id: String, token: String, baseURL: URL) {
        self.id = id
        self.token = token
        self.baseURL = baseURL
    }

    init?(url: URL) {
        if url.scheme == "swift-sim" {
            guard url.host == "device-build" else { return nil }
            let id = url.pathComponents.dropFirst().first ?? ""
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
            let base = components?.queryItems?.first(where: { $0.name == "base" })?.value ?? ""
            guard !id.isEmpty, !token.isEmpty, let baseURL = URL(string: base) else { return nil }
            self.id = id
            self.token = token
            self.baseURL = baseURL
            return
        }

        guard url.scheme == "https" || url.scheme == "http" else { return nil }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
        let parts = url.pathComponents
        guard parts.count >= 3, parts[1] == "d", !token.isEmpty else { return nil }
        self.id = parts[2]
        self.token = token
        var baseComponents = URLComponents()
        baseComponents.scheme = url.scheme
        baseComponents.host = url.host
        baseComponents.port = url.port
        guard let baseURL = baseComponents.url else { return nil }
        self.baseURL = baseURL
    }
}

struct SimulatorGestureEvent: Encodable {
    let type: String
    let x: Double
    let y: Double
    var scale: Double?
    var velocity: Double?
}

struct RecentDeviceBuild: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let bundleIdentifier: String
    let state: String
    let lastOpened: Date

    var session: DeviceBuildSession {
        DeviceBuildSession(id: id, token: token, baseURL: URL(string: baseURLString)!)
    }

    var hostDisplayName: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    init(session: DeviceBuildSession, displayName: String?, bundleIdentifier: String?, state: String = "queued") {
        self.id = session.id
        self.token = session.token
        self.baseURLString = session.baseURL.absoluteString
        self.displayName = displayName ?? "Build \(session.id.prefix(6))"
        self.bundleIdentifier = bundleIdentifier ?? ""
        self.state = state
        self.lastOpened = Date()
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, bundleIdentifier: String, state: String, lastOpened: Date) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.bundleIdentifier = bundleIdentifier
        self.state = state
        self.lastOpened = lastOpened
    }

    func touch() -> RecentDeviceBuild {
        RecentDeviceBuild(
            id: id,
            token: token,
            baseURLString: baseURLString,
            displayName: displayName,
            bundleIdentifier: bundleIdentifier,
            state: state,
            lastOpened: Date()
        )
    }
}

struct ManagedApp: Identifiable, Codable, Equatable {
    let id: String
    var displayName: String
    var bundleIdentifier: String
    var teamID: String
    var ownerPairingID: String?
    var builds: [ManagedBuild]
    var archivedAt: Date?
    var lastOpened: Date

    var latestBuild: ManagedBuild? {
        builds.sorted { $0.createdAt > $1.createdAt }.first
    }

    var isArchived: Bool {
        archivedAt != nil
    }

    var initials: String {
        let letters = displayName.split(separator: " ").prefix(2).compactMap(\.first)
        let value = String(letters).uppercased()
        return value.isEmpty ? "APP" : value
    }

    init(build: ManagedBuild) {
        id = build.appID
        displayName = build.displayName
        bundleIdentifier = build.bundleIdentifier
        teamID = build.teamID
        ownerPairingID = nil
        builds = [build]
        archivedAt = nil
        lastOpened = build.lastOpened
    }

    func upserting(_ build: ManagedBuild) -> ManagedApp {
        var copy = self
        copy.displayName = build.displayName
        copy.bundleIdentifier = build.bundleIdentifier
        copy.teamID = build.teamID
        copy.lastOpened = Date()
        copy.builds.removeAll { $0.id == build.id }
        copy.builds.append(build)
        copy.builds.sort { $0.createdAt > $1.createdAt }
        return copy
    }

    func settingArchived(_ archived: Bool) -> ManagedApp {
        var copy = self
        copy.archivedAt = archived ? Date() : nil
        copy.lastOpened = Date()
        return copy
    }
}

struct ManagedBuild: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let appID: String
    let displayName: String
    let bundleIdentifier: String
    let teamID: String
    let version: String
    let buildNumber: String
    let state: String
    let createdAt: Date
    let expiresAt: Date?
    let installationState: String
    let installRequestedAt: Date?
    let verifiedAt: Date?
    let verifiedDevices: [VerifiedDevice]
    let lastOpened: Date

    var session: DeviceBuildSession {
        DeviceBuildSession(id: id, token: token, baseURL: URL(string: baseURLString)!)
    }

    var isLinkActive: Bool {
        guard let expiresAt else { return false }
        return expiresAt > Date()
    }

    var installationStatus: InstallationState {
        InstallationState(serverValue: installationState)
    }

    var versionLabel: String {
        let versionText = version.isEmpty ? "Unversioned" : "Version \(version)"
        return buildNumber.isEmpty ? versionText : "\(versionText) (\(buildNumber))"
    }

    init(session: DeviceBuildSession, status: DeviceBuildStatus) {
        id = status.id
        token = session.token
        baseURLString = session.baseURL.absoluteString
        appID = status.app.identity?.isEmpty == false
            ? status.app.identity!
            : ManagedBuild.localAppID(bundleIdentifier: status.app.bundleIdentifier, teamID: status.app.teamID, buildID: status.id)
        displayName = status.app.name.isEmpty ? "iPhone App" : status.app.name
        bundleIdentifier = status.app.bundleIdentifier
        teamID = status.app.teamID
        version = status.app.version
        buildNumber = status.app.build
        state = status.state
        createdAt = Self.parse(status.createdAt) ?? Date()
        expiresAt = Self.parse(status.expiresAt)
        installationState = status.installation?.state ?? "unknown"
        installRequestedAt = Self.parse(status.installation?.requestedAt)
        verifiedAt = Self.parse(status.installation?.verifiedAt)
        verifiedDevices = status.installation?.devices ?? []
        lastOpened = Date()
    }

    init(pending session: DeviceBuildSession) {
        id = session.id
        token = session.token
        baseURLString = session.baseURL.absoluteString
        appID = "pending:\(session.id)"
        displayName = "Incoming Build"
        bundleIdentifier = ""
        teamID = ""
        version = ""
        buildNumber = ""
        state = "loading"
        createdAt = Date()
        expiresAt = nil
        installationState = "unknown"
        installRequestedAt = nil
        verifiedAt = nil
        verifiedDevices = []
        lastOpened = Date()
    }

    init(legacy: RecentDeviceBuild) {
        id = legacy.id
        token = legacy.token
        baseURLString = legacy.baseURLString
        appID = Self.localAppID(bundleIdentifier: legacy.bundleIdentifier, teamID: "", buildID: legacy.id)
        displayName = legacy.displayName
        bundleIdentifier = legacy.bundleIdentifier
        teamID = ""
        version = ""
        buildNumber = ""
        state = legacy.state
        createdAt = legacy.lastOpened
        expiresAt = nil
        installationState = "unknown"
        installRequestedAt = nil
        verifiedAt = nil
        verifiedDevices = []
        lastOpened = legacy.lastOpened
    }

    func markingInstallRequested() -> ManagedBuild {
        ManagedBuild(
            id: id,
            token: token,
            baseURLString: baseURLString,
            appID: appID,
            displayName: displayName,
            bundleIdentifier: bundleIdentifier,
            teamID: teamID,
            version: version,
            buildNumber: buildNumber,
            state: state,
            createdAt: createdAt,
            expiresAt: expiresAt,
            installationState: installationState == "verified" ? "verified" : "requested",
            installRequestedAt: Date(),
            verifiedAt: verifiedAt,
            verifiedDevices: verifiedDevices,
            lastOpened: Date()
        )
    }

    private init(
        id: String,
        token: String,
        baseURLString: String,
        appID: String,
        displayName: String,
        bundleIdentifier: String,
        teamID: String,
        version: String,
        buildNumber: String,
        state: String,
        createdAt: Date,
        expiresAt: Date?,
        installationState: String,
        installRequestedAt: Date?,
        verifiedAt: Date?,
        verifiedDevices: [VerifiedDevice],
        lastOpened: Date
    ) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.appID = appID
        self.displayName = displayName
        self.bundleIdentifier = bundleIdentifier
        self.teamID = teamID
        self.version = version
        self.buildNumber = buildNumber
        self.state = state
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.installationState = installationState
        self.installRequestedAt = installRequestedAt
        self.verifiedAt = verifiedAt
        self.verifiedDevices = verifiedDevices
        self.lastOpened = lastOpened
    }

    private static func localAppID(bundleIdentifier: String, teamID: String, buildID: String) -> String {
        guard !bundleIdentifier.isEmpty else { return "pending:\(buildID)" }
        return "local:\(teamID.uppercased()):\(bundleIdentifier.lowercased())"
    }

    private static func parse(_ value: String?) -> Date? {
        SwiftSimISO8601.date(from: value)
    }
}

enum InstallationState: Equatable {
    case unknown
    case requested
    case verified
    case differentVersion
    case notInstalled

    init(serverValue: String?) {
        switch serverValue {
        case "requested": self = .requested
        case "verified": self = .verified
        case "different-version": self = .differentVersion
        case "not-installed": self = .notInstalled
        default: self = .unknown
        }
    }
}

struct DeviceBuildStatus: Decodable, Equatable {
    let id: String
    let createdAt: String
    let updatedAt: String
    let expiresAt: String
    let state: String
    let configuration: String?
    let liveReload: DeviceBuildLiveReload?
    let app: DeviceBuildApp
    let signing: DeviceBuildSigning
    let delivery: DeviceBuildDelivery?
    let preserveData: Bool
    let installation: DeviceBuildInstallation?
    let links: DeviceBuildLinks?

    var isReady: Bool {
        state == "ready"
    }

    var expiryDate: Date? {
        SwiftSimISO8601.date(from: expiresAt)
    }

    func markingInstallRequested() -> DeviceBuildStatus {
        DeviceBuildStatus(
            id: id,
            createdAt: createdAt,
            updatedAt: updatedAt,
            expiresAt: expiresAt,
            state: state,
            configuration: configuration,
            liveReload: liveReload,
            app: app,
            signing: signing,
            delivery: delivery,
            preserveData: preserveData,
            installation: DeviceBuildInstallation(
                state: installation?.state == "verified" ? "verified" : "requested",
                requestedAt: ISO8601DateFormatter().string(from: Date()),
                verifiedAt: installation?.verifiedAt ?? "",
                devices: installation?.devices ?? []
            ),
            links: links
        )
    }

    init(cached build: ManagedBuild) {
        id = build.id
        createdAt = ISO8601DateFormatter().string(from: build.createdAt)
        updatedAt = createdAt
        expiresAt = build.expiresAt.map { ISO8601DateFormatter().string(from: $0) } ?? ""
        state = build.state
        configuration = nil
        liveReload = nil
        app = DeviceBuildApp(
            identity: build.appID,
            name: build.displayName,
            bundleIdentifier: build.bundleIdentifier,
            version: build.version,
            build: build.buildNumber,
            teamID: build.teamID
        )
        signing = DeviceBuildSigning(method: "development", deviceInstallable: true, updateSafe: "same-bundle-update", warnings: [])
        delivery = nil
        preserveData = true
        installation = DeviceBuildInstallation(
            state: build.installationState,
            requestedAt: build.installRequestedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            verifiedAt: build.verifiedAt.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            devices: build.verifiedDevices
        )
        links = nil
    }

    private init(
        id: String,
        createdAt: String,
        updatedAt: String,
        expiresAt: String,
        state: String,
        configuration: String?,
        liveReload: DeviceBuildLiveReload?,
        app: DeviceBuildApp,
        signing: DeviceBuildSigning,
        delivery: DeviceBuildDelivery?,
        preserveData: Bool,
        installation: DeviceBuildInstallation?,
        links: DeviceBuildLinks?
    ) {
        self.id = id
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
        self.state = state
        self.configuration = configuration
        self.liveReload = liveReload
        self.app = app
        self.signing = signing
        self.delivery = delivery
        self.preserveData = preserveData
        self.installation = installation
        self.links = links
    }
}

struct DeviceBuildLiveReload: Decodable, Equatable {
    let eligible: Bool
    let mode: String
    let engineReady: Bool?
    let compilerReady: Bool?
    let capturedCompilations: Int?
    let error: String?
}

struct DeviceBuildApp: Decodable, Equatable {
    let identity: String?
    let name: String
    let bundleIdentifier: String
    let version: String
    let build: String
    let teamID: String
}

struct DeviceBuildSigning: Decodable, Equatable {
    let method: String
    let deviceInstallable: Bool
    let updateSafe: String
    let warnings: [String]
}

struct DeviceBuildDelivery: Decodable, Equatable {
    let mode: String
    let provider: String
    let expiresAt: String
}

struct DeviceBuildInstallation: Decodable, Equatable {
    let state: String
    let requestedAt: String
    let verifiedAt: String
    let devices: [VerifiedDevice]
}

struct VerifiedDevice: Codable, Equatable {
    let name: String
    let state: String
    let version: String
    let build: String
}

struct DeviceBuildLinks: Decodable, Equatable {
    let universalLink: String
    let customScheme: String
    let installURL: String
}

private struct ServerError: Decodable {
    let error: String
}

private enum SessionStoreRequestError: Error {
    case noReachableSource
    case unexpectedResponse
}

private struct DeviceBuildLogs: Decodable {
    let logs: [String]
}

struct SimulatorMultiTouchEvent: Encodable {
    let type: String
    let x1: Double
    let y1: Double
    let x2: Double
    let y2: Double

    func ending() -> Self {
        Self(type: "end", x1: x1, y1: y1, x2: x2, y2: y2)
    }
}

struct RecentSession: Identifiable, Codable, Equatable {
    let id: String
    let token: String
    let baseURLString: String
    let displayName: String
    let lastOpened: Date
    let recentProjectID: String?

    var session: SimulatorSession {
        SimulatorSession(id: id, token: token, baseURL: URL(string: baseURLString)!)
    }

    var hostDisplayName: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    var initials: String {
        let pieces = displayName.split(separator: " ")
        let letters = pieces.prefix(2).compactMap { $0.first }
        let result = String(letters).uppercased()
        return result.isEmpty ? "SS" : result
    }

    init(session: SimulatorSession, displayName: String?, recentProjectID: String? = nil) {
        self.id = session.id
        self.token = session.token
        self.baseURLString = session.baseURL.absoluteString
        self.displayName = displayName ?? "Session \(session.id.prefix(6))"
        self.lastOpened = Date()
        self.recentProjectID = recentProjectID
    }

    private init(id: String, token: String, baseURLString: String, displayName: String, lastOpened: Date, recentProjectID: String?) {
        self.id = id
        self.token = token
        self.baseURLString = baseURLString
        self.displayName = displayName
        self.lastOpened = lastOpened
        self.recentProjectID = recentProjectID
    }

    func touch() -> RecentSession {
        RecentSession(
            id: id,
            token: token,
            baseURLString: baseURLString,
            displayName: displayName,
            lastOpened: Date(),
            recentProjectID: recentProjectID
        )
    }
}

struct SessionTransport: Decodable, Equatable {
    let state: String
    let transport: String
    let quality: String
    let limitations: [String]

    var isFallback: Bool {
        transport == "serve-sim" || quality == "fallback"
    }

    var displayName: String {
        switch transport {
        case "native-companion":
            "Native stream"
        case "serve-sim":
            "Fallback stream"
        default:
            transport
        }
    }
}

private struct SessionStatus: Decodable {
    let scheme: String
    let stream: SessionTransport
    let recentProjectID: String?
}

private struct SessionLogs: Decodable {
    let logs: [String]
}

private struct PairingStatus: Decodable {
    let macName: String
}

private struct RemoteAppList: Decodable {
    let apps: [RemoteManagedApp]
}

private struct RemoteManagedApp: Decodable {
    let id: String
    let name: String
    let bundleIdentifier: String
    let archivedAt: String
    let builds: [DeviceBuildStatus]
}

private extension URL {
    func appending(path: String) -> URL {
        var url = self
        for component in path.split(separator: "/") {
            url.append(path: String(component))
        }
        return url
    }

    func appending(queryItems: [URLQueryItem]) -> URL {
        var components = URLComponents(url: self, resolvingAgainstBaseURL: false)
        let existing = components?.queryItems ?? []
        components?.queryItems = existing + queryItems
        return components?.url ?? self
    }
}

private enum SwiftSimISO8601 {
    static func date(from value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
}
