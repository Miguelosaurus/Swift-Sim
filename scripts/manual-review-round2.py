from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:80]!r}")
    write(path, text.replace(old, new, 1))


# P1: allow exact verified rollback before the PID record is published.
replace_once(
    "mac-helper/src/liveEngineOwnershipPreload.js",
    "export function parseLiveEngineProcessRecord(raw, {\n",
    "export function abortPendingLiveEngine(pid) {\n"
    "  const value = Number(pid);\n"
    "  const record = pendingRecords.get(value);\n"
    "  if (!record) return false;\n"
    "  pendingRecords.delete(value);\n"
    "  terminateExactProcessGroup(record);\n"
    "  return true;\n"
    "}\n\n"
    "export function parseLiveEngineProcessRecord(raw, {\n",
)
replace_once(
    "mac-helper/src/liveReload.js",
    'import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";\n',
    'import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";\n'
    'import { abortPendingLiveEngine } from "./liveEngineOwnershipPreload.js";\n',
)
old_spawn = "\n".join([
    '    const output = openSync(ENGINE_LOG, "a");',
    '    let child;',
    '    try {',
    '      child = spawn(ENGINE_EXECUTABLE, [], {',
    '        detached: true,',
    '        stdio: ["ignore", output, output],',
    '        env: {',
    '          ...process.env,',
    '          SWIFT_SIM_ENGINE: "1",',
    '          SWIFT_SIM_ENGINE_SOCKET: ENGINE_SOCKET,',
    '          SWIFT_SIM_PROJECT_ROOT: status.project.root,',
    '          SWIFT_SIM_CODESIGN_IDENTITY: signingIdentity,',
    '        },',
    '      });',
    '      await waitForChildSpawn(child);',
    '    } finally {',
    '      closeSync(output);',
    '    }',
    '    writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });',
    '',
])
new_spawn = "\n".join([
    '    const output = openSync(ENGINE_LOG, "a");',
    '    let child;',
    '    let prepublicationError = null;',
    '    try {',
    '      child = spawn(ENGINE_EXECUTABLE, [], {',
    '        detached: true,',
    '        stdio: ["ignore", output, output],',
    '        env: {',
    '          ...process.env,',
    '          SWIFT_SIM_ENGINE: "1",',
    '          SWIFT_SIM_ENGINE_SOCKET: ENGINE_SOCKET,',
    '          SWIFT_SIM_PROJECT_ROOT: status.project.root,',
    '          SWIFT_SIM_CODESIGN_IDENTITY: signingIdentity,',
    '        },',
    '      });',
    '      await waitForChildSpawn(child);',
    '    } catch (error) {',
    '      prepublicationError = error;',
    '    }',
    '    try {',
    '      closeSync(output);',
    '    } catch (error) {',
    '      prepublicationError ||= error;',
    '    }',
    '    if (prepublicationError) {',
    '      if (child?.pid) {',
    '        try { abortPendingLiveEngine(child.pid); } catch {}',
    '      }',
    '      throw prepublicationError;',
    '    }',
    '    try {',
    '      writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });',
    '    } catch (error) {',
    '      // The ownership boundary normally performs this rollback.',
    '      // This also covers errors before the guarded write consumes',
    '      // the verified pending process record.',
    '      if (child?.pid) {',
    '        try { abortPendingLiveEngine(child.pid); } catch {}',
    '      }',
    '      throw error;',
    '    }',
    '',
])
replace_once("mac-helper/src/liveReload.js", old_spawn, new_spawn)

# P1: use the selected host target and confine live flags to the live lane.
replace_once(
    "mac-helper/src/liveReload.js",
    "function selectedXcodeApplicationTarget(projectPath, scheme) {\n",
    "export function selectedXcodeApplicationTarget(projectPath, scheme) {\n",
)
replace_once(
    "mac-helper/src/deviceBuilderCore.js",
    'import { withLiveBuildSession } from "./liveReload.js";\n',
    'import {\n'
    '  selectedTargetHasLivePackage,\n'
    '  selectedXcodeApplicationTarget,\n'
    '  withLiveBuildSession,\n'
    '} from "./liveReload.js";\n',
)
old_eligibility = "\n".join([
    '    const requestedBuildSettingArgs = xcodeBuildSettingArgs(build.buildSettings);',
    '    const liveEligible = String(build.configuration || "").toLowerCase() === "debug"',
    '      && target.type === "project"',
    '      && projectHasLivePackage(target);',
    '    let buildSettingArgs = liveEligible',
    '      ? [...requestedBuildSettingArgs, ...managedLiveBuildSettings()]',
    '      : requestedBuildSettingArgs;',
    '    throwIfBuildCancelled(build);',
    '',
])
new_eligibility = "\n".join([
    '    const requestedBuildSettingArgs = xcodeBuildSettingArgs(build.buildSettings);',
    '    throwIfBuildCancelled(build);',
    '    const selectedLiveTarget = target.type === "project"',
    '      ? selectedXcodeApplicationTarget(join(target.path, "project.pbxproj"), build.scheme)',
    '      : null;',
    '    const liveEligible = String(build.configuration || "").toLowerCase() === "debug"',
    '      && target.type === "project"',
    '      && Boolean(selectedLiveTarget)',
    '      && selectedTargetHasLivePackage(selectedLiveTarget.source, selectedLiveTarget.targetName);',
    '    let buildSettingArgs = requestedBuildSettingArgs;',
    '',
])
replace_once("mac-helper/src/deviceBuilderCore.js", old_eligibility, new_eligibility)
replace_once(
    "mac-helper/src/deviceBuilderCore.js",
    '    build.app.bundleIdentifier = resolvedIdentity.bundleIdentifier;\n',
    '    const liveBuildSettingArgs = liveEligible\n'
    '      ? [...buildSettingArgs, ...managedLiveBuildSettings()]\n'
    '      : buildSettingArgs;\n'
    '    build.app.bundleIdentifier = resolvedIdentity.bundleIdentifier;\n',
)
core_path = Path("mac-helper/src/deviceBuilderCore.js")
core = core_path.read_text()
live_start = core.index('          log("Building the signed live-enabled Debug app.");')
live_end = core.index("          const appPath = findBuiltApp", live_start)
live_block = core[live_start:live_end]
if live_block.count("...buildSettingArgs,") != 1:
    raise SystemExit("deviceBuilderCore.js: expected one live build settings argument")
live_block = live_block.replace("...buildSettingArgs,", "...liveBuildSettingArgs,", 1)
core_path.write_text(core[:live_start] + live_block + core[live_end:])
broad_helper = "\n".join([
    'function projectHasLivePackage(target) {',
    '  try {',
    '    return /SwiftSimLive|github\\.com\\/Miguelosaurus\\/InjectionNext/i.test(',
    '      readFileSync(join(target.path, "project.pbxproj"), "utf8")',
    '    );',
    '  } catch {',
    '    return false;',
    '  }',
    '}',
    '',
])
replace_once("mac-helper/src/deviceBuilderCore.js", broad_helper, "")

# P2: synchronize only records owned by the exact paired Mac.
owner_helper = "\n".join([
    '    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {',
    '        ownerPairingID == pairedMacID',
    '    }',
    '',
])
owner_helper_new = "\n".join([
    '    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {',
    '        ownerPairingID == pairedMacID',
    '    }',
    '',
    '    static func managedAppShouldBeRemovedDuringSync(',
    '        appID: String,',
    '        ownerPairingID: String?,',
    '        syncingMacID: String,',
    '        remoteIDs: Set<String>',
    '    ) -> Bool {',
    '        ownerPairingID == syncingMacID && !remoteIDs.contains(appID)',
    '    }',
    '',
])
replace_once("Companion/SwiftSimCompanion/SessionStore.swift", owner_helper, owner_helper_new)
old_remote_ids = "\n".join([
    '            let existingRemoteIDs = Set(managedApps',
    '                .filter { !$0.id.hasPrefix("local:") && !$0.id.hasPrefix("pending:") }',
    '                .map(\\.id))',
    '',
])
new_remote_ids = "\n".join([
    '            let existingRemoteIDs = Set(managedApps',
    '                .filter { $0.ownerPairingID == mac.id }',
    '                .map(\\.id))',
    '',
])
replace_once("Companion/SwiftSimCompanion/SessionStore.swift", old_remote_ids, new_remote_ids)
old_remove = "\n".join([
    '            managedApps.removeAll { app in',
    '                !app.id.hasPrefix("local:")',
    '                    && !app.id.hasPrefix("pending:")',
    '                    && !remoteIDs.contains(app.id)',
    '            }',
    '',
])
new_remove = "\n".join([
    '            managedApps.removeAll { app in',
    '                Self.managedAppShouldBeRemovedDuringSync(',
    '                    appID: app.id,',
    '                    ownerPairingID: app.ownerPairingID,',
    '                    syncingMacID: mac.id,',
    '                    remoteIDs: remoteIDs',
    '                )',
    '            }',
    '',
])
replace_once("Companion/SwiftSimCompanion/SessionStore.swift", old_remove, new_remove)

# Regressions.
replace_once(
    "test/liveEngineOwnershipPreload.test.js",
    'import {\n  liveEngineProcessRecordIsCurrent,\n  parseLiveEngineProcessRecord,\n} from "../mac-helper/src/liveEngineOwnershipPreload.js";\n',
    'import {\n  abortPendingLiveEngine,\n  liveEngineProcessRecordIsCurrent,\n  parseLiveEngineProcessRecord,\n} from "../mac-helper/src/liveEngineOwnershipPreload.js";\n',
)
ownership_test = r'''

test("a verified engine can be rolled back before PID publication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-live-prepublication-"));
  const pidPath = join(directory, "engine.pid");
  const script = `
    import { spawn } from 'node:child_process';
    import { setTimeout as delay } from 'node:timers/promises';
    import { abortPendingLiveEngine, installLiveEngineOwnershipBoundary } from ${JSON.stringify(preloadURL)};
    installLiveEngineOwnershipBoundary({ engineExecutable: process.execPath, pidPath: ${JSON.stringify(pidPath)} });
    const engine = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    });
    const aborted = abortPendingLiveEngine(engine.pid);
    await delay(100);
    console.log(JSON.stringify({ aborted, engineAlive: alive(engine.pid) }));
    function alive(pid) {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }
  `;
  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { stdout, stderr, code } = await collect(child);
    assert.equal(code, 0, stderr);
    const observed = JSON.parse(stdout.trim());
    assert.equal(observed.aborted, true);
    assert.equal(observed.engineAlive, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
Path("test/liveEngineOwnershipPreload.test.js").write_text(read("test/liveEngineOwnershipPreload.test.js") + ownership_test)
integration_test = r'''

test("device live instrumentation cannot leak into fallback archives", () => {
  const source = readFileSync("mac-helper/src/deviceBuilderCore.js", "utf8");
  assert.match(source, /selectedXcodeApplicationTarget\(join\(target\.path, "project\.pbxproj"\), build\.scheme\)/);
  assert.match(source, /selectedTargetHasLivePackage\(selectedLiveTarget\.source, selectedLiveTarget\.targetName\)/);
  assert.doesNotMatch(source, /function projectHasLivePackage/);
  const liveStart = source.indexOf('log("Building the signed live-enabled Debug app.")');
  const liveEnd = source.indexOf("const appPath = findBuiltApp", liveStart);
  assert.match(source.slice(liveStart, liveEnd), /\.\.\.liveBuildSettingArgs,/);
  const fallbackStart = source.indexOf('log("Archiving for generic iOS device.")');
  const fallbackEnd = source.indexOf('log("Exporting signed IPA.")', fallbackStart);
  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /\.\.\.buildSettingArgs,/);
  assert.doesNotMatch(fallback, /liveBuildSettingArgs|managedLiveBuildSettings/);
});
'''
Path("test/mainPostMergeIntegration.test.js").write_text(read("test/mainPostMergeIntegration.test.js") + integration_test)
swift_test = '''

extension InstallationStateTests {
    @MainActor
    func testMacSyncOnlyRemovesHistoryOwnedByThatMac() {
        let remoteIDs: Set<String> = ["present"]
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "ownerless", ownerPairingID: nil, syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "other-mac", ownerPairingID: "mac-b", syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertTrue(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "missing", ownerPairingID: "mac-a", syncingMacID: "mac-a", remoteIDs: remoteIDs))
        XCTAssertFalse(SessionStore.managedAppShouldBeRemovedDuringSync(appID: "present", ownerPairingID: "mac-a", syncingMacID: "mac-a", remoteIDs: remoteIDs))
    }
}
'''
Path("Companion/SwiftSimCompanionTests/InstallationStateTests.swift").write_text(read("Companion/SwiftSimCompanionTests/InstallationStateTests.swift") + swift_test)

# Ledger.
replace_once("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P1 | 24 | 24 | 0 |", "| P1 | 26 | 26 | 0 |")
replace_once("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P2 | 12 | 12 | 0 |", "| P2 | 13 | 13 | 0 |")
replace_once(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "24. Generic lock owner publication is bound to the exact directory device/inode and intended owner record after the write, so a suspended writer cannot resume into a quarantined directory and execute without mutual exclusion or erase a replacement owner.\n",
    "24. Generic lock owner publication is bound to the exact directory device/inode and intended owner record after the write, so a suspended writer cannot resume into a quarantined directory and execute without mutual exclusion or erase a replacement owner.\n25. Device-build live eligibility uses the selected scheme's authoritative host application, and managed implicit-dynamic/interposable flags cannot leak into the ordinary fallback archive.\n26. A verified detached live engine can be identity-checked and terminated before PID publication, closing the pre-publication abandonment window.\n",
)
replace_once(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "12. `.xcodeproj` projects now use the same explicit scheme authority, selected-host-target package validation, and target-scoped linker settings as workspaces; stale PBX comments cannot impersonate a package dependency.\n",
    "12. `.xcodeproj` projects now use the same explicit scheme authority, selected-host-target package validation, and target-scoped linker settings as workspaces; stale PBX comments cannot impersonate a package dependency.\n13. Companion Mac synchronization removes only history explicitly owned by that same Mac; ownerless link history and another Mac's history survive unrelated syncs.\n",
)
replace_once(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "identity-failure no-signal behavior, PID/session publication rollback,",
    "identity-failure no-signal behavior, pre-publication/PID/session publication rollback,",
)

# Self-clean every temporary runner and trigger.
for temporary in [
    ".github/workflows/manual-review-round2.yml",
    ".github/workflows/manual-review-round2-v2.yml",
    ".github/workflows/manual-review-round2-pr.yml",
    ".github/workflows/manual-review-round2-final.yml",
    "docs/manual-review-round2-trigger.txt",
    "scripts/manual-review-round2.py",
]:
    Path(temporary).unlink(missing_ok=True)
