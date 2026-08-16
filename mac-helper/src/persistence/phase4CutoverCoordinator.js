// @ts-check

import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { parsePairingCredential, parsePairingInvitation } from "../contracts/pairing.js";
import { createSessionLegacyProcessIdentity } from "../infrastructure/sessionLegacyProcessIdentity.js";
import { NodeAtomicFileStore } from "../infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../infrastructure/nodeLockManager.js";
import { SystemClock } from "../infrastructure/systemClock.js";
import {
  DeviceBuildLegacyImportCoordinator,
  DeviceBuildLegacyImportApplier,
} from "./deviceBuildLegacyImport.js";
import {
  deviceBuildProjectionHash,
  parseDeviceBuildLegacySnapshot,
} from "./deviceBuildLockedLegacySnapshot.js";
import {
  PairingLegacyImportCoordinator,
  PairingLegacyImportApplier,
} from "./pairingLegacyImport.js";
import { pairingProjectionHash } from "./pairingLockedLegacySnapshot.js";
import { Phase4PairingAuthorityBridge } from "./phase4PairingAuthorityBridge.js";
import {
  SessionLegacyImportCoordinator,
  SessionLegacyImportApplier,
} from "./sessionLegacyImport.js";
import {
  durableSessionProjectionHash,
  parseLegacyDurableSessions,
} from "./sessionDurableProjection.js";
import { SqliteDeviceBuildStateRepository } from "./sqliteDeviceBuildStateRepository.js";
import { SqliteDurableSessionRepository } from "./sqliteDurableSessionRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "./sqliteLegacyImportCheckpointRepository.js";
import { SqlitePairingAuthorityRepository } from "./sqlitePairingAuthorityRepository.js";
import {
  normalizePairingStateSnapshot,
  SqlitePairingStateRepository,
} from "./sqlitePairingStateRepository.js";
import { SqlitePhase4AuthorityRepository } from "./sqlitePhase4AuthorityRepository.js";
import { validatePhase4MaintenanceEvidence } from "./phase4CutoverPreflight.js";

const LOCK_WAIT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const LOCK_OWNER_MODE = 0o600;

/** @typedef {import("./swiftSimSqliteDatabase.js").SwiftSimSqliteDatabase} SwiftSimSqliteDatabase */
/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

/**
 * Serialized Phase-4 cutover coordinator. Preparation is restartable and leaves
 * product routing on legacy. Activation holds all exact legacy domain locks,
 * proves the prepared source is still current, reapplies/verifies SQLite under
 * those locks, performs an immediate freshness reread, then commits the one
 * global selector while synchronizing pairing's validated local fence row in
 * the same SQLite transaction.
 */
export class Phase4CutoverCoordinator {
  #authority;
  #pairingAuthority;
  #pairingBridge;
  #pairingRepository;
  #deviceRepository;
  #sessionRepository;
  #checkpoints;
  #fileStore;
  #lockManager;
  #clock;
  #sources;
  #backupDirectory;

  /** @param {{ database: SwiftSimSqliteDatabase, stateRoot: string, spawnSync: SpawnSyncLike }} options */
  constructor({ database, stateRoot, spawnSync }) {
    if (!database || typeof database.transaction !== "function") {
      throw new TypeError("Phase-4 cutover requires the shared SQLite database.");
    }
    if (typeof stateRoot !== "string" || !stateRoot) {
      throw new TypeError("Phase-4 cutover requires an explicit state root.");
    }
    this.#authority = new SqlitePhase4AuthorityRepository(database);
    this.#pairingAuthority = new SqlitePairingAuthorityRepository(database);
    this.#pairingBridge = new Phase4PairingAuthorityBridge(database);
    this.#pairingRepository = new SqlitePairingStateRepository(database);
    this.#deviceRepository = new SqliteDeviceBuildStateRepository(database);
    this.#sessionRepository = new SqliteDurableSessionRepository(database);
    this.#checkpoints = new SqliteLegacyImportCheckpointRepository(database);
    this.#fileStore = new NodeAtomicFileStore();
    this.#clock = new SystemClock();
    if (typeof spawnSync !== "function") {
      throw new TypeError("Phase-4 cutover requires an injected spawnSync process boundary.");
    }
    this.#lockManager = new NodeLockManager({
      identity: createSessionLegacyProcessIdentity({ spawnSync: /** @type {any} */ (spawnSync) }),
      fileStore: this.#fileStore,
      clock: this.#clock,
    });
    this.#backupDirectory = join(stateRoot, "migration-backups", "phase4-cutover");
    this.#sources = phase4LegacySources(stateRoot);
  }

  status() {
    const authority = this.#authority.getState();
    return Object.freeze({
      authority,
      rollbackAvailable:
        authority.mode === "sqlite-rollback" &&
        Boolean(authority.rollbackExpiresAt) &&
        Date.now() < Date.parse(authority.rollbackExpiresAt || ""),
      rollbackExpiresAt: authority.rollbackExpiresAt,
    });
  }

  /**
   * @param {{ expectedRevision: number, maintenanceEvidence: unknown, preparationID?: string }} input
   */
  prepare(input) {
    const maintenance = validatePhase4MaintenanceEvidence(input.maintenanceEvidence, "prepare");
    const currentGlobal = this.#authority.getState();
    if (!["legacy", "preparing"].includes(currentGlobal.mode)) {
      throw new Error(`Phase-4 cannot prepare from ${currentGlobal.mode}.`);
    }
    const localPairing = this.#pairingAuthority.current();
    const preparationID = resolvePreparationID(
      input.preparationID,
      currentGlobal.preparationID,
      localPairing.mode === "legacy-preparing" ? localPairing.preparationID : null,
    );
    this.#preparePairingFence(preparationID);

    const domains = this.#runPreparationImports();
    const evidence = Object.freeze({
      version: 1,
      candidateSHA: maintenance.candidateSHA,
      verifyRunID: maintenance.verifyRunID,
      domains,
    });
    const authority = this.#authority.beginPreparation({
      expectedRevision: input.expectedRevision,
      preparationID,
      evidence,
    });
    return Object.freeze({ status: "prepared", authority, domains });
  }

  /**
   * @param {{
   *   expectedRevision: number,
   *   preparationID: string,
   *   evidenceHash: string,
   *   rollbackWindowMs: number,
   *   maintenanceEvidence: unknown,
   * }} input
   */
  activate(input) {
    const maintenance = validatePhase4MaintenanceEvidence(input.maintenanceEvidence, "activate");
    const authority = this.#authority.getState();
    if (authority.mode !== "preparing") {
      throw new Error(`Phase-4 activation requires preparing state, found ${authority.mode}.`);
    }
    const expectedPreparationID = requireHash(input.preparationID, "Phase-4 preparationID");
    const expectedEvidenceHash = requireHash(input.evidenceHash, "Phase-4 evidenceHash");
    if (
      authority.revision !== requireRevision(input.expectedRevision, "Phase-4 expected revision") ||
      authority.preparationID !== expectedPreparationID ||
      authority.evidenceHash !== expectedEvidenceHash
    ) {
      throw new Error("Phase-4 activation does not match the prepared revision/evidence epoch.");
    }
    const preparationID = requireHash(authority.preparationID, "Phase-4 prepared preparationID");
    const evidenceHash = requireHash(authority.evidenceHash, "Phase-4 prepared evidenceHash");
    const prepared = requirePreparedEvidence(authority.evidence);
    if (
      prepared.candidateSHA !== maintenance.candidateSHA ||
      prepared.verifyRunID !== maintenance.verifyRunID
    ) {
      throw new Error("Phase-4 activation candidate/Verify evidence changed since preparation.");
    }
    const rollbackWindowMs = requirePositiveInteger(
      input.rollbackWindowMs,
      "Phase-4 rollback window",
    );

    return this.#withAllDomainLocks(() => {
      const current = this.#readAllLockedSnapshots(prepared.domains);
      requirePreparedDomainsMatch(prepared.domains, current, "activation");
      this.#applyLockedSnapshots(current);
      requireSqliteProjectionEquality(
        current,
        this.#pairingRepository,
        this.#deviceRepository,
        this.#sessionRepository,
      );

      const fresh = this.#readAllLockedSnapshots(prepared.domains);
      requirePreparedDomainsMatch(prepared.domains, fresh, "final freshness");
      requireSnapshotsMatch(current, fresh);

      const cutoverAt = new Date().toISOString();
      const rollbackExpiresAt = new Date(Date.parse(cutoverAt) + rollbackWindowMs).toISOString();
      const pairing = fresh.pairing;
      const activated = this.#authority.activateSqliteRollback({
        expectedRevision: authority.revision,
        preparationID,
        evidenceHash,
        now: cutoverAt,
        rollbackExpiresAt,
        beforeSelectorCommit: ({ cutoverAt: committedAt, rollbackExpiresAt: committedExpiry }) => {
          this.#pairingBridge.activateInsideGlobalCommit({
            preparationID,
            sourceRevision: pairing.sourceRevision,
            projectionHash: pairing.projectionHash,
            cutoverAt: committedAt,
            rollbackExpiresAt: committedExpiry,
          });
        },
      });
      return Object.freeze({
        status: "activated",
        authority: activated,
        domains: summarizeLockedDomains(fresh),
      });
    });
  }

  /** @param {{ expectedRevision: number, preparationID: string }} input */
  cancelPreparation(input) {
    const current = this.#authority.getState();
    if (current.mode === "legacy")
      return Object.freeze({ status: "already-legacy", authority: current });
    if (current.mode !== "preparing") {
      throw new Error(`Phase-4 preparation cannot be cancelled from ${current.mode}.`);
    }
    const preparationID = requireHash(input.preparationID, "Phase-4 preparationID");
    const pairing = this.#pairingAuthority.current();
    if (pairing.mode === "legacy-preparing") {
      this.#pairingAuthority.cancelPreparation({
        expectedRevision: pairing.revision,
        preparationID,
      });
    } else if (pairing.mode !== "legacy") {
      throw new Error("Pairing local authority cannot cancel the global preparation safely.");
    }
    const authority = this.#authority.cancelPreparation({
      expectedRevision: input.expectedRevision,
      preparationID,
    });
    return Object.freeze({ status: "cancelled", authority });
  }

  /** @param {string} preparationID */
  #preparePairingFence(preparationID) {
    const pairing = this.#pairingAuthority.current();
    if (pairing.mode === "legacy") {
      this.#pairingAuthority.prepareSqlite({
        expectedRevision: pairing.revision,
        preparationID,
      });
      return;
    }
    if (pairing.mode === "legacy-preparing" && pairing.preparationID === preparationID) return;
    throw new Error(`Pairing local authority cannot prepare global cutover from ${pairing.mode}.`);
  }

  #runPreparationImports() {
    const pairing = new PairingLegacyImportCoordinator({
      pairingRepository: this.#pairingRepository,
      checkpointRepository: this.#checkpoints,
      fileStore: this.#fileStore,
      lockManager: this.#lockManager,
      credentialSource: this.#sources.pairingCredential,
      invitationSource: this.#sources.pairingInvitations,
      backupDirectory: this.#backupDirectory,
    }).run();
    const deviceBuild = new DeviceBuildLegacyImportCoordinator({
      deviceBuildRepository: this.#deviceRepository,
      checkpointRepository: this.#checkpoints,
      fileStore: this.#fileStore,
      lockManager: this.#lockManager,
      source: this.#sources.deviceBuilds,
      backupDirectory: this.#backupDirectory,
      clock: this.#clock,
    }).run();
    const sessions = new SessionLegacyImportCoordinator({
      sessionRepository: this.#sessionRepository,
      checkpointRepository: this.#checkpoints,
      fileStore: this.#fileStore,
      lockManager: this.#lockManager,
      source: this.#sources.sessions,
      backupDirectory: this.#backupDirectory,
      clock: this.#clock,
    }).run();
    return deepFreeze({
      pairing: stableDomainEvidence(pairing),
      deviceBuild: stableDomainEvidence(deviceBuild, { sourceVersion: deviceBuild.sourceVersion }),
      sessions: stableDomainEvidence(sessions),
    });
  }

  /** @param {ReturnType<typeof requirePreparedEvidence>["domains"]} preparedDomains */
  #readAllLockedSnapshots(preparedDomains) {
    return deepFreeze({
      pairing: readPairingSnapshot(this.#fileStore, this.#sources, preparedDomains.pairing.backups),
      deviceBuild: readDeviceSnapshot(
        this.#fileStore,
        this.#sources.deviceBuilds,
        preparedDomains.deviceBuild.backups,
      ),
      sessions: readSessionSnapshot(
        this.#fileStore,
        this.#sources.sessions,
        preparedDomains.sessions.backups,
      ),
    });
  }

  /** @param {any} snapshots */
  #applyLockedSnapshots(snapshots) {
    new PairingLegacyImportApplier({
      pairingRepository: this.#pairingRepository,
      checkpointRepository: this.#checkpoints,
    }).apply(snapshots.pairing);
    new DeviceBuildLegacyImportApplier({
      deviceBuildRepository: this.#deviceRepository,
      checkpointRepository: this.#checkpoints,
      clock: this.#clock,
    }).apply(snapshots.deviceBuild);
    new SessionLegacyImportApplier({
      sessionRepository: this.#sessionRepository,
      checkpointRepository: this.#checkpoints,
      clock: this.#clock,
    }).apply(snapshots.sessions);
  }

  /** @template T @param {() => T} operation @returns {T} */
  #withAllDomainLocks(operation) {
    const requests = [
      this.#sources.pairingCredential.lockRequest,
      this.#sources.pairingInvitations.lockRequest,
      this.#sources.deviceBuilds.lockRequest,
      this.#sources.sessions.lockRequest,
    ].sort((left, right) => left.path.localeCompare(right.path));
    return withLocksSync(this.#lockManager, requests, operation);
  }
}

/** @param {string} stateRoot */
export function phase4LegacySources(stateRoot) {
  /** @param {string} name @param {string} fileName */
  const source = (name, fileName) => {
    const path = join(stateRoot, fileName);
    return Object.freeze({
      name,
      path,
      lockRequest: Object.freeze({
        path: `${path}.lock`,
        waitMs: LOCK_WAIT_MS,
        staleAfterMs: STALE_LOCK_MS,
        ownerMode: LOCK_OWNER_MODE,
      }),
    });
  };
  return Object.freeze({
    pairingCredential: source("pairing.json", "pairing.json"),
    pairingInvitations: source("pairing-invites.json", "pairing-invites.json"),
    deviceBuilds: source("device-builds.json", "device-builds.json"),
    sessions: source("sessions.json", "sessions.json"),
  });
}

/** @param {NodeAtomicFileStore} fileStore @param {ReturnType<typeof phase4LegacySources>} sources @param {readonly string[]} backups */
function readPairingSnapshot(fileStore, sources, backups) {
  const credentialRaw = fileStore.readTextSync(sources.pairingCredential.path);
  let invitationRaw = null;
  try {
    invitationRaw = fileStore.readTextSync(sources.pairingInvitations.path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  let rawCredential;
  try {
    rawCredential = JSON.parse(credentialRaw);
  } catch (error) {
    throw new Error("Pairing credential legacy source is invalid JSON.", { cause: error });
  }
  let rawInvitations = [];
  if (invitationRaw !== null) {
    try {
      rawInvitations = JSON.parse(invitationRaw);
    } catch (error) {
      throw new Error("Pairing invitation legacy source is invalid JSON.", { cause: error });
    }
    if (!Array.isArray(rawInvitations)) {
      throw new Error("Pairing invitation legacy source must contain an array.");
    }
  }
  const snapshot = normalizePairingStateSnapshot({
    credential: parsePairingCredential(rawCredential),
    invitations: rawInvitations.map((value) => parsePairingInvitation(value)),
  });
  const sourcesEvidence = [
    {
      role: "credential",
      name: sources.pairingCredential.name,
      present: true,
      digest: sha256(credentialRaw),
    },
    {
      role: "invitations",
      name: sources.pairingInvitations.name,
      present: invitationRaw !== null,
      digest: invitationRaw === null ? null : sha256(invitationRaw),
    },
  ];
  return deepFreeze({
    snapshot,
    sourceRevision: sha256(JSON.stringify({ version: 1, sources: sourcesEvidence })),
    projectionHash: pairingProjectionHash(snapshot),
    recordCount: 1 + snapshot.invitations.length,
    backups: [...backups],
  });
}

/** @param {NodeAtomicFileStore} fileStore @param {{name:string,path:string}} source @param {readonly string[]} backups */
function readDeviceSnapshot(fileStore, source, backups) {
  let raw = null;
  try {
    raw = fileStore.readTextSync(source.path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const parsed = parseDeviceBuildLegacySnapshot(raw, source.path);
  const snapshot = parsed.snapshot;
  const sourceRevision = sha256(
    JSON.stringify({
      version: 1,
      source: {
        name: source.name,
        present: raw !== null,
        digest: raw === null ? null : sha256(raw),
        stateVersion: parsed.sourceVersion,
      },
    }),
  );
  return deepFreeze({
    snapshot,
    sourceRevision,
    projectionHash: deviceBuildProjectionHash(snapshot),
    recordCount:
      snapshot.builds.length +
      snapshot.apps.length +
      snapshot.artifactCleanupJobs.length +
      snapshot.deliveryReferenceCleanupJobs.length,
    backups: [...backups],
    sourceVersion: parsed.sourceVersion,
  });
}

/** @param {NodeAtomicFileStore} fileStore @param {{name:string,path:string}} source @param {readonly string[]} backups */
function readSessionSnapshot(fileStore, source, backups) {
  let raw = null;
  try {
    raw = fileStore.readTextSync(source.path);
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const snapshot = raw === null ? [] : parseLegacyDurableSessions(raw, source.path);
  const digest = raw === null ? null : sha256(raw);
  return deepFreeze({
    snapshot,
    sourceRevision: sha256(
      JSON.stringify({ version: 1, name: source.name, present: raw !== null, digest }),
    ),
    projectionHash: durableSessionProjectionHash(snapshot),
    recordCount: snapshot.length,
    backups: [...backups],
  });
}

/** @param {any} snapshots */
function summarizeLockedDomains(snapshots) {
  return deepFreeze({
    pairing: stableDomainEvidence(snapshots.pairing),
    deviceBuild: stableDomainEvidence(snapshots.deviceBuild, {
      sourceVersion: snapshots.deviceBuild.sourceVersion,
    }),
    sessions: stableDomainEvidence(snapshots.sessions),
  });
}

/** @param {unknown} value */
function stableDomainEvidence(value, extra = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 domain preparation result is invalid.");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  return deepFreeze({
    sourceRevision: requireHash(record.sourceRevision, "Phase-4 sourceRevision"),
    projectionHash: requireHash(record.projectionHash, "Phase-4 projectionHash"),
    recordCount: requireRevision(record.recordCount, "Phase-4 recordCount"),
    backups: Object.freeze(requireStringArray(record.backups, "Phase-4 backups")),
    ...extra,
  });
}

/** @param {unknown} value */
function requirePreparedEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 prepared evidence is missing.");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.version !== 1) throw new Error("Phase-4 prepared evidence version is unsupported.");
  const domains = /** @type {any} */ (record.domains);
  if (!domains?.pairing || !domains?.deviceBuild || !domains?.sessions) {
    throw new Error("Phase-4 prepared evidence is missing domain evidence.");
  }
  return /** @type {any} */ (record);
}

/** @param {any} prepared @param {any} current @param {string} stage */
function requirePreparedDomainsMatch(prepared, current, stage) {
  for (const key of ["pairing", "deviceBuild", "sessions"]) {
    const left = prepared[key];
    const right = current[key];
    if (
      left.sourceRevision !== right.sourceRevision ||
      left.projectionHash !== right.projectionHash ||
      left.recordCount !== right.recordCount ||
      (key === "deviceBuild" && Number(left.sourceVersion) !== Number(right.sourceVersion))
    ) {
      throw new Error(`Phase-4 ${stage} rejected stale ${key} source/projection evidence.`);
    }
  }
}

/** @param {any} first @param {any} second */
function requireSnapshotsMatch(first, second) {
  requirePreparedDomainsMatch(first, second, "freshness");
}

/** @param {any} snapshots @param {SqlitePairingStateRepository} pairing @param {SqliteDeviceBuildStateRepository} device @param {SqliteDurableSessionRepository} sessions */
function requireSqliteProjectionEquality(snapshots, pairing, device, sessions) {
  if (pairingProjectionHash(pairing.read()) !== snapshots.pairing.projectionHash) {
    throw new Error("Final pairing projection equality failed.");
  }
  if (deviceBuildProjectionHash(device.read()) !== snapshots.deviceBuild.projectionHash) {
    throw new Error("Final device-build projection equality failed.");
  }
  if (durableSessionProjectionHash(sessions.list()) !== snapshots.sessions.projectionHash) {
    throw new Error("Final durable-session projection equality failed.");
  }
}

/** @template T @param {NodeLockManager} lockManager @param {readonly any[]} requests @param {() => T} operation @param {number} [index] @returns {T} */
function withLocksSync(lockManager, requests, operation, index = 0) {
  const request = requests[index];
  if (!request) return operation();
  return lockManager.withLockSync(request, () =>
    withLocksSync(lockManager, requests, operation, index + 1),
  );
}

/** @param {unknown} requested @param {unknown} globalPrepared @param {unknown} pairingPrepared */
function resolvePreparationID(requested, globalPrepared, pairingPrepared) {
  const candidates = [requested, globalPrepared, pairingPrepared]
    .filter(Boolean)
    .map((value) => requireHash(value, "Phase-4 preparationID"));
  if (new Set(candidates).size > 1) {
    throw new Error("Phase-4 preparation identifiers disagree across resumable state.");
  }
  return candidates[0] || sha256(randomBytes(32).toString("hex"));
}

/** @param {unknown} value @param {string} label */
function requireHash(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label */
function requireRevision(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label */
function requirePositiveInteger(value, label) {
  const result = requireRevision(value, label);
  if (result === 0) throw new Error(`${label} must be greater than zero.`);
  return result;
}

/** @param {unknown} value @param {string} label */
function requireStringArray(value, label) {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry)) {
    throw new Error(`${label} must be an array of paths.`);
  }
  return [...value];
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value)))
    deepFreeze(nested);
  Object.freeze(/** @type {object} */ (value));
  return value;
}
