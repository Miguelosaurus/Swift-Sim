// @ts-check

import { PAIRING_SQLITE_MIGRATIONS } from "./pairingSqliteSchema.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/** @type {readonly SchemaMigration[]} */
export const DEVICE_BUILD_SQLITE_MIGRATIONS = Object.freeze([
  ...PAIRING_SQLITE_MIGRATIONS,
  Object.freeze({
    version: 6,
    name: "device_build_domain_state",
    statements: Object.freeze([
      `CREATE TABLE device_builds (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        revision INTEGER NOT NULL CHECK (revision >= 0 AND revision <= 9007199254740991),
        app_identity TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('queued', 'validating', 'preparing', 'archiving', 'building', 'exporting', 'delivering', 'ready', 'failed')
        ),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
        record_json TEXT NOT NULL CHECK (
          json_valid(record_json) AND
          json_type(record_json) = 'object' AND
          json_extract(record_json, '$.id') = id AND
          json_extract(record_json, '$.revision') = revision AND
          COALESCE(json_extract(record_json, '$.app.identity'), '') = app_identity AND
          json_extract(record_json, '$.state') = state AND
          json_extract(record_json, '$.createdAt') = created_at AND
          json_extract(record_json, '$.updatedAt') = updated_at
        )
      ) STRICT`,
      `CREATE INDEX device_builds_created_at_idx
        ON device_builds(created_at DESC, id)`,
      `CREATE INDEX device_builds_app_identity_idx
        ON device_builds(app_identity, created_at DESC, id)`,
      `CREATE INDEX device_builds_state_idx
        ON device_builds(state, updated_at, id)`,
      `CREATE TABLE device_app_state (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        archived_at TEXT NOT NULL,
        record_json TEXT NOT NULL CHECK (
          json_valid(record_json) AND
          json_type(record_json) = 'object' AND
          json_extract(record_json, '$.id') = id AND
          json_extract(record_json, '$.archivedAt') = archived_at
        )
      ) STRICT`,
      `CREATE TABLE artifact_cleanup_jobs (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        build_id TEXT NOT NULL,
        root TEXT NOT NULL CHECK (length(root) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        next_attempt_at TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0 AND attempts <= 9007199254740991),
        record_json TEXT NOT NULL CHECK (
          json_valid(record_json) AND
          json_type(record_json) = 'object' AND
          json_extract(record_json, '$.id') = id AND
          COALESCE(json_extract(record_json, '$.buildId'), '') = build_id AND
          json_extract(record_json, '$.root') = root AND
          json_extract(record_json, '$.createdAt') = created_at AND
          COALESCE(json_extract(record_json, '$.nextAttemptAt'), '') = next_attempt_at AND
          json_extract(record_json, '$.attempts') = attempts
        )
      ) STRICT`,
      `CREATE INDEX artifact_cleanup_jobs_due_idx
        ON artifact_cleanup_jobs(next_attempt_at, created_at, id)`,
      `CREATE TABLE delivery_reference_cleanup_jobs (
        id TEXT PRIMARY KEY CHECK (length(id) > 0),
        build_id TEXT NOT NULL,
        generation TEXT NOT NULL CHECK (length(generation) > 0),
        reference_id TEXT NOT NULL CHECK (length(reference_id) > 0),
        created_at TEXT NOT NULL CHECK (length(created_at) > 0),
        next_attempt_at TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0 AND attempts <= 9007199254740991),
        record_json TEXT NOT NULL CHECK (
          json_valid(record_json) AND
          json_type(record_json) = 'object' AND
          json_extract(record_json, '$.id') = id AND
          COALESCE(json_extract(record_json, '$.buildId'), '') = build_id AND
          json_extract(record_json, '$.generation') = generation AND
          json_extract(record_json, '$.referenceID') = reference_id AND
          json_extract(record_json, '$.createdAt') = created_at AND
          COALESCE(json_extract(record_json, '$.nextAttemptAt'), '') = next_attempt_at AND
          json_extract(record_json, '$.attempts') = attempts
        ),
        UNIQUE (generation, reference_id, id)
      ) STRICT`,
      `CREATE INDEX delivery_reference_cleanup_jobs_due_idx
        ON delivery_reference_cleanup_jobs(next_attempt_at, created_at, id)`,
    ]),
    requiredTables: Object.freeze([
      "device_builds",
      "device_app_state",
      "artifact_cleanup_jobs",
      "delivery_reference_cleanup_jobs",
    ]),
  }),
]);
