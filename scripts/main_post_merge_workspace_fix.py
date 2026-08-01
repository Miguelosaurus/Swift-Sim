from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, value: str) -> None:
    Path(path).write_text(value)


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


def replace_count(source: str, before: str, after: str, expected: int, label: str) -> str:
    count = source.count(before)
    if count != expected:
        raise RuntimeError(f"Expected {expected} {label} anchors, found {count}")
    return source.replace(before, after)


def patch_live_reload() -> None:
    path = "mac-helper/src/liveReload.js"
    source = read(path)
    source = replace_once(
        source,
        'async function inspectLiveReloadUnlocked({ project = "", host = "" } = {}) {\n',
        'async function inspectLiveReloadUnlocked({ project = "", host = "", scheme = "" } = {}) {\n',
        "inspect scheme option",
    )
    source = replace_once(
        source,
        '''  const projectSource = projectPath && existsSync(projectPath)
    ? readFileSync(projectPath, "utf8")
    : "";
''',
        '''  const projectSource = liveProjectDefinitionSource(projectPath);
  const availableSchemes = isWorkspaceProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
  const schemeSelection = selectLiveScheme(projectPath, scheme, availableSchemes);
''',
        "workspace project source",
    )
    source = replace_once(
        source,
        '''    tailscaleHost
    && packageConfigured
    && engineInstalled
''',
        '''    tailscaleHost
    && packageConfigured
    && engineInstalled
    && !schemeSelection.error
''',
        "workspace scheme readiness",
    )
    source = replace_once(
        source,
        '''      buildSettingsManagedBySwiftSim: packageConfigured,
    },
''',
        '''      buildSettingsManagedBySwiftSim: packageConfigured,
      scheme: schemeSelection.scheme,
      availableSchemes: schemeSelection.availableSchemes,
      schemeRequired: schemeSelection.required,
      schemeError: schemeSelection.error,
    },
''',
        "workspace scheme projection",
    )
    source = replace_once(
        source,
        'async function startLiveReloadUnlocked({ project = "", host = "", forceRestart = false } = {}) {\n',
        'async function startLiveReloadUnlocked({ project = "", host = "", scheme = "", forceRestart = false } = {}) {\n',
        "start scheme option",
    )
    source = replace_count(
        source,
        'inspectLiveReloadUnlocked({ project, host })',
        'inspectLiveReloadUnlocked({ project, host, scheme })',
        2,
        "locked inspect scheme propagation",
    )
    source = replace_once(
        source,
        '      error: "Pass the path to an .xcodeproj/project.pbxproj file.",\n',
        '      error: "Pass the path to an .xcodeproj/project.pbxproj or .xcworkspace/contents.xcworkspacedata file.",\n',
        "workspace readable error",
    )
    source = replace_once(
        source,
        '''  if (!status.host) {
    return { ...status, started: false, error: "Connect this Mac to Tailscale first." };
  }
''',
        '''  if (status.project.schemeError) {
    return { ...status, started: false, error: status.project.schemeError };
  }
  if (!status.host) {
    return { ...status, started: false, error: "Connect this Mac to Tailscale first." };
  }
''',
        "workspace scheme start error",
    )
    source = replace_once(
        source,
        '  const signingIdentities = resolveSigningIdentities(status.project.path);\n',
        '  const signingIdentities = resolveSigningIdentities(status.project.path, status.project.scheme);\n',
        "workspace signing scheme",
    )
    source = replace_once(
        source,
        '''    && session?.projectRoot === status.project.root
    && session?.signingIdentity === signingIdentity
''',
        '''    && session?.projectRoot === status.project.root
    && session?.scheme === status.project.scheme
    && session?.signingIdentity === signingIdentity
''',
        "workspace session reuse scheme",
    )
    source = replace_once(
        source,
        '''      projectRoot: status.project.root,
      signingIdentity,
''',
        '''      projectRoot: status.project.root,
      scheme: status.project.scheme,
      signingIdentity,
''',
        "workspace session publication scheme",
    )
    source = replace_once(
        source,
        'export async function routeLiveChange({ beforePath, afterPath, project = "", host = "" }) {\n',
        'export async function routeLiveChange({ beforePath, afterPath, project = "", host = "", scheme = "" }) {\n',
        "route one scheme option",
    )
    source = replace_once(
        source,
        '''    project,
    host,
  });
}

export async function routeLiveChanges''',
        '''    project,
    host,
    scheme,
  });
}

export async function routeLiveChanges''',
        "route one scheme pass",
    )
    source = replace_once(
        source,
        'export async function routeLiveChanges({ beforePaths = [], afterPaths = [], project = "", host = "", runtime } = {}) {\n',
        'export async function routeLiveChanges({ beforePaths = [], afterPaths = [], project = "", host = "", scheme = "", runtime } = {}) {\n',
        "route many scheme option",
    )
    source = replace_once(
        source,
        '''    project,
    host,
    runtime,
  });
}

export async function routeLiveEditSet''',
        '''    project,
    host,
    scheme,
    runtime,
  });
}

export async function routeLiveEditSet''',
        "route many scheme pass",
    )
    source = replace_once(
        source,
        '  const { runtime = {}, project = "", host = "" } = options;\n',
        '  const { runtime = {}, project = "", host = "", scheme = "" } = options;\n',
        "route set scheme option",
    )
    source = replace_once(
        source,
        '(runtime.recover || defaultRecoverLiveSession)({ project, host })',
        '(runtime.recover || defaultRecoverLiveSession)({ project, host, scheme })',
        "recovery scheme pass",
    )
    source = replace_once(
        source,
        'async function routeLiveEditSetOnce({ files = [], project = "", host = "", runtime = {} } = {}) {\n',
        'async function routeLiveEditSetOnce({ files = [], project = "", host = "", scheme = "", runtime = {} } = {}) {\n',
        "route once scheme option",
    )
    source = source.replace('inspect({ project, host })', 'inspect({ project, host, scheme })')
    source = replace_once(
        source,
        'async function defaultRecoverLiveSession({ project, host }) {\n',
        'async function defaultRecoverLiveSession({ project, host, scheme }) {\n',
        "default recovery scheme option",
    )
    source = replace_once(
        source,
        'startLiveReload({ project, host, forceRestart: true })',
        'startLiveReload({ project, host, scheme, forceRestart: true })',
        "recovery start scheme",
    )
    source = source.replace('inspectLiveReload({ project, host })', 'inspectLiveReload({ project, host, scheme })')
    source = replace_once(
        source,
        '''export function xcodeContainerArguments(projectPath) {
  const sourcePath = resolve(String(projectPath || ""));
  const projectContainer = sourcePath.endsWith("/project.pbxproj")
    ? dirname(sourcePath)
    : sourcePath.endsWith("/contents.xcworkspacedata")
      ? dirname(sourcePath)
      : sourcePath;
  return [projectContainer.endsWith(".xcworkspace") ? "-workspace" : "-project", projectContainer];
}

function resolveSigningIdentities(projectPath) {
  const containerArguments = xcodeContainerArguments(projectPath);
''',
        '''export function xcodeContainerArguments(projectPath, scheme = "") {
  const sourcePath = resolve(String(projectPath || ""));
  const projectContainer = sourcePath.endsWith("/project.pbxproj")
    ? dirname(sourcePath)
    : sourcePath.endsWith("/contents.xcworkspacedata")
      ? dirname(sourcePath)
      : sourcePath;
  const argumentsList = [
    projectContainer.endsWith(".xcworkspace") ? "-workspace" : "-project",
    projectContainer,
  ];
  if (String(scheme || "").trim()) argumentsList.push("-scheme", String(scheme).trim());
  return argumentsList;
}

export function workspaceProjectReferences(workspaceSource, projectPath) {
  if (!isWorkspaceProjectPath(projectPath)) return [];
  const workspaceDirectory = dirname(resolve(String(projectPath)));
  const workspaceRoot = dirname(workspaceDirectory);
  const references = [];
  for (const match of String(workspaceSource || "").matchAll(/location\\s*=\\s*"([^"]+\\.xcodeproj)"/g)) {
    const decoded = decodeXMLAttribute(match[1]);
    const separator = decoded.indexOf(":");
    const kind = separator >= 0 ? decoded.slice(0, separator) : "group";
    const value = separator >= 0 ? decoded.slice(separator + 1) : decoded;
    let container;
    if (kind === "absolute") container = resolve(value);
    else if (kind === "self") container = resolve(workspaceDirectory, value);
    else container = resolve(workspaceRoot, value);
    const projectFile = container.endsWith("/project.pbxproj")
      ? container
      : join(container, "project.pbxproj");
    if (!references.includes(projectFile)) references.push(projectFile);
  }
  return references;
}

export function selectLiveScheme(projectPath, requestedScheme = "", availableSchemes = []) {
  const requested = String(requestedScheme || "").trim();
  const available = [...new Set((availableSchemes || []).map((value) => String(value).trim()).filter(Boolean))];
  if (!isWorkspaceProjectPath(projectPath)) {
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
  if (requested) {
    if (available.length > 0 && !available.includes(requested)) {
      return {
        scheme: "",
        availableSchemes: available,
        required: true,
        error: `The workspace does not contain the '${requested}' scheme. Choose one of: ${available.join(", ")}.`,
      };
    }
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
  if (available.length === 1) {
    return { scheme: available[0], availableSchemes: available, required: false, error: "" };
  }
  return {
    scheme: "",
    availableSchemes: available,
    required: true,
    error: available.length > 1
      ? `This workspace has multiple schemes. Pass --scheme with one of: ${available.join(", ")}.`
      : "Swift Sim could not discover a shared workspace scheme. Pass --scheme explicitly.",
  };
}

function resolveSigningIdentities(projectPath, scheme = "") {
  const containerArguments = xcodeContainerArguments(projectPath, scheme);
''',
        "workspace Xcode helpers",
    )
    source = replace_once(
        source,
        '''function projectRootFor(projectPath) {
  if (!projectPath) return "";
  const absolute = resolve(projectPath);
  if (absolute.endsWith("/project.pbxproj")) return dirname(dirname(absolute));
  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) return dirname(absolute);
  return dirname(absolute);
}
''',
        '''function projectRootFor(projectPath) {
  if (!projectPath) return "";
  const absolute = resolve(projectPath);
  if (absolute.endsWith("/project.pbxproj") || absolute.endsWith("/contents.xcworkspacedata")) {
    return dirname(dirname(absolute));
  }
  if (absolute.endsWith(".xcodeproj") || absolute.endsWith(".xcworkspace")) return dirname(absolute);
  return dirname(absolute);
}

function liveProjectDefinitionSource(projectPath) {
  if (!projectPath || !existsSync(projectPath)) return "";
  const source = readFileSync(projectPath, "utf8");
  if (!isWorkspaceProjectPath(projectPath)) return source;
  const projectSources = workspaceProjectReferences(source, projectPath)
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
  return [source, ...projectSources].join("\\n");
}

function listedLiveSchemes(projectPath) {
  const result = spawnSync(
    "xcodebuild",
    [...xcodeContainerArguments(projectPath), "-list", "-json"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) return [];
  try {
    const payload = JSON.parse(result.stdout || "{}");
    return payload.workspace?.schemes || payload.project?.schemes || [];
  } catch {
    return [];
  }
}

function isWorkspaceProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/contents.xcworkspacedata") || value.endsWith(".xcworkspace");
}

function decodeXMLAttribute(value) {
  return String(value || "")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
''',
        "workspace project resolution",
    )
    write(path, source)


def patch_cli() -> None:
    path = "mac-helper/bin/swift-sim.js"
    source = read(path)
    source = replace_count(
        source,
        '''    project: values.project,
    host: values.host,
''',
        '''    project: values.project,
    host: values.host,
    scheme: values.scheme,
''',
        2,
        "live status/start scheme",
    )
    source = replace_once(
        source,
        '''      project: values.project,
      host: values.host,
    });
''',
        '''      project: values.project,
      host: values.host,
      scheme: values.scheme,
    });
''',
        "manifest route scheme",
    )
    source = replace_once(
        source,
        '''      project: values.project, host: values.host,
    })
''',
        '''      project: values.project, host: values.host, scheme: values.scheme,
    })
''',
        "single route scheme",
    )
    source = replace_once(
        source,
        '''      project: values.project, host: values.host,
    });
''',
        '''      project: values.project, host: values.host, scheme: values.scheme,
    });
''',
        "multi route scheme",
    )
    source = replace_once(
        source,
        '''    project: { type: "string" },
    host: { type: "string" },
''',
        '''    project: { type: "string" },
    host: { type: "string" },
    scheme: { type: "string" },
''',
        "live scheme CLI option",
    )
    write(path, source)


def patch_session_store() -> None:
    path = "Companion/SwiftSimCompanion/SessionStore.swift"
    source = read(path)
    source = replace_once(
        source,
        '''        let expectedPairingRevision = pairingRevision
        let recentSnapshot = recentSessions
''',
        '''        let expectedPairingRevision = pairingRevision
        let expectedSimulatorViewRevision = deviceBuildViewRevision
        let recentSnapshot = recentSessions
''',
        "connection simulator revision snapshot",
    )
    source = replace_once(
        source,
        '''        simulatorCheck = recentSessions.isEmpty
            ? .notConfigured("Open a Simulator link in Swift Sim")
''',
        '''        simulatorCheck = recentSnapshot.isEmpty
            ? .notConfigured("Open a Simulator link in Swift Sim")
''',
        "connection snapshot UI",
    )
    source = replace_once(
        source,
        '''    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {
        ownerPairingID == pairedMacID
    }
''',
        '''    static func managedAppOwnerIsCurrent(ownerPairingID: String?, pairedMacID: String) -> Bool {
        ownerPairingID == pairedMacID
    }

    static func connectionDiagnosticsAreCurrent(
        currentMac: PairedMac?,
        expectedMac: PairedMac?,
        currentPairingRevision: UInt64,
        expectedPairingRevision: UInt64,
        currentSimulatorViewRevision: UInt64,
        expectedSimulatorViewRevision: UInt64
    ) -> Bool {
        pairingContextIsCurrent(
            current: currentMac,
            expected: expectedMac,
            currentRevision: currentPairingRevision,
            expectedRevision: expectedPairingRevision
        ) && revisionIsCurrent(
            current: currentSimulatorViewRevision,
            expected: expectedSimulatorViewRevision
        )
    }
''',
        "connection diagnostics helper",
    )
    source = replace_once(
        source,
        '''        guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),
              Self.pairingContextIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return }

        if let availableSession {
''',
        '''        guard Self.revisionIsCurrent(current: connectionChecksRevision, expected: checkRevision),
              Self.connectionDiagnosticsAreCurrent(
                currentMac: pairedMac,
                expectedMac: expectedMac,
                currentPairingRevision: pairingRevision,
                expectedPairingRevision: expectedPairingRevision,
                currentSimulatorViewRevision: deviceBuildViewRevision,
                expectedSimulatorViewRevision: expectedSimulatorViewRevision
              ) else { return }

        if let availableSession {
''',
        "connection final simulator fence",
    )
    write(path, source)


def patch_lock_wait() -> None:
    path = "mac-helper/src/liveEngineLifecycleLock.js"
    source = read(path)
    source = replace_once(
        source,
        "const DEFAULT_WAIT_MS = 15_000;\n",
        "const DEFAULT_WAIT_MS = 120_000;\n",
        "live engine lifecycle wait budget",
    )
    write(path, source)


def patch_tests() -> None:
    path = "test/mainPostMergeIntegration.test.js"
    source = read(path)
    source = replace_once(
        source,
        '''  LIVE_REASON_CODES,
  xcodeContainerArguments,
''',
        '''  LIVE_REASON_CODES,
  selectLiveScheme,
  workspaceProjectReferences,
  xcodeContainerArguments,
''',
        "workspace test imports",
    )
    source = replace_once(
        source,
        '''  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcworkspace/contents.xcworkspacedata"),
    ["-workspace", "/tmp/App.xcworkspace"],
  );
});
''',
        '''  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcworkspace/contents.xcworkspacedata"),
    ["-workspace", "/tmp/App.xcworkspace"],
  );
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcworkspace/contents.xcworkspacedata", "App"),
    ["-workspace", "/tmp/App.xcworkspace", "-scheme", "App"],
  );
});

test("workspace project references resolve beside the workspace", () => {
  const source = `<Workspace><FileRef location="group:App.xcodeproj"></FileRef></Workspace>`;
  assert.deepEqual(
    workspaceProjectReferences(source, "/tmp/Repo/App.xcworkspace/contents.xcworkspacedata"),
    ["/tmp/Repo/App.xcodeproj/project.pbxproj"],
  );
});

test("workspace schemes are selected safely", () => {
  assert.deepEqual(
    selectLiveScheme("/tmp/App.xcworkspace/contents.xcworkspacedata", "", ["App"]),
    { scheme: "App", availableSchemes: ["App"], required: false, error: "" },
  );
  const ambiguous = selectLiveScheme(
    "/tmp/App.xcworkspace/contents.xcworkspacedata",
    "",
    ["App", "Tests"],
  );
  assert.equal(ambiguous.required, true);
  assert.match(ambiguous.error, /--scheme/);
});
''',
        "workspace behavior tests",
    )
    write(path, source)


def patch_swift_tests() -> None:
    path = "Companion/SwiftSimCompanionTests/InstallationStateTests.swift"
    source = read(path)
    test = '''

extension InstallationStateTests {
    @MainActor
    func testConnectionDiagnosticsRejectAChangedSimulatorView() {
        let mac = PairedMac(
            token: "token",
            baseURL: URL(string: "https://mac.example")!
        )
        XCTAssertTrue(SessionStore.connectionDiagnosticsAreCurrent(
            currentMac: mac,
            expectedMac: mac,
            currentPairingRevision: 4,
            expectedPairingRevision: 4,
            currentSimulatorViewRevision: 8,
            expectedSimulatorViewRevision: 8
        ))
        XCTAssertFalse(SessionStore.connectionDiagnosticsAreCurrent(
            currentMac: mac,
            expectedMac: mac,
            currentPairingRevision: 4,
            expectedPairingRevision: 4,
            currentSimulatorViewRevision: 9,
            expectedSimulatorViewRevision: 8
        ))
    }
}
'''
    if "testConnectionDiagnosticsRejectAChangedSimulatorView" in source:
        raise RuntimeError("Swift diagnostics test already exists")
    write(path, source + test)


patch_live_reload()
patch_cli()
patch_session_store()
patch_lock_wait()
patch_tests()
patch_swift_tests()
print("Applied workspace and stale-diagnostics fixes.")
