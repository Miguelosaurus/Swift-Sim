import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDeliveryGenerationReference,
  publishDeliveryGenerationState,
  readDeliveryGenerationState,
  removeDeliveryGenerationReference,
} from "../mac-helper/src/deviceDeliveryState.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  resolvedSessionTransport,
  sessionTransportCandidates,
  sessionTransportMatches,
} from "../mac-helper/src/sessionTransportPreference.js";

function withTemporaryPath(run) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-round-2-"));
  const path = join(directory, "state.json");
  try { return run(path, directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

function readyState(overrides = {}) {
  return {
    generation: "generation-a",
    status: "ready",
    provider: "cloudflare-quick-tunnel",
    publicBaseUrl: "https://example.trycloudflare.com",
    references: [],
    ...overrides,
  };
}

function sessionInput(token, transport) {
  return {
    token,
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-1",
    transport,
  };
}

function markRunning(store, session, transport) {
  session.stream.state = "running";
  session.stream.transport = transport;
  session.stream.localUrl = `http://127.0.0.1/${transport}`;
  store.save(session);
  return session;
}

test("manager state publication preserves capability references", () => withTemporaryPath((path) => {
  publishDeliveryGenerationState(path, readyState({ references: ["build:a", "build:b"] }));
  publishDeliveryGenerationState(path, readyState({ updatedAt: new Date().toISOString() }));
  assert.deepEqual(readDeliveryGenerationState(path).references, ["build:a", "build:b"]);
}));

test("terminal manager publication cannot be resurrected by a stale reference add", () => withTemporaryPath((path) => {
  publishDeliveryGenerationState(path, readyState({ references: ["build:a"] }));
  publishDeliveryGenerationState(path, readyState({
    status: "failed",
    publicBaseUrl: "",
    error: "tunnel exited",
  }));
  assert.throws(
    () => addDeliveryGenerationReference(path, "generation-a", "build:b"),
    /no longer reusable/,
  );
  const state = readDeliveryGenerationState(path);
  assert.equal(state.status, "failed");
  assert.equal(state.publicBaseUrl, "");
  assert.deepEqual(state.references, ["build:a"]);
}));

test("releasing one delivery reference preserves every other live capability", () => withTemporaryPath((path) => {
  publishDeliveryGenerationState(path, readyState({ references: ["build:a", "build:b"] }));
  const state = removeDeliveryGenerationReference(path, "generation-a", "build:a");
  assert.deepEqual(state.references, ["build:b"]);
}));

test("malformed delivery state fails closed without being replaced", () => withTemporaryPath((path) => {
  writeFileSync(path, "{not-json", { mode: 0o600 });
  assert.throws(
    () => publishDeliveryGenerationState(path, readyState()),
    { code: "SWIFT_SIM_DELIVERY_STATE_INVALID" },
  );
  assert.equal(readFileSync(path, "utf8"), "{not-json");
}));

test("automatic session reuse prefers native but accepts a running fallback", () => {
  assert.deepEqual(
    sessionTransportCandidates("auto", { nativeDisabled: false }),
    ["native-companion", "serve-sim"],
  );
  assert.equal(sessionTransportMatches("native-companion", "auto", { nativeDisabled: false }), true);
  assert.equal(sessionTransportMatches("serve-sim", "auto", { nativeDisabled: false }), true);
  assert.equal(resolvedSessionTransport("auto", { nativeDisabled: false }), "native-companion");
});

test("automatic session reuse becomes serve-sim-only when native transport is disabled", () => {
  assert.deepEqual(
    sessionTransportCandidates("auto", { nativeDisabled: true }),
    ["serve-sim"],
  );
  assert.equal(sessionTransportMatches("native-companion", "auto", { nativeDisabled: true }), false);
  assert.equal(sessionTransportMatches("serve-sim", "auto", { nativeDisabled: true }), true);
  assert.equal(resolvedSessionTransport("auto", { nativeDisabled: true }), "serve-sim");
});

test("SessionStore reuses an automatic serve-sim fallback instead of starting a duplicate", () => withTemporaryPath((path) => {
  const store = new SessionStore({ path });
  const fallback = markRunning(
    store,
    store.create(sessionInput("fallback", "serve-sim")),
    "serve-sim",
  );
  const reused = store.findReusable({
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-1",
    transport: "auto",
  });
  assert.equal(reused.id, fallback.id);
}));

test("an explicit transport mismatch still returns the existing shared stream", () => withTemporaryPath((path) => {
  const store = new SessionStore({ path });
  const fallback = markRunning(
    store,
    store.create(sessionInput("fallback", "serve-sim")),
    "serve-sim",
  );
  const reused = store.findReusable({
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "SIM-1",
    transport: "native-companion",
  });
  assert.equal(reused.id, fallback.id);
  assert.equal(reused.stream.transport, "serve-sim");
}));

test("a failed session record does not retain the duplicate-start lease", () => withTemporaryPath((path) => {
  const store = new SessionStore({ path });
  const failed = store.create(sessionInput("first", "serve-sim"));
  failed.stream.state = "failed";
  store.save(failed);
  assert.doesNotThrow(() => store.create(sessionInput("second", "serve-sim")));
}));

test("helper source persists failed starts and uses shared automatic transport matching", () => {
  const source = readFileSync(
    new URL("../mac-helper/bin/swift-sim-helper.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /sessionTransportMatches\(existing\.stream\.transport, transportPreference\)/);
  assert.match(source, /session\.stream\.state = "failed"/);
  assert.match(source, /transport: transportPreference/);
});
