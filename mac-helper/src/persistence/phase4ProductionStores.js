// @ts-check

import { homedir } from "node:os";
import { join } from "node:path";
import { DeviceBuildStore } from "../deviceBuildStore.js";
import { ensureDirectoryModeSync } from "../infrastructure/nodeAtomicFileStore.js";
import { PairingInviteStore } from "../pairingInviteStore.js";
import { PairingStore } from "../pairingStore.js";
import { SessionStore } from "../sessionStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "./phase4SqliteSchema.js";
import { Phase4AuthorityRouter, createAuthorityRoutedFacade } from "./phase4AuthorityRouter.js";
import { createSqliteDeviceBuildStore } from "./phase4DeviceBuildStore.js";
import {
  SqlitePairingInviteStore,
  SqlitePairingMutationRepository,
  SqlitePairingStore,
} from "./phase4PairingStores.js";
import { createSqliteDurableSessionStore } from "./phase4SessionStore.js";
import { SqlitePhase4AuthorityRepository } from "./sqlitePhase4AuthorityRepository.js";
import { SwiftSimSqliteDatabase } from "./swiftSimSqliteDatabase.js";

/**
 * Create product-facing durable stores behind the one global Phase-4 selector.
 * The inactive backend is lazy and therefore cannot mutate simply because the
 * helper starts. Each method re-reads authority before selecting one backend.
 *
 * Schema migration may create/upgrade state.sqlite, but v9 initializes the
 * selector to legacy and migration itself cannot activate SQLite authority.
 *
 * Construction is intentionally artifact-cleanup-inert: no maintenance timer
 * is started and nothing drains cleanup jobs. Destructive artifact cleanup
 * remains owned by the existing explicit per-operation path and the separate
 * maintenance entrypoint; a startup/reopen/doctor/status/prepare/activate/
 * rollback must never delete queued artifact material.
 *
 * @param {{ stateRoot?: string, deviceMaintenance?: boolean }} [options]
 */
export function createPhase4ProductionStoreFactories(options = {}) {
  const stateRoot = options.stateRoot || join(homedir(), ".swift-sim");
  ensureDirectoryModeSync(stateRoot, 0o700);
  const paths = Object.freeze({
    database: join(stateRoot, "state.sqlite"),
    pairing: join(stateRoot, "pairing.json"),
    pairingInvites: join(stateRoot, "pairing-invites.json"),
    deviceBuilds: join(stateRoot, "device-builds.json"),
    sessions: join(stateRoot, "sessions.json"),
  });
  const database = openPrivatePhase4Database(paths.database);
  const authorityRepository = new SqlitePhase4AuthorityRepository(database);
  const router = new Phase4AuthorityRouter(authorityRepository);
  const pairingMutationRepository = new SqlitePairingMutationRepository(database);

  let legacyPairing;
  let sqlitePairing;
  let legacyPairingInvites;
  let sqlitePairingInvites;
  let legacyDeviceBuilds;
  let sqliteDeviceBuilds;
  let legacySessions;
  let sqliteSessions;

  const pairingStore = createAuthorityRoutedFacade({
    router,
    legacy: () => (legacyPairing ??= new PairingStore({ path: paths.pairing })),
    sqlite: () =>
      (sqlitePairing ??= new SqlitePairingStore({ repository: pairingMutationRepository })),
  });
  const pairingInviteStore = createAuthorityRoutedFacade({
    router,
    legacy: () => (legacyPairingInvites ??= new PairingInviteStore({ path: paths.pairingInvites })),
    sqlite: () =>
      (sqlitePairingInvites ??= new SqlitePairingInviteStore({
        repository: pairingMutationRepository,
      })),
  });
  const sessionStore = createAuthorityRoutedFacade({
    router,
    legacy: () => (legacySessions ??= new SessionStore({ path: paths.sessions })),
    sqlite: () =>
      (sqliteSessions ??= createSqliteDurableSessionStore({
        database,
        legacyPath: paths.sessions,
      })),
  });
  const deviceBuildStore = createAuthorityRoutedFacade({
    router,
    properties: {
      path: paths.deviceBuilds,
      lockPath: `${paths.deviceBuilds}.lock`,
    },
    // Product maintenance is owned by the authority-aware timer below. Neither
    // backend may retain a timer that keeps writing after the selector changes.
    legacy: () =>
      (legacyDeviceBuilds ??= new DeviceBuildStore({
        path: paths.deviceBuilds,
        maintenance: false,
      })),
    sqlite: () =>
      (sqliteDeviceBuilds ??= createSqliteDeviceBuildStore({
        database,
        legacyPath: paths.deviceBuilds,
        maintenance: false,
      })),
  });

  return Object.freeze({
    database,
    authorityRepository,
    router,
    paths,
    createPairingStore() {
      return /** @type {PairingStore} */ (/** @type {unknown} */ (pairingStore));
    },
    createPairingInviteStore() {
      return /** @type {PairingInviteStore} */ (/** @type {unknown} */ (pairingInviteStore));
    },
    createSessionStore() {
      return /** @type {SessionStore} */ (/** @type {unknown} */ (sessionStore));
    },
    createDeviceBuildStore() {
      return /** @type {DeviceBuildStore} */ (/** @type {unknown} */ (deviceBuildStore));
    },
    /**
     * Explicit maintenance surface. Ordinary construction/startup never calls
     * this; only the separately authorized maintenance executor may invoke it
     * after its staged preconditions pass.
     */
    runExplicitDeviceMaintenanceOnly() {
      return router.write({
        legacy: () =>
          (legacyDeviceBuilds ??= new DeviceBuildStore({
            path: paths.deviceBuilds,
            maintenance: false,
          })).runMaintenance(),
        sqlite: () =>
          (sqliteDeviceBuilds ??= createSqliteDeviceBuildStore({
            database,
            legacyPath: paths.deviceBuilds,
            maintenance: false,
          })).runMaintenance(),
      });
    },
  });
}

/** @param {string} path */
function openPrivatePhase4Database(path) {
  // SQLite creates the database, WAL, and shared-memory files synchronously
  // during construction. A temporary private umask guarantees fresh product
  // state is private without silently repairing an already-broad database;
  // diagnostics/preflight still fail closed for such existing permission drift.
  const previousUmask = process.umask(0o077);
  try {
    return new SwiftSimSqliteDatabase({
      path,
      migrations: PHASE4_SQLITE_MIGRATIONS,
    });
  } finally {
    process.umask(previousUmask);
  }
}
