// @ts-check

/**
 * Phase 4 session-domain schema fragment. It is intentionally not appended to
 * the global migration list here; the program orchestrator owns final shared
 * migration/version ordering.
 */
export const SESSION_SQLITE_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE session_records (
    id TEXT PRIMARY KEY CHECK (length(id) > 0),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    updated_at TEXT,
    stream_state TEXT NOT NULL CHECK (stream_state IN ('starting', 'running', 'stopped', 'failed')),
    record_json TEXT NOT NULL CHECK (length(record_json) > 0)
  ) STRICT`,
  `CREATE INDEX session_records_updated_at_idx ON session_records(updated_at, id)`,
  `CREATE TABLE session_shadow_mismatches (
    mismatch_id TEXT PRIMARY KEY CHECK (length(mismatch_id) = 64),
    legacy_projection_hash TEXT NOT NULL CHECK (length(legacy_projection_hash) = 64),
    sqlite_projection_hash TEXT NOT NULL CHECK (length(sqlite_projection_hash) = 64),
    first_observed_at TEXT NOT NULL CHECK (length(first_observed_at) > 0),
    last_observed_at TEXT NOT NULL CHECK (length(last_observed_at) > 0),
    observation_count INTEGER NOT NULL CHECK (observation_count > 0)
  ) STRICT`,
]);

export const SESSION_SQLITE_REQUIRED_TABLES = Object.freeze([
  "session_records",
  "session_shadow_mismatches",
]);
