from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    file.write_text(text.replace(old, new, 1))


def replace_between(path: str, start: str, end: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    first = text.find(start)
    if first < 0:
        raise SystemExit(f"{path}: start marker not found: {start}")
    last = text.find(end, first)
    if last < 0:
        raise SystemExit(f"{path}: end marker not found: {end}")
    file.write_text(text[:first] + replacement + text[last:])


def append_once(path: str, marker: str, content: str) -> None:
    file = Path(path)
    text = file.read_text()
    if marker in text:
        raise SystemExit(f"{path}: append marker already present: {marker}")
    file.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


# ---------------------------------------------------------------------------
# P1: preserve parser state across Swift ordinary/raw and multiline strings.
# ---------------------------------------------------------------------------
replace_between(
    "mac-helper/src/liveReload.js",
    "function maskCommentsAndStrings(source) {",
    "function compact(value) {",
    r'''function maskCommentsAndStrings(source) {
  let output = "";
  let mode = "code";
  let escaped = false;
  let blockCommentDepth = 0;
  let stringDelimiter = null;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\n") {
        mode = "code";
        output += char;
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "/" && next === "*") {
        output += "  ";
        index += 1;
        blockCommentDepth += 1;
      } else if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (mode === "string") {
      const closingLength = swiftStringClosingLength(source, index, stringDelimiter);
      if (closingLength > 0 && !escaped) {
        output += " ".repeat(closingLength);
        index += closingLength - 1;
        mode = "code";
        stringDelimiter = null;
        continue;
      }
      if (stringDelimiter.hashCount === 0 && !escaped && char === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
      blockCommentDepth = 1;
    } else {
      const opening = swiftStringOpeningDelimiter(source, index);
      if (opening) {
        output += " ".repeat(opening.length);
        index += opening.length - 1;
        mode = "string";
        escaped = false;
        stringDelimiter = opening;
      } else {
        output += char;
      }
    }
  }
  return output;
}

function swiftStringOpeningDelimiter(source, index) {
  let cursor = index;
  let hashCount = 0;
  while (source[cursor] === "#") {
    hashCount += 1;
    cursor += 1;
  }
  if (source.startsWith('"""', cursor)) {
    return { hashCount, quoteLength: 3, length: hashCount + 3 };
  }
  if (source[cursor] === '"') {
    return { hashCount, quoteLength: 1, length: hashCount + 1 };
  }
  return null;
}

function swiftStringClosingLength(source, index, delimiter) {
  if (!delimiter) return 0;
  const quotes = '"'.repeat(delimiter.quoteLength);
  if (!source.startsWith(quotes, index)) return 0;
  const hashes = "#".repeat(delimiter.hashCount);
  return source.startsWith(hashes, index + delimiter.quoteLength)
    ? delimiter.quoteLength + delimiter.hashCount
    : 0;
}

''',
)

append_once(
    "test/mainPostMergeIntegration.test.js",
    'raw Swift strings cannot hide following structural changes',
    r'''test("raw Swift strings cannot hide following structural changes", () => {
  const before = `struct Model {
  let text = #"He said "hello"#
  var count: Int = 0
}`;
  const after = before.replace("var count: Int", "var count: String");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.STORED_PROPERTY_CHANGED);
});

test("multiline Swift strings cannot hide following structural changes", () => {
  const before = `struct Model {
  let text = """
  He said "hello
  """
  var count: Int = 0
}`;
  const after = before.replace("var count: Int", "var count: String");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.STORED_PROPERTY_CHANGED);
});''',
)


# ---------------------------------------------------------------------------
# P2: preserve same-identity history originating from other Macs/links.
# ---------------------------------------------------------------------------
replace_exact(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    '''    static func managedAppShouldBeRemovedDuringSync(
        appID: String,
        ownerPairingID: String?,
        syncingMacID: String,
        remoteIDs: Set<String>
    ) -> Bool {
        ownerPairingID == syncingMacID && !remoteIDs.contains(appID)
    }
''',
    '''    static func managedAppShouldBeRemovedDuringSync(
        appID: String,
        ownerPairingID: String?,
        syncingMacID: String,
        remoteIDs: Set<String>
    ) -> Bool {
        ownerPairingID == syncingMacID && !remoteIDs.contains(appID)
    }

    static func managedBuildShouldBePreservedDuringSync(
        buildID: String,
        buildBaseURLString: String,
        remoteIDs: Set<String>,
        syncingBaseURLString: String
    ) -> Bool {
        !remoteIDs.contains(buildID) && buildBaseURLString != syncingBaseURLString
    }
''',
)

replace_exact(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    '''                if let index = managedApps.firstIndex(where: { $0.id == managed.id }) {
                    let localLastOpened = managedApps[index].lastOpened
                    managed.lastOpened = max(localLastOpened, managed.lastOpened)
                    managedApps[index] = managed
                } else {
                    managedApps.append(managed)
                }
''',
    '''                if let index = managedApps.firstIndex(where: { $0.id == managed.id }) {
                    let existing = managedApps[index]
                    let remoteBuildIDs = Set(managed.builds.map(\\.id))
                    let preservedForeignBuilds = existing.builds.filter { build in
                        Self.managedBuildShouldBePreservedDuringSync(
                            buildID: build.id,
                            buildBaseURLString: build.baseURLString,
                            remoteIDs: remoteBuildIDs,
                            syncingBaseURLString: mac.baseURLString
                        )
                    }
                    managed.lastOpened = max(existing.lastOpened, managed.lastOpened)
                    if !preservedForeignBuilds.isEmpty {
                        var buildsByID = Dictionary(
                            uniqueKeysWithValues: managed.builds.map { ($0.id, $0) }
                        )
                        for build in preservedForeignBuilds where buildsByID[build.id] == nil {
                            buildsByID[build.id] = build
                        }
                        managed.builds = buildsByID.values.sorted { $0.createdAt > $1.createdAt }
                        // A same-identity library entry containing history from
                        // more than one source remains local-only. No single Mac
                        // may gain archive/delete/build authority over the mix.
                        managed.ownerPairingID = nil
                        managed.archivedAt = existing.archivedAt
                    }
                    managedApps[index] = managed
                } else {
                    managedApps.append(managed)
                }
''',
)

append_once(
    "Companion/SwiftSimCompanionTests/InstallationStateTests.swift",
    "testMacSyncPreservesSameIdentityBuildsFromOtherSources",
    '''extension InstallationStateTests {
    @MainActor
    func testMacSyncPreservesSameIdentityBuildsFromOtherSources() {
        let remoteIDs: Set<String> = ["remote-current"]
        XCTAssertFalse(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "remote-current",
            buildBaseURLString: "https://mac-a.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
        XCTAssertFalse(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "remote-stale",
            buildBaseURLString: "https://mac-a.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
        XCTAssertTrue(SessionStore.managedBuildShouldBePreservedDuringSync(
            buildID: "foreign-link",
            buildBaseURLString: "https://mac-b.example/",
            remoteIDs: remoteIDs,
            syncingBaseURLString: "https://mac-a.example/"
        ))
    }
}''',
)


# ---------------------------------------------------------------------------
# P1: collision-resistant persisted ownership for detached build workers.
# ---------------------------------------------------------------------------
Path("mac-helper/src/ownedWorkerIdentity.js").write_text(r'''import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";

const OWNED_WORKER_RECORD_VERSION = 2;

export function requiredOwnedWorkerProcessRecord(pid, command) {
  const value = Number(pid);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const identity = kernelProcessIdentity(value);
    if (identity && identity.processGroup === value) {
      return {
        version: OWNED_WORKER_RECORD_VERSION,
        pid: value,
        processGroup: identity.processGroup,
        startToken: identity.startToken,
        executable: identity.executable,
        command: String(command || ""),
        createdAt: new Date().toISOString(),
      };
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish the active build worker process identity.");
}

export function completeOwnedWorkerProcessRecord(record) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  return Boolean(
    Number(record?.version) >= OWNED_WORKER_RECORD_VERSION
    && Number.isInteger(pid)
    && pid > 1
    && processGroup === pid
    && typeof record?.startToken === "string"
    && record.startToken
    && typeof record?.executable === "string"
    && record.executable
    && typeof record?.command === "string"
    && record.command
  );
}

export function ownedWorkerProcessState(record, options = {}) {
  if (!completeOwnedWorkerProcessRecord(record)) return "invalid";
  const pid = Number(record.pid);
  const alive = Object.prototype.hasOwnProperty.call(options, "alive")
    ? Boolean(options.alive)
    : processIsAlive(pid);
  if (!alive) return "dead";
  const identity = Object.prototype.hasOwnProperty.call(options, "identity")
    ? options.identity
    : kernelProcessIdentity(pid);
  if (!identity) return "unverifiable";
  return identity.processGroup === Number(record.processGroup)
    && identity.startToken === record.startToken
    && identity.executable === record.executable
    ? "current"
    : "replaced";
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}
''')

replace_exact(
    "mac-helper/src/deviceBuilderCore.js",
    'import { deviceAppIdentity, MAX_DEVICE_BUILD_LOG_LINES } from "./deviceBuildStore.js";\n',
    'import { deviceAppIdentity, MAX_DEVICE_BUILD_LOG_LINES } from "./deviceBuildStore.js";\n'
    'import { ownedWorkerProcessState, requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
)
replace_exact(
    "mac-helper/src/deviceBuilderCore.js",
    '''        writeFileSync(workerPath, JSON.stringify({
          pid: child.pid,
          startedAt: requiredProcessStartedAt(child.pid),
          command,
          createdAt: new Date().toISOString(),
        }), { mode: 0o600 });
''',
    '''        writeFileSync(
          workerPath,
          JSON.stringify(requiredOwnedWorkerProcessRecord(child.pid, command)),
          { mode: 0o600 },
        );
''',
)
replace_between(
    "mac-helper/src/deviceBuilderCore.js",
    "export async function terminateRecordedDeviceBuildWorker(build) {",
    "function signalProcessGroup(pid, signal) {",
    '''export async function terminateRecordedDeviceBuildWorker(build) {
  const workerPath = build?.control?.cancelPath ? `${build.control.cancelPath}.worker.json` : "";
  if (!workerPath || !existsSync(workerPath)) return true;
  let record;
  try { record = JSON.parse(readFileSync(workerPath, "utf8")); } catch { return false; }
  const state = ownedWorkerProcessState(record);
  if (state === "dead" || state === "replaced") {
    rmSync(workerPath, { force: true });
    return true;
  }
  if (state !== "current") return false;
  const terminated = await terminateRecordedOwnedProcessGroup(record, 2_000);
  if (terminated) rmSync(workerPath, { force: true });
  return terminated;
}

async function terminateRecordedOwnedProcessGroup(record, graceMs) {
  if (ownedWorkerProcessState(record) !== "current") return false;
  signalProcessGroup(record.processGroup, "SIGTERM");
  if (await waitForProcessGroupExit(record.processGroup, graceMs)) return true;
  // If the original group leader exited, a later process could reuse its PID
  // and PGID. Without the exact high-resolution identity, never authorize a
  // second signal against the observed group.
  if (ownedWorkerProcessState(record) !== "current") return false;
  signalProcessGroup(record.processGroup, "SIGKILL");
  return waitForProcessGroupExit(record.processGroup, 2_000);
}

''',
)

replace_exact(
    "mac-helper/src/buildValidation.js",
    'import { homedir } from "node:os";\n',
    'import { homedir } from "node:os";\n'
    'import { requiredOwnedWorkerProcessRecord } from "./ownedWorkerIdentity.js";\n',
)
replace_exact(
    "mac-helper/src/buildValidation.js",
    '''        writeFileSync(workerPath, JSON.stringify({
          pid: child.pid,
          startedAt: requiredProcessStartedAt(child.pid),
          command: "required-validation",
          createdAt: new Date().toISOString(),
        }), { mode: 0o600 });
''',
    '''        writeFileSync(
          workerPath,
          JSON.stringify(requiredOwnedWorkerProcessRecord(child.pid, "required-validation")),
          { mode: 0o600 },
        );
''',
)
replace_between(
    "mac-helper/src/buildValidation.js",
    "function requiredProcessStartedAt(pid) {",
    "function signalProcessGroup(pid, signal) {",
    "",
)

replace_exact(
    "mac-helper/src/deviceBuilder.js",
    'import { renewalCancellationPath } from "./renewalCancellation.js";\n',
    'import { renewalCancellationPath } from "./renewalCancellation.js";\n'
    'import { completeOwnedWorkerProcessRecord, ownedWorkerProcessState } from "./ownedWorkerIdentity.js";\n',
)
replace_exact(
    "mac-helper/src/deviceBuilder.js",
    '''  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || !record?.startedAt || !record?.command) {
    throw recoveryError(build, "has an incomplete worker identity");
  }

  if (!processIsAlive(pid)) return clearStaleWorkerJournal(workerPath);
  const observedStartedAt = processStartedAt(pid);
  if (!observedStartedAt) {
    if (!processIsAlive(pid)) return clearStaleWorkerJournal(workerPath);
    throw recoveryError(build, "points to a process whose start identity cannot be verified");
  }
  if (observedStartedAt !== record.startedAt) return clearStaleWorkerJournal(workerPath);

  const command = processCommand(pid);
''',
    '''  if (!completeOwnedWorkerProcessRecord(record)) {
    throw recoveryError(build, "has an incomplete or legacy worker identity");
  }

  const ownershipState = ownedWorkerProcessState(record);
  if (ownershipState === "dead" || ownershipState === "replaced") {
    return clearStaleWorkerJournal(workerPath);
  }
  if (ownershipState !== "current") {
    throw recoveryError(build, "points to a process whose start identity cannot be verified");
  }

  const pid = Number(record.pid);
  const command = processCommand(pid);
''',
)
replace_exact(
    "mac-helper/src/deviceBuilder.js",
    '''  if (!command || !expected.some((fragment) => command.includes(fragment))) {
    const finalStartedAt = processStartedAt(pid);
    if (!processIsAlive(pid) || !finalStartedAt || finalStartedAt !== record.startedAt) {
      return clearStaleWorkerJournal(workerPath);
    }
    throw recoveryError(build, "points to a process whose command cannot be verified");
  }
''',
    '''  if (!command || !expected.some((fragment) => command.includes(fragment))) {
    const finalOwnershipState = ownedWorkerProcessState(record);
    if (finalOwnershipState === "dead" || finalOwnershipState === "replaced") {
      return clearStaleWorkerJournal(workerPath);
    }
    if (finalOwnershipState !== "current") {
      throw recoveryError(build, "points to a process whose start identity cannot be verified");
    }
    throw recoveryError(build, "points to a process whose command cannot be verified");
  }
''',
)

replace_exact(
    "test/deviceBuilderTimeout.test.js",
    '''import {
  parseBuildSettings,
  runBuffered,
  terminateRecordedDeviceBuildWorker,
} from "../mac-helper/src/deviceBuilderCore.js";
''',
    '''import {
  parseBuildSettings,
  runBuffered,
  terminateRecordedDeviceBuildWorker,
} from "../mac-helper/src/deviceBuilderCore.js";
import { requiredOwnedWorkerProcessRecord } from "../mac-helper/src/ownedWorkerIdentity.js";
''',
)
replace_exact(
    "test/deviceBuilderTimeout.test.js",
    '''    const identity = spawnSync("/bin/ps", ["-p", String(child.pid), "-o", "lstart="], { encoding: "utf8" });
    writeFileSync(workerPath, JSON.stringify({
      pid: child.pid,
      startedAt: String(identity.stdout || "").trim(),
    }));
''',
    '''    writeFileSync(
      workerPath,
      JSON.stringify(requiredOwnedWorkerProcessRecord(child.pid, "node")),
    );
''',
)

replace_exact(
    "test/deviceBuilderRecovery.test.js",
    '''    writeFileSync(workerPath, JSON.stringify({
      pid: process.pid,
      startedAt: "Mon Jan  1 00:00:00 1990",
      command: "xcodebuild",
    }));
''',
    '''    writeFileSync(workerPath, JSON.stringify({
      version: 2,
      pid: process.pid,
      processGroup: process.pid,
      startToken: "darwin:stale-process-start",
      executable: process.execPath,
      command: "xcodebuild",
      createdAt: new Date().toISOString(),
    }));
''',
)
append_once(
    "test/deviceBuilderRecovery.test.js",
    "a live legacy worker journal fails closed",
    '''test("a live legacy worker journal fails closed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-recovery-legacy-live-"));
  try {
    const cancelPath = join(directory, "build", ".cancelled");
    const workerPath = `${cancelPath}.worker.json`;
    mkdirSync(dirname(cancelPath), { recursive: true });
    writeFileSync(workerPath, JSON.stringify({
      pid: process.pid,
      startedAt: "legacy-second-resolution-token",
      command: "xcodebuild",
    }));
    await assert.rejects(
      terminateRecordedDeviceBuildWorker({ id: "legacy-live", control: { cancelPath } }),
      (error) => error?.code === "SWIFT_SIM_UNSAFE_BUILD_RECOVERY"
    );
    assert.equal(existsSync(workerPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});''',
)


# ---------------------------------------------------------------------------
# Final ledger.
# ---------------------------------------------------------------------------
replace_exact("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P1 | 26 | 26 | 0 |", "| P1 | 28 | 28 | 0 |")
replace_exact("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P2 | 14 | 14 | 0 |", "| P2 | 15 | 15 | 0 |")
replace_exact(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "26. A verified detached live engine can be identity-checked and terminated before PID publication, closing the pre-publication abandonment window.\n",
    "26. A verified detached live engine can be identity-checked and terminated before PID publication, closing the pre-publication abandonment window.\n"
    "27. Swift source masking recognizes ordinary, raw/extended, multiline, and raw-multiline string delimiters, so quote characters inside valid literals cannot hide following structural declarations from rebuild classification.\n"
    "28. Persisted device-build and validation worker journals use the collision-resistant kernel start token, executable, and process-group identity; restart recovery never signals a live legacy, unverifiable, or PID-reused worker record.\n",
)
replace_exact(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "14. Optional live-target inspection is gated to Debug project builds, so ordinary Release archives do not run an unnecessary Debug build-settings query or trigger live-package resolution side effects.\n",
    "14. Optional live-target inspection is gated to Debug project builds, so ordinary Release archives do not run an unnecessary Debug build-settings query or trigger live-package resolution side effects.\n"
    "15. Same-identity Companion history from another Mac or an ownerless link survives Mac synchronization and remains local-only instead of being overwritten or inheriting remote mutation authority.\n",
)

# The publishing workflow and this transformer are intentionally self-cleaned.
Path(".github/workflows/manual-review-round3-final.yml").unlink(missing_ok=True)
Path("scripts/manual-review-round3-final.py").unlink(missing_ok=True)
