import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStateBytes } from "./fixtures/state-bytes.js";
import { SessionStore as SessionStoreSubclass } from "../mac-helper/src/sessionStore.js";
import { SessionStore as BaseSessionStore } from "../mac-helper/src/sessionStoreBase.js";
import {
  createSqliteDurableSessionStore,
  SessionCurrentStateRollbackExport,
  SqliteDurableSessionMutationRepository,
} from "../mac-helper/src/persistence/phase4SessionStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SqliteDurableSessionRepository } from "../mac-helper/src/persistence/sqliteDurableSessionRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CREATE_INPUT = Object.freeze({
  token: "session-token",
  project: "/tmp/App.xcodeproj",
  scheme: "App",
  simulatorUDID: "SIM-1",
});

function withHybridStore(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-hybrid-create-"));
  const stateRoot = join(directory, ".swift-sim");
  const databasePath = join(stateRoot, "state.sqlite");
  const sessionsPath = join(stateRoot, "sessions.json");
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  chmodSync(stateRoot, 0o700);
  const database = new SwiftSimSqliteDatabase({
    path: databasePath,
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  try {
    return operation({
      directory,
      stateRoot,
      databasePath,
      sessionsPath,
      database,
      durable: () => new SqliteDurableSessionRepository(database).list(),
      createStore: () => createSqliteDurableSessionStore({ database, legacyPath: sessionsPath }),
    });
  } finally {
    try {
      database.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
}

function sessionsFile(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readStateBytes(path).toString("utf8")).sessions;
}

test("durable session table keeps exactly the six frozen columns", () => {
  withHybridStore(({ database }) => {
    const columns = database
      .prepare("PRAGMA table_info(session_records)")
      .all()
      .map((row) => String(row.name || ""));
    assert.deepEqual(columns, ["id", "token", "project", "scheme", "simulator_udid", "created_at"]);
  });
});

test("failure before the durable write leaves no row, no intent, and no phantom on reopen", () => {
  withHybridStore(({ database, sessionsPath, createStore, durable }) => {
    const original = SqliteDurableSessionMutationRepository.prototype.stageCreateIntent;
    SqliteDurableSessionMutationRepository.prototype.stageCreateIntent = () => {
      throw new Error("injected before-durable-write failure");
    };
    try {
      const store = createStore();
      assert.throws(() => store.create({ ...CREATE_INPUT }), /before-durable-write/);
    } finally {
      SqliteDurableSessionMutationRepository.prototype.stageCreateIntent = original;
    }
    assert.deepEqual(durable(), []);
    assert.equal(sessionsFile(sessionsPath), null);

    const reopened = createStore();
    assert.deepEqual(reopened.list(), []);
    const session = reopened.create({ ...CREATE_INPUT });
    assert.ok(session.id);
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath).length, 1);
    database.close();
  });
});

test("failure during runtime-file publication compensates the durable row and retry is deterministic", () => {
  withHybridStore(({ sessionsPath, createStore, durable }) => {
    const original = BaseSessionStore.prototype.writeStateUnlocked;
    BaseSessionStore.prototype.writeStateUnlocked = function patchedWriteStateUnlocked() {
      throw new Error("injected runtime-publication failure");
    };
    try {
      const store = createStore();
      assert.throws(() => store.create({ ...CREATE_INPUT }), /runtime-publication/);
    } finally {
      BaseSessionStore.prototype.writeStateUnlocked = original;
    }
    assert.deepEqual(durable(), []);
    assert.equal(sessionsFile(sessionsPath), null);

    const reopened = createStore();
    assert.deepEqual(reopened.list(), []);
    const retried = reopened.create({ ...CREATE_INPUT });
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath).length, 1);
    assert.ok(retried.id);
  });
});

test("failure after runtime publication preserves one session and equivalent retry cannot duplicate it", () => {
  withHybridStore(({ sessionsPath, createStore, durable }) => {
    const originalCreate = SessionStoreSubclass.prototype.create;
    let firstID;
    SessionStoreSubclass.prototype.create = function patchedCreateAfterPublish(input) {
      const result = originalCreate.call(this, input);
      firstID = result.id;
      throw new Error("injected after-publication failure");
    };
    let store;
    try {
      store = createStore();
      assert.throws(() => {
        store.create({ ...CREATE_INPUT });
      }, /after-publication/);
    } finally {
      SessionStoreSubclass.prototype.create = originalCreate;
    }
    const rows = durable();
    assert.equal(rows.length, 1);
    assert.ok(firstID);
    assert.equal(rows[0].id, firstID);
    const runtime = sessionsFile(sessionsPath);
    assert.equal(runtime.length, 1);
    assert.equal(runtime[0].id, firstID);

    const reopened = createStore();
    const visible = reopened.list();
    assert.equal(visible.length, 1);
    assert.equal(visible[0].id, firstID);
    assert.equal(visible[0].token, CREATE_INPUT.token);
    assert.equal(visible[0].stream.state, "starting");

    // The identical request is idempotently rejected while the first session is
    // still starting, so no phantom/duplicate durable session can appear.
    assert.throws(
      () => reopened.create({ ...CREATE_INPUT }),
      (error) => error.code === "SWIFT_SIM_SESSION_START_IN_PROGRESS",
    );
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath).length, 1);

    const retried = reopened.create({ ...CREATE_INPUT, simulatorUDID: "SIM-2" });
    assert.ok(retried.id);
    assert.notEqual(retried.id, firstID);
    assert.equal(durable().length, 2);
    assert.equal(sessionsFile(sessionsPath).length, 2);
  });
});

test("reopen after a crashed create keeps runtime-only state and never duplicates durable rows", () => {
  withHybridStore(({ sessionsPath, createStore, durable }) => {
    const store = createStore();
    const created = store.create({ ...CREATE_INPUT });
    const runtime = store.get(created.id);
    runtime.logs.push("runtime-only-line");
    runtime.orientation = "landscape";
    runtime.stream.pid = 1234;
    store.save(runtime);

    const reopened = createStore();
    const visible = reopened.get(created.id);
    assert.equal(visible.token, CREATE_INPUT.token);
    assert.ok(visible.logs.includes("runtime-only-line"));
    assert.equal(visible.orientation, "landscape");
    assert.equal(visible.stream.pid, 1234);
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath).length, 1);
  });
});

test("reopen compensates a durable row that crashed before runtime publication", () => {
  withHybridStore(({ sessionsPath, database, createStore, durable }) => {
    const repo = new SqliteDurableSessionMutationRepository(database);
    repo.stageCreateIntent({
      id: "crashed-session",
      token: "token",
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
      createdAt: "2026-08-16T00:00:00.000Z",
    });
    repo.upsert({
      id: "crashed-session",
      token: "token",
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
      createdAt: "2026-08-16T00:00:00.000Z",
    });
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath), null);

    const reopened = createStore();
    assert.deepEqual(durable(), []);
    assert.deepEqual(reopened.list(), []);

    const created = reopened.create({ ...CREATE_INPUT });
    assert.equal(durable().length, 1);
    assert.equal(sessionsFile(sessionsPath).length, 1);
    assert.ok(created.id);
  });
});

const WORKER = new URL("./fixtures/phase4-session-create-worker.js", import.meta.url);

async function waitUntil(predicate, label) {
  const deadline = Date.now() + 8_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

async function withProcessRoot(operation) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-session-interleaving-"));
  const stateRoot = join(directory, ".swift-sim");
  mkdirSync(stateRoot, { mode: 0o700 });
  const database = new SwiftSimSqliteDatabase({
    path: join(stateRoot, "state.sqlite"),
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
  const children = [];
  function worker(action, boundary, disposition) {
    const child = spawn(
      process.execPath,
      [WORKER.pathname, stateRoot, action, boundary || "", disposition || "pause"],
      {
        env: { ...process.env, HOME: directory },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    const exited = once(child, "exit").then(([code, signal]) => {
      assert.equal(code, 0, `${action} exited with ${signal || code}: ${stderr}`);
    });
    // The test awaits this later, after releasing the controllable barrier.
    exited.catch(() => {});
    children.push(child);
    return { child, exited };
  }
  writeFileSync(join(stateRoot, "create-input.json"), JSON.stringify(CREATE_INPUT));
  try {
    await operation({ stateRoot, database, worker });
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const boundary of [
  "before-durable",
  "after-durable",
  "during-publication",
  "after-publication",
]) {
  test(`cross-process reopen waits for the exact session lock at ${boundary}`, async () => {
    await withProcessRoot(async ({ stateRoot, database, worker }) => {
      const existingReader = createSqliteDurableSessionStore({
        database,
        legacyPath: join(stateRoot, "sessions.json"),
      });
      const a = worker("creator", boundary);
      await waitUntil(() => existsSync(join(stateRoot, "creator-ready.json")), "creator barrier");
      const owner = JSON.parse(
        readStateBytes(join(stateRoot, "sessions.json.lock", "owner.json")).toString("utf8"),
      );
      assert.equal(owner.pid, a.child.pid);
      assert.equal(typeof (owner.startedAt || owner.startToken), "string");
      assert.ok(owner.startedAt || owner.startToken);
      const before = new SqliteDurableSessionRepository(database).list();
      assert.equal(before.length, boundary === "before-durable" ? 0 : 1);
      assert.equal(existingReader.list().length, boundary === "after-publication" ? 1 : 0);
      if (before.length && boundary !== "after-publication") {
        assert.equal(existingReader.get(before[0].id), undefined);
      }
      const b = worker("reopener");
      await waitUntil(
        () => existsSync(join(stateRoot, "reopener-attempting")),
        "independent opener",
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(existsSync(join(stateRoot, "reopener-done.json")), false);
      assert.deepEqual(new SqliteDurableSessionRepository(database).list(), before);
      assert.equal(
        database.prepare("SELECT count(*) AS count FROM session_create_intents").get().count,
        1,
      );
      writeFileSync(join(stateRoot, "creator-release"), "1");
      await Promise.all([a.exited, b.exited]);
      const durable = new SqliteDurableSessionRepository(database).list();
      const reopened = JSON.parse(
        readStateBytes(join(stateRoot, "reopener-done.json")).toString("utf8"),
      );
      assert.equal(durable.length, 1);
      assert.equal(reopened.length, 1);
      assert.equal(reopened[0].id, durable[0].id);
      assert.equal(
        database.prepare("SELECT count(*) AS count FROM session_create_intents").get().count,
        0,
      );
    });
  });

  test(`cross-process stale-owner recovery resolves a crash at ${boundary}`, async () => {
    await withProcessRoot(async ({ stateRoot, database, worker }) => {
      const a = worker("creator", boundary, "crash");
      await a.exited;
      assert.equal(existsSync(join(stateRoot, "sessions.json.lock")), true);
      const b = worker("reopener");
      await b.exited;
      const expected = boundary === "after-publication" ? 1 : 0;
      assert.equal(new SqliteDurableSessionRepository(database).list().length, expected);
      const reopened = JSON.parse(
        readStateBytes(join(stateRoot, "reopener-done.json")).toString("utf8"),
      );
      assert.equal(reopened.length, expected);
      assert.equal(
        database.prepare("SELECT count(*) AS count FROM session_create_intents").get().count,
        0,
      );
      const store = createSqliteDurableSessionStore({
        database,
        legacyPath: join(stateRoot, "sessions.json"),
      });
      if (expected) {
        assert.throws(
          () => store.create(CREATE_INPUT),
          (error) => error.code === "SWIFT_SIM_SESSION_START_IN_PROGRESS",
        );
      } else {
        assert.ok(store.create(CREATE_INPUT).id);
      }
      assert.equal(new SqliteDurableSessionRepository(database).list().length, 1);
    });
  });
}

test("intent reconciliation and compensation never delete a different durable row", () => {
  withHybridStore(({ sessionsPath, database, createStore, durable }) => {
    const repo = new SqliteDurableSessionMutationRepository(database);
    const candidate = {
      ...CREATE_INPUT,
      id: "replaced-session",
      createdAt: "2026-08-16T00:00:00.000Z",
    };
    repo.stageCreateIntent(candidate);
    repo.upsert({ ...candidate, token: "replacement-token" });
    const before = durable();
    assert.throws(() => repo.compensateUnpublishedCreate(candidate.id), /exact intent/);
    assert.throws(() => createStore(), /exact intent/);
    assert.deepEqual(durable(), before);
    assert.equal(sessionsFile(sessionsPath), null);
    assert.equal(repo.hasCreateIntent(candidate.id), true);
  });
});

test("stale intent without a durable row clears without changing existing runtime state", () => {
  withHybridStore(({ database, createStore, durable }) => {
    const store = createStore();
    const created = store.create(CREATE_INPUT);
    const runtime = store.get(created.id);
    runtime.logs.push("runtime-sentinel");
    runtime.orientation = "landscape";
    runtime.stream.pid = 1234;
    store.save(runtime);
    const repo = new SqliteDurableSessionMutationRepository(database);
    repo.stageCreateIntent({
      ...CREATE_INPUT,
      id: "stale-intent",
      createdAt: "2026-08-16T00:00:00.000Z",
    });
    const reopened = createStore();
    assert.equal(repo.hasCreateIntent("stale-intent"), false);
    assert.equal(durable().length, 1);
    assert.deepEqual(reopened.get(created.id).logs, ["runtime-sentinel"]);
    assert.equal(reopened.get(created.id).orientation, "landscape");
    assert.equal(reopened.get(created.id).stream.pid, 1234);
  });
});

test("normal published create completes its intent and reopen cannot compensate it", () => {
  withHybridStore(({ database, createStore, durable }) => {
    const created = createStore().create(CREATE_INPUT);
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM session_create_intents").get().count,
      0,
    );
    assert.equal(createStore().get(created.id).id, created.id);
    assert.equal(durable().length, 1);
  });
});

test("an already-open store hides a crashed unpublished row and recovers before its next write", async () => {
  await withProcessRoot(async ({ stateRoot, database, worker }) => {
    const existing = createSqliteDurableSessionStore({
      database,
      legacyPath: join(stateRoot, "sessions.json"),
    });
    const a = worker("creator", "after-durable", "crash");
    await a.exited;
    const abandoned = new SqliteDurableSessionRepository(database).list()[0];
    assert.ok(abandoned);
    assert.deepEqual(existing.list(), []);
    assert.equal(existing.get(abandoned.id), undefined);
    const created = existing.create(CREATE_INPUT);
    assert.notEqual(created.id, abandoned.id);
    const rows = new SqliteDurableSessionRepository(database).list();
    assert.deepEqual(
      rows.map((row) => row.id),
      [created.id],
    );
    assert.equal(
      database.prepare("SELECT count(*) AS count FROM session_create_intents").get().count,
      0,
    );
    assert.equal(existing.list().length, 1);
  });
});

test("rollback export recovers a crashed create before publishing current durable sessions to legacy", async () => {
  await withProcessRoot(async ({ stateRoot, database, worker }) => {
    const sessionsPath = join(stateRoot, "sessions.json");
    const publishedStore = createSqliteDurableSessionStore({ database, legacyPath: sessionsPath });
    const published = publishedStore.create({ ...CREATE_INPUT, simulatorUDID: "SIM-PUBLISHED" });
    published.logs.push("rollback-runtime-sentinel");
    published.orientation = "landscape";
    published.stream.pid = 1234;
    publishedStore.save(published);

    const a = worker("creator", "after-durable", "crash");
    await a.exited;
    const repository = new SqliteDurableSessionMutationRepository(database);
    const rowsBefore = repository.list();
    assert.equal(rowsBefore.length, 2);
    const abandoned = rowsBefore.find((row) => row.id !== published.id);
    assert.ok(abandoned);
    assert.equal(repository.hasCreateIntent(abandoned.id), true);

    // Production rollback uses this ordinary runtime/legacy store, not the
    // hybrid store's recovery-aware withLock wrapper.
    const runtimeStore = new SessionStoreSubclass({ path: sessionsPath });
    const exporter = new SessionCurrentStateRollbackExport({
      durableRepository: repository,
      runtimeStore,
    });
    const exported = exporter.exportCurrent();
    assert.equal(exported.recordCount, 1);
    assert.deepEqual(
      exported.durableProjection.map((row) => row.id),
      [published.id],
    );
    assert.equal(repository.hasCreateIntent(abandoned.id), false);
    assert.deepEqual(
      repository.list().map((row) => row.id),
      [published.id],
    );
    const legacy = sessionsFile(sessionsPath);
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].id, published.id);
    assert.deepEqual(legacy[0].logs, ["rollback-runtime-sentinel"]);
    assert.equal(legacy[0].orientation, "landscape");
    assert.equal(legacy[0].stream.pid, 1234);
    assert.deepEqual(exporter.exportCurrent(), exported);
  });
});
