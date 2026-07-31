import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";

function withPath(run) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-session-store-"));
  const path = join(directory, "sessions.json");
  try {
    return run(path, directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function input(token, simulatorUDID) {
  return {
    token,
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID,
  };
}

test("stale store instances preserve independently created sessions", () => withPath((path) => {
  const first = new SessionStore({ path });
  const stale = new SessionStore({ path });
  const a = first.create(input("a", "A"));
  const b = stale.create(input("b", "B"));
  const ids = new SessionStore({ path }).list().map((session) => session.id).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());
}));

test("stale saves merge appended logs instead of erasing newer work", () => withPath((path) => {
  const first = new SessionStore({ path });
  const created = first.create(input("token", "A"));
  const stale = new SessionStore({ path }).get(created.id);
  const current = first.get(created.id);
  current.logs.push("newer");
  first.save(current);
  stale.logs.push("stale-completion");
  stale.stream.state = "stopped";
  new SessionStore({ path }).save(stale);
  const saved = new SessionStore({ path }).get(created.id);
  assert.deepEqual(saved.logs, ["newer", "stale-completion"]);
  assert.equal(saved.stream.state, "stopped");
}));

test("malformed state fails closed without blocking unrelated helper workflows", () => withPath((path) => {
  writeFileSync(path, "{not-json", { mode: 0o600 });
  const store = new SessionStore({ path });
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.create(input("token", "A")), {
    code: "SWIFT_SIM_SESSION_STATE_INVALID",
  });
  assert.equal(readFileSync(path, "utf8"), "{not-json");
}));

test("session tokens are persisted in a private file", () => withPath((path) => {
  new SessionStore({ path }).create(input("private-token", "A"));
  assert.equal(statSync(path).mode & 0o077, 0);
}));
