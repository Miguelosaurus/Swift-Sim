import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePublicBuildLogs } from "../mac-helper/src/publicBuildLogs.js";

test("public build logs redact bearer tokens and local build paths", () => {
  const build = {
    token: "current-secret",
    capabilities: [{ token: "old-secret" }],
    logs: [
      "Build ready at https://example.test/d/1?token=current-secret",
      "CompileSwift /Users/Miguel/My Project/App.swift",
      "Using old-secret for retry",
      "Build is ready to install.",
    ],
  };
  assert.deepEqual(sanitizePublicBuildLogs(build), [
    "Build ready at https://example.test/d/1?token=<redacted>",
    "[local build detail redacted]",
    "Using <redacted> for retry",
    "Build is ready to install.",
  ]);
});

test("public build logs redact signing identity details and bound line length", () => {
  const logs = sanitizePublicBuildLogs({
    logs: [
      "DEVELOPMENT_TEAM = ABCDE12345",
      "Apple Development: Developer <developer@example.com>",
      "x".repeat(700),
    ],
  });
  assert.equal(logs[0], "[signing detail redacted]");
  assert.equal(logs[1], "[signing detail redacted]");
  assert.equal(logs[2].length, 500);
});
