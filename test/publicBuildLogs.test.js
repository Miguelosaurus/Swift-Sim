import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePublicBuildLogs } from "../mac-helper/src/publicBuildLogs.js";

test("public build logs expose only canonical helper status messages", () => {
  const build = {
    token: "current-secret",
    capabilities: [{ token: "old-secret" }],
    logs: [
      "Reading Xcode signing settings.",
      "CompileSwift /Users/Miguel/My Project/App.swift",
      "API_KEY=super-secret-value",
      "Build is ready to install.",
    ],
  };
  assert.deepEqual(sanitizePublicBuildLogs(build), [
    "Reading Xcode signing settings.",
    "[build output redacted]",
    "Build is ready to install.",
  ]);
});

test("public build logs collapse arbitrary output and bound the requested history", () => {
  const logs = sanitizePublicBuildLogs({
    logs: [
      "AWS_SECRET_ACCESS_KEY=secret",
      "custom script printed private customer data",
      "Captured 2 live Swift compilation commands.",
      "Temporary HTTPS install link is ready. Tailscale is not required.",
    ],
  }, { limit: 4 });
  assert.deepEqual(logs, [
    "[build output redacted]",
    "Captured 2 live Swift compilation commands.",
    "Temporary HTTPS install link is ready. Tailscale is not required.",
  ]);
  assert.deepEqual(sanitizePublicBuildLogs({ logs: ["Build is ready to install."] }, { limit: 0 }), []);
});
