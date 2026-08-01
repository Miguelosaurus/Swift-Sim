import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifySwiftSource,
  LIVE_REASON_CODES,
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
});
