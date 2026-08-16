// @ts-check

import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "./deviceBuildSqliteSchema.js";
import {
  SESSION_DURABLE_SQLITE_REQUIRED_TABLES,
  SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS,
  SESSION_CREATE_INTENT_SQLITE_REQUIRED_TABLES,
  SESSION_CREATE_INTENT_SQLITE_SCHEMA_STATEMENTS,
} from "./sessionDurableSqliteSchema.js";
import {
  PHASE4_AUTHORITY_SQLITE_REQUIRED_TABLES,
  PHASE4_AUTHORITY_SQLITE_SCHEMA_STATEMENTS,
} from "./phase4AuthoritySchema.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/**
 * Complete Phase-4 migration history for the shared ~/.swift-sim/state.sqlite.
 * Migrations v1-v8 are frozen and unchanged. v9 adds only the single global
 * durable authority selector needed to coordinate pairing, device-build, and
 * durable-session activation; it adds no domain data and defaults to legacy.
 *
 * @type {readonly SchemaMigration[]}
 */
export const PHASE4_SQLITE_MIGRATIONS = Object.freeze([
  ...DEVICE_BUILD_SQLITE_MIGRATIONS,
  Object.freeze({
    version: 8,
    name: "durable_session_domain_state",
    statements: SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS,
    requiredTables: SESSION_DURABLE_SQLITE_REQUIRED_TABLES,
  }),
  Object.freeze({
    version: 9,
    name: "phase4_global_authority_epoch",
    statements: [
      ...PHASE4_AUTHORITY_SQLITE_SCHEMA_STATEMENTS,
      ...SESSION_CREATE_INTENT_SQLITE_SCHEMA_STATEMENTS,
    ],
    requiredTables: [
      ...PHASE4_AUTHORITY_SQLITE_REQUIRED_TABLES,
      ...SESSION_CREATE_INTENT_SQLITE_REQUIRED_TABLES,
    ],
  }),
]);
