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
   * Remove only an unowned durable row plus its create intent. This is the
   * bounded compensation for a failed runtime publication; it never touches a
   * row the runtime confirms it owns.
   *
   * @param {string} sessionID
   * @returns {boolean}
   */
  compensateUnpublishedCreate(sessionID) {
    const normalized = requireSessionID(sessionID);
    return this.#database.transaction(() => {
      const intent = this.#createIntentGet.get(normalized);
      if (!intent) return false;
      this.#reader.deleteByID(normalized);
      this.#createIntentDelete.run(normalized);
      return true;
    });
  }

  /**
   * Resolve leftover create intents against the runtime file on reopen.
   *
   * - intent without a durable row: stale marker, drop the intent only;
   * - intent whose durable row has no runtime record: an unpublished create
   *   that crashed before runtime publication, compensate row + intent;
   * - intent whose durable row has a runtime record: the create completed,
   *   drop the now-unneeded intent marker only.
   *
   * @param {ReadonlySet<string>} runtimeIDs
   */
  reconcileCreateIntents(runtimeIDs) {
    if (!(runtimeIDs instanceof Set)) {
      throw new TypeError("Runtime session ids must be a Set.");
    }
    this.#database.transaction(() => {
      const intents = this.#createIntentList.all();
      for (const intent of intents) {
        const value = /** @type {Record<string, unknown>} */ (intent);
        const sessionID = requireSessionID(String(value.session_id || ""));
        const durableRow = this.#reader.get(sessionID);
        if (!durableRow) {
          this.#createIntentDelete.run(sessionID);
        } else if (!runtimeIDs.has(sessionID)) {
          this.#reader.deleteByID(sessionID);
          this.#createIntentDelete.run(sessionID);
        } else {
          this.#createIntentDelete.run(sessionID);
        }
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
    _phase4PublicationFailure?: unknown,
  }} */ (Object.create(SessionStore.prototype));
  store.path = legacyPath;
  store.lockPath = `${legacyPath}.lock`;
  store.sessions = new Map();
  store.stateError = null;
  store._phase4AllowDurableInsert = false;
  store._phase4CreateIntentID = null;
  store._phase4PublicationFailure = null;

  store.readStateUnlocked = () =>
    reconstructSessionState(readRawRuntimeState(store), durableRepository.list());

  store.writeStateUnlocked = (sessions) => {
    if (!(sessions instanceof Map)) throw new TypeError("Session state must be a Map.");
    const durableByID = new Map(durableRepository.list().map((record) => [record.id, record]));
    if (store._phase4AllowDurableInsert) {
      for (const session of sessions.values()) {
        const durableCandidate = projectDurableSession(session);
        if (durableByID.has(durableCandidate.id)) continue;
        store._phase4CreateIntentID = durableCandidate.id;
        durableRepository.stageCreateIntent(durableCandidate);
        const durablePersisted = durableRepository.upsert(durableCandidate);
        durableByID.set(durablePersisted.id, durablePersisted);
      }
    }

    try {
      publishRuntimeUnlocked(store, durableRepository, durableByID, sessions);
      store._phase4PublicationFailure = null;
      store._phase4CreateIntentID = null;
    } catch (error) {
      store._phase4PublicationFailure = error;
      throw error;
    }
  };

  const inheritedCreate = SessionStore.prototype.create;
  store.create = (input) => {
    store._phase4CreateIntentID = null;
    try {
      store._phase4AllowDurableInsert = true;
      return inheritedCreate.call(store, input);
    } catch (error) {
      const pendingID = store._phase4CreateIntentID;
      if (
        store._phase4PublicationFailure &&
        pendingID &&
        durableRepository.hasCreateIntent(pendingID)
      ) {
        durableRepository.compensateUnpublishedCreate(pendingID);
      }
      store._phase4CreateIntentID = null;
      store._phase4PublicationFailure = null;
      throw error;
    } finally {
      store._phase4AllowDurableInsert = false;
    }
  };

  const inheritedLoad = store.load.bind(store);
  store.load = () => {
    const runtimeIDs = new Set(
      [...readRawRuntimeState(store).values()].map((session) => String(session.id || "")),
    );
    durableRepository.reconcileCreateIntents(runtimeIDs);
    store._phase4CreateIntentID = null;
    store._phase4PublicationFailure = null;
    return inheritedLoad();
  };

  store.load();
  store.publishLifecycleRegistry();
  return store;
}

/**
 * @param {SessionStore & { _phase4AllowDurableInsert?: boolean, _phase4CreateIntentID?: string | null, _phase4PublicationFailure?: unknown }} store
 * @param {SqliteDurableSessionMutationRepository} durableRepository
 * @param {Map<string, DurableSessionRecord>} durableByID
 * @param {Map<string, SessionRecord>} sessions
 */
function publishRuntimeUnlocked(store, durableRepository, durableByID, sessions) {
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
