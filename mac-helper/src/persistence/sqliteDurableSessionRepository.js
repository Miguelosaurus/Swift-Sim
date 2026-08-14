// @ts-check

import { parseDurableSession } from "./sessionBoundaryProjection.js";

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */

export class SqliteDurableSessionRepository {
  /** @type {SwiftSimSqliteDatabase} */
  #database;
  #listStatement;
  #getStatement;
  #deleteStatement;
  #insertStatement;

  /** @param {SwiftSimSqliteDatabase} database */
  constructor(database) {
    if (
      !database ||
      typeof database.prepare !== "function" ||
      typeof database.transaction !== "function"
    ) {
      throw new Error("Durable-session SQLite database is required.");
    }
    this.#database = database;
    this.#listStatement = database.prepare(`SELECT
      id, token, project, scheme, simulator_udid, created_at
      FROM session_records ORDER BY created_at, id`);
    this.#getStatement = database.prepare(`SELECT
      id, token, project, scheme, simulator_udid, created_at
      FROM session_records WHERE id = ?`);
    this.#deleteStatement = database.prepare("DELETE FROM session_records");
    this.#insertStatement = database.prepare(`INSERT INTO session_records(
      id, token, project, scheme, simulator_udid, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`);
  }

  /** @returns {DurableSessionRecord[]} */
  list() {
    return this.#listStatement.all().map(mapRow);
  }

  /** @param {string} id @returns {DurableSessionRecord | null} */
  get(id) {
    const row = this.#getStatement.get(requireNonEmptyString(id, "Durable session id"));
    return row ? mapRow(row) : null;
  }

  /** @param {readonly DurableSessionRecord[]} records */
  replace(records) {
    const normalized = normalizeDurableSessions(records);
    this.#database.transaction(() => {
      this.#deleteStatement.run();
      for (const record of normalized) {
        this.#insertStatement.run(
          record.id,
          record.token,
          record.project,
          record.scheme,
          record.simulatorUDID,
          record.createdAt,
        );
      }
    });
  }
}

/** @param {readonly unknown[]} records @returns {DurableSessionRecord[]} */
export function normalizeDurableSessions(records) {
  if (!Array.isArray(records)) throw new Error("Durable session snapshot must be an array.");
  const normalized = records.map((record) => parseDurableSession(structuredClone(record)));
  normalized.sort(compareSessions);
  const ids = new Set();
  for (const record of normalized) {
    if (ids.has(record.id)) throw new Error(`Duplicate durable session id: ${record.id}.`);
    ids.add(record.id);
  }
  return normalized;
}

/** @param {unknown} row @returns {DurableSessionRecord} */
function mapRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("SQLite returned an invalid durable-session row.");
  }
  const values = /** @type {Record<string, unknown>} */ (row);
  return parseDurableSession({
    id: values.id,
    token: values.token,
    project: values.project,
    scheme: values.scheme,
    simulatorUDID: values.simulator_udid,
    createdAt: values.created_at,
  });
}

/** @param {DurableSessionRecord} left @param {DurableSessionRecord} right */
function compareSessions(left, right) {
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || left.id.localeCompare(right.id);
}

/** @param {unknown} value @param {string} label */
function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}
