import type { PairingCredentialRecord, PairingInvitationRecord } from "./pairing.js";

export interface SchemaMigration {
  version: number;
  name: string;
  statements: readonly string[];
  requiredTables: readonly string[];
}

export interface RepositoryHealth {
  ok: boolean;
  path: string;
  integrity: string;
  journalMode: string;
  foreignKeys: boolean;
  foreignKeyViolations: number;
  missingTables: readonly string[];
  schemaVersion: number;
  latestSchemaVersion: number;
  migrationsApplied: number;
}

export interface SynchronousRepositoryTransaction {
  transaction<T>(operation: () => T): T;
}

/**
 * Records the exact legacy projection that has been imported and compared.
 * Domain cutover code may safely retry the same source because `source` is
 * unique and updates replace the prior evidence atomically.
 */
export interface LegacyImportCheckpoint {
  source: string;
  sourceRevision: string;
  projectionHash: string;
  importedAt: string;
  recordCount: number;
}

export interface LegacyImportCheckpointRepository extends SynchronousRepositoryTransaction {
  get(source: string): LegacyImportCheckpoint | null;
  list(): LegacyImportCheckpoint[];
  upsert(checkpoint: LegacyImportCheckpoint): void;
}

export interface PairingStateSnapshot {
  credential: PairingCredentialRecord | null;
  invitations: readonly PairingInvitationRecord[];
}

export interface PairingStateReader {
  read(): PairingStateSnapshot;
  getCredential(installationID: string): PairingCredentialRecord | null;
  getInvitation(id: string): PairingInvitationRecord | null;
  findInvitationByInviteHash(inviteHash: string): PairingInvitationRecord | null;
}

/**
 * Owns an entire normalized pairing snapshot. Replacement is atomic: callers
 * cannot publish a credential without its matching invitation set or leave a
 * partially replaced invitation collection behind.
 */
export interface PairingStateRepository extends PairingStateReader {
  replace(snapshot: PairingStateSnapshot): void;
}

export type PairingShadowSurface = "credential" | "invitation";
export type PairingShadowProjection = PairingCredentialRecord | PairingInvitationRecord | null;

export interface PairingShadowMismatchObservation {
  mismatchID: string;
  surface: PairingShadowSurface;
  keyHash: string;
  legacyProjectionHash: string | null;
  sqliteProjectionHash: string | null;
  observedAt: string;
}

export interface PairingShadowMismatchEvidence {
  mismatchID: string;
  surface: PairingShadowSurface;
  keyHash: string;
  legacyProjectionHash: string | null;
  sqliteProjectionHash: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
}

export interface PairingShadowMismatchRepository {
  get(mismatchID: string): PairingShadowMismatchEvidence | null;
  list(): PairingShadowMismatchEvidence[];
  observe(observation: PairingShadowMismatchObservation): PairingShadowMismatchEvidence;
}

export interface PairingShadowComparisonResult {
  matched: boolean;
  surface: PairingShadowSurface;
  keyHash: string;
  legacyProjectionHash: string | null;
  sqliteProjectionHash: string | null;
  evidence: PairingShadowMismatchEvidence | null;
}

export type PairingAuthorityMode =
  | "legacy"
  | "legacy-preparing"
  | "sqlite-rollback"
  | "sqlite-final";

export interface PairingAuthorityState {
  mode: PairingAuthorityMode;
  preparationID: string | null;
  sourceRevision: string | null;
  projectionHash: string | null;
  cutoverAt: string | null;
  rollbackExpiresAt: string | null;
  finalizedAt: string | null;
  revision: number;
}

export interface PairingAuthorityPreparation {
  expectedRevision: number;
  preparationID: string;
  cutoverAt: string;
  rollbackExpiresAt: string;
}

export interface PairingAuthorityCutoverEvidence {
  expectedRevision: number;
  preparationID: string;
  sourceRevision: string;
  projectionHash: string;
}

export interface PairingAuthorityReader {
  current(): PairingAuthorityState;
}

/**
 * Persists only the source-of-truth decision. Every transition is bound to the
 * authority revision observed by its caller so stale recovery work cannot act
 * on a later cutover epoch.
 */
export interface PairingAuthorityRepository extends PairingAuthorityReader {
  prepareSqlite(preparation: PairingAuthorityPreparation): PairingAuthorityState;
  cancelPreparation(input: {
    expectedRevision: number;
    preparationID: string;
  }): PairingAuthorityState;
  activateSqlite(evidence: PairingAuthorityCutoverEvidence): PairingAuthorityState;
  rollbackToLegacy(input: {
    expectedRevision: number;
    sourceRevision: string;
    rolledBackAt: string;
  }): PairingAuthorityState;
  finalizeSqlite(input: { expectedRevision: number; finalizedAt: string }): PairingAuthorityState;
}
