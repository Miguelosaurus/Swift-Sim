// @ts-check

/**
 * Bounded Phase 4 session schema fragment. Global migration version/order is
 * intentionally left to P4-INTEGRATION.
 *
 * This table has exactly the six frozen durable-session fields. It has no JSON
 * blob, revision, updatedAt, stream/build/log/runtime/process fields, or claims.
 */
export const SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE session_records (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    token TEXT NOT NULL CHECK (length(token) > 0),
    project TEXT NOT NULL,
    scheme TEXT NOT NULL,
    simulator_udid TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`,
]);

export const SESSION_DURABLE_SQLITE_REQUIRED_TABLES = Object.freeze(["session_records"]);
