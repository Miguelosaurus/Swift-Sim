import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectedTargetHasLivePackage, liveProjectTargetFromSettings } from "../mac-helper/src/liveReload.js";

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

test("resolved build settings identify the exact live target without another Xcode invocation", t => {
  const root = mkdtempSync(join(tmpdir(), "resolved-live-target-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const container = join(root, "Example.xcodeproj"); mkdirSync(container);
  writeFileSync(join(container, "project.pbxproj"), project);
  for (const name of ["SelectedApp", "UnrelatedApp"]) {
    const resolved = liveProjectTargetFromSettings(container, { TARGET_NAME: name, PROJECT_FILE_PATH: container });
    assert.equal(resolved.targetName, name);
    assert.equal(selectedTargetHasLivePackage(resolved.source, name), name === "UnrelatedApp");
  }
  assert.equal(liveProjectTargetFromSettings(container, {}), null);
  assert.equal(liveProjectTargetFromSettings(container, { TARGET_NAME: "SelectedApp", PROJECT_FILE_PATH: join(root, "missing.xcodeproj") }), null);
});

test("workspace inspection consumes selected-target configuration", () => {
  const source = readFileSync(new URL("../mac-helper/src/liveReload.js", import.meta.url), "utf8");
  assert.match(source, /liveProjectConfiguration\(projectPath, schemeSelection\.scheme\)/);
  assert.match(source, /const packageConfigured = projectConfiguration\.packageConfigured;/);
});



test("PBX comments cannot impersonate a SwiftSimLive product dependency", () => {
  const misleading = project.replace(
    "packageProductDependencies = ();",
    "packageProductDependencies = (DDDDDDDDDDDDDDDDDDDDDDDD /* SwiftSimLive */);",
  );
  assert.equal(selectedTargetHasLivePackage(misleading, "SelectedApp"), false);
});
