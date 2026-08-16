import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionStore as SessionStoreSubclass } from "../mac-helper/src/sessionStore.js";
import { SessionStore as BaseSessionStore } from "../mac-helper/src/sessionStoreBase.js";
import {
  createSqliteDurableSessionStore,
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
  return JSON.parse(readFileSync(path, "utf8")).sessions;
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

test("failure after runtime publication leaves one consistent session and retry creates a distinct one", () => {
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
