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
  #createIntentInsert;
  #createIntentDelete;
  #createIntentGet;
  #createIntentList;

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
    this.#createIntentInsert = database.prepare(`INSERT INTO session_create_intents(
      session_id, token, project, scheme, simulator_udid, created_at,
      intent_version, created_intent_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      token = excluded.token,
      project = excluded.project,
      scheme = excluded.scheme,
      simulator_udid = excluded.simulator_udid,
      created_at = excluded.created_at,
      created_intent_at = excluded.created_intent_at`);
    this.#createIntentDelete = database.prepare(
      "DELETE FROM session_create_intents WHERE session_id = ?",
    );
    this.#createIntentGet = database.prepare(
      "SELECT session_id, token, project, scheme, simulator_udid, created_at, intent_version, created_intent_at FROM session_create_intents WHERE session_id = ?",
    );
    this.#createIntentList = database.prepare(
      "SELECT session_id FROM session_create_intents ORDER BY session_id",
    );
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

  /**
   * Stage a create before the durable row is committed. The intent is the
   * session id plus the accepted durable projection; it is never exposed as a
   * session, never listed, and never authoritative. It exists so a failed
   * runtime publication can deterministically identify and compensate an
   * unowned durable row on retry/reopen.
   *
   * @param {DurableSessionRecord} value
   * @returns {void}
   */
  stageCreateIntent(value) {
    const durable = parseDurableSession(value);
    this.#database.transaction(() => {
      if (this.#reader.get(durable.id) || this.hasCreateIntent(durable.id)) {
        throw new Error("Session create intent cannot replace an existing session or intent.");
      }
      this.#createIntentInsert.run(
        durable.id,
        durable.token,
        durable.project,
        durable.scheme,
        durable.simulatorUDID,
        durable.createdAt,
        new Date().toISOString(),
      );
    });
  }

  /** @param {string} sessionID @returns {boolean} */
  hasCreateIntent(sessionID) {
    return Boolean(this.#createIntentGet.get(requireSessionID(sessionID)));
  }

  /**
   * Complete only the exact published create. The caller holds sessions.json's
   * existing process-identity lock through publication and intent completion.
   * @param {DurableSessionRecord} value
   */
  completeCreateIntent(value) {
    const durable = parseDurableSession(value);
    this.#database.transaction(() => {
      const intent = this.#createIntentGet.get(durable.id);
      if (!intent) return;
      if (durableKey(parseCreateIntent(intent)) !== durableKey(durable)) {
        throw new Error("Session create completion does not match its exact intent.");
      }
      this.#createIntentDelete.run(durable.id);
    });
  }

  /**
   * Compensate only an unpublished row that still exactly matches its intent.
   * Callers must hold the same session lock as runtime publication/recovery.
   * @param {string} sessionID
   * @returns {boolean}
   */
  compensateUnpublishedCreate(sessionID) {
    const normalized = requireSessionID(sessionID);
    return this.#database.transaction(() => {
      const intent = this.#createIntentGet.get(normalized);
      if (!intent) return false;
      const expected = parseCreateIntent(intent);
      const current = this.#reader.get(normalized);
      if (current && durableKey(current) !== durableKey(expected)) {
        throw new Error(
          "Session create recovery found a row that does not match its exact intent.",
        );
      }
      if (current) this.#reader.deleteByID(normalized);
      this.#createIntentDelete.run(normalized);
      return true;
    });
  }

  /**
   * Resolve intents while holding the exact sessions.json lock. A runtime
   * record proves publication only when its durable identity matches; ambiguous
   * records are preserved and fail closed rather than deleting a replacement.
   * @param {ReadonlyMap<string, SessionRecord>} runtime
   */
  reconcileCreateIntents(runtime) {
    if (!(runtime instanceof Map)) {
      throw new TypeError("Runtime sessions must be a Map.");
    }
    // One transaction makes a failed identity check preserve the entire batch.
    this.#database.transaction(() => {
      for (const row of this.#createIntentList.all()) {
        const value = /** @type {Record<string, unknown>} */ (row);
        const sessionID = requireSessionID(String(value.session_id || ""));
        const intent = parseCreateIntent(this.#createIntentGet.get(sessionID));
        const durable = this.#reader.get(sessionID);
        const published = runtime.get(sessionID);
        if (durable && durableKey(durable) !== durableKey(intent)) {
          throw new Error(
            "Session create recovery found a row that does not match its exact intent.",
          );
        }
        if (
          published &&
          (!durable || durableKey(projectDurableSession(published)) !== durableKey(intent))
        ) {
          throw new Error("Session create recovery found conflicting runtime publication.");
        }
        if (durable && !published) this.#reader.deleteByID(sessionID);
        this.#createIntentDelete.run(sessionID);
      }
    });
  }
}

/** @param {string} value */
function requireSessionID(value) {
  if (typeof value !== "string" || !value) {
    throw new TypeError("Session id must be a non-empty string.");
  }
  return value;
}

/** @param {unknown} row @returns {DurableSessionRecord} */
function parseCreateIntent(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("Session create intent is missing or malformed.");
  }
  const value = /** @type {Record<string, unknown>} */ (row);
  if (value.intent_version !== 1) throw new Error("Session create intent version is unsupported.");
  return parseDurableSession({
    id: value.session_id,
    token: value.token,
    project: value.project,
    scheme: value.scheme,
    simulatorUDID: value.simulator_udid,
    createdAt: value.created_at,
  });
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
  const store = /** @type {SessionStore & {
    _phase4AllowDurableInsert?: boolean,
    _phase4CreateIntentID?: string | null,
  }} */ (Object.create(SessionStore.prototype));
  store.path = legacyPath;
  store.lockPath = `${legacyPath}.lock`;
  store.sessions = new Map();
  store.stateError = null;
  store._phase4AllowDurableInsert = false;
  store._phase4CreateIntentID = null;

  // Recovery belongs to every exact locked operation, including operations on
  // a store opened before another creator crashed, not just a fresh opener.
  const inheritedWithLock = store.withLock.bind(store);
  store.withLock = (operation) =>
    inheritedWithLock(() => {
      durableRepository.reconcileCreateIntents(readRawRuntimeState(store));
      return operation();
    });

  store.readStateUnlocked = () => {
    const runtime = readRawRuntimeState(store);
    const visible = durableRepository.list().filter((durable) => {
      if (!durableRepository.hasCreateIntent(durable.id)) return true;
      const published = runtime.get(durable.id);
      if (!published) return false;
      if (durableKey(projectDurableSession(published)) !== durableKey(durable)) {
        throw new Error("Pending session create conflicts with runtime publication.");
      }
      return true;
    });
    return reconstructSessionState(runtime, visible);
  };

  store.writeStateUnlocked = (sessions) => {
    if (!(sessions instanceof Map)) throw new TypeError("Session state must be a Map.");
    const durableByID = new Map(durableRepository.list().map((record) => [record.id, record]));
    // BaseSessionStore invokes this method under its exact session lock. Keep
    // stage/commit/publication/completion and any compensation inside that lock.
    try {
      if (store._phase4AllowDurableInsert) {
        for (const session of sessions.values()) {
          const candidate = projectDurableSession(session);
          if (durableByID.has(candidate.id)) continue;
          store._phase4CreateIntentID = candidate.id;
          durableRepository.stageCreateIntent(candidate);
          const persisted = durableRepository.upsert(candidate);
          durableByID.set(persisted.id, persisted);
        }
      }
      publishRuntimeUnlocked(store, durableByID, sessions);
      const pendingID = store._phase4CreateIntentID;
      if (pendingID) {
        const durable = durableByID.get(pendingID);
        if (!durable) throw new Error("Published session create lost its durable identity.");
        durableRepository.completeCreateIntent(durable);
      }
    } catch (error) {
      const pendingID = store._phase4CreateIntentID;
      if (pendingID && durableRepository.hasCreateIntent(pendingID)) {
        // A rename can succeed before a later publication step fails. Observe
        // the actual runtime record under the same lock before compensating.
        durableRepository.reconcileCreateIntents(readRawRuntimeState(store));
      }
      throw error;
    } finally {
      store._phase4CreateIntentID = null;
    }
  };

  const inheritedCreate = SessionStore.prototype.create;
  store.create = (input) => {
    try {
      store._phase4AllowDurableInsert = true;
      return inheritedCreate.call(store, input);
    } finally {
      store._phase4AllowDurableInsert = false;
    }
  };

  const inheritedLoad = store.load.bind(store);
  store.load = () =>
    store.withLock(() => {
      store._phase4CreateIntentID = null;
      return inheritedLoad();
    });

  store.load();
  store.publishLifecycleRegistry();
  return store;
}

/**
 * @param {SessionStore & { _phase4AllowDurableInsert?: boolean, _phase4CreateIntentID?: string | null, }} store
 * @param {Map<string, DurableSessionRecord>} durableByID
 * @param {Map<string, SessionRecord>} sessions
 */
function publishRuntimeUnlocked(store, durableByID, sessions) {
  const runtime = new Map();
  for (const [id, durable] of durableByID) {
    const candidate = sessions.get(id) || {};
    runtime.set(id, structuredClone(joinSessionForPresentation(durable, candidate)));
  }
  BaseSessionStore.prototype.writeStateUnlocked.call(store, runtime);
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
      // Rollback may use an ordinary legacy store, whose lock does not run the
      // hybrid opener's recovery hook. Resolve unpublished creates under this
      // same lock before exporting the current durable set into legacy state.
      this.#durableRepository.reconcileCreateIntents(rawRuntime);
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
