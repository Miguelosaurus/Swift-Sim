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

/**
 * Bounded create-recovery table for the hybrid session boundary. This is part
 * of the corrected v9 migration, not v8: v1-v8 remain byte-for-byte frozen.
 * The table records only a pending create intent (the six durable fields plus
 * intent bookkeeping) and is never exposed as session state.
 */
export const SESSION_CREATE_INTENT_SQLITE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE session_create_intents (
    session_id TEXT PRIMARY KEY CHECK (length(session_id) > 0),
    token TEXT NOT NULL CHECK (length(token) > 0),
    project TEXT NOT NULL,
    scheme TEXT NOT NULL,
    simulator_udid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    intent_version INTEGER NOT NULL CHECK (intent_version = 1),
    created_intent_at TEXT NOT NULL CHECK (length(created_intent_at) > 0)
  ) STRICT`,
]);

export const SESSION_CREATE_INTENT_SQLITE_REQUIRED_TABLES = Object.freeze([
  "session_create_intents",
]);
