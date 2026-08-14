// @ts-check

import { DEVICE_BUILD_SQLITE_MIGRATIONS } from "./deviceBuildSqliteSchema.js";
import {
  SESSION_DURABLE_SQLITE_REQUIRED_TABLES,
  SESSION_DURABLE_SQLITE_SCHEMA_STATEMENTS,
} from "./sessionDurableSqliteSchema.js";

/** @typedef {import("../contracts/repository.js").SchemaMigration} SchemaMigration */

/**
 * Complete Phase-4 migration history for the shared ~/.swift-sim/state.sqlite.
 * Prefix exports remain available to isolated historical tests, but production
 * openers must use this complete list so a database upgraded by one observer is
 * never rejected as newer by another observer in the same build.
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
]);
