import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySwiftSource,
  expandedSigningIdentities,
  LIVE_REASON_CODES,
  liveEngineSessionMatches,
  selectLiveApplicationBuildSettings,
  selectLiveScheme,
  withLiveBuildSession,
  workspaceProjectReferences,
  xcodeContainerArguments,
} from "../mac-helper/src/liveReload.js";

test("attribute argument changes require a rebuild", () => {
  const before = `import SwiftUI
struct ContentView: View {
  @State(initialValue: 1) private var count: Int
  var body: some View { Text("before") }
}`;
  const after = before
    .replace("initialValue: 1", "initialValue: 2")
    .replace('Text("before")', 'Text("after")');
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("availability attribute arguments require a rebuild", () => {
  const before = `import SwiftUI
@available(iOS 18, *)
struct ContentView: View { var body: some View { Text("before") } }`;
  const after = before
    .replace("iOS 18", "iOS 19")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("conditional compilation changes require a rebuild", () => {
  const before = `import SwiftUI
#if DEBUG
struct ContentView: View { var body: some View { Text("before") } }
#endif`;
  const after = before
    .replace("#if DEBUG", "#if RELEASE")
    .replace('Text("before")', 'Text("after")');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("runtime availability changes require a rebuild", () => {
  const before = `func value() -> Int { if #available(iOS 18, *) { return 1 }; return 0 }`;
  const after = before.replace("iOS 18", "iOS 19");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("delivery reference cleanup no longer blocks helper startup", () => {
  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");
  const serveStart = source.indexOf("async function serve(");
  const createServer = source.indexOf("const server = createServer", serveStart);
  const startup = source.slice(serveStart, createServer);
  assert.doesNotMatch(startup, /await drainDeliveryReferenceCleanupJobs\(\)/);
  assert.match(startup, /setImmediate\(\(\) =>/);
});

test("live reload selects project and workspace containers correctly", () => {
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcodeproj/project.pbxproj"),
    ["-project", "/tmp/App.xcodeproj"],
  );
  assert.deepEqual(
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

test("project and workspace schemes are selected safely", () => {
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

test("string-valued property-wrapper arguments require a rebuild", () => {
  const before = `struct Model {
  @State(initialValue: "before") var value: String
}`;
  const after = before.replace('"before"', '"after"');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("property wrappers remain associated with their declarations", () => {
  const before = `struct Model {
  @State var first: Int = 0
  @Binding var second: Int
}`;
  const after = `struct Model {
  @Binding var first: Int = 0
  @State var second: Int
}`;
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("live engine inspection is serialized with replacement", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(
    source,
    /export async function inspectLiveReload\(options = \{\}\) \{\n  return withLiveEngineLifecycleLock/,
  );
  assert.match(source, /let status = await inspectLiveReloadUnlocked/);
});

test("deeply nested attribute arguments require a rebuild", () => {
  const before = `struct Model {
  @Wrapper(configuration: .init(value: .init(raw: 1)))
  var value: Int
}`;
  const after = before.replace("raw: 1", "raw: 2");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("multiline attribute arguments require a rebuild", () => {
  const before = `struct Model {
  @Wrapper(
    configuration: .init(
      value: 1
    )
  )
  var value: Int
}`;
  const after = before.replace("value: 1", "value: 2");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("attribute-looking text in strings and comments does not change the surface", () => {
  const before = `func value() -> String { "@Wrapper(value: 1)" } // @Other(value: 1)`;
  const after = `func value() -> String { "@Wrapper(value: 2)" } // @Other(value: 2)`;
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, true);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.IMPLEMENTATION_ONLY);
});

test("engine-mutating live operations hold the lifecycle lock", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.ok(source.includes(
    "export async function registerLiveBuildResult(options) {\n"
      + "  return withLiveEngineLifecycleLock(() => registerLiveBuildResultUnlocked(options));\n"
      + "}",
  ));
  assert.ok(source.includes(
    "export async function injectLiveSource(sourcePath, runtime = {}) {\n"
      + "  if (typeof runtime.engineControl === \"function\") {\n"
      + "    return injectLiveSourceUnlocked(sourcePath, runtime);\n"
      + "  }\n"
      + "  return withLiveEngineLifecycleLock(() => injectLiveSourceUnlocked(sourcePath, runtime));\n"
      + "}",
  ));
});

test("multiline runtime availability changes require a rebuild", () => {
  const before = `func value() -> Int {
  if #available(
    iOS 18,
    *
  ) { return 1 }
  return 0
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("multiline runtime unavailability changes require a rebuild", () => {
  const before = `func value() -> Int {
  if #unavailable(
    iOS 18,
    *
  ) { return 0 }
  return 1
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("expanded signing identity remains one candidate", () => {
  const identity = "A".repeat(40);
  assert.deepEqual(
    expandedSigningIdentities(`    EXPANDED_CODE_SIGN_IDENTITY = ${identity}\n`),
    [identity],
  );
});

test("live build session keeps start, build, and registration under one lock", async () => {
  const events = [];
  const result = await withLiveBuildSession(
    { project: "/tmp/App.xcodeproj/project.pbxproj" },
    async ({ liveSession, registerLiveBuildResult }) => {
      events.push(`build:${liveSession.host}`);
      await registerLiveBuildResult({ resultBundle: "/tmp/App.xcresult" });
      events.push("build-complete");
      return "done";
    },
    {
      lock: async (operation) => {
        events.push("lock-start");
        const value = await operation();
        events.push("lock-end");
        return value;
      },
      start: async () => {
        events.push("start");
        return { started: true, host: "100.64.0.1" };
      },
      register: async () => {
        events.push("register");
        return { registered: 1 };
      },
    },
  );
  assert.equal(result, "done");
  assert.deepEqual(events, [
    "lock-start",
    "start",
    "build:100.64.0.1",
    "register",
    "build-complete",
    "lock-end",
  ]);
});

test("device live build uses the complete lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/deviceBuilderCore.js", "utf8");
  assert.match(source, /await withLiveBuildSession\(/);
  assert.doesNotMatch(source, /await startLiveReload\(/);
  assert.doesNotMatch(source, /await registerLiveBuildResult\(/);
});

test("production live routing holds one lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.ok(source.includes(
    "if (!injectedLifecycle && runtime.lifecycleLocked !== true) {\n"
      + "    return withLiveEngineLifecycleLock",
  ));
  assert.ok(source.includes(
    "runtime.lifecycleLocked\n"
      + "    ? ((options) => inspectLiveReloadUnlocked(options))",
  ));
  assert.ok(source.includes(
    "runtime.lifecycleLocked\n"
      + "    ? ((sourcePath, options = {}) => injectLiveSourceUnlocked",
  ));
  assert.ok(source.includes(
    "const start = lifecycleLocked ? startLiveReloadUnlocked : startLiveReload",
  ));
});


test("nested block comments cannot truncate runtime availability scanning", () => {
  const before = `func value() -> Int {
  if #available(/* outer /* inner */ ) still outer */ iOS 18, *) { return 1 }
  return 0
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});


test("attribute string-literal whitespace requires a rebuild", () => {
  const before = `struct Model {
  @Wrapper(value: "a b") var value: String
}`;
  const after = before.replace('"a b"', '"a  b"');
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("live signing selects the host application section", () => {
  const extensionIdentity = "E".repeat(40);
  const appIdentity = "A".repeat(40);
  const output = `Build settings for action build and target ShareExtension:
    TARGET_NAME = ShareExtension
    PRODUCT_TYPE = com.apple.product-type.app-extension
    WRAPPER_EXTENSION = appex
    EXPANDED_CODE_SIGN_IDENTITY = ${extensionIdentity}
    DEVELOPMENT_TEAM = EXTTEAM
Build settings for action build and target App:
    TARGET_NAME = App
    PRODUCT_NAME = App
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
    SUPPORTED_PLATFORMS = iphoneos iphonesimulator
    EXPANDED_CODE_SIGN_IDENTITY = ${appIdentity}
    DEVELOPMENT_TEAM = APPTEAM`;
  assert.deepEqual(expandedSigningIdentities(output, "App"), [appIdentity]);
  assert.equal(selectLiveApplicationBuildSettings(output, "App").DEVELOPMENT_TEAM, "APPTEAM");
});

test("ambiguous live host application settings fail closed", () => {
  const output = `Build settings for action build and target First:
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO
Build settings for action build and target Second:
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    SKIP_INSTALL = NO`;
  assert.throws(
    () => selectLiveApplicationBuildSettings(output, "Unknown"),
    /multiple equally likely application targets/,
  );
});


test("live signing fails closed when build settings are unavailable", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /if \(settings\.status !== 0 \|\| settings\.error\)/);
  assert.match(source, /Xcode did not report a Development Team/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function resolveSigningIdentities"), source.indexOf("function provisioningIdentityForTeam")),
    /\.\.\.development\.map/,
  );
});



test("live readiness is bound to the active engine scheme", () => {
  const session = {
    projectRoot: "/tmp/Repo",
    scheme: "OtherApp",
    engineVersion: "0.4.0",
  };
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/Repo",
    scheme: "SelectedApp",
  }), false);
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/Repo",
    scheme: "OtherApp",
  }), true);
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/AnotherRepo",
    scheme: "OtherApp",
  }), false);

  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /const matchingEngineSession = liveEngineSessionMatches\(engineSession/);
  assert.match(source, /const watchingProject = Boolean\([\s\S]*?matchingEngineSession/);
});



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


test("release archives do not inspect optional live targets", () => {
  const source = readFileSync("mac-helper/src/deviceBuilderCore.js", "utf8");
  assert.match(source, /const liveCandidate = String\(build\.configuration \|\| ""\)\.toLowerCase\(\) === "debug"/);
  assert.match(source, /const selectedLiveTarget = liveCandidate[\s\S]*?selectedXcodeApplicationTarget\(join\(target\.path, "project\.pbxproj"\), build\.scheme\)/);
  assert.match(source, /const liveEligible = Boolean\(selectedLiveTarget\)/);
});
