import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ServeSimAdapter, parseServeSimOutput } from "../mac-helper/src/serveSimAdapter.js";
import { buildCompanionLinks, buildPairingLinks, codexSession, publicSession } from "../mac-helper/src/links.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";
import { NativeCompanionTransport } from "../mac-helper/src/transports/nativeCompanionTransport.js";
import { SimulatorProfileResolver } from "../mac-helper/src/simulatorProfile.js";
import { namedKeyEvents, textToKeyEvents } from "../mac-helper/src/keyboard.js";

test("keyboard text becomes USB HID events without invoking a CLI", () => {
  assert.deepEqual(textToKeyEvents("aA!\n"), [
    { type: "down", usage: 4 }, { type: "up", usage: 4 },
    { type: "down", usage: 225 }, { type: "down", usage: 4 },
    { type: "up", usage: 4 }, { type: "up", usage: 225 },
    { type: "down", usage: 225 }, { type: "down", usage: 30 },
    { type: "up", usage: 30 }, { type: "up", usage: 225 },
    { type: "down", usage: 40 }, { type: "up", usage: 40 },
  ]);
  assert.deepEqual(namedKeyEvents("backspace"), [
    { type: "down", usage: 42 },
    { type: "up", usage: 42 },
  ]);
});

test("parseServeSimOutput reads JSON URL without depending on exact key", () => {
  const parsed = parseServeSimOutput('{"previewUrl":"http://127.0.0.1:3200","pid":1234}\n', "");
  assert.equal(parsed.previewUrl, "http://127.0.0.1:3200");
  assert.equal(parsed.port, 3200);
  assert.equal(parsed.pid, 1234);
});

test("parseServeSimOutput prefers stream URL when serve-sim separates page and stream", () => {
  const parsed = parseServeSimOutput('{"url":"http://127.0.0.1:3100","streamUrl":"http://127.0.0.1:3100/stream.mjpeg","wsUrl":"ws://127.0.0.1:3100/ws"}\n', "");
  assert.equal(parsed.previewUrl, "http://127.0.0.1:3100/stream.mjpeg");
  assert.equal(parsed.wsUrl, "ws://127.0.0.1:3100/ws");
  assert.equal(parsed.port, 3100);
});

test("parseServeSimOutput falls back to human-readable URL", () => {
  const parsed = parseServeSimOutput("Preview at http://localhost:3200\n", "");
  assert.equal(parsed.previewUrl, "http://localhost:3200");
  assert.equal(parsed.port, 3200);
});

test("ServeSimAdapter sends gesture JSON through the current serve-sim command", async () => {
  class RecordingAdapter extends ServeSimAdapter {
    calls = [];
    async run(args) {
      this.calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    }
  }
  const adapter = new RecordingAdapter({ packageName: "serve-sim@test" });
  await adapter.gesture({ simulatorUDID: "SIM-1", event: { type: "move", x: 0.25, y: 0.75 } });
  assert.deepEqual(adapter.calls[0], [
    "--yes",
    "serve-sim@test",
    "gesture",
    "{\"type\":\"move\",\"x\":0.25,\"y\":0.75}",
    "-d",
    "SIM-1",
  ]);
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
  assert.match(session.recentProjectID, /^[a-f0-9]{64}$/);
  assert.equal(session.simulatorUDID, undefined);
  assert.equal(session.stream.localUrl, undefined);
  assert.equal(session.stream.port, undefined);
  assert.equal(session.stream.pid, undefined);
  assert.equal(session.stream.transport, "serve-sim");
  assert.equal(session.stream.quality, "fallback");
});

test("public sessions use a stable recent-project identity", () => {
  const input = {
    id: "first-session",
    token: "first-token",
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-UDID",
    remoteBaseUrl: "https://mac.example.ts.net",
    createdAt: "now",
    updatedAt: "now",
    build: { state: "ok" },
    stream: { state: "running" },
  };

  const first = publicSession(input);
  const replacement = publicSession({ ...input, id: "new-session", token: "new-token" });
  const otherProject = publicSession({ ...input, project: "/tmp/Other.xcodeproj" });

  assert.equal(first.recentProjectID, replacement.recentProjectID);
  assert.notEqual(first.recentProjectID, otherProject.recentProjectID);
  assert.ok(!JSON.stringify(first).includes("SIM-UDID"));
  assert.ok(!JSON.stringify(first).includes("/tmp/App.xcodeproj"));
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

test("codex session prefers the dedicated MJPEG preview for native sessions", () => {
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
      transport: "native-companion",
      quality: "native-h264",
      localUrl: "http://127.0.0.1:3100/stream.avcc",
      previewUrl: "http://127.0.0.1:3100/stream.mjpeg",
    },
  });
  assert.equal(session.codex.localPreviewUrl, "http://127.0.0.1:3100/stream.mjpeg");
  assert.equal(session.stream.transport, "native-companion");
  assert.equal(session.stream.localUrl, undefined);
});

test("native companion wraps serve-sim AVCC without changing its adapter contract", async () => {
  const adapter = {
    async inspect() {
      return { version: "0.1.41" };
    },
    async start() {
      return {
        previewUrl: "http://127.0.0.1:3100/stream.mjpeg",
        wsUrl: "ws://127.0.0.1:3100/ws",
        port: 3100,
        pid: 123,
        raw: {},
        logs: [],
      };
    },
  };
  const transport = new NativeCompanionTransport({ adapter });
  const stream = await transport.start({ simulatorUDID: "SIM-1" });
  assert.equal(stream.localUrl, "http://127.0.0.1:3100/stream.avcc");
  assert.equal(stream.previewUrl, "http://127.0.0.1:3100/stream.mjpeg");
  assert.equal(stream.transport, "native-companion");
  assert.equal(stream.quality, "native-h264");
});

test("native companion rejects serve-sim versions without AVCC", async () => {
  const transport = new NativeCompanionTransport({
    adapter: {
      async inspect() {
        return { version: "0.1.40" };
      },
    },
  });
  await assert.rejects(
    transport.start({ simulatorUDID: "SIM-1" }),
    /upgrade to 0\.1\.41 or newer/,
  );
});

test("simulator profile resolver serves the CoreSimulator framebuffer mask", () => {
  const dir = mkdtempSync(join(tmpdir(), "swift-sim-profile-test-"));
  try {
    const resources = join(dir, "iPhone Test.simdevicetype", "Contents", "Resources");
    mkdirSync(resources, { recursive: true });
    writeFileSync(join(resources, "mask-id.pdf"), "mask-data");
    const resolver = new SimulatorProfileResolver({
      run(command, args) {
        if (command === "xcrun" && args.includes("devices")) {
          return JSON.stringify({
            devices: { runtime: [{ udid: "SIM-1", name: "iPhone Test", deviceTypeIdentifier: "test.iphone" }] },
          });
        }
        if (command === "xcrun" && args.includes("devicetypes")) {
          return JSON.stringify({
            devicetypes: [{ identifier: "test.iphone", name: "iPhone Test", modelIdentifier: "iPhone1,1", bundlePath: join(dir, "iPhone Test.simdevicetype") }],
          });
        }
        if (command === "plutil") {
          return JSON.stringify({ framebufferMask: "mask-id", mainScreenWidth: 100, mainScreenHeight: 200 });
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    });
    const mask = resolver.readMask("SIM-1");
    assert.equal(mask.deviceName, "iPhone Test");
    assert.equal(mask.width, 100);
    assert.equal(mask.height, 200);
    assert.equal(mask.data.toString(), "mask-data");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
