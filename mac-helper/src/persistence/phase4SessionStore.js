// @ts-check

import { SessionStore } from "../sessionStore.js";
import { SessionStore as BaseSessionStore } from "../sessionStoreBase.js";
import {
  joinSessionForPresentation,
  parseDurableSession,
  projectDurableSession,
} from "./sessionBoundaryProjection.js";
import { SqliteDurableSessionRepository } from "./sqliteDurableSessionRepository.js";

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("../contracts/session.js").SessionRecord} SessionRecord */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqliteDurableSessionMutationRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  /** @type {SqliteDurableSessionRepository} */
  #reader;
  #upsert;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    this.#database = database;
    this.#reader = new SqliteDurableSessionRepository(database);
    this.#upsert = database.prepare(`INSERT INTO session_records(
      id, token, project, scheme, simulator_udid, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      token = excluded.token,
      project = excluded.project,
      scheme = excluded.scheme,
      simulator_udid = excluded.simulator_udid,
      created_at = excluded.created_at`);
  }

  /** @returns {DurableSessionRecord[]} */
  list() {
    return this.#reader.list();
  }

  /** @param {string} id @returns {DurableSessionRecord | null} */
  get(id) {
    return this.#reader.get(id);
  }

  /** @param {DurableSessionRecord} value @returns {DurableSessionRecord} */
  upsert(value) {
    const durable = parseDurableSession(value);
    return this.#database.transaction(() => {
      this.#upsert.run(
        durable.id,
        durable.token,
        durable.project,
        durable.scheme,
        durable.simulatorUDID,
        durable.createdAt,
      );
      const persisted = this.#reader.get(durable.id);
      if (!persisted || durableKey(persisted) !== durableKey(durable)) {
        throw new Error("Durable session did not persist exactly in SQLite.");
      }
      return persisted;
    });
  }
}

/**
 * Build the hybrid post-cutover session store without running the legacy
 * SessionStore constructor. The filesystem remains the owner of runtime/process
 * state, while every presentation and write overlays the exact six durable
 * SQLite fields. A runtime-only update can therefore never redefine durable
 * authority.
 *
 * @param {{ database: SwiftSimSqliteDatabase, legacyPath: string }} options
 * @returns {SessionStore}
 */
export function createSqliteDurableSessionStore({ database, legacyPath }) {
  if (typeof legacyPath !== "string" || !legacyPath) {
    throw new TypeError("SQLite durable-session store requires the runtime session path.");
  }
  const durableRepository = new SqliteDurableSessionMutationRepository(database);
  const store = /** @type {SessionStore & { _phase4AllowDurableInsert?: boolean }} */ (
    Object.create(SessionStore.prototype)
  );
  store.path = legacyPath;
  store.lockPath = `${legacyPath}.lock`;
  store.sessions = new Map();
  store.stateError = null;
  store._phase4AllowDurableInsert = false;

  store.readStateUnlocked = () =>
    reconstructSessionState(readRawRuntimeState(store), durableRepository.list());

  store.writeStateUnlocked = (sessions) => {
    if (!(sessions instanceof Map)) throw new TypeError("Session state must be a Map.");
    const durableByID = new Map(durableRepository.list().map((record) => [record.id, record]));
    if (store._phase4AllowDurableInsert) {
      for (const session of sessions.values()) {
        if (durableByID.has(session.id)) continue;
        const durable = durableRepository.upsert(projectDurableSession(session));
        durableByID.set(durable.id, durable);
      }
    }

    const runtime = new Map();
    for (const [id, durable] of durableByID) {
      const candidate = sessions.get(id) || {};
      runtime.set(id, structuredClone(joinSessionForPresentation(durable, candidate)));
    }
    BaseSessionStore.prototype.writeStateUnlocked.call(store, runtime);
  };

  const inheritedCreate = SessionStore.prototype.create;
  store.create = (input) => {
    store._phase4AllowDurableInsert = true;
    try {
      return inheritedCreate.call(store, input);
    } finally {
      store._phase4AllowDurableInsert = false;
    }
  };

  store.load();
  store.publishLifecycleRegistry();
  return store;
}

/**
 * Current-state rollback exporter for the hybrid session boundary. It runs
 * under the exact existing sessions.json lock, preserves the current runtime
 * fields, overlays current SQLite durable values, atomically republishes the
 * legacy representation, then re-reads and verifies durable equality. It does
 * not change authority itself; the global selector commit happens only after
 * this method succeeds for every domain.
 */
export class SessionCurrentStateRollbackExport {
  /** @type {SqliteDurableSessionMutationRepository} */
  #durableRepository;
  /** @type {SessionStore} */
  #runtimeStore;

  /** @param {{ durableRepository: SqliteDurableSessionMutationRepository, runtimeStore: SessionStore }} options */
  constructor({ durableRepository, runtimeStore }) {
    if (!durableRepository || typeof durableRepository.list !== "function") {
      throw new TypeError("Session rollback requires the durable SQLite repository.");
    }
    if (!runtimeStore || typeof runtimeStore.withLock !== "function") {
      throw new TypeError("Session rollback requires the exact legacy runtime store lock.");
    }
    this.#durableRepository = durableRepository;
    this.#runtimeStore = runtimeStore;
  }

  exportCurrent() {
    return this.#runtimeStore.withLock(() => {
      const rawRuntime = readRawRuntimeState(this.#runtimeStore);
      const durable = this.#durableRepository.list();
      const merged = reconstructSessionState(rawRuntime, durable);
      BaseSessionStore.prototype.writeStateUnlocked.call(this.#runtimeStore, merged);
      const reread = readRawRuntimeState(this.#runtimeStore);
      const actualDurable = [...reread.values()].map(projectDurableSession).sort(compareDurable);
      const expectedDurable = durable.map(parseDurableSession).sort(compareDurable);
      if (durableSetKey(actualDurable) !== durableSetKey(expectedDurable)) {
        throw new Error("Session rollback export durable projection did not verify after publish.");
      }
      return Object.freeze({
        recordCount: expectedDurable.length,
        durableProjection: expectedDurable,
      });
    });
  }
}

/** @param {SessionStore} store */
function readRawRuntimeState(store) {
  return BaseSessionStore.prototype.readStateUnlocked.call(store);
}

/**
 * @param {Map<string, SessionRecord>} runtime
 * @param {readonly DurableSessionRecord[]} durableRecords
 */
function reconstructSessionState(runtime, durableRecords) {
  const result = new Map();
  for (const durableValue of durableRecords) {
    const durable = parseDurableSession(durableValue);
    const runtimeValue = runtime.get(durable.id) || {};
    result.set(durable.id, structuredClone(joinSessionForPresentation(durable, runtimeValue)));
  }
  return result;
}

/** @param {DurableSessionRecord} value */
function durableKey(value) {
  const durable = parseDurableSession(value);
  return JSON.stringify([
    durable.id,
    durable.token,
    durable.project,
    durable.scheme,
    durable.simulatorUDID,
    durable.createdAt,
  ]);
}

/** @param {DurableSessionRecord} left @param {DurableSessionRecord} right */
function compareDurable(left, right) {
  return left.id.localeCompare(right.id);
}

/** @param {readonly DurableSessionRecord[]} records */
function durableSetKey(records) {
  return JSON.stringify(records.map(durableKey));
}
