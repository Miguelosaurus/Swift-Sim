import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySwiftSource,
  LIVE_REASON_CODES,
  selectLiveScheme,
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
  assert.match(
    source,
    /export async function registerLiveBuildResult\(options\) \{
  return withLiveEngineLifecycleLock\(\(\) => registerLiveBuildResultUnlocked\(options\)\);/,
  );
  assert.match(
    source,
    /export async function injectLiveSource\(sourcePath, runtime = \{\}\) \{[\s\S]*return withLiveEngineLifecycleLock\(\(\) => injectLiveSourceUnlocked\(sourcePath, runtime\)\);/,
  );
  assert.match(
    source,
    /if \(typeof runtime\.engineControl === "function"\) \{
    return injectLiveSourceUnlocked\(sourcePath, runtime\);/,
  );
});
