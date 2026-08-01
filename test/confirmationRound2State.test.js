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
