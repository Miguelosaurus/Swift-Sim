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

const CLEANUP_RETRY_INTERVAL_MS = 30_000;

/**
 * Create product-facing durable stores behind the one global Phase-4 selector.
 * The inactive backend is lazy and therefore cannot mutate simply because the
 * helper starts. Each method re-reads authority before selecting one backend.
 *
 * Schema migration may create/upgrade state.sqlite, but v9 initializes the
 * selector to legacy and migration itself cannot activate SQLite authority.
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
  const database = new SwiftSimSqliteDatabase({
    path: paths.database,
    migrations: PHASE4_SQLITE_MIGRATIONS,
  });
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
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let deviceMaintenanceTimer;

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

  const ensureDeviceMaintenance = () => {
    if (options.deviceMaintenance === false || deviceMaintenanceTimer) return;
    const run = () =>
      router.write({
        legacy: () =>
          runDeviceMaintenance(
            (legacyDeviceBuilds ??= new DeviceBuildStore({
              path: paths.deviceBuilds,
              maintenance: false,
            })),
          ),
        sqlite: () =>
          runDeviceMaintenance(
            (sqliteDeviceBuilds ??= createSqliteDeviceBuildStore({
              database,
              legacyPath: paths.deviceBuilds,
              maintenance: false,
            })),
          ),
      });
    try {
      run();
    } catch {}
    deviceMaintenanceTimer = setInterval(() => {
      try {
        run();
      } catch {}
    }, CLEANUP_RETRY_INTERVAL_MS);
    deviceMaintenanceTimer.unref?.();
  };

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
      ensureDeviceMaintenance();
      return /** @type {DeviceBuildStore} */ (/** @type {unknown} */ (deviceBuildStore));
    },
  });
}

/** @param {DeviceBuildStore} store */
function runDeviceMaintenance(store) {
  store.runMaintenance();
  store.drainArtifactCleanupJobs();
}
