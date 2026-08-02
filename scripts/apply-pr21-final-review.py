#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


root = Path(__file__).resolve().parents[1]

lifecycle = root / "mac-helper/src/liveEngineLifecycleLock.js"
replace_once(
    lifecycle,
    '''function readOwner(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
''',
    '''function readOwner(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return completeOwnerRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function completeOwnerRecord(value) {
  const pid = Number(value?.pid);
  const startToken = ownerStartToken(value);
  return Boolean(value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isInteger(pid)
    && pid > 1
    && startToken
    && typeof value.nonce === "string"
    && value.nonce.length > 0);
}
''',
)

lifecycle_test = root / "test/liveEngineLifecycleLock.test.js"
insert_before = '''

test("failed creator cleanup never deletes a replacement lock", () => {
'''
new_tests = '''

test("a parseable malformed owner record cannot permanently block the lifecycle lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-parseable-malformed-owner-"));
  const lockPath = join(directory, "lifecycle.lock");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({}));
  const staleTime = new Date(Date.now() - 5_000);
  utimesSync(lockPath, staleTime, staleTime);
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a parseable malformed reclaim record cannot permanently block a stale lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-engine-parseable-malformed-reclaim-"));
  const lockPath = join(directory, "lifecycle.lock");
  const claimPath = join(lockPath, "reclaim.json");
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(join(lockPath, "owner.json"), JSON.stringify({
    pid: 999_995,
    startedAt: "stale-owner",
    nonce: "stale-owner",
  }));
  writeFileSync(claimPath, JSON.stringify({}));
  const staleTime = new Date(Date.now() - 5_000);
  utimesSync(claimPath, staleTime, staleTime);
  try {
    const result = await withLiveEngineLifecycleLock(async () => "acquired", {
      lockPath,
      waitMs: 2_000,
    });
    assert.equal(result, "acquired");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
replace_once(lifecycle_test, insert_before, new_tests + insert_before)

live_reload = root / "mac-helper/src/liveReload.js"
replace_once(
    live_reload,
    '''  const projectSource = liveProjectDefinitionSource(projectPath);
  const availableSchemes = isWorkspaceProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
  const schemeSelection = selectLiveScheme(projectPath, scheme, availableSchemes);
  const tailnet = host
''',
    '''  const availableSchemes = isWorkspaceProjectPath(projectPath)
    ? listedLiveSchemes(projectPath)
    : [];
  const schemeSelection = selectLiveScheme(projectPath, scheme, availableSchemes);
  const projectConfiguration = liveProjectConfiguration(projectPath, schemeSelection.scheme);
  const projectSource = projectConfiguration.source;
  const tailnet = host
''',
)
replace_once(
    live_reload,
    '''  const packageConfigured = /SwiftSimLive|github\\.com\\/Miguelosaurus\\/InjectionNext/i.test(projectSource);
''',
    '''  const packageConfigured = projectConfiguration.packageConfigured;
''',
)
replace_once(
    live_reload,
    '''function liveProjectDefinitionSource(projectPath) {
  if (!projectPath || !existsSync(projectPath)) return "";
  const source = readFileSync(projectPath, "utf8");
  if (!isWorkspaceProjectPath(projectPath)) return source;
  const projectSources = workspaceProjectReferences(source, projectPath)
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, "utf8"));
  return [source, ...projectSources].join("\\n");
}
''',
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
  if (absolute.endsWith("/project.pbxproj")) return absolute;
  if (absolute.endsWith(".xcodeproj")) return join(absolute, "project.pbxproj");
  return "";
}

export function selectedTargetHasLivePackage(projectSource, targetName) {
  const source = String(projectSource || "");
  const expectedTarget = String(targetName || "").trim();
  if (!source || !expectedTarget) return false;
  const sectionMatch = source.match(
    /\\/\\* Begin PBXNativeTarget section \\*\\/([\\s\\S]*?)\\/\\* End PBXNativeTarget section \\*\\//,
  );
  if (!sectionMatch) return false;
  const section = sectionMatch[1];
  const sectionOffset = sectionMatch.index + sectionMatch[0].indexOf(section);
  for (const entry of section.matchAll(/^\\s*([A-Fa-f0-9]{24})(?:\\s+\\/\\*.*?\\*\\/)?\\s*=\\s*\\{/gm)) {
    const absoluteEntry = sectionOffset + entry.index;
    const open = source.indexOf("{", absoluteEntry);
    const close = matchingBrace(source, open);
    if (open < 0 || close < 0) continue;
    const body = source.slice(open + 1, close);
    if (pbxScalar(body, "name") !== expectedTarget) continue;
    const dependencies = body.match(/\\bpackageProductDependencies\\s*=\\s*\\(([\\s\\S]*?)\\);/)?.[1] || "";
    if (!dependencies) return false;
    if (/\\bSwiftSimLive\\b/.test(dependencies)) return true;
    const productIds = [...dependencies.matchAll(/\\b([A-Fa-f0-9]{24})\\b/g)]
      .map((match) => match[1]);
    return productIds.some((identifier) => {
      const productBody = pbxObjectBody(source, identifier);
      return /\\bXCSwiftPackageProductDependency\\b/.test(productBody)
        && pbxScalar(productBody, "productName") === "SwiftSimLive";
    });
  }
  return false;
}

function pbxObjectBody(source, identifier) {
  const entry = new RegExp(
    `^\\\\s*${escapeRegExp(identifier)}(?:\\\\s+\\\\/\\\\*.*?\\\\*\\\\/)?\\\\s*=\\\\s*\\\\{`,
    "m",
  ).exec(source);
  if (!entry) return "";
  const open = source.indexOf("{", entry.index);
  const close = matchingBrace(source, open);
  return open >= 0 && close >= 0 ? source.slice(open + 1, close) : "";
}

function pbxScalar(body, key) {
  const match = String(body || "").match(
    new RegExp(`\\\\b${escapeRegExp(key)}\\\\s*=\\\\s*(?:"((?:\\\\\\\\.|[^"\\\\\\\\])*)"|([^;]+));`),
  );
  return String(match?.[1] ?? match?.[2] ?? "")
    .replace(/\\\\"/g, '"')
    .replace(/\\\\\\\\/g, "\\\\")
    .trim();
}
''',
)

workspace_test = root / "test/liveReloadWorkspacePackage.test.js"
workspace_test.write_text('''import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectedTargetHasLivePackage } from "../mac-helper/src/liveReload.js";

const project = `// !$*UTF8*$!
{
  objects = {
/* Begin PBXNativeTarget section */
    AAAAAAAAAAAAAAAAAAAAAAAA /* SelectedApp */ = {
      isa = PBXNativeTarget;
      name = SelectedApp;
      packageProductDependencies = ();
    };
    BBBBBBBBBBBBBBBBBBBBBBBB /* UnrelatedApp */ = {
      isa = PBXNativeTarget;
      name = UnrelatedApp;
      packageProductDependencies = (CCCCCCCCCCCCCCCCCCCCCCCC /* SwiftSimLive */);
    };
/* End PBXNativeTarget section */
/* Begin XCSwiftPackageProductDependency section */
    CCCCCCCCCCCCCCCCCCCCCCCC /* SwiftSimLive */ = {
      isa = XCSwiftPackageProductDependency;
      productName = SwiftSimLive;
    };
/* End XCSwiftPackageProductDependency section */
  };
}`;

test("workspace package detection is scoped to the selected host target", () => {
  assert.equal(selectedTargetHasLivePackage(project, "SelectedApp"), false);
  assert.equal(selectedTargetHasLivePackage(project, "UnrelatedApp"), true);
});

test("target package detection resolves product IDs without comments", () => {
  const withoutComment = project.replace(
    "CCCCCCCCCCCCCCCCCCCCCCCC /* SwiftSimLive */);",
    "CCCCCCCCCCCCCCCCCCCCCCCC);",
  );
  assert.equal(selectedTargetHasLivePackage(withoutComment, "UnrelatedApp"), true);
});

test("workspace inspection consumes selected-target configuration", () => {
  const source = readFileSync(new URL("../mac-helper/src/liveReload.js", import.meta.url), "utf8");
  assert.match(source, /liveProjectConfiguration\\(projectPath, schemeSelection\\.scheme\\)/);
  assert.match(source, /const packageConfigured = projectConfiguration\\.packageConfigured;/);
});
''')

docs = root / "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md"
replace_once(docs, "| P1 | 19 | 19 | 0 |", "| P1 | 20 | 20 | 0 |")
replace_once(docs, "| P2 | 10 | 10 | 0 |", "| P2 | 11 | 11 | 0 |")
replace_once(
    docs,
    "19. Failure to establish engine ownership never authorizes an unverified PID or process-group signal; identity tooling is prepared before spawn and cleanup fails closed.\n",
    "19. Failure to establish engine ownership never authorizes an unverified PID or process-group signal; identity tooling is prepared before spawn and cleanup fails closed.\n20. Parseable but incomplete owner and reclaim records are treated as malformed state and become safely reclaimable instead of permanently wedging every lifecycle operation.\n",
)
replace_once(
    docs,
    "10. Live signing fails closed when `xcodebuild -showBuildSettings` fails, times out, lacks a host-application section, or omits the selected target's Development Team; unrelated Apple Development identities are no longer fallback candidates.\n",
    "10. Live signing fails closed when `xcodebuild -showBuildSettings` fails, times out, lacks a host-application section, or omits the selected target's Development Team; unrelated Apple Development identities are no longer fallback candidates.\n11. Workspace package readiness is derived from the explicitly selected scheme's host application target and cannot be inherited from an unrelated project or target in the workspace.\n",
)
replace_once(
    docs,
    "Coverage includes kernel process-start tokens, executable and instance-nonce mismatch rejection, identity-failure no-signal behavior, stale/reused PIDs, detached process groups, lifecycle-owner token collisions, lock ownership and reclamation, abandoned claims, replacement-lock preservation, nested and multiline Swift attributes, exact attribute string literals, runtime availability conditions, nested block comments, workspace schemes and host-application signing sections, failed build-settings queries, cleanup containment, complete live build/routing leases, startup cleanup, and companion ownership/revision fences.",
    "Coverage includes kernel process-start tokens, executable and instance-nonce mismatch rejection, identity-failure no-signal behavior, stale/reused PIDs, detached process groups, lifecycle-owner token collisions, lock ownership and reclamation, parseable malformed owner/reclaim records, abandoned claims, replacement-lock preservation, nested and multiline Swift attributes, exact attribute string literals, runtime availability conditions, nested block comments, workspace schemes, selected-target package association, host-application signing sections, failed build-settings queries, cleanup containment, complete live build/routing leases, startup cleanup, and companion ownership/revision fences.",
)

print("Applied final PR #21 Codex review fixes.")
