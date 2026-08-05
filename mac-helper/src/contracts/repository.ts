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

/**
 * Owns an entire normalized pairing snapshot. Replacement is atomic: callers
 * cannot publish a credential without its matching invitation set or leave a
 * partially replaced invitation collection behind.
 */
export interface PairingStateRepository {
  read(): PairingStateSnapshot;
  replace(snapshot: PairingStateSnapshot): void;
  getCredential(installationID: string): PairingCredentialRecord | null;
  getInvitation(id: string): PairingInvitationRecord | null;
  findInvitationByInviteHash(inviteHash: string): PairingInvitationRecord | null;
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
