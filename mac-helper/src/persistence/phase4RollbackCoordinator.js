// @ts-check

import { createHash } from "node:crypto";
import { join } from "node:path";
import { BUILD_STATE_VERSION } from "../deviceBuildStoreCore.js";
import { SessionStore as BaseSessionStore } from "../sessionStoreBase.js";
import { createSessionLegacyProcessIdentity } from "../infrastructure/sessionLegacyProcessIdentity.js";
import { NodeAtomicFileStore } from "../infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../infrastructure/nodeLockManager.js";
import { SystemClock } from "../infrastructure/systemClock.js";
import { deviceBuildProjectionHash, parseDeviceBuildLegacySnapshot } from "./deviceBuildLockedLegacySnapshot.js";
import { PairingLockedLegacyWriter } from "./pairingRollbackExport.js";
import { Phase4PairingAuthorityBridge } from "./phase4PairingAuthorityBridge.js";
import { SessionCurrentStateRollbackExport, SqliteDurableSessionMutationRepository } from "./phase4SessionStore.js";
import { SqliteDeviceBuildStateRepository } from "./sqliteDeviceBuildStateRepository.js";
import { SqlitePairingStateRepository } from "./sqlitePairingStateRepository.js";
import { SqlitePhase4AuthorityRepository } from "./sqlitePhase4AuthorityRepository.js";
import { validatePhase4MaintenanceEvidence } from "./phase4CutoverPreflight.js";
import { phase4LegacySources } from "./phase4CutoverCoordinator.js";

/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */
/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

export class Phase4RollbackCoordinator {
  #authority;
  #pairingBridge;
  #pairingRepository;
  #deviceRepository;
  #sessionRepository;
  #fileStore;
  #lockManager;
  #sources;
  #backupDirectory;

  /** @param {{ database: SwiftSimSqliteDatabase, stateRoot: string, spawnSync: SpawnSyncLike }} options */
  constructor({ database, stateRoot, spawnSync }) {
    this.#authority = new SqlitePhase4AuthorityRepository(database);
    this.#pairingBridge = new Phase4PairingAuthorityBridge(database);
    this.#pairingRepository = new SqlitePairingStateRepository(database);
    this.#deviceRepository = new SqliteDeviceBuildStateRepository(database);
    this.#sessionRepository = new SqliteDurableSessionMutationRepository(database);
    this.#fileStore = new NodeAtomicFileStore();
    const clock = new SystemClock();
    if (typeof spawnSync !== "function") {
      throw new TypeError("Phase-4 rollback requires an injected spawnSync process boundary.");
    }
    this.#lockManager = new NodeLockManager({
      identity: createSessionLegacyProcessIdentity({ spawnSync: /** @type {any} */ (spawnSync) }),
      fileStore: this.#fileStore,
      clock,
    });
    this.#sources = phase4LegacySources(stateRoot);
    this.#backupDirectory = join(stateRoot, "migration-backups", "phase4-rollback");
  }

  /**
   * @param {{ expectedRevision: number, expectedCutoverEpoch: number, maintenanceEvidence: unknown, now?: string }} input
   */
  run(input) {
    validatePhase4MaintenanceEvidence(input.maintenanceEvidence, "rollback");
    const state = this.#authority.getState();
    if (state.mode !== "sqlite-rollback") {
      throw new Error(`Phase-4 rollback requires sqlite-rollback authority, found ${state.mode}.`);
    }
    if (state.revision !== input.expectedRevision || state.cutoverEpoch !== input.expectedCutoverEpoch) {
      throw new Error("Phase-4 rollback revision/epoch fence is stale.");
    }
    const rolledBackAt = input.now || new Date().toISOString();
    if (!state.rollbackExpiresAt || Date.parse(rolledBackAt) >= Date.parse(state.rollbackExpiresAt)) {
      throw new Error("Phase-4 rollback window has expired.");
    }

    // Export CURRENT SQLite state. A crash after any export but before the
    // selector commit is safe: product routing is still SQLite and retry simply
    // republishes the same/current rollback material.
    const pairing = this.#exportPairing();
    const deviceBuild = this.#exportDeviceBuild();
    const sessions = this.#exportSessions();

    const localPairing = this.#pairingBridge.current();
    if (localPairing.mode !== "sqlite-rollback" || !localPairing.sourceRevision) {
      throw new Error("Pairing local rollback fence is not active for the global epoch.");
    }
    const authority = this.#authority.rollbackToLegacy({
      expectedRevision: state.revision,
      expectedCutoverEpoch: state.cutoverEpoch,
      now: rolledBackAt,
      beforeSelectorCommit: () => {
        this.#pairingBridge.rollbackInsideGlobalCommit({
          sourceRevision: localPairing.sourceRevision,
          rolledBackAt,
        });
      },
    });
    return Object.freeze({
      status: "rolled-back",
      authority,
      exports: Object.freeze({ pairing, deviceBuild, sessions }),
    });
  }

  #exportPairing() {
    const writer = new PairingLockedLegacyWriter({
      fileStore: this.#fileStore,
      lockManager: this.#lockManager,
      credentialSource: this.#sources.pairingCredential,
      invitationSource: this.#sources.pairingInvitations,
      backupDirectory: this.#backupDirectory,
    });
    return writer.withLockedSources((access) => {
      const snapshot = this.#pairingRepository.read();
      if (!snapshot.credential) {
        throw new Error("Phase-4 pairing rollback requires a current SQLite credential.");
      }
      const backups = access.backupExistingFiles();
      access.writeCredential(snapshot.credential);
      access.writeInvitations(snapshot.invitations);
      const verified = access.readAndVerify(snapshot);
      return Object.freeze({
        recordCount: 1 + verified.invitations.length,
        backups: Object.freeze([...backups]),
      });
    });
  }

  #exportDeviceBuild() {
    const source = this.#sources.deviceBuilds;
    return this.#lockManager.withLockSync(source.lockRequest, () => {
      const snapshot = this.#deviceRepository.read();
      const raw = JSON.stringify({
        version: BUILD_STATE_VERSION,
        apps: Object.fromEntries(snapshot.apps.map((record) => [record.id, record])),
        artifactCleanupJobs: Object.fromEntries(
          snapshot.artifactCleanupJobs.map((record) => [record.id, record]),
        ),
        deliveryReferenceCleanupJobs: Object.fromEntries(
          snapshot.deliveryReferenceCleanupJobs.map((record) => [record.id, record]),
        ),
        builds: snapshot.builds,
      }, null, 2);
      backupCurrentFile(this.#fileStore, source.path, this.#backupDirectory, "device-builds");
      this.#fileStore.writeTextSync(source.path, raw, {
        mode: 0o600,
        createParentMode: 0o700,
        replace: true,
        syncDirectory: true,
      });
      const reread = this.#fileStore.readTextSync(source.path);
      const parsed = parseDeviceBuildLegacySnapshot(reread, source.path);
      if (deviceBuildProjectionHash(parsed.snapshot) !== deviceBuildProjectionHash(snapshot)) {
        throw new Error("Device-build rollback export did not verify after publish.");
      }
      return Object.freeze({
        recordCount:
          snapshot.builds.length + snapshot.apps.length +
          snapshot.artifactCleanupJobs.length + snapshot.deliveryReferenceCleanupJobs.length,
        projectionHash: deviceBuildProjectionHash(snapshot),
      });
    });
  }

  #exportSessions() {
    const source = this.#sources.sessions;
    const runtimeStore = /** @type {BaseSessionStore} */ (Object.create(BaseSessionStore.prototype));
    runtimeStore.path = source.path;
    runtimeStore.lockPath = source.lockRequest.path;
    runtimeStore.sessions = new Map();
    runtimeStore.stateError = null;
    const exporter = new SessionCurrentStateRollbackExport({
      durableRepository: this.#sessionRepository,
      runtimeStore: /** @type {any} */ (runtimeStore),
    });
    return exporter.exportCurrent();
  }
}

/** @param {NodeAtomicFileStore} fileStore @param {string} path @param {string} backupDirectory @param {string} label */
function backupCurrentFile(fileStore, path, backupDirectory, label) {
  let raw;
  try {
    raw = fileStore.readTextSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  const backupPath = join(backupDirectory, `${label}.${digest}.bak`);
  try {
    fileStore.writeTextSync(backupPath, raw, {
      mode: 0o600,
      createParentMode: 0o700,
      replace: false,
      syncDirectory: true,
    });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
  }
  if (fileStore.readTextSync(backupPath) !== raw) {
    throw new Error(`${label} rollback backup did not verify.`);
  }
  return backupPath;
}
