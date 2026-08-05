import type {
  PairingCredentialRecord,
  PairingInvitationRecord,
} from "./pairing.js";

export interface SchemaMigration {
  version: number;
  name: string;
  statements: readonly string[];
}

export interface RepositoryHealth {
  ok: boolean;
  path: string;
  integrity: string;
  journalMode: string;
  foreignKeys: boolean;
  schemaVersion: number;
  latestSchemaVersion: number;
  migrationsApplied: number;
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

export interface LegacyImportCheckpointRepository {
  get(source: string): LegacyImportCheckpoint | null;
  list(): LegacyImportCheckpoint[];
  upsert(checkpoint: LegacyImportCheckpoint): void;
}

export interface PairingCredentialRepository {
  get(installationID: string): PairingCredentialRecord | null;
  list(): PairingCredentialRecord[];
  upsert(record: PairingCredentialRecord): void;
  replaceAll(records: readonly PairingCredentialRecord[]): void;
}

export interface PairingInvitationRepository {
  get(id: string): PairingInvitationRecord | null;
  findByInviteHash(inviteHash: string): PairingInvitationRecord | null;
  list(): PairingInvitationRecord[];
  upsert(record: PairingInvitationRecord): void;
  replaceAll(records: readonly PairingInvitationRecord[]): void;
}
