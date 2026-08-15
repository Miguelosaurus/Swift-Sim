#!/usr/bin/env node
// @ts-check

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { Phase4CutoverCoordinator } from "../src/persistence/phase4CutoverCoordinator.js";
import { Phase4RollbackCoordinator } from "../src/persistence/phase4RollbackCoordinator.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../src/persistence/phase4SqliteSchema.js";
import { SqliteDeviceBuildStateRepository } from "../src/persistence/sqliteDeviceBuildStateRepository.js";
import { SqliteDurableSessionRepository } from "../src/persistence/sqliteDurableSessionRepository.js";
import { SqlitePairingStateRepository } from "../src/persistence/sqlitePairingStateRepository.js";
import { SqlitePhase4AuthorityRepository } from "../src/persistence/sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "../src/persistence/swiftSimSqliteDatabase.js";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [action = "status", ...args] = process.argv.slice(2);
  if (!["status", "prepare", "activate", "cancel", "rollback"].includes(action)) {
    throw new Error(
      "Usage: swift-sim-phase4-cutover status|prepare|activate|cancel|rollback --state-root <path> ...",
    );
  }
  const { values } = parseArgs({
    args,
    options: {
      "state-root": { type: "string" },
      "evidence-file": { type: "string" },
      "expected-revision": { type: "string" },
      "expected-cutover-epoch": { type: "string" },
      "preparation-id": { type: "string" },
      "evidence-hash": { type: "string" },
      "rollback-window-minutes": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const stateRoot = requireStateRoot(values["state-root"]);
  if (action === "status") {
    console.log(JSON.stringify(readOnlyStatus(stateRoot), null, 2));
    return;
  }

  const maintenanceEvidence = readEvidence(values["evidence-file"]);
  const { spawnSync } = await import("node:child_process");
  const expectedRevision = nonNegativeInteger(
    values["expected-revision"],
    "--expected-revision",
  );
  const database = openDatabase(stateRoot);
  try {
    if (action === "prepare") {
      const result = new Phase4CutoverCoordinator({ database, stateRoot, spawnSync }).prepare({
        expectedRevision,
        maintenanceEvidence,
        ...(values["preparation-id"] ? { preparationID: values["preparation-id"] } : {}),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (action === "cancel") {
      const result = new Phase4CutoverCoordinator({ database, stateRoot, spawnSync }).cancelPreparation({
        expectedRevision,
        preparationID: requireOption(values["preparation-id"], "--preparation-id"),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    if (action === "activate") {
      const minutes = positiveInteger(
        values["rollback-window-minutes"],
        "--rollback-window-minutes",
      );
      if (minutes > 7 * 24 * 60) {
        throw new Error("--rollback-window-minutes may not exceed seven days.");
      }
      const result = new Phase4CutoverCoordinator({ database, stateRoot, spawnSync }).activate({
        expectedRevision,
        preparationID: requireOption(values["preparation-id"], "--preparation-id"),
        evidenceHash: requireOption(values["evidence-hash"], "--evidence-hash"),
        rollbackWindowMs: minutes * 60_000,
        maintenanceEvidence,
      });
      database.close();
      const reopened = postSwitchHealth(stateRoot, "sqlite-rollback");
      console.log(JSON.stringify({ ...result, postSwitchHealth: reopened }, null, 2));
      return;
    }
    const result = new Phase4RollbackCoordinator({ database, stateRoot, spawnSync }).run({
      expectedRevision,
      expectedCutoverEpoch: nonNegativeInteger(
        values["expected-cutover-epoch"],
        "--expected-cutover-epoch",
      ),
      maintenanceEvidence,
    });
    database.close();
    const reopened = postSwitchHealth(stateRoot, "legacy");
    console.log(JSON.stringify({ ...result, postSwitchHealth: reopened }, null, 2));
  } finally {
    try {
      database.close();
    } catch {}
  }
}

function openDatabase(stateRoot) {
  return new SwiftSimSqliteDatabase({
    path: join(stateRoot, "state.sqlite"),
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
}

/** @param {string} stateRoot @param {string} expectedMode */
function postSwitchHealth(stateRoot, expectedMode) {
  const database = openDatabase(stateRoot);
  try {
    const authorityRepository = new SqlitePhase4AuthorityRepository(database);
    const authority = database.transaction(() => authorityRepository.getState());
    if (authority.mode !== expectedMode) {
      throw new Error(`Post-switch authority reopen expected ${expectedMode}, found ${authority.mode}.`);
    }
    const pairingCount = (() => {
      const value = new SqlitePairingStateRepository(database).read();
      return (value.credential ? 1 : 0) + value.invitations.length;
    })();
    const device = new SqliteDeviceBuildStateRepository(database).read();
    const sessionCount = new SqliteDurableSessionRepository(database).list().length;
    const health = database.health();
    if (!health.ok) throw new Error("Post-switch shared SQLite health check failed.");
    return Object.freeze({
      ok: true,
      authority,
      database: health,
      pairingRecordCount: pairingCount,
      deviceBuildRecordCount:
        device.builds.length +
        device.apps.length +
        device.artifactCleanupJobs.length +
        device.deliveryReferenceCleanupJobs.length,
      durableSessionRecordCount: sessionCount,
    });
  } finally {
    database.close();
  }
}

/** @param {string} stateRoot */
function readOnlyStatus(stateRoot) {
  const path = join(stateRoot, "state.sqlite");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const latestSchemaVersion = PHASE4_SQLITE_MIGRATIONS.at(-1)?.version || 0;
    const schemaVersion = Number(
      database.prepare("SELECT COALESCE(MAX(version), 0) AS value FROM schema_migrations").get()?.value || 0,
    );
    const hasAuthority = Boolean(
      database
        .prepare(
          "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'phase4_authority_state'",
        )
        .get(),
    );
    if (!hasAuthority) {
      return Object.freeze({
        readOnly: true,
        mutationAllowed: false,
        authority: "legacy",
        transitionState: "not-migrated",
        rollbackAvailable: false,
        rollbackExpiresAt: null,
        schemaVersion,
        latestSchemaVersion,
      });
    }
    const row = database
      .prepare(`SELECT mode, revision, cutover_epoch, preparation_id,
      evidence_hash, prepared_at, cutover_at, rollback_expires_at, finalized_at
      FROM phase4_authority_state WHERE singleton = 1`)
      .get();
    const mode = String(row?.mode || "legacy");
    const rollbackExpiresAt = row?.rollback_expires_at ? String(row.rollback_expires_at) : null;
    return Object.freeze({
      readOnly: true,
      mutationAllowed: false,
      authority: mode,
      transitionState: mode,
      revision: Number(row?.revision || 0),
      cutoverEpoch: Number(row?.cutover_epoch || 0),
      preparationID: row?.preparation_id || null,
      evidenceHash: row?.evidence_hash || null,
      preparedAt: row?.prepared_at || null,
      cutoverAt: row?.cutover_at || null,
      rollbackAvailable:
        ["sqlite-rollback", "rollback-preparing"].includes(mode) &&
        Boolean(rollbackExpiresAt) &&
        Date.now() < Date.parse(rollbackExpiresAt || ""),
      rollbackExpiresAt,
      finalizedAt: row?.finalized_at || null,
      schemaVersion,
      latestSchemaVersion,
    });
  } finally {
    database.close();
  }
}

function readEvidence(path) {
  const source = requireOption(path, "--evidence-file");
  const parsed = JSON.parse(readFileSync(resolve(source), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Maintenance evidence file must contain one JSON object.");
  }
  return parsed;
}

function requireStateRoot(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("--state-root is required; cutover never assumes a live root implicitly.");
  }
  return resolve(value);
}

function requireOption(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value;
}

function nonNegativeInteger(value, label) {
  const number = Number(requireOption(value, label));
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return number;
}

function positiveInteger(value, label) {
  const number = nonNegativeInteger(value, label);
  if (number === 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}
