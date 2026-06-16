import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseServeSimOutput } from "../mac-helper/src/serveSimAdapter.js";
import { buildCompanionLinks, buildPairingLinks, codexSession, publicSession } from "../mac-helper/src/links.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";

test("parseServeSimOutput reads JSON URL without depending on exact key", () => {
  const parsed = parseServeSimOutput('{"previewUrl":"http://127.0.0.1:3200","pid":1234}\n', "");
  assert.equal(parsed.previewUrl, "http://127.0.0.1:3200");
  assert.equal(parsed.port, 3200);
  assert.equal(parsed.pid, 1234);
});

test("parseServeSimOutput prefers stream URL when serve-sim separates page and stream", () => {
  const parsed = parseServeSimOutput('{"url":"http://127.0.0.1:3100","streamUrl":"http://127.0.0.1:3100/stream.mjpeg"}\n', "");
  assert.equal(parsed.previewUrl, "http://127.0.0.1:3100/stream.mjpeg");
  assert.equal(parsed.port, 3100);
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

test("pairing links use helper token without session internals", () => {
  const links = buildPairingLinks({
    token: "pair-token",
  }, "https://mac.example.ts.net/");
  assert.equal(links.universalLink, "https://mac.example.ts.net/pair?token=pair-token");
  assert.equal(links.customScheme, "swift-sim://pair?token=pair-token&base=https%3A%2F%2Fmac.example.ts.net");
  assert.ok(!links.universalLink.includes("UDID"));
});

test("public session omits local simulator internals", () => {
  const session = publicSession({
    id: "session",
    token: "token",
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-UDID",
    remoteBaseUrl: "https://mac.example.ts.net",
    createdAt: "now",
    updatedAt: "now",
    build: { state: "ok" },
    stream: {
      state: "running",
      localUrl: "http://127.0.0.1:3000",
      port: 3000,
      pid: 123,
    },
  });
  assert.equal(session.project, "set");
  assert.equal(session.simulatorUDID, undefined);
  assert.equal(session.stream.localUrl, undefined);
  assert.equal(session.stream.port, undefined);
  assert.equal(session.stream.pid, undefined);
});

test("codex session includes local preview URL for nested browser verification", () => {
  const session = codexSession({
    id: "session",
    token: "token",
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-UDID",
    remoteBaseUrl: "https://mac.example.ts.net",
    createdAt: "now",
    updatedAt: "now",
    build: { state: "ok" },
    stream: {
      state: "running",
      localUrl: "http://127.0.0.1:3000",
      port: 3000,
      pid: 123,
    },
  });
  assert.equal(session.codex.localPreviewUrl, "http://127.0.0.1:3000");
  assert.equal(session.codex.simulatorUDID, "SIM-UDID");
  assert.equal(session.stream.localUrl, undefined);
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

test("PairingStore persists and rotates helper tokens", () => {
  const dir = mkdtempSync(join(tmpdir(), "swift-sim-pair-test-"));
  try {
    const path = join(dir, "pairing.json");
    const writer = new PairingStore({ path });
    const first = writer.current();
    assert.equal(writer.tokenMatches(first.token), true);

    const reader = new PairingStore({ path });
    assert.equal(reader.tokenMatches(first.token), true);

    const second = reader.rotate();
    assert.notEqual(second.token, first.token);
    assert.equal(reader.tokenMatches(first.token), false);
    assert.equal(reader.tokenMatches(second.token), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
