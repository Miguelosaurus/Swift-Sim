import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseServeSimOutput } from "../mac-helper/src/serveSimAdapter.js";
import { buildCompanionLinks } from "../mac-helper/src/links.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";

test("parseServeSimOutput reads JSON URL without depending on exact key", () => {
  const parsed = parseServeSimOutput('{"previewUrl":"http://127.0.0.1:3200","pid":1234}\n', "");
  assert.equal(parsed.previewUrl, "http://127.0.0.1:3200");
  assert.equal(parsed.port, 3200);
  assert.equal(parsed.pid, 1234);
});

test("parseServeSimOutput falls back to human-readable URL", () => {
  const parsed = parseServeSimOutput("Preview at http://localhost:3200\n", "");
  assert.equal(parsed.previewUrl, "http://localhost:3200");
  assert.equal(parsed.port, 3200);
});

test("companion links use opaque id and token", () => {
  const links = buildCompanionLinks({
    id: "opaque-session",
    token: "secret-token",
  }, "https://mac.example.ts.net/");
  assert.equal(links.universalLink, "https://mac.example.ts.net/s/opaque-session?token=secret-token");
  assert.equal(links.customScheme, "swift-sim://session/opaque-session?token=secret-token&base=https%3A%2F%2Fmac.example.ts.net");
  assert.ok(!links.universalLink.includes("UDID"));
});

test("SessionStore persists sessions for CLI/server handoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "swift-sim-test-"));
  try {
    const path = join(dir, "sessions.json");
    const writer = new SessionStore({ path });
    const session = writer.create({
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
      token: "token",
      remoteBaseUrl: "https://mac.ts.net",
    });
    session.stream.state = "running";
    writer.save(session);

    const reader = new SessionStore({ path });
    assert.equal(reader.get(session.id).simulatorUDID, "SIM-1");
    assert.equal(reader.findReusable({
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
    }).id, session.id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
