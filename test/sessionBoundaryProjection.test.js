import assert from "node:assert/strict";
import test from "node:test";
import {
  durableSessionFieldNames,
  joinSessionForPresentation,
  parseDurableSession,
  projectDurableSession,
} from "../mac-helper/src/sessionBoundaryProjection.js";

const LEGACY_SESSION = Object.freeze({
  id: "session-1",
  token: "session-token",
  project: "/private/project/App.xcodeproj",
  scheme: "App",
  simulatorUDID: "SIMULATOR-1",
  remoteBaseUrl: "https://example.invalid",
  createdAt: "2026-08-13T20:00:00.000Z",
  updatedAt: "2026-08-13T20:02:00.000Z",
  revision: 9,
  orientation: "landscape_right",
  logs: ["runtime log"],
  build: { state: "external-or-not-run", detail: "legacy" },
  stream: {
    state: "running",
    transport: "serve-sim",
    quality: "fallback",
    localUrl: "http://127.0.0.1:9000",
    previewUrl: "http://127.0.0.1:9001",
    wsUrl: "ws://127.0.0.1:9002",
    port: 9000,
    pid: 4242,
    raw: {
      swiftSimLifecycleClaimID: "claim-1",
      swiftSimLifecycleNonce: "runtime-generation-1",
    },
    limitations: ["fallback transport"],
  },
});

const DURABLE = Object.freeze({
  id: "session-1",
  token: "session-token",
  project: "/private/project/App.xcodeproj",
  scheme: "App",
  simulatorUDID: "SIMULATOR-1",
  createdAt: "2026-08-13T20:00:00.000Z",
});

test("durable session projection contains only frozen domain fields", () => {
  assert.deepEqual(durableSessionFieldNames(), [
    "id",
    "token",
    "project",
    "scheme",
    "simulatorUDID",
    "createdAt",
  ]);
  assert.deepEqual(projectDurableSession(LEGACY_SESSION), DURABLE);

  const serialized = JSON.stringify(projectDurableSession(LEGACY_SESSION));
  assert.deepEqual(parseDurableSession(JSON.parse(serialized)), DURABLE);
});

test("transient, presentation, and unresolved fields cannot enter durable parsing", () => {
  for (const [field, value] of [
    ["stream", LEGACY_SESSION.stream],
    ["logs", LEGACY_SESSION.logs],
    ["remoteBaseUrl", LEGACY_SESSION.remoteBaseUrl],
    ["orientation", LEGACY_SESSION.orientation],
    ["build", LEGACY_SESSION.build],
    ["updatedAt", LEGACY_SESSION.updatedAt],
    ["revision", LEGACY_SESSION.revision],
  ]) {
    assert.throws(
      () => parseDurableSession({ ...DURABLE, [field]: value }),
      /outside the frozen boundary/,
      field,
    );
  }
});

test("presentation join has one authority per field and is not writable", () => {
  const runtime = structuredClone(LEGACY_SESSION);
  runtime.id = "stale-runtime-id";
  runtime.project = "/stale/runtime/project";
  runtime.token = "stale-token";
  runtime.createdAt = "2000-01-01T00:00:00.000Z";

  const joined = joinSessionForPresentation(DURABLE, runtime);

  assert.equal(joined.id, DURABLE.id);
  assert.equal(joined.token, DURABLE.token);
  assert.equal(joined.project, DURABLE.project);
  assert.equal(joined.createdAt, DURABLE.createdAt);
  assert.equal(joined.stream.pid, LEGACY_SESSION.stream.pid);
  assert.equal(joined.remoteBaseUrl, LEGACY_SESSION.remoteBaseUrl);
  assert.equal(joined.updatedAt, LEGACY_SESSION.updatedAt);
  assert.equal(joined.revision, LEGACY_SESSION.revision);
  assert.deepEqual(joined.build, LEGACY_SESSION.build);
  assert.deepEqual(joined.logs, LEGACY_SESSION.logs);
  assert.equal(joined.orientation, LEGACY_SESSION.orientation);

  assert.ok(Object.isFrozen(joined));
  assert.ok(Object.isFrozen(joined.stream));
  assert.ok(Object.isFrozen(joined.stream.raw));
  assert.ok(Object.isFrozen(joined.logs));
  assert.throws(() => {
    joined.stream.pid = 7;
  }, TypeError);

  assert.equal(runtime.stream.pid, LEGACY_SESSION.stream.pid);
});

test("legacy optional durable fields normalize without importing mixed runtime defaults", () => {
  assert.deepEqual(
    projectDurableSession({ id: "session-legacy", token: "token-legacy" }),
    {
      id: "session-legacy",
      token: "token-legacy",
      project: "",
      scheme: "",
      simulatorUDID: "",
      createdAt: "",
    },
  );
});
