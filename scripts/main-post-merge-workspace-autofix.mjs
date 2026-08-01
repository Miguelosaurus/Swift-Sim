import { readFileSync, writeFileSync } from "node:fs";

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Missing replacement anchor: ${label}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Replacement anchor is not unique: ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

const livePath = "mac-helper/src/liveReload.js";
let live = readFileSync(livePath, "utf8");
live = replaceOnce(
  live,
  `function resolveSigningIdentities(projectPath) {
  const projectContainer = projectPath.endsWith("/project.pbxproj")
    ? dirname(projectPath)
    : projectPath;
  const settings = spawnSync(
    "xcodebuild",
    ["-project", projectContainer, "-configuration", "Debug", "-showBuildSettings"],
`,
  `export function xcodeContainerArguments(projectPath) {
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
  const settings = spawnSync(
    "xcodebuild",
    [...containerArguments, "-configuration", "Debug", "-showBuildSettings"],
`,
  "workspace-aware xcode container",
);
writeFileSync(livePath, live);

const testPath = "test/mainPostMergeIntegration.test.js";
let tests = readFileSync(testPath, "utf8");
tests = replaceOnce(
  tests,
  `import { classifySwiftSource, LIVE_REASON_CODES } from "../mac-helper/src/liveReload.js";`,
  `import {
  classifySwiftSource,
  LIVE_REASON_CODES,
  xcodeContainerArguments,
} from "../mac-helper/src/liveReload.js";`,
  "workspace test import",
);
tests += `

test("live reload uses the correct Xcode container flag", () => {
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcodeproj/project.pbxproj"),
    ["-project", "/tmp/App.xcodeproj"],
  );
  assert.deepEqual(
    xcodeContainerArguments("/tmp/App.xcworkspace/contents.xcworkspacedata"),
    ["-workspace", "/tmp/App.xcworkspace"],
  );
});
`;
writeFileSync(testPath, tests);
console.log("Applied workspace-aware live-reload signing fix.");
