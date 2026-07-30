#!/usr/bin/env python3
from pathlib import Path
import re

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing anchor: {label}")
    return text.replace(old, new, 1)

def regex_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected one match for {label}, got {count}")
    return next_text

path = Path("Companion/SwiftSimCompanion/SessionStore.swift")
text = path.read_text()
text = replace_once(text,
    '''    private var pairingRevision: UInt64 = 0
    private var managedAppsRevision: UInt64 = 0
''',
    '''    private var pairingRevision: UInt64 = 0
    private var deviceBuildViewRevision: UInt64 = 0
    private var managedAppsRevision: UInt64 = 0
''',
    "view revision property")
text = replace_once(text,
    '''            pairingRevision &+= 1
            helperStatus = .checking
''',
    '''            pairingRevision &+= 1
            if previousPairing?.id != pairing.id {
                invalidateRemoteManagedAppsForPairingChange()
            }
            helperStatus = .checking
''',
    "pairing replacement invalidation")
text = replace_once(text,
    '''        if let build = DeviceBuildSession(url: url) {
            currentDeviceBuild = build
''',
    '''        if let build = DeviceBuildSession(url: url) {
            deviceBuildViewRevision &+= 1
            currentDeviceBuild = build
''',
    "open build revision")
text = replace_once(text,
    '''    func closeCurrentSession() {
        currentSession = nil
        currentDeviceBuild = nil
''',
    '''    func closeCurrentSession() {
        deviceBuildViewRevision &+= 1
        currentSession = nil
        currentDeviceBuild = nil
''',
    "close session build revision")
text = replace_once(text,
    '''    func reopen(_ build: ManagedBuild) {
        selectedManagedAppID = build.appID
        currentDeviceBuild = build.session
''',
    '''    func reopen(_ build: ManagedBuild) {
        deviceBuildViewRevision &+= 1
        selectedManagedAppID = build.appID
        currentDeviceBuild = build.session
''',
    "reopen build revision")
text = replace_once(text,
    '''    func closeCurrentBuild() {
        currentDeviceBuild = nil
''',
    '''    func closeCurrentBuild() {
        deviceBuildViewRevision &+= 1
        currentDeviceBuild = nil
''',
    "close build revision")
text = regex_once(text,
    r'''    func refreshDeviceBuild\(\) async \{.*?\n    \}\n\n    func refreshAppState''',
    '''    func refreshDeviceBuild() async {
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
            deviceBuildLogs = ["Unable to load device build: \\(error.localizedDescription)"]
        }
    }

    func refreshAppState''',
    "fenced refresh build")
text = replace_once(text,
    '''            if deviceBuildStatus?.installation?.state == "requested" {
                await verifyCurrentBuildInstallation()
            }
''',
    '''            if Self.installationVerificationIsActive(deviceBuildStatus?.installation?.state) {
                await verifyCurrentBuildInstallation()
            }
''',
    "active verification states")
text = regex_once(text,
    r'''    func fetchDeviceBuildLogs\(\) async \{.*?\n    \}\n\n    func beginCurrentBuildInstall''',
    '''    func fetchDeviceBuildLogs() async {
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
            deviceBuildLogs = ["Unable to load build logs: \\(error.localizedDescription)"]
        }
    }

    func beginCurrentBuildInstall''',
    "fenced logs")
text = replace_once(text,
    '''    func verifyCurrentBuildInstallation() async {
        guard let build = currentDeviceBuild else { return }
        do {
''',
    '''    func verifyCurrentBuildInstallation() async {
        guard let build = currentDeviceBuild else { return }
        let viewRevision = deviceBuildViewRevision
        let pairingSnapshot = pairingRevision
        do {
''',
    "verify captures")
text = replace_once(text,
    '''            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
''',
    '''            guard Self.deviceBuildResponseIsCurrent(
                current: currentDeviceBuild,
                expected: build,
                currentRevision: deviceBuildViewRevision,
                expectedRevision: viewRevision
            ), pairingRevision == pairingSnapshot else { return }
            let resolvedSession = renewedDeviceBuildSession(from: decoded) ?? build
            currentDeviceBuild = resolvedSession
            deviceBuildStatus = decoded
''',
    "verify guard")
text = replace_once(text,
    '''        isRenewingDeviceBuildLink = true
        deviceBuildActionMessage = nil
''',
    '''        let expectedPairingRevision = pairingRevision
        let viewRevision = deviceBuildViewRevision
        isRenewingDeviceBuildLink = true
        deviceBuildActionMessage = nil
''',
    "renew captures")
text = replace_once(text,
    '''            let decoded = try JSONDecoder().decode(DeviceBuildStatus.self, from: data)
            guard let link = decoded.links?.customScheme,
''',
    '''            guard Self.pairingResponseIsCurrent(
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
''',
    "renew response guard")
text = replace_once(text,
    '''            currentDeviceBuild = renewedSession
            deviceBuildStatus = decoded
''',
    '''            deviceBuildViewRevision &+= 1
            currentDeviceBuild = renewedSession
            deviceBuildStatus = decoded
''',
    "renew view advance")
text = replace_once(text,
    '''        } catch {
            deviceBuildActionMessage = "Your Mac is offline. Open Swift Sim on the Mac, then try again."
        }
''',
    '''        } catch {
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
''',
    "renew catch guard")
text = replace_once(text,
    '''        pairedMac = nil
        helperStatus = .notPaired
''',
    '''        pairedMac = nil
        invalidateRemoteManagedAppsForPairingChange()
        helperStatus = .notPaired
''',
    "forget pairing invalidation")
text = regex_once(text,
    r'''    func archiveManagedApp\(_ app: ManagedApp, archived: Bool\) \{.*?\n    \}\n\n    func deleteManagedApp''',
    '''    func archiveManagedApp(_ app: ManagedApp, archived: Bool) {
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

    func deleteManagedApp''',
    "archive replacement")
text = regex_once(text,
    r'''    func deleteManagedApp\(_ app: ManagedApp\) \{.*?\n    \}\n\n    func dismissLibraryActionMessage''',
    '''    func deleteManagedApp(_ app: ManagedApp) {
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

    func dismissLibraryActionMessage''',
    "delete replacement")
text = replace_once(text,
    '''            let remote = try JSONDecoder().decode(RemoteAppList.self, from: data)
            let remoteIDs = Set(remote.apps.map(\.id))
''',
    '''            let remote = try JSONDecoder().decode(RemoteAppList.self, from: data)
            let remoteIDs = Set(remote.apps.map(\.id))
            let existingRemoteIDs = Set(managedApps
                .filter { !$0.id.hasPrefix("local:") && !$0.id.hasPrefix("pending:") }
                .map(\.id))
            invalidateManagedAppOperations(existingRemoteIDs.union(remoteIDs))
            managedAppsRevision &+= 1
''',
    "authoritative sync invalidates operations")
text = replace_once(text,
    '''                var managed = ManagedApp(build: latest)
                managed.displayName = app.name
''',
    '''                var managed = ManagedApp(build: latest)
                managed.ownerPairingID = mac.id
                managed.displayName = app.name
''',
    "remote owner assignment")
text = replace_once(text,
    '''        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedMac,
''',
    '''        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64,
        expectedOwnerPairingID: String?
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedOwnerPairingID else { return true }
        guard let expectedMac, expectedMac.id == expectedOwnerPairingID,
''',
    "archive sync owner signature")
text = replace_once(text,
    '''        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedMac,
''',
    '''        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64,
        expectedOwnerPairingID: String?
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedOwnerPairingID else { return true }
        guard let expectedMac, expectedMac.id == expectedOwnerPairingID,
''',
    "delete sync owner signature")
text = replace_once(text,
    '''    static func appOperationIsCurrent(currentRevision: UInt64?, expectedRevision: UInt64) -> Bool {
        currentRevision == expectedRevision
    }

    private static func parseDate''',
    '''    static func appOperationIsCurrent(currentRevision: UInt64?, expectedRevision: UInt64) -> Bool {
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
        currentRevision == expectedRevision && current?.id == expected.id
    }

    static func installationVerificationIsActive(_ state: String?) -> Bool {
        ["requested", "not-installed", "different-version"].contains(state ?? "")
    }

    private static func parseDate''',
    "swift fencing helpers")
text = replace_once(text,
    '''    var teamID: String
    var builds: [ManagedBuild]
''',
    '''    var teamID: String
    var ownerPairingID: String?
    var builds: [ManagedBuild]
''',
    "managed app owner field")
text = replace_once(text,
    '''        teamID = build.teamID
        builds = [build]
''',
    '''        teamID = build.teamID
        ownerPairingID = nil
        builds = [build]
''',
    "managed app owner init")
path.write_text(text)

path = Path("Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift")
text = path.read_text()
text = replace_once(text,
    '''    private static let previousPendingPairingIDKey = "pairedMacPreviousPendingPairingID"
''',
    '''    private static let previousPendingPairingIDKey = "pairedMacPreviousPendingPairingID"
    private static let pendingHistoryKey = "pairedMacPendingCredentialHistory"
''',
    "pending history key")
text = replace_once(text,
    '''        if let previousPending {
            defaults.set(previousPending, forKey: previousPendingAccountKey)
''',
    '''        if let olderAccount = defaults.string(forKey: previousPendingAccountKey),
           let olderPairingID = defaults.string(forKey: previousPendingPairingIDKey) {
            var history = pendingHistory()
            history.append(PendingCredential(account: olderAccount, pairingID: olderPairingID))
            savePendingHistory(history)
        }
        if let previousPending {
            defaults.set(previousPending, forKey: previousPendingAccountKey)
''',
    "push older pending")
text = replace_once(text,
    '''        if let previous = defaults.string(forKey: previousPendingAccountKey), previous != currentAccount {
            deleteToken(account: previous)
        }
        clearPreviousPendingTransaction()
''',
    '''        if let previous = defaults.string(forKey: previousPendingAccountKey), previous != currentAccount {
            deleteToken(account: previous)
        }
        for item in pendingHistory() where item.account != currentAccount {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        clearPreviousPendingTransaction()
''',
    "commit history cleanup")
text = replace_once(text,
    '''        if let previous = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previous)
        }
        defaults.removeObject(forKey: pendingAccountKey)
''',
    '''        if let previous = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previous)
        }
        for item in pendingHistory() {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        defaults.removeObject(forKey: pendingAccountKey)
''',
    "discard history cleanup")
text = replace_once(text,
    '''        if let previousPendingAccount = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previousPendingAccount)
        }
        deleteToken(account: legacyAccount)
''',
    '''        if let previousPendingAccount = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previousPendingAccount)
        }
        for item in pendingHistory() {
            deleteToken(account: item.account)
        }
        savePendingHistory([])
        deleteToken(account: legacyAccount)
''',
    "metadata cleanup history")
text = regex_once(text,
    r'''    private static func restorePreviousPendingTransaction\(\) \{.*?\n    \}\n\n    private static func clearPreviousPendingTransaction''',
    '''    private static func restorePreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        let restoredAccount = defaults.string(forKey: previousPendingAccountKey)
        let restoredPairingID = defaults.string(forKey: previousPendingPairingIDKey)
        var history = pendingHistory()
        let nextPrevious = history.popLast()
        savePendingHistory(history)

        if let restoredAccount {
            defaults.set(restoredAccount, forKey: pendingAccountKey)
        } else {
            defaults.removeObject(forKey: pendingAccountKey)
        }
        if let restoredPairingID {
            defaults.set(restoredPairingID, forKey: pendingPairingIDKey)
        } else {
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        if let nextPrevious {
            defaults.set(nextPrevious.account, forKey: previousPendingAccountKey)
            defaults.set(nextPrevious.pairingID, forKey: previousPendingPairingIDKey)
        } else {
            clearPreviousPendingTransaction()
        }
    }

    private struct PendingCredential: Codable {
        let account: String
        let pairingID: String
    }

    private static func pendingHistory() -> [PendingCredential] {
        guard let data = UserDefaults.standard.data(forKey: pendingHistoryKey),
              let decoded = try? JSONDecoder().decode([PendingCredential].self, from: data) else { return [] }
        return decoded
    }

    private static func savePendingHistory(_ history: [PendingCredential]) {
        let defaults = UserDefaults.standard
        guard !history.isEmpty else {
            defaults.removeObject(forKey: pendingHistoryKey)
            return
        }
        if let data = try? JSONEncoder().encode(history) {
            defaults.set(data, forKey: pendingHistoryKey)
        }
    }

    private static func clearPreviousPendingTransaction''',
    "restore pending stack")
path.write_text(text)
