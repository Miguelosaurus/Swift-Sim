#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


root = Path(__file__).resolve().parents[1]
live_reload = root / "mac-helper/src/liveReload.js"

replace_once(
    live_reload,
    '''  const availableSchemes = isWorkspaceProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
''',
    '''  const availableSchemes = isXcodeContainerProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
''',
)

replace_once(
    live_reload,
    '''  const interposableConfigured = /-interposable/.test(projectSource);
''',
    '''  const interposableConfigured = projectConfiguration.interposableConfigured;
''',
)

replace_once(
    live_reload,
    '''function liveProjectConfiguration(projectPath, scheme = "") {
  if (!projectPath || !existsSync(projectPath)) {
    return { source: "", packageConfigured: false };
  }
  const source = readFileSync(projectPath, "utf8");
  if (!isWorkspaceProjectPath(projectPath)) {
    return {
      source,
      packageConfigured: /SwiftSimLive|github\\.com\\/Miguelosaurus\\/InjectionNext/i.test(source),
    };
  }

  const selected = selectedWorkspaceApplicationTarget(projectPath, scheme);
  if (!selected) return { source: "", packageConfigured: false };
  return {
    source: selected.source,
    packageConfigured: selectedTargetHasLivePackage(selected.source, selected.targetName),
  };
}

function selectedWorkspaceApplicationTarget(projectPath, scheme) {
  if (!scheme) return null;
  const settingsResult = spawnSync(
    "xcodebuild",
    [...xcodeContainerArguments(projectPath, scheme), "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (settingsResult.status !== 0 || settingsResult.error) return null;

  let settings;
  try {
    settings = selectLiveApplicationBuildSettings(settingsResult.stdout || "", scheme);
  } catch {
    return null;
  }
  const targetName = String(settings.TARGET_NAME || "").trim();
  const projectFile = normalizedProjectDefinitionPath(settings.PROJECT_FILE_PATH, projectPath);
  if (!targetName || !projectFile || !existsSync(projectFile)) return null;
  return {
    targetName,
    source: readFileSync(projectFile, "utf8"),
  };
}

function normalizedProjectDefinitionPath(value, workspacePath) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const absolute = candidate.startsWith("/")
    ? resolve(candidate)
    : resolve(projectRootFor(workspacePath), candidate);
''',
    '''function liveProjectConfiguration(projectPath, scheme = "") {
  if (!projectPath || !existsSync(projectPath)) {
    return { source: "", packageConfigured: false, interposableConfigured: false };
  }
  const source = readFileSync(projectPath, "utf8");
  if (!isXcodeContainerProjectPath(projectPath)) {
    return {
      source,
      packageConfigured: /SwiftSimLive|github\\.com\\/Miguelosaurus\\/InjectionNext/i.test(source),
      interposableConfigured: /-interposable/.test(source),
    };
  }

  const selected = selectedXcodeApplicationTarget(projectPath, scheme);
  if (!selected) {
    return { source, packageConfigured: false, interposableConfigured: false };
  }
  return {
    source: selected.source,
    packageConfigured: selectedTargetHasLivePackage(selected.source, selected.targetName),
    interposableConfigured: /(?:^|\\s)-interposable(?:\\s|$)/.test(
      String(selected.settings.OTHER_LDFLAGS || ""),
    ),
  };
}

function selectedXcodeApplicationTarget(projectPath, scheme) {
  if (!scheme) return null;
  const settingsResult = spawnSync(
    "xcodebuild",
    [...xcodeContainerArguments(projectPath, scheme), "-configuration", "Debug", "-showBuildSettings"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (settingsResult.status !== 0 || settingsResult.error) return null;

  let settings;
  try {
    settings = selectLiveApplicationBuildSettings(settingsResult.stdout || "", scheme);
  } catch {
    return null;
  }
  const targetName = String(settings.TARGET_NAME || "").trim();
  const projectFile = normalizedProjectDefinitionPath(settings.PROJECT_FILE_PATH, projectPath);
  if (!targetName || !projectFile || !existsSync(projectFile)) return null;
  return {
    targetName,
    settings,
    source: readFileSync(projectFile, "utf8"),
  };
}

function normalizedProjectDefinitionPath(value, containerPath) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  const absolute = candidate.startsWith("/")
    ? resolve(candidate)
    : resolve(projectRootFor(containerPath), candidate);
''',
)

replace_once(
    live_reload,
    '''    if (!dependencies) return false;
    if (/\\bSwiftSimLive\\b/.test(dependencies)) return true;
    const productIds = [...dependencies.matchAll(/\\b([A-Fa-f0-9]{24})\\b/g)]
''',
    '''    if (!dependencies) return false;
    const productIds = [...dependencies.matchAll(/\\b([A-Fa-f0-9]{24})\\b/g)]
''',
)

replace_once(
    live_reload,
    '''function isWorkspaceProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/contents.xcworkspacedata") || value.endsWith(".xcworkspace");
}
''',
    '''function isXcodeContainerProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/project.pbxproj")
    || value.endsWith(".xcodeproj")
    || value.endsWith("/contents.xcworkspacedata")
    || value.endsWith(".xcworkspace");
}

function isWorkspaceProjectPath(projectPath) {
  const value = resolve(String(projectPath || ""));
  return value.endsWith("/contents.xcworkspacedata") || value.endsWith(".xcworkspace");
}
''',
)

replace_once(
    live_reload,
    '''  if (!isWorkspaceProjectPath(projectPath)) {
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
''',
    '''  if (!isXcodeContainerProjectPath(projectPath)) {
    return { scheme: requested, availableSchemes: available, required: false, error: "" };
  }
''',
)

text = live_reload.read_text()
text = text.replace(
    "The workspace does not contain the '${requested}' scheme.",
    "The Xcode project or workspace does not contain the '${requested}' scheme.",
)
text = text.replace(
    "This workspace has multiple schemes. Pass --scheme with one of:",
    "This Xcode project or workspace has multiple schemes. Pass --scheme with one of:",
)
text = text.replace(
    "Swift Sim could not discover a shared workspace scheme. Pass --scheme explicitly.",
    "Swift Sim could not discover a shared scheme for this Xcode project or workspace. Pass --scheme explicitly.",
)
live_reload.write_text(text)

integration = root / "test/mainPostMergeIntegration.test.js"
replace_once(
    integration,
    '''test("workspace schemes are selected safely", () => {
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
    '''test("project and workspace schemes are selected safely", () => {
  for (const path of [
    "/tmp/App.xcodeproj/project.pbxproj",
    "/tmp/App.xcworkspace/contents.xcworkspacedata",
  ]) {
    assert.deepEqual(
      selectLiveScheme(path, "", ["App"]),
      { scheme: "App", availableSchemes: ["App"], required: false, error: "" },
    );
    const ambiguous = selectLiveScheme(path, "", ["App", "Tests"]);
    assert.equal(ambiguous.required, true);
    assert.match(ambiguous.error, /--scheme/);
    const missing = selectLiveScheme(path, "Missing", ["App"]);
    assert.equal(missing.required, true);
    assert.match(missing.error, /does not contain/);
  }
});
''',
)

with integration.open("a") as handle:
    handle.write(r'''


test("project live inspection applies the same scheme authority as workspaces", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(
    source,
    /const availableSchemes = isXcodeContainerProjectPath\(projectPath\)/,
  );
  assert.match(source, /selectedXcodeApplicationTarget\(projectPath, scheme\)/);
  assert.doesNotMatch(
    source.slice(
      source.indexOf("function liveProjectConfiguration"),
      source.indexOf("function selectedXcodeApplicationTarget"),
    ),
    /if \(!isWorkspaceProjectPath/,
  );
});
''')

workspace_package = root / "test/liveReloadWorkspacePackage.test.js"
with workspace_package.open("a") as handle:
    handle.write(r'''


test("PBX comments cannot impersonate a SwiftSimLive product dependency", () => {
  const misleading = project.replace(
    "packageProductDependencies = ();",
    "packageProductDependencies = (DDDDDDDDDDDDDDDDDDDDDDDD /* SwiftSimLive */);",
  );
  assert.equal(selectedTargetHasLivePackage(misleading, "SelectedApp"), false);
});
''')

docs = root / "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md"
replace_once(docs, "| P2 | 11 | 11 | 0 |", "| P2 | 12 | 12 | 0 |")
replace_once(
    docs,
    "11. Workspace package readiness is derived from the explicitly selected scheme's host application target and cannot be inherited from an unrelated project or target in the workspace.\n",
    "11. Workspace package readiness is derived from the explicitly selected scheme's host application target and cannot be inherited from an unrelated project or target in the workspace.\n12. `.xcodeproj` projects now use the same explicit scheme authority, selected-host-target package validation, and target-scoped linker settings as workspaces; stale PBX comments cannot impersonate a package dependency.\n",
)
replace_once(
    docs,
    "workspace schemes, selected-target package association, active engine-scheme identity",
    "project/workspace schemes, selected-target package association, stale PBX-comment rejection, active engine-scheme identity",
)

print("Applied manual PR #21 project scheme and target authority fix.")
