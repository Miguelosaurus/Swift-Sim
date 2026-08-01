import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { readJson } from "../mac-helper/src/http.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";

async function withPath(run) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-session-store-"));
  const path = join(directory, "sessions.json");
  try { return await run(path, directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}

const input = (token, simulatorUDID) => ({ token, project: "/tmp/App.xcodeproj", scheme: "App", simulatorUDID });

function markRunning(store, session, transport) {
  session.stream.state = "running";
  session.stream.transport = transport;
  session.stream.localUrl = `http://127.0.0.1/${transport}`;
  store.save(session);
  return session;
}

async function enterHTTPTransport(transport) {
  const body = JSON.stringify({ transport });
  const req = Readable.from([body]);
  req.method = "POST";
  req.url = "/api/sessions/start";
  req.headers = { "content-length": String(Buffer.byteLength(body)) };
  await readJson(req);
}

test("stale store instances preserve independently created sessions", () => withPath((path) => {
  const first = new SessionStore({ path });
  const stale = new SessionStore({ path });
  const a = first.create(input("a", "A"));
  const b = stale.create(input("b", "B"));
  const ids = new SessionStore({ path }).list().map((session) => session.id).sort();
  assert.deepEqual(ids, [a.id, b.id].sort());
}));

test("a concurrent start for the same Simulator fails closed", () => withPath((path) => {
  const first = new SessionStore({ path });
  const stale = new SessionStore({ path });
  first.create(input("a", "A"));
  assert.throws(() => stale.create(input("b", "A")), {
    code: "SWIFT_SIM_SESSION_START_IN_PROGRESS",
  });
  assert.equal(new SessionStore({ path }).list().length, 1);
}));

test("a different transport cannot create a second stream for the same Simulator target", () => withPath((path) => {
  const first = new SessionStore({ path });
  const second = new SessionStore({ path });
  first.create({ ...input("a", "A"), transport: "serve-sim" });
  assert.throws(
    () => second.create({ ...input("b", "A"), transport: "native-companion" }),
    { code: "SWIFT_SIM_SESSION_START_IN_PROGRESS" },
  );
  assert.equal(new SessionStore({ path }).list().length, 1);
}));

test("request-local transport still exposes the existing shared stream to switch handling", async () => withPath(async (path) => {
  const store = new SessionStore({ path });
  const serve = markRunning(
    store,
    store.create({ ...input("serve", "A"), transport: "serve-sim" }),
    "serve-sim",
  );

  await enterHTTPTransport("native-companion");
  assert.equal(store.findReusable({
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "A",
  }).id, serve.id);

  await enterHTTPTransport("serve-sim");
  assert.equal(store.findReusable({
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    simulatorUDID: "A",
  }).id, serve.id);
}));

test("stale saves merge appended logs instead of erasing newer work", () => withPath((path) => {
  const first = new SessionStore({ path });
  const created = first.create(input("token", "A"));
  const stale = new SessionStore({ path }).get(created.id);
  const current = first.get(created.id);
  current.logs.push("newer");
  first.save(current);
  current.stream.state = "running";
  current.stream.localUrl = "http://127.0.0.1:6000/new";
  current.stream.pid = 6000;
  first.save(current);
  stale.logs.push("stale-completion");
  stale.stream.state = "stopped";
  new SessionStore({ path }).save(stale);
  const saved = new SessionStore({ path }).get(created.id);
  assert.deepEqual(saved.logs, ["newer", "stale-completion"]);
  assert.equal(saved.stream.state, "stopped");
  assert.equal(saved.stream.localUrl, "http://127.0.0.1:6000/new");
  assert.equal(saved.stream.pid, 6000);
}));

test("stale log-only saves do not restore an obsolete stream", () => withPath((path) => {
  const store = new SessionStore({ path });
  const created = store.create(input("token", "A"));
  const stale = store.get(created.id);
  const restarted = store.get(created.id);
  restarted.stream.state = "running";
  restarted.stream.localUrl = "http://127.0.0.1:6000/new";
  restarted.stream.pid = 6000;
  store.save(restarted);
  stale.logs.push("input completed");
  store.save(stale);
  const saved = store.get(created.id);
  assert.equal(saved.stream.localUrl, "http://127.0.0.1:6000/new");
  assert.equal(saved.stream.pid, 6000);
  assert.deepEqual(saved.logs, ["input completed"]);
}));

test("malformed JSON fails closed instead of being replaced with an empty library", () => withPath((path) => {
  writeFileSync(path, "{not-json", { mode: 0o644 });
  const store = new SessionStore({ path });
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.create(input("token", "A")), { code: "SWIFT_SIM_SESSION_STATE_INVALID" });
  assert.equal(readFileSync(path, "utf8"), "{not-json");
  assert.equal(statSync(path).mode & 0o077, 0);
}));

test("parseable malformed nested state is preserved and rejected", () => withPath((path) => {
  const store = new SessionStore({ path });
  store.create(input("private-token", "A"));
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  parsed.sessions[0].logs = { corrupted: true };
  const corrupted = JSON.stringify(parsed, null, 2);
  writeFileSync(path, corrupted, { mode: 0o644 });

  const reopened = new SessionStore({ path });
  assert.deepEqual(reopened.list(), []);
  assert.throws(() => reopened.create(input("new-token", "B")), {
    code: "SWIFT_SIM_SESSION_STATE_INVALID",
  });
  assert.equal(readFileSync(path, "utf8"), corrupted);
  assert.equal(statSync(path).mode & 0o077, 0);
}));

test("loading an existing session file repairs legacy broad permissions", () => withPath((path) => {
  const store = new SessionStore({ path });
  store.create(input("private-token", "A"));
  const content = readFileSync(path);
  writeFileSync(path, content, { mode: 0o644 });
  new SessionStore({ path });
  assert.equal(statSync(path).mode & 0o077, 0);
}));

test("session tokens are persisted in a private file", () => withPath((path) => {
  new SessionStore({ path }).create(input("private-token", "A"));
  assert.equal(statSync(path).mode & 0o077, 0);
}));
